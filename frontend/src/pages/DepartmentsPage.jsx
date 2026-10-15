import { useState } from 'react';
import { api } from '../lib/api.js';
import { useApi, useTitle } from '../lib/hooks.js';
import { Link } from '../lib/router.jsx';
import { useToast } from '../components/Toast.jsx';
import {
  ConfirmDialog, EmptyState, ErrorBlock, Field, Icon, LoadingBlock, Modal, PageHeader, Spinner,
} from '../components/ui.jsx';

export default function DepartmentsPage() {
  useTitle('Departmanlar');
  const toast = useToast();
  const list = useApi(() => api.get('/departments'), []);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  async function add(e) {
    e.preventDefault();
    if (name.trim().length < 2) { setError('Departman adı en az 2 karakter olmalıdır'); return; }
    setBusy(true);
    try {
      await api.post('/departments', { name: name.trim() });
      toast.success(`${name.trim()} eklendi`);
      setName('');
      setError('');
      list.reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function rename(e) {
    e.preventDefault();
    try {
      await api.patch(`/departments/${editing.id}`, { name: editing.name.trim() });
      toast.success('Departman adı güncellendi');
      setEditing(null);
      list.reload();
    } catch (err) {
      setEditing({ ...editing, error: err.message });
    }
  }

  async function remove() {
    try {
      await api.delete(`/departments/${deleting.id}`);
      toast.success(`${deleting.name} silindi`);
      list.reload();
    } catch (err) {
      toast.error(err.message);
    }
    setDeleting(null);
  }

  const rows = list.data?.data || [];
  return (
    <>
      <PageHeader title="Departmanlar" description="Personel departmanları. Cihaz listesindeki departman filtresi, cihazı elinde tutan personelin departmanına göre çalışır." />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="panel">
          {list.error && <div className="p-4"><ErrorBlock error={list.error} onRetry={list.reload} /></div>}
          {list.loading && !list.data ? <LoadingBlock /> : rows.length === 0 ? (
            <EmptyState title="Henüz departman yok">Sağdaki formdan ilk departmanı ekleyin.</EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {rows.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="font-semibold">{d.name}</p>
                    <Link to={`/users?department_id=${d.id}`} className="text-sm text-cobalt hover:underline">
                      {d.user_count} kişi
                    </Link>
                  </div>
                  <div className="flex gap-1">
                    <button type="button" className="btn btn-ghost btn-sm px-2" aria-label={`${d.name} adını değiştir`} title="Adını değiştir"
                      onClick={() => setEditing({ id: d.id, name: d.name })}><Icon name="edit" className="size-4" /></button>
                    <button type="button" className="btn btn-ghost btn-sm px-2 text-st-defect hover:bg-st-defect-tint" aria-label={`${d.name} sil`} title="Sil"
                      onClick={() => setDeleting(d)}><Icon name="trash" className="size-4" /></button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <form className="panel h-fit space-y-3 p-4" onSubmit={add} noValidate>
          <h2 className="font-bold">Departman ekle</h2>
          <Field label="Departman adı" error={error}>
            {({ id, invalid, describedBy }) => (
              <input id={id} className="field-input" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={invalid} aria-describedby={describedBy} />
            )}
          </Field>
          <button type="submit" className="btn btn-primary w-full" disabled={busy}>
            {busy && <Spinner className="size-4 text-white" />}Departmanı ekle
          </button>
        </form>
      </div>

      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title="Departman adını değiştir"
        footer={(
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setEditing(null)}>Vazgeç</button>
            <button type="submit" form="dept-form" className="btn btn-primary">Kaydet</button>
          </>
        )}>
        {editing && (
          <form id="dept-form" onSubmit={rename} noValidate>
            <Field label="Departman adı" error={editing.error}>
              {({ id, invalid }) => (
                <input id={id} className="field-input" value={editing.name} aria-invalid={invalid}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value, error: undefined })} />
              )}
            </Field>
          </form>
        )}
      </Modal>

      {deleting && (
        <ConfirmDialog open title="Departmanı sil" confirmLabel="Departmanı sil" onConfirm={remove} onClose={() => setDeleting(null)}>
          <p><strong className="text-ink">{deleting.name}</strong> silinecek. Departmanda personel varsa önce başka bir departmana taşınmaları gerekir.</p>
        </ConfirmDialog>
      )}
    </>
  );
}
