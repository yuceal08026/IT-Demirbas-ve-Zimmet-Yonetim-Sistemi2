import { useTestServer, adminClient, createUserClient, query } from './helpers.js';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

useTestServer();

describe('Kullanıcı ve departman yönetimi (Aşama 3)', () => {
  let admin;
  before(async () => {
    admin = await adminClient();
  });

  it('standart kullanıcı tüm yönetici uçlarında 403 alır (PRD §7 yetki ihlali)', async () => {
    const { client: u, user } = await createUserClient(admin);
    const calls = [
      u.get('/api/users'),
      u.get(`/api/users/${user.id}`),
      u.post('/api/users', { ad_soyad: 'X Y', email: 'x@test.local', password: 'Gecerli-Parola-9' }),
      u.patch(`/api/users/${user.id}`, { role: 'ADMIN' }),
      u.patch(`/api/users/${user.id}/password`, { password: 'Gecerli-Parola-9' }),
      u.delete(`/api/users/${user.id}`),
      u.get('/api/departments'),
      u.post('/api/departments', { name: 'Hack' }),
    ];
    for (const r of await Promise.all(calls)) {
      assert.equal(r.status, 403, JSON.stringify(r.body));
      assert.equal(r.body.error.code, 'FORBIDDEN');
    }
    // Kendini admin yapamadı
    const { rows } = await query('SELECT role FROM users WHERE id = $1', [user.id]);
    assert.equal(rows[0].role, 'USER');
  });

  it('kullanıcı oluşturur; parola bcrypt ile özetlenir, yanıtta hash yoktur', async () => {
    const r = await admin.post('/api/users', {
      ad_soyad: '  Deniz Aydın ', email: 'Deniz.Aydin@Test.local', password: 'Gecerli-Parola-9', role: 'USER',
    });
    assert.equal(r.status, 201);
    assert.equal(r.body.ad_soyad, 'Deniz Aydın');
    assert.equal(r.body.email, 'deniz.aydin@test.local');
    assert.equal(r.body.password_hash, undefined);
    assert.equal(r.body.token_version, undefined);
    const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [r.body.id]);
    assert.notEqual(rows[0].password_hash, 'Gecerli-Parola-9');
    assert.match(rows[0].password_hash, /^\$2[aby]\$/);
  });

  it('aynı e-posta (büyük/küçük harf farkıyla) ikinci kez eklenemez', async () => {
    await admin.post('/api/users', { ad_soyad: 'Can Er', email: 'can@test.local', password: 'Gecerli-Parola-9' });
    const r = await admin.post('/api/users', { ad_soyad: 'Can Er 2', email: 'CAN@test.local', password: 'Gecerli-Parola-9' });
    assert.equal(r.status, 409);
    assert.equal(r.body.error.code, 'DUPLICATE_EMAIL');
  });

  it('zayıf parola ve geçersiz rol backend\'de reddedilir', async () => {
    const weak = await admin.post('/api/users', { ad_soyad: 'Ali Veli', email: 'ali@test.local', password: 'kisa' });
    assert.equal(weak.status, 400);
    assert.ok(weak.body.error.details.some((d) => d.field === 'password'));
    const noDigit = await admin.post('/api/users', { ad_soyad: 'Ali Veli', email: 'ali@test.local', password: 'sadeceharf' });
    assert.equal(noDigit.status, 400);
    const badRole = await admin.post('/api/users', { ad_soyad: 'Ali Veli', email: 'ali@test.local', password: 'Gecerli-Parola-9', role: 'ROOT' });
    assert.equal(badRole.status, 400);
  });

  it('listede arama, filtre, sıralama ve sayfalama birlikte çalışır', async () => {
    for (let i = 0; i < 5; i++) {
      await admin.post('/api/users', { ad_soyad: `Sayfa Testi ${i}`, email: `sayfa${i}@test.local`, password: 'Gecerli-Parola-9' });
    }
    const p1 = await admin.get('/api/users?search=sayfa%20testi&sort=ad_soyad&order=asc&limit=2&page=1&role=USER');
    assert.equal(p1.status, 200);
    assert.equal(p1.body.meta.total, 5);
    assert.equal(p1.body.meta.totalPages, 3);
    assert.deepEqual(p1.body.data.map((u) => u.ad_soyad), ['Sayfa Testi 0', 'Sayfa Testi 1']);
    const p3 = await admin.get('/api/users?search=sayfa%20testi&sort=ad_soyad&order=asc&limit=2&page=3');
    assert.deepEqual(p3.body.data.map((u) => u.ad_soyad), ['Sayfa Testi 4']);
  });

  it('beyaz liste dışı sıralama alanı 400 döner (SQL enjeksiyonu yok)', async () => {
    const r = await admin.get('/api/users?sort=password_hash;DROP%20TABLE%20users');
    assert.equal(r.status, 400);
    const s = await admin.get(`/api/users?search=${encodeURIComponent("' OR 1=1 --")}`);
    assert.equal(s.status, 200);
    assert.equal(s.body.meta.total, 0);
  });

  it('yönetici kendini pasife alamaz, rolünü düşüremez, silemez', async () => {
    const me = (await admin.get('/api/auth/me')).body.user;
    assert.equal((await admin.patch(`/api/users/${me.id}`, { is_active: false })).body.error.code, 'CANNOT_MODIFY_SELF');
    assert.equal((await admin.patch(`/api/users/${me.id}`, { role: 'USER' })).body.error.code, 'CANNOT_MODIFY_SELF');
    assert.equal((await admin.delete(`/api/users/${me.id}`)).body.error.code, 'CANNOT_MODIFY_SELF');
  });

  it('rol değişikliği anında etkili olur (rol DB\'den okunur)', async () => {
    const { client: u, user, password } = await createUserClient(admin);
    assert.equal((await u.get('/api/users')).status, 403);
    await admin.patch(`/api/users/${user.id}`, { role: 'ADMIN' });
    // Rol değişince oturum düşer; yeniden giriş yapınca yönetici yetkisi gelir.
    assert.equal((await u.get('/api/users')).status, 401);
    await u.login(user.email, password);
    assert.equal((await u.get('/api/users')).status, 200);
  });

  it('geçmişi olmayan kullanıcı silinir; silme işlemi audit log\'a yazılır', async () => {
    const { user } = await createUserClient(admin);
    const r = await admin.delete(`/api/users/${user.id}`);
    assert.equal(r.status, 204);
    assert.equal((await admin.get(`/api/users/${user.id}`)).status, 404);
    const { rows } = await query("SELECT details FROM audit_logs WHERE action_type = 'USER_DELETE' AND entity_id = $1", [user.id]);
    assert.equal(rows[0].details.email, user.email);
  });

  it('departman CRUD; kullanıcısı olan departman silinemez; olmayan departman atanamaz', async () => {
    const d = await admin.post('/api/departments', { name: 'Arge' });
    assert.equal(d.status, 201);
    assert.equal((await admin.post('/api/departments', { name: 'Arge' })).body.error.code, 'DUPLICATE_DEPARTMENT');

    const ghost = await admin.post('/api/users', { ad_soyad: 'Hayalet', email: 'hayalet@test.local', password: 'Gecerli-Parola-9', department_id: 99999 });
    assert.equal(ghost.status, 400);

    const { user } = await createUserClient(admin, { department_id: d.body.id });
    assert.equal(user.department_name, 'Arge');
    const del = await admin.delete(`/api/departments/${d.body.id}`);
    assert.equal(del.status, 409);
    assert.equal(del.body.error.code, 'HAS_USERS');

    const ren = await admin.patch(`/api/departments/${d.body.id}`, { name: 'Ar-Ge' });
    assert.equal(ren.body.name, 'Ar-Ge');
    assert.equal(ren.body.user_count, 1);

    await admin.patch(`/api/users/${user.id}`, { department_id: null });
    assert.equal((await admin.delete(`/api/departments/${d.body.id}`)).status, 204);
  });

  it('bir yönetici başka bir yöneticinin rolünü düşürebilir; sistem yöneticisiz kalamaz', async () => {
    const other = await createUserClient(admin, { role: 'ADMIN' });
    const me = (await admin.get('/api/auth/me')).body.user;
    const r = await other.client.patch(`/api/users/${me.id}`, { role: 'USER' });
    assert.equal(r.status, 200);
    // Artık tek aktif yönetici "other"; kendi rolünü düşüremez.
    const self = await other.client.patch(`/api/users/${other.user.id}`, { role: 'USER' });
    assert.equal(self.body.error.code, 'CANNOT_MODIFY_SELF');
    const { rows } = await query("SELECT count(*) AS n FROM users WHERE role = 'ADMIN' AND is_active");
    assert.ok(rows[0].n >= 1);
  });
});
