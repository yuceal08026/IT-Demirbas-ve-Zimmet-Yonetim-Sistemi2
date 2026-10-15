import './setup.js';
import { after, before } from 'node:test';
import { createApp } from '../src/app.js';
import { pool, query } from '../src/db.js';
import { runMigrations } from '../src/scripts/migrate.js';
import { runSeed } from '../src/scripts/seed.js';

let server;
let baseUrl;
let ipCounter = 0;

/** Veritabanını sıfırlar, migration + seed çalıştırır, API'yi rastgele portta başlatır. */
export function useTestServer() {
  before(async () => {
    await query('DROP SCHEMA public CASCADE');
    await query('CREATE SCHEMA public');
    await runMigrations({ log: () => {} });
    await runSeed({ log: () => {} });
    server = createApp().listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  });
}

/**
 * Cookie saklayan basit HTTP istemcisi (tarayıcı gibi davranır).
 * Her istemci farklı bir IP'den geliyormuş gibi görünür (rate limit testleri birbirini etkilemesin).
 */
export function client() {
  const ip = `10.0.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;
  let cookie = '';
  let bearer = null;

  async function request(method, path, body, extraHeaders = {}) {
    const headers = { 'X-Forwarded-For': ip, ...extraHeaders };
    if (cookie) headers.Cookie = cookie;
    if (bearer) headers.Authorization = `Bearer ${bearer}`;
    if (body !== undefined && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const res = await fetch(baseUrl + path, {
      method,
      headers,
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const setCookie = res.headers.getSetCookie?.() || [];
    for (const c of setCookie) {
      const [pair] = c.split(';');
      const value = pair.slice(pair.indexOf('=') + 1);
      cookie = /Expires=Thu, 01 Jan 1970/i.test(c) || value === '' ? '' : pair;
    }
    const type = res.headers.get('content-type') || '';
    // CSV ham bayt olarak okunur: text() UTF-8 BOM'u siler, oysa BOM'un varlığını test ediyoruz.
    const data = type.includes('json') ? await res.json()
      : type.startsWith('text') && !type.includes('csv') ? await res.text()
        : Buffer.from(await res.arrayBuffer());
    return { status: res.status, body: data, headers: res.headers, setCookie };
  }

  return {
    get: (p, h) => request('GET', p, undefined, h),
    post: (p, b = {}, h) => request('POST', p, b, h),
    patch: (p, b = {}, h) => request('PATCH', p, b, h),
    delete: (p, h) => request('DELETE', p, undefined, h),
    raw: request,
    setBearer: (t) => { bearer = t; },
    clearCookie: () => { cookie = ''; },
    get cookie() { return cookie; },
    async login(email, password) {
      const r = await request('POST', '/api/auth/login', { email, password });
      if (r.status !== 200) throw new Error(`login failed ${r.status} ${JSON.stringify(r.body)}`);
      return r.body.user;
    },
  };
}

export const ADMIN_EMAIL = 'admin@test.local';
export const ADMIN_PASSWORD = 'Test-Yonetici-2026';
/** Yöneticinin yeni kullanıcıya verdiği geçici parola ve kullanıcının ilk girişte belirlediği kalıcı parola. */
export const TEMP_PASSWORD = 'Gecici-Parola-42';
export const OWN_PASSWORD = 'Kendi-Parolam-73';

export async function adminClient() {
  const c = client();
  await c.login(ADMIN_EMAIL, ADMIN_PASSWORD);
  return c;
}

let userSeq = 0;
/**
 * Admin istemcisiyle yeni personel oluşturur ve onunla giriş yapmış bir istemci döner.
 * Yöneticinin verdiği parola geçicidir; kullanıcı gerçek akıştaki gibi ilk girişte kendi parolasını belirler
 * (keepTemporaryPassword: true verilirse bu adım atlanır).
 */
export async function createUserClient(admin, overrides = {}, { keepTemporaryPassword = false } = {}) {
  userSeq += 1;
  const payload = {
    ad_soyad: `Personel ${userSeq}`,
    email: `personel${userSeq}-${Date.now()}@test.local`,
    password: TEMP_PASSWORD,
    role: 'USER',
    ...overrides,
  };
  const r = await admin.post('/api/users', payload);
  if (r.status !== 201) throw new Error(`user create failed ${r.status} ${JSON.stringify(r.body)}`);
  const c = client();
  await c.login(payload.email, payload.password);
  if (keepTemporaryPassword) return { client: c, user: r.body, password: payload.password };
  const ch = await c.post('/api/auth/change-password', { current_password: payload.password, new_password: OWN_PASSWORD });
  if (ch.status !== 200) throw new Error(`password change failed ${ch.status} ${JSON.stringify(ch.body)}`);
  return { client: c, user: r.body, password: OWN_PASSWORD };
}

export { query };
