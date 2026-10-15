import { config } from '../config.js';
import { query } from '../db.js';

/**
 * Cihaz + aktif zimmet bilgisini tek sorguda getiren ortak SELECT.
 * Aktif zimmet = returned_at IS NULL (partial unique index sayesinde en fazla bir tane).
 */
export const ASSET_SELECT = `
  SELECT a.id, a.asset_code, a.category, a.brand, a.model, a.serial_number,
         a.purchase_date, a.warranty_end_date, a.status, a.status_changed_at,
         a.is_active, a.notes, a.created_at, a.updated_at,
         act.id AS assignment_id, act.assigned_at, act.note AS assignment_note,
         au.id AS assignee_id, au.ad_soyad AS assignee_name, au.email AS assignee_email,
         ad.id AS assignee_department_id, ad.name AS assignee_department_name
    FROM assets a
    LEFT JOIN assignments act ON act.asset_id = a.id AND act.returned_at IS NULL
    LEFT JOIN users au ON au.id = act.user_id
    LEFT JOIN departments ad ON ad.id = au.department_id`;

export function qrTargetUrl(assetCode) {
  return `${config.appBaseUrl}/assets/code/${encodeURIComponent(assetCode)}`;
}

/** Düz SQL satırını API biçimine çevirir. includeInternal=false iken yönetici notları gizlenir. */
export function presentAsset(row, { includeInternal = true } = {}) {
  const asset = {
    id: row.id,
    asset_code: row.asset_code,
    category: row.category,
    brand: row.brand,
    model: row.model,
    serial_number: row.serial_number,
    purchase_date: row.purchase_date,
    warranty_end_date: row.warranty_end_date,
    status: row.status,
    status_changed_at: row.status_changed_at,
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
    qr_url: qrTargetUrl(row.asset_code),
    current_assignment: row.assignment_id
      ? {
          id: row.assignment_id,
          assigned_at: row.assigned_at,
          note: row.assignment_note,
          user: {
            id: row.assignee_id,
            ad_soyad: row.assignee_name,
            email: row.assignee_email,
            department: row.assignee_department_id
              ? { id: row.assignee_department_id, name: row.assignee_department_name }
              : null,
          },
        }
      : null,
  };
  if (includeInternal) asset.notes = row.notes;
  else if (asset.current_assignment) delete asset.current_assignment.note;
  return asset;
}

export async function findAsset(where, value, db = { query }) {
  const { rows } = await db.query(`${ASSET_SELECT} WHERE ${where} = $1`, [value]);
  return rows[0] || null;
}
