import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { config } from '../config.js';
import { query, withTransaction } from '../db.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import {
  validate, idParam, listQuery, trimmed, email, password, optionalId, boolFilter,
} from '../middleware/validate.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import { writeAudit, diff } from '../utils/audit.js';
import { Where, likePattern, paginated } from '../utils/sql.js';

const router = Router();
router.use(authenticate, requireAdmin);

// password_hash ve token_version hiçbir yanıtta yer almaz (açık sütun listesi).
const USER_COLUMNS = `
  u.id, u.ad_soyad, u.email, u.role, u.department_id, d.name AS department_name,
  u.is_active, u.is_approved, u.self_registered, u.must_change_password, u.created_at, u.updated_at,
  (SELECT count(*) FROM assignments a WHERE a.user_id = u.id AND a.returned_at IS NULL) AS active_assignment_count`;

const SORT_COLUMNS = {
  ad_soyad: 'u.ad_soyad',
  email: 'u.email',
  role: 'u.role',
  department: 'd.name',
  created_at: 'u.created_at',
};

const role = z.enum(['ADMIN', 'USER'], { errorMap: () => ({ message: 'Rol ADMIN veya USER olmalıdır' }) });

const listSchema = listQuery(Object.keys(SORT_COLUMNS), 'created_at', {
  role: role.optional(),
  department_id: optionalId,
  is_active: boolFilter,
  // Onay bekleyen kendi kendine kayıtlar ayrı listelenir; normal liste yalnızca onaylı hesapları gösterir.
  approval: z.enum(['approved', 'pending']).default('approved'),
});

const createSchema = z.object({
  ad_soyad: trimmed('Ad soyad', 2, 150),
  email,
  password,
  role: role.default('USER'),
  department_id: optionalId,
});

const updateSchema = z
  .object({
    ad_soyad: trimmed('Ad soyad', 2, 150).optional(),
    email: email.optional(),
    role: role.optional(),
    department_id: z.union([z.coerce.number().int().positive(), z.null()]).optional(),
    is_active: z.boolean({ invalid_type_error: 'Aktiflik true/false olmalıdır' }).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Güncellenecek en az bir alan gönderin' });

const passwordSchema = z.object({ password });

async function getUser(id, db = { query }) {
  const { rows } = await db.query(
    `SELECT ${USER_COLUMNS} FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.id = $1`,
    [id],
  );
  return rows[0] || null;
}

async function assertDepartmentExists(departmentId, db = { query }) {
  if (departmentId == null) return;
  const { rowCount } = await db.query('SELECT 1 FROM departments WHERE id = $1', [departmentId]);
  if (!rowCount) throw badRequest('Seçilen departman bulunamadı', [{ field: 'department_id', message: 'Seçilen departman bulunamadı' }]);
}

/** Sistemde en az bir aktif yönetici kalmasını garanti eder. */
async function assertNotLastAdmin(client, userId) {
  const { rows } = await client.query(
    `SELECT count(*) AS n FROM users WHERE role = 'ADMIN' AND is_active AND id <> $1`,
    [userId],
  );
  if (rows[0].n === 0) {
    throw conflict('LAST_ADMIN', 'Sistemdeki son aktif yönetici pasife alınamaz, silinemez veya rolü değiştirilemez');
  }
}

// GET /api/users
router.get('/', validate({ query: listSchema }), async (req, res) => {
  const { page, limit, search, sort, order, role: r, department_id: dep, is_active: active, approval } = req.valid.query;
  const w = new Where();
  w.add(approval === 'pending' ? 'NOT u.is_approved' : 'u.is_approved');
  if (search) {
    const like = likePattern(search);
    w.add('(u.ad_soyad ILIKE ? OR u.email ILIKE ?)', like, like);
  }
  if (r) w.add('u.role = ?', r);
  if (dep) w.add('u.department_id = ?', dep);
  if (active === 'true') w.add('u.is_active = TRUE');
  if (active === 'false') w.add('u.is_active = FALSE');

  const from = 'FROM users u LEFT JOIN departments d ON d.id = u.department_id';
  const { rows: countRows } = await query(`SELECT count(*) AS total ${from} ${w.sql()}`, w.params);
  const orderBy = `${SORT_COLUMNS[sort]} ${order === 'asc' ? 'ASC' : 'DESC'} NULLS LAST, u.id ${order === 'asc' ? 'ASC' : 'DESC'}`;
  const { rows } = await query(
    `SELECT ${USER_COLUMNS} ${from} ${w.sql()} ORDER BY ${orderBy}
     LIMIT ${w.param(limit)} OFFSET ${w.param((page - 1) * limit)}`,
    w.params,
  );
  res.json(paginated(rows, countRows[0].total, page, limit));
});

// GET /api/users/:id
router.get('/:id', validate({ params: idParam }), async (req, res) => {
  const user = await getUser(req.valid.params.id);
  if (!user) throw notFound('Kullanıcı bulunamadı');
  res.json(user);
});

// POST /api/users
router.post('/', validate({ body: createSchema }), async (req, res) => {
  const body = req.valid.body;
  await assertDepartmentExists(body.department_id);
  const hash = await bcrypt.hash(body.password, config.bcryptRounds);

  const user = await withTransaction(async (client) => {
    // Yöneticinin belirlediği parola geçicidir: kullanıcı ilk girişte kendi parolasını belirler.
    const { rows } = await client.query(
      `INSERT INTO users (ad_soyad, email, password_hash, role, department_id, must_change_password)
       VALUES ($1, $2, $3, $4, $5, TRUE) RETURNING id`,
      [body.ad_soyad, body.email, hash, body.role, body.department_id ?? null],
    );
    const id = rows[0].id;
    await writeAudit(
      {
        userId: req.user.id, action: 'USER_CREATE', entityType: 'USER', entityId: id,
        details: { ad_soyad: body.ad_soyad, email: body.email, role: body.role, department_id: body.department_id ?? null },
      },
      client,
    );
    return getUser(id, client);
  });
  res.status(201).json(user);
});

// PATCH /api/users/:id
router.patch('/:id', validate({ params: idParam, body: updateSchema }), async (req, res) => {
  const { id } = req.valid.params;
  const body = req.valid.body;
  const isSelf = id === req.user.id;

  if (isSelf && (body.is_active === false || body.role === 'USER')) {
    throw conflict('CANNOT_MODIFY_SELF', 'Kendi hesabınızı pasife alamaz veya yönetici rolünüzü kaldıramazsınız');
  }
  if ('department_id' in body) await assertDepartmentExists(body.department_id);

  const updated = await withTransaction(async (client) => {
    const { rows } = await client.query(
      'SELECT id, ad_soyad, email, role, department_id, is_active FROM users WHERE id = $1 FOR UPDATE',
      [id],
    );
    const before = rows[0];
    if (!before) throw notFound('Kullanıcı bulunamadı');

    const losingAdmin = before.role === 'ADMIN' && before.is_active
      && (body.role === 'USER' || body.is_active === false);
    if (losingAdmin) await assertNotLastAdmin(client, id);

    if (body.is_active === false && before.is_active) {
      const { rows: act } = await client.query(
        'SELECT count(*) AS n FROM assignments WHERE user_id = $1 AND returned_at IS NULL',
        [id],
      );
      if (act[0].n > 0) {
        throw conflict('HAS_ACTIVE_ASSIGNMENTS', `Kullanıcının üzerinde ${act[0].n} aktif zimmet var; pasife almadan önce iade alın`);
      }
    }

    const changes = diff(before, body, ['ad_soyad', 'email', 'role', 'department_id', 'is_active']);
    if (Object.keys(changes).length === 0) return getUser(id, client);

    // Rol veya aktiflik değişirse kullanıcının açık oturumları geçersiz olur.
    const revokeSessions = 'role' in changes || ('is_active' in changes && body.is_active === false);
    const sets = [];
    const params = [];
    for (const field of Object.keys(changes)) {
      params.push(body[field]);
      sets.push(`${field} = $${params.length}`);
    }
    if (revokeSessions) sets.push('token_version = token_version + 1');
    sets.push('updated_at = now()');
    params.push(id);
    await client.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${params.length}`, params);

    let action = 'USER_UPDATE';
    if ('is_active' in changes) action = body.is_active ? 'USER_ACTIVATE' : 'USER_DEACTIVATE';
    await writeAudit(
      { userId: req.user.id, action, entityType: 'USER', entityId: id, details: { ad_soyad: before.ad_soyad, changes } },
      client,
    );
    return getUser(id, client);
  });
  res.json(updated);
});

// PATCH /api/users/:id/password — yönetici tarafından şifre sıfırlama.
// Verilen parola geçicidir: kullanıcının tüm oturumları kapanır ve ilk girişte yeni parola belirlemesi istenir.
router.patch('/:id/password', validate({ params: idParam, body: passwordSchema }), async (req, res) => {
  const { id } = req.valid.params;
  const hash = await bcrypt.hash(req.valid.body.password, config.bcryptRounds);
  await withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE users SET password_hash = $1, must_change_password = TRUE, token_version = token_version + 1, updated_at = now()
        WHERE id = $2 RETURNING ad_soyad`,
      [hash, id],
    );
    if (!rows[0]) throw notFound('Kullanıcı bulunamadı');
    // Kişinin bekleyen "şifremi unuttum" talebi varsa bu sıfırlamayla kapanır.
    await client.query(
      "UPDATE password_reset_requests SET status = 'RESOLVED', resolved_at = now(), resolved_by = $1 WHERE user_id = $2 AND status = 'PENDING'",
      [req.user.id, id],
    );
    await writeAudit(
      { userId: req.user.id, action: 'USER_PASSWORD_RESET', entityType: 'USER', entityId: id, details: { ad_soyad: rows[0].ad_soyad } },
      client,
    );
  });
  res.status(204).end();
});

// POST /api/users/:id/approve — kendi kaydolan kişinin hesabını açar (isteğe bağlı departman atanır).
router.post('/:id/approve', validate({ params: idParam, body: z.object({ department_id: optionalId }) }), async (req, res) => {
  const { id } = req.valid.params;
  const dep = req.valid.body.department_id ?? null;
  await assertDepartmentExists(dep);
  const user = await withTransaction(async (client) => {
    const { rows } = await client.query('SELECT id, ad_soyad, email, is_approved FROM users WHERE id = $1 FOR UPDATE', [id]);
    if (!rows[0]) throw notFound('Kullanıcı bulunamadı');
    if (rows[0].is_approved) throw conflict('ALREADY_APPROVED', 'Bu hesap zaten onaylanmış');
    await client.query(
      'UPDATE users SET is_approved = TRUE, department_id = COALESCE($2, department_id), updated_at = now() WHERE id = $1',
      [id, dep],
    );
    await writeAudit(
      { userId: req.user.id, action: 'USER_APPROVE', entityType: 'USER', entityId: id, details: { ad_soyad: rows[0].ad_soyad, email: rows[0].email, department_id: dep } },
      client,
    );
    return getUser(id, client);
  });
  res.json(user);
});

// POST /api/users/:id/reject — onay bekleyen kaydı reddeder ve siler (henüz hiçbir geçmişi yoktur).
router.post('/:id/reject', validate({ params: idParam }), async (req, res) => {
  const { id } = req.valid.params;
  await withTransaction(async (client) => {
    const { rows } = await client.query('SELECT id, ad_soyad, email, is_approved FROM users WHERE id = $1 FOR UPDATE', [id]);
    if (!rows[0]) throw notFound('Kullanıcı bulunamadı');
    if (rows[0].is_approved) throw conflict('ALREADY_APPROVED', 'Onaylanmış hesap reddedilemez; gerekiyorsa pasife alın');
    await client.query('DELETE FROM users WHERE id = $1', [id]);
    await writeAudit(
      { userId: req.user.id, action: 'USER_REJECT', entityType: 'USER', entityId: id, details: { ad_soyad: rows[0].ad_soyad, email: rows[0].email } },
      client,
    );
  });
  res.status(204).end();
});

// DELETE /api/users/:id — zimmet geçmişi olan kullanıcı silinemez, pasife alınır.
router.delete('/:id', validate({ params: idParam }), async (req, res) => {
  const { id } = req.valid.params;
  if (id === req.user.id) throw conflict('CANNOT_MODIFY_SELF', 'Kendi hesabınızı silemezsiniz');

  await withTransaction(async (client) => {
    const { rows } = await client.query(
      'SELECT id, ad_soyad, email, role, is_active FROM users WHERE id = $1 FOR UPDATE',
      [id],
    );
    const user = rows[0];
    if (!user) throw notFound('Kullanıcı bulunamadı');
    if (user.role === 'ADMIN' && user.is_active) await assertNotLastAdmin(client, id);

    const { rows: hist } = await client.query(
      'SELECT count(*) AS n FROM assignments WHERE user_id = $1 OR assigned_by = $1 OR returned_by = $1',
      [id],
    );
    if (hist[0].n > 0) {
      throw conflict('HAS_HISTORY', 'Bu kullanıcının zimmet geçmişi var; kayıtları korumak için silmek yerine pasife alın');
    }
    await client.query('DELETE FROM users WHERE id = $1', [id]);
    await writeAudit(
      { userId: req.user.id, action: 'USER_DELETE', entityType: 'USER', entityId: id, details: { ad_soyad: user.ad_soyad, email: user.email } },
      client,
    );
  });
  res.status(204).end();
});

export default router;
