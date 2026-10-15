import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { config } from '../config.js';
import { query, withTransaction } from '../db.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { validate, idParam, password } from '../middleware/validate.js';
import { conflict, notFound } from '../utils/errors.js';
import { writeAudit } from '../utils/audit.js';

/**
 * "Şifremi unuttum" talepleri — yalnızca yönetici.
 * Yönetici talebi geçici parola vererek kapatır (kişi ilk girişte kendi parolasını belirler) veya reddeder.
 */
const router = Router();
router.use(authenticate, requireAdmin);

const SELECT = `
  SELECT r.id, r.status, r.created_at, r.resolved_at,
         u.id AS user_id, u.ad_soyad, u.email, u.is_active, u.role, d.name AS department_name,
         rb.ad_soyad AS resolved_by_name
    FROM password_reset_requests r
    JOIN users u ON u.id = r.user_id
    LEFT JOIN departments d ON d.id = u.department_id
    LEFT JOIN users rb ON rb.id = r.resolved_by`;

const present = (r) => ({
  id: r.id,
  status: r.status,
  created_at: r.created_at,
  resolved_at: r.resolved_at,
  resolved_by: r.resolved_by_name ? { ad_soyad: r.resolved_by_name } : null,
  user: { id: r.user_id, ad_soyad: r.ad_soyad, email: r.email, is_active: r.is_active, role: r.role, department_name: r.department_name },
});

const listSchema = z.object({ status: z.enum(['PENDING', 'RESOLVED', 'REJECTED', 'all']).default('PENDING') });

// GET /api/password-reset-requests?status=PENDING
router.get('/', validate({ query: listSchema }), async (req, res) => {
  const { status } = req.valid.query;
  const where = status === 'all' ? '' : 'WHERE r.status = $1';
  const { rows } = await query(`${SELECT} ${where} ORDER BY r.created_at DESC LIMIT 200`, status === 'all' ? [] : [status]);
  res.set('Cache-Control', 'no-store');
  res.json({ data: rows.map(present) });
});

async function lockPending(client, id) {
  const { rows } = await client.query('SELECT id, user_id, status FROM password_reset_requests WHERE id = $1 FOR UPDATE', [id]);
  if (!rows[0]) throw notFound('Talep bulunamadı');
  if (rows[0].status !== 'PENDING') throw conflict('REQUEST_CLOSED', 'Bu talep zaten sonuçlandırılmış');
  return rows[0];
}

// POST /api/password-reset-requests/:id/resolve — geçici parola verir ve talebi kapatır.
router.post('/:id/resolve', validate({ params: idParam, body: z.object({ password }) }), async (req, res) => {
  const { id } = req.valid.params;
  const hash = await bcrypt.hash(req.valid.body.password, config.bcryptRounds);
  await withTransaction(async (client) => {
    const reqRow = await lockPending(client, id);
    const { rows } = await client.query(
      `UPDATE users SET password_hash = $1, must_change_password = TRUE, token_version = token_version + 1, updated_at = now()
        WHERE id = $2 RETURNING ad_soyad, email, is_active`,
      [hash, reqRow.user_id],
    );
    if (!rows[0].is_active) throw conflict('USER_INACTIVE', 'Kullanıcı pasif; önce hesabı aktifleştirin');
    await client.query(
      "UPDATE password_reset_requests SET status = 'RESOLVED', resolved_at = now(), resolved_by = $1 WHERE id = $2",
      [req.user.id, id],
    );
    await writeAudit({
      userId: req.user.id, action: 'USER_PASSWORD_RESET', entityType: 'USER', entityId: reqRow.user_id,
      details: { ad_soyad: rows[0].ad_soyad, email: rows[0].email, via: 'reset-request', request_id: id },
    }, client);
  });
  res.status(204).end();
});

// POST /api/password-reset-requests/:id/reject — talebi reddeder (ör. kişi talep etmediğini söyledi).
router.post('/:id/reject', validate({ params: idParam }), async (req, res) => {
  const { id } = req.valid.params;
  await withTransaction(async (client) => {
    const reqRow = await lockPending(client, id);
    await client.query(
      "UPDATE password_reset_requests SET status = 'REJECTED', resolved_at = now(), resolved_by = $1 WHERE id = $2",
      [req.user.id, id],
    );
    await writeAudit({
      userId: req.user.id, action: 'PASSWORD_RESET_REJECT', entityType: 'USER', entityId: reqRow.user_id,
      details: { request_id: id },
    }, client);
  });
  res.status(204).end();
});

export default router;
