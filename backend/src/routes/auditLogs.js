import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { validate, listQuery, optionalId, isoDate, dateRangeRule } from '../middleware/validate.js';
import { Where, likePattern, paginated } from '../utils/sql.js';

/**
 * İşlem geçmişi — yalnızca okuma. Bu tabloya güncelleme/silme ucu yoktur;
 * veritabanındaki trigger da UPDATE/DELETE'i reddeder.
 */

const AUDIT_SELECT = `
  SELECT l.id, l.action_type, l.entity_type, l.entity_id, l."timestamp", l.details,
         actor.id AS actor_id, actor.ad_soyad AS actor_name,
         COALESCE(ea.asset_code, eu.ad_soyad, ed.name,
                  l.details->>'asset_code', l.details->>'ad_soyad', l.details->>'name', l.details->>'email') AS entity_label
    FROM audit_logs l
    LEFT JOIN users actor ON actor.id = l.user_id
    LEFT JOIN assets ea ON l.entity_type = 'ASSET' AND ea.id = l.entity_id
    LEFT JOIN users eu ON l.entity_type = 'USER' AND eu.id = l.entity_id
    LEFT JOIN departments ed ON l.entity_type = 'DEPARTMENT' AND ed.id = l.entity_id`;

export function presentAudit(r) {
  return {
    id: r.id,
    action_type: r.action_type,
    entity_type: r.entity_type,
    entity_id: r.entity_id,
    entity_label: r.entity_label,
    timestamp: r.timestamp,
    details: r.details,
    actor: r.actor_id ? { id: r.actor_id, ad_soyad: r.actor_name } : null,
  };
}

export async function listAudit(q, fixed = {}) {
  const w = new Where();
  const entityType = fixed.entity_type ?? q.entity_type;
  const entityId = fixed.entity_id ?? q.entity_id;
  if (entityType) w.add('l.entity_type = ?', entityType);
  if (entityId) w.add('l.entity_id = ?', entityId);
  if (q.user_id) w.add('l.user_id = ?', q.user_id);
  if (q.action_type) w.add('l.action_type = ?', q.action_type);
  if (q.from) w.add('l."timestamp" >= ?::date', q.from);
  if (q.to) w.add(`l."timestamp" < (?::date + interval '1 day')`, q.to);
  if (q.search) {
    const like = likePattern(q.search);
    w.add(`(actor.ad_soyad ILIKE ? OR l.details::text ILIKE ? OR ea.asset_code ILIKE ? OR eu.ad_soyad ILIKE ?)`, like, like, like, like);
  }
  const fromSql = AUDIT_SELECT.slice(AUDIT_SELECT.indexOf('FROM'));
  const { rows: countRows } = await query(`SELECT count(*) AS total ${fromSql} ${w.sql()}`, w.params);
  const dir = q.order === 'asc' ? 'ASC' : 'DESC';
  const { rows } = await query(
    `${AUDIT_SELECT} ${w.sql()} ORDER BY l."timestamp" ${dir}, l.id ${dir}
     LIMIT ${w.param(q.limit)} OFFSET ${w.param((q.page - 1) * q.limit)}`,
    w.params,
  );
  return paginated(rows.map(presentAudit), countRows[0].total, q.page, q.limit);
}

export const auditListSchema = listQuery(['timestamp'], 'timestamp', {
  limit: z.coerce.number().int().min(1).max(200).default(50),
  entity_type: z.enum(['USER', 'ASSET', 'ASSIGNMENT', 'DEPARTMENT']).optional(),
  entity_id: optionalId,
  user_id: optionalId,
  action_type: z.string().trim().regex(/^[A-Z_]{2,50}$/, 'Geçersiz işlem tipi').optional(),
  from: isoDate('Başlangıç tarihi'),
  to: isoDate('Bitiş tarihi'),
}).refine(...dateRangeRule);

const router = Router();
router.use(authenticate, requireAdmin);

// GET /api/audit-logs
router.get('/', validate({ query: auditListSchema }), async (req, res) => {
  res.json(await listAudit(req.valid.query));
});

// GET /api/audit-logs/actions — filtre seçenekleri için kayıtlı işlem tipleri
router.get('/actions', async (req, res) => {
  const { rows } = await query('SELECT DISTINCT action_type FROM audit_logs ORDER BY action_type');
  res.json({ data: rows.map((r) => r.action_type) });
});

export default router;
