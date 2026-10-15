/**
 * Test ortamı. Bu dosya her test dosyasında İLK import olmalıdır; config modülü
 * yüklenmeden önce ortam değişkenlerini ayarlar.
 *
 * Gerekli: TEST_DATABASE_URL — adı "_test" ile biten, silinmesinde sakınca olmayan bir veritabanı.
 *   örn. postgres://zimmet:parola@localhost:5432/zimmet_test
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-'.padEnd(48, 'x');
process.env.JWT_EXPIRES_IN = '1h';
process.env.BCRYPT_ROUNDS = '4';
process.env.APP_BASE_URL = 'http://zimmet.test';
// İlk yönetici, uygulamanın gerçek ilk kurulum yöntemiyle (INITIAL_ADMIN_*) oluşturulur. Örnek veri yoktur.
process.env.INITIAL_ADMIN_EMAIL = 'admin@test.local';
process.env.INITIAL_ADMIN_PASSWORD = 'Test-Yonetici-2026';
process.env.INITIAL_ADMIN_NAME = 'Test Yönetici';
delete process.env.SEED_ADMIN_EMAIL;
delete process.env.SEED_ADMIN_PASSWORD;
delete process.env.SEED_DEMO_DATA;
process.env.APP_TIMEZONE = 'Europe/Istanbul';
process.env.REGISTRATION_EMAIL_DOMAINS = 'uni.test.edu.tr';
process.env.LOGIN_RATE_LIMIT_MAX = '5';

if (!process.env.TEST_DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL tanımlı değil (bkz. README › Testler).');
}
const dbName = new URL(process.env.TEST_DATABASE_URL).pathname.slice(1);
if (!dbName.endsWith('_test')) {
  throw new Error(`Güvenlik: test veritabanı adı "_test" ile bitmeli (şu an: ${dbName}). Testler veritabanını siler.`);
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
