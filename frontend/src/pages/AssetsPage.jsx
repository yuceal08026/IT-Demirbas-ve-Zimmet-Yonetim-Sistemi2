import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useApi, useDebounced, useTitle } from '../lib/hooks.js';
import { Link, useNavigate, useSearchParams } from '../lib/router.jsx';
import { daysFromToday, formatDate } from '../lib/format.js';
import {
  AssetTag, DataTable, EmptyState, ErrorBlock, FilterSelect, Icon, LoadingBlock, PageHeader, Pagination, Pill,
  SearchInput, StatusBadge,
} from '../components/ui.jsx';

export function WarrantyCell({ date }) {
  if (!date) return <span className="text-steel">—</span>;
  const days = daysFromToday(date);
  if (days < 0) return <span className="text-st-defect">{formatDate(date)} <span className="text-sm">(bitti)</span></span>;
  if (days <= 60) return <span className="text-warn">{formatDate(date)} <span className="text-sm">({days} gün)</span></span>;
  return formatDate(date);
}

export function Assignee({ assignment }) {
  if (!assignment) return <span className="text-steel">—</span>;
  return (
    <div className="min-w-0">
      <p className="truncate">{assignment.user.ad_soyad}</p>
      {assignment.user.department && <p className="truncate text-sm text-steel-dark">{assignment.user.department.name}</p>}
    </div>
  );
}

export default function AssetsPage() {
  useTitle('Cihazlar');
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.search || '');
  const debouncedSearch = useDebounced(search);

  const page = Number(params.page || 1);
  const sort = params.sort || 'created_at';
  const order = params.order || 'desc';

  useEffect(() => {
    if ((params.search || '') !== debouncedSearch) setParams({ search: debouncedSearch, page: undefined });
  }, [debouncedSearch]); // eslint-disable-line react-hooks/exhaustive-deps

  const categories = useApi(() => api.get('/assets/categories'), []);
  const departments = useApi(() => api.get('/departments'), []);
  const list = useApi(
    () => api.get('/assets', {
      page, limit: 20, search: params.search, sort, order, status: params.status, category: params.category,
      department_id: params.department_id, user_id: params.user_id, is_active: params.is_active,
    }),
    [page, params.search, sort, order, params.status, params.category, params.department_id, params.user_id, params.is_active],
  );

  const filtered = ['search', 'status', 'category', 'department_id', 'user_id', 'is_active'].some((k) => params[k]);

  const columns = [
    {
      key: 'asset_code', header: 'Kod', sortKey: 'asset_code', primary: true,
      render: (a) => (
        <div className="flex flex-wrap items-center gap-2">
          <Link to={`/assets/${a.id}`} className="rounded focus-visible:outline-2"><AssetTag code={a.asset_code} /></Link>
          {!a.is_active && <Pill tone="muted">Pasif</Pill>}
          <span className="font-semibold md:hidden">{a.brand} {a.model}</span>
        </div>
      ),
    },
    {
      key: 'device', header: 'Cihaz', sortKey: 'brand', hideOnMobile: true,
      render: (a) => (
        <div className="min-w-0">
          <p className="font-semibold">{a.brand} {a.model}</p>
          <p className="text-sm text-steel-dark">{a.category}</p>
        </div>
      ),
    },
    { key: 'serial_number', header: 'Seri no', render: (a) => <span className="font-mono text-[13.5px]">{a.serial_number}</span> },
    { key: 'status', header: 'Durum', sortKey: 'status', render: (a) => <StatusBadge status={a.status} /> },
    { key: 'assignee', header: 'Zimmetli kişi', sortKey: 'assignee', render: (a) => <Assignee assignment={a.current_assignment} /> },
    { key: 'warranty', header: 'Garanti bitişi', sortKey: 'warranty_end_date', render: (a) => <WarrantyCell date={a.warranty_end_date} /> },
  ];

  return (
    <>
      <PageHeader title="Cihazlar" description="Kurumdaki tüm bilişim donanımları, durumları ve kimde oldukları."
        actions={(
          <Link to="/assets/new" className="btn btn-primary"><Icon name="plus" className="size-4" />Cihaz ekle</Link>
        )} />

      <div className="panel">
        <div className="flex flex-col gap-2 border-b border-line p-3 sm:flex-row sm:flex-wrap sm:items-center">
          <SearchInput value={search} onChange={setSearch} placeholder="Kod, seri no, marka, model, kişi" />
          <FilterSelect label="Durum" value={params.status} onChange={(v) => setParams({ status: v, page: undefined })}>
            <option value="">Tüm durumlar</option>
            <option value="ACTIVE">Zimmetli</option>
            <option value="IN_STOCK">Depoda</option>
            <option value="DEFECTIVE">Arızalı</option>
          </FilterSelect>
          <FilterSelect label="Kategori" value={params.category} onChange={(v) => setParams({ category: v, page: undefined })}>
            <option value="">Tüm kategoriler</option>
            {(categories.data?.data || []).map((c) => <option key={c} value={c}>{c}</option>)}
          </FilterSelect>
          <FilterSelect label="Departman" value={params.department_id} onChange={(v) => setParams({ department_id: v, page: undefined })}>
            <option value="">Tüm departmanlar</option>
            {(departments.data?.data || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </FilterSelect>
          <FilterSelect label="Kayıt durumu" value={params.is_active} onChange={(v) => setParams({ is_active: v, page: undefined })}>
            <option value="">Kullanımdaki cihazlar</option>
            <option value="false">Pasife alınanlar</option>
            <option value="all">Tümü</option>
          </FilterSelect>
          {filtered && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setSearch(''); setParams({ search: undefined, status: undefined, category: undefined, department_id: undefined, user_id: undefined, is_active: undefined, page: undefined }); }}>
              Filtreleri temizle
            </button>
          )}
        </div>
        {params.user_id && list.data?.data[0]?.current_assignment && (
          <p className="border-b border-line bg-cobalt-tint px-4 py-2 text-sm text-cobalt">
            {list.data.data[0].current_assignment.user.ad_soyad} üzerindeki cihazlar gösteriliyor.
          </p>
        )}

        {list.error && <div className="p-4"><ErrorBlock error={list.error} onRetry={list.reload} /></div>}
        {!list.data && list.loading ? <LoadingBlock /> : list.data && (
          <div className={list.loading ? 'opacity-60 transition-opacity' : ''}>
            <DataTable columns={columns} rows={list.data.data} sort={sort} order={order}
              onSort={(key) => setParams({ sort: key, order: sort === key && order === 'asc' ? 'desc' : 'asc', page: undefined })}
              onRowClick={(a) => navigate(`/assets/${a.id}`)}
              empty={filtered
                ? <EmptyState title="Eşleşen cihaz yok">Aramayı veya filtreleri değiştirin.</EmptyState>
                : <EmptyState title="Henüz cihaz kaydı yok" action={<Link to="/assets/new" className="btn btn-primary">İlk cihazı ekle</Link>}>
                    Cihaz eklediğinizde sistem ona otomatik bir kod ve QR etiketi üretir.
                  </EmptyState>} />
            <Pagination meta={list.data.meta} onPage={(p) => setParams({ page: p }, { replace: false })} />
          </div>
        )}
      </div>
    </>
  );
}
