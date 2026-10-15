import { useTestServer, adminClient, createUserClient, query } from './helpers.js';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { todayInAppTimezone } from '../src/config.js';

useTestServer();

let n = 0;
const mk = async (admin, over = {}) => (await admin.post('/api/assets', {
  category: 'Yazıcı', brand: 'HP', model: 'LaserJet', serial_number: `DB-${Date.now()}-${++n}`,
  purchase_date: '2025-01-01', warranty_end_date: '2029-01-01', ...over,
})).body;

const iso = (d) => d.toISOString().slice(0, 10);
// "Bugün" uygulamanın saat dilimine göre (veritabanı oturumu da aynı dilimde çalışır); test saatinden bağımsızdır.
const inDays = (k) => { const d = new Date(`${todayInAppTimezone()}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + k); return iso(d); };

async function dbCounts() {
  const { rows } = await query(`
    SELECT (SELECT count(*) FROM assets WHERE is_active) AS total,
           (SELECT count(*) FROM assets WHERE is_active AND status='ACTIVE') AS active,
           (SELECT count(*) FROM assets WHERE is_active AND status='IN_STOCK') AS in_stock,
           (SELECT count(*) FROM assets WHERE is_active AND status='DEFECTIVE') AS defective,
           (SELECT count(*) FROM assets WHERE NOT is_active) AS inactive`);
  return rows[0];
}

describe('Dashboard ve akıllı uyarılar (Aşama 6–7, PRD §7)', () => {
  let admin;
  before(async () => {
    admin = await adminClient();
  });

  it('dashboard sayıları her işlemden sonra veritabanıyla birebir eşleşir (veri tutarlılığı)', async () => {
    const check = async (label) => {
      const api = (await admin.get('/api/dashboard/stats')).body.assets;
      assert.deepEqual(api, await dbCounts(), label);
      assert.equal(api.total, api.active + api.in_stock + api.defective, `${label}: toplam = parçaların toplamı`);
    };
    await check('başlangıç');
    const a = await mk(admin); const b = await mk(admin); const c = await mk(admin);
    await check('3 cihaz eklendi');
    await admin.patch(`/api/assets/${b.id}/status`, { status: 'DEFECTIVE' });
    await check('biri arızalı');
    const { user } = await createUserClient(admin);
    const asg = (await admin.post('/api/assignments', { asset_id: a.id, user_id: user.id })).body;
    await check('biri zimmetli');
    await admin.patch(`/api/assets/${c.id}`, { is_active: false });
    await check('biri pasif');
    await admin.post(`/api/assignments/${asg.id}/return`, { condition: 'DEFECTIVE' });
    await check('arızalı iade');
    const api = (await admin.get('/api/dashboard/stats')).body.assets;
    assert.deepEqual(api, { total: 2, active: 0, in_stock: 0, defective: 2, inactive: 1 });
  });

  it('kategori ve departman dağılımı gerçek kayıtlardan hesaplanır', async () => {
    const dept = (await admin.post('/api/departments', { name: 'Dağılım Dept' })).body;
    const { user } = await createUserClient(admin, { department_id: dept.id });
    const a = await mk(admin, { category: 'Projeksiyon' });
    await admin.post('/api/assignments', { asset_id: a.id, user_id: user.id });
    const s = (await admin.get('/api/dashboard/stats')).body;
    const proj = s.by_category.find((x) => x.category === 'Projeksiyon');
    assert.deepEqual([proj.total, proj.active], [1, 1]);
    assert.equal(s.by_department.find((x) => x.name === 'Dağılım Dept').count, 1);
    assert.equal(s.recent_activity[0].action_type, 'ASSIGN');
  });

  it('personel dashboard ve uyarılara erişemez', async () => {
    const { client: u } = await createUserClient(admin);
    assert.equal((await u.get('/api/dashboard/stats')).status, 403);
    assert.equal((await u.get('/api/alerts')).status, 403);
  });

  it('garanti bitişi yaklaşan cihaz uyarı üretir; uzak tarihli üretmez', async () => {
    const soon = await mk(admin, { purchase_date: '2024-01-01', warranty_end_date: inDays(10) });
    const far = await mk(admin, { purchase_date: '2024-01-01', warranty_end_date: inDays(400) });
    const r = (await admin.get('/api/alerts?type=WARRANTY_EXPIRING')).body;
    const ids = r.data.map((x) => x.asset.id);
    assert.ok(ids.includes(soon.id));
    assert.ok(!ids.includes(far.id));
    assert.match(r.data.find((x) => x.asset.id === soon.id).message, /10 gün/);
  });

  it('uzun süredir depoda ve uzun süredir arızalı cihazlar tespit edilir', async () => {
    const idle = await mk(admin);
    const broken = await mk(admin);
    await admin.patch(`/api/assets/${broken.id}/status`, { status: 'DEFECTIVE' });
    await query("UPDATE assets SET status_changed_at = now() - interval '120 days' WHERE id = ANY($1::int[])", [[idle.id, broken.id]]);
    const r = (await admin.get('/api/alerts')).body.data;
    assert.ok(r.some((x) => x.type === 'LONG_IN_STOCK' && x.asset.id === idle.id && x.days === 120));
    assert.ok(r.some((x) => x.type === 'LONG_DEFECTIVE' && x.asset.id === broken.id));
  });

  it('çelişkili ve eksik kayıtlar kritik/bilgi uyarısı olarak raporlanır', async () => {
    const ghost = await mk(admin);
    await query("UPDATE assets SET status = 'ACTIVE' WHERE id = $1", [ghost.id]); // zimmeti olmadan "Zimmetli"
    const missing = await mk(admin, { purchase_date: null, warranty_end_date: null });
    const r = (await admin.get('/api/alerts')).body;
    const crit = r.data.find((x) => x.asset.id === ghost.id);
    assert.equal(crit.type, 'INCONSISTENT_STATUS');
    assert.equal(crit.severity, 'critical');
    assert.equal(r.data[0].severity, 'critical', 'kritikler önce sıralanır');
    assert.ok(r.data.some((x) => x.type === 'MISSING_INFO' && x.asset.id === missing.id));
    const stats = (await admin.get('/api/dashboard/stats')).body.alerts;
    assert.equal(stats.total, r.total);
    assert.ok(stats.by_severity.critical >= 1);
  });
});
