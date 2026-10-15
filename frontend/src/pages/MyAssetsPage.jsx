import { api } from '../lib/api.js';
import { useApi, useTitle } from '../lib/hooks.js';
import { Link, useSearchParams } from '../lib/router.jsx';
import { durationLabel, formatDate } from '../lib/format.js';
import { useAuth } from '../context/AuthContext.jsx';
import { AssetTag, EmptyState, ErrorBlock, LoadingBlock, PageHeader, Pagination, StatusBadge } from '../components/ui.jsx';

const days = (from, to) => Math.round(((to ? new Date(to) : new Date()) - new Date(from)) / 86_400_000);

export default function MyAssetsPage() {
  useTitle('Zimmetlerim');
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const showPast = params.view === 'past';
  const page = Number(params.page || 1);
  const list = useApi(() => api.get('/me/assignments', { active: showPast ? 'false' : 'true', page, limit: 12 }), [showPast, page]);

  const total = list.data?.meta.total ?? 0;
  const description = showPast
    ? 'Daha önce üzerinizde olan ve iade ettiğiniz cihazlar.'
    : list.data
      ? total === 0 ? 'Şu anda üzerinize zimmetli bir cihaz yok.' : `Şu anda üzerinizde ${total} cihaz var. Bir sorun olursa Bilgi İşlem birimine cihaz kodunu bildirin.`
      : '';

  return (
    <>
      <PageHeader title={showPast ? 'Geçmiş zimmetlerim' : 'Zimmetlerim'} description={description}>
        <p className="mb-1 text-steel-dark">{user.ad_soyad}</p>
      </PageHeader>

      <div className="mb-4 flex gap-1" role="tablist" aria-label="Zimmet görünümü">
        {[['', 'Üzerimdekiler'], ['past', 'Geçmiş']].map(([v, label]) => (
          <button key={label} type="button" role="tab" aria-selected={(params.view || '') === v}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold ${(params.view || '') === v ? 'bg-ink text-white' : 'text-ink-soft hover:bg-surface'}`}
            onClick={() => setParams({ view: v, page: undefined })}>
            {label}
          </button>
        ))}
      </div>

      {list.error && <ErrorBlock error={list.error} onRetry={list.reload} />}
      {list.loading && !list.data ? <LoadingBlock /> : list.data && (
        list.data.data.length === 0 ? (
          <div className="panel">
            <EmptyState title={showPast ? 'Geçmiş zimmet kaydınız yok' : 'Üzerinizde cihaz yok'}>
              {showPast ? 'İade ettiğiniz cihazlar burada listelenir.' : 'Size bir cihaz teslim edildiğinde burada görünür.'}
            </EmptyState>
          </div>
        ) : (
          <>
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {list.data.data.map((s) => (
                <li key={s.id} className="panel flex flex-col p-4">
                  <div className="flex items-start justify-between gap-2">
                    <AssetTag code={s.asset.asset_code} size="md" />
                    {!showPast && <StatusBadge status={s.asset.status} />}
                  </div>
                  <p className="mt-3 text-lg font-semibold">{s.asset.brand} {s.asset.model}</p>
                  <p className="text-steel-dark">{s.asset.category}</p>
                  <dl className="mt-3 space-y-1 text-sm">
                    <div className="flex justify-between gap-3"><dt className="text-steel">Seri no</dt><dd className="font-mono">{s.asset.serial_number}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-steel">Teslim tarihi</dt><dd>{formatDate(s.assigned_at)}</dd></div>
                    {showPast
                      ? <div className="flex justify-between gap-3"><dt className="text-steel">İade tarihi</dt><dd>{formatDate(s.returned_at)}</dd></div>
                      : <div className="flex justify-between gap-3"><dt className="text-steel">Kullanım süresi</dt><dd>{durationLabel(days(s.assigned_at))}</dd></div>}
                  </dl>
                  {!showPast && (
                    <Link to={`/assets/${s.asset.id}`} className="btn btn-secondary btn-sm mt-4 self-start">Ayrıntılar ve QR</Link>
                  )}
                </li>
              ))}
            </ul>
            {list.data.meta.totalPages > 1 && (
              <div className="panel mt-4"><Pagination meta={list.data.meta} onPage={(p) => setParams({ page: p })} /></div>
            )}
          </>
        )
      )}
    </>
  );
}
