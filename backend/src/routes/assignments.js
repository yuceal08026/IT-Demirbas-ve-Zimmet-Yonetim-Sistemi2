import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { validate, idParam, listQuery, optionalText, optionalId, isoDate, dateRangeRule } from '../middleware/validate.js';
import { Where, likePattern, paginated } from '../utils/sql.js';
import { ASSIGNMENT_SELECT, assignAsset, presentAssignment, returnAssignment } from '../services/assignments.js';

const SORT_COLUMNS = { assigned_at: 's.assigned_at', returned_at: 's.returned_at', user: 'u.ad_soyad', asset_code: 'a.asset_code' };

export const assignmentListSchema = listQuery(Object.keys(SORT_COLUMNS), 'assigned_at', {
  active: z.enum(['true', 'false', 'all']).optional(),
  user_id: optionalId,
  asset_id: optionalId,
  department_id: optionalId,
  from: isoDate('Başlangıç tarihi'),
  to: isoDate('Bitiş tarihi'),
}).refine(...dateRangeRule);

/** Zimmet listesini filtreleyip sayfalar. forceUserId verilirse sorgu o kullanıcıya sabitlenir (IDOR koruması). */
export async function listAssignments(q, { forceUserId, defaultActive = 'all' } = {}) {
  const w = new Where();
  const active = q.active || defaultActive;
  if (active === 'true') w.add('s.returned_at IS NULL');
  if (active === 'false') w.add('s.returned_at IS NOT NULL');
  const userId = forceUserId ?? q.user_id;
  if (userId) w.add('s.user_id = ?', userId);
  if (q.asset_id) w.add('s.asset_id = ?', q.asset_id);
  if (q.department_id) w.add('u.department_id = ?', q.department_id);
  if (q.from) w.add('s.assigned_at >= ?::date', q.from);
  if (q.to) w.add("s.assigned_at < (?::date + interval '1 day')", q.to);
  if (q.search) {
    const like = likePattern(q.search);
    w.add('(a.asset_code ILIKE ? OR a.serial_number ILIKE ? OR u.ad_soyad ILIKE ? OR a.brand ILIKE ? OR a.model ILIKE ?)', like, like, like, like, like);
  }

  const from = `FROM assignments s JOIN assets a ON a.id = s.asset_id JOIN users u ON u.id = s.user_id`;
  const { rows: countRows } = await query(`SELECT count(*) AS total ${from} ${w.sql()}`, w.params);
  const dir = q.order === 'asc' ? 'ASC' : 'DESC';
  const { rows } = await query(
    `${ASSIGNMENT_SELECT} ${w.sql()}
     ORDER BY ${SORT_COLUMNS[q.sort]} ${dir} NULLS ${dir === 'DESC' ? 'FIRST' : 'LAST'}, s.id ${dir}
     LIMIT ${w.param(q.limit)} OFFSET ${w.param((q.page - 1) * q.limit)}`,
    w.params,
  );
  return paginated(rows.map(presentAssignment), countRows[0].total, q.page, q.limit);
}

async function getAssignment(id, db = { query }) {
  const { rows } = await db.query(`${ASSIGNMENT_SELECT} WHERE s.id = $1`, [id]);
  return rows[0] ? presentAssignment(rows[0]) : null;
}

const router = Router();
router.use(authenticate, requireAdmin);

const assignSchema = z.object({
  asset_id: z.coerce.number({ invalid_type_error: 'Cihaz seçin' }).int().positive('Cihaz seçin'),
  user_id: z.coerce.number({ invalid_type_error: 'Personel seçin' }).int().positive('Personel seçin'),
  note: optionalText('Not', 500),
});

const returnSchema = z.object({
  condition: z.enum(['IN_STOCK', 'DEFECTIVE'], { errorMap: () => ({ message: 'İade durumu IN_STOCK veya DEFECTIVE olmalıdır' }) }).default('IN_STOCK'),
  return_note: optionalText('İade notu', 500),
});

// GET /api/assignments
router.get('/', validate({ query: assignmentListSchema }), async (req, res) => {
  res.json(await listAssignments(req.valid.query));
});

// POST /api/assignments — zimmet teslim
router.post('/', validate({ body: assignSchema }), async (req, res) => {
  const { asset_id: assetId, user_id: userId, note } = req.valid.body;
  const assignment = await withTransaction(async (client) => {
    const id = await assignAsset(client, { assetId, userId, note, actorId: req.user.id });
    return getAssignment(id, client);
  });
  res.status(201).json(assignment);
});

// POST /api/assignments/:id/return — iade
router.post('/:id/return', validate({ params: idParam, body: returnSchema }), async (req, res) => {
  const { id } = req.valid.params;
  const { condition, return_note: returnNote } = req.valid.body;
  const assignment = await withTransaction(async (client) => {
    await returnAssignment(client, { assignmentId: id, condition, returnNote, actorId: req.user.id });
    return getAssignment(id, client);
  });
  res.json(assignment);
});

export default router;
