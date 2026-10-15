import { useState } from 'react';
import { api } from '../lib/api.js';
import { useApi, useTitle } from '../lib/hooks.js';
import { Link } from '../lib/router.jsx';
import { ACTION_LABELS, formatDateTime } from '../lib/format.js';
import { AssetTag, ErrorBlock, LoadingBlock, PageHeader } from '../components/ui.jsx';
import { describe } from '../components/Timeline.jsx';

const SEGMENTS = [
  { key: 'active', status: 'ACTIVE', label: 'Zimmetli', fill: 'bg-chart-active', hint: 'Personelde kullanımda' },
  { key: 'in_stock', status: 'IN_STOCK', label: 'Depoda', fill: 'bg-chart-stock', hint: 'Boşta, zimmetlenebilir' },
  { key: 'defective', status: 'DEFECTIVE', label: 'Arızalı', fill: 'bg-chart-defect', hint: 'Onarım bekliyor' },
];

const ALERT_ROWS = [
  ['INCONSISTENT_STATUS', 'Çelişkili kayıt', 'critical'],
  ['WARRANTY_EXPIRING', 'Garanti bitmek üzere', 'warning'],
  ['LONG_DEFECTIVE', 'Uzun süredir arızalı', 'warning'],
  ['LONG_IN_STOCK', 'Uzun süredir depoda', 'info'],
  ['WARRANTY_EXPIRED_IN_USE', 'Garantisi bitmiş, kullanımda', 'info'],
  ['MISSING_INFO', 'Eksik bilgi', 'info'],
];
const SEVERITY_MARK = { critical: 'bg-st-defect', warning: 'bg-warn', info: 'bg-steel' };

const pct = (part, total) => (total ? Math.round((part / total) * 100) : 0);

/** Hover/odak ile değer gösteren küçük ipucu. */
function useTip() {
  const [tip, setTip] = useState(null);
  const bind = (text) => ({
    onMouseEnter: (e) => setTip({ text, x: e.clientX, y: e.clientY }),
    onMouseMove: (e) => setTip({ text, x: e.clientX, y: e.clientY }),
    onMouseLeave: () => setTip(null),
    onFocus: (e) => { const r = e.currentTarget.getBoundingClientRect(); setTip({ text, x: r.left + r.width / 2, y: r.top }); },
    onBlur: () => setTip(null),
  });
  const node = tip && (
    <div role="tooltip" className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-[calc(100%+10px)] rounded-md bg-ink px-2.5 py-1.5 text-[13px] whitespace-nowrap text-white shadow-lg"
      style={{ left: tip.x, top: tip.y }}>
      {tip.text}
    </div>
  );
  return [bind, node];
}

/** Envanter bileşimi: toplam sayı + Zimmetli/Depoda/Arızalı oranını gösteren tek yatay bant. */
function InventoryComposition({ assets }) {
  const [bind, tipNode] = useTip();
  const total = assets.total;
  return (
    <section className="panel p-5 sm:p-6" aria-labelledby="inv-title">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:gap-10">
        <div className="flex-none">
          <h2 id="inv-title" className="text-steel-dark">Kullanımdaki cihazlar</h2>
          <p className="mt-1 text-[56px] leading-none font-bold tracking-tight tabular-nums">{total}</p>
          <p className="mt-2 text-sm text-steel-dark">
            {assets.inactive > 0
              ? <>Pasife alınan <Link to="/assets?is_active=false" className="font-semibold text-cobalt hover:underline">{assets.inactive} cihaz</Link> bu sayıya dahil değil.</>
              : 'Pasife alınan cihaz yok.'}
          </p>
        </div>

        <div className="min-w-0 flex-1">
          {total > 0 ? (
            <div className="flex h-6 w-full gap-[2px]" role="img"
              aria-label={SEGMENTS.map((s) => `${s.label} ${assets[s.key]}`).join(', ')}>
              {SEGMENTS.filter((s) => assets[s.key] > 0).map((s, i, arr) => (
                <Link key={s.key} to={`/assets?status=${s.status}`} tabIndex={-1}
                  className={`${s.fill} h-full min-w-[6px] transition-opacity hover:opacity-85 ${i === 0 ? 'rounded-l-[4px]' : ''} ${i === arr.length - 1 ? 'rounded-r-[4px]' : ''}`}
                  style={{ flexGrow: assets[s.key], flexBasis: 0 }}
                  {...bind(`${s.label}: ${assets[s.key]} cihaz (%${pct(assets[s.key], total)})`)} />
              ))}
            </div>
          ) : <div className="h-6 rounded-[4px] bg-paper" />}

          <ul className="mt-4 grid grid-cols-3 gap-3">
            {SEGMENTS.map((s) => (
              <li key={s.key}>
                <Link to={`/assets?status=${s.status}`} className="group block rounded-md p-1 -m-1 hover:bg-paper">
                  <span className="flex items-center gap-2 text-sm text-ink-soft">
                    <span className={`size-2.5 flex-none rounded-[3px] ${s.fill}`} aria-hidden="true" />
                    {s.label}
                  </span>
                  <span className="mt-0.5 block text-2xl font-bold tabular-nums group-hover:text-cobalt">
                    {assets[s.key]}
                    <span className="ml-1.5 text-sm font-normal text-steel-dark">%{pct(assets[s.key], total)}</span>
                  </span>
                  <span className="hidden text-[13px] text-steel sm:block">{s.hint}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
      {tipNode}
    </section>
  );
}

function AlertsSummary({ alerts }) {
  const rows = ALERT_ROWS.filter(([type]) => alerts.by_type[type] > 0);
  return (
    <section className="panel" aria-labelledby="alerts-title">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 id="alerts-title" className="font-bold">Dikkat gerektirenler</h2>
        <Link to="/alerts" className="text-sm font-semibold text-cobalt hover:underline">Tümünü gör</Link>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-steel-dark">Şu anda dikkat gerektiren bir kayıt yok.</p>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map(([type, label, sev]) => (
            <li key={type}>
              <Link to={`/alerts?type=${type}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-paper">
                <span className="flex items-center gap-2.5">
                  <span className={`h-5 w-1 rounded-full ${SEVERITY_MARK[sev]}`} aria-hidden="true" />
                  <span>{label}{sev === 'critical' && <span className="sr-only"> (kritik)</span>}</span>
                </span>
                <span className="text-lg font-bold tabular-nums">{alerts.by_type[type]}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RecentActivity({ items }) {
  return (
    <section className="panel" aria-labelledby="recent-title">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 id="recent-title" className="font-bold">Son cihaz hareketleri</h2>
        <Link to="/audit?entity_type=ASSET" className="text-sm font-semibold text-cobalt hover:underline">İşlem geçmişi</Link>
      </div>
      {items.length === 0 ? <p className="px-4 py-6 text-sm text-steel-dark">Henüz hareket yok.</p> : (
        <ul className="divide-y divide-line">
          {items.map((e) => (
            <li key={e.id} className="flex flex-col items-start gap-1.5 px-4 py-3 sm:flex-row sm:gap-3">
              {e.entity_label && <Link to={`/assets/${e.entity_id}`} className="flex-none"><AssetTag code={e.entity_label} /></Link>}
              <div className="min-w-0">
                <p className="text-[15px]"><span className="font-semibold">{ACTION_LABELS[e.action_type] || e.action_type}</span>{describe(e) && <span className="text-ink-soft">: {describe(e)}</span>}</p>
                <p className="text-[13px] text-steel">{e.actor?.ad_soyad || '—'}, {formatDateTime(e.timestamp)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Kategori başına durum kırılımı: yığılmış yatay çubuklar, ortak ölçek, uçta toplam değer. */
function CategoryChart({ rows }) {
  const [bind, tipNode] = useTip();
  const [showTable, setShowTable] = useState(false);
  const max = Math.max(1, ...rows.map((r) => r.total));
  return (
    <section className="panel" aria-labelledby="cat-title">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <h2 id="cat-title" className="font-bold">Kategoriye göre cihazlar</h2>
        <ul className="flex flex-wrap gap-3 text-[13px] text-ink-soft" aria-label="Gösterge">
          {SEGMENTS.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5"><span className={`size-2.5 rounded-[3px] ${s.fill}`} aria-hidden="true" />{s.label}</li>
          ))}
        </ul>
      </div>
      {rows.length === 0 ? <p className="px-4 py-6 text-sm text-steel-dark">Henüz cihaz yok.</p> : showTable ? (
        <div className="overflow-x-auto px-4 py-3">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-steel-dark"><th className="py-1.5 font-semibold">Kategori</th>{SEGMENTS.map((s) => <th key={s.key} className="py-1.5 text-right font-semibold">{s.label}</th>)}<th className="py-1.5 text-right font-semibold">Toplam</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.category} className="border-t border-line/70"><td className="py-1.5">{r.category}</td>{SEGMENTS.map((s) => <td key={s.key} className="py-1.5 text-right tabular-nums">{r[s.key]}</td>)}<td className="py-1.5 text-right font-semibold tabular-nums">{r.total}</td></tr>
            ))}</tbody>
          </table>
        </div>
      ) : (
        <ul className="space-y-3 px-4 py-4">
          {rows.map((r) => (
            <li key={r.category} className="grid grid-cols-[minmax(7rem,10rem)_1fr] items-center gap-3">
              <Link to={`/assets?category=${encodeURIComponent(r.category)}`} className="truncate text-sm hover:text-cobalt hover:underline" title={r.category}>{r.category}</Link>
              <div className="flex items-center gap-2">
                <div className="flex h-4 gap-[2px]" style={{ width: `${(r.total / max) * 85}%` }}>
                  {SEGMENTS.filter((s) => r[s.key] > 0).map((s, i, arr) => (
                    <span key={s.key} tabIndex={0}
                      className={`${s.fill} h-full min-w-[3px] ${i === arr.length - 1 ? 'rounded-r-[4px]' : ''}`}
                      style={{ flexGrow: r[s.key], flexBasis: 0 }}
                      {...bind(`${r.category}, ${s.label}: ${r[s.key]}`)} />
                  ))}
                </div>
                <span className="text-sm font-semibold tabular-nums text-ink">{r.total}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="border-t border-line px-4 py-2">
        <button type="button" className="text-sm font-semibold text-cobalt hover:underline" onClick={() => setShowTable((v) => !v)}>
          {showTable ? 'Grafik olarak göster' : 'Tablo olarak göster'}
        </button>
      </div>
      {tipNode}
    </section>
  );
}

function DepartmentChart({ rows }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <section className="panel" aria-labelledby="dept-title">
      <h2 id="dept-title" className="border-b border-line px-4 py-3 font-bold">Departmanlara göre zimmetli cihaz</h2>
      {rows.length === 0 ? <p className="px-4 py-6 text-sm text-steel-dark">Henüz zimmetli cihaz yok.</p> : (
        <ul className="space-y-3 px-4 py-4">
          {rows.map((r) => (
            <li key={r.name} className="grid grid-cols-[minmax(7rem,10rem)_1fr] items-center gap-3">
              {r.department_id
                ? <Link to={`/assets?department_id=${r.department_id}`} className="truncate text-sm hover:text-cobalt hover:underline">{r.name}</Link>
                : <span className="truncate text-sm text-steel-dark">{r.name}</span>}
              <div className="flex items-center gap-2">
                <div className="h-4 rounded-r-[4px] bg-chart-single" style={{ width: `${(r.count / max) * 85}%`, minWidth: '3px' }} />
                <span className="text-sm font-semibold tabular-nums">{r.count}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function DashboardPage() {
  useTitle('Genel bakış');
  const stats = useApi(() => api.get('/dashboard/stats'), []);
  const today = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());

  return (
    <>
      <PageHeader title="Genel bakış" description={`${today} itibarıyla envanter durumu. Sayılar her açılışta veritabanından canlı hesaplanır.`}
        actions={<button type="button" className="btn btn-secondary" onClick={stats.reload} disabled={stats.loading}>Yenile</button>} />
      {stats.error && <ErrorBlock error={stats.error} onRetry={stats.reload} />}
      {!stats.data ? (stats.loading && <LoadingBlock />) : (
        <div className="space-y-6">
          {stats.data.pending_registrations > 0 && (
            <Link to="/users" className="flex items-center justify-between gap-3 rounded-lg border border-cobalt/30 bg-cobalt-tint px-4 py-3 text-cobalt hover:underline">
              <span className="font-semibold">{stats.data.pending_registrations} yeni kayıt onayınızı bekliyor.</span>
              <span className="text-sm font-semibold">Personel sayfasında onaylayın →</span>
            </Link>
          )}
          {stats.data.pending_password_requests > 0 && (
            <Link to="/users" className="flex items-center justify-between gap-3 rounded-lg border border-warn/40 bg-warn-tint px-4 py-3 text-warn hover:underline">
              <span className="font-semibold">{stats.data.pending_password_requests} kişi parolasını unuttuğunu bildirdi.</span>
              <span className="text-sm font-semibold">Personel sayfasında geçici parola verin →</span>
            </Link>
          )}
          <InventoryComposition assets={stats.data.assets} />
          <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
            <AlertsSummary alerts={stats.data.alerts} />
            <RecentActivity items={stats.data.recent_activity} />
          </div>
          <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
            <CategoryChart rows={stats.data.by_category} />
            <DepartmentChart rows={stats.data.by_department} />
          </div>
        </div>
      )}
    </>
  );
}
