import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { pool, withTransaction } from '../db.js';
import { email as emailSchema } from '../middleware/validate.js';
import { writeAudit } from '../utils/audit.js';
import {
  ADMIN_PASSWORD_MIN_LENGTH, KNOWN_WEAK_PASSWORDS, LEGACY_DEFAULT_ADMIN_PASSWORD, LEGACY_DEMO_PASSWORD, passwordProblem,
} from '../utils/passwords.js';

/**
 * İlk kurulum ve açılış güvenlik kontrolleri. Her açılışta güvenle tekrar çalışır (idempotent).
 *
 * Bu betik ÖRNEK (DEMO) VERİ YÜKLEMEZ. Departman, personel ve cihazlar yalnızca uygulama üzerinden eklenir.
 *
 * 1) Hiç aktif yönetici yoksa ve INITIAL_ADMIN_EMAIL + INITIAL_ADMIN_PASSWORD tanımlıysa ilk yöneticiyi oluşturur.
 *    Tanımlı değilse hiçbir şey oluşturmaz; ilk yöneticinin nasıl oluşturulacağını loga yazar
 *    (önerilen yöntem: npm run create-admin — parolayı ekranda göstermeden sorar).
 * 2) Eski sürümlerden kalan bilinen varsayılan parolaları tespit eder (mevcut veriyi silmeden):
 *    - Demo personel hesaplarının bilinen parolası (Personel123) geçersiz kılınır; hesaplar ve geçmişleri korunur.
 *    - Varsayılan parolayı (Admin12345 vb.) kullanan aktif yönetici varsa: üretimde açılış durdurulur,
 *      geliştirmede ilk girişte parola değişikliği zorunlu tutulur.
 */

const env = process.env;

// Eski sürümün SEED_DEMO_DATA=true ile oluşturduğu örnek personel hesapları.
const LEGACY_DEMO_EMAILS = [
  'ayse.yilmaz', 'mehmet.kaya', 'zeynep.demir', 'emre.celik', 'elif.sahin', 'burak.ozturk', 'selin.arslan',
].map((m) => `${m}@kurum.local`);

function readInitialAdminEnv(log) {
  const pick = (name) => {
    if (env[`INITIAL_ADMIN_${name}`]) return env[`INITIAL_ADMIN_${name}`];
    if (env[`SEED_ADMIN_${name}`]) {
      log(`[setup] Uyarı: SEED_ADMIN_${name} artık kullanılmıyor; INITIAL_ADMIN_${name} adını kullanın.`);
      return env[`SEED_ADMIN_${name}`];
    }
    return '';
  };
  return { email: pick('EMAIL').trim(), password: pick('PASSWORD'), name: pick('NAME').trim() || 'Sistem Yöneticisi' };
}

async function createInitialAdmin(client, log) {
  const { rows } = await client.query("SELECT count(*) AS n FROM users WHERE role = 'ADMIN' AND is_active");
  const { email, password, name } = readInitialAdminEnv(log);

  if (rows[0].n > 0) {
    if (password) {
      log('[setup] Uyarı: Aktif yönetici zaten var; INITIAL_ADMIN_PASSWORD kullanılmadı. '
        + 'Güvenlik için bu değeri .env dosyanızdan silin.');
    }
    return { created: false, adminExists: true };
  }

  if (!email || !password) {
    log('[setup] Sistemde aktif yönetici yok. İlk yöneticiyi oluşturmanın yolları:\n'
      + '        1) Tarayıcıda uygulamayı açın; kurulum ekranı, API kayıtlarında yazan tek kullanımlık KURULUM KODUNU ister\n'
      + '           (Docker: docker compose logs api).\n'
      + '        2) Komutla: docker compose exec api npm run create-admin -- --email ad.soyad@kurum.gov.tr --name "Ad Soyad"\n'
      + '        3) INITIAL_ADMIN_EMAIL ve INITIAL_ADMIN_PASSWORD tanımlayıp yeniden başlatın.');
    return { created: false, adminExists: false };
  }

  const parsedEmail = emailSchema.safeParse(email);
  if (!parsedEmail.success) throw new Error(`[setup] INITIAL_ADMIN_EMAIL geçerli bir e-posta adresi değil: ${email}`);
  const problem = passwordProblem(password, { minLength: ADMIN_PASSWORD_MIN_LENGTH, email: parsedEmail.data });
  if (problem) throw new Error(`[setup] INITIAL_ADMIN_PASSWORD kabul edilmedi: ${problem}. Yönetici oluşturulmadı.`);

  const { rows: existing } = await client.query('SELECT id FROM users WHERE lower(email) = $1', [parsedEmail.data]);
  if (existing[0]) {
    // Var olan bir hesabı sessizce yöneticiye yükseltmek yetki yükseltme açığı olur; bunu yalnızca bilinçli CLI işlemi yapar.
    throw new Error(`[setup] ${parsedEmail.data} adresiyle kayıtlı bir kullanıcı zaten var; otomatik olarak yönetici yapılmadı. `
      + 'Bu hesabı yönetici yapmak için: npm run create-admin -- --email <adres> --reset');
  }

  const hash = await bcrypt.hash(password, config.bcryptRounds);
  const { rows: inserted } = await client.query(
    `INSERT INTO users (ad_soyad, email, password_hash, role) VALUES ($1, $2, $3, 'ADMIN') RETURNING id`,
    [name, parsedEmail.data, hash],
  );
  await writeAudit({
    userId: null, action: 'USER_CREATE', entityType: 'USER', entityId: inserted[0].id,
    details: { ad_soyad: name, email: parsedEmail.data, role: 'ADMIN', via: 'initial-setup' },
  }, client);
  log(`[setup] İlk yönetici hesabı oluşturuldu: ${parsedEmail.data}. Güvenlik için INITIAL_ADMIN_PASSWORD değerini .env dosyanızdan silin.`);
  return { created: true, adminExists: true };
}

/** Eski demo hesaplarının herkesçe bilinen parolasını geçersiz kılar. Hesaplar, zimmetler ve geçmiş korunur. */
async function invalidateLegacyDemoPasswords(client, log) {
  const { rows } = await client.query(
    'SELECT id, ad_soyad, email, password_hash FROM users WHERE lower(email) = ANY($1::text[])',
    [LEGACY_DEMO_EMAILS],
  );
  let count = 0;
  for (const u of rows) {
    if (!(await bcrypt.compare(LEGACY_DEMO_PASSWORD, u.password_hash))) continue;
    const unusable = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 4);
    await client.query(
      `UPDATE users SET password_hash = $1, must_change_password = TRUE, token_version = token_version + 1, updated_at = now()
        WHERE id = $2`,
      [unusable, u.id],
    );
    await writeAudit({
      userId: null, action: 'USER_PASSWORD_RESET', entityType: 'USER', entityId: u.id,
      details: { ad_soyad: u.ad_soyad, email: u.email, reason: 'legacy_demo_password_invalidated' },
    }, client);
    count += 1;
  }
  if (count) {
    log(`[setup] Eski örnek veriden kalan ${count} demo hesabının bilinen parolası geçersiz kılındı. `
      + 'Hesaplar ve geçmişleri silinmedi; gerekmiyorsa Personel ekranından pasife alabilirsiniz.');
  }
  return count;
}

/** Bilinen/varsayılan parolayı kullanan aktif yöneticileri bulur. */
async function findAdminsWithDefaultPassword(client) {
  const { rows } = await client.query(
    "SELECT id, email, password_hash, must_change_password FROM users WHERE role = 'ADMIN' AND is_active ORDER BY id LIMIT 50",
  );
  const candidates = [LEGACY_DEFAULT_ADMIN_PASSWORD, ...KNOWN_WEAK_PASSWORDS.filter((p) => p !== LEGACY_DEFAULT_ADMIN_PASSWORD)].slice(0, 4);
  const found = [];
  for (const u of rows) {
    for (const pw of candidates) {
      if (await bcrypt.compare(pw, u.password_hash)) { found.push(u); break; }
    }
  }
  return found;
}

async function guardDefaultAdminPasswords(client, log, { production }) {
  const weak = await findAdminsWithDefaultPassword(client);
  if (!weak.length) return 0;
  const emails = weak.map((u) => u.email).join(', ');
  if (production) {
    throw new Error(`[setup] Güvenlik: şu yönetici hesapları bilinen/varsayılan bir parola kullanıyor: ${emails}. `
      + 'Uygulama başlatılmadı. Parolayı değiştirmek için:\n'
      + `        docker compose run --rm api npm run create-admin -- --email ${weak[0].email} --reset\n`
      + '        (Veriler silinmez; yalnızca bu hesabın parolası değişir.)');
  }
  await client.query(
    'UPDATE users SET must_change_password = TRUE, updated_at = now() WHERE id = ANY($1::int[]) AND NOT must_change_password',
    [weak.map((u) => u.id)],
  );
  log(`[setup] Uyarı: ${emails} bilinen bir parola kullanıyor. İlk girişte parola değişikliği zorunlu tutulacak `
    + '(üretim ortamında uygulama bu durumda başlamaz).');
  return weak.length;
}

export async function runSeed({ log = console.log, production = config.isProduction } = {}) {
  if (env.SEED_DEMO_DATA === 'true') {
    log('[setup] Uyarı: SEED_DEMO_DATA artık desteklenmiyor ve yok sayıldı; örnek veri yüklenmez.');
  }
  return withTransaction(async (client) => {
    // Aynı anda iki kopyanın ilk yönetici oluşturmasını engeller.
    await client.query('SELECT pg_advisory_xact_lock(727002)');
    const admin = await createInitialAdmin(client, log);
    const demoInvalidated = await invalidateLegacyDemoPasswords(client, log);
    const weakAdmins = await guardDefaultAdminPasswords(client, log, { production });
    return { ...admin, demoInvalidated, weakAdmins };
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runSeed()
    .then(() => pool.end())
    .catch((err) => {
      console.error(err.message);
      process.exitCode = 1;
      return pool.end();
    });
}
