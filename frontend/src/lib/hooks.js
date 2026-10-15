import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Veri yükleme kancası. deps değiştiğinde yeniden yükler; yarış durumunda eski yanıtı yok sayar.
 * @returns {{ data: any, error: Error|null, loading: boolean, reload: () => void }}
 */
export function useApi(fetcher, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  const callId = useRef(0);

  useEffect(() => {
    const id = ++callId.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    Promise.resolve()
      .then(fetcher)
      .then(
        (data) => id === callId.current && setState({ data, error: null, loading: false }),
        (error) => id === callId.current && setState((s) => ({ data: s.data, error, loading: false })),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}

export function useDebounced(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

/** Sayfa başlığını (tarayıcı sekmesi) ayarlar. */
export function useTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} · Zimmet` : 'Zimmet — IT Demirbaş Yönetimi';
  }, [title]);
}
