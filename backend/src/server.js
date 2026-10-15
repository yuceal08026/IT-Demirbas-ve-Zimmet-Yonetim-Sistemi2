import { createApp } from './app.js';
import { config, assertSecurityConfig } from './config.js';
import { pool } from './db.js';
import { ensureSetupCode } from './services/setup.js';

assertSecurityConfig();

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`[api] ${config.nodeEnv} modunda http://localhost:${config.port} adresinde çalışıyor`);
  // Hiç yönetici yoksa tarayıcıdan kurulum için tek kullanımlık kod üretilip kayıtlara yazılır.
  ensureSetupCode().catch((err) => console.error('[setup] Kurulum durumu okunamadı:', err.message));
});

// Docker durdurduğunda açık istekleri bitirip bağlantıları kapat.
function shutdown(signal) {
  console.log(`[api] ${signal} alındı, kapatılıyor...`);
  server.close(() => {
    pool.end().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
