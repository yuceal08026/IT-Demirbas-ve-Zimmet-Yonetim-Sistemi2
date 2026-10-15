import { useState } from 'react';

/**
 * Kurtarma kodunu bir kez gösterir. Kod sunucuda yalnızca özet olarak tutulur; bu ekran kapanınca tekrar görülemez.
 * Kullanıcı kaydettiğini onaylamadan devam edemez.
 */
export default function RecoveryCodeNotice({ code, email, onContinue, continueLabel = 'Devam et', intro }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }

  function download() {
    const text = [
      'Zimmet — IT Demirbaş Yönetimi',
      'KURTARMA KODU',
      '',
      email ? `Hesap: ${email}` : null,
      `Kod:   ${code}`,
      '',
      'Parolanızı unutursanız giriş ekranındaki "Şifremi unuttum" bağlantısından',
      'e-postanız ve bu kodla yeni parola belirleyebilirsiniz. Kod tek kullanımlıktır;',
      'kullandığınızda size yeni bir kod verilir. Bu dosyayı kimseyle paylaşmayın.',
    ].filter((l) => l !== null).join('\r\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'zimmet-kurtarma-kodu.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <p className="text-[15px] text-ink-soft">
        {intro || 'Parolanızı unutursanız bu kodla kendi parolanızı yenileyebilirsiniz. Kod yalnızca şimdi gösterilir; bir yere kaydedin.'}
      </p>
      <div className="rounded-lg border-2 border-dashed border-cobalt bg-cobalt-tint px-4 py-4 text-center">
        <p className="text-sm font-semibold text-cobalt">Kurtarma kodunuz</p>
        <p className="mt-1 select-all font-mono text-2xl font-semibold tracking-wider text-ink" data-testid="recovery-code">{code}</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn btn-secondary btn-sm" onClick={copy}>{copied ? 'Kopyalandı' : 'Kopyala'}</button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={download}>Dosya olarak indir</button>
      </div>
      <ul className="list-disc space-y-1 pl-5 text-sm text-steel-dark">
        <li>Telefonunuza not edin, çıktısını alın veya dosyayı güvenli bir yerde saklayın.</li>
        <li>Kodu kimseyle paylaşmayın; kodu ve e-postanızı bilen kişi parolanızı değiştirebilir.</li>
        <li>Kodu kaybederseniz giriş yaptıktan sonra menüden yeni kod alabilirsiniz.</li>
      </ul>
      <label className="flex items-start gap-2 text-[15px]">
        <input type="checkbox" className="mt-1 accent-cobalt" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        <span>Kurtarma kodumu kaydettim</span>
      </label>
      <button type="button" className="btn btn-primary w-full py-2.5" disabled={!saved} onClick={onContinue}>{continueLabel}</button>
    </div>
  );
}
