import { query } from '../db.js';

/**
 * Akıllı demirbaş kontrol merkezi (PRD §4.2).
 * Uyarıların tamamı her istekte veritabanındaki güncel kayıtlardan hesaplanır; sabit/sahte veri yoktur.
 * Eşikler ortam değişkenleriyle ayarlanabilir.
 */
export const thresholds = {
  warrantyDays: Number(process.env.ALERT_WARRANTY_DAYS || 60),
  idleDays: Number(process.env.ALERT_IDLE_DAYS || 90),
  defectiveDays: Number(process.env.ALERT_DEFECTIVE_DAYS || 30),
};

export const ALERT_TYPES = {
  INCONSISTENT_STATUS: { severity: 'critical', title: 'Çelişkili kayıt' },
  WARRANTY_EXPIRING: { severity: 'warning', title: 'Garanti bitmek üzere' },
  LONG_DEFECTIVE: { severity: 'warning', title: 'Uzun süredir arızalı' },
  LONG_IN_STOCK: { severity: 'info', title: 'Uzun süredir depoda' },
  WARRANTY_EXPIRED_IN_USE: { severity: 'info', title: 'Garantisi bitmiş, kullanımda' },
  MISSING_INFO: { severity: 'info', title: 'Eksik bilgi' },
};

// Her kural: aynı sütunları döndüren bir SELECT. $1 = garanti günü, $2 = depoda gün, $3 = arızalı gün.
const RULES = `
  WITH act AS (
    SELECT s.asset_id, s.id AS assignment_id, s.assigned_at, u.id AS user_id, u.ad_soyad AS user_name, u.is_active AS user_active
      FROM assignments s JOIN users u ON u.id = s.user_id
     WHERE s.returned_at IS NULL
  ),
  base AS (
    SELECT a.*, act.assignment_id, act.user_id, act.user_name, act.user_active
      FROM assets a LEFT JOIN act ON act.asset_id = a.id
  )
  SELECT 'INCONSISTENT_STATUS' AS type, b.*, 'Durumu "Zimmetli" ama aktif zimmet kaydı yok' AS reason, NULL::int AS days
    FROM base b WHERE b.status = 'ACTIVE' AND b.assignment_id IS NULL
  UNION ALL
  SELECT 'INCONSISTENT_STATUS', b.*, 'Aktif zimmet kaydı var ama durumu "' ||
         CASE b.status WHEN 'IN_STOCK' THEN 'Depoda' ELSE 'Arızalı' END || '"', NULL
    FROM base b WHERE b.assignment_id IS NOT NULL AND b.status <> 'ACTIVE'
  UNION ALL
  SELECT 'INCONSISTENT_STATUS', b.*, 'Pasif kullanıcı (' || b.user_name || ') üzerinde aktif zimmet', NULL
    FROM base b WHERE b.assignment_id IS NOT NULL AND NOT b.user_active
  UNION ALL
  SELECT 'INCONSISTENT_STATUS', b.*, 'Pasife alınmış cihaz hâlâ zimmetli görünüyor', NULL
    FROM base b WHERE b.assignment_id IS NOT NULL AND NOT b.is_active
  UNION ALL
  SELECT 'WARRANTY_EXPIRING', b.*, 'Garanti ' || (b.warranty_end_date - current_date) || ' gün içinde bitiyor',
         (b.warranty_end_date - current_date)
    FROM base b WHERE b.is_active AND b.warranty_end_date BETWEEN current_date AND current_date + $1::int
  UNION ALL
  SELECT 'WARRANTY_EXPIRED_IN_USE', b.*, 'Garantisi ' || (current_date - b.warranty_end_date) || ' gün önce bitti; ' || b.user_name || ' kullanıyor',
         (current_date - b.warranty_end_date)
    FROM base b WHERE b.is_active AND b.status = 'ACTIVE' AND b.warranty_end_date < current_date
  UNION ALL
  SELECT 'LONG_IN_STOCK', b.*, (current_date - b.status_changed_at::date) || ' gündür depoda bekliyor',
         (current_date - b.status_changed_at::date)
    FROM base b WHERE b.is_active AND b.status = 'IN_STOCK' AND b.status_changed_at < now() - make_interval(days => $2::int)
  UNION ALL
  SELECT 'LONG_DEFECTIVE', b.*, (current_date - b.status_changed_at::date) || ' gündür arızalı',
         (current_date - b.status_changed_at::date)
    FROM base b WHERE b.is_active AND b.status = 'DEFECTIVE' AND b.status_changed_at < now() - make_interval(days => $3::int)
  UNION ALL
  SELECT 'MISSING_INFO', b.*, 'Eksik: ' || concat_ws(', ',
           CASE WHEN b.purchase_date IS NULL THEN 'alım tarihi' END,
           CASE WHEN b.warranty_end_date IS NULL THEN 'garanti bitiş tarihi' END), NULL
    FROM base b WHERE b.is_active AND (b.purchase_date IS NULL OR b.warranty_end_date IS NULL)`;

const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 };

export async function listAlerts(t = thresholds) {
  const { rows } = await query(RULES, [t.warrantyDays, t.idleDays, t.defectiveDays]);
  const alerts = rows.map((r, i) => ({
    id: `${r.type}-${r.id}-${i}`,
    type: r.type,
    severity: ALERT_TYPES[r.type].severity,
    title: ALERT_TYPES[r.type].title,
    message: r.reason,
    days: r.days,
    asset: {
      id: r.id, asset_code: r.asset_code, brand: r.brand, model: r.model, category: r.category,
      status: r.status, warranty_end_date: r.warranty_end_date,
      assignee: r.user_id ? { id: r.user_id, ad_soyad: r.user_name } : null,
    },
  }));
  alerts.sort((a, b) =>
    SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
    || (a.type === 'WARRANTY_EXPIRING' ? a.days - b.days : (b.days ?? 0) - (a.days ?? 0))
    || a.asset.asset_code.localeCompare(b.asset.asset_code));
  return alerts;
}

export async function alertCounts() {
  const alerts = await listAlerts();
  const byType = Object.fromEntries(Object.keys(ALERT_TYPES).map((k) => [k, 0]));
  const bySeverity = { critical: 0, warning: 0, info: 0 };
  for (const a of alerts) {
    byType[a.type] += 1;
    bySeverity[a.severity] += 1;
  }
  return { total: alerts.length, by_type: byType, by_severity: bySeverity, thresholds };
}
