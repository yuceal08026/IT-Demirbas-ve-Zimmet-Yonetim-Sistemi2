import { conflict, notFound, badRequest } from '../utils/errors.js';
import { writeAudit } from '../utils/audit.js';

/** Zimmet satırlarını cihaz/personel/işlemi yapan bilgileriyle getiren ortak SELECT. */
export const ASSIGNMENT_SELECT = `
  SELECT s.id, s.assigned_at, s.returned_at, s.note, s.return_note,
         a.id AS asset_id, a.asset_code, a.brand, a.model, a.category, a.serial_number, a.status AS asset_status,
         u.id AS user_id, u.ad_soyad AS user_name, u.email AS user_email,
         d.id AS department_id, d.name AS department_name,
         ab.id AS assigned_by_id, ab.ad_soyad AS assigned_by_name,
         rb.id AS returned_by_id, rb.ad_soyad AS returned_by_name
    FROM assignments s
    JOIN assets a ON a.id = s.asset_id
    JOIN users u ON u.id = s.user_id
    LEFT JOIN departments d ON d.id = u.department_id
    JOIN users ab ON ab.id = s.assigned_by
    LEFT JOIN users rb ON rb.id = s.returned_by`;

export function presentAssignment(r) {
  return {
    id: r.id,
    assigned_at: r.assigned_at,
    returned_at: r.returned_at,
    is_active: r.returned_at === null,
    note: r.note,
    return_note: r.return_note,
    asset: {
      id: r.asset_id, asset_code: r.asset_code, brand: r.brand, model: r.model,
      category: r.category, serial_number: r.serial_number, status: r.asset_status,
    },
    user: {
      id: r.user_id, ad_soyad: r.user_name, email: r.user_email,
      department: r.department_id ? { id: r.department_id, name: r.department_name } : null,
    },
    assigned_by: { id: r.assigned_by_id, ad_soyad: r.assigned_by_name },
    returned_by: r.returned_by_id ? { id: r.returned_by_id, ad_soyad: r.returned_by_name } : null,
  };
}

/**
 * Cihazı personele zimmetler (transaction içinde çağrılır).
 * Çakışan zimmet üç katmanda engellenir:
 *  1) cihaz satırı FOR UPDATE ile kilitlenir → aynı cihaza eşzamanlı istekler sıraya girer,
 *  2) cihaz IN_STOCK değilse reddedilir,
 *  3) yine de bir yarış olursa partial unique index (ux_assignments_active_asset) ikinci kaydı reddeder.
 */
export async function assignAsset(client, { assetId, userId, note, actorId }) {
  const { rows: assets } = await client.query(
    'SELECT id, asset_code, status, is_active FROM assets WHERE id = $1 FOR UPDATE',
    [assetId],
  );
  const asset = assets[0];
  if (!asset) throw notFound('Cihaz bulunamadı');
  if (asset.status === 'ACTIVE') {
    throw conflict('ASSET_ALREADY_ASSIGNED', 'Bu cihaz zaten bir personele zimmetli; önce iade alınmalı');
  }
  if (!asset.is_active || asset.status !== 'IN_STOCK') {
    const reason = !asset.is_active ? 'pasife alınmış' : 'arızalı';
    throw conflict('ASSET_NOT_AVAILABLE', `Cihaz ${reason} olduğu için zimmetlenemez; yalnızca depodaki cihazlar zimmetlenebilir`);
  }

  // FOR SHARE: zimmet sürerken kullanıcının eşzamanlı olarak pasife alınmasını engeller.
  const { rows: users } = await client.query(
    'SELECT id, ad_soyad, is_active, is_approved FROM users WHERE id = $1 FOR SHARE',
    [userId],
  );
  const user = users[0];
  if (!user) throw badRequest('Seçilen personel bulunamadı', [{ field: 'user_id', message: 'Seçilen personel bulunamadı' }]);
  if (!user.is_active) throw conflict('USER_INACTIVE', 'Pasif kullanıcıya zimmet yapılamaz');
  if (!user.is_approved) throw conflict('USER_NOT_APPROVED', 'Kaydı henüz onaylanmamış kişiye zimmet yapılamaz');

  const { rows } = await client.query(
    `INSERT INTO assignments (asset_id, user_id, assigned_by, note) VALUES ($1, $2, $3, $4) RETURNING id`,
    [assetId, userId, actorId, note ?? null],
  );
  await client.query(
    `UPDATE assets SET status = 'ACTIVE', status_changed_at = now(), updated_at = now() WHERE id = $1`,
    [assetId],
  );
  await writeAudit(
    {
      userId: actorId, action: 'ASSIGN', entityType: 'ASSET', entityId: assetId,
      details: { assignment_id: rows[0].id, asset_code: asset.asset_code, user_id: user.id, user_name: user.ad_soyad, note: note ?? null },
    },
    client,
  );
  return rows[0].id;
}

/** İade: returned_at doldurulur, cihaz IN_STOCK (veya arızalı teslimde DEFECTIVE) olur. */
export async function returnAssignment(client, { assignmentId, condition = 'IN_STOCK', returnNote, actorId }) {
  const { rows } = await client.query(
    `SELECT s.id, s.asset_id, s.returned_at, u.id AS user_id, u.ad_soyad AS user_name
       FROM assignments s JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 FOR UPDATE OF s`,
    [assignmentId],
  );
  const row = rows[0];
  if (!row) throw notFound('Zimmet kaydı bulunamadı');
  if (row.returned_at) throw conflict('ASSIGNMENT_ALREADY_RETURNED', 'Bu zimmet zaten iade alınmış');

  const { rows: assets } = await client.query('SELECT asset_code FROM assets WHERE id = $1 FOR UPDATE', [row.asset_id]);
  await client.query(
    `UPDATE assignments SET returned_at = now(), returned_by = $1, return_note = $2 WHERE id = $3`,
    [actorId, returnNote ?? null, assignmentId],
  );
  await client.query(
    `UPDATE assets SET status = $1, status_changed_at = now(), updated_at = now() WHERE id = $2`,
    [condition, row.asset_id],
  );
  await writeAudit(
    {
      userId: actorId, action: 'RETURN', entityType: 'ASSET', entityId: row.asset_id,
      details: {
        assignment_id: assignmentId, asset_code: assets[0].asset_code, user_id: row.user_id, user_name: row.user_name,
        condition, return_note: returnNote ?? null,
      },
    },
    client,
  );
  return row.asset_id;
}
