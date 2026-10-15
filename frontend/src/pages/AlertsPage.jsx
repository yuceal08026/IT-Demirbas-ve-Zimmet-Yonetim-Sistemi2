import { api } from '../lib/api.js';
import { useApi, useTitle } from '../lib/hooks.js';
import { Link, useSearchParams } from '../lib/router.jsx';
import { formatDate } from '../lib/format.js';
import { AssetTag, EmptyState, ErrorBlock, Icon, LoadingBlock, PageHeader, StatusBadge } from '../components/ui.jsx';

const SEVERITY = {
  critical: { label: 'Kritik', bar: 'bg-st-defect', text: 'text-st-defect' },
  warning: { label: 'Uyarı', bar: 'bg-warn', text: 'text-warn' },
  info: { label: 'Bilgi', bar: 'bg-steel', text: 'text-steel-dark' },
};

const ACTION_HINT = {
  INCONSISTENT_STATUS: 'Cihaz kaydını ve zimmet geçmişini kontrol edin; gerekirse iade alıp yeniden zimmetleyin.',
  WARRANTY_EXPIRING: 'Garanti uzatma veya yenileme planı yapın.',
  LONG_DEFECTIVE: 'Onarım durumunu takip edin ya da cihazı envanterden çıkarın.',
  LONG_IN_STOCK: 'İhtiyacı olan birime zimmetlemeyi veya envanterden çıkarmayı değerlendirin.',
  WARRANTY_EXPIRED_IN_USE: 'Arıza durumunda ücretli servis gerekebilir; yenileme planına ekleyin.',
  MISSING_INFO: 'Cihaz bilgilerini tamamlayın; garanti uyarıları bu alanlara göre çalışır.',
};

export default function AlertsPage() {
  useTitle('Uyarılar');
  const [params, setParams] = useSearchParams();
  const res = useApi(() => api.get('/alerts', { type: params.type }), [params.type]);

  const summary = res.data?.summary || {};
  const t = res.data?.thresholds;

  return (
    <>
      <PageHeader title="Uyarılar"
        description={t
          ? `Kayıtlardan otomatik üretilir: garantisi ${t.warrantyDays} gün içinde bitenler, ${t.idleDays} günden uzun süredir depoda veya ${t.defectiveDays} günden uzun süredir arızalı cihazlar ve çelişkili ya da eksik kayıtlar.`
          : 'Kayıtlardan otomatik üretilen uyarılar.'} />

      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Uyarı türü">
        <button type="button" role="tab" aria-selected={!params.type}
          className={`rounded-full border px-3 py-1 text-sm font-semibold ${!params.type ? 'border-ink bg-ink text-white' : 'border-line bg-surface hover:border-steel'}`}
          onClick={() => setParams({ type: undefined })}>
          Tümü <span className="tabular-nums">{res.data?.total ?? ''}</span>
        </button>
        {Object.entries(summary).map(([type, s]) => (
          <button key={type} type="button" role="tab" aria-selected={params.type === type} disabled={s.count === 0}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold disabled:opacity-45 ${params.type === type ? 'border-ink bg-ink text-white' : 'border-line bg-surface hover:border-steel'}`}
            onClick={() => setParams({ type })}>
            <span className={`size-2 rounded-full ${SEVERITY[s.severity].bar}`} aria-hidden="true" />
            {s.title} <span className="tabular-nums">{s.count}</span>
          </button>
        ))}
      </div>

      {res.error && <ErrorBlock error={res.error} onRetry={res.reload} />}
      {!res.data ? (res.loading && <LoadingBlock />) : res.data.data.length === 0 ? (
        <div className="panel"><EmptyState title="Uyarı yok">Envanter kayıtlarında dikkat gerektiren bir durum bulunmadı.</EmptyState></div>
      ) : (
        <ul className="panel divide-y divide-line">
          {res.data.data.map((a) => (
            <li key={a.id} className="grid gap-3 px-4 py-4 sm:grid-cols-[4px_1fr_auto] sm:items-center">
              <span className={`hidden h-full w-1 rounded-full sm:block ${SEVERITY[a.severity].bar}`} aria-hidden="true" />
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2">
                  <span className={`text-sm font-semibold ${SEVERITY[a.severity].text}`}>
                    {a.severity !== 'info' && <Icon name="alert" className="mr-1 inline size-4 align-[-3px]" />}
                    {SEVERITY[a.severity].label}: {a.title}
                  </span>
                </p>
                <p className="mt-1 text-[15px] font-semibold">{a.message}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-steel-dark">
                  <Link to={`/assets/${a.asset.id}`}><AssetTag code={a.asset.asset_code} /></Link>
                  <span>{a.asset.brand} {a.asset.model}</span>
                  <StatusBadge status={a.asset.status} />
                  {a.asset.assignee && <span>Kullanan: {a.asset.assignee.ad_soyad}</span>}
                  {a.asset.warranty_end_date && <span>Garanti: {formatDate(a.asset.warranty_end_date)}</span>}
                </div>
                <p className="mt-1.5 text-sm text-ink-soft">{ACTION_HINT[a.type]}</p>
              </div>
              <Link to={`/assets/${a.asset.id}`} className="btn btn-secondary btn-sm justify-self-start sm:justify-self-end">Cihaza git</Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
