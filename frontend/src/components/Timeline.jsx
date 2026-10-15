import { api } from '../lib/api.js';
import { useApi } from '../lib/hooks.js';
import { ACTION_LABELS, FIELD_LABELS, STATUS_LABELS, formatDateTime } from '../lib/format.js';
import { ErrorBlock, LoadingBlock } from './ui.jsx';

const DOT = {
  ASSIGN: 'bg-st-active', RETURN: 'bg-st-stock', ASSET_STATUS_CHANGE: 'bg-st-defect',
  MAINTENANCE_OPEN: 'bg-st-defect', MAINTENANCE_RESOLVE: 'bg-st-active', ASSET_CREATE: 'bg-cobalt',
};

const fmtValue = (field, v) => {
  if (v === null || v === undefined || v === '') return '—';
  if (field === 'status') return STATUS_LABELS[v] || v;
  if (field === 'is_active') return v ? 'aktif' : 'pasif';
  return String(v);
};

/** Audit kaydının "details" alanını okunur bir cümleye çevirir. */
export function describe(entry) {
  const d = entry.details || {};
  switch (entry.action_type) {
    case 'ASSIGN':
      return `${d.user_name || 'Personel'} adına zimmetlendi${d.note ? `. Not: ${d.note}` : ''}`;
    case 'RETURN':
      return `${d.user_name || 'Personel'} kişisinden iade alındı; cihaz ${d.condition === 'DEFECTIVE' ? 'arızalı' : 'depoda'}${d.return_note ? `. Not: ${d.return_note}` : ''}`;
    case 'ASSET_CREATE':
      return d.seed ? 'Envantere eklendi (örnek veri)' : 'Envantere eklendi';
    case 'LOGIN':
      return d.ip ? `IP: ${d.ip}` : '';
    case 'LOGIN_FAILED':
      return `${d.email || ''}: ${{ unknown_email: 'kayıtlı olmayan e-posta', wrong_password: 'hatalı parola', inactive: 'pasif hesap', wrong_portal: 'yanlış giriş sekmesi', pending_approval: 'onay bekleyen hesap' }[d.reason] || 'reddedildi'}${d.ip ? ` (IP: ${d.ip})` : ''}`;
    case 'USER_CREATE':
      return `${d.email || ''}, rol: ${d.role === 'ADMIN' ? 'Yönetici' : 'Personel'}${{ cli: ' (sunucu komutuyla)', 'initial-setup': ' (ilk kurulum ayarıyla)', 'web-setup': ' (tarayıcıdan ilk kurulum)' }[d.via] || ''}`;
    case 'USER_PASSWORD_CHANGE':
    case 'PASSWORD_RESET_REQUEST':
    case 'USER_PASSWORD_RECOVER':
    case 'RECOVERY_CODE_RENEW':
      return d.ad_soyad || '';
    case 'USER_REGISTER':
    case 'USER_APPROVE':
    case 'USER_REJECT':
    case 'PASSWORD_RECOVER_FAILED':
      return [d.ad_soyad, d.email].filter(Boolean).join(', ');
    case 'USER_DELETE':
    case 'ASSET_DELETE':
    case 'USER_PASSWORD_RESET':
      return [
        d.ad_soyad, d.email, d.brand && `${d.brand} ${d.model}`, d.serial_number && `SN ${d.serial_number}`,
        d.reason === 'legacy_demo_password_invalidated' && 'eski örnek hesabın bilinen parolası geçersiz kılındı',
        d.via === 'cli' && 'sunucu komutuyla',
        d.via === 'reset-request' && '"şifremi unuttum" talebi üzerine',
      ].filter(Boolean).join(', ');
    case 'MAINTENANCE_OPEN':
      return [d.issue_description && `Arıza: ${d.issue_description}`, d.changes?.status && 'cihaz arızalı olarak işaretlendi']
        .filter(Boolean).join('; ');
    case 'MAINTENANCE_UPDATE':
    case 'MAINTENANCE_RESOLVE':
      return [
        d.status && `Durum: ${{ OPEN: 'Açık', IN_PROGRESS: 'İşlemde', RESOLVED: 'Çözüldü' }[d.status] || d.status}`,
        d.solution_note && `Çözüm: ${d.solution_note}`,
        d.changes?.status && 'Cihaz depoya alındı',
      ].filter(Boolean).join('. ');
    default: {
      const parts = Object.entries(d.changes || {}).map(
        ([field, c]) => `${FIELD_LABELS[field] || field}: ${fmtValue(field, c.from)} → ${fmtValue(field, c.to)}`,
      );
      if (d.note) parts.push(`Not: ${d.note}`);
      return parts.join(', ');
    }
  }
}

export default function Timeline({ assetId }) {
  const h = useApi(() => api.get(`/assets/${assetId}/history`, { limit: 100 }), [assetId]);
  if (h.loading && !h.data) return <LoadingBlock />;
  if (h.error) return <div className="p-4"><ErrorBlock error={h.error} onRetry={h.reload} /></div>;
  const rows = h.data.data;
  if (!rows.length) return <p className="px-4 py-6 text-sm text-steel-dark">Kayıtlı işlem yok.</p>;

  return (
    <ol className="relative px-4 py-4">
      {rows.map((e, i) => (
        <li key={e.id} className="relative grid grid-cols-[18px_1fr] gap-3 pb-5 last:pb-0">
          {i < rows.length - 1 && <span className="absolute top-4 bottom-0 left-[8px] w-px bg-line" aria-hidden="true" />}
          <span className={`relative mt-1.5 size-[11px] justify-self-center rounded-full ring-4 ring-surface ${DOT[e.action_type] || 'bg-steel'}`} aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-[15px]">
              <span className="font-semibold">{ACTION_LABELS[e.action_type] || e.action_type}</span>
              <span className="text-steel-dark">, {e.actor?.ad_soyad || 'silinmiş kullanıcı'}</span>
            </p>
            {describe(e) && <p className="text-sm text-ink-soft">{describe(e)}</p>}
            <p className="text-[13px] text-steel"><time dateTime={e.timestamp}>{formatDateTime(e.timestamp)}</time></p>
          </div>
        </li>
      ))}
    </ol>
  );
}
