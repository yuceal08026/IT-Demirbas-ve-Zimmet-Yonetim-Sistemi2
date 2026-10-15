import { useState } from 'react';
import { api } from '../lib/api.js';
import { useApi } from '../lib/hooks.js';
import { formatDateTime } from '../lib/format.js';
import { useToast } from './Toast.jsx';
import { ConfirmDialog, ErrorBlock, Field, Modal, Spinner } from './ui.jsx';

function ResolveModal({ request, onClose, onDone }) {
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (password.length < 8 || !/\d/.test(password) || !/[A-Za-zÇĞİÖŞÜçğıöşü]/.test(password)) {
      setError('Parola en az 8 karakter olmalı, harf ve rakam içermelidir');
      return;
    }
    setBusy(true);
    try {
      await api.post(`/password-reset-requests/${request.id}/resolve`, { password });
      toast.success(`${request.user.ad_soyad} için geçici parola belirlendi. Parolayı kişiye iletin; ilk girişte kendi parolasını belirleyecek.`);
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Geçici parola ver"
      footer={(
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Vazgeç</button>
          <button type="submit" form="reset-req-form" className="btn btn-primary" disabled={busy}>
            {busy && <Spinner className="size-4 text-white" />}Geçici parolayı kaydet
          </button>
        </>
      )}>
      <form id="reset-req-form" onSubmit={submit} noValidate className="space-y-3">
        <p className="text-sm text-ink-soft">
          <strong>{request.user.ad_soyad}</strong> ({request.user.email}) parolasını unuttuğunu bildirdi. Bir geçici parola belirleyin ve
          kişiye güvenli bir yoldan (yüz yüze, telefon) iletin. Kişi bu parolayla girince kendi parolasını belirlemek zorunda kalır.
        </p>
        <Field label="Geçici parola" error={error} hint="En az 8 karakter; harf ve rakam içermeli.">
          {({ id, invalid, describedBy }) => (
            <input id={id} type="text" className="field-input font-mono" value={password} onChange={(e) => setPassword(e.target.value)}
              aria-invalid={invalid} aria-describedby={describedBy} autoComplete="off" spellCheck={false} />
          )}
        </Field>
      </form>
    </Modal>
  );
}

/** Personel sayfasının üstünde: bekleyen "şifremi unuttum" talepleri. Talep yoksa hiçbir şey göstermez. */
export default function ResetRequestsPanel({ onChanged }) {
  const toast = useToast();
  const list = useApi(() => api.get('/password-reset-requests', { status: 'PENDING' }), []);
  const [resolving, setResolving] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const rows = list.data?.data || [];

  const done = () => { setResolving(null); setRejecting(null); list.reload(); onChanged?.(); };

  async function reject() {
    try {
      await api.post(`/password-reset-requests/${rejecting.id}/reject`);
      toast.success('Talep reddedildi');
      done();
    } catch (err) {
      toast.error(err.message);
      setRejecting(null);
    }
  }

  if (list.error) return <div className="mb-4"><ErrorBlock error={list.error} onRetry={list.reload} /></div>;
  if (!rows.length) return null;

  return (
    <section className="panel mb-4 border-warn/40" aria-labelledby="reset-title">
      <h2 id="reset-title" className="border-b border-line px-4 py-3 font-bold">
        Parola sıfırlama talepleri <span className="ml-1 rounded-full bg-warn-tint px-2 py-0.5 text-[13px] text-warn">{rows.length}</span>
      </h2>
      <ul className="divide-y divide-line">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="font-semibold">{r.user.ad_soyad} <span className="font-normal text-steel-dark">{r.user.email}</span></p>
              <p className="text-sm text-steel-dark">
                {formatDateTime(r.created_at)}{r.user.department_name ? `, ${r.user.department_name}` : ''}
                {r.user.role === 'ADMIN' ? ', yönetici hesabı' : ''}
              </p>
            </div>
            <div className="flex gap-1">
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setResolving(r)}>Geçici parola ver</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRejecting(r)}>Reddet</button>
            </div>
          </li>
        ))}
      </ul>
      {resolving && <ResolveModal request={resolving} onClose={() => setResolving(null)} onDone={done} />}
      {rejecting && (
        <ConfirmDialog open title="Talebi reddet" confirmLabel="Reddet" onConfirm={reject} onClose={() => setRejecting(null)}>
          <p><strong className="text-ink">{rejecting.user.ad_soyad}</strong> adına gelen talep reddedilecek. Kişinin parolası değişmez.
            Talebi kişinin kendisi göndermediyse reddedin.</p>
        </ConfirmDialog>
      )}
    </section>
  );
}
