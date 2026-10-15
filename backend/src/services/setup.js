import crypto from 'node:crypto';
import { query } from '../db.js';

/**
 * Tarayıcıdan ilk yönetici kurulumu.
 *
 * Sistemde hiç aktif yönetici yokken site ilk açıldığında kurulum ekranı gösterilir. Siteye ilk ulaşan
 * yabancının kendini yönetici yapmasını önlemek için tek kullanımlık bir KURULUM KODU istenir. Kod yalnızca
 * sunucu kayıtlarına (docker compose logs api) yazılır; yani yalnızca sunucuyu kuran kişi görebilir.
 * Kod bellekte tutulur, API her yeniden başladığında yenilenir ve yönetici oluşturulunca geçersiz olur.
 */

// Karıştırılabilecek karakterler (0/O, 1/I/L) yok.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
let currentCode = null;

function generateCode() {
  const bytes = crypto.randomBytes(12);
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}

const normalize = (code) => String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export async function needsSetup(db = { query }) {
  const { rows } = await db.query("SELECT count(*) AS n FROM users WHERE role = 'ADMIN' AND is_active");
  return rows[0].n === 0;
}

function printBanner(code, log) {
  log('');
  log('==================================================================');
  log('  İLK KURULUM: Sistemde henüz yönetici yok.');
  log('  Tarayıcıda uygulamayı açın ve yönetici hesabınızı oluşturun.');
  log(`  Kurulum kodu:  ${code}`);
  log('  (Kod tek kullanımlıktır; API yeniden başlarsa yeni kod üretilir.)');
  log('==================================================================');
  log('');
}

/**
 * Kurulum gerekiyorsa kodu üretir (varsa aynısını döner) ve yeni üretildiyse sunucu kayıtlarına yazar.
 * Kurulum gerekmiyorsa null döner.
 */
export async function ensureSetupCode(log = console.log) {
  if (!(await needsSetup())) {
    currentCode = null;
    return null;
  }
  if (!currentCode) {
    currentCode = generateCode();
    printBanner(currentCode, log);
  }
  return currentCode;
}

export function verifySetupCode(input) {
  if (!currentCode) return false;
  const a = Buffer.from(normalize(input));
  const b = Buffer.from(normalize(currentCode));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function invalidateSetupCode() {
  currentCode = null;
}
