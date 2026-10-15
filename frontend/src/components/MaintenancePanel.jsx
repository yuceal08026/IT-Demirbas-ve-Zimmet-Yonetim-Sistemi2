import { useState } from 'react';
import { api } from '../lib/api.js';
import { useApi } from '../lib/hooks.js';
import { formatDateTime } from '../lib/format.js';
import { useToast } from './Toast.jsx';
import { ErrorBlock, Field, Icon, LoadingBlock, Modal, Spinner } from './ui.jsx';

const STATUS = {
  OPEN: { label: 'Açık', cls: 'bg-st-defect-tint text-st-defect' },
  IN_PROGRESS: { label: 'İşlemde', cls: 'bg-warn-tint text-warn' },
  RESOLVED: { label: 'Çözüldü', cls: 'bg-st-active-tint text-st-active' },
};

function OpenModal({ asset, onClose, onDone }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [markDefective, setMarkDefective] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (text.trim().length < 5) { setError('Arızayı en az 5 karakterle açıklayın'); return; }
    setBusy(true);
    try {
      await api.post(`/assets/${asset.id}/maintenance`, { issue_description: text.trim(), mark_defective: markDefective });
      toast.success('Arıza kaydı açıldı');
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Arıza kaydı aç"
      footer={(
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Vazgeç</button>
          <button type="submit" form="mnt-open" className="btn btn-primary" disabled={busy}>{busy && <Spinner className="size-4 text-white" />}Kaydı aç</button>
        </>
      )}>
      <form id="mnt-open" onSubmit={submit} noValidate className="space-y-4">
        <Field label="Arıza açıklaması" error={error}>
          {({ id, invalid }) => (
            <textarea id={id} rows={3} className="field-input" value={text} onChange={(e) => setText(e.target.value)} aria-invalid={invalid}
              placeholder="Örn. ekran açılmıyor, şarj olmuyor" maxLength={2000} />
          )}
        </Field>
        {asset.status === 'IN_STOCK' && (
          <label className="flex items-start gap-2 text-[15px]">
            <input type="checkbox" className="mt-1 accent-cobalt" checked={markDefective} onChange={(e) => setMarkDefective(e.target.checked)} />
            <span>Cihazı "Arızalı" olarak işaretle <span className="block text-sm text-steel-dark">Arızalı cihazlar zimmetlenemez.</span></span>
          </label>
        )}
        {asset.status === 'ACTIVE' && (
          <p className="text-sm text-steel-dark">Cihaz şu anda personelde. Kayıt açılır ama cihaz zimmetli kalır; servise gidecekse önce iade alın.</p>
        )}
      </form>
    </Modal>
  );
}

function ResolveModal({ record, asset, isLastOpen, onClose, onDone }) {
  const toast = useToast();
  const [note, setNote] = useState(record.solution_note || '');
  const [restock, setRestock] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const canRestock = asset.status === 'DEFECTIVE' && isLastOpen;

  async function submit(e) {
    e.preventDefault();
    if (!note.trim()) { setError('Çözüm notu zorunludur'); return; }
    setBusy(true);
    try {
      await api.patch(`/maintenance/${record.id}`, { status: 'RESOLVED', solution_note: note.trim(), return_to_stock: canRestock && restock });
      toast.success(canRestock && restock ? 'Arıza kapatıldı, cihaz depoya alındı' : 'Arıza kaydı kapatıldı');
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Arızayı kapat"
      footer={(
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Vazgeç</button>
          <button type="submit" form="mnt-resolve" className="btn btn-primary" disabled={busy}>{busy && <Spinner className="size-4 text-white" />}Çözüldü olarak kapat</button>
        </>
      )}>
      <form id="mnt-resolve" onSubmit={submit} noValidate className="space-y-4">
        <p className="rounded-md bg-paper px-3 py-2 text-sm text-ink-soft">{record.issue_description}</p>
        <Field label="Çözüm notu" error={error} hint="Kapatılan kayıtlar sonradan değiştirilemez.">
          {({ id, invalid, describedBy }) => (
            <textarea id={id} rows={3} className="field-input" value={note} onChange={(e) => setNote(e.target.value)} aria-invalid={invalid}
              aria-describedby={describedBy} placeholder="Örn. batarya değiştirildi, test edildi" maxLength={2000} />
          )}
        </Field>
        {canRestock && (
          <label className="flex items-start gap-2 text-[15px]">
            <input type="checkbox" className="mt-1 accent-cobalt" checked={restock} onChange={(e) => setRestock(e.target.checked)} />
            <span>Cihazı depoya al <span className="block text-sm text-steel-dark">Durumu "Depoda" olur ve yeniden zimmetlenebilir.</span></span>
          </label>
        )}
      </form>
    </Modal>
  );
}

export default function MaintenancePanel({ asset, onChanged }) {
  const toast = useToast();
  const list = useApi(() => api.get(`/assets/${asset.id}/maintenance`), [asset.id]);
  const [modal, setModal] = useState(null);
  const records = list.data?.data || [];
  const openCount = records.filter((r) => r.status !== 'RESOLVED').length;

  async function startWork(r) {
    try {
      await api.patch(`/maintenance/${r.id}`, { status: 'IN_PROGRESS' });
      toast.success('Arıza kaydı işleme alındı');
      list.reload();
      onChanged?.();
    } catch (err) {
      toast.error(err.message);
    }
  }
  const done = () => { setModal(null); list.reload(); onChanged?.(); };

  return (
    <section className="panel" aria-labelledby="mnt-title">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <h2 id="mnt-title" className="font-bold">
          Arıza ve bakım
          {openCount > 0 && <span className="ml-2 rounded-full bg-st-defect-tint px-2 py-0.5 text-[13px] font-semibold text-st-defect">{openCount} açık</span>}
        </h2>
        {asset.is_active && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setModal({ type: 'open' })}>
            <Icon name="plus" className="size-4" />Arıza kaydı aç
          </button>
        )}
      </div>
      {list.error && <div className="p-4"><ErrorBlock error={list.error} onRetry={list.reload} /></div>}
      {list.loading && !list.data ? <LoadingBlock /> : records.length === 0 ? (
        <p className="px-4 py-6 text-sm text-steel-dark">Bu cihaz için arıza kaydı yok.</p>
      ) : (
        <ul className="divide-y divide-line">
          {records.map((r) => (
            <li key={r.id} className="px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <span className={`mr-2 inline-block rounded-full px-2 py-0.5 text-[13px] font-semibold ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span>
                  <span className="text-[15px]">{r.issue_description}</span>
                  <p className="mt-0.5 text-[13px] text-steel">Açan: {r.reported_by?.ad_soyad || '—'}, {formatDateTime(r.created_at)}</p>
                  {r.status === 'RESOLVED' && (
                    <p className="mt-1 text-sm text-ink-soft">
                      <span className="font-semibold">Çözüm:</span> {r.solution_note}
                      <span className="block text-[13px] text-steel">Kapatan: {r.closed_by?.ad_soyad || '—'}, {formatDateTime(r.closed_at)}</span>
                    </p>
                  )}
                </div>
                {r.status !== 'RESOLVED' && (
                  <div className="flex gap-1">
                    {r.status === 'OPEN' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => startWork(r)}>İşleme al</button>}
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setModal({ type: 'resolve', record: r })}>Kapat</button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {modal?.type === 'open' && <OpenModal asset={asset} onClose={() => setModal(null)} onDone={done} />}
      {modal?.type === 'resolve' && (
        <ResolveModal record={modal.record} asset={asset} isLastOpen={openCount === 1} onClose={() => setModal(null)} onDone={done} />
      )}
    </section>
  );
}
