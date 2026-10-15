import { AppError, fromPgError } from '../utils/errors.js';
import { config } from '../config.js';

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'İstenen adres bulunamadı' } });
}

// Express hata middleware'i 4 parametre almalıdır.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  let appErr = err instanceof AppError ? err : fromPgError(err);

  // Bozuk JSON gövdesi
  if (!appErr && err?.type === 'entity.parse.failed') {
    appErr = new AppError(400, 'VALIDATION_ERROR', 'İstek gövdesi geçerli bir JSON değil');
  }
  if (!appErr && err?.type === 'entity.too.large') {
    appErr = new AppError(413, 'PAYLOAD_TOO_LARGE', 'İstek gövdesi çok büyük');
  }

  if (appErr) {
    const body = { error: { code: appErr.code, message: appErr.message } };
    if (appErr.details) body.error.details = appErr.details;
    return res.status(appErr.status).json(body);
  }

  // Beklenmeyen hata: ayrıntı sadece sunucu loguna, istemciye genel mesaj.
  if (!config.isTest) console.error('[error]', req.method, req.originalUrl, err);
  return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Beklenmeyen bir hata oluştu' } });
}
