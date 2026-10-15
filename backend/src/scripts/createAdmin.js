import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { pool, withTransaction } from '../db.js';
import { email as emailSchema } from '../middleware/validate.js';
import { writeAudit } from '../utils/audit.js';
import { ADMIN_PASSWORD_MIN_LENGTH, passwordProblem } from '../utils/passwords.js';

/**
 * Güvenli yönetici oluşturma / kurtarma aracı (yalnızca sunucuya erişimi olan kişi çalıştırabilir).
 *
 *   npm run create-admin -- --email ad.soyad@kurum.gov.tr --name "Ad Soyad"
 *   npm run create-admin -- --email ad.soyad@kurum.gov.tr --reset     # parolayı unutan/kilitlenen yönetici
 *
 * Parola ekranda gösterilmeden iki kez sorulur. Etkileşimsiz kullanım (CI vb.) için ADMIN_PASSWORD
 * ortam değişkeni verilebilir; bu durumda değer kabuk geçmişinde kalmayacak şekilde iletilmelidir.
 *
 * --reset: e-postası verilen mevcut kullanıcıya yeni parola atar, rolünü ADMIN yapar, hesabı aktifleştirir
 *          ve tüm açık oturumlarını kapatır. Hiçbir kayıt silinmez.
 */

const USAGE = 'Kullanım: npm run create-admin -- --email <e-posta> [--name "Ad Soyad"] [--reset]';

function promptHidden(question) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error('Parola sorulamadı (etkileşimli terminal yok). Docker için "docker compose exec -it api ..." kullanın '
        + 'veya ADMIN_PASSWORD ortam değişkenini verin.'));
      return;
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => {
      if (s.includes(question)) process.stdout.write(question);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function readPassword(emailAddress) {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  const first = await promptHidden(`Yeni parola (en az ${ADMIN_PASSWORD_MIN_LENGTH} karakter, harf ve rakam): `);
  const problem = passwordProblem(first, { minLength: ADMIN_PASSWORD_MIN_LENGTH, email: emailAddress });
  if (problem) throw new Error(problem);
  const second = await promptHidden('Yeni parola (tekrar): ');
  if (first !== second) throw new Error('Parolalar eşleşmiyor');
  return first;
}

/**
 * @returns {Promise<{ action: 'created'|'reset', id: number, email: string }>}
 */
export async function createOrResetAdmin({ email, name, reset = false, password, log = console.log }) {
  const parsed = emailSchema.safeParse(email || '');
  if (!parsed.success) throw new Error(`Geçerli bir e-posta adresi verin. ${USAGE}`);
  const mail = parsed.data;
  const problem = passwordProblem(password, { minLength: ADMIN_PASSWORD_MIN_LENGTH, email: mail });
  if (problem) throw new Error(`Parola kabul edilmedi: ${problem}`);
  const hash = await bcrypt.hash(password, config.bcryptRounds);

  return withTransaction(async (client) => {
    const { rows } = await client.query('SELECT id, ad_soyad, role, is_active FROM users WHERE lower(email) = $1 FOR UPDATE', [mail]);
    const existing = rows[0];

    if (existing && !reset) {
      throw new Error(`${mail} adresiyle kayıtlı bir kullanıcı zaten var. Parolasını sıfırlayıp yönetici yapmak için --reset ekleyin.`);
    }
    if (!existing && reset) {
      throw new Error(`${mail} adresiyle kayıtlı kullanıcı bulunamadı. Yeni yönetici oluşturmak için --reset olmadan çalıştırın.`);
    }

    if (existing) {
      await client.query(
        `UPDATE users SET password_hash = $1, role = 'ADMIN', is_active = TRUE, must_change_password = FALSE,
                          token_version = token_version + 1, updated_at = now()
          WHERE id = $2`,
        [hash, existing.id],
      );
      await writeAudit({
        userId: null, action: 'USER_PASSWORD_RESET', entityType: 'USER', entityId: existing.id,
        details: {
          ad_soyad: existing.ad_soyad, email: mail, via: 'cli',
          changes: {
            ...(existing.role !== 'ADMIN' ? { role: { from: existing.role, to: 'ADMIN' } } : {}),
            ...(!existing.is_active ? { is_active: { from: false, to: true } } : {}),
          },
        },
      }, client);
      log(`[create-admin] ${mail} için yeni parola ayarlandı; hesap aktif yönetici. Açık oturumları kapatıldı.`);
      return { action: 'reset', id: existing.id, email: mail };
    }

    const adSoyad = (name || '').trim() || 'Sistem Yöneticisi';
    if (adSoyad.length < 2 || adSoyad.length > 150) throw new Error('Ad soyad 2–150 karakter olmalıdır');
    const { rows: inserted } = await client.query(
      `INSERT INTO users (ad_soyad, email, password_hash, role) VALUES ($1, $2, $3, 'ADMIN') RETURNING id`,
      [adSoyad, mail, hash],
    );
    await writeAudit({
      userId: null, action: 'USER_CREATE', entityType: 'USER', entityId: inserted[0].id,
      details: { ad_soyad: adSoyad, email: mail, role: 'ADMIN', via: 'cli' },
    }, client);
    log(`[create-admin] Yönetici oluşturuldu: ${mail}`);
    return { action: 'created', id: inserted[0].id, email: mail };
  });
}

async function main() {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      name: { type: 'string' },
      reset: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (values.help || !values.email) {
    console.log(USAGE);
    process.exitCode = values.help ? 0 : 1;
    return;
  }
  const password = await readPassword(values.email.trim().toLowerCase());
  await createOrResetAdmin({ email: values.email, name: values.name, reset: values.reset, password });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
    .catch((err) => {
      console.error(`[create-admin] Hata: ${err.message}`);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
