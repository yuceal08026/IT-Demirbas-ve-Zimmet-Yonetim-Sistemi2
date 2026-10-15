import {
  useTestServer, client, adminClient, createUserClient, query, TEMP_PASSWORD, OWN_PASSWORD,
} from './helpers.js';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

useTestServer();

describe('Geçici parola ve kullanıcının kendi parolasını değiştirmesi', () => {
  let admin;
  before(async () => {
    admin = await adminClient();
  });

  it('yöneticinin verdiği parola geçicidir: girişte bayrak döner, parola değişmeden veri uçları 403 verir', async () => {
    const { client: u, user } = await createUserClient(admin, {}, { keepTemporaryPassword: true });
    assert.equal(user.must_change_password, true);

    const me = await u.get('/api/auth/me');
    assert.equal(me.status, 200);
    assert.equal(me.body.user.must_change_password, true);

    for (const path of ['/api/me/assignments', '/api/assets', '/api/users']) {
      const r = await u.get(path);
      assert.equal(r.status, 403, path);
      assert.equal(r.body.error.code, 'PASSWORD_CHANGE_REQUIRED', path);
    }
  });

  it('hatalı mevcut parola, aynı parola, zayıf parola ve e-postayı içeren parola reddedilir', async () => {
    const { user } = await createUserClient(admin, { email: 'degistiren.kisi@test.local' }, { keepTemporaryPassword: true });
    const tries = [
      [{ current_password: 'yanlis-parola-1', new_password: OWN_PASSWORD }, 'current_password'],
      [{ current_password: TEMP_PASSWORD, new_password: TEMP_PASSWORD }, 'new_password'],
      [{ current_password: TEMP_PASSWORD, new_password: 'kisa1' }, 'new_password'],
      [{ current_password: TEMP_PASSWORD, new_password: 'Personel123' }, 'new_password'],
      [{ current_password: TEMP_PASSWORD, new_password: 'degistiren.kisi2026' }, 'new_password'],
      [{ current_password: TEMP_PASSWORD }, 'new_password'],
    ];
    for (const [body, field] of tries) {
      // Her deneme ayrı istemciden (ayrı IP) yapılır; hız sınırı bu testi etkilemesin.
      const u = client();
      await u.login(user.email, TEMP_PASSWORD);
      const r = await u.post('/api/auth/change-password', body);
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.ok(r.body.error.details.some((d) => d.field === field), JSON.stringify(r.body));
    }
    const { rows } = await query('SELECT must_change_password FROM users WHERE id = $1', [user.id]);
    assert.equal(rows[0].must_change_password, true);
  });

  it('başarılı değişiklik: bayrak kalkar, yeni çerez verilir, diğer oturumlar kapanır, eski parola çalışmaz', async () => {
    const { client: u, user } = await createUserClient(admin, {}, { keepTemporaryPassword: true });
    const other = client();
    await other.login(user.email, TEMP_PASSWORD);

    const r = await u.post('/api/auth/change-password', { current_password: TEMP_PASSWORD, new_password: 'Yeni-Kalici-Parola-5' });
    assert.equal(r.status, 200);
    assert.equal(r.body.user.must_change_password, false);
    assert.match(r.setCookie.join(';'), /zimmet_token=.+HttpOnly/i);
    assert.equal(r.body.token, undefined);

    assert.equal((await u.get('/api/me/assignments')).status, 200);
    assert.equal((await other.get('/api/auth/me')).status, 401);
    assert.equal((await client().post('/api/auth/login', { email: user.email, password: TEMP_PASSWORD })).status, 401);
    await client().login(user.email, 'Yeni-Kalici-Parola-5');

    const { rows } = await query("SELECT details FROM audit_logs WHERE action_type = 'USER_PASSWORD_CHANGE' AND entity_id = $1", [user.id]);
    assert.equal(rows.length, 1);
    assert.ok(!JSON.stringify(rows[0].details).includes('Yeni-Kalici-Parola-5'));
  });

  it('Bearer token kullanan istemci yeni token alır; eski token geçersiz olur', async () => {
    const { user } = await createUserClient(admin);
    const login = await client().post('/api/auth/login', { email: user.email, password: OWN_PASSWORD, issueToken: true });
    const m = client();
    m.setBearer(login.body.token);
    const r = await m.post('/api/auth/change-password', { current_password: OWN_PASSWORD, new_password: 'Mobil-Parola-2026' });
    assert.equal(r.status, 200);
    assert.ok(r.body.token);
    assert.equal((await m.get('/api/auth/me')).status, 401);
    m.setBearer(r.body.token);
    assert.equal((await m.get('/api/auth/me')).status, 200);
  });

  it('yönetici parolayı sıfırlayınca kullanıcı yeniden değiştirmek zorunda kalır', async () => {
    const { user } = await createUserClient(admin);
    assert.equal((await admin.patch(`/api/users/${user.id}/password`, { password: 'Sifirlanan-Parola-3' })).status, 204);
    const u = client();
    const me = await u.login(user.email, 'Sifirlanan-Parola-3');
    assert.equal(me.must_change_password, true);
    assert.equal((await u.get('/api/me/assignments')).body.error.code, 'PASSWORD_CHANGE_REQUIRED');
  });

  it('oturum açmadan parola değiştirilemez; art arda hatalı denemeler hız sınırına takılır', async () => {
    const anon = await client().post('/api/auth/change-password', { current_password: 'x', new_password: 'Yeni-Parola-123' });
    assert.equal(anon.status, 401);

    const { client: u } = await createUserClient(admin);
    let last;
    for (let i = 0; i < 6; i++) {
      last = await u.post('/api/auth/change-password', { current_password: `tahmin-${i}`, new_password: 'Yeni-Parola-123' });
    }
    assert.equal(last.status, 429);
  });

  it('yönetici panelinden oluşturulan ve sıfırlanan kullanıcılar için zayıf/bilinen parolalar reddedilir', async () => {
    for (const pw of ['Admin12345', 'Personel123', 'parola123']) {
      const r = await admin.post('/api/users', { ad_soyad: 'Zayıf Parola', email: `zayif-${pw}@test.local`, password: pw });
      assert.equal(r.status, 400, pw);
    }
  });
});
