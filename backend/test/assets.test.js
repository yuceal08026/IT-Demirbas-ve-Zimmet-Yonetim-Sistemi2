import { useTestServer, adminClient, createUserClient, query } from './helpers.js';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

useTestServer();

let n = 0;
const newAsset = (over = {}) => ({
  category: 'Dizüstü Bilgisayar', brand: 'Dell', model: 'Latitude 5440',
  serial_number: `SN-${Date.now()}-${++n}`, purchase_date: '2025-01-10', warranty_end_date: '2028-01-10', ...over,
});

describe('Envanter ve QR (Aşama 4, PRD §7)', () => {
  let admin;
  before(async () => {
    admin = await adminClient();
  });

  it('cihaz eklenince benzersiz asset_code üretilir ve durum IN_STOCK olur; istemcinin kodu/durumu yok sayılır', async () => {
    const a = await admin.post('/api/assets', { ...newAsset(), asset_code: 'HACK-1', status: 'ACTIVE' });
    const b = await admin.post('/api/assets', newAsset());
    assert.equal(a.status, 201);
    assert.match(a.body.asset_code, /^IT-\d{4}-\d{6}$/);
    assert.notEqual(a.body.asset_code, b.body.asset_code);
    assert.equal(a.body.status, 'IN_STOCK');
    assert.equal(a.body.current_assignment, null);
    assert.equal(a.body.qr_url, `http://zimmet.test/assets/code/${a.body.asset_code}`);
  });

  it('aynı seri numarasıyla ikinci cihaz eklenemez (büyük/küçük harf ve boşluk farkı dahil)', async () => {
    const first = await admin.post('/api/assets', newAsset({ serial_number: 'abc-123' }));
    assert.equal(first.body.serial_number, 'ABC-123');
    const dup = await admin.post('/api/assets', newAsset({ serial_number: '  ABC-123 ' }));
    assert.equal(dup.status, 409);
    assert.equal(dup.body.error.code, 'DUPLICATE_SERIAL_NUMBER');
    // Düzenlemeyle de çakışma oluşturulamaz
    const other = await admin.post('/api/assets', newAsset());
    const edit = await admin.patch(`/api/assets/${other.body.id}`, { serial_number: 'abc-123' });
    assert.equal(edit.status, 409);
  });

  it('aynı cihaz kodu veritabanı seviyesinde de reddedilir', async () => {
    const a = await admin.post('/api/assets', newAsset());
    await assert.rejects(
      query(`INSERT INTO assets (asset_code, category, brand, model, serial_number) VALUES ($1,'X','X','X','UNIQ-X1')`, [a.body.asset_code]),
      (err) => err.constraint === 'assets_asset_code_key',
    );
  });

  it('eksik/geçersiz form backend\'de reddedilir', async () => {
    const r = await admin.post('/api/assets', { brand: 'Dell' });
    assert.equal(r.status, 400);
    const fields = r.body.error.details.map((d) => d.field);
    for (const f of ['category', 'model', 'serial_number']) assert.ok(fields.includes(f), f);

    const badDate = await admin.post('/api/assets', newAsset({ purchase_date: '2025-02-30' }));
    assert.equal(badDate.status, 400);
    const future = await admin.post('/api/assets', newAsset({ purchase_date: '2999-01-01', warranty_end_date: null }));
    assert.equal(future.status, 400);
    const warranty = await admin.post('/api/assets', newAsset({ purchase_date: '2025-05-01', warranty_end_date: '2025-04-01' }));
    assert.equal(warranty.status, 400);
    assert.equal(warranty.body.error.details[0].field, 'warranty_end_date');
  });

  it('liste: arama + durum filtresi + sıralama + sayfalama birlikte çalışır', async () => {
    for (let i = 0; i < 4; i++) await admin.post('/api/assets', newAsset({ brand: 'Fujitsu', model: `Lifebook U${i}` }));
    const created = await admin.post('/api/assets', newAsset({ brand: 'Fujitsu', model: 'Lifebook ARIZALI' }));
    await admin.patch(`/api/assets/${created.body.id}/status`, { status: 'DEFECTIVE' });

    const p = await admin.get('/api/assets?search=fujitsu&status=IN_STOCK&sort=model&order=asc&limit=3&page=1');
    assert.equal(p.status, 200);
    assert.equal(p.body.meta.total, 4);
    assert.deepEqual(p.body.data.map((a) => a.model), ['Lifebook U0', 'Lifebook U1', 'Lifebook U2']);
    const p2 = await admin.get('/api/assets?search=fujitsu&status=IN_STOCK&sort=model&order=asc&limit=3&page=2');
    assert.deepEqual(p2.body.data.map((a) => a.model), ['Lifebook U3']);

    const multi = await admin.get('/api/assets?search=fujitsu&status=IN_STOCK,DEFECTIVE');
    assert.equal(multi.body.meta.total, 5);
    assert.equal((await admin.get('/api/assets?status=BROKEN')).status, 400);
  });

  it('departman ve kullanıcı filtresi aktif zimmet sahibine göre çalışır', async () => {
    const dept = (await admin.post('/api/departments', { name: 'Filtre Dept' })).body;
    const { user } = await createUserClient(admin, { department_id: dept.id });
    const asset = (await admin.post('/api/assets', newAsset())).body;
    const adminId = (await admin.get('/api/auth/me')).body.user.id;
    await query('INSERT INTO assignments (asset_id, user_id, assigned_by) VALUES ($1,$2,$3)', [asset.id, user.id, adminId]);
    await query("UPDATE assets SET status = 'ACTIVE' WHERE id = $1", [asset.id]);

    const byDept = await admin.get(`/api/assets?department_id=${dept.id}`);
    assert.deepEqual(byDept.body.data.map((a) => a.id), [asset.id]);
    assert.equal(byDept.body.data[0].current_assignment.user.department.name, 'Filtre Dept');
    const byUser = await admin.get(`/api/assets?user_id=${user.id}`);
    assert.deepEqual(byUser.body.data.map((a) => a.id), [asset.id]);
  });

  it('personel yalnızca kendi zimmetindeki cihazın detayını ve QR\'ını görür; diğerleri 404', async () => {
    const { client: u, user } = await createUserClient(admin);
    const mine = (await admin.post('/api/assets', newAsset({ notes: 'Yönetici notu' }))).body;
    const other = (await admin.post('/api/assets', newAsset())).body;
    const adminId = (await admin.get('/api/auth/me')).body.user.id;
    await query('INSERT INTO assignments (asset_id, user_id, assigned_by) VALUES ($1,$2,$3)', [mine.id, user.id, adminId]);
    await query("UPDATE assets SET status = 'ACTIVE' WHERE id = $1", [mine.id]);

    const ok = await u.get(`/api/assets/${mine.id}`);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.notes, undefined, 'yönetici notu personele gösterilmez');
    assert.equal((await u.get(`/api/assets/by-code/${mine.asset_code.toLowerCase()}`)).status, 200);
    const qr = await u.get(`/api/assets/${mine.id}/qr`);
    assert.equal(qr.status, 200);
    assert.equal(qr.headers.get('content-type'), 'image/png');

    assert.equal((await u.get(`/api/assets/${other.id}`)).status, 404);
    assert.equal((await u.get(`/api/assets/by-code/${other.asset_code}`)).status, 404);
    assert.equal((await u.get(`/api/assets/${other.id}/qr`)).status, 404);
    assert.equal((await u.get('/api/assets')).status, 403);
    assert.equal((await u.post('/api/assets', newAsset())).status, 403);
    assert.equal((await u.patch(`/api/assets/${mine.id}`, { brand: 'X' })).status, 403);
    assert.equal((await u.patch(`/api/assets/${mine.id}/status`, { status: 'DEFECTIVE' })).status, 403);
    assert.equal((await u.delete(`/api/assets/${other.id}`)).status, 403);
  });

  it('QR, kod üzerinden doğru cihaza çözülür (svg içerik + by-code eşleşmesi)', async () => {
    const a = (await admin.post('/api/assets', newAsset())).body;
    const byCode = await admin.get(`/api/assets/by-code/${a.asset_code}`);
    assert.equal(byCode.body.id, a.id);
    const svg = await admin.get(`/api/assets/${a.id}/qr?format=svg&download=1`);
    assert.equal(svg.status, 200);
    assert.match(svg.headers.get('content-type'), /image\/svg\+xml/);
    assert.match(svg.headers.get('content-disposition'), new RegExp(`${a.asset_code}\\.svg`));
  });

  it('zimmetli cihazın durumu değiştirilemez, pasife alınamaz; ACTIVE elle verilemez', async () => {
    const a = (await admin.post('/api/assets', newAsset())).body;
    assert.equal((await admin.patch(`/api/assets/${a.id}/status`, { status: 'ACTIVE' })).status, 400);
    const { user } = await createUserClient(admin);
    const adminId = (await admin.get('/api/auth/me')).body.user.id;
    await query('INSERT INTO assignments (asset_id, user_id, assigned_by) VALUES ($1,$2,$3)', [a.id, user.id, adminId]);
    await query("UPDATE assets SET status = 'ACTIVE' WHERE id = $1", [a.id]);
    assert.equal((await admin.patch(`/api/assets/${a.id}/status`, { status: 'DEFECTIVE' })).body.error.code, 'HAS_ACTIVE_ASSIGNMENTS');
    assert.equal((await admin.patch(`/api/assets/${a.id}`, { is_active: false })).body.error.code, 'HAS_ACTIVE_ASSIGNMENTS');
    assert.equal((await admin.delete(`/api/assets/${a.id}`)).body.error.code, 'HAS_HISTORY');
  });

  it('pasife alınan cihaz varsayılan listede görünmez, is_active=false ile görünür; değişiklik audit\'e yazılır', async () => {
    const a = (await admin.post('/api/assets', newAsset({ brand: 'PasifMarka' }))).body;
    const r = await admin.patch(`/api/assets/${a.id}`, { is_active: false });
    assert.equal(r.body.is_active, false);
    assert.equal((await admin.get('/api/assets?search=PasifMarka')).body.meta.total, 0);
    assert.equal((await admin.get('/api/assets?search=PasifMarka&is_active=false')).body.meta.total, 1);
    const { rows } = await query("SELECT action_type FROM audit_logs WHERE entity_type='ASSET' AND entity_id=$1 ORDER BY id", [a.id]);
    assert.deepEqual(rows.map((x) => x.action_type), ['ASSET_CREATE', 'ASSET_DEACTIVATE']);
  });

  it('geçmişi olmayan cihaz silinir', async () => {
    const a = (await admin.post('/api/assets', newAsset())).body;
    assert.equal((await admin.delete(`/api/assets/${a.id}`)).status, 204);
    assert.equal((await admin.get(`/api/assets/${a.id}`)).status, 404);
  });
});
