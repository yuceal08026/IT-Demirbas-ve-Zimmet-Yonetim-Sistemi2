import { useTestServer, client, adminClient, createUserClient, query, ADMIN_EMAIL, ADMIN_PASSWORD } from './helpers.js';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

useTestServer();

const reg = (over = {}) => ({ ad_soyad: 'Kayıt Olan Kişi', email: `kisi${Date.now()}${Math.random().toString(36).slice(2, 6)}@uni.test.edu.tr`, password: 'Kendi-Sifrem-2026', ...over });

describe('Kendi kendine kayıt (yalnızca kurum e-postası, yönetici onaylı)', () => {
  let admin;
  before(async () => {
    admin = await adminClient();
  });

  it('kayıt açık bilgisi ve izin verilen alan adı döner', async () => {
    const r = await client().get('/api/auth/registration');
    assert.deepEqual(r.body, { enabled: true, domains: ['uni.test.edu.tr'] });
  });

  it('kurum dışı e-posta, zayıf parola ve mevcut e-posta reddedilir', async () => {
    assert.equal((await client().post('/api/auth/register', reg({ email: 'biri@gmail.com' }))).status, 400);
    assert.equal((await client().post('/api/auth/register', reg({ email: 'biri@uni.test.edu.tr.kotu.com' }))).status, 400);
    assert.equal((await client().post('/api/auth/register', reg({ password: 'Personel123' }))).status, 400);
    const body = reg();
    assert.equal((await client().post('/api/auth/register', body)).status, 201);
    const dup = await client().post('/api/auth/register', { ...body, email: body.email.toUpperCase() });
    assert.equal(dup.status, 409);
  });

  it('kayıt kurtarma kodu döner (bir kez); onaylanmadan giriş yapılamaz, listede ve zimmet seçiminde görünmez', async () => {
    const body = reg();
    const r = await client().post('/api/auth/register', body);
    assert.equal(r.status, 201);
    assert.match(r.body.recovery_code, /^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/);
    const { rows } = await query('SELECT role, is_approved, recovery_code_hash FROM users WHERE email = $1', [body.email]);
    assert.equal(rows[0].role, 'USER');
    assert.equal(rows[0].is_approved, false);
    assert.notEqual(rows[0].recovery_code_hash, r.body.recovery_code);

    const login = await client().post('/api/auth/login', { email: body.email, password: body.password, portal: 'USER' });
    assert.equal(login.status, 403);
    assert.equal(login.body.error.code, 'ACCOUNT_PENDING');
    // Hatalı parolada onay durumu sızdırılmaz
    assert.equal((await client().post('/api/auth/login', { email: body.email, password: 'Yanlis-Parola-9' })).status, 401);

    const active = await admin.get('/api/users?is_active=true&limit=100');
    assert.ok(!active.body.data.some((u) => u.email === body.email));
    const pending = await admin.get('/api/users?approval=pending');
    const p = pending.body.data.find((u) => u.email === body.email);
    assert.ok(p);
    const asset = (await admin.post('/api/assets', { category: 'Monitör', brand: 'Dell', model: 'P24', serial_number: `REG-${Date.now()}` })).body;
    const asg = await admin.post('/api/assignments', { asset_id: asset.id, user_id: p.id });
    assert.equal(asg.status, 409);
    assert.equal(asg.body.error.code, 'USER_NOT_APPROVED');
  });

  it('yönetici onaylayınca kişi giriş yapar (parola değişikliği istenmez); reddedilen kayıt silinir', async () => {
    const dept = (await admin.post('/api/departments', { name: `Fakülte ${Date.now()}` })).body;
    const a = reg();
    const b = reg();
    await client().post('/api/auth/register', a);
    await client().post('/api/auth/register', b);
    const pending = (await admin.get('/api/users?approval=pending&limit=100')).body.data;
    const ua = pending.find((u) => u.email === a.email);
    const ub = pending.find((u) => u.email === b.email);

    const ok = await admin.post(`/api/users/${ua.id}/approve`, { department_id: dept.id });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.department_name, dept.name);
    assert.equal((await admin.post(`/api/users/${ua.id}/approve`, {})).status, 409);
    const c = client();
    const me = await c.login(a.email, a.password);
    assert.equal(me.must_change_password, false);
    assert.equal(me.has_recovery_code, true);
    assert.equal((await c.get('/api/me/assignments')).status, 200);

    assert.equal((await admin.post(`/api/users/${ub.id}/reject`)).status, 204);
    assert.equal((await query('SELECT count(*) AS n FROM users WHERE email = $1', [b.email])).rows[0].n, 0);
    assert.equal((await admin.post(`/api/users/${ua.id}/reject`)).status, 409);
  });

  it('personel onay/ret uçlarını kullanamaz; kendini onaylayamaz', async () => {
    const body = reg();
    await client().post('/api/auth/register', body);
    const id = (await query('SELECT id FROM users WHERE email = $1', [body.email])).rows[0].id;
    const { client: u } = await createUserClient(admin);
    assert.equal((await u.post(`/api/users/${id}/approve`, {})).status, 403);
    assert.equal((await u.get('/api/users?approval=pending')).status, 403);
  });
});

describe('Kurtarma koduyla e-postasız parola yenileme', () => {
  let admin;
  before(async () => {
    admin = await adminClient();
  });

  async function approvedUser() {
    const body = reg();
    const r = await client().post('/api/auth/register', body);
    const id = (await query('SELECT id FROM users WHERE email = $1', [body.email])).rows[0].id;
    await admin.post(`/api/users/${id}/approve`, {});
    return { ...body, id, code: r.body.recovery_code };
  }

  it('doğru e-posta + kod ile parola değişir, eski oturumlar kapanır, kod tek kullanımlıktır ve yenisi verilir', async () => {
    const u = await approvedUser();
    const old = client();
    await old.login(u.email, u.password);

    const r = await client().post('/api/auth/recover', { email: u.email, recovery_code: u.code.toLowerCase().replace(/-/g, ' '), new_password: 'Unuttum-Yeniledim-7' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.match(r.body.recovery_code, /^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/);
    assert.notEqual(r.body.recovery_code, u.code);

    assert.equal((await old.get('/api/auth/me')).status, 401);
    assert.equal((await client().post('/api/auth/login', { email: u.email, password: u.password })).status, 401);
    await client().login(u.email, 'Unuttum-Yeniledim-7');

    const reuse = await client().post('/api/auth/recover', { email: u.email, recovery_code: u.code, new_password: 'Baska-Parola-88' });
    assert.equal(reuse.status, 400);
    assert.equal(reuse.body.error.code, 'INVALID_RECOVERY');
    assert.equal((await client().post('/api/auth/recover', { email: u.email, recovery_code: r.body.recovery_code, new_password: 'Baska-Parola-88' })).status, 200);
  });

  it('yanlış kod / bilinmeyen e-posta aynı hatayı verir; zayıf yeni parola reddedilir; deneme sınırı vardır', async () => {
    const u = await approvedUser();
    const wrong = await client().post('/api/auth/recover', { email: u.email, recovery_code: 'AAAA-BBBB-CCCC-DDDD', new_password: 'Yeni-Parola-123' });
    const unknown = await client().post('/api/auth/recover', { email: 'yok@uni.test.edu.tr', recovery_code: 'AAAA-BBBB-CCCC-DDDD', new_password: 'Yeni-Parola-123' });
    assert.equal(wrong.status, 400);
    assert.deepEqual(wrong.body, unknown.body);
    assert.equal((await client().post('/api/auth/recover', { email: u.email, recovery_code: u.code, new_password: 'Admin12345' })).status, 400);
    await client().login(u.email, u.password); // parola değişmedi

    const c = client();
    let last;
    for (let i = 0; i < 6; i++) last = await c.post('/api/auth/recover', { email: u.email, recovery_code: `XXXX-XXXX-XXXX-XX${i}X`, new_password: 'Yeni-Parola-123' });
    assert.equal(last.status, 429);
  });

  it('yönetici de kendi parolasını kurtarma koduyla yeniler (yöneticiye talep gerekmez)', async () => {
    const c = await adminClient();
    const r = await c.post('/api/auth/recovery-code', { current_password: ADMIN_PASSWORD });
    assert.equal(r.status, 200);
    const rec = await client().post('/api/auth/recover', { email: ADMIN_EMAIL, recovery_code: r.body.recovery_code, new_password: 'Yonetici-Yeni-Sifre-1' });
    assert.equal(rec.status, 200);
    await client().login(ADMIN_EMAIL, 'Yonetici-Yeni-Sifre-1');
    // diğer testler için eski parolaya dön
    const back = await client().post('/api/auth/recover', { email: ADMIN_EMAIL, recovery_code: rec.body.recovery_code, new_password: ADMIN_PASSWORD });
    assert.equal(back.status, 200);
    // Parola yenilenince yöneticinin eski oturumları kapanır (beklenen); sonraki testler için yeniden giriş yapılır.
    assert.equal((await admin.get('/api/users')).status, 401);
    admin = await adminClient();
  });

  it('kurtarma kodu yenilemek mevcut parola ister; eski kod geçersiz olur; kod veritabanında düz metin tutulmaz', async () => {
    const u = await approvedUser();
    const c = client();
    await c.login(u.email, u.password);
    assert.equal((await c.post('/api/auth/recovery-code', { current_password: 'Yanlis-Parola-1' })).status, 400);
    const r = await c.post('/api/auth/recovery-code', { current_password: u.password });
    assert.equal(r.status, 200);
    assert.equal((await client().post('/api/auth/recover', { email: u.email, recovery_code: u.code, new_password: 'Yeni-Parola-123' })).status, 400);
    const { rows } = await query('SELECT recovery_code_hash FROM users WHERE id = $1', [u.id]);
    assert.match(rows[0].recovery_code_hash, /^\$2[aby]\$/);
    const { rows: logs } = await query("SELECT details::text AS t FROM audit_logs WHERE entity_id = $1 AND entity_type = 'USER'", [u.id]);
    assert.ok(logs.every((l) => !l.t.includes(r.body.recovery_code) && !l.t.includes(u.code)));
  });

  it('yöneticinin eklediği kişi ilk parola değişikliğinde kurtarma kodunu alır', async () => {
    const { user } = await createUserClient(admin, {}, { keepTemporaryPassword: true });
    const c = client();
    await c.login(user.email, 'Gecici-Parola-42');
    const r = await c.post('/api/auth/change-password', { current_password: 'Gecici-Parola-42', new_password: 'Ilk-Kendi-Parolam-5' });
    assert.equal(r.status, 200);
    assert.match(r.body.recovery_code, /^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/);
    assert.equal(r.body.user.has_recovery_code, true);
    const again = await c.post('/api/auth/change-password', { current_password: 'Ilk-Kendi-Parolam-5', new_password: 'Ikinci-Parolam-66' });
    assert.equal(again.body.recovery_code, undefined);
  });
});
