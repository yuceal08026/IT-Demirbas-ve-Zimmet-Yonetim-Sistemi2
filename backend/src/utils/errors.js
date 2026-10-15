/**
 * Uygulama hataları. Route'lar bu hataları fırlatır; merkezi errorHandler
 * bunları API.md'deki { error: { code, message, details } } biçimine çevirir.
 */
export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details) =>
  new AppError(400, 'VALIDATION_ERROR', message, details);
export const unauthenticated = (message = 'Oturum açmanız gerekiyor') =>
  new AppError(401, 'UNAUTHENTICATED', message);
export const forbidden = (message = 'Bu işlem için yetkiniz yok') =>
  new AppError(403, 'FORBIDDEN', message);
export const notFound = (message = 'Kayıt bulunamadı') => new AppError(404, 'NOT_FOUND', message);
export const conflict = (code, message, details) => new AppError(409, code, message, details);

/**
 * PostgreSQL benzersizlik ihlallerini (23505) anlamlı 409 hatalarına çevirir.
 * Böylece eşzamanlı isteklerde servis kontrolünü aşan kayıtlar da doğru mesajla reddedilir.
 */
const UNIQUE_CONSTRAINT_MAP = {
  assets_serial_number_key: ['DUPLICATE_SERIAL_NUMBER', 'Bu seri numarasıyla kayıtlı bir cihaz zaten var', 'serial_number'],
  assets_asset_code_key: ['DUPLICATE_ASSET_CODE', 'Bu cihaz koduyla kayıtlı bir cihaz zaten var', 'asset_code'],
  ux_users_email_lower: ['DUPLICATE_EMAIL', 'Bu e-posta adresiyle kayıtlı bir kullanıcı zaten var', 'email'],
  departments_name_key: ['DUPLICATE_DEPARTMENT', 'Bu adla bir departman zaten var', 'name'],
  ux_assignments_active_asset: ['ASSET_ALREADY_ASSIGNED', 'Bu cihaz zaten bir personele zimmetli; önce iade alınmalı', 'asset_id'],
};

export function fromPgError(err) {
  if (err?.code === '23505' && UNIQUE_CONSTRAINT_MAP[err.constraint]) {
    const [code, message, field] = UNIQUE_CONSTRAINT_MAP[err.constraint];
    return conflict(code, message, [{ field, message }]);
  }
  if (err?.code === '23503') {
    return conflict('HAS_HISTORY', 'Kayıt başka kayıtlarla ilişkili olduğu için silinemez; pasife almayı deneyin');
  }
  if (err?.code === '23514' || err?.code === '22007' || err?.code === '22008') {
    return badRequest('Geçersiz veri: kayıt kurallarına uymuyor');
  }
  return null;
}
