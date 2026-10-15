/**
 * Parola kuralları. Hem API (zod şemaları) hem de kurulum betikleri aynı kuralları kullanır.
 */

/**
 * Eski sürümlerin örnek dosyalarında/belgelerinde yer almış veya çok yaygın olan parolalar.
 * Bu parolalar hiçbir hesapta kabul edilmez (karşılaştırma büyük/küçük harf duyarsızdır).
 */
export const KNOWN_WEAK_PASSWORDS = [
  'Admin12345', 'Personel123', 'admin123', 'admin1234', 'admin123456', 'Password1', 'Password123',
  'parola123', 'Parola123', 'sifre123', 'Sifre123', 'qwerty123', '12345678a', 'a12345678', 'changeme123',
  'Zimmet123', 'Zimmet2026',
];
const WEAK_SET = new Set(KNOWN_WEAK_PASSWORDS.map((p) => p.toLowerCase()));

/** Eski sürümde varsayılan olarak kullanılan yönetici ve demo personel parolaları. */
export const LEGACY_DEFAULT_ADMIN_PASSWORD = 'Admin12345';
export const LEGACY_DEMO_PASSWORD = 'Personel123';

export const PASSWORD_MIN_LENGTH = 8;
export const ADMIN_PASSWORD_MIN_LENGTH = 12;

export function isKnownWeakPassword(password) {
  return WEAK_SET.has(String(password).toLowerCase());
}

/**
 * Parolada sorun varsa Türkçe açıklama döner, yoksa null.
 * @param {string} password
 * @param {{ minLength?: number, email?: string }} [opts]
 */
export function passwordProblem(password, { minLength = PASSWORD_MIN_LENGTH, email } = {}) {
  if (typeof password !== 'string' || password.length < minLength) return `Parola en az ${minLength} karakter olmalıdır`;
  if (password.length > 72) return 'Parola en fazla 72 karakter olabilir';
  if (!/[A-Za-zÇĞİÖŞÜçğıöşü]/.test(password)) return 'Parola en az bir harf içermelidir';
  if (!/\d/.test(password)) return 'Parola en az bir rakam içermelidir';
  if (isKnownWeakPassword(password)) return 'Bu parola çok yaygın veya örnek belgelerde geçiyor; başka bir parola seçin';
  const local = email ? String(email).split('@')[0].toLowerCase() : '';
  if (local.length >= 4 && password.toLowerCase().includes(local)) return 'Parola e-posta adresinizi içermemelidir';
  return null;
}
