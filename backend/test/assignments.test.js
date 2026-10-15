import { useTestServer, adminClient, createUserClient, query } from './helpers.js';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

useTestServer();

let n = 0;
async function newAsset(admin, over = {}) {
  const r = await admin.post('/api/assets', {
    category: 'Monitör', brand: 'Dell', model: 'P2723D', serial_number: `ZM-${Date.now()}-${++n}`, ...over,
  });
  assert.equal(r.status, 201);
  return r.body;
}

describe('Zimmet ve işlem geçmişi (Aşama 5, PRD §7)', () => {
  let admin;
  before(async () => {
    admin = await adminClient();
  });

  it('zimmet: cihaz ACTIVE olur, kimin zimmetlediği ve ne zaman kaydedilir', async () => {
    const asset = await newAsset(admin);
    const { user } = await createUserClient(admin);
    const r = await admin.post('/api/assignments', { asset_id: asset.id, user_id: user.id, note: 'Çanta ile' });
    assert.equal(r.status, 201);
    assert.equal(r.body.user.id, user.id);
    assert.equal(r.body.is_active, true);
    assert.equal(r.body.assigned_by.ad_soyad, 'Test Yönetici');
    assert.ok(r.body.assigned_at);
    const a = (await admin.get(`/api/assets/${asset.id}`)).body;
    assert.equal(a.status, 'ACTIVE');
    assert.equal(a.current_assignment.user.id, user.id);
  });

  it('aktif zimmetli cihaz iade alınmadan başkasına zimmetlenemez (PRD §7)', async () => {
    const asset = await newAsset(admin);
    const { user: u1 } = await createUserClient(admin);
    const { user: u2 } = await createUserClient(admin);
    assert.equal((await admin.post('/api/assignments', { asset_id: asset.id, user_id: u1.id })).status, 201);
    const second = await admin.post('/api/assignments', { asset_id: asset.id, user_id: u2.id });
    assert.equal(second.status, 409);
    assert.equal(second.body.error.code, 'ASSET_ALREADY_ASSIGNED');
    const { rows } = await query('SELECT count(*) AS n FROM assignments WHERE asset_id = $1 AND returned_at IS NULL', [asset.id]);
    assert.equal(rows[0].n, 1);
  });

  it('eşzamanlı 8 zimmet isteğinden yalnızca biri başarılı olur (yarış durumu)', async () => {
    const asset = await newAsset(admin);
    const users = [];
    for (let i = 0; i < 8; i++) users.push((await createUserClient(admin)).user);
    const results = await Promise.all(users.map((u) => admin.post('/api/assignments', { asset_id: asset.id, user_id: u.id })));
    const codes = results.map((r) => r.status).sort();
    assert.equal(codes.filter((c) => c === 201).length, 1, JSON.stringify(codes));
    assert.ok(results.filter((r) => r.status !== 201).every((r) => r.status === 409 && r.body.error.code === 'ASSET_ALREADY_ASSIGNED'));
    const { rows } = await query('SELECT count(*) AS n FROM assignments WHERE asset_id = $1', [asset.id]);
    assert.equal(rows[0].n, 1);
  });

  it('iade: cihaz IN_STOCK olur ve yeniden zimmetlenebilir; geçmiş kayıtlar korunur (PRD §7)', async () => {
    const asset = await newAsset(admin);
    const { user: u1 } = await createUserClient(admin);
    const { user: u2 } = await createUserClient(admin);
    const first = (await admin.post('/api/assignments', { asset_id: asset.id, user_id: u1.id })).body;

    const ret = await admin.post(`/api/assignments/${first.id}/return`, { return_note: 'Ayrıldı' });
    assert.equal(ret.status, 200);
    assert.ok(ret.body.returned_at);
    assert.equal(ret.body.returned_by.ad_soyad, 'Test Yönetici');
    assert.equal((await admin.get(`/api/assets/${asset.id}`)).body.status, 'IN_STOCK');

    const again = await admin.post(`/api/assignments/${first.id}/return`, {});
    assert.equal(again.body.error.code, 'ASSIGNMENT_ALREADY_RETURNED');

    assert.equal((await admin.post('/api/assignments', { asset_id: asset.id, user_id: u2.id })).status, 201);
    const hist = (await admin.get(`/api/assets/${asset.id}/assignments`)).body.data;
    assert.deepEqual(hist.map((h) => [h.user.id, h.is_active]), [[u2.id, true], [u1.id, false]]);
    assert.equal(hist[1].return_note, 'Ayrıldı');
  });

  it('arızalı teslim edilen cihaz DEFECTIVE olur ve zimmetlenemez', async () => {
    const asset = await newAsset(admin);
    const { user } = await createUserClient(admin);
    const a = (await admin.post('/api/assignments', { asset_id: asset.id, user_id: user.id })).body;
    await admin.post(`/api/assignments/${a.id}/return`, { condition: 'DEFECTIVE', return_note: 'Ekran kırık' });
    assert.equal((await admin.get(`/api/assets/${asset.id}`)).body.status, 'DEFECTIVE');
    const r = await admin.post('/api/assignments', { asset_id: asset.id, user_id: user.id });
    assert.equal(r.body.error.code, 'ASSET_NOT_AVAILABLE');
  });

  it('pasif kullanıcıya veya pasif cihaza zimmet yapılamaz; zimmeti olan kullanıcı pasife alınamaz', async () => {
    const { user } = await createUserClient(admin);
    await admin.patch(`/api/users/${user.id}`, { is_active: false });
    const asset = await newAsset(admin);
    assert.equal((await admin.post('/api/assignments', { asset_id: asset.id, user_id: user.id })).body.error.code, 'USER_INACTIVE');

    const passive = await newAsset(admin);
    await admin.patch(`/api/assets/${passive.id}`, { is_active: false });
    const { user: active } = await createUserClient(admin);
    assert.equal((await admin.post('/api/assignments', { asset_id: passive.id, user_id: active.id })).body.error.code, 'ASSET_NOT_AVAILABLE');

    await admin.post('/api/assignments', { asset_id: asset.id, user_id: active.id });
    const deact = await admin.patch(`/api/users/${active.id}`, { is_active: false });
    assert.equal(deact.body.error.code, 'HAS_ACTIVE_ASSIGNMENTS');
    assert.equal((await admin.delete(`/api/users/${active.id}`)).body.error.code, 'HAS_HISTORY');
  });

  it('olmayan cihaz/personel ve eksik alanlar doğru hatayı döner', async () => {
    const { user } = await createUserClient(admin);
    assert.equal((await admin.post('/api/assignments', { asset_id: 999999, user_id: user.id })).status, 404);
    const asset = await newAsset(admin);
    assert.equal((await admin.post('/api/assignments', { asset_id: asset.id, user_id: 999999 })).status, 400);
    assert.equal((await admin.post('/api/assignments', {})).status, 400);
    assert.equal((await admin.post('/api/assignments/999999/return', {})).status, 404);
  });

  it('personel zimmet/iade yapamaz; /me/assignments yalnızca kendi kayıtlarını döner (user_id parametresi yok sayılır)', async () => {
    const { client: u, user } = await createUserClient(admin);
    const { user: other } = await createUserClient(admin);
    const mine = await newAsset(admin);
    const theirs = await newAsset(admin);
    const a = (await admin.post('/api/assignments', { asset_id: mine.id, user_id: user.id })).body;
    await admin.post('/api/assignments', { asset_id: theirs.id, user_id: other.id });

    assert.equal((await u.post('/api/assignments', { asset_id: theirs.id, user_id: user.id })).status, 403);
    assert.equal((await u.post(`/api/assignments/${a.id}/return`, {})).status, 403);
    assert.equal((await u.get('/api/assignments')).status, 403);
    assert.equal((await u.get(`/api/assets/${mine.id}/assignments`)).status, 403);
    assert.equal((await u.get('/api/audit-logs')).status, 403);

    const me = await u.get(`/api/me/assignments?user_id=${other.id}`);
    assert.equal(me.status, 200);
    assert.deepEqual(me.body.data.map((x) => x.asset.id), [mine.id]);
  });

  it('zimmet listesi: aktif filtresi, personel adı araması ve sayfalama', async () => {
    const { user } = await createUserClient(admin, { ad_soyad: 'Aranacak Kişi' });
    for (let i = 0; i < 3; i++) {
      const asset = await newAsset(admin);
      const a = (await admin.post('/api/assignments', { asset_id: asset.id, user_id: user.id })).body;
      if (i === 0) await admin.post(`/api/assignments/${a.id}/return`, {});
    }
    const active = await admin.get('/api/assignments?search=aranacak&active=true');
    assert.equal(active.body.meta.total, 2);
    const all = await admin.get('/api/assignments?search=aranacak&limit=2&page=2');
    assert.equal(all.body.meta.total, 3);
    assert.equal(all.body.data.length, 1);
  });

  it('işlem geçmişi: zimmet ve iade cihaz zaman çizelgesine yazılır; kayıtlar API veya SQL ile değiştirilemez', async () => {
    const asset = await newAsset(admin);
    const { user } = await createUserClient(admin);
    const a = (await admin.post('/api/assignments', { asset_id: asset.id, user_id: user.id })).body;
    await admin.post(`/api/assignments/${a.id}/return`, {});

    const hist = (await admin.get(`/api/assets/${asset.id}/history`)).body.data;
    assert.deepEqual(hist.map((h) => h.action_type), ['RETURN', 'ASSIGN', 'ASSET_CREATE']);
    assert.equal(hist[1].details.user_name, user.ad_soyad);
    assert.equal(hist[0].actor.ad_soyad, 'Test Yönetici');

    const logs = await admin.get(`/api/audit-logs?entity_type=ASSET&entity_id=${asset.id}&action_type=ASSIGN`);
    assert.equal(logs.body.meta.total, 1);
    assert.equal(logs.body.data[0].entity_label, asset.asset_code);

    // API'de değiştirme/silme ucu yok
    assert.equal((await admin.delete(`/api/audit-logs/${hist[0].id}`)).status, 404);
    assert.equal((await admin.patch(`/api/audit-logs/${hist[0].id}`, { action_type: 'X' })).status, 404);
    // Veritabanı da reddeder
    await assert.rejects(query('DELETE FROM audit_logs WHERE id = $1', [hist[0].id]), /değiştirilemez/);
    await assert.rejects(query('DELETE FROM assignments WHERE id = $1', [a.id]), /silinemez/);
    await assert.rejects(query('UPDATE assignments SET user_id = user_id WHERE id = $1 AND false OR id = $1', [a.id]), /değiştirilemez/);
  });
});
