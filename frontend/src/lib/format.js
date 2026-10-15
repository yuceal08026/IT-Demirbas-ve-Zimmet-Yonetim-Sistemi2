const dateFmt = new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('tr-TR', {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

/** "2026-03-14" veya ISO zaman damgası → "14 Mar 2026" */
export function formatDate(value) {
  if (!value) return '—';
  const d = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : dateFmt.format(d);
}

export function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : dateTimeFmt.format(d);
}

/** Tarayıcının yerel saatine göre bugünün tarihi (YYYY-AA-GG). toISOString() UTC verdiği için gece yarısından sonra bir gün geride kalır. */
export function todayLocalIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Bugünden itibaren gün farkı (pozitif = gelecekte). */
export function daysFromToday(value) {
  if (!value) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.round((d - today) / 86_400_000);
}

export function durationLabel(days) {
  if (days == null) return '';
  const n = Math.abs(days);
  if (n < 1) return 'bugün';
  if (n < 60) return `${n} gün`;
  if (n < 730) return `${Math.round(n / 30)} ay`;
  return `${(n / 365).toFixed(1).replace('.', ',')} yıl`;
}

export const STATUS_LABELS = {
  ACTIVE: 'Zimmetli',
  IN_STOCK: 'Depoda',
  DEFECTIVE: 'Arızalı',
};

export const ROLE_LABELS = { ADMIN: 'Yönetici', USER: 'Personel' };

export const ACTION_LABELS = {
  LOGIN: 'Giriş yaptı',
  LOGIN_FAILED: 'Başarısız giriş',
  USER_CREATE: 'Kullanıcı oluşturdu',
  USER_UPDATE: 'Kullanıcıyı güncelledi',
  USER_PASSWORD_RESET: 'Şifre sıfırladı',
  USER_PASSWORD_CHANGE: 'Parolasını değiştirdi',
  PASSWORD_RESET_REQUEST: 'Parola sıfırlama talebi',
  PASSWORD_RESET_REJECT: 'Parola talebini reddetti',
  USER_REGISTER: 'Kaydoldu',
  USER_APPROVE: 'Kaydı onayladı',
  USER_REJECT: 'Kaydı reddetti',
  USER_PASSWORD_RECOVER: 'Parolasını kurtarma koduyla yeniledi',
  PASSWORD_RECOVER_FAILED: 'Hatalı kurtarma kodu denemesi',
  RECOVERY_CODE_RENEW: 'Kurtarma kodunu yeniledi',
  USER_DEACTIVATE: 'Kullanıcıyı pasife aldı',
  USER_ACTIVATE: 'Kullanıcıyı aktifleştirdi',
  USER_DELETE: 'Kullanıcıyı sildi',
  DEPARTMENT_CREATE: 'Departman oluşturdu',
  DEPARTMENT_UPDATE: 'Departmanı güncelledi',
  DEPARTMENT_DELETE: 'Departmanı sildi',
  ASSET_CREATE: 'Cihaz ekledi',
  ASSET_UPDATE: 'Cihazı güncelledi',
  ASSET_STATUS_CHANGE: 'Cihaz durumunu değiştirdi',
  ASSET_DEACTIVATE: 'Cihazı pasife aldı',
  ASSET_ACTIVATE: 'Cihazı aktifleştirdi',
  ASSET_DELETE: 'Cihazı sildi',
  ASSIGN: 'Zimmetledi',
  RETURN: 'İade aldı',
  MAINTENANCE_OPEN: 'Arıza kaydı açtı',
  MAINTENANCE_UPDATE: 'Arıza kaydını güncelledi',
  MAINTENANCE_RESOLVE: 'Arızayı çözdü',
};

export const ENTITY_LABELS = { USER: 'Kullanıcı', ASSET: 'Cihaz', ASSIGNMENT: 'Zimmet', DEPARTMENT: 'Departman', MAINTENANCE: 'Bakım' };

export const FIELD_LABELS = {
  ad_soyad: 'Ad soyad', email: 'E-posta', role: 'Rol', department_id: 'Departman', is_active: 'Aktiflik',
  category: 'Kategori', brand: 'Marka', model: 'Model', serial_number: 'Seri no', purchase_date: 'Alım tarihi',
  warranty_end_date: 'Garanti bitişi', notes: 'Not', status: 'Durum', name: 'Ad',
};
