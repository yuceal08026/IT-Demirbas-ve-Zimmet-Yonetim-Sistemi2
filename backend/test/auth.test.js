import {
  useTestServer, client, adminClient, createUserClient, query, ADMIN_PASSWORD,
} from './helpers.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

useTestServer();

describe('Kimlik doğrulama (Aşama 3, PRD §7)', () => {
  it('doğru bilgilerle giriş httpOnly + SameSite=Strict cookie verir, token gövdede dönmez', async () => {
    const c = client();
    const r = await c.post('/api/auth/login', { email: 'ADMIN@test.local', password: ADMIN_PASSWORD });
    assert.equal(r.status, 200);
    assert.equal(r.body.user.role, 'ADMIN');
    assert.equal(r.body.token, undefined);
    assert.equal(r.body.user.password_hash, undefined);
    const cookie = r.setCookie.join(';');
    assert.match(cookie, /zimmet_token=/);
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Strict/i);

    const me = await c.get('/api/auth/me');
    assert.equal(me.status, 200);
    assert.equal(me.body.user.email, 'admin@test.local');
  });

  it('hatalı parola ile giriş reddedilir ve aynı genel mesaj döner', async () => {
    const c = client();
    const wrong = await c.post('/api/auth/login', { email: 'admin@test.local', password: 'yanlis-parola1' });
    const unknown = await c.post('/api/auth/login', { email: 'yok@test.local', password: 'yanlis-parola1' });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.body.error.code, 'INVALID_CREDENTIALS');
    assert.equal(unknown.status, 401);
    assert.equal(unknown.body.error.message, wrong.body.error.message);
    assert.equal(c.cookie, '');
  });

  it('başarısız girişler işlem geçmişine parolasız yazılır', async () => {
    const c = client();
    await c.post('/api/auth/login', { email: 'admin@test.local', password: 'GizliDeneme99' });
    const { rows } = await query(
      "SELECT details FROM audit_logs WHERE action_type = 'LOGIN_FAILED' ORDER BY id DESC LIMIT 1",
    );
    assert.equal(rows[0].details.reason, 'wrong_password');
    assert.ok(!JSON.stringify(rows[0].details).includes('GizliDeneme99'));
  });

  it('eksik alanlar 400 VALIDATION_ERROR döner', async () => {
    const r = await client().post('/api/auth/login', { email: 'gecersiz' });
    assert.equal(r.status, 400);
    assert.equal(r.body.error.code, 'VALIDATION_ERROR');
    assert.ok(r.body.error.details.some((d) => d.field === 'email'));
  });

  it('JSON olmayan gövde 415 ile reddedilir (CSRF koruması)', async () => {
    const r = await client().raw('POST', '/api/auth/login', 'email=a&password=b', {
      'Content-Type': 'application/x-www-form-urlencoded',
    });
    assert.equal(r.status, 415);
  });

  it('token olmadan korunan uç 401 döner', async () => {
    const r = await client().get('/api/auth/me');
    assert.equal(r.status, 401);
    assert.equal(r.body.error.code, 'UNAUTHENTICATED');
  });

  it('sahte/bozuk token 401 döner', async () => {
    const c = client();
    c.setBearer('eyJhbGciOiJub25lIn0.eyJzdWIiOiIxIn0.');
    assert.equal((await c.get('/api/auth/me')).status, 401);
  });

  it('logout cookie\'yi temizler, sonrasında /me 401 olur', async () => {
    const c = await adminClient();
    const out = await c.post('/api/auth/logout');
    assert.equal(out.status, 204);
    assert.equal(c.cookie, '');
    assert.equal((await c.get('/api/auth/me')).status, 401);
  });

  it('issueToken=true ile mobil istemci Bearer token alır ve kullanabilir', async () => {
    const c = client();
    const r = await c.post('/api/auth/login', { email: 'admin@test.local', password: ADMIN_PASSWORD, issueToken: true });
    assert.ok(r.body.token);
    const m = client();
    m.setBearer(r.body.token);
    assert.equal((await m.get('/api/auth/me')).status, 200);
  });

  it('pasife alınan kullanıcının açık oturumu anında düşer ve tekrar giriş yapamaz', async () => {
    const admin = await adminClient();
    const { client: u, user, password } = await createUserClient(admin);
    assert.equal((await u.get('/api/auth/me')).status, 200);

    const r = await admin.patch(`/api/users/${user.id}`, { is_active: false });
    assert.equal(r.status, 200);
    assert.equal((await u.get('/api/auth/me')).status, 401);
    const again = await client().post('/api/auth/login', { email: user.email, password });
    assert.equal(again.status, 401);
  });

  it('şifre sıfırlanınca eski oturum geçersiz olur, yeni şifre çalışır', async () => {
    const admin = await adminClient();
    const { client: u, user } = await createUserClient(admin);
    const r = await admin.patch(`/api/users/${user.id}/password`, { password: 'YeniParola42' });
    assert.equal(r.status, 204);
    assert.equal((await u.get('/api/auth/me')).status, 401);
    await client().login(user.email, 'YeniParola42');
  });

  it('art arda başarısız girişler rate limit ile 429 olur', async () => {
    const c = client();
    let last;
    for (let i = 0; i < 6; i++) {
      last = await c.post('/api/auth/login', { email: 'admin@test.local', password: `yanlis${i}x` });
    }
    assert.equal(last.status, 429);
    assert.equal(last.body.error.code, 'TOO_MANY_REQUESTS');
  });
});
