import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { formatDate } from '../lib/format.js';
import { useToast } from './Toast.jsx';
import { AssetTag, Field, Modal, Spinner } from './ui.jsx';
import SearchPicker from './SearchPicker.jsx';

const fetchUsers = (search) =>
  api.get('/users', { search, is_active: 'true', limit: 20, sort: 'ad_soyad', order: 'asc' }).then((r) => r.data);
const fetchStockAssets = (search) =>
  api.get('/assets', { search, status: 'IN_STOCK', limit: 20, sort: 'asset_code', order: 'asc' }).then((r) => r.data);

export const UserOption = ({ user }) => (
  <div className="min-w-0">
    <p className="truncate font-semibold">{user.ad_soyad}</p>
    <p className="truncate text-sm text-steel-dark">{user.email}{user.department_name ? `, ${user.department_name}` : ''}</p>
  </div>
);

export const AssetOption = ({ asset }) => (
  <div className="flex min-w-0 items-center gap-2">
    <AssetTag code={asset.asset_code} />
    <span className="truncate">{asset.brand} {asset.model}</span>
  </div>
);

/**
 * Zimmet teslim. presetAsset / presetUser verilirse o alan sabitlenir.
 * Sunucu tarafı kurallar (cihaz IN_STOCK olmalı, çakışan zimmet yok, kullanıcı aktif) API'de uygulanır.
 */
export function AssignModal({ open, presetAsset = null, presetUser = null, onClose, onDone }) {
  const toast = useToast();
  const [asset, setAsset] = useState(presetAsset);
  const [user, setUser] = useState(presetUser);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAsset(presetAsset);
    setUser(presetUser);
    setNote('');
    setErrors({});
  }, [open, presetAsset, presetUser]);

  async function submit(e) {
    e.preventDefault();
    const errs = {};
    if (!asset) errs.asset_id = 'Zimmetlenecek cihazı seçin';
    if (!user) errs.user_id = 'Teslim alacak personeli seçin';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      await api.post('/assignments', { asset_id: asset.id, user_id: user.id, note: note.trim() || null });
      toast.success(`${asset.asset_code}, ${user.ad_soyad} adına zimmetlendi`);
      onDone();
    } catch (err) {
      setErrors(err.fieldErrors?.() || {});
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Zimmetle"
      footer={(
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Vazgeç</button>
          <button type="submit" form="assign-form" className="btn btn-primary" disabled={busy}>
            {busy && <Spinner className="size-4 text-white" />}Zimmetle
          </button>
        </>
      )}>
      <form id="assign-form" onSubmit={submit} noValidate className="space-y-4">
        <SearchPicker label="Cihaz (yalnızca depodakiler)" value={asset} onChange={setAsset} disabled={Boolean(presetAsset)}
          fetchOptions={fetchStockAssets} getLabel={(a) => a.asset_code} placeholder="Kod, seri no, marka veya model"
          renderOption={(a) => <AssetOption asset={a} />} error={errors.asset_id} emptyText="Depoda eşleşen cihaz yok" />
        <SearchPicker label="Teslim alan personel" value={user} onChange={setUser} disabled={Boolean(presetUser)}
          fetchOptions={fetchUsers} getLabel={(u) => u.ad_soyad} placeholder="Ad veya e-posta"
          renderOption={(u) => <UserOption user={u} />} error={errors.user_id} emptyText="Aktif personel bulunamadı" />
        <Field label="Teslim notu (isteğe bağlı)" error={errors.note}>
          {({ id }) => (
            <textarea id={id} rows={2} className="field-input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500}
              placeholder="Örn. şarj aleti ve çanta ile teslim edildi" />
          )}
        </Field>
      </form>
    </Modal>
  );
}

/** Zimmet iade. Cihaz iade sonrası "Depoda" (veya arızalı teslim edildiyse "Arızalı") olur. */
export function ReturnModal({ assignment, asset, onClose, onDone }) {
  const toast = useToast();
  const [condition, setCondition] = useState('IN_STOCK');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { setCondition('IN_STOCK'); setNote(''); }, [assignment]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post(`/assignments/${assignment.id}/return`, { condition, return_note: note.trim() || null });
      toast.success(`${asset.asset_code} iade alındı; cihaz ${condition === 'IN_STOCK' ? 'depoda' : 'arızalı olarak kaydedildi'}`);
      onDone();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={Boolean(assignment)} onClose={onClose} title="İade al"
      footer={(
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Vazgeç</button>
          <button type="submit" form="return-form" className="btn btn-primary" disabled={busy}>
            {busy && <Spinner className="size-4 text-white" />}İade al
          </button>
        </>
      )}>
      {assignment && (
        <form id="return-form" onSubmit={submit} noValidate className="space-y-4">
          <div className="rounded-md border border-line bg-paper px-3 py-2.5 text-sm">
            <AssetOption asset={asset} />
            <p className="mt-1.5 text-ink-soft">
              <strong>{assignment.user.ad_soyad}</strong> üzerinde, {formatDate(assignment.assigned_at)} tarihinden beri.
            </p>
          </div>
          <fieldset>
            <legend className="field-label">Cihaz hangi durumda teslim edildi?</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {[['IN_STOCK', 'Sağlam', 'Depoya alınır, yeniden zimmetlenebilir'], ['DEFECTIVE', 'Arızalı', 'Arızalı olarak işaretlenir']].map(([v, t, d]) => (
                <label key={v} className={`flex cursor-pointer gap-2 rounded-md border px-3 py-2.5 ${condition === v ? 'border-cobalt bg-cobalt-tint' : 'border-line'}`}>
                  <input type="radio" name="condition" value={v} checked={condition === v} onChange={() => setCondition(v)} className="mt-1 accent-cobalt" />
                  <span><span className="block font-semibold">{t}</span><span className="block text-sm text-steel-dark">{d}</span></span>
                </label>
              ))}
            </div>
          </fieldset>
          <Field label="İade notu (isteğe bağlı)">
            {({ id }) => (
              <textarea id={id} rows={2} className="field-input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500}
                placeholder={condition === 'DEFECTIVE' ? 'Arızayı kısaca açıklayın' : 'Örn. personel ayrıldı'} />
            )}
          </Field>
        </form>
      )}
    </Modal>
  );
}
