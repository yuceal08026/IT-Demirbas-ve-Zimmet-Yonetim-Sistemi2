import { Router } from 'express';
import QRCode from 'qrcode';
import { z } from 'zod';
import { query, withTransaction } from '../db.js';
import { todayInAppTimezone } from '../config.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import {
  validate, idParam, listQuery, trimmed, optionalText, isoDate, optionalId, boolFilter,
} from '../middleware/validate.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import { writeAudit, diff } from '../utils/audit.js';
import { Where, likePattern, paginated } from '../utils/sql.js';
import { ASSET_SELECT, findAsset, presentAsset, qrTargetUrl } from '../services/assets.js';
import { nextAssetCode } from '../services/assetCode.js';
import { ASSIGNMENT_SELECT, presentAssignment } from '../services/assignments.js';
import { auditListSchema, listAudit } from './auditLogs.js';

const router = Router();
router.use(authenticate);

const STATUSES = ['ACTIVE', 'DEFECTIVE', 'IN_STOCK'];

const SORT_COLUMNS = {
  asset_code: 'a.asset_code',
  brand: 'a.brand',
  model: 'a.model',
  category: 'a.category',
  status: 'a.status',
  purchase_date: 'a.purchase_date',
  warranty_end_date: 'a.warranty_end_date',
  created_at: 'a.created_at',
  assignee: 'au.ad_soyad',
};

const statusList = z
  .string()
  .optional()
  .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined))
  .refine((v) => !v || v.every((s) => STATUSES.includes(s)), { message: 'Durum ACTIVE, DEFECTIVE veya IN_STOCK olmalıdır' });

const listSchema = listQuery(Object.keys(SORT_COLUMNS), 'created_at', {
  status: statusList,
  category: z.string().trim().max(50).optional(),
  department_id: optionalId,
  user_id: optionalId,
  is_active: boolFilter,
});

// "Bugün" kurumun saat dilimine göre hesaplanır (UTC'ye göre değil): gece yarısından sonra girilen bugünkü alım tarihi reddedilmez.
const today = () => todayInAppTimezone();

// Seri numaraları karşılaştırmada büyük/küçük harf farkı yaratmasın diye büyük harfe çevrilir.
const serial = trimmed('Seri numarası', 2, 100)
  .transform((v) => v.toUpperCase())
  .refine((v) => /^[A-Z0-9\-_./ ]+$/.test(v), { message: 'Seri numarası yalnızca harf, rakam ve - _ . / içerebilir' });

const assetFields = {
  category: trimmed('Kategori', 2, 50),
  brand: trimmed('Marka', 1, 100),
  model: trimmed('Model', 1, 100),
  serial_number: serial,
  purchase_date: isoDate('Alım tarihi').refine((v) => v == null || v <= today(), { message: 'Alım tarihi gelecekte olamaz' }),
  warranty_end_date: isoDate('Garanti bitiş tarihi'),
  notes: optionalText('Not', 1000),
};

const warrantyRule = (v) => !v.purchase_date || !v.warranty_end_date || v.warranty_end_date >= v.purchase_date;
const warrantyMessage = { message: 'Garanti bitiş tarihi alım tarihinden önce olamaz', path: ['warranty_end_date'] };

// asset_code ve status bilinçli olarak şemada yok: istemciden gelse bile atılır.
const createSchema = z.object(assetFields).refine(warrantyRule, warrantyMessage);

const updateSchema = z
  .object({
    ...Object.fromEntries(Object.entries(assetFields).map(([k, s]) => [k, s.optional()])),
    is_active: z.boolean({ invalid_type_error: 'Aktiflik true/false olmalıdır' }).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Güncellenecek en az bir alan gönderin' });

const statusSchema = z.object({
  status: z.enum(['DEFECTIVE', 'IN_STOCK'], {
    errorMap: () => ({ message: 'Durum yalnızca DEFECTIVE veya IN_STOCK olarak değiştirilebilir; ACTIVE zimmet işlemiyle oluşur' }),
  }),
  note: optionalText('Not', 500),
});

const codeParam = z.object({ code: z.string().trim().min(1).max(32) });
const qrQuery = z.object({
  format: z.enum(['png', 'svg']).default('png'),
  download: z.enum(['0', '1']).optional(),
});

/**
 * Cihaz detayı / QR yetkisi: yönetici her cihazı görür; personel yalnızca
 * şu an kendisine zimmetli cihazı görür. Yetkisiz durumda 404 döner (cihazın varlığı sızdırılmaz).
 */
function canView(req, row) {
  if (!row) return false;
  if (req.user.role === 'ADMIN') return true;
  return row.assignee_id === req.user.id;
}

async function loadViewable(req, column, value) {
  const row = await findAsset(column, value);
  if (!canView(req, row)) throw notFound('Cihaz bulunamadı');
  return row;
}

const present = (req, row) => presentAsset(row, { includeInternal: req.user.role === 'ADMIN' });

// ---------- Okuma uçları ----------

// GET /api/assets — yalnızca yönetici
router.get('/', requireAdmin, validate({ query: listSchema }), async (req, res) => {
  const { page, limit, search, sort, order, status, category, department_id: dep, user_id: uid, is_active: active } = req.valid.query;
  const w = new Where();
  if (active !== 'all') w.add('a.is_active = ?', active !== 'false');
  if (status) w.add('a.status = ANY(?::asset_status[])', status);
  if (category) w.add('a.category = ?', category);
  if (uid) w.add('au.id = ?', uid);
  if (dep) w.add('au.department_id = ?', dep);
  if (search) {
    w.add(`((a.asset_code || ' ' || a.serial_number || ' ' || a.brand || ' ' || a.model) ILIKE ? OR au.ad_soyad ILIKE ?)`,
      likePattern(search), likePattern(search));
  }

  const base = `FROM assets a
    LEFT JOIN assignments act ON act.asset_id = a.id AND act.returned_at IS NULL
    LEFT JOIN users au ON au.id = act.user_id`;
  const { rows: countRows } = await query(`SELECT count(*) AS total ${base} ${w.sql()}`, w.params);

  const dir = order === 'asc' ? 'ASC' : 'DESC';
  const { rows } = await query(
    `${ASSET_SELECT} ${w.sql()}
     ORDER BY ${SORT_COLUMNS[sort]} ${dir} NULLS LAST, a.id ${dir}
     LIMIT ${w.param(limit)} OFFSET ${w.param((page - 1) * limit)}`,
    w.params,
  );
  res.json(paginated(rows.map((r) => presentAsset(r)), countRows[0].total, page, limit));
});

// GET /api/assets/categories — filtre ve form önerileri için
router.get('/categories', requireAdmin, async (req, res) => {
  const { rows } = await query('SELECT DISTINCT category FROM assets ORDER BY category');
  res.json({ data: rows.map((r) => r.category) });
});

// GET /api/assets/by-code/:code — QR okutma sonrası
router.get('/by-code/:code', validate({ params: codeParam }), async (req, res) => {
  const row = await loadViewable(req, 'a.asset_code', req.valid.params.code.toUpperCase());
  res.json(present(req, row));
});

// GET /api/assets/:id
router.get('/:id', validate({ params: idParam }), async (req, res) => {
  const row = await loadViewable(req, 'a.id', req.valid.params.id);
  res.json(present(req, row));
});

// GET /api/assets/:id/qr?format=png|svg
router.get('/:id/qr', validate({ params: idParam, query: qrQuery }), async (req, res) => {
  const row = await loadViewable(req, 'a.id', req.valid.params.id);
  const { format, download } = req.valid.query;
  const url = qrTargetUrl(row.asset_code);
  res.set('Cache-Control', 'private, max-age=3600');
  if (download === '1') res.attachment(`${row.asset_code}.${format}`);
  if (format === 'svg') {
    res.type('svg').send(await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }));
  } else {
    res.type('png').send(await QRCode.toBuffer(url, { type: 'png', width: 360, margin: 1, errorCorrectionLevel: 'M' }));
  }
});

// GET /api/assets/:id/assignments — cihazın tüm zimmet geçmişi (yeniden eskiye)
router.get('/:id/assignments', requireAdmin, validate({ params: idParam }), async (req, res) => {
  const { id } = req.valid.params;
  const { rowCount } = await query('SELECT 1 FROM assets WHERE id = $1', [id]);
  if (!rowCount) throw notFound('Cihaz bulunamadı');
  const { rows } = await query(`${ASSIGNMENT_SELECT} WHERE s.asset_id = $1 ORDER BY s.assigned_at DESC, s.id DESC LIMIT 500`, [id]);
  res.json({ data: rows.map(presentAssignment) });
});

// GET /api/assets/:id/history — cihaz zaman çizelgesi (ekleme, düzenleme, durum, zimmet, iade, bakım)
router.get('/:id/history', requireAdmin, validate({ params: idParam, query: auditListSchema }), async (req, res) => {
  const { id } = req.valid.params;
  const { rowCount } = await query('SELECT 1 FROM assets WHERE id = $1', [id]);
  if (!rowCount) throw notFound('Cihaz bulunamadı');
  res.json(await listAudit(req.valid.query, { entity_type: 'ASSET', entity_id: id }));
});

// ---------- Yazma uçları (yalnızca yönetici) ----------

// POST /api/assets — asset_code sunucuda üretilir, cihaz depoda (IN_STOCK) başlar.
router.post('/', requireAdmin, validate({ body: createSchema }), async (req, res) => {
  const b = req.valid.body;
  const asset = await withTransaction(async (client) => {
    const code = await nextAssetCode(client);
    const { rows } = await client.query(
      `INSERT INTO assets (asset_code, category, brand, model, serial_number, purchase_date, warranty_end_date, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [code, b.category, b.brand, b.model, b.serial_number, b.purchase_date ?? null, b.warranty_end_date ?? null, b.notes ?? null],
    );
    const id = rows[0].id;
    await writeAudit(
      {
        userId: req.user.id, action: 'ASSET_CREATE', entityType: 'ASSET', entityId: id,
        details: { asset_code: code, category: b.category, brand: b.brand, model: b.model, serial_number: b.serial_number },
      },
      client,
    );
    return findAsset('a.id', id, client);
  });
  res.status(201).json(presentAsset(asset));
});

// PATCH /api/assets/:id — bilgi güncelleme ve pasife alma/aktifleştirme
router.patch('/:id', requireAdmin, validate({ params: idParam, body: updateSchema }), async (req, res) => {
  const { id } = req.valid.params;
  const body = req.valid.body;

  const asset = await withTransaction(async (client) => {
    const { rows } = await client.query('SELECT * FROM assets WHERE id = $1 FOR UPDATE', [id]);
    const before = rows[0];
    if (!before) throw notFound('Cihaz bulunamadı');

    const merged = { ...before, ...body };
    if (merged.purchase_date && merged.warranty_end_date && merged.warranty_end_date < merged.purchase_date) {
      throw badRequest('Garanti bitiş tarihi alım tarihinden önce olamaz', [{ field: 'warranty_end_date', message: 'Garanti bitiş tarihi alım tarihinden önce olamaz' }]);
    }
    if (body.is_active === false && before.status === 'ACTIVE') {
      throw conflict('HAS_ACTIVE_ASSIGNMENTS', 'Zimmetli cihaz pasife alınamaz; önce iade alın');
    }

    const fields = ['category', 'brand', 'model', 'serial_number', 'purchase_date', 'warranty_end_date', 'notes', 'is_active'];
    const changes = diff(before, body, fields);
    if (Object.keys(changes).length === 0) return findAsset('a.id', id, client);

    const sets = [];
    const params = [];
    for (const field of Object.keys(changes)) {
      params.push(body[field] ?? null);
      sets.push(`${field} = $${params.length}`);
    }
    sets.push('updated_at = now()');
    params.push(id);
    await client.query(`UPDATE assets SET ${sets.join(', ')} WHERE id = $${params.length}`, params);

    let action = 'ASSET_UPDATE';
    if ('is_active' in changes && Object.keys(changes).length === 1) action = body.is_active ? 'ASSET_ACTIVATE' : 'ASSET_DEACTIVATE';
    await writeAudit(
      { userId: req.user.id, action, entityType: 'ASSET', entityId: id, details: { asset_code: before.asset_code, changes } },
      client,
    );
    return findAsset('a.id', id, client);
  });
  res.json(presentAsset(asset));
});

// PATCH /api/assets/:id/status — Arızalı ↔ Depoda (zimmetli cihazda yapılamaz)
router.patch('/:id/status', requireAdmin, validate({ params: idParam, body: statusSchema }), async (req, res) => {
  const { id } = req.valid.params;
  const { status, note } = req.valid.body;

  const asset = await withTransaction(async (client) => {
    const { rows } = await client.query('SELECT id, asset_code, status FROM assets WHERE id = $1 FOR UPDATE', [id]);
    const before = rows[0];
    if (!before) throw notFound('Cihaz bulunamadı');
    if (before.status === 'ACTIVE') {
      throw conflict('HAS_ACTIVE_ASSIGNMENTS', 'Cihaz bir personele zimmetli; durumunu değiştirmek için önce iade alın');
    }
    if (before.status !== status) {
      await client.query('UPDATE assets SET status = $1, status_changed_at = now(), updated_at = now() WHERE id = $2', [status, id]);
      await writeAudit(
        {
          userId: req.user.id, action: 'ASSET_STATUS_CHANGE', entityType: 'ASSET', entityId: id,
          details: { asset_code: before.asset_code, changes: { status: { from: before.status, to: status } }, note: note ?? null },
        },
        client,
      );
    }
    return findAsset('a.id', id, client);
  });
  res.json(presentAsset(asset));
});

// DELETE /api/assets/:id — zimmet geçmişi olan cihaz silinemez, pasife alınır.
router.delete('/:id', requireAdmin, validate({ params: idParam }), async (req, res) => {
  const { id } = req.valid.params;
  await withTransaction(async (client) => {
    const { rows } = await client.query('SELECT id, asset_code, brand, model, serial_number FROM assets WHERE id = $1 FOR UPDATE', [id]);
    const asset = rows[0];
    if (!asset) throw notFound('Cihaz bulunamadı');
    const { rows: hist } = await client.query('SELECT count(*) AS n FROM assignments WHERE asset_id = $1', [id]);
    if (hist[0].n > 0) {
      throw conflict('HAS_HISTORY', 'Bu cihazın zimmet geçmişi var; kayıtları korumak için silmek yerine pasife alın');
    }
    await client.query('DELETE FROM assets WHERE id = $1', [id]);
    await writeAudit(
      { userId: req.user.id, action: 'ASSET_DELETE', entityType: 'ASSET', entityId: id, details: { ...asset } },
      client,
    );
  });
  res.status(204).end();
});

export default router;
