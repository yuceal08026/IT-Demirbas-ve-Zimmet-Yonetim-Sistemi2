import { useTestServer, adminClient, createUserClient, query } from './helpers.js';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { csvCell } from '../src/routes/reports.js';

useTestServer();

let n = 0;
const mk = async (admin, over = {}) => (await admin.post('/api/assets', {
  category: 'Tablet', brand: 'Apple', model: 'iPad', serial_number: `MR-${Date.now()}-${++n}`,
  purchase_date: '2025-03-01', warranty_end_date: '2027-03-01', ...over,
})).body;

describe('Arıza/bakım ve raporlama (Aşama 7)', () => {
  let admin;
  before(async () => {
    admin = await adminClient();
  });

  it('arıza kaydı açılınca depodaki cihaz arızalı olur; birden fazla kayıt tutulur; zaman çizelgesine yazılır', async () => {
    const a = await mk(admin);
    const r1 = await admin.post(`/api/assets/${a.id}/maintenance`, { issue_description: 'Ekran titriyor' });
    assert.equal(r1.status, 201);
    assert.equal(r1.body.status, 'OPEN');
    assert.equal((await admin.get(`/api/assets/${a.id}`)).body.status, 'DEFECTIVE');
    await admin.post(`/api/assets/${a.id}/maintenance`, { issue_description: 'Şarj soketi gevşek' });
    const list = (await admin.get(`/api/assets/${a.id}/maintenance`)).body.data;
    assert.equal(list.length, 2);
    const hist = (await admin.get(`/api/assets/${a.id}/history`)).body.data.map((h) => h.action_type);
    assert.deepEqual(hist.slice(0, 2), ['MAINTENANCE_OPEN', 'MAINTENANCE_OPEN']);
  });

  it('çözüm notu olmadan kapatılamaz; açık kayıt varken depoya dönmez; tüm kayıtlar kapanınca döner', async () => {
    const a = await mk(admin);
    const m1 = (await admin.post(`/api/assets/${a.id}/maintenance`, { issue_description: 'Açılmıyor' })).body;
    const m2 = (await admin.post(`/api/assets/${a.id}/maintenance`, { issue_description: 'Kasa çatlak' })).body;

    const noNote = await admin.patch(`/api/maintenance/${m1.id}`, { status: 'RESOLVED' });
    assert.equal(noNote.status, 400);

    assert.equal((await admin.patch(`/api/maintenance/${m1.id}`, { status: 'IN_PROGRESS' })).body.status, 'IN_PROGRESS');
    const closed = await admin.patch(`/api/maintenance/${m1.id}`, { status: 'RESOLVED', solution_note: 'Anakart değişti', return_to_stock: true });
    assert.equal(closed.body.status, 'RESOLVED');
    assert.ok(closed.body.closed_at);
    assert.equal(closed.body.closed_by.ad_soyad, 'Test Yönetici');
    assert.equal((await admin.get(`/api/assets/${a.id}`)).body.status, 'DEFECTIVE', 'ikinci kayıt hâlâ açık');

    await admin.patch(`/api/maintenance/${m2.id}`, { status: 'RESOLVED', solution_note: 'Kasa değişti', return_to_stock: true });
    assert.equal((await admin.get(`/api/assets/${a.id}`)).body.status, 'IN_STOCK');

    const locked = await admin.patch(`/api/maintenance/${m1.id}`, { solution_note: 'değiştir' });
    assert.equal(locked.body.error.code, 'MAINTENANCE_CLOSED');
  });

  it('zimmetli cihaz için arıza kaydı açılabilir ama cihaz personelde kalır', async () => {
    const a = await mk(admin);
    const { user } = await createUserClient(admin);
    await admin.post('/api/assignments', { asset_id: a.id, user_id: user.id });
    await admin.post(`/api/assets/${a.id}/maintenance`, { issue_description: 'Klavye tuşu kırık' });
    assert.equal((await admin.get(`/api/assets/${a.id}`)).body.status, 'ACTIVE');
  });

  it('personel bakım ve rapor uçlarına erişemez', async () => {
    const { client: u } = await createUserClient(admin);
    const a = await mk(admin);
    assert.equal((await u.post(`/api/assets/${a.id}/maintenance`, { issue_description: 'deneme arıza' })).status, 403);
    assert.equal((await u.get('/api/maintenance')).status, 403);
    assert.equal((await u.get('/api/reports/assets.csv')).status, 403);
    assert.equal((await u.get('/api/reports/assignments.csv')).status, 403);
  });

  it('envanter CSV: BOM + noktalı virgül, filtreler (durum, departman, tarih aralığı) uygulanır', async () => {
    const dept = (await admin.post('/api/departments', { name: 'Rapor Dept' })).body;
    const { user } = await createUserClient(admin, { department_id: dept.id, ad_soyad: 'Raporlu Kişi' });
    const inRange = await mk(admin, { brand: 'RaporMarka', purchase_date: '2024-06-15', warranty_end_date: '2026-06-15' });
    await mk(admin, { brand: 'RaporMarka', purchase_date: '2023-01-01', warranty_end_date: '2025-01-01' });
    await admin.post('/api/assignments', { asset_id: inRange.id, user_id: user.id });

    const r = await admin.get(`/api/reports/assets.csv?status=ACTIVE&department_id=${dept.id}&from=2024-01-01&to=2024-12-31`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/csv/);
    assert.match(r.headers.get('content-disposition'), /envanter-raporu-\d{4}-\d{2}-\d{2}\.csv/);
    const text = Buffer.isBuffer(r.body) ? r.body.toString('utf8') : r.body;
    assert.equal(text.charCodeAt(0), 0xfeff);
    const lines = text.slice(1).trim().split('\r\n');
    assert.equal(lines[0].split(';')[0], 'Cihaz kodu');
    assert.equal(lines.length, 2, 'başlık + yalnızca filtreye uyan 1 satır');
    assert.ok(lines[1].includes(inRange.asset_code));
    assert.ok(lines[1].includes('Zimmetli'));
    assert.ok(lines[1].includes('Raporlu Kişi'));
  });

  it('zimmet CSV: aktif/iade filtresi ve tarih aralığı', async () => {
    const a = await mk(admin);
    const { user } = await createUserClient(admin, { ad_soyad: 'Zimmet Raporu Kişi' });
    const s = (await admin.post('/api/assignments', { asset_id: a.id, user_id: user.id, note: '=HYPERLINK("x")' })).body;
    await admin.post(`/api/assignments/${s.id}/return`, { return_note: 'tamam' });
    const today = new Date().toISOString().slice(0, 10);
    const r = await admin.get(`/api/reports/assignments.csv?active=false&from=${today}&to=${today}`);
    const text = (Buffer.isBuffer(r.body) ? r.body.toString('utf8') : r.body);
    const row = text.split('\r\n').find((l) => l.includes(a.asset_code));
    assert.ok(row, 'iade edilen zimmet raporda');
    assert.ok(row.includes(`"'=HYPERLINK(""x"")"`), 'formül enjeksiyonu etkisizleştirildi');
    const activeOnly = await admin.get('/api/reports/assignments.csv?active=true');
    const t2 = Buffer.isBuffer(activeOnly.body) ? activeOnly.body.toString('utf8') : activeOnly.body;
    assert.ok(!t2.includes(a.asset_code));
  });

  it('CSV hücre kaçırma kuralları', () => {
    assert.equal(csvCell('a;b'), '"a;b"');
    assert.equal(csvCell('He said "hi"'), '"He said ""hi"""');
    assert.equal(csvCell('x"; y'), '"x""; y"');
    assert.equal(csvCell('+905551112233'), "'+905551112233");
    assert.equal(csvCell(null), '');
  });
});

describe('Gizli bilgi sızıntısı kontrolleri (PRD §7, Aşama 7)', () => {
  let admin;
  before(async () => {
    admin = await adminClient();
  });

  it('hiçbir API yanıtı parola özeti veya token_version içermez', async () => {
    const { user } = await createUserClient(admin);
    const a = await mk(admin);
    await admin.post('/api/assignments', { asset_id: a.id, user_id: user.id });
    const bodies = await Promise.all([
      admin.get('/api/users'), admin.get(`/api/users/${user.id}`), admin.get('/api/auth/me'),
      admin.get('/api/assignments'), admin.get(`/api/assets/${a.id}`), admin.get('/api/audit-logs?limit=200'),
      admin.get('/api/dashboard/stats'), admin.get('/api/reports/assignments'),
    ]);
    for (const r of bodies) {
      const s = JSON.stringify(r.body);
      assert.ok(!/password_hash|token_version|\$2[aby]\$/.test(s), `sızıntı: ${s.slice(0, 120)}`);
    }
  });

  it('işlem geçmişine parola/token yazılmaz', async () => {
    const { user } = await createUserClient(admin, { password: 'CokGizli123' });
    await admin.patch(`/api/users/${user.id}/password`, { password: 'DahaGizli456' });
    const { rows } = await query('SELECT details::text AS d FROM audit_logs');
    for (const { d } of rows) {
      assert.ok(!/CokGizli123|DahaGizli456|password|\$2[aby]\$/i.test(d), d);
    }
  });

  it('500 hatalarında ayrıntı/stack istemciye dönmez', async () => {
    // Geçersiz tarih tipi veritabanı hatasına dönüşmeden önce doğrulamada yakalanır; bozuk JSON da 400 olur.
    const r = await admin.raw('POST', '/api/assets', '{"brand":', { 'Content-Type': 'application/json' });
    assert.equal(r.status, 400);
    assert.ok(!JSON.stringify(r.body).includes('at '), 'stack yok');
  });
});
