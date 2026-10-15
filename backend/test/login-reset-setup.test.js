import {
  useTestServer, client, adminClient, createUserClient, query, ADMIN_EMAIL, ADMIN_PASSWORD, OWN_PASSWORD,
} from './helpers.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { ensureSetupCode } from '../src/services/setup.js';

useTestServer();

describe('Giriş sekmeleri (Personel / Yönetici)', () => {
  let admin;
  before(async () => {
    admin = await adminClient();
  });

  it('yönetici "Personel girişi"nden, personel "Yönetici girişi"nden giremez; oturum açılmaz ve doğru sekme söylenir', async () => {
    const { user } = await createUserClient(admin);
    const a = client();
    const r1 = await a.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, portal: 'USER' });
    assert.equal(r1.status, 403);
    assert.equal(r1.body.error.code, 'WRONG_PORTAL');
    assert.match(r1.body.error.message, /Yönetici girişi/);
    assert.equal(a.cookie, '');

    const u = client();
    const r2 = await u.post('/api/auth/login', { email: user.email, password: OWN_PASSWORD, portal: 'ADMIN' });
    assert.equal(r2.status, 403);
    assert.match(r2.body.error.message, /Personel girişi/);
    assert.equal(u.cookie, '');
  });

  it('doğru sekmeden giriş çalışır; hatalı parolada sekme bilgisi sızdırılmaz', async () => {
    const { user } = await createUserClient(admin);
    assert.equal((await client().post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, portal: 'ADMIN' })).status, 200);
    assert.equal((await client().post('/api/auth/login', { email: user.email, password: OWN_PASSWORD, portal: 'USER' })).status, 200);
    const wrong = await client().post('/api/auth/login', { email: user.email, password: 'Yanlis-Parola-1', portal: 'ADMIN' });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.body.error.code, 'INVALID_CREDENTIALS');
  });
});

describe('Şifremi unuttum → yönetici geçici parola verir', () => {
  let admin;
  before(async () => {
    admin = await adminClient();
  });

  it('kayıtlı ve kayıtsız e-posta için aynı yanıt döner; yalnızca kayıtlı aktif kullanıcıya talep açılır, talepler yığılmaz', async () => {
    const { user } = await createUserClient(admin);
    const known = await client().post('/api/auth/forgot-password', { email: user.email });
    const unknown = await client().post('/api/auth/forgot-password', { email: 'olmayan.kisi@test.local' });
    assert.equal(known.status, 202);
    assert.equal(unknown.status, 202);
    assert.equal(known.body.message, unknown.body.message);
    await client().post('/api/auth/forgot-password', { email: user.email.toUpperCase() });

    const list = await admin.get('/api/password-reset-requests');
    const mine = list.body.data.filter((r) => r.user.id === user.id);
    assert.equal(mine.length, 1);
    assert.equal((await query("SELECT count(*) AS n FROM password_reset_requests")).rows[0].n >= 1, true);
    // Kişinin parolası talep yüzünden değişmez
    await client().login(user.email, OWN_PASSWORD);
  });

  it('yönetici geçici parola verir: talep kapanır, kişi geçici parolayla girip kendi parolasını belirlemek zorunda kalır', async () => {
    const { user, client: oldSession } = await createUserClient(admin);
    await client().post('/api/auth/forgot-password', { email: user.email });
    const reqId = (await admin.get('/api/password-reset-requests')).body.data.find((r) => r.user.id === user.id).id;

    const bad = await admin.post(`/api/password-reset-requests/${reqId}/resolve`, { password: 'Personel123' });
    assert.equal(bad.status, 400);
    assert.equal((await admin.post(`/api/password-reset-requests/${reqId}/resolve`, { password: 'Gecici-Yeni-55' })).status, 204);

    assert.equal((await oldSession.get('/api/auth/me')).status, 401);
    const u = client();
    const me = await u.login(user.email, 'Gecici-Yeni-55');
    assert.equal(me.must_change_password, true);
    assert.equal((await u.post('/api/auth/change-password', { current_password: 'Gecici-Yeni-55', new_password: 'Benim-Yeni-Parolam-8' })).status, 200);

    const closed = await admin.get('/api/password-reset-requests?status=RESOLVED');
    assert.ok(closed.body.data.some((r) => r.id === reqId && r.resolved_by));
    assert.equal((await admin.post(`/api/password-reset-requests/${reqId}/resolve`, { password: 'Gecici-Yeni-56' })).status, 409);
  });

  it('talep reddedilebilir; parola değişmez. Personel sayfasından sıfırlama bekleyen talebi de kapatır', async () => {
    const { user } = await createUserClient(admin);
    await client().post('/api/auth/forgot-password', { email: user.email });
    let reqId = (await admin.get('/api/password-reset-requests')).body.data.find((r) => r.user.id === user.id).id;
    assert.equal((await admin.post(`/api/password-reset-requests/${reqId}/reject`)).status, 204);
    await client().login(user.email, OWN_PASSWORD);

    await client().post('/api/auth/forgot-password', { email: user.email });
    reqId = (await admin.get('/api/password-reset-requests')).body.data.find((r) => r.user.id === user.id).id;
    assert.equal((await admin.patch(`/api/users/${user.id}/password`, { password: 'Panelden-Verilen-4' })).status, 204);
    const { rows } = await query('SELECT status FROM password_reset_requests WHERE id = $1', [reqId]);
    assert.equal(rows[0].status, 'RESOLVED');
  });

  it('dashboard bekleyen talep sayısını gösterir; personel talepleri göremez', async () => {
    const { user, client: u } = await createUserClient(admin);
    await client().post('/api/auth/forgot-password', { email: user.email });
    const stats = await admin.get('/api/dashboard/stats');
    assert.ok(stats.body.pending_password_requests >= 1);
    assert.equal((await u.get('/api/password-reset-requests')).status, 403);
  });

  it('art arda talepler hız sınırına takılır', async () => {
    const c = client();
    let last;
    for (let i = 0; i < 7; i++) last = await c.post('/api/auth/forgot-password', { email: `spam${i}@test.local` });
    assert.equal(last.status, 429);
  });
});

describe('Tarayıcıdan ilk kurulum (kurulum koduyla)', () => {
  before(async () => {
    // Yönetici yokmuş gibi: test yöneticisini geçici olarak pasif yaparız (yalnızca test veritabanında).
    await query("UPDATE users SET is_active = FALSE WHERE role = 'ADMIN'");
  });
  after(async () => {
    await query(`UPDATE users SET is_active = TRUE WHERE email = '${ADMIN_EMAIL}'`);
  });

  it('yönetici yokken kurulum gerekir; yanlış kod, zayıf parola reddedilir; doğru kodla yönetici oluşur ve oturum açılır', async () => {
    const status = await client().get('/api/setup/status');
    assert.equal(status.body.needs_setup, true);
    const code = await ensureSetupCode(() => {});
    assert.match(code, /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);

    const body = { ad_soyad: 'Kurulum Yöneticisi', email: 'kurulum@test.local', password: 'Ilk-Yonetici-Sifre-26' };
    const wrong = await client().post('/api/setup/admin', { ...body, setup_code: 'AAAA-BBBB-CCCC' });
    assert.equal(wrong.status, 403);
    assert.equal(wrong.body.error.code, 'INVALID_SETUP_CODE');
    const weak = await client().post('/api/setup/admin', { ...body, setup_code: code, password: 'Admin12345' });
    assert.equal(weak.status, 400);

    const c = client();
    const ok = await c.post('/api/setup/admin', { ...body, setup_code: code.toLowerCase() });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.user.role, 'ADMIN');
    assert.equal((await c.get('/api/users')).status, 200);

    assert.equal((await client().get('/api/setup/status')).body.needs_setup, false);
    const again = await client().post('/api/setup/admin', { ...body, email: 'ikinci@test.local', setup_code: code });
    assert.equal(again.status, 409);
    assert.equal(again.body.error.code, 'SETUP_DONE');
  });

  it('yönetici varken kurulum ekranı kapalıdır ve kod üretilmez', async () => {
    assert.equal(await ensureSetupCode(() => {}), null);
    assert.equal((await client().get('/api/setup/status')).body.needs_setup, false);
  });
});
