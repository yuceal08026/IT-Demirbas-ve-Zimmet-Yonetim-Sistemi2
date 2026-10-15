import { useState } from 'react';
import { api } from '../lib/api.js';
import { useApi, useTitle } from '../lib/hooks.js';
import { Link, useNavigate } from '../lib/router.jsx';
import { daysFromToday, durationLabel, formatDate, formatDateTime } from '../lib/format.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';
import {
  AssetTag, ConfirmDialog, ErrorBlock, Field, Icon, LoadingBlock, Modal, PageHeader, Pill, StatusBadge,
} from '../components/ui.jsx';
import { AssignModal, ReturnModal } from '../components/AssignmentModals.jsx';
import Timeline from '../components/Timeline.jsx';
import MaintenancePanel from '../components/MaintenancePanel.jsx';
import { WarrantyCell } from './AssetsPage.jsx';

function InfoRow({ label, children }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-3 py-2.5 text-[15px]">
      <dt className="text-steel-dark">{label}</dt>
      <dd className="min-w-0 text-ink">{children}</dd>
    </div>
  );
}

/** Cihaza yapıştırılacak etiket: yazdırırken yalnızca bu bölüm basılır. */
function PrintLabel({ asset }) {
  return (
    <div id="print-label" className="hidden print:flex">
      <div className="flex items-center gap-4 rounded border border-black p-3" style={{ width: '90mm' }}>
        <img src={`/api/assets/${asset.id}/qr?format=svg`} alt="" style={{ width: '28mm', height: '28mm' }} />
        <div className="min-w-0">
          <p className="text-[9pt] font-semibold">DEMİRBAŞ — BİLGİ İŞLEM</p>
          <p className="font-mono text-[15pt] font-semibold tracking-wider">{asset.asset_code}</p>
          <p className="text-[9pt]">{asset.brand} {asset.model}</p>
          <p className="font-mono text-[8pt]">SN {asset.serial_number}</p>
        </div>
      </div>
    </div>
  );
}

function StatusModal({ asset, onClose, onDone }) {
  const toast = useToast();
  const target = asset.status === 'DEFECTIVE' ? 'IN_STOCK' : 'DEFECTIVE';
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.patch(`/assets/${asset.id}/status`, { status: target, note: note.trim() || null });
      toast.success(target === 'DEFECTIVE' ? 'Cihaz arızalı olarak işaretlendi' : 'Cihaz depoya alındı');
      onDone();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open onClose={onClose} title={target === 'DEFECTIVE' ? 'Arızalı olarak işaretle' : 'Onarıldı, depoya al'}
      footer={(
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Vazgeç</button>
          <button type="submit" form="status-form" className={`btn ${target === 'DEFECTIVE' ? 'btn-danger' : 'btn-primary'}`} disabled={busy}>
            {target === 'DEFECTIVE' ? 'Arızalı olarak işaretle' : 'Depoya al'}
          </button>
        </>
      )}>
      <form id="status-form" onSubmit={submit} className="space-y-3">
        <p className="text-ink-soft">
          {target === 'DEFECTIVE'
            ? 'Arızalı cihazlar zimmetlenemez. Ayrıntılı arıza takibi için bakım kaydı da açabilirsiniz.'
            : 'Cihaz "Depoda" durumuna geçer ve yeniden zimmetlenebilir.'}
        </p>
        <Field label="Not (isteğe bağlı)">
          {({ id }) => <textarea id={id} rows={2} className="field-input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />}
        </Field>
      </form>
    </Modal>
  );
}

function CustodyTable({ assetId }) {
  const hist = useApi(() => api.get(`/assets/${assetId}/assignments`), [assetId]);
  if (hist.loading && !hist.data) return <LoadingBlock />;
  if (hist.error) return <ErrorBlock error={hist.error} onRetry={hist.reload} />;
  const rows = hist.data.data;
  if (!rows.length) return <p className="px-4 py-6 text-sm text-steel-dark">Bu cihaz henüz kimseye zimmetlenmedi.</p>;
  return (
    <ol className="divide-y divide-line">
      {rows.map((r) => {
        const end = r.returned_at || new Date().toISOString();
        const days = Math.round((new Date(end) - new Date(r.assigned_at)) / 86_400_000);
        return (
          <li key={r.id} className="grid gap-1 px-4 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
            <div className="min-w-0">
              <p className="font-semibold">
                <Link to={`/assets?user_id=${r.user.id}`} className="hover:underline">{r.user.ad_soyad}</Link>
                {r.user.department && <span className="font-normal text-steel-dark">, {r.user.department.name}</span>}
              </p>
              <p className="text-sm text-steel-dark">
                {formatDate(r.assigned_at)} – {r.returned_at ? formatDate(r.returned_at) : 'devam ediyor'} ({durationLabel(days)})
              </p>
              {(r.note || r.return_note) && (
                <p className="mt-0.5 text-sm text-ink-soft">{[r.note && `Teslim: ${r.note}`, r.return_note && `İade: ${r.return_note}`].filter(Boolean).join(' / ')}</p>
              )}
            </div>
            <div className="text-sm text-steel-dark sm:text-right">
              {r.returned_at ? <>İade alan: {r.returned_by?.ad_soyad || '—'}</> : <Pill tone="cobalt">Aktif zimmet</Pill>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export default function AssetDetailPage({ id, code }) {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const asset = useApi(() => (code ? api.get(`/assets/by-code/${encodeURIComponent(code)}`) : api.get(`/assets/${id}`)), [id, code]);
  const [modal, setModal] = useState(null);
  const [historyKey, setHistoryKey] = useState(0);
  useTitle(asset.data ? asset.data.asset_code : 'Cihaz');

  if (asset.loading && !asset.data) return <LoadingBlock />;
  if (asset.error) {
    if (asset.error.status === 404) {
      return (
        <div className="mx-auto max-w-md py-16 text-center">
          <h1 className="text-2xl font-bold">Cihaz bulunamadı</h1>
          <p className="mt-2 text-steel-dark">
            {isAdmin ? 'Bu kodla kayıtlı bir cihaz yok ya da silinmiş.' : 'Bu cihaz size zimmetli değil ya da sistemde kayıtlı değil. Yalnızca üzerinizdeki cihazların ayrıntılarını görebilirsiniz.'}
          </p>
          <Link to={isAdmin ? '/assets' : '/my-assets'} className="btn btn-primary mt-6">{isAdmin ? 'Cihaz listesine dön' : 'Zimmetlerime dön'}</Link>
        </div>
      );
    }
    return <ErrorBlock error={asset.error} onRetry={asset.reload} />;
  }

  const a = asset.data;
  const assignment = a.current_assignment;
  const refresh = () => { setModal(null); asset.reload(); setHistoryKey((k) => k + 1); };
  const warrantyDays = daysFromToday(a.warranty_end_date);

  async function remove() {
    try {
      await api.delete(`/assets/${a.id}`);
      toast.success(`${a.asset_code} silindi`);
      navigate('/assets', { replace: true });
    } catch (err) {
      toast.error(err.message);
      setModal(null);
    }
  }
  async function toggleActive() {
    try {
      await api.patch(`/assets/${a.id}`, { is_active: !a.is_active });
      toast.success(a.is_active ? 'Cihaz pasife alındı' : 'Cihaz yeniden kullanıma alındı');
      refresh();
    } catch (err) {
      toast.error(err.message);
      setModal(null);
    }
  }

  return (
    <>
      <div className="print:hidden">
        {isAdmin && (
          <Link to="/assets" className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-cobalt hover:underline">
            <Icon name="chevronLeft" className="size-4" />Cihazlar
          </Link>
        )}
        <PageHeader title={`${a.brand} ${a.model}`} description={a.category}
          actions={isAdmin && (
            <>
              {a.status === 'IN_STOCK' && a.is_active && (
                <button type="button" className="btn btn-primary" onClick={() => setModal('assign')}>Zimmetle</button>
              )}
              {assignment && <button type="button" className="btn btn-primary" onClick={() => setModal('return')}>İade al</button>}
              <Link to={`/assets/${a.id}/edit`} className="btn btn-secondary"><Icon name="edit" className="size-4" />Düzenle</Link>
            </>
          )}>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <AssetTag code={a.asset_code} size="md" />
            <StatusBadge status={a.status} />
            {!a.is_active && <Pill tone="muted">Pasif kayıt</Pill>}
          </div>
        </PageHeader>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="space-y-6">
            <section className="panel">
              <h2 className="border-b border-line px-4 py-3 font-bold">Kimde?</h2>
              {assignment ? (
                <div className="flex flex-col gap-1 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-lg font-semibold">{assignment.user.ad_soyad}</p>
                    <p className="text-steel-dark">{assignment.user.department?.name || 'Departman yok'}, {assignment.user.email}</p>
                  </div>
                  <p className="text-sm text-steel-dark sm:text-right">
                    {formatDate(assignment.assigned_at)} tarihinden beri<br />
                    ({durationLabel(-daysFromToday(assignment.assigned_at))})
                  </p>
                </div>
              ) : (
                <p className="px-4 py-4 text-steel-dark">
                  {a.status === 'DEFECTIVE' ? 'Cihaz arızalı; kimseye zimmetli değil.' : 'Cihaz depoda; kimseye zimmetli değil.'}
                </p>
              )}
            </section>

            <section className="panel">
              <h2 className="border-b border-line px-4 py-3 font-bold">Cihaz bilgileri</h2>
              <dl className="divide-y divide-line/70 px-4">
                <InfoRow label="Seri numarası"><span className="font-mono">{a.serial_number}</span></InfoRow>
                <InfoRow label="Kategori">{a.category}</InfoRow>
                <InfoRow label="Alım tarihi">{formatDate(a.purchase_date)}</InfoRow>
                <InfoRow label="Garanti bitişi">
                  <WarrantyCell date={a.warranty_end_date} />
                  {warrantyDays != null && warrantyDays > 60 && <span className="text-sm text-steel-dark"> ({durationLabel(warrantyDays)} kaldı)</span>}
                </InfoRow>
                <InfoRow label="Son durum değişikliği">{formatDateTime(a.status_changed_at)}</InfoRow>
                {isAdmin && <InfoRow label="Kayıt tarihi">{formatDateTime(a.created_at)}</InfoRow>}
                {isAdmin && a.notes && <InfoRow label="Not"><span className="whitespace-pre-line">{a.notes}</span></InfoRow>}
              </dl>
            </section>

            {isAdmin && (
              <>
                <MaintenancePanel asset={a} onChanged={refresh} key={`m-${historyKey}`} />
                <section className="panel">
                  <h2 className="border-b border-line px-4 py-3 font-bold">Zimmet geçmişi</h2>
                  <CustodyTable assetId={a.id} key={`c-${historyKey}`} />
                </section>
                <section className="panel">
                  <h2 className="border-b border-line px-4 py-3 font-bold">Zaman çizelgesi</h2>
                  <Timeline assetId={a.id} key={`t-${historyKey}`} />
                </section>
              </>
            )}
          </div>

          <aside className="space-y-6">
            <section className="panel p-4">
              <h2 className="font-bold">QR etiketi</h2>
              <p className="mt-1 text-sm text-steel-dark">Okutulduğunda bu sayfayı açar. Görmek için giriş ve yetki gerekir.</p>
              <div className="mt-4 rounded-md border border-line bg-white p-3">
                <img src={`/api/assets/${a.id}/qr`} alt={`${a.asset_code} QR kodu`} className="mx-auto aspect-square w-full max-w-[220px]" />
                <p className="mt-2 text-center font-mono text-sm font-semibold tracking-wider">{a.asset_code}</p>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <a href={`/api/assets/${a.id}/qr?format=png&download=1`} className="btn btn-secondary btn-sm"><Icon name="download" className="size-4" />PNG</a>
                <a href={`/api/assets/${a.id}/qr?format=svg&download=1`} className="btn btn-secondary btn-sm"><Icon name="download" className="size-4" />SVG</a>
                <button type="button" className="btn btn-secondary btn-sm col-span-2" onClick={() => window.print()}>Etiketi yazdır</button>
              </div>
            </section>

            {isAdmin && (
              <section className="panel p-4">
                <h2 className="font-bold">Diğer işlemler</h2>
                <div className="mt-3 flex flex-col gap-2">
                  {!assignment && a.status === 'IN_STOCK' && (
                    <button type="button" className="btn btn-secondary justify-start" onClick={() => setModal('status')}>Arızalı olarak işaretle</button>
                  )}
                  {a.status === 'DEFECTIVE' && (
                    <button type="button" className="btn btn-secondary justify-start" onClick={() => setModal('status')}>Onarıldı, depoya al</button>
                  )}
                  {!assignment && (
                    <button type="button" className="btn btn-secondary justify-start" onClick={() => setModal('toggle')}>
                      {a.is_active ? 'Pasife al (envanterden çıkar)' : 'Yeniden kullanıma al'}
                    </button>
                  )}
                  {!assignment && (
                    <button type="button" className="btn btn-secondary justify-start text-st-defect" onClick={() => setModal('delete')}>Kaydı sil</button>
                  )}
                  {assignment && <p className="text-sm text-steel-dark">Durum değişikliği, pasife alma ve silme için önce cihazı iade alın.</p>}
                </div>
              </section>
            )}
          </aside>
        </div>
      </div>

      <PrintLabel asset={a} />

      {isAdmin && (
        <>
          <AssignModal open={modal === 'assign'} presetAsset={a} onClose={() => setModal(null)} onDone={refresh} />
          <ReturnModal assignment={modal === 'return' ? assignment : null} asset={a} onClose={() => setModal(null)} onDone={refresh} />
          {modal === 'status' && <StatusModal asset={a} onClose={() => setModal(null)} onDone={refresh} />}
          {modal === 'toggle' && (
            <ConfirmDialog open title={a.is_active ? 'Cihazı pasife al' : 'Cihazı yeniden kullanıma al'} tone={a.is_active ? 'danger' : 'primary'}
              confirmLabel={a.is_active ? 'Pasife al' : 'Kullanıma al'} onConfirm={toggleActive} onClose={() => setModal(null)}>
              {a.is_active
                ? 'Cihaz listelerden ve sayımlardan çıkar ama tüm geçmişi korunur. Hurdaya ayrılan veya kaybolan cihazlar için kullanın.'
                : 'Cihaz tekrar envanter sayımlarına ve listelere dahil olur.'}
            </ConfirmDialog>
          )}
          {modal === 'delete' && (
            <ConfirmDialog open title="Cihaz kaydını sil" confirmLabel="Kalıcı olarak sil" onConfirm={remove} onClose={() => setModal(null)}>
              Bu işlem geri alınamaz. Zimmet geçmişi olan cihazlar silinemez; onları pasife alın.
            </ConfirmDialog>
          )}
        </>
      )}
    </>
  );
}
