import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';

/**
 * E-postasız parola kurtarma: her kullanıcıya bir kez gösterilen KURTARMA KODU.
 * Kod veritabanında yalnızca bcrypt özeti olarak tutulur, tek kullanımlıktır;
 * kullanılınca (veya kullanıcı yenileyince) yenisi üretilir ve eskisi geçersiz olur.
 */

// Karıştırılabilecek karakterler (0/O, 1/I/L) yok. 16 karakter ≈ 79 bit.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateRecoveryCode() {
  const chars = [];
  while (chars.length < 16) {
    const b = crypto.randomBytes(1)[0];
    if (b < 248) chars.push(ALPHABET[b % ALPHABET.length]); // 248 = 31*8 → eşit dağılım
  }
  return chars.join('').match(/.{4}/g).join('-');
}

export const normalizeRecoveryCode = (code) => String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Yeni kod üretir, özetini kaydeder ve kodun kendisini (yalnızca bir kez gösterilmek üzere) döner. */
export async function issueRecoveryCode(client, userId) {
  const code = generateRecoveryCode();
  const hash = await bcrypt.hash(normalizeRecoveryCode(code), config.bcryptRounds);
  await client.query(
    'UPDATE users SET recovery_code_hash = $1, recovery_code_created_at = now(), updated_at = now() WHERE id = $2',
    [hash, userId],
  );
  return code;
}

let dummy;
/** Kullanıcı yoksa bile aynı sürede yanıt vermek için sahte karşılaştırma yapılır. */
export async function verifyRecoveryCode(code, hash) {
  dummy ??= bcrypt.hash('dummy-recovery-code', config.bcryptRounds);
  const normalized = normalizeRecoveryCode(code);
  if (!hash || normalized.length !== 16) {
    await bcrypt.compare(normalized || 'x', await dummy);
    return false;
  }
  return bcrypt.compare(normalized, hash);
}
