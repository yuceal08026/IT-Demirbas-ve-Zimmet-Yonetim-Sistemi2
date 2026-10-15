import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { validate, idParam, trimmed, optionalText } from '../middleware/validate.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import { writeAudit } from '../utils/audit.js';

/**
 * Arıza ve bakım takibi (PRD §4.2).
 * - Bir cihazın birden fazla arıza kaydı olabilir; geçmiş kayıtlar saklanır.
 * - Kayıt açılınca depodaki cihaz "Arızalı" olur (zimmetli cihaz personelde kalır, durumu değişmez).
 * - Çözülen kayıt kapanır (solution_note zorunlu) ve artık değiştirilemez.
 * - Açık kaydı kalmayan arızalı cihaz istenirse depoya alınır.
 * Tüm işlemler cihazın zaman çizelgesine (audit log, entity ASSET) yazılır.
 */

const SELECT = `
  SELECT m.id, m.asset_id, m.issue_description, m.status, m.solution_note, m.created_at, m.updated_at, m.closed_at,
         rb.id AS reported_by_id, rb.ad_soyad AS reported_by_name,
         cb.id AS closed_by_id, cb.ad_soyad AS closed_by_name,
         a.asset_code, a.brand, a.model
    FROM maintenance_records m
    JOIN assets a ON a.id = m.asset_id
    LEFT JOIN users rb ON rb.id = m.reported_by
    LEFT JOIN users cb ON cb.id = m.closed_by`;

const present = (r) => ({
  id: r.id,
  asset: { id: r.asset_id, asset_code: r.asset_code, brand: r.brand, model: r.model },
  issue_description: r.issue_description,
  status: r.status,
  solution_note: r.solution_note,
  created_at: r.created_at,
  updated_at: r.updated_at,
  closed_at: r.closed_at,
  reported_by: r.reported_by_id ? { id: r.reported_by_id, ad_soyad: r.reported_by_name } : null,
  closed_by: r.closed_by_id ? { id: r.closed_by_id, ad_soyad: r.closed_by_name } : null,
});

const createSchema = z.object({
  issue_description: trimmed('Arıza açıklaması', 5, 2000),
  mark_defective: z.boolean().default(true),
});

const updateSchema = z
  .object({
    status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED'], { errorMap: () => ({ message: 'Durum OPEN, IN_PROGRESS veya RESOLVED olmalıdır' }) }).optional(),
    solution_note: optionalText('Çözüm notu', 2000),
    return_to_stock: z.boolean().default(false),
  })
  .refine((v) => v.status || v.solution_note !== undefined, { message: 'Durum veya çözüm notu gönderin' });

// /api/assets/:id/maintenance — cihaz bazında
export const assetMaintenanceRouter = Router({ mergeParams: true });
assetMaintenanceRouter.use(authenticate, requireAdmin);

assetMaintenanceRouter.get('/:id/maintenance', validate({ params: idParam }), async (req, res) => {
  const { id } = req.valid.params;
  const { rowCount } = await query('SELECT 1 FROM assets WHERE id = $1', [id]);
  if (!rowCount) throw notFound('Cihaz bulunamadı');
  const { rows } = await query(`${SELECT} WHERE m.asset_id = $1 ORDER BY m.created_at DESC, m.id DESC`, [id]);
  res.json({ data: rows.map(present) });
});

assetMaintenanceRouter.post('/:id/maintenance', validate({ params: idParam, body: createSchema }), async (req, res) => {
  const { id } = req.valid.params;
  const { issue_description: issue, mark_defective: markDefective } = req.valid.body;
  const record = await withTransaction(async (client) => {
    const { rows } = await client.query('SELECT id, asset_code, status, is_active FROM assets WHERE id = $1 FOR UPDATE', [id]);
    const asset = rows[0];
    if (!asset) throw notFound('Cihaz bulunamadı');
    if (!asset.is_active) throw conflict('ASSET_NOT_AVAILABLE', 'Pasife alınmış cihaz için arıza kaydı açılamaz');

    const { rows: ins } = await client.query(
      'INSERT INTO maintenance_records (asset_id, reported_by, issue_description) VALUES ($1, $2, $3) RETURNING id',
      [id, req.user.id, issue],
    );
    let statusChanged = false;
    if (markDefective && asset.status === 'IN_STOCK') {
      await client.query(`UPDATE assets SET status = 'DEFECTIVE', status_changed_at = now(), updated_at = now() WHERE id = $1`, [id]);
      statusChanged = true;
    }
    await writeAudit(
      {
        userId: req.user.id, action: 'MAINTENANCE_OPEN', entityType: 'ASSET', entityId: id,
        details: {
          maintenance_id: ins[0].id, asset_code: asset.asset_code, issue_description: issue,
          ...(statusChanged ? { changes: { status: { from: 'IN_STOCK', to: 'DEFECTIVE' } } } : {}),
        },
      },
      client,
    );
    return (await client.query(`${SELECT} WHERE m.id = $1`, [ins[0].id])).rows[0];
  });
  res.status(201).json(present(record));
});

// /api/maintenance — kayıt bazında
const router = Router();
router.use(authenticate, requireAdmin);

router.get('/', validate({ query: z.object({ status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'open']).optional() }) }), async (req, res) => {
  const { status } = req.valid.query;
  let where = '';
  const params = [];
  if (status === 'open') where = "WHERE m.status <> 'RESOLVED'";
  else if (status) { where = 'WHERE m.status = $1'; params.push(status); }
  const { rows } = await query(`${SELECT} ${where} ORDER BY m.created_at DESC LIMIT 500`, params);
  res.json({ data: rows.map(present) });
});

router.patch('/:id', validate({ params: idParam, body: updateSchema }), async (req, res) => {
  const { id } = req.valid.params;
  const body = req.valid.body;
  const record = await withTransaction(async (client) => {
    const { rows } = await client.query('SELECT * FROM maintenance_records WHERE id = $1 FOR UPDATE', [id]);
    const before = rows[0];
    if (!before) throw notFound('Arıza kaydı bulunamadı');
    if (before.status === 'RESOLVED') throw conflict('MAINTENANCE_CLOSED', 'Çözülmüş arıza kaydı değiştirilemez; yeni bir kayıt açın');

    const status = body.status ?? before.status;
    const solution = body.solution_note !== undefined ? body.solution_note : before.solution_note;
    if (status === 'RESOLVED' && !solution) {
      throw badRequest('Arızayı kapatmak için çözüm notu yazın', [{ field: 'solution_note', message: 'Çözüm notu zorunludur' }]);
    }
    const resolving = status === 'RESOLVED';
    await client.query(
      `UPDATE maintenance_records
          SET status = $1, solution_note = $2, updated_at = now(),
              closed_at = CASE WHEN $3::boolean THEN now() ELSE NULL END,
              closed_by = CASE WHEN $3::boolean THEN $4::int ELSE NULL END
        WHERE id = $5`,
      [status, solution, resolving, req.user.id, id],
    );

    const { rows: assetRows } = await client.query('SELECT id, asset_code, status FROM assets WHERE id = $1 FOR UPDATE', [before.asset_id]);
    const asset = assetRows[0];
    let restocked = false;
    if (resolving && body.return_to_stock && asset.status === 'DEFECTIVE') {
      const { rows: open } = await client.query(
        "SELECT count(*) AS n FROM maintenance_records WHERE asset_id = $1 AND status <> 'RESOLVED'",
        [asset.id],
      );
      if (open[0].n === 0) {
        await client.query(`UPDATE assets SET status = 'IN_STOCK', status_changed_at = now(), updated_at = now() WHERE id = $1`, [asset.id]);
        restocked = true;
      }
    }

    await writeAudit(
      {
        userId: req.user.id, action: resolving ? 'MAINTENANCE_RESOLVE' : 'MAINTENANCE_UPDATE', entityType: 'ASSET', entityId: asset.id,
        details: {
          maintenance_id: id, asset_code: asset.asset_code, status, solution_note: solution ?? null,
          ...(restocked ? { changes: { status: { from: 'DEFECTIVE', to: 'IN_STOCK' } } } : {}),
        },
      },
      client,
    );
    return (await client.query(`${SELECT} WHERE m.id = $1`, [id])).rows[0];
  });
  res.json(present(record));
});

export default router;
