import { useTestServer, client, adminClient, query, ADMIN_PASSWORD } from './helpers.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { runSeed } from '../src/scripts/seed.js';
import { checkSecurityConfig } from '../src/config.js';

useTestServer();

const backendDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const silent = () => {};

/** Bir betiği ayrı süreçte çalıştırır (gerçek kullanımdaki gibi). */
function runNode(args, env = {}) {
  return new Promise((resolve) => {
    execFile(process.execPath, args, {
      cwd: backendDir,
      env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: process.env.TEST_DATABASE_URL, ...env },
      timeout: 30_000,
    }, (err, stdout, stderr) => resolve({ code: err ? (err.code ?? 1) : 0, stdout, stderr }));
  });
}

async function withEnv(vars, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

const count = async (table) => (await query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n;

describe('Temiz kurulum: örnek (demo) veri yok', () => {
  it('ilk kurulumdan sonra veritabanında yalnızca ilk yönetici vardır; departman, cihaz, zimmet, bakım kaydı yoktur', async () => {
    assert.equal(await count('users'), 1);
    assert.equal(await count('departments'), 0);
    assert.equal(await count('assets'), 0);
    assert.equal(await count('assignments'), 0);
    assert.equal(await count('maintenance_records'), 0);
    const { rows } = await query('SELECT email, role, must_change_password FROM users');
    assert.deepEqual(rows[0], { email: 'admin@test.local', role: 'ADMIN', must_change_password: false });
  });

  it('kurulum tekrar çalıştırılınca hiçbir şey eklenmez veya silinmez; SEED_DEMO_DATA=true yok sayılır', async () => {
    const admin = await adminClient();
    await admin.post('/api/departments', { name: 'Gerçek Departman' });
    const before = await Promise.all(['users', 'departments', 'assets', 'assignments'].map(count));
    const logs = [];
    await withEnv({ SEED_DEMO_DATA: 'true' }, () => runSeed({ log: (m) => logs.push(m) }));
    await runSeed({ log: silent });
    const afterCounts = await Promise.all(['users', 'departments', 'assets', 'assignments'].map(count));
    assert.deepEqual(afterCounts, before);
    assert.ok(logs.some((m) => m.includes('SEED_DEMO_DATA artık desteklenmiyor')));
  });

  it('arayüzde sabit demo hesabı veya örnek veri kaydı yoktur (API boş liste döner)', async () => {
    const admin = await adminClient();
    assert.equal((await admin.get('/api/assets')).body.meta.total, 0);
    assert.equal((await admin.get('/api/assignments?active=all')).body.meta.total, 0);
    const login = await client().post('/api/auth/login', { email: 'ayse.yilmaz@kurum.local', password: 'Personel123' });
    assert.equal(login.status, 401);
  });
});

describe('İlk yönetici oluşturma (INITIAL_ADMIN_*)', () => {
  // Aktif yönetici yokmuş gibi davranmak için mevcut yöneticiyi geçici olarak pasif yaparız (yalnızca test veritabanında).
  before(async () => {
    await query("UPDATE users SET is_active = FALSE WHERE email = 'admin@test.local'");
  });
  after(async () => {
    await query("UPDATE users SET is_active = TRUE WHERE email = 'admin@test.local'");
  });

  it('parola tanımlı değilse yönetici oluşturulmaz, yönerge loglanır', async () => {
    const logs = [];
    const r = await withEnv({ INITIAL_ADMIN_EMAIL: undefined, INITIAL_ADMIN_PASSWORD: undefined },
      () => runSeed({ log: (m) => logs.push(m) }));
    assert.equal(r.created, false);
    assert.ok(logs.join('\n').includes('npm run create-admin'));
  });

  it('zayıf veya bilinen parola reddedilir (eski varsayılan Admin12345 dahil)', async () => {
    for (const pw of ['Admin12345', 'kisa1', 'sadeceharflerden', 'Yonetici12', 'yeniyonetici2026x']) {
      await assert.rejects(
        withEnv({ INITIAL_ADMIN_EMAIL: 'yeniyonetici@test.local', INITIAL_ADMIN_PASSWORD: pw }, () => runSeed({ log: silent })),
        /kabul edilmedi/,
        `parola kabul edilmemeliydi: ${pw}`,
      );
    }
    assert.equal((await query("SELECT count(*) AS n FROM users WHERE email = 'yeniyonetici@test.local'")).rows[0].n, 0);
  });

  it('var olan bir kullanıcı e-postası verilirse sessizce yöneticiye yükseltilmez', async () => {
    const hash = await bcrypt.hash('Herhangi-Parola-1', 4);
    await query("INSERT INTO users (ad_soyad, email, password_hash, role) VALUES ('Var Olan', 'varolan@test.local', $1, 'USER')", [hash]);
    await assert.rejects(
      withEnv({ INITIAL_ADMIN_EMAIL: 'varolan@test.local', INITIAL_ADMIN_PASSWORD: 'Guclu-Yonetici-2026' }, () => runSeed({ log: silent })),
      /otomatik olarak yönetici yapılmadı/,
    );
    const { rows } = await query("SELECT role FROM users WHERE email = 'varolan@test.local'");
    assert.equal(rows[0].role, 'USER');
  });

  it('güçlü parola ve yeni e-posta ile yönetici oluşturulur ve audit log\'a yazılır', async () => {
    const r = await withEnv({ INITIAL_ADMIN_EMAIL: 'ilk.yonetici@test.local', INITIAL_ADMIN_PASSWORD: 'Guclu-Yonetici-2026' },
      () => runSeed({ log: silent }));
    assert.equal(r.created, true);
    const c = client();
    const me = await c.login('ilk.yonetici@test.local', 'Guclu-Yonetici-2026');
    assert.equal(me.role, 'ADMIN');
    const { rows } = await query("SELECT details FROM audit_logs WHERE action_type = 'USER_CREATE' AND details->>'email' = 'ilk.yonetici@test.local'");
    assert.equal(rows[0].details.via, 'initial-setup');
    assert.ok(!JSON.stringify(rows[0].details).includes('Guclu-Yonetici-2026'));
  });
});

describe('Eski sürümden kalan varsayılan parolalar (veri silinmeden)', () => {
  it('demo personel hesabının bilinen parolası geçersiz kılınır; hesap ve zimmet geçmişi korunur', async () => {
    const hash = await bcrypt.hash('Personel123', 4);
    const { rows } = await query(
      "INSERT INTO users (ad_soyad, email, password_hash) VALUES ('Ayşe Yılmaz', 'ayse.yilmaz@kurum.local', $1) RETURNING id",
      [hash],
    );
    const r = await runSeed({ log: silent });
    assert.equal(r.demoInvalidated, 1);
    const login = await client().post('/api/auth/login', { email: 'ayse.yilmaz@kurum.local', password: 'Personel123' });
    assert.equal(login.status, 401);
    const { rows: still } = await query('SELECT id, must_change_password FROM users WHERE id = $1', [rows[0].id]);
    assert.equal(still.length, 1);
    assert.equal(still[0].must_change_password, true);
    // İkinci çalıştırmada tekrar işlem yapılmaz
    assert.equal((await runSeed({ log: silent })).demoInvalidated, 0);
  });

  it('varsayılan parolalı yönetici: üretimde açılış durdurulur, geliştirmede parola değişikliği zorunlu olur', async () => {
    const hash = await bcrypt.hash('Admin12345', 4);
    await query("INSERT INTO users (ad_soyad, email, password_hash, role) VALUES ('Eski Yönetici', 'admin@kurum.local', $1, 'ADMIN')", [hash]);

    await assert.rejects(runSeed({ log: silent, production: true }), /bilinen\/varsayılan bir parola/);

    const r = await runSeed({ log: silent, production: false });
    assert.equal(r.weakAdmins, 1);
    const c = client();
    const user = await c.login('admin@kurum.local', 'Admin12345');
    assert.equal(user.must_change_password, true);
    const blocked = await c.get('/api/users');
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.error.code, 'PASSWORD_CHANGE_REQUIRED');
    const ch = await c.post('/api/auth/change-password', { current_password: 'Admin12345', new_password: 'Yepyeni-Yonetici-77' });
    assert.equal(ch.status, 200);
    assert.equal((await c.get('/api/users')).status, 200);
    assert.equal((await runSeed({ log: silent, production: true })).weakAdmins, 0);
  });
});

describe('create-admin komutu (ayrı süreçte gerçek çalıştırma)', () => {
  it('yeni yönetici oluşturur; aynı e-posta --reset olmadan reddedilir', async () => {
    const ok = await runNode(['src/scripts/createAdmin.js', '--email', 'cli.yonetici@test.local', '--name', 'CLI Yönetici'],
      { ADMIN_PASSWORD: 'Cli-Yonetici-2026' });
    assert.equal(ok.code, 0, ok.stderr);
    assert.match(ok.stdout, /Yönetici oluşturuldu/);
    await client().login('cli.yonetici@test.local', 'Cli-Yonetici-2026');

    const dup = await runNode(['src/scripts/createAdmin.js', '--email', 'cli.yonetici@test.local'], { ADMIN_PASSWORD: 'Cli-Yonetici-2027' });
    assert.notEqual(dup.code, 0);
    assert.match(dup.stderr, /zaten var/);
  });

  it('zayıf parola ve geçersiz e-posta reddedilir; parola istenip TTY yoksa açık hata verir', async () => {
    const weak = await runNode(['src/scripts/createAdmin.js', '--email', 'zayif@test.local'], { ADMIN_PASSWORD: 'Admin12345' });
    assert.notEqual(weak.code, 0);
    assert.match(weak.stderr, /kabul edilmedi/);
    const bad = await runNode(['src/scripts/createAdmin.js', '--email', 'gecersiz'], { ADMIN_PASSWORD: 'Cli-Yonetici-2026' });
    assert.notEqual(bad.code, 0);
    const noTty = await runNode(['src/scripts/createAdmin.js', '--email', 'tty@test.local'], { ADMIN_PASSWORD: '' });
    assert.notEqual(noTty.code, 0);
    assert.match(noTty.stderr, /etkileşimli terminal yok/);
    assert.equal((await query("SELECT count(*) AS n FROM users WHERE email IN ('zayif@test.local','tty@test.local')")).rows[0].n, 0);
  });

  it('--reset: unutulan parolayı sıfırlar, hesabı aktif yönetici yapar, eski oturumları kapatır; veri silinmez', async () => {
    const admin = await adminClient();
    const created = await admin.post('/api/users', { ad_soyad: 'Kurtarılacak Kişi', email: 'kurtar@test.local', password: 'Gecici-Parola-42' });
    const u = client();
    await u.login('kurtar@test.local', 'Gecici-Parola-42');
    const before = await count('users');

    const r = await runNode(['src/scripts/createAdmin.js', '--email', 'kurtar@test.local', '--reset'], { ADMIN_PASSWORD: 'Yeni-Erisim-Sifresi-88' });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(await count('users'), before);
    assert.equal((await u.get('/api/auth/me')).status, 401);
    const me = await client().login('kurtar@test.local', 'Yeni-Erisim-Sifresi-88');
    assert.equal(me.role, 'ADMIN');
    assert.equal(me.must_change_password, false);
    assert.equal(me.id, created.body.id);
  });
});

describe('Üretim ortamı güvenlik ayarları', () => {
  const good = {
    isProduction: true,
    jwt: { secret: 'f3a9c1d27e5b48a6b0c4d8e2f1a7b3c5d9e0f2a4b6c8d0e1', expiresIn: '8h' },
    databaseUrl: 'postgres://zimmet:Uzun-Rastgele-DB-Parolasi-91@db:5432/zimmet',
    appBaseUrl: 'https://zimmet.kurum.gov.tr',
    cookieSecure: true,
    bcryptRounds: 12,
    timezone: 'Europe/Istanbul',
  };
  const errorsOf = (over) => checkSecurityConfig({ ...good, ...over }).errors;

  it('doğru yapılandırmada hata yoktur', () => {
    assert.deepEqual(errorsOf({}), []);
  });

  it('JWT_SECRET eksik, kısa veya örnek değerse başlatılmaz', () => {
    assert.match(errorsOf({ jwt: { secret: '', expiresIn: '8h' } }).join(), /JWT_SECRET tanımlı değil/);
    assert.match(errorsOf({ jwt: { secret: 'kisa', expiresIn: '8h' } }).join(), /32 karakterden kısa/);
    assert.match(errorsOf({ jwt: { secret: 'buraya-degistir-uzun-bir-rastgele-deger-yazin-123', expiresIn: '8h' } }).join(), /yer tutucu/);
  });

  it('veritabanı parolası boş veya bilinen varsayılan ise başlatılmaz', () => {
    assert.match(errorsOf({ databaseUrl: 'postgres://zimmet:zimmet-local-dev@db:5432/zimmet' }).join(), /Veritabanı parolası/);
    assert.match(errorsOf({ databaseUrl: 'postgres://zimmet@db:5432/zimmet' }).join(), /Veritabanı parolası/);
  });

  it('HTTPS adresinde güvenli olmayan çerez ve düşük bcrypt maliyeti reddedilir', () => {
    assert.match(errorsOf({ cookieSecure: false }).join(), /COOKIE_SECURE/);
    assert.match(errorsOf({ bcryptRounds: 4 }).join(), /BCRYPT_ROUNDS/);
    const httpOnly = checkSecurityConfig({ ...good, appBaseUrl: 'http://10.0.0.5:8080', cookieSecure: false });
    assert.deepEqual(httpOnly.errors, []);
    assert.ok(httpOnly.warnings.some((w) => w.includes('COOKIE_SECURE=false')));
  });

  it('geliştirme ortamında JWT_SECRET boş olabilir (geçici rastgele anahtar)', () => {
    assert.deepEqual(checkSecurityConfig({ ...good, isProduction: false, jwt: { secret: '', expiresIn: '8h' } }).errors, []);
  });

  it('sunucu üretimde eksik ayarlarla gerçekten başlamaz (ayrı süreç)', async () => {
    const r = await runNode(['src/server.js'], {
      NODE_ENV: 'production', JWT_SECRET: '', DATABASE_URL: 'postgres://zimmet:zimmet-local-dev@127.0.0.1:1/zimmet', PORT: '0',
    });
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /uygulama başlatılmadı/);
    assert.match(r.stderr, /JWT_SECRET/);
    assert.match(r.stderr, /Veritabanı parolası/);
  });
});

describe('Giriş hız sınırı vekil başlığıyla atlatılamaz', () => {
  it('varsayılan TRUST_PROXY yalnızca yerel/özel ağ vekillerine güvenir', async () => {
    const { config } = await import('../src/config.js');
    assert.equal(config.trustProxy, 'loopback, linklocal, uniquelocal');
  });

  it('başarılı girişler sayaca eklenmez; yönetici normal giriş yapabilir', async () => {
    const c = client();
    for (let i = 0; i < 7; i++) await c.login('admin@test.local', ADMIN_PASSWORD);
  });
});
