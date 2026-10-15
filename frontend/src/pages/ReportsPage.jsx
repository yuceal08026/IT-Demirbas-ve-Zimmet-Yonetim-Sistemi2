import { useState } from 'react';
import { api, downloadFile } from '../lib/api.js';
import { useApi, useTitle } from '../lib/hooks.js';
import { useSearchParams } from '../lib/router.jsx';
import { formatDate, formatDateTime } from '../lib/format.js';
import { useToast } from '../components/Toast.jsx';
import { ErrorBlock, FilterSelect, Icon, LoadingBlock, PageHeader, Spinner } from '../components/ui.jsx';

const REPORTS = {
  assets: { title: 'Envanter raporu', file: 'envanter-raporu.csv', dateLabel: 'Alım tarihi' },
  assignments: { title: 'Zimmet raporu', file: 'zimmet-raporu.csv', dateLabel: 'Teslim tarihi' },
};
const PREVIEW_LIMIT = 50;
const DATE_KEYS = new Set(['purchase_date', 'warranty_end_date']);
const DATETIME_KEYS = new Set(['assigned_at', 'returned_at']);

export default function ReportsPage() {
  useTitle('Raporlar');
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [downloading, setDownloading] = useState(false);
  const type = params.type === 'assignments' ? 'assignments' : 'assets';
  const report = REPORTS[type];

  const filters = type === 'assets'
    ? { status: params.status, department_id: params.department_id, category: params.category, from: params.from, to: params.to, include_inactive: params.include_inactive }
    : { active: params.active, department_id: params.department_id, from: params.from, to: params.to };

  const departments = useApi(() => api.get('/departments'), []);
  const categories = useApi(() => api.get('/assets/categories'), []);
  const preview = useApi(() => api.get(`/reports/${type}`, filters), [type, JSON.stringify(filters)]);

  async function download() {
    setDownloading(true);
    try {
      await downloadFile(`/reports/${type}.csv`, filters, report.file);
      toast.success('CSV dosyası indirildi');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDownloading(false);
    }
  }

  const fmt = (key, v) => {
    if (v === null || v === undefined || v === '') return '—';
    if (DATE_KEYS.has(key)) return formatDate(v);
    if (DATETIME_KEYS.has(key)) return formatDateTime(v);
    return String(v);
  };

  const rows = preview.data?.data || [];
  const headers = preview.data?.headers || [];
  const deptName = (departments.data?.data || []).find((d) => String(d.id) === params.department_id)?.name;
  const filterSummary = [
    params.status && `Durum: ${{ ACTIVE: 'Zimmetli', IN_STOCK: 'Depoda', DEFECTIVE: 'Arızalı' }[params.status]}`,
    params.active && `Zimmet: ${{ true: 'aktif', false: 'iade edilmiş', all: 'tümü' }[params.active]}`,
    deptName && `Departman: ${deptName}`,
    params.category && `Kategori: ${params.category}`,
    (params.from || params.to) && `${report.dateLabel}: ${params.from ? formatDate(params.from) : '…'} – ${params.to ? formatDate(params.to) : '…'}`,
  ].filter(Boolean);

  return (
    <>
      <div className="print:hidden">
        <PageHeader title="Raporlar" description="Envanter ve zimmet kayıtlarını filtreleyip CSV (Excel) olarak indirin veya yazdırın / PDF olarak kaydedin."
          actions={(
            <>
              <button type="button" className="btn btn-secondary" onClick={() => window.print()} disabled={!rows.length}>Yazdır / PDF</button>
              <button type="button" className="btn btn-primary" onClick={download} disabled={downloading || !rows.length}>
                {downloading ? <Spinner className="size-4 text-white" /> : <Icon name="download" className="size-4" />}CSV indir
              </button>
            </>
          )} />

        <div className="mb-3 flex gap-1" role="tablist" aria-label="Rapor türü">
          {Object.entries(REPORTS).map(([key, r]) => (
            <button key={key} type="button" role="tab" aria-selected={type === key}
              className={`rounded-md px-3 py-1.5 text-sm font-semibold ${type === key ? 'bg-ink text-white' : 'text-ink-soft hover:bg-surface'}`}
              onClick={() => setParams({ type: key === 'assets' ? undefined : key, status: undefined, active: undefined, category: undefined, include_inactive: undefined })}>
              {r.title}
            </button>
          ))}
        </div>

        <div className="panel mb-4 flex flex-col gap-2 p-3 sm:flex-row sm:flex-wrap sm:items-center">
          {type === 'assets' ? (
            <>
              <FilterSelect label="Durum" value={params.status} onChange={(v) => setParams({ status: v })}>
                <option value="">Tüm durumlar</option>
                <option value="ACTIVE">Zimmetli</option>
                <option value="IN_STOCK">Depoda</option>
                <option value="DEFECTIVE">Arızalı</option>
              </FilterSelect>
              <FilterSelect label="Kategori" value={params.category} onChange={(v) => setParams({ category: v })}>
                <option value="">Tüm kategoriler</option>
                {(categories.data?.data || []).map((c) => <option key={c} value={c}>{c}</option>)}
              </FilterSelect>
            </>
          ) : (
            <FilterSelect label="Zimmet durumu" value={params.active} onChange={(v) => setParams({ active: v })}>
              <option value="">Aktif ve iade edilmiş</option>
              <option value="true">Yalnızca aktif</option>
              <option value="false">Yalnızca iade edilmiş</option>
            </FilterSelect>
          )}
          <FilterSelect label="Departman" value={params.department_id} onChange={(v) => setParams({ department_id: v })}>
            <option value="">Tüm departmanlar</option>
            {(departments.data?.data || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </FilterSelect>
          <label className="flex items-center gap-2 text-sm text-steel-dark">
            <span className="whitespace-nowrap">{report.dateLabel}</span>
            <input type="date" aria-label={`${report.dateLabel} başlangıç`} className="field-input py-1.5" value={params.from || ''} onChange={(e) => setParams({ from: e.target.value })} />
            <span>–</span>
            <input type="date" aria-label={`${report.dateLabel} bitiş`} className="field-input py-1.5" value={params.to || ''} onChange={(e) => setParams({ to: e.target.value })} />
          </label>
          {type === 'assets' && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="accent-cobalt" checked={params.include_inactive === 'true'} onChange={(e) => setParams({ include_inactive: e.target.checked ? 'true' : undefined })} />
              Pasife alınanları dahil et
            </label>
          )}
        </div>
      </div>

      <section className="panel print:border-0">
        <div className="border-b border-line px-4 py-3">
          <h2 className="font-bold print:text-xl">{report.title}</h2>
          <p className="text-sm text-steel-dark">
            {preview.data ? `${rows.length} kayıt` : ''}{filterSummary.length ? `. ${filterSummary.join('; ')}` : ''}
            <span className="hidden print:inline">. Oluşturulma: {formatDateTime(new Date())}</span>
          </p>
        </div>
        {preview.error && <div className="p-4"><ErrorBlock error={preview.error} onRetry={preview.reload} /></div>}
        {preview.loading && !preview.data ? <LoadingBlock /> : rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-steel-dark">Filtrelere uyan kayıt yok.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13.5px] print:text-[9pt]">
                <thead>
                  <tr className="border-b border-line text-steel-dark">
                    {headers.map(([key, label]) => <th key={key} scope="col" className="px-3 py-2 font-semibold whitespace-nowrap">{label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className={`border-b border-line/60 ${i >= PREVIEW_LIMIT ? 'hidden print:table-row' : ''}`}>
                      {headers.map(([key]) => (
                        <td key={key} className={`px-3 py-1.5 whitespace-nowrap ${key === 'asset_code' || key === 'serial_number' ? 'font-mono' : ''}`}>{fmt(key, r[key])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length > PREVIEW_LIMIT && (
              <p className="px-4 py-2 text-sm text-steel-dark print:hidden">Ekranda ilk {PREVIEW_LIMIT} kayıt gösteriliyor; CSV ve çıktı tüm {rows.length} kaydı içerir.</p>
            )}
          </>
        )}
      </section>
    </>
  );
}
