import { useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useNavigate } from '../lib/router.jsx';
import { useTitle } from '../lib/hooks.js';
import { Field, Spinner } from '../components/ui.jsx';
import RecoveryCodeNotice from '../components/RecoveryCode.jsx';

const EMPTY = { setup_code: '', ad_soyad: '', email: '', password: '', repeat: '' };

function validate(f) {
  const e = {};
  if (!f.setup_code.trim()) e.setup_code = 'Kurulum kodunu girin';
  if (f.ad_soyad.trim().length < 2) e.ad_soyad = 'Ad soyad en az 2 karakter olmalıdır';
  if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) e.email = 'Geçerli bir e-posta adresi girin';
  if (f.password.length < 12) e.password = 'Yönetici parolası en az 12 karakter olmalıdır';
  else if (!/[A-Za-zÇĞİÖŞÜçğıöşü]/.test(f.password) || !/\d/.test(f.password)) e.password = 'Parola en az bir harf ve bir rakam içermelidir';
  if (!e.password && f.repeat !== f.password) e.repeat = 'Parolalar eşleşmiyor';
  return e;
}

/**
 * İlk kurulum: sistemde hiç yönetici yokken gösterilir. Kurulum kodu yalnızca sunucu kayıtlarında yazar,
 * böylece siteye ilk ulaşan yabancı kendini yönetici yapamaz. Kod doğrulaması backend'de yapılır.
 */
export default function SetupPage() {
  useTitle('İlk kurulum');
  const { completeSetup } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(null);

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
      const r = await api.post('/setup/admin', {
        setup_code: form.setup_code.trim(), ad_soyad: form.ad_soyad.trim(), email: form.email.trim(), password: form.password,
      }, { skipAuthRedirect: true });
      setCreated(r);
    } catch (err) {
      const fe = err.fieldErrors?.() || {};
      if (err.code === 'INVALID_SETUP_CODE') fe.setup_code = err.message;
      if (err.code === 'SETUP_DONE') window.location.assign('/login?giris=yonetici');
      if (!Object.keys(fe).length) fe.form = err.message;
      setErrors(fe);
      setBusy(false);
    }
  }

  if (created) {
    return (
      <div className="flex min-h-screen items-center justify-center px-5 py-12">
        <div className="w-full max-w-md">
          <p className="mb-8 text-lg font-bold">Zimmet</p>
          <h1 className="text-[26px] font-bold tracking-tight">Yönetici hesabınız hazır</h1>
          <div className="mt-5">
            <RecoveryCodeNotice code={created.recovery_code} email={created.user.email} continueLabel="Uygulamaya geç"
              onContinue={() => { navigate('/', { replace: true }); completeSetup(created.user); }} />
          </div>
        </div>
      </div>
    );
  }

  const input = (key, props = {}) => ({ id, invalid, describedBy }) => (
    <input id={id} className="field-input" value={form[key]} onChange={set(key)} aria-invalid={invalid} aria-describedby={describedBy} {...props} />
  );

  return (
    <div className="flex min-h-screen items-center justify-center px-5 py-12">
      <div className="w-full max-w-md">
        <p className="mb-8 text-lg font-bold">Zimmet</p>
        <h1 className="text-[26px] font-bold tracking-tight">İlk kurulum</h1>
        <p className="mt-1 text-steel-dark">
          Sistemde henüz yönetici yok. Yönetici hesabınızı oluşturun; personeli ve cihazları daha sonra uygulamadan eklersiniz.
        </p>
        <div className="mt-4 rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-ink-soft">
          <strong className="text-ink">Kurulum kodu nerede?</strong> Uygulamayı kuran bilgisayarda sunucu kayıtlarında yazar:
          <code className="mt-1 block font-mono text-[13px] text-ink">docker compose logs api</code>
          Docker Desktop kullanıyorsanız <em>api</em> kapsayıcısının <em>Logs</em> sekmesine bakın.
        </div>

        <form className="mt-6 space-y-4" onSubmit={submit} noValidate>
          <Field label="Kurulum kodu" error={errors.setup_code}>
            {input('setup_code', { autoComplete: 'off', spellCheck: false, placeholder: 'XXXX-XXXX-XXXX', className: 'field-input font-mono uppercase' })}
          </Field>
          <Field label="Ad soyad" error={errors.ad_soyad}>{input('ad_soyad', { autoComplete: 'name' })}</Field>
          <Field label="E-posta" error={errors.email}>{input('email', { type: 'email', autoComplete: 'username' })}</Field>
          <Field label="Parola" error={errors.password} hint="En az 12 karakter; harf ve rakam içermeli. Yaygın parolalar kabul edilmez.">
            {input('password', { type: 'password', autoComplete: 'new-password' })}
          </Field>
          <Field label="Parola (tekrar)" error={errors.repeat}>{input('repeat', { type: 'password', autoComplete: 'new-password' })}</Field>
          {errors.form && <p className="rounded-md bg-st-defect-tint px-3 py-2 text-sm text-st-defect" role="alert">{errors.form}</p>}
          <button type="submit" className="btn btn-primary w-full py-2.5 text-[15px]" disabled={busy}>
            {busy && <Spinner className="size-4 text-white" />}Yönetici hesabını oluştur
          </button>
        </form>
      </div>
    </div>
  );
}
