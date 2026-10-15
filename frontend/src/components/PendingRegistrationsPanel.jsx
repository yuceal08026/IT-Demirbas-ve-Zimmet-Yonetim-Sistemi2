import { useState } from 'react';
import { api } from '../lib/api.js';
import { useApi } from '../lib/hooks.js';
import { formatDateTime } from '../lib/format.js';
import { useToast } from './Toast.jsx';
import { ConfirmDialog, ErrorBlock, Field, Modal, Spinner } from './ui.jsx';

function ApproveModal({ user, departments, onClose, onDone }) {
  const toast = useToast();
  const [dep, setDep] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post(`/users/${user.id}/approve`, { department_id: dep === '' ? null : Number(dep) });
      toast.success(`${user.ad_soyad} onaylandı; artık giriş yapabilir.`);
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Kaydı onayla"
      footer={(
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Vazgeç</button>
          <button type="submit" form="approve-form" className="btn btn-primary" disabled={busy}>
            {busy && <Spinner className="size-4 text-white" />}Onayla
          </button>
        </>
      )}>
      <form id="approve-form" onSubmit={submit} noValidate className="space-y-3">
        <p className="text-sm text-ink-soft">
          <strong>{user.ad_soyad}</strong> ({user.email}) personel olarak sisteme girebilecek. Bu kişiyi tanıdığınızdan emin olun.
        </p>
        <Field label="Departman (isteğe bağlı)" error={error}>
          {({ id }) => (
            <select id={id} className="field-input" value={dep} onChange={(e) => setDep(e.target.value)}>
              <option value="">Departman yok</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          )}
        </Field>
      </form>
    </Modal>
  );
}

/** Personel sayfasının üstünde: kendi kaydolup onay bekleyen kişiler. Yoksa hiçbir şey göstermez. */
export default function PendingRegistrationsPanel({ departments, onChanged }) {
  const toast = useToast();
  const list = useApi(() => api.get('/users', { approval: 'pending', limit: 100, sort: 'created_at', order: 'asc' }), []);
  const [approving, setApproving] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const rows = list.data?.data || [];
  const done = () => { setApproving(null); setRejecting(null); list.reload(); onChanged?.(); };

  async function reject() {
    try {
      await api.post(`/users/${rejecting.id}/reject`);
      toast.success('Kayıt reddedildi ve silindi');
      done();
    } catch (err) {
      toast.error(err.message);
      setRejecting(null);
    }
  }

  if (list.error) return <div className="mb-4"><ErrorBlock error={list.error} onRetry={list.reload} /></div>;
  if (!rows.length) return null;

  return (
    <section className="panel mb-4" aria-labelledby="pending-title">
      <h2 id="pending-title" className="border-b border-line px-4 py-3 font-bold">
        Onay bekleyen kayıtlar <span className="ml-1 rounded-full bg-cobalt-tint px-2 py-0.5 text-[13px] text-cobalt">{rows.length}</span>
      </h2>
      <ul className="divide-y divide-line">
        {rows.map((u) => (
          <li key={u.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="font-semibold">{u.ad_soyad} <span className="font-normal text-steel-dark">{u.email}</span></p>
              <p className="text-sm text-steel-dark">Kayıt: {formatDateTime(u.created_at)}</p>
            </div>
            <div className="flex gap-1">
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setApproving(u)}>Onayla</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRejecting(u)}>Reddet</button>
            </div>
          </li>
        ))}
      </ul>
      {approving && <ApproveModal user={approving} departments={departments} onClose={() => setApproving(null)} onDone={done} />}
      {rejecting && (
        <ConfirmDialog open title="Kaydı reddet" confirmLabel="Reddet ve sil" onConfirm={reject} onClose={() => setRejecting(null)}>
          <p><strong className="text-ink">{rejecting.ad_soyad}</strong> ({rejecting.email}) kaydı silinecek. Kişi isterse yeniden kaydolabilir.</p>
        </ConfirmDialog>
      )}
    </section>
  );
}
