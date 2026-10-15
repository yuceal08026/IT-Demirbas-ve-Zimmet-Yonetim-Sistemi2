import pg from 'pg';
import { config } from './config.js';

const { Pool, types } = pg;

// DATE sütunları saat dilimi kaymasına uğramasın diye "YYYY-MM-DD" metni olarak döner.
types.setTypeParser(1082, (value) => value);
// COUNT(*) gibi bigint sonuçları JS number'a çevrilir (bu uygulamada 2^53'ü aşmaz).
types.setTypeParser(20, (value) => Number(value));

// Oturum saat dilimi kurumun saat dilimine ayarlanır: current_date, ::date dönüşümleri ve
// tarih filtreleri (ör. "teslim tarihi 14 Ekim") UTC'ye göre değil, kurum saatine göre hesaplanır.
// Değer config'te doğrulanır (yalnızca harf, rakam, _ + - /); yine de güvenli tarafta kalmak için burada da süzülür.
const safeTimezone = /^[A-Za-z0-9_+\-/]+$/.test(config.timezone) ? config.timezone : 'UTC';

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  options: `-c timezone=${safeTimezone}`,
});

pool.on('error', (err) => {
  // Boştaki bir bağlantı koparsa süreç çökmesin; sadece loglanır.
  console.error('[db] Beklenmeyen havuz hatası:', err.message);
});

/** Parametreli sorgu. Kullanıcı girdisi asla SQL metnine eklenmez. */
export function query(text, params = []) {
  return pool.query(text, params);
}

/**
 * Bir işlevi tek bir transaction içinde çalıştırır.
 * İşlev hata fırlatırsa ROLLBACK, aksi hâlde COMMIT yapılır.
 * @param {(client: pg.PoolClient) => Promise<T>} fn
 * @returns {Promise<T>}
 * @template T
 */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function pingDatabase() {
  await pool.query('SELECT 1');
}
