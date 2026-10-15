import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config.js';
import { withTransaction } from '../db.js';
import { signToken } from '../middleware/auth.js';
import { validate, trimmed, email } from '../middleware/validate.js';
import { AppError, badRequest, conflict } from '../utils/errors.js';
import { writeAudit } from '../utils/audit.js';
import { parseDurationMs } from '../utils/time.js';
import { ADMIN_PASSWORD_MIN_LENGTH, passwordProblem } from '../utils/passwords.js';
import { ensureSetupCode, invalidateSetupCode, needsSetup, verifySetupCode } from '../services/setup.js';
import { cookieOptions, publicUser } from './auth.js';
import { issueRecoveryCode } from '../services/recovery.js';

/**
 * Tarayıcıdan ilk yönetici kurulumu (bkz. services/setup.js).
 * Yalnızca sistemde hiç aktif yönetici yokken ve sunucu kayıtlarındaki kurulum koduyla çalışır.
 */
const router = Router();
const quiet = () => {};

// Kod tahminini engeller: IP başına 15 dakikada en fazla 10 deneme (başarılı/başarısız hepsi sayılır).
const setupRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.SETUP_RATE_LIMIT_MAX || 10),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({ error: { code: 'TOO_MANY_REQUESTS', message: 'Çok fazla kurulum denemesi. 15 dakika sonra tekrar deneyin.' } });
  },
});

// GET /api/setup/status — herkese açık; yalnızca kurulum gerekip gerekmediğini söyler.
router.get('/status', async (req, res) => {
  // Kurulum gerekiyorsa ve henüz kod yoksa kod üretilip sunucu kayıtlarına yazılır.
  const code = await ensureSetupCode(config.isTest ? quiet : console.log);
  res.set('Cache-Control', 'no-store');
  res.json({ needs_setup: Boolean(code) });
});

const setupSchema = z.object({
  setup_code: z.string({ required_error: 'Kurulum kodu zorunludur' }).trim().min(1, 'Kurulum kodu zorunludur').max(40),
  ad_soyad: trimmed('Ad soyad', 2, 150),
  email,
  password: z.string({ required_error: 'Parola zorunludur' }).max(72, 'Parola en fazla 72 karakter olabilir'),
});

// POST /api/setup/admin — ilk yöneticiyi oluşturur ve oturum açar.
router.post('/admin', setupRateLimit, validate({ body: setupSchema }), async (req, res) => {
  const b = req.valid.body;
  if (!(await needsSetup())) throw conflict('SETUP_DONE', 'Kurulum zaten tamamlanmış. Giriş ekranını kullanın.');
  if (!verifySetupCode(b.setup_code)) {
    throw new AppError(403, 'INVALID_SETUP_CODE', 'Kurulum kodu hatalı. Kodu sunucu kayıtlarından kontrol edin (docker compose logs api).');
  }
  const problem = passwordProblem(b.password, { minLength: ADMIN_PASSWORD_MIN_LENGTH, email: b.email });
  if (problem) throw badRequest(problem, [{ field: 'password', message: problem }]);

  const hash = await bcrypt.hash(b.password, config.bcryptRounds);
  const user = await withTransaction(async (client) => {
    // Aynı anda iki kurulum isteği gelirse yalnızca biri yönetici oluşturur.
    await client.query('SELECT pg_advisory_xact_lock(727002)');
    if (!(await needsSetup(client))) throw conflict('SETUP_DONE', 'Kurulum zaten tamamlanmış. Giriş ekranını kullanın.');
    const { rows: existing } = await client.query('SELECT id FROM users WHERE lower(email) = $1', [b.email]);
    if (existing[0]) {
      throw conflict('DUPLICATE_EMAIL', 'Bu e-posta adresiyle kayıtlı bir kullanıcı var; başka bir adres kullanın', [{ field: 'email', message: 'Bu e-posta adresi kullanılıyor' }]);
    }
    const { rows } = await client.query(
      `INSERT INTO users (ad_soyad, email, password_hash, role) VALUES ($1, $2, $3, 'ADMIN')
       RETURNING id, ad_soyad, email, role, department_id, token_version, must_change_password`,
      [b.ad_soyad, b.email, hash],
    );
    rows[0].recoveryCode = await issueRecoveryCode(client, rows[0].id);
    await writeAudit({
      userId: rows[0].id, action: 'USER_CREATE', entityType: 'USER', entityId: rows[0].id,
      details: { ad_soyad: b.ad_soyad, email: b.email, role: 'ADMIN', via: 'web-setup', ip: req.ip },
    }, client);
    return rows[0];
  });
  invalidateSetupCode();

  res.cookie(config.cookieName, signToken(user), { ...cookieOptions(), maxAge: parseDurationMs(config.jwt.expiresIn) });
  res.status(201).json({ user: publicUser({ ...user, department_name: null, has_recovery_code: true }), recovery_code: user.recoveryCode });
});

export default router;
