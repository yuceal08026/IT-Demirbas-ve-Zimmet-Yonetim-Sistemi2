import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useApi, useDebounced, useTitle } from '../lib/hooks.js';
import { Link, useSearchParams } from '../lib/router.jsx';
import { ACTION_LABELS, ENTITY_LABELS, formatDateTime } from '../lib/format.js';
import {
  AssetTag, DataTable, EmptyState, ErrorBlock, FilterSelect, LoadingBlock, PageHeader, Pagination, SearchInput,
} from '../components/ui.jsx';
import { describe } from '../components/Timeline.jsx';

function EntityCell({ log }) {
  if (!log.entity_label) return <span className="text-steel">—</span>;
  if (log.entity_type === 'ASSET' && log.entity_id) {
    return <Link to={`/assets/${log.entity_id}`}><AssetTag code={log.entity_label} /></Link>;
  }
  return (
    <span>
      <span className="text-steel-dark">{ENTITY_LABELS[log.entity_type]}: </span>
      {log.entity_label}
    </span>
  );
}

export default function AuditPage() {
  useTitle('İşlem geçmişi');
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.search || '');
  const debouncedSearch = useDebounced(search);
  const page = Number(params.page || 1);
  const order = params.order || 'desc';

  useEffect(() => {
    if ((params.search || '') !== debouncedSearch) setParams({ search: debouncedSearch, page: undefined });
  }, [debouncedSearch]); // eslint-disable-line react-hooks/exhaustive-deps

  const actions = useApi(() => api.get('/audit-logs/actions'), []);
  const list = useApi(
    () => api.get('/audit-logs', {
      page, limit: 30, order, search: params.search, action_type: params.action_type, entity_type: params.entity_type, from: params.from, to: params.to,
    }),
    [page, order, params.search, params.action_type, params.entity_type, params.from, params.to],
  );

  const columns = [
    {
      key: 'timestamp', header: 'Zaman', sortKey: 'timestamp', className: 'whitespace-nowrap',
      render: (l) => <time dateTime={l.timestamp} className="text-[14px]">{formatDateTime(l.timestamp)}</time>,
    },
    {
      key: 'action', header: 'İşlem', primary: true,
      render: (l) => (
        <div className="min-w-0">
          <p><span className="font-semibold">{l.actor?.ad_soyad || 'Sistem / silinmiş kullanıcı'}</span> <span className="text-ink-soft">{(ACTION_LABELS[l.action_type] || l.action_type).toLocaleLowerCase('tr-TR')}</span></p>
          {describe(l) && <p className="text-sm text-steel-dark">{describe(l)}</p>}
        </div>
      ),
    },
    { key: 'entity', header: 'Kayıt', render: (l) => <EntityCell log={l} /> },
  ];

  return (
    <>
      <PageHeader title="İşlem geçmişi"
        description="Sistemde yapılan tüm işlemlerin değiştirilemez kaydı: girişler, kullanıcı ve cihaz değişiklikleri, zimmet ve iadeler." />

      <div className="panel">
        <div className="flex flex-col gap-2 border-b border-line p-3 sm:flex-row sm:flex-wrap sm:items-center">
          <SearchInput value={search} onChange={setSearch} placeholder="Kişi, cihaz kodu veya ayrıntı" />
          <FilterSelect label="İşlem" value={params.action_type} onChange={(v) => setParams({ action_type: v, page: undefined })}>
            <option value="">Tüm işlemler</option>
            {(actions.data?.data || []).map((a) => <option key={a} value={a}>{ACTION_LABELS[a] || a}</option>)}
          </FilterSelect>
          <FilterSelect label="Kayıt türü" value={params.entity_type} onChange={(v) => setParams({ entity_type: v, page: undefined })}>
            <option value="">Tüm kayıtlar</option>
            {Object.entries(ENTITY_LABELS).filter(([k]) => k !== 'MAINTENANCE' && k !== 'ASSIGNMENT').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </FilterSelect>
          <label className="flex items-center gap-2 text-sm text-steel-dark">
            <input type="date" aria-label="Başlangıç tarihi" className="field-input py-1.5" value={params.from || ''} onChange={(e) => setParams({ from: e.target.value, page: undefined })} />
            <span>–</span>
            <input type="date" aria-label="Bitiş tarihi" className="field-input py-1.5" value={params.to || ''} onChange={(e) => setParams({ to: e.target.value, page: undefined })} />
          </label>
        </div>
        {list.error && <div className="p-4"><ErrorBlock error={list.error} onRetry={list.reload} /></div>}
        {!list.data && list.loading ? <LoadingBlock /> : list.data && (
          <div className={list.loading ? 'opacity-60 transition-opacity' : ''}>
            <DataTable columns={columns} rows={list.data.data} sort="timestamp" order={order}
              onSort={() => setParams({ order: order === 'asc' ? undefined : 'asc', page: undefined })}
              empty={<EmptyState title="Eşleşen işlem kaydı yok">Filtreleri değiştirmeyi deneyin.</EmptyState>} />
            <Pagination meta={list.data.meta} onPage={(p) => setParams({ page: p }, { replace: false })} />
          </div>
        )}
      </div>
    </>
  );
}
