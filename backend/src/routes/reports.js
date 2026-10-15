import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { config, todayInAppTimezone } from '../config.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { validate, optionalId, isoDate, dateRangeRule } from '../middleware/validate.js';
import { Where } from '../utils/sql.js';

/**
 * CSV raporları (PRD §4.2). Excel'in Türkçe ayarlarıyla doğrudan açılsın diye:
 * UTF-8 BOM + noktalı virgül ayraç. Formül enjeksiyonuna karşı = + - @ ile başlayan hücreler kaçırılır.
 */

const STATUS_TR = { ACTIVE: 'Zimmetli', IN_STOCK: 'Depoda', DEFECTIVE: 'Arızalı' };

// Raporlardaki tarih-saatler kurumun saat diliminde yazılır (APP_TIMEZONE / REPORT_TIMEZONE, varsayılan Europe/Istanbul).
const dateTimeFmt = new Intl.DateTimeFormat('sv-SE', {
  timeZone: config.timezone,
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
});

export function csvCell(value) {
  if (value === null || value === undefined) return '';
  let s = value instanceof Date ? dateTimeFmt.format(value) : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers, rows) {
  const lines = [headers.map(([, label]) => csvCell(label)).join(';')];
  for (const r of rows) lines.push(headers.map(([key]) => csvCell(r[key])).join(';'));
  return `﻿${lines.join('\r\n')}\r\n`;
}

function sendCsv(res, name, csv) {
  const stamp = todayInAppTimezone();
  res.set('Cache-Control', 'no-store');
  res.attachment(`${name}-${stamp}.csv`);
  res.type('text/csv; charset=utf-8').send(csv);
}

const statusFilter = z.enum(['ACTIVE', 'IN_STOCK', 'DEFECTIVE']).optional();

const assetReportSchema = z.object({
  status: statusFilter,
  department_id: optionalId,
  category: z.string().trim().max(50).optional(),
  from: isoDate('Başlangıç tarihi'),
  to: isoDate('Bitiş tarihi'),
  include_inactive: z.enum(['true', 'false']).optional(),
}).refine(...dateRangeRule);

const assignmentReportSchema = z.object({
  active: z.enum(['true', 'false', 'all']).optional(),
  department_id: optionalId,
  from: isoDate('Başlangıç tarihi'),
  to: isoDate('Bitiş tarihi'),
}).refine(...dateRangeRule);

export async function assetReportRows(q) {
  const w = new Where();
  if (q.include_inactive !== 'true') w.add('a.is_active');
  if (q.status) w.add('a.status = ?', q.status);
  if (q.category) w.add('a.category = ?', q.category);
  if (q.department_id) w.add('u.department_id = ?', q.department_id);
  // Tarih aralığı: cihazın alım tarihi
  if (q.from) w.add('a.purchase_date >= ?::date', q.from);
  if (q.to) w.add('a.purchase_date <= ?::date', q.to);
  const { rows } = await query(
    `SELECT a.asset_code, a.category, a.brand, a.model, a.serial_number, a.purchase_date, a.warranty_end_date,
            a.status, a.is_active, u.ad_soyad AS assignee, d.name AS department, s.assigned_at
       FROM assets a
       LEFT JOIN assignments s ON s.asset_id = a.id AND s.returned_at IS NULL
       LEFT JOIN users u ON u.id = s.user_id
       LEFT JOIN departments d ON d.id = u.department_id
       ${w.sql()}
      ORDER BY a.asset_code`,
    w.params,
  );
  return rows.map((r) => ({ ...r, status: STATUS_TR[r.status], is_active: r.is_active ? 'Evet' : 'Hayır' }));
}

export async function assignmentReportRows(q) {
  const w = new Where();
  if (q.active === 'true') w.add('s.returned_at IS NULL');
  if (q.active === 'false') w.add('s.returned_at IS NOT NULL');
  if (q.department_id) w.add('u.department_id = ?', q.department_id);
  // Tarih aralığı: teslim tarihi
  if (q.from) w.add('s.assigned_at >= ?::date', q.from);
  if (q.to) w.add("s.assigned_at < (?::date + interval '1 day')", q.to);
  const { rows } = await query(
    `SELECT a.asset_code, a.brand, a.model, a.serial_number, u.ad_soyad AS user_name, u.email, d.name AS department,
            s.assigned_at, ab.ad_soyad AS assigned_by, s.note, s.returned_at, rb.ad_soyad AS returned_by, s.return_note
       FROM assignments s
       JOIN assets a ON a.id = s.asset_id
       JOIN users u ON u.id = s.user_id
       LEFT JOIN departments d ON d.id = u.department_id
       JOIN users ab ON ab.id = s.assigned_by
       LEFT JOIN users rb ON rb.id = s.returned_by
       ${w.sql()}
      ORDER BY s.assigned_at DESC, s.id DESC`,
    w.params,
  );
  return rows;
}

const ASSET_HEADERS = [
  ['asset_code', 'Cihaz kodu'], ['category', 'Kategori'], ['brand', 'Marka'], ['model', 'Model'],
  ['serial_number', 'Seri no'], ['purchase_date', 'Alım tarihi'], ['warranty_end_date', 'Garanti bitişi'],
  ['status', 'Durum'], ['assignee', 'Zimmetli kişi'], ['department', 'Departman'], ['assigned_at', 'Zimmet tarihi'],
  ['is_active', 'Kullanımda'],
];
const ASSIGNMENT_HEADERS = [
  ['asset_code', 'Cihaz kodu'], ['brand', 'Marka'], ['model', 'Model'], ['serial_number', 'Seri no'],
  ['user_name', 'Personel'], ['email', 'E-posta'], ['department', 'Departman'], ['assigned_at', 'Teslim tarihi'],
  ['assigned_by', 'Teslim eden'], ['note', 'Teslim notu'], ['returned_at', 'İade tarihi'], ['returned_by', 'İade alan'],
  ['return_note', 'İade notu'],
];

const router = Router();
router.use(authenticate, requireAdmin);

router.get('/assets.csv', validate({ query: assetReportSchema }), async (req, res) => {
  sendCsv(res, 'envanter-raporu', toCsv(ASSET_HEADERS, await assetReportRows(req.valid.query)));
});

router.get('/assignments.csv', validate({ query: assignmentReportSchema }), async (req, res) => {
  sendCsv(res, 'zimmet-raporu', toCsv(ASSIGNMENT_HEADERS, await assignmentReportRows(req.valid.query)));
});

// JSON önizleme (arayüzde tablo + yazdır/PDF için)
router.get('/assets', validate({ query: assetReportSchema }), async (req, res) => {
  res.json({ headers: ASSET_HEADERS, data: await assetReportRows(req.valid.query) });
});
router.get('/assignments', validate({ query: assignmentReportSchema }), async (req, res) => {
  res.json({ headers: ASSIGNMENT_HEADERS, data: await assignmentReportRows(req.valid.query) });
});

export default router;
