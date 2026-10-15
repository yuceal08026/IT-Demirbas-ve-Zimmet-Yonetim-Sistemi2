import 'dotenv/config';
import crypto from 'node:crypto';

/**
 * Tüm ortam değişkenleri tek yerden okunur ve doğrulanır.
 * Üretimde eksik veya zayıf bir güvenlik ayarı varsa uygulama hiç başlamaz (fail fast).
 */

const env = process.env;

function buildDatabaseUrl() {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  const user = env.POSTGRES_USER || 'zimmet';
  const password = encodeURIComponent(env.POSTGRES_PASSWORD || '');
  const host = env.POSTGRES_HOST || 'localhost';
  const port = env.POSTGRES_PORT || '5432';
  const db = env.POSTGRES_DB || 'zimmet';
  return `postgres://${user}:${password}@${host}:${port}/${db}`;
}

/**
 * Express "trust proxy" ayarı. Varsayılan: yalnızca yerel/özel ağdaki vekiller (Docker içindeki nginx gibi).
 * Böylece API doğrudan internete açılırsa X-Forwarded-For başlığıyla giriş hız sınırı atlatılamaz.
 */
function parseTrustProxy(value) {
  if (value === undefined || value === '') return 'loopback, linklocal, uniquelocal';
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}

const nodeEnv = env.NODE_ENV || 'development';
const timezone = env.APP_TIMEZONE || env.REPORT_TIMEZONE || 'Europe/Istanbul';

export const config = {
  nodeEnv,
  isProduction: nodeEnv === 'production',
  isTest: nodeEnv === 'test',
  port: Number(env.PORT || 3000),
  databaseUrl: buildDatabaseUrl(),
  jwt: {
    secret: env.JWT_SECRET || '',
    expiresIn: env.JWT_EXPIRES_IN || '8h',
  },
  cookieName: 'zimmet_token',
  // Cookie'yi yalnızca HTTPS üzerinden göndermek için COOKIE_SECURE=true yapın.
  cookieSecure: env.COOKIE_SECURE === 'true',
  appBaseUrl: (env.APP_BASE_URL || 'http://localhost:8080').replace(/\/+$/, ''),
  bcryptRounds: Number(env.BCRYPT_ROUNDS || 12),
  trustProxy: parseTrustProxy(env.TRUST_PROXY),
  // Kurumun saat dilimi: "bugün" hesabı, tarih filtreleri ve raporlardaki saatler bu dilime göre yapılır.
  timezone,
  // Kendi kendine kayıt: yalnızca bu alan adlarındaki e-postalar kaydolabilir (virgülle ayrılmış, örn. gop.edu.tr).
  // Boşsa kendi kendine kayıt kapalıdır; kullanıcıları yalnızca yönetici ekler.
  registrationDomains: (env.REGISTRATION_EMAIL_DOMAINS || '')
    .split(',').map((d) => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean),
  loginRateLimit: {
    windowMs: 15 * 60 * 1000,
    max: Number(env.LOGIN_RATE_LIMIT_MAX || 10),
  },
};

/** Örnek dosyalarda veya eski sürümlerde kullanılmış, bilinen ve bu yüzden güvensiz değerler. */
const KNOWN_WEAK_DB_PASSWORDS = new Set(['', 'zimmet', 'zimmet-local-dev', 'postgres', 'password', 'changeme']);
const PLACEHOLDER_SECRET = /degistir|değiştir|change[-_ ]?me|replace[-_ ]?me|example|ornek|örnek|^x+$/i;

function databasePassword(url) {
  try {
    return decodeURIComponent(new URL(url).password || '');
  } catch {
    return null;
  }
}

/**
 * Güvenlik ayarlarını denetler. Saf fonksiyondur (test edilebilir): { errors, warnings } döner.
 * - Her ortamda: JWT_SECRET verilmişse en az 32 karakter olmalı, JWT_EXPIRES_IN geçerli olmalı, saat dilimi geçerli olmalı.
 * - Üretimde ek olarak: JWT_SECRET zorunlu ve örnek/yer tutucu olamaz; veritabanı parolası bilinen bir değer olamaz;
 *   HTTPS adresinde COOKIE_SECURE=true olmalı; bcrypt maliyeti en az 10 olmalı.
 */
export function checkSecurityConfig(cfg) {
  const errors = [];
  const warnings = [];
  const secret = cfg.jwt.secret || '';

  if (!secret && cfg.isProduction) {
    errors.push('JWT_SECRET tanımlı değil. Üretimde en az 32 karakterlik rastgele bir değer zorunludur '
      + '(üretmek için: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))").');
  }
  if (secret && secret.length < 32) {
    errors.push('JWT_SECRET 32 karakterden kısa. Daha uzun, rastgele bir değer kullanın (bkz. .env.example).');
  }
  if (secret && cfg.isProduction && PLACEHOLDER_SECRET.test(secret)) {
    errors.push('JWT_SECRET örnek/yer tutucu bir değer gibi görünüyor. Rastgele üretilmiş bir değer kullanın.');
  }
  if (!/^\d+\s*[smhd]?$/i.test(String(cfg.jwt.expiresIn).trim())) {
    errors.push('JWT_EXPIRES_IN geçersiz. Örnek değerler: 30m, 8h, 1d');
  }
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: cfg.timezone });
    if (!/^[A-Za-z0-9_+\-/]+$/.test(cfg.timezone)) throw new Error();
  } catch {
    errors.push(`Saat dilimi geçersiz: ${cfg.timezone} (örn. Europe/Istanbul)`);
  }

  if (cfg.isProduction) {
    const dbPassword = databasePassword(cfg.databaseUrl);
    if (dbPassword !== null && KNOWN_WEAK_DB_PASSWORDS.has(dbPassword)) {
      errors.push('Veritabanı parolası boş veya bilinen bir varsayılan değer. POSTGRES_PASSWORD için güçlü bir parola belirleyin '
        + '(mevcut kurulumda parolanın nasıl değiştirileceği README › "Mevcut kurulumu güncelleme" bölümünde).');
    }
    if (cfg.appBaseUrl.startsWith('https://') && !cfg.cookieSecure) {
      errors.push('APP_BASE_URL https ile başlıyor ama COOKIE_SECURE=true değil. Oturum çerezinin yalnızca HTTPS ile gönderilmesi için COOKIE_SECURE=true yapın.');
    }
    if (!cfg.cookieSecure) {
      warnings.push('COOKIE_SECURE=false: oturum çerezi HTTP üzerinden de gönderilir. Uygulamayı ağda yayınlarken HTTPS arkasına alıp COOKIE_SECURE=true yapın.');
    }
    if (!Number.isInteger(cfg.bcryptRounds) || cfg.bcryptRounds < 10) {
      errors.push('BCRYPT_ROUNDS üretimde en az 10 olmalıdır.');
    }
  }
  return { errors, warnings };
}

/**
 * Sunucu başlamadan önce çağrılır. Hata varsa fırlatır; uygulama güvensiz biçimde başlamaz.
 * Yalnızca geliştirme/test ortamında JWT_SECRET boşsa bu çalıştırmaya özel rastgele bir anahtar üretilir.
 */
export function assertSecurityConfig({ warn = console.warn } = {}) {
  const { errors, warnings } = checkSecurityConfig(config);
  if (errors.length) {
    throw new Error(`Güvenlik ayarları eksik veya hatalı; uygulama başlatılmadı:\n - ${errors.join('\n - ')}`);
  }
  for (const w of warnings) warn(`[config] Uyarı: ${w}`);
  if (!config.jwt.secret) {
    config.jwt.secret = crypto.randomBytes(48).toString('hex');
    warn('[config] JWT_SECRET tanımlı değil; bu çalıştırma için rastgele bir anahtar üretildi (yalnızca geliştirme ortamında izinli). '
      + 'Yeniden başlatmada oturumlar kapanır.');
  }
}

/** Kurum saat dilimine göre bugünün tarihi (YYYY-MM-DD). */
export function todayInAppTimezone(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
