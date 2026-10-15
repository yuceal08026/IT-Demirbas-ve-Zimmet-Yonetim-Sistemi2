import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useNavigate, useSearchParams } from '../lib/router.jsx';
import { useApi, useTitle } from '../lib/hooks.js';
import RecoveryCodeNotice from '../components/RecoveryCode.jsx';
import { Spinner } from '../components/ui.jsx';
import { api } from '../lib/api.js';

/** Yalnızca uygulama içi yollara dönüş (açık yönlendirme açığını önler). */
function safeNext(next) {
  return typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

const TABS = [
  { key: 'USER', label: 'Personel girişi', hint: 'Üzerinizdeki cihazları görmek için kurum e-postanız ve parolanızla giriş yapın.' },
  { key: 'ADMIN', label: 'Yönetici girişi', hint: 'Envanter, zimmet ve personel yönetimi için yönetici hesabınızla giriş yapın.' },
];

const isEmail = (v) => /^\S+@\S+\.\S+$/.test(v.trim());
const pwProblem = (v) => (v.length < 8 ? 'Parola en az 8 karakter olmalıdır'
  : !/[A-Za-zÇĞİÖŞÜçğıöşü]/.test(v) || !/\d/.test(v) ? 'Parola en az bir harf ve bir rakam içermelidir' : '');

function TextField({ id, label, error, hint, ...props }) {
  return (
    <div>
      <label htmlFor={id} className="field-label">{label}</label>
      <input id={id} className="field-input" aria-invalid={Boolean(error)} {...props} />
      {hint && !error && <p className="mt-1 text-sm text-steel-dark">{hint}</p>}
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}

const fieldErrorsOf = (err, map = {}) => {
  const out = {};
  for (const [k, v] of Object.entries(err.fieldErrors?.() || {})) out[map[k] || k] = v;
  return out;
};

/** Şifremi unuttum: kurtarma koduyla kendi başına yenileme; kodu olmayan için yöneticiye talep (yedek yol). */
function ForgotPassword({ initialEmail, onBack }) {
  const [mode, setMode] = useState('code');
  const [form, setForm] = useState({ email: initialEmail || '', code: '', next: '', repeat: '' });
  const [errors, setErrors] = useState({});
  const [result, setResult] = useState(null);
  const [requestDone, setRequestDone] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => { setForm({ ...form, [k]: e.target.value }); setErrors({ ...errors, [k]: undefined, form: undefined }); };

  async function recover(e) {
    e.preventDefault();
    const er = {};
    if (!isEmail(form.email)) er.email = 'Geçerli bir e-posta adresi girin';
    if (!form.code.trim()) er.code = 'Kurtarma kodunu girin';
    if (pwProblem(form.next)) er.next = pwProblem(form.next);
    else if (form.next !== form.repeat) er.repeat = 'Parolalar eşleşmiyor';
    setErrors(er);
    if (Object.keys(er).length) return;
    setBusy(true);
    try {
      setResult(await api.post('/auth/recover', { email: form.email.trim(), recovery_code: form.code.trim(), new_password: form.next }, { skipAuthRedirect: true }));
    } catch (err) {
      const fe = fieldErrorsOf(err, { new_password: 'next', recovery_code: 'code' });
      if (!Object.keys(fe).length) fe.form = err.message;
      setErrors(fe);
    } finally {
      setBusy(false);
    }
  }

  async function requestHelp(e) {
    e.preventDefault();
    if (!isEmail(form.email)) { setErrors({ email: 'Geçerli bir e-posta adresi girin' }); return; }
    setBusy(true);
    try {
      const r = await api.post('/auth/forgot-password', { email: form.email.trim() }, { skipAuthRedirect: true });
      setRequestDone(r.message);
    } catch (err) {
      setErrors({ form: err.message });
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <div>
        <h2 className="text-[26px] font-bold tracking-tight">Parolanız yenilendi</h2>
        <p className="mt-1 mb-5 text-st-active">{result.message}</p>
        <RecoveryCodeNotice code={result.recovery_code} email={form.email.trim()} continueLabel="Giriş ekranına dön" onContinue={onBack}
          intro="Eski kurtarma kodunuz artık geçersiz. Bir sonraki sefer için yeni kodunuzu kaydedin." />
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-[26px] font-bold tracking-tight">Şifremi unuttum</h2>
      {mode === 'code' ? (
        <>
          <p className="mt-1 text-steel-dark">Kayıt olurken size verilen kurtarma kodu ile yeni parolanızı kendiniz belirleyin.</p>
          <form className="mt-6 space-y-4" onSubmit={recover} noValidate>
            <TextField id="rec-email" label="E-posta" type="email" autoComplete="username" value={form.email} onChange={set('email')} error={errors.email} autoFocus />
            <TextField id="rec-code" label="Kurtarma kodu" value={form.code} onChange={set('code')} error={errors.code}
              placeholder="XXXX-XXXX-XXXX-XXXX" autoComplete="off" spellCheck={false} className="field-input font-mono uppercase" />
            <TextField id="rec-next" label="Yeni parola" type="password" autoComplete="new-password" value={form.next} onChange={set('next')} error={errors.next}
              hint="En az 8 karakter; harf ve rakam içermeli." />
            <TextField id="rec-repeat" label="Yeni parola (tekrar)" type="password" autoComplete="new-password" value={form.repeat} onChange={set('repeat')} error={errors.repeat} />
            {errors.form && <p className="rounded-md bg-st-defect-tint px-3 py-2 text-sm text-st-defect" role="alert">{errors.form}</p>}
            <button type="submit" className="btn btn-primary w-full py-2.5 text-[15px]" disabled={busy}>
              {busy && <Spinner className="size-4 text-white" />}Parolamı yenile
            </button>
          </form>
          <button type="button" className="mt-5 block text-sm font-semibold text-cobalt hover:underline" onClick={() => { setMode('help'); setErrors({}); }}>
            Kurtarma kodum yok
          </button>
        </>
      ) : requestDone ? (
        <p className="mt-4 rounded-md bg-st-active-tint px-3 py-3 text-[15px] text-st-active" role="status">{requestDone}</p>
      ) : (
        <>
          <p className="mt-1 text-steel-dark">
            Kurtarma kodunuzu kaybettiyseniz e-postanızı yazın; talebiniz yöneticiye iletilir ve yönetici size geçici bir parola verir.
          </p>
          <form className="mt-6 space-y-4" onSubmit={requestHelp} noValidate>
            <TextField id="help-email" label="E-posta" type="email" autoComplete="username" value={form.email} onChange={set('email')} error={errors.email} autoFocus />
            {errors.form && <p className="rounded-md bg-st-defect-tint px-3 py-2 text-sm text-st-defect" role="alert">{errors.form}</p>}
            <button type="submit" className="btn btn-primary w-full py-2.5 text-[15px]" disabled={busy}>
              {busy && <Spinner className="size-4 text-white" />}Yöneticiden yardım iste
            </button>
          </form>
          <button type="button" className="mt-5 block text-sm font-semibold text-cobalt hover:underline" onClick={() => setMode('code')}>
            Kurtarma kodum var
          </button>
        </>
      )}
      <button type="button" className="mt-3 block text-sm font-semibold text-cobalt hover:underline" onClick={onBack}>Giriş ekranına dön</button>
    </div>
  );
}

/** Kendi kendine kayıt: yalnızca kurum e-postası; hesap yönetici onayından sonra açılır. */
function Register({ domains, onBack }) {
  const [form, setForm] = useState({ ad_soyad: '', email: '', password: '', repeat: '' });
  const [errors, setErrors] = useState({});
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => { setForm({ ...form, [k]: e.target.value }); setErrors({ ...errors, [k]: undefined, form: undefined }); };
  const domainText = domains.map((d) => `@${d}`).join(' veya ');

  async function submit(e) {
    e.preventDefault();
    const er = {};
    if (form.ad_soyad.trim().length < 2) er.ad_soyad = 'Adınızı ve soyadınızı yazın';
    const mail = form.email.trim().toLowerCase();
    if (!isEmail(mail)) er.email = 'Geçerli bir e-posta adresi girin';
    else if (!domains.some((d) => mail.endsWith(`@${d}`))) er.email = `Yalnızca ${domainText} uzantılı kurum e-postanızla kaydolabilirsiniz`;
    if (pwProblem(form.password)) er.password = pwProblem(form.password);
    else if (form.password !== form.repeat) er.repeat = 'Parolalar eşleşmiyor';
    setErrors(er);
    if (Object.keys(er).length) return;
    setBusy(true);
    try {
      setResult(await api.post('/auth/register', { ad_soyad: form.ad_soyad.trim(), email: mail, password: form.password }, { skipAuthRedirect: true }));
    } catch (err) {
      const fe = fieldErrorsOf(err);
      if (!Object.keys(fe).length) fe.form = err.message;
      setErrors(fe);
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <div>
        <h2 className="text-[26px] font-bold tracking-tight">Son adım: kurtarma kodunuz</h2>
        <p className="mt-1 mb-5 rounded-md bg-st-active-tint px-3 py-2 text-st-active">{result.message}</p>
        <RecoveryCodeNotice code={result.recovery_code} email={form.email.trim().toLowerCase()} continueLabel="Giriş ekranına dön" onContinue={onBack} />
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-[26px] font-bold tracking-tight">Kaydol</h2>
      <p className="mt-1 text-steel-dark">{domainText} uzantılı kurum e-postanızla kaydolun. Hesabınız yönetici onayından sonra açılır.</p>
      <form className="mt-6 space-y-4" onSubmit={submit} noValidate>
        <TextField id="reg-name" label="Ad soyad" autoComplete="name" value={form.ad_soyad} onChange={set('ad_soyad')} error={errors.ad_soyad} autoFocus />
        <TextField id="reg-email" label="Kurum e-postası" type="email" autoComplete="username" placeholder={`ad.soyad@${domains[0]}`}
          value={form.email} onChange={set('email')} error={errors.email} />
        <TextField id="reg-pw" label="Parola" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} error={errors.password}
          hint="En az 8 karakter; harf ve rakam içermeli. Yaygın parolalar kabul edilmez." />
        <TextField id="reg-repeat" label="Parola (tekrar)" type="password" autoComplete="new-password" value={form.repeat} onChange={set('repeat')} error={errors.repeat} />
        {errors.form && <p className="rounded-md bg-st-defect-tint px-3 py-2 text-sm text-st-defect" role="alert">{errors.form}</p>}
        <button type="submit" className="btn btn-primary w-full py-2.5 text-[15px]" disabled={busy}>
          {busy && <Spinner className="size-4 text-white" />}Kaydol
        </button>
      </form>
      <button type="button" className="mt-5 text-sm font-semibold text-cobalt hover:underline" onClick={onBack}>Zaten hesabım var, giriş yap</button>
    </div>
  );
}

export default function LoginPage() {
  useTitle('Giriş');
  const { login } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const portal = params.giris === 'yonetici' ? 'ADMIN' : 'USER';
  const tab = TABS.find((t) => t.key === portal);
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState('login');
  const registration = useApi(() => api.get('/auth/registration', undefined, { skipAuthRedirect: true }).catch(() => ({ enabled: false, domains: [] })), []);
  const regEnabled = Boolean(registration.data?.enabled);

  function selectTab(key) {
    setError('');
    setParams({ giris: key === 'ADMIN' ? 'yonetici' : undefined });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.email.trim() || !form.password) {
      setError('E-posta ve parolanızı girin.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const user = await login(form.email.trim(), form.password, portal);
      const next = safeNext(params.next);
      navigate(user.role === 'ADMIN' || next !== '/' ? next : '/my-assets', { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <section className="relative hidden overflow-hidden bg-ink px-12 py-14 text-white lg:flex lg:flex-col lg:justify-between">
        <p className="text-lg font-bold">Zimmet</p>
        <div>
          <div className="mb-10 inline-flex -rotate-2 flex-col gap-3 rounded-lg border border-[#b9c3cd] bg-gradient-to-b from-[#eef1f4] via-[#d9dfe5] to-[#e6eaee] px-6 py-5 text-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.8),0_18px_40px_rgb(0_0_0/0.35)]">
            <div className="flex items-center justify-between gap-10 text-[11px] font-semibold text-ink-soft">
              <span>DEMİRBAŞ</span>
              <span>BİLGİ İŞLEM</span>
            </div>
            <div className="flex items-center gap-4">
              <span className="size-2 rounded-full bg-[#9aa6b2] shadow-[inset_0_1px_1px_rgb(0_0_0/0.35)]" />
              <span className="font-mono text-3xl font-semibold tracking-wider">IT-2026-000042</span>
              <span className="size-2 rounded-full bg-[#9aa6b2] shadow-[inset_0_1px_1px_rgb(0_0_0/0.35)]" />
            </div>
            <div className="flex h-8 gap-[3px]" aria-hidden="true">
              {'1101001110100110111010011101001011101001'.split('').map((b, i) => (
                <span key={i} className={`h-full ${b === '1' ? 'w-[3px] bg-ink' : 'w-[2px] bg-transparent'}`} />
              ))}
            </div>
          </div>
          <h1 className="max-w-md text-[34px] leading-[1.15] font-bold">Her cihaz kimde, ne durumda — tek yerden.</h1>
          <p className="mt-4 max-w-md text-white/70">
            Envanter kaydı, personele teslim ve iade, arıza takibi ve tüm işlem geçmişi.
          </p>
        </div>
        <p className="text-sm text-white/50">Yapay Zekâ ve Dijital Dönüşüm Koordinatörlüğü</p>
      </section>

      <section className="flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-sm">
          <p className="mb-8 text-lg font-bold lg:hidden">Zimmet</p>
          {view === 'forgot' ? (
            <ForgotPassword initialEmail={form.email} onBack={() => setView('login')} />
          ) : view === 'register' ? (
            <Register domains={registration.data.domains} onBack={() => setView('login')} />
          ) : (
            <>
              <div className="mb-6 grid grid-cols-2 gap-1 rounded-lg bg-paper p-1" role="tablist" aria-label="Giriş türü">
                {TABS.map((t) => (
                  <button key={t.key} type="button" role="tab" aria-selected={portal === t.key}
                    className={`rounded-md px-3 py-2 text-sm font-semibold ${portal === t.key ? 'bg-surface text-ink shadow-sm' : 'text-steel-dark hover:text-ink'}`}
                    onClick={() => selectTab(t.key)}>
                    {t.label}
                  </button>
                ))}
              </div>
              <h2 className="text-[26px] font-bold tracking-tight">{tab.label}</h2>
              <p className="mt-1 text-steel-dark">{tab.hint}</p>

              <form className="mt-8 space-y-4" onSubmit={handleSubmit} noValidate>
                <div>
                  <label htmlFor="email" className="field-label">E-posta</label>
                  <input id="email" type="email" autoComplete="username" className="field-input" value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })} autoFocus />
                </div>
                <div>
                  <div className="flex items-baseline justify-between gap-2">
                    <label htmlFor="password" className="field-label">Parola</label>
                    <button type="button" className="text-sm font-semibold text-cobalt hover:underline" onClick={() => setView('forgot')}>
                      Şifremi unuttum
                    </button>
                  </div>
                  <input id="password" type="password" autoComplete="current-password" className="field-input" value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })} />
                </div>
                {error && <p className="rounded-md bg-st-defect-tint px-3 py-2 text-sm text-st-defect" role="alert">{error}</p>}
                <button type="submit" className="btn btn-primary w-full py-2.5 text-[15px]" disabled={busy}>
                  {busy && <Spinner className="size-4 text-white" />}
                  Giriş yap
                </button>
              </form>
              {portal === 'USER' && regEnabled && (
                <p className="mt-6 text-sm text-steel-dark">
                  Hesabınız yok mu?{' '}
                  <button type="button" className="font-semibold text-cobalt hover:underline" onClick={() => setView('register')}>Kaydolun</button>
                </p>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
