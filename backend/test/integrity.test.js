import { useTestServer, adminClient, createUserClient, query } from './helpers.js';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { todayInAppTimezone } from '../src/config.js';

useTestServer();

let n = 0;
async function newAsset(admin, over = {}) {
  const r = await admin.post('/api/assets', {
    category: 'Dizüstü Bilgisayar', brand: 'Lenovo', model: 'T14', serial_number: `INT-${Date.now()}-${++n}`, ...over,
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
}

const shiftDay = (iso, k) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); };

async function snapshot(assetId) {
  const { rows: a } = await query('SELECT status, is_active FROM assets WHERE id = $1', [assetId]);
  const { rows: s } = await query('SELECT count(*) AS n FROM assignments WHERE asset_id = $1', [assetId]);
  const { rows: l } = await query("SELECT count(*) AS n FROM audit_logs WHERE entity_type = 'ASSET' AND entity_id = $1", [assetId]);
  return { ...a[0], assignments: s[0].n, logs: l[0].n };
}

describe('Zimmet bütünlüğü: başarısız işlemler tutarsız kayıt bırakmaz', () => {
  let admin;
  before(async () => {
    admin = await adminClient();
  });

  it('işlemin ortasında veritabanı hatası olursa zimmet tamamen geri alınır (transaction)', async () => {
    const asset = await newAsset(admin);
    const { user } = await createUserClient(admin);
    const before = await snapshot(asset.id);

    // İşlem geçmişine yazma adımını yapay olarak bozarak zimmetin son adımda hata vermesini sağlarız.
    await query(`CREATE OR REPLACE FUNCTION test_fail_assign() RETURNS trigger AS $$
      BEGIN IF NEW.action_type = 'ASSIGN' THEN RAISE EXCEPTION 'test: yapay hata'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await query('CREATE TRIGGER trg_test_fail_assign BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION test_fail_assign()');
    try {
      const r = await admin.post('/api/assignments', { asset_id: asset.id, user_id: user.id });
      assert.equal(r.status, 500);
      assert.equal(r.body.error.code, 'INTERNAL_ERROR');
      assert.ok(!JSON.stringify(r.body).includes('yapay hata'), 'iç hata ayrıntısı istemciye sızmamalı');
    } finally {
      await query('DROP TRIGGER trg_test_fail_assign ON audit_logs');
      await query('DROP FUNCTION test_fail_assign()');
    }
    assert.deepEqual(await snapshot(asset.id), before);
    assert.equal(before.status, 'IN_STOCK');

    // Hata giderilince aynı işlem sorunsuz yapılır.
    assert.equal((await admin.post('/api/assignments', { asset_id: asset.id, user_id: user.id })).status, 201);
  });

  it('iade sırasında hata olursa zimmet açık kalır, cihaz durumu değişmez', async () => {
    const asset = await newAsset(admin);
    const { user } = await createUserClient(admin);
    const s = (await admin.post('/api/assignments', { asset_id: asset.id, user_id: user.id })).body;
    const before = await snapshot(asset.id);

    await query(`CREATE OR REPLACE FUNCTION test_fail_return() RETURNS trigger AS $$
      BEGIN IF NEW.action_type = 'RETURN' THEN RAISE EXCEPTION 'test: yapay hata'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await query('CREATE TRIGGER trg_test_fail_return BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION test_fail_return()');
    try {
      assert.equal((await admin.post(`/api/assignments/${s.id}/return`, { condition: 'IN_STOCK' })).status, 500);
    } finally {
      await query('DROP TRIGGER trg_test_fail_return ON audit_logs');
      await query('DROP FUNCTION test_fail_return()');
    }
    assert.deepEqual(await snapshot(asset.id), before);
    const { rows } = await query('SELECT returned_at FROM assignments WHERE id = $1', [s.id]);
    assert.equal(rows[0].returned_at, null);
  });

  it('kurala takılan zimmet denemeleri (pasif cihaz, arızalı cihaz, pasif personel) hiçbir kayıt bırakmaz', async () => {
    const { user } = await createUserClient(admin);
    const passive = await newAsset(admin);
    await admin.patch(`/api/assets/${passive.id}`, { is_active: false });
    const broken = await newAsset(admin);
    await admin.patch(`/api/assets/${broken.id}/status`, { status: 'DEFECTIVE' });
    const ok = await newAsset(admin);
    const { user: leaver } = await createUserClient(admin);
    await admin.patch(`/api/users/${leaver.id}`, { is_active: false });

    const cases = [
      [passive.id, user.id, 'ASSET_NOT_AVAILABLE'],
      [broken.id, user.id, 'ASSET_NOT_AVAILABLE'],
      [ok.id, leaver.id, 'USER_INACTIVE'],
    ];
    for (const [assetId, userId, code] of cases) {
      const before = await snapshot(assetId);
      const r = await admin.post('/api/assignments', { asset_id: assetId, user_id: userId });
      assert.equal(r.status, 409);
      assert.equal(r.body.error.code, code);
      assert.deepEqual(await snapshot(assetId), before);
    }
  });

  it('iade edilmiş zimmet ikinci kez iade edilemez; iade kaydı ve zaman çizelgesi değişmez', async () => {
    const asset = await newAsset(admin);
    const { user } = await createUserClient(admin);
    const s = (await admin.post('/api/assignments', { asset_id: asset.id, user_id: user.id })).body;
    assert.equal((await admin.post(`/api/assignments/${s.id}/return`, { condition: 'DEFECTIVE', return_note: 'Ekran kırık' })).status, 200);
    const before = await snapshot(asset.id);
    const again = await admin.post(`/api/assignments/${s.id}/return`, { condition: 'IN_STOCK' });
    assert.equal(again.status, 409);
    assert.equal(again.body.error.code, 'ASSIGNMENT_ALREADY_RETURNED');
    assert.deepEqual(await snapshot(asset.id), before);
    assert.equal(before.status, 'DEFECTIVE');
  });

  it('zimmet ve bakım geçmişi olan cihaz silinemez; pasife alınınca geçmiş korunur', async () => {
    const asset = await newAsset(admin);
    const { user } = await createUserClient(admin);
    const s = (await admin.post('/api/assignments', { asset_id: asset.id, user_id: user.id })).body;
    await admin.post(`/api/assignments/${s.id}/return`, {});
    await admin.post(`/api/assets/${asset.id}/maintenance`, { issue_description: 'Klavye tuşları basmıyor' });

    const del = await admin.delete(`/api/assets/${asset.id}`);
    assert.equal(del.status, 409);
    assert.equal(del.body.error.code, 'HAS_HISTORY');
    assert.equal((await admin.patch(`/api/assets/${asset.id}`, { is_active: false })).status, 200);
    assert.equal((await admin.get(`/api/assets/${asset.id}/assignments`)).body.data.length, 1);
    assert.equal((await admin.get(`/api/assets/${asset.id}/maintenance`)).body.data.length, 1);
  });

  it('bakım geçmişi: kapatılmış arıza kaydı değiştirilemez', async () => {
    const asset = await newAsset(admin);
    const m = (await admin.post(`/api/assets/${asset.id}/maintenance`, { issue_description: 'Fan sesi çok yüksek' })).body;
    assert.equal((await admin.patch(`/api/maintenance/${m.id}`, { status: 'RESOLVED', solution_note: 'Fan değişti', return_to_stock: true })).status, 200);
    const again = await admin.patch(`/api/maintenance/${m.id}`, { status: 'OPEN' });
    assert.equal(again.status, 409);
    assert.equal(again.body.error.code, 'MAINTENANCE_CLOSED');
    const { rows } = await query('SELECT status, solution_note FROM maintenance_records WHERE id = $1', [m.id]);
    assert.deepEqual(rows[0], { status: 'RESOLVED', solution_note: 'Fan değişti' });
  });
});

describe('Tarih kuralları kurum saat dilimine göre çalışır', () => {
  let admin;
  before(async () => {
    admin = await adminClient();
  });

  it('bugünün (kurum saatiyle) alım tarihi kabul edilir, yarın reddedilir', async () => {
    const today = todayInAppTimezone();
    await newAsset(admin, { purchase_date: today });
    const r = await admin.post('/api/assets', {
      category: 'Monitör', brand: 'LG', model: '27UP', serial_number: `INT-FUT-${Date.now()}`, purchase_date: shiftDay(today, 1),
    });
    assert.equal(r.status, 400);
    assert.ok(r.body.error.details.some((d) => d.field === 'purchase_date'));
  });

  it('veritabanı oturumu kurum saat dilimini kullanır', async () => {
    const { rows } = await query("SELECT current_setting('TimeZone') AS tz");
    assert.equal(rows[0].tz, 'Europe/Istanbul');
  });

  it('başlangıç tarihi bitişten sonra olan filtreler anlaşılır bir hatayla reddedilir', async () => {
    for (const path of [
      '/api/assignments?from=2026-05-10&to=2026-05-01',
      '/api/reports/assets?from=2026-05-10&to=2026-05-01',
      '/api/reports/assignments.csv?from=2026-05-10&to=2026-05-01',
      '/api/audit-logs?from=2026-05-10&to=2026-05-01',
    ]) {
      const r = await admin.get(path);
      assert.equal(r.status, 400, path);
      assert.match(r.body.error.message, /Başlangıç tarihi bitiş tarihinden sonra olamaz/);
    }
    assert.equal((await admin.get('/api/assignments?from=2026-05-01&to=2026-05-01')).status, 200);
  });
});
