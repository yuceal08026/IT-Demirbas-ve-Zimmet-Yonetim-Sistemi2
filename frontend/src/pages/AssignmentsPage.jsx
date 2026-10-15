import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useApi, useDebounced, useTitle } from '../lib/hooks.js';
import { Link, useSearchParams } from '../lib/router.jsx';
import { durationLabel, formatDate } from '../lib/format.js';
import {
  AssetTag, DataTable, EmptyState, ErrorBlock, FilterSelect, Icon, LoadingBlock, PageHeader, Pagination, Pill, SearchInput,
} from '../components/ui.jsx';
import { AssignModal, ReturnModal } from '../components/AssignmentModals.jsx';

const TABS = [
  ['true', 'Aktif zimmetler'],
  ['false', 'İade edilenler'],
  ['all', 'Tümü'],
];

export default function AssignmentsPage() {
  useTitle('Zimmetler');
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.search || '');
  const debouncedSearch = useDebounced(search);
  const [assignOpen, setAssignOpen] = useState(false);
  const [returning, setReturning] = useState(null);

  const active = params.active || 'true';
  const page = Number(params.page || 1);
  const sort = params.sort || 'assigned_at';
  const order = params.order || 'desc';

  useEffect(() => {
    if ((params.search || '') !== debouncedSearch) setParams({ search: debouncedSearch, page: undefined });
  }, [debouncedSearch]); // eslint-disable-line react-hooks/exhaustive-deps

  const departments = useApi(() => api.get('/departments'), []);
  const list = useApi(
    () => api.get('/assignments', { active, page, limit: 20, search: params.search, sort, order, department_id: params.department_id, from: params.from, to: params.to }),
    [active, page, params.search, sort, order, params.department_id, params.from, params.to],
  );

  const columns = [
    {
      key: 'asset', header: 'Cihaz', sortKey: 'asset_code', primary: true,
      render: (s) => (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Link to={`/assets/${s.asset.id}`}><AssetTag code={s.asset.asset_code} /></Link>
          <span className="truncate">{s.asset.brand} {s.asset.model}</span>
        </div>
      ),
    },
    {
      key: 'user', header: 'Personel', sortKey: 'user',
      render: (s) => (
        <div className="min-w-0">
          <p className="truncate font-semibold">{s.user.ad_soyad}</p>
          <p className="truncate text-sm text-steel-dark">{s.user.department?.name || 'Departman yok'}</p>
        </div>
      ),
    },
    {
      key: 'assigned_at', header: 'Teslim', sortKey: 'assigned_at',
      render: (s) => (
        <div>
          <p>{formatDate(s.assigned_at)}</p>
          <p className="text-sm text-steel-dark">{s.assigned_by.ad_soyad}</p>
        </div>
      ),
    },
    {
      key: 'returned_at', header: 'İade', sortKey: 'returned_at',
      render: (s) => (s.returned_at ? (
        <div>
          <p>{formatDate(s.returned_at)}</p>
          <p className="text-sm text-steel-dark">{durationLabel(Math.round((new Date(s.returned_at) - new Date(s.assigned_at)) / 86_400_000))} kullanıldı</p>
        </div>
      ) : <Pill tone="cobalt">Kullanımda ({durationLabel(Math.round((Date.now() - new Date(s.assigned_at)) / 86_400_000))})</Pill>),
    },
    {
      key: 'actions', header: <span className="sr-only">İşlemler</span>, className: 'text-right',
      render: (s) => (s.is_active
        ? <button type="button" className="btn btn-secondary btn-sm" onClick={() => setReturning(s)}>İade al</button>
        : null),
    },
  ];

  const done = () => { setAssignOpen(false); setReturning(null); list.reload(); };

  return (
    <>
      <PageHeader title="Zimmetler" description="Hangi cihazın kimde olduğu, ne zaman teslim edilip iade alındığı."
        actions={<button type="button" className="btn btn-primary" onClick={() => setAssignOpen(true)}><Icon name="plus" className="size-4" />Zimmetle</button>} />

      <div className="mb-3 flex gap-1 overflow-x-auto" role="tablist" aria-label="Zimmet durumu">
        {TABS.map(([value, label]) => (
          <button key={value} type="button" role="tab" aria-selected={active === value}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold whitespace-nowrap ${active === value ? 'bg-ink text-white' : 'text-ink-soft hover:bg-surface'}`}
            onClick={() => setParams({ active: value === 'true' ? undefined : value, page: undefined })}>
            {label}
          </button>
        ))}
      </div>

      <div className="panel">
        <div className="flex flex-col gap-2 border-b border-line p-3 sm:flex-row sm:flex-wrap sm:items-center">
          <SearchInput value={search} onChange={setSearch} placeholder="Cihaz kodu, seri no veya personel" />
          <FilterSelect label="Departman" value={params.department_id} onChange={(v) => setParams({ department_id: v, page: undefined })}>
            <option value="">Tüm departmanlar</option>
            {(departments.data?.data || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </FilterSelect>
          <label className="flex items-center gap-2 text-sm text-steel-dark">
            <span className="whitespace-nowrap">Teslim</span>
            <input type="date" aria-label="Teslim başlangıç tarihi" className="field-input py-1.5" value={params.from || ''} onChange={(e) => setParams({ from: e.target.value, page: undefined })} />
            <span>–</span>
            <input type="date" aria-label="Teslim bitiş tarihi" className="field-input py-1.5" value={params.to || ''} onChange={(e) => setParams({ to: e.target.value, page: undefined })} />
          </label>
        </div>
        {list.error && <div className="p-4"><ErrorBlock error={list.error} onRetry={list.reload} /></div>}
        {!list.data && list.loading ? <LoadingBlock /> : list.data && (
          <div className={list.loading ? 'opacity-60 transition-opacity' : ''}>
            <DataTable columns={columns} rows={list.data.data} sort={sort} order={order}
              onSort={(key) => setParams({ sort: key, order: sort === key && order === 'asc' ? 'desc' : 'asc', page: undefined })}
              empty={<EmptyState title={active === 'true' ? 'Aktif zimmet yok' : 'Kayıt bulunamadı'}
                action={active === 'true' && !params.search ? <button type="button" className="btn btn-primary" onClick={() => setAssignOpen(true)}>Cihaz zimmetle</button> : null}>
                {params.search ? 'Aramayı veya filtreleri değiştirin.' : 'Depodaki bir cihazı personele zimmetleyerek başlayın.'}
              </EmptyState>} />
            <Pagination meta={list.data.meta} onPage={(p) => setParams({ page: p }, { replace: false })} />
          </div>
        )}
      </div>

      <AssignModal open={assignOpen} onClose={() => setAssignOpen(false)} onDone={done} />
      <ReturnModal assignment={returning} asset={returning?.asset} onClose={() => setReturning(null)} onDone={done} />
    </>
  );
}
