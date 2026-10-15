/**
 * API istemcisi. Kimlik doğrulama httpOnly cookie ile yapılır; token'a JavaScript erişemez.
 * Tarayıcı cookie'yi aynı origin isteklerinde otomatik gönderir.
 */

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** Alan bazlı doğrulama hatalarını { alan: mesaj } biçimine çevirir (form gösterimi için). */
  fieldErrors() {
    const out = {};
    for (const d of this.details || []) if (d.field && !out[d.field]) out[d.field] = d.message;
    return out;
  }
}

const listeners = new Set();
/** Oturum düştüğünde (401) haber almak için. AuthContext dinler. */
export function onUnauthorized(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const passwordListeners = new Set();
/** Sunucu "önce parolanızı değiştirin" (403 PASSWORD_CHANGE_REQUIRED) dediğinde haber almak için. */
export function onPasswordChangeRequired(fn) {
  passwordListeners.add(fn);
  return () => passwordListeners.delete(fn);
}

function notifyAuthProblem(status, code, skipAuthRedirect) {
  if (status === 401 && !skipAuthRedirect) listeners.forEach((fn) => fn());
  if (status === 403 && code === 'PASSWORD_CHANGE_REQUIRED') passwordListeners.forEach((fn) => fn());
}

function toQuery(params) {
  if (!params) return '';
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

async function request(method, path, { body, params, skipAuthRedirect = false } = {}) {
  let response;
  try {
    response = await fetch(`/api${path}${toQuery(params)}`, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Sunucuya ulaşılamıyor. Bağlantınızı kontrol edip tekrar deneyin.');
  }

  if (response.status === 204) return null;

  const isJson = (response.headers.get('content-type') || '').includes('application/json');
  const data = isJson ? await response.json().catch(() => null) : null;

  if (!response.ok) {
    const err = data?.error || {};
    notifyAuthProblem(response.status, err.code, skipAuthRedirect);
    throw new ApiError(
      response.status,
      err.code || 'HTTP_ERROR',
      err.message || `İstek başarısız oldu (${response.status})`,
      err.details,
    );
  }
  return data;
}

export const api = {
  get: (path, params, opts) => request('GET', path, { params, ...opts }),
  post: (path, body, opts) => request('POST', path, { body: body ?? {}, ...opts }),
  patch: (path, body, opts) => request('PATCH', path, { body: body ?? {}, ...opts }),
  delete: (path, opts) => request('DELETE', path, opts),
};

/** Dosya indirme (CSV vb.) — cookie ile yetkili istek, sonra tarayıcıya kaydettirme. */
export async function downloadFile(path, params, fallbackName) {
  let response;
  try {
    response = await fetch(`/api${path}${toQuery(params)}`, { credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Sunucuya ulaşılamıyor. Bağlantınızı kontrol edip tekrar deneyin.');
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    notifyAuthProblem(response.status, data?.error?.code, false);
    throw new ApiError(response.status, data?.error?.code, data?.error?.message || 'Dosya indirilemedi');
  }
  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') || '';
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] || fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
