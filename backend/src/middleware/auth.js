import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { query } from '../db.js';
import { forbidden, unauthenticated, AppError } from '../utils/errors.js';

export function signToken(user) {
  return jwt.sign({ sub: String(user.id), role: user.role, tv: user.token_version }, config.jwt.secret, {
    algorithm: 'HS256',
    expiresIn: config.jwt.expiresIn,
  });
}

function extractToken(req) {
  const header = req.get('authorization') || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return req.cookies?.[config.cookieName] || null;
}

/**
 * JWT'yi doğrular ve kullanıcıyı HER İSTEKTE veritabanından okur:
 * - pasife alınmış kullanıcının token'ı anında geçersiz olur,
 * - rol değişikliği anında etkili olur (rol token'dan değil DB'den gelir),
 * - token_version uyuşmazsa (şifre sıfırlama, pasife alma, rol değişimi) oturum düşer,
 * - parolasını değiştirmesi gereken kullanıcı (geçici/bilinen parola) yalnızca izin verilen uçlara erişebilir.
 */
function createAuthenticate({ allowPendingPasswordChange = false } = {}) {
  return async function authenticateRequest(req, res, next) {
    const token = extractToken(req);
    if (!token) return next(unauthenticated());

    let payload;
    try {
      payload = jwt.verify(token, config.jwt.secret, { algorithms: ['HS256'] });
    } catch (err) {
      const expired = err?.name === 'TokenExpiredError';
      return next(unauthenticated(expired ? 'Oturum süreniz doldu, lütfen tekrar giriş yapın' : 'Geçersiz oturum'));
    }

    const userId = Number(payload.sub);
    if (!Number.isInteger(userId)) return next(unauthenticated('Geçersiz oturum'));

    const { rows } = await query(
      `SELECT u.id, u.ad_soyad, u.email, u.role, u.department_id, d.name AS department_name,
              u.is_active, u.is_approved, u.token_version, u.must_change_password,
              (u.recovery_code_hash IS NOT NULL) AS has_recovery_code
         FROM users u LEFT JOIN departments d ON d.id = u.department_id
        WHERE u.id = $1`,
      [userId],
    );
    const user = rows[0];
    if (!user || !user.is_active || !user.is_approved || user.token_version !== payload.tv) {
      return next(unauthenticated('Oturumunuz sonlandırıldı, lütfen tekrar giriş yapın'));
    }

    req.user = {
      id: user.id,
      ad_soyad: user.ad_soyad,
      email: user.email,
      role: user.role,
      department_id: user.department_id,
      department_name: user.department_name,
      must_change_password: user.must_change_password,
      has_recovery_code: user.has_recovery_code,
    };
    if (user.must_change_password && !allowPendingPasswordChange) {
      return next(new AppError(403, 'PASSWORD_CHANGE_REQUIRED', 'Devam etmeden önce parolanızı değiştirmeniz gerekiyor'));
    }
    next();
  };
}

export const authenticate = createAuthenticate();
/** Yalnızca /auth/me ve /auth/change-password için: parola değişikliği bekleyen kullanıcı da geçer. */
export const authenticateAllowPasswordChange = createAuthenticate({ allowPendingPasswordChange: true });

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(unauthenticated());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };
}

export const requireAdmin = requireRole('ADMIN');

/**
 * Durum değiştiren isteklerde gövde JSON olmalı. Cookie tabanlı oturumda SameSite=Strict ile
 * birlikte, düz HTML formlarıyla yapılabilecek CSRF denemelerini de engeller.
 */
export function requireJsonBody(req, res, next) {
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    const type = req.get('content-type') || '';
    if (!type.toLowerCase().includes('application/json')) {
      return next(new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'İstek gövdesi application/json olmalıdır'));
    }
  }
  next();
}

function createFailedAttemptLimiter(message) {
  return rateLimit({
    windowMs: config.loginRateLimit.windowMs,
    limit: config.loginRateLimit.max,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).json({ error: { code: 'TOO_MANY_REQUESTS', message } });
    },
  });
}

/** Login için kaba kuvvet koruması: IP başına pencere içinde sınırlı başarısız deneme. */
export const loginRateLimit = createFailedAttemptLimiter(
  'Çok fazla başarısız giriş denemesi. 15 dakika sonra tekrar deneyin.',
);
/** Parola değiştirmede mevcut parolanın denenerek bulunmasını engeller (ayrı sayaç). */
export const passwordChangeRateLimit = createFailedAttemptLimiter(
  'Çok fazla başarısız parola değiştirme denemesi. 15 dakika sonra tekrar deneyin.',
);
