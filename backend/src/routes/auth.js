import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { query, withTransaction } from '../db.js';
import {
  authenticateAllowPasswordChange, loginRateLimit, passwordChangeRateLimit, signToken,
} from '../middleware/auth.js';
import { validate, email, password as passwordRule, trimmed } from '../middleware/validate.js';
import { AppError, badRequest, conflict } from '../utils/errors.js';
import { writeAudit } from '../utils/audit.js';
import { parseDurationMs } from '../utils/time.js';
import { passwordProblem } from '../utils/passwords.js';
import { issueRecoveryCode, verifyRecoveryCode } from '../services/recovery.js';

const router = Router();

const loginSchema = z.object({
  email,
  password: z.string({ required_error: 'Parola zorunludur' }).min(1, 'Parola zorunludur').max(200),
  // Mobil/API istemcileri token'ı gövdede ister; web istemcisi yalnızca httpOnly cookie kullanır.
  issueToken: z.boolean().optional(),
  // Giriş ekranındaki sekme: "Yönetici girişi" (ADMIN) / "Personel girişi" (USER). Verilmezse rol kontrolü yapılmaz (API/mobil).
  portal: z.enum(['ADMIN', 'USER'], { errorMap: () => ({ message: 'Giriş türü ADMIN veya USER olmalıdır' }) }).optional(),
});

// Kullanıcı bulunamasa bile bcrypt karşılaştırması yapılır → yanıt süresi e-postanın varlığını ele vermez.
let dummyHashPromise;
const dummyHash = () => (dummyHashPromise ??= bcrypt.hash('dummy-password-for-timing', config.bcryptRounds));

const invalidCredentials = () =>
  new AppError(401, 'INVALID_CREDENTIALS', 'E-posta veya parola hatalı');

export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.cookieSecure,
    path: '/',
  };
}

export function publicUser(u) {
  return {
    id: u.id,
    ad_soyad: u.ad_soyad,
    email: u.email,
    role: u.role,
    department: u.department_id ? { id: u.department_id, name: u.department_name } : null,
    must_change_password: Boolean(u.must_change_password),
    // Kurtarma kodu oluşturulmuş mu? (Kodun kendisi asla dönmez.) Yoksa arayüz kullanıcıyı oluşturmaya yönlendirir.
    has_recovery_code: Boolean(u.has_recovery_code),
  };
}

function limiter(max, message) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res) => res.status(429).json({ error: { code: 'TOO_MANY_REQUESTS', message } }),
  });
}

function setSessionCookie(res, user) {
  const token = signToken(user);
  res.cookie(config.cookieName, token, { ...cookieOptions(), maxAge: parseDurationMs(config.jwt.expiresIn) });
  return token;
}

// POST /api/auth/login
router.post('/login', loginRateLimit, validate({ body: loginSchema }), async (req, res) => {
  const { email: mail, password, issueToken, portal } = req.valid.body;

  const { rows } = await query(
    `SELECT u.id, u.ad_soyad, u.email, u.password_hash, u.role, u.is_active, u.token_version,
            u.must_change_password, u.is_approved, (u.recovery_code_hash IS NOT NULL) AS has_recovery_code,
            u.department_id, d.name AS department_name
       FROM users u LEFT JOIN departments d ON d.id = u.department_id
      WHERE lower(u.email) = $1`,
    [mail],
  );
  const user = rows[0];
  const passwordOk = await bcrypt.compare(password, user ? user.password_hash : await dummyHash());

  if (!user || !passwordOk || !user.is_active) {
    await writeAudit({
      userId: user?.id ?? null,
      action: 'LOGIN_FAILED',
      entityType: 'USER',
      entityId: user?.id ?? null,
      details: { email: mail, reason: !user ? 'unknown_email' : !passwordOk ? 'wrong_password' : 'inactive', ip: req.ip },
    });
    throw invalidCredentials();
  }

  // Kendi kaydolmuş ama henüz yönetici onayı almamış hesap (yalnızca parolayı bilen kişi bu mesajı görür).
  if (!user.is_approved) {
    await writeAudit({
      userId: user.id, action: 'LOGIN_FAILED', entityType: 'USER', entityId: user.id,
      details: { email: mail, reason: 'pending_approval', ip: req.ip },
    });
    throw new AppError(403, 'ACCOUNT_PENDING', 'Kaydınız alındı ama henüz yönetici tarafından onaylanmadı. Onaylandıktan sonra giriş yapabilirsiniz.');
  }

  // Yanlış sekmeden giriş: oturum açılmaz, doğru sekme söylenir (yalnızca parolayı bilen kişi bu mesajı görür).
  if (portal && portal !== user.role) {
    await writeAudit({
      userId: user.id, action: 'LOGIN_FAILED', entityType: 'USER', entityId: user.id,
      details: { email: mail, reason: 'wrong_portal', ip: req.ip },
    });
    throw new AppError(403, 'WRONG_PORTAL', user.role === 'ADMIN'
      ? 'Bu bir yönetici hesabı. Lütfen "Yönetici girişi" sekmesinden giriş yapın.'
      : 'Bu bir personel hesabı. Lütfen "Personel girişi" sekmesinden giriş yapın.');
  }

  const token = signToken(user);
  res.cookie(config.cookieName, token, { ...cookieOptions(), maxAge: parseDurationMs(config.jwt.expiresIn) });
  await writeAudit({ userId: user.id, action: 'LOGIN', entityType: 'USER', entityId: user.id, details: { ip: req.ip } });

  const body = { user: publicUser(user), expiresIn: config.jwt.expiresIn };
  if (issueToken) body.token = token;
  res.json(body);
});

// POST /api/auth/forgot-password — kurtarma kodunu da kaybedenler için yedek yol: talep yönetici paneline düşer; e-posta gönderilmez.
// Kayıtlı olsun olmasın aynı yanıt döner (hangi e-postaların kayıtlı olduğu öğrenilemez).
const forgotRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.FORGOT_RATE_LIMIT_MAX || 5),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({ error: { code: 'TOO_MANY_REQUESTS', message: 'Çok fazla talep gönderildi. 15 dakika sonra tekrar deneyin.' } });
  },
});
const FORGOT_MESSAGE = 'Talebiniz alındı. Bu e-posta adresi sistemde kayıtlıysa yöneticiniz size geçici bir parola iletecek; '
  + 'o parolayla giriş yaptığınızda kendi yeni parolanızı belirleyeceksiniz.';

router.post('/forgot-password', forgotRateLimit, validate({ body: z.object({ email }) }), async (req, res) => {
  const mail = req.valid.body.email;
  const { rows } = await query('SELECT id, ad_soyad FROM users WHERE lower(email) = $1 AND is_active', [mail]);
  const user = rows[0];
  if (user) {
    await withTransaction(async (client) => {
      const { rows: created } = await client.query(
        `INSERT INTO password_reset_requests (user_id, requested_ip) VALUES ($1, $2)
         ON CONFLICT (user_id) WHERE status = 'PENDING' DO NOTHING RETURNING id`,
        [user.id, String(req.ip || '').slice(0, 64)],
      );
      if (created[0]) {
        await writeAudit({
          userId: null, action: 'PASSWORD_RESET_REQUEST', entityType: 'USER', entityId: user.id,
          details: { ad_soyad: user.ad_soyad, request_id: created[0].id, ip: req.ip },
        }, client);
      }
    });
  }
  res.status(202).json({ message: FORGOT_MESSAGE });
});

// POST /api/auth/logout — idempotent; oturum olmasa da cookie temizlenir.
router.post('/logout', (req, res) => {
  res.clearCookie(config.cookieName, cookieOptions());
  res.status(204).end();
});

// GET /api/auth/me — parola değişikliği bekleyen kullanıcı da bilgisini alabilir (arayüz onu parola ekranına yönlendirir).
router.get('/me', authenticateAllowPasswordChange, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

const changePasswordSchema = z.object({
  current_password: z.string({ required_error: 'Mevcut parola zorunludur' }).min(1, 'Mevcut parola zorunludur').max(200),
  new_password: passwordRule,
});

// POST /api/auth/change-password — giriş yapmış her kullanıcı kendi parolasını değiştirir.
// Başarılı olunca diğer tüm oturumlar kapanır (token_version artar), bu istemciye yeni oturum çerezi verilir.
router.post(
  '/change-password',
  passwordChangeRateLimit,
  authenticateAllowPasswordChange,
  validate({ body: changePasswordSchema }),
  async (req, res) => {
    const { current_password: current, new_password: next } = req.valid.body;
    const { rows } = await query('SELECT password_hash, email FROM users WHERE id = $1', [req.user.id]);
    const ok = rows[0] && (await bcrypt.compare(current, rows[0].password_hash));
    if (!ok) {
      throw badRequest('Mevcut parola hatalı', [{ field: 'current_password', message: 'Mevcut parola hatalı' }]);
    }
    if (current === next) {
      throw badRequest('Yeni parola mevcut paroladan farklı olmalıdır', [{ field: 'new_password', message: 'Yeni parola mevcut paroladan farklı olmalıdır' }]);
    }
    const local = rows[0].email.split('@')[0].toLowerCase();
    if (local.length >= 4 && next.toLowerCase().includes(local)) {
      throw badRequest('Parola e-posta adresinizi içermemelidir', [{ field: 'new_password', message: 'Parola e-posta adresinizi içermemelidir' }]);
    }

    const hash = await bcrypt.hash(next, config.bcryptRounds);
    const user = await withTransaction(async (client) => {
      const { rows: updated } = await client.query(
        `UPDATE users SET password_hash = $1, must_change_password = FALSE, token_version = token_version + 1, updated_at = now()
          WHERE id = $2 RETURNING id, role, token_version`,
        [hash, req.user.id],
      );
      await writeAudit(
        { userId: req.user.id, action: 'USER_PASSWORD_CHANGE', entityType: 'USER', entityId: req.user.id, details: { ad_soyad: req.user.ad_soyad } },
        client,
      );
      // Henüz kurtarma kodu olmayan kullanıcıya (ör. yöneticinin eklediği kişi) ilk parola değişikliğinde kod üretilir.
      const recoveryCode = req.user.has_recovery_code ? null : await issueRecoveryCode(client, req.user.id);
      return { ...updated[0], recoveryCode };
    });

    const token = setSessionCookie(res, user);
    const body = { user: publicUser({ ...req.user, must_change_password: false, has_recovery_code: true }) };
    if (user.recoveryCode) body.recovery_code = user.recoveryCode;
    // Bearer token kullanan (mobil/API) istemciye yeni token gövdede döner.
    if ((req.get('authorization') || '').startsWith('Bearer ')) body.token = token;
    res.json(body);
  },
);

// ---------- Kendi kendine kayıt (yönetici onaylı) ----------

// GET /api/auth/registration — kayıt açık mı, hangi alan adları kabul ediliyor?
router.get('/registration', (req, res) => {
  res.json({ enabled: config.registrationDomains.length > 0, domains: config.registrationDomains });
});

const registerSchema = z.object({
  ad_soyad: trimmed('Ad soyad', 2, 150),
  email,
  password: passwordRule,
});

// POST /api/auth/register — yalnızca izin verilen alan adları; hesap yönetici onaylayana kadar giriş yapamaz.
router.post(
  '/register',
  limiter(Number(process.env.REGISTER_RATE_LIMIT_MAX || 5), 'Çok fazla kayıt denemesi. 15 dakika sonra tekrar deneyin.'),
  validate({ body: registerSchema }),
  async (req, res) => {
    if (!config.registrationDomains.length) {
      throw new AppError(403, 'REGISTRATION_CLOSED', 'Kendi kendine kayıt kapalı. Hesap açılması için yöneticiye başvurun.');
    }
    const b = req.valid.body;
    const domain = b.email.split('@')[1];
    if (!config.registrationDomains.includes(domain)) {
      const allowed = config.registrationDomains.map((d) => `@${d}`).join(', ');
      throw badRequest(`Yalnızca ${allowed} uzantılı kurum e-postasıyla kaydolabilirsiniz`, [{ field: 'email', message: `Yalnızca ${allowed} adresleri kabul edilir` }]);
    }
    const problem = passwordProblem(b.password, { email: b.email });
    if (problem) throw badRequest(problem, [{ field: 'password', message: problem }]);

    const hash = await bcrypt.hash(b.password, config.bcryptRounds);
    const recoveryCode = await withTransaction(async (client) => {
      const { rows: existing } = await client.query('SELECT 1 FROM users WHERE lower(email) = $1', [b.email]);
      if (existing[0]) {
        throw conflict('DUPLICATE_EMAIL', 'Bu e-posta adresiyle zaten bir hesap var. Giriş yapın veya "Şifremi unuttum"u kullanın.', [{ field: 'email', message: 'Bu e-posta adresiyle zaten bir hesap var' }]);
      }
      const { rows } = await client.query(
        `INSERT INTO users (ad_soyad, email, password_hash, role, is_approved, self_registered)
         VALUES ($1, $2, $3, 'USER', FALSE, TRUE) RETURNING id`,
        [b.ad_soyad, b.email, hash],
      );
      const code = await issueRecoveryCode(client, rows[0].id);
      await writeAudit({
        userId: null, action: 'USER_REGISTER', entityType: 'USER', entityId: rows[0].id,
        details: { ad_soyad: b.ad_soyad, email: b.email, ip: req.ip },
      }, client);
      return code;
    });
    res.status(201).json({
      recovery_code: recoveryCode,
      message: 'Kaydınız alındı. Yönetici onayladıktan sonra giriş yapabilirsiniz.',
    });
  },
);

// ---------- E-postasız parola kurtarma (kurtarma kodu) ----------

const recoverSchema = z.object({
  email,
  recovery_code: z.string({ required_error: 'Kurtarma kodu zorunludur' }).trim().min(1, 'Kurtarma kodu zorunludur').max(40),
  new_password: passwordRule,
});

// POST /api/auth/recover — e-posta + kurtarma kodu ile yeni parola belirlenir. Kod tek kullanımlıktır; yenisi döner.
router.post(
  '/recover',
  limiter(Number(process.env.RECOVER_RATE_LIMIT_MAX || 5), 'Çok fazla deneme. 15 dakika sonra tekrar deneyin.'),
  validate({ body: recoverSchema }),
  async (req, res) => {
    const b = req.valid.body;
    const { rows } = await query(
      'SELECT id, ad_soyad, email, recovery_code_hash, is_active, is_approved FROM users WHERE lower(email) = $1',
      [b.email],
    );
    const user = rows[0];
    const ok = await verifyRecoveryCode(b.recovery_code, user?.recovery_code_hash);
    if (!user || !ok || !user.is_active) {
      if (user) {
        await writeAudit({
          userId: null, action: 'PASSWORD_RECOVER_FAILED', entityType: 'USER', entityId: user.id,
          details: { email: b.email, ip: req.ip },
        });
      }
      throw new AppError(400, 'INVALID_RECOVERY', 'E-posta veya kurtarma kodu hatalı');
    }
    const problem = passwordProblem(b.new_password, { email: user.email });
    if (problem) throw badRequest(problem, [{ field: 'new_password', message: problem }]);

    const hash = await bcrypt.hash(b.new_password, config.bcryptRounds);
    const newCode = await withTransaction(async (client) => {
      await client.query(
        `UPDATE users SET password_hash = $1, must_change_password = FALSE, token_version = token_version + 1, updated_at = now()
          WHERE id = $2`,
        [hash, user.id],
      );
      // Bekleyen "yöneticiden yardım" talebi varsa artık gereksiz.
      await client.query(
        "UPDATE password_reset_requests SET status = 'RESOLVED', resolved_at = now() WHERE user_id = $1 AND status = 'PENDING'",
        [user.id],
      );
      const code = await issueRecoveryCode(client, user.id);
      await writeAudit({
        userId: user.id, action: 'USER_PASSWORD_RECOVER', entityType: 'USER', entityId: user.id,
        details: { ad_soyad: user.ad_soyad, ip: req.ip },
      }, client);
      return code;
    });
    res.json({
      recovery_code: newCode,
      message: user.is_approved
        ? 'Parolanız değiştirildi. Eski kurtarma kodunuz artık geçersiz; yeni kodunuzu kaydedin.'
        : 'Parolanız değiştirildi. Hesabınız yönetici onayından sonra açılacak. Yeni kurtarma kodunuzu kaydedin.',
    });
  },
);

// POST /api/auth/recovery-code — giriş yapmış kullanıcı mevcut parolasıyla yeni kurtarma kodu alır (eskisi geçersiz olur).
router.post(
  '/recovery-code',
  passwordChangeRateLimit,
  authenticateAllowPasswordChange,
  validate({ body: z.object({ current_password: z.string({ required_error: 'Mevcut parola zorunludur' }).min(1, 'Mevcut parola zorunludur').max(200) }) }),
  async (req, res) => {
    const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (!(await bcrypt.compare(req.valid.body.current_password, rows[0].password_hash))) {
      throw badRequest('Mevcut parola hatalı', [{ field: 'current_password', message: 'Mevcut parola hatalı' }]);
    }
    const code = await withTransaction(async (client) => {
      const c = await issueRecoveryCode(client, req.user.id);
      await writeAudit({ userId: req.user.id, action: 'RECOVERY_CODE_RENEW', entityType: 'USER', entityId: req.user.id, details: { ad_soyad: req.user.ad_soyad } }, client);
      return c;
    });
    res.json({ recovery_code: code, user: publicUser({ ...req.user, has_recovery_code: true }) });
  },
);

export default router;
