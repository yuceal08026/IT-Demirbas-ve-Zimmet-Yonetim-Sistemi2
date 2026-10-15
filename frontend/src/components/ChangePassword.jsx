import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useTitle } from '../lib/hooks.js';
import { useToast } from './Toast.jsx';
import { Field, Modal, Spinner } from './ui.jsx';
import RecoveryCodeNotice from './RecoveryCode.jsx';
import { api } from '../lib/api.js';

const EMPTY = { current: '', next: '', repeat: '' };

/** İstemci tarafı ön kontrol — aynı kurallar backend'de tekrar doğrulanır (bilinen/zayıf parola listesi dahil). */
function validate(f) {
  const e = {};
  if (!f.current) e.current = 'Mevcut parolanızı girin';
  if (f.next.length < 8) e.next = 'Yeni parola en az 8 karakter olmalıdır';
  else if (!/[A-Za-zÇĞİÖŞÜçğıöşü]/.test(f.next) || !/\d/.test(f.next)) e.next = 'Yeni parola en az bir harf ve bir rakam içermelidir';
  else if (f.next === f.current) e.next = 'Yeni parola mevcut paroladan farklı olmalıdır';
  if (!e.next && f.repeat !== f.next) e.repeat = 'Parolalar eşleşmiyor';
  return e;
}

const SERVER_FIELD = { current_password: 'current', new_password: 'next' };

/** Parola değiştirme formu. Hem zorunlu ilk giriş ekranında hem de "Parolamı değiştir" penceresinde kullanılır. */
export function ChangePasswordForm({ formId, onDone, showSubmit = true, submitLabel = 'Parolayı değiştir', busyState }) {
  const { changePassword, setUser, user } = useAuth();
  const [issued, setIssued] = useState(null);
  const toast = useToast();
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [localBusy, setLocalBusy] = useState(false);
  const [busy, setBusy] = busyState || [localBusy, setLocalBusy];

  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    if (errors[key]) setErrors((er) => ({ ...er, [key]: undefined }));
  };

  async function submit(ev) {
    ev.preventDefault();
    const clientErrors = validate(form);
    setErrors(clientErrors);
    if (Object.keys(clientErrors).length) return;
    setBusy(true);
    try {
      const r = await changePassword(form.current, form.next);
      toast.success('Parolanız değiştirildi. Diğer cihazlardaki oturumlarınız kapatıldı.');
      setForm(EMPTY);
      if (r.recovery_code) setIssued(r);
      else onDone?.();
    } catch (err) {
      const fe = {};
      for (const [k, v] of Object.entries(err.fieldErrors?.() || {})) fe[SERVER_FIELD[k] || k] = v;
      if (!Object.keys(fe).length) fe.form = err.message;
      setErrors(fe);
    } finally {
      setBusy(false);
    }
  }

  if (issued) {
    return (
      <RecoveryCodeNotice code={issued.recovery_code} email={user?.email}
        onContinue={() => { setUser(issued.user); onDone?.(); }} />
    );
  }

  const input = (key, autoComplete) => ({ id, invalid, describedBy }) => (
    <input id={id} type="password" className="field-input" value={form[key]} onChange={set(key)}
      aria-invalid={invalid} aria-describedby={describedBy} autoComplete={autoComplete} />
  );

  return (
    <form id={formId} onSubmit={submit} noValidate className="space-y-4">
      <Field label="Mevcut parola" error={errors.current}>{input('current', 'current-password')}</Field>
      <Field label="Yeni parola" error={errors.next} hint="En az 8 karakter; harf ve rakam içermeli. Yaygın parolalar kabul edilmez.">
        {input('next', 'new-password')}
      </Field>
      <Field label="Yeni parola (tekrar)" error={errors.repeat}>{input('repeat', 'new-password')}</Field>
      {errors.form && <p className="rounded-md bg-st-defect-tint px-3 py-2 text-sm text-st-defect" role="alert">{errors.form}</p>}
      {showSubmit && (
        <button type="submit" className="btn btn-primary w-full py-2.5" disabled={busy}>
          {busy && <Spinner className="size-4 text-white" />}{submitLabel}
        </button>
      )}
    </form>
  );
}

/** Menüdeki "Kurtarma kodu" penceresi: mevcut parolayla yeni kod alınır, eskisi geçersiz olur. */
export function RecoveryCodeModal({ open, onClose }) {
  const { user, setUser } = useAuth();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  function close() {
    if (result) setUser(result.user);
    setPassword(''); setError(''); setResult(null);
    onClose();
  }

  async function submit(e) {
    e.preventDefault();
    if (!password) { setError('Mevcut parolanızı girin'); return; }
    setBusy(true);
    try {
      setResult(await api.post('/auth/recovery-code', { current_password: password }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={close} title="Kurtarma kodu">
      {result ? (
        <RecoveryCodeNotice code={result.recovery_code} email={user?.email} continueLabel="Kapat" onContinue={close}
          intro="Yeni kurtarma kodunuz aşağıda. Eski kodunuz artık geçersiz." />
      ) : (
        <form onSubmit={submit} noValidate className="space-y-4">
          <p className="text-[15px] text-ink-soft">
            {user?.has_recovery_code
              ? 'Yeni bir kurtarma kodu oluşturursanız eski kodunuz geçersiz olur. Kodunuzu kaybettiyseniz veya başkası görmüş olabilirse yenileyin.'
              : 'Henüz kurtarma kodunuz yok. Parolanızı unutursanız kendiniz yenileyebilmek için şimdi bir kod oluşturun.'}
          </p>
          <Field label="Mevcut parola" error={error}>
            {({ id, invalid, describedBy }) => (
              <input id={id} type="password" className="field-input" value={password} onChange={(e) => setPassword(e.target.value)}
                aria-invalid={invalid} aria-describedby={describedBy} autoComplete="current-password" />
            )}
          </Field>
          <button type="submit" className="btn btn-primary w-full" disabled={busy}>
            {busy && <Spinner className="size-4 text-white" />}Yeni kurtarma kodu oluştur
          </button>
        </form>
      )}
    </Modal>
  );
}

/** Menüdeki "Parolamı değiştir" penceresi. */
export function ChangePasswordModal({ open, onClose }) {
  return (
    <Modal open={open} onClose={onClose} title="Parolamı değiştir">
      {open && <ChangePasswordForm formId="change-pw-form" onDone={onClose} />}
    </Modal>
  );
}

/**
 * Geçici veya bilinen bir parolayla giriş yapan kullanıcı, başka bir sayfaya geçmeden önce kendi parolasını belirler.
 * Aynı kural backend'de de uygulanır (parola değişmeden veri uçları 403 döner).
 */
export function ForcedPasswordChangePage() {
  useTitle('Parolanızı belirleyin');
  const { user, logout } = useAuth();
  return (
    <div className="flex min-h-screen items-center justify-center px-5 py-12">
      <div className="w-full max-w-sm">
        <p className="mb-8 text-lg font-bold">Zimmet</p>
        <h1 className="text-[26px] font-bold tracking-tight">Parolanızı belirleyin</h1>
        <p className="mt-1 text-steel-dark">
          {user.ad_soyad}, hesabınız geçici bir parolayla açıldı. Devam etmek için yalnızca sizin bildiğiniz yeni bir parola belirleyin.
        </p>
        <div className="mt-8">
          <ChangePasswordForm formId="forced-pw-form" submitLabel="Parolayı kaydet ve devam et" />
        </div>
        <button type="button" onClick={logout} className="mt-6 text-sm font-semibold text-cobalt hover:underline">Çıkış yap</button>
      </div>
    </div>
  );
}
