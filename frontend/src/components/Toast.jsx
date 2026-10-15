import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

/** Global toast/snackbar bildirimleri. useToast().success('Kaydedildi') */

const ToastContext = createContext(null);

const STYLES = {
  success: 'border-st-active bg-surface text-ink',
  error: 'border-st-defect bg-surface text-ink',
  info: 'border-cobalt bg-surface text-ink',
};
const ICON_COLOR = { success: 'text-st-active', error: 'text-st-defect', info: 'text-cobalt' };
const ICONS = {
  success: 'M5 10.5l3.2 3.2L15 7',
  error: 'M10 6v5m0 3h.01',
  info: 'M10 9v5m0-8h.01',
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id) => setToasts((list) => list.filter((t) => t.id !== id)), []);

  const show = useCallback(
    (type, message) => {
      const id = ++idRef.current;
      setToasts((list) => [...list.slice(-3), { id, type, message }]);
      setTimeout(() => dismiss(id), type === 'error' ? 6000 : 3500);
    },
    [dismiss],
  );

  const api = useMemo(
    () => ({
      success: (m) => show('success', m),
      error: (m) => show('error', m),
      info: (m) => show('info', m),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 print:hidden flex flex-col items-center gap-2 p-4 sm:inset-x-auto sm:right-0 sm:items-end"
        aria-live="polite"
        role="status"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-md border-l-4 px-4 py-3 shadow-lg shadow-ink/10 ${STYLES[t.type]}`}
          >
            <svg viewBox="0 0 20 20" className={`mt-0.5 size-5 flex-none ${ICON_COLOR[t.type]}`} aria-hidden="true">
              <circle cx="10" cy="10" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d={ICONS[t.type]} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            <p className="flex-1 text-sm">{t.message}</p>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="-m-1 rounded p-1 text-steel hover:text-ink"
              aria-label="Bildirimi kapat"
            >
              <svg viewBox="0 0 20 20" className="size-4" aria-hidden="true">
                <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
