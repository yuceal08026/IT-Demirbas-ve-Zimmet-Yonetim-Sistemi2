import { useEffect, useId, useRef, useState } from 'react';
import { STATUS_LABELS } from '../lib/format.js';

// ---------- Simgeler (satır içi SVG, harici kütüphane yok) ----------

const ICON_PATHS = {
  search: 'M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM17 17l-4-4',
  close: 'M5 5l10 10M15 5L5 15',
  plus: 'M10 4v12M4 10h12',
  chevronLeft: 'M12.5 4.5 7 10l5.5 5.5',
  chevronRight: 'M7.5 4.5 13 10l-5.5 5.5',
  sortUp: 'M6 12l4-4 4 4',
  sortDown: 'M6 8l4 4 4-4',
  sortNone: 'M7 8l3-3 3 3M7 12l3 3 3-3',
  menu: 'M3.5 6h13M3.5 10h13M3.5 14h13',
  edit: 'M12.5 4.5l3 3L8 15H5v-3l7.5-7.5Z',
  key: 'M12 3.5a4.5 4.5 0 1 1-3.6 7.2L3.5 15.5V17H6v-1.5h1.5V14H9l1.2-1.2A4.5 4.5 0 0 1 12 3.5Zm1 3.5h.01',
  trash: 'M4 6h12M8 6V4h4v2m-6 0 .7 10h6.6L14 6',
  download: 'M10 3v10m-4-4 4 4 4-4M4 16h12',
  alert: 'M10 3 2.5 16h15L10 3Zm0 5v4m0 2.5h.01',
};

export function Icon({ name, className = 'size-5', strokeWidth = 1.7 }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

// ---------- Sayfa iskeleti ----------

export function PageHeader({ title, description, actions, children }) {
  return (
    <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {children}
        <h1 className="text-[26px] leading-tight font-bold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-steel-dark">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Spinner({ className = 'size-5' }) {
  return (
    <svg viewBox="0 0 24 24" className={`animate-spin text-cobalt ${className}`} aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" fill="none" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export function LoadingBlock({ label = 'Yükleniyor' }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-steel-dark" role="status">
      <Spinner />
      <span>{label}…</span>
    </div>
  );
}

export function EmptyState({ title, children, action }) {
  return (
    <div className="px-6 py-14 text-center">
      <p className="font-semibold text-ink">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-md text-sm text-steel-dark">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorBlock({ error, onRetry }) {
  return (
    <div className="rounded-lg border border-st-defect/30 bg-st-defect-tint px-4 py-3 text-sm text-st-defect" role="alert">
      <p>{error?.message || 'Veriler yüklenemedi.'}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-1 font-semibold underline underline-offset-2">
          Tekrar dene
        </button>
      )}
    </div>
  );
}

// ---------- Form alanları ----------

export function Field({ label, error, hint, children, className = '', id: fixedId }) {
  const generatedId = useId();
  const id = fixedId || generatedId;
  const child = typeof children === 'function' ? children({ id, invalid: Boolean(error), describedBy: `${id}-msg` }) : children;
  return (
    <div className={className}>
      <label htmlFor={id} className="field-label">{label}</label>
      {child}
      {error ? (
        <p id={`${id}-msg`} className="field-error">{error}</p>
      ) : hint ? (
        <p id={`${id}-msg`} className="mt-1 text-sm text-steel">{hint}</p>
      ) : null}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Ara', label = 'Ara' }) {
  return (
    <div className="relative w-full sm:max-w-xs">
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-steel">
        <Icon name="search" className="size-4" />
      </span>
      <input
        type="search"
        aria-label={label}
        className="field-input pl-9"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export function FilterSelect({ label, value, onChange, children }) {
  return (
    <select aria-label={label} className="field-input w-full sm:w-auto" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
      {children}
    </select>
  );
}

// ---------- Etiketler ----------

const STATUS_STYLE = {
  ACTIVE: 'bg-st-active-tint text-st-active',
  IN_STOCK: 'bg-st-stock-tint text-st-stock',
  DEFECTIVE: 'bg-st-defect-tint text-st-defect',
};

export function StatusBadge({ status }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[13px] font-semibold ${STATUS_STYLE[status] || 'bg-paper text-steel-dark'}`}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {STATUS_LABELS[status] || status}
    </span>
  );
}

export function Pill({ children, tone = 'neutral' }) {
  const tones = {
    neutral: 'bg-paper text-steel-dark border border-line',
    cobalt: 'bg-cobalt-tint text-cobalt',
    warn: 'bg-warn-tint text-warn',
    muted: 'bg-paper text-steel border border-dashed border-line',
  };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[13px] font-medium ${tones[tone]}`}>{children}</span>;
}

/** Demirbaş etiketi — cihaz kodunun imza görünümü. */
export function AssetTag({ code, size = 'sm' }) {
  const sizes = { sm: 'px-2 py-0.5 text-[12.5px]', md: 'px-3 py-1 text-sm', lg: 'px-4 py-2 text-lg' };
  return <span className={`asset-tag ${sizes[size]}`}>{code}</span>;
}

// ---------- Tablo (masaüstünde tablo, mobilde kart listesi) ----------

function SortIcon({ active, order }) {
  if (!active) return <Icon name="sortNone" className="size-3.5 text-steel/70" />;
  return <Icon name={order === 'asc' ? 'sortUp' : 'sortDown'} className="size-3.5 text-cobalt" strokeWidth={2.2} />;
}

/**
 * columns: [{ key, header, render?(row), sortKey?, className?, hideOnMobile?, primary? }]
 * Mobilde "primary" sütun kart başlığı olur, diğerleri etiket: değer satırları olarak listelenir.
 */
export function DataTable({ columns, rows, sort, order, onSort, rowKey = 'id', onRowClick, empty }) {
  const cell = (col, row) => (col.render ? col.render(row) : row[col.key] ?? '—');
  if (!rows.length) return empty;

  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-left text-[14.5px]">
          <thead>
            <tr className="border-b border-line text-[13px] text-steel-dark">
              {columns.map((col) => (
                <th key={col.key} scope="col" className={`px-4 py-2.5 font-semibold ${col.className || ''}`}
                  aria-sort={col.sortKey && sort === col.sortKey ? (order === 'asc' ? 'ascending' : 'descending') : undefined}>
                  {col.sortKey && onSort ? (
                    <button type="button" className="-mx-1 inline-flex items-center gap-1 rounded px-1 hover:text-ink"
                      onClick={() => onSort(col.sortKey)}>
                      {col.header}
                      <SortIcon active={sort === col.sortKey} order={order} />
                    </button>
                  ) : col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row[rowKey]}
                className={`border-b border-line/70 last:border-0 ${onRowClick ? 'cursor-pointer hover:bg-paper/70' : ''}`}
                onClick={onRowClick ? (e) => { if (!e.target.closest('a,button')) onRowClick(row); } : undefined}>
                {columns.map((col) => (
                  <td key={col.key} className={`px-4 py-3 align-middle ${col.className || ''}`}>{cell(col, row)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="divide-y divide-line md:hidden">
        {rows.map((row) => {
          const primary = columns.find((c) => c.primary) || columns[0];
          return (
            <li key={row[rowKey]} className={`px-4 py-3 ${onRowClick ? 'active:bg-paper' : ''}`}
              onClick={onRowClick ? (e) => { if (!e.target.closest('a,button')) onRowClick(row); } : undefined}>
              <div className="mb-1.5">{cell(primary, row)}</div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                {columns.filter((c) => c !== primary && !c.hideOnMobile).map((col) => (
                  <div key={col.key} className="contents">
                    <dt className="text-steel">{col.header}</dt>
                    <dd className="min-w-0 text-right text-ink">{cell(col, row)}</dd>
                  </div>
                ))}
              </dl>
            </li>
          );
        })}
      </ul>
    </>
  );
}

export function Pagination({ meta, onPage }) {
  if (!meta || meta.total === 0) return null;
  const from = (meta.page - 1) * meta.limit + 1;
  const to = Math.min(meta.page * meta.limit, meta.total);
  return (
    <nav className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm" aria-label="Sayfalama">
      <p className="text-steel-dark">
        <span className="font-semibold text-ink">{from}–{to}</span> / {meta.total} kayıt
      </p>
      <div className="flex items-center gap-1">
        <button type="button" className="btn btn-secondary btn-sm px-2" disabled={meta.page <= 1}
          onClick={() => onPage(meta.page - 1)} aria-label="Önceki sayfa">
          <Icon name="chevronLeft" className="size-4" />
        </button>
        <span className="min-w-16 text-center text-steel-dark">{meta.page} / {meta.totalPages}</span>
        <button type="button" className="btn btn-secondary btn-sm px-2" disabled={meta.page >= meta.totalPages}
          onClick={() => onPage(meta.page + 1)} aria-label="Sonraki sayfa">
          <Icon name="chevronRight" className="size-4" />
        </button>
      </div>
    </nav>
  );
}

// ---------- Modal ----------

export function Modal({ open, title, onClose, children, footer, width = 'max-w-lg' }) {
  const panelRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const titleId = useId();

  // Yalnızca açılış/kapanışta çalışır; onClose ref üzerinden okunur, böylece yazarken odak kaymaz.
  useEffect(() => {
    if (!open) return undefined;
    const previouslyFocused = document.activeElement;
    const panel = panelRef.current;
    const first = panel?.querySelector('input,select,textarea,button:not([data-close])');
    (first || panel)?.focus();

    function onKey(e) {
      if (e.key === 'Escape') closeRef.current();
      if (e.key === 'Tab' && panel) {
        const items = [...panel.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select,textarea')];
        if (!items.length) return;
        const firstEl = items[0];
        const lastEl = items[items.length - 1];
        if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
        else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
      }
    }
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      previouslyFocused?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/40 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        className={`max-h-[92vh] w-full ${width} overflow-y-auto rounded-t-xl bg-surface shadow-2xl sm:rounded-xl`}>
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 id={titleId} className="text-lg font-bold">{title}</h2>
          <button type="button" data-close onClick={onClose} className="-m-1 rounded p-1 text-steel hover:text-ink" aria-label="Kapat">
            <Icon name="close" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex flex-col-reverse gap-2 border-t border-line px-5 py-3 sm:flex-row sm:justify-end">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, title, children, confirmLabel, tone = 'danger', onConfirm, onClose }) {
  const [busy, setBusy] = useState(false);
  async function handle() {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open={open} title={title} onClose={busy ? () => {} : onClose}
      footer={(
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Vazgeç</button>
          <button type="button" className={`btn ${tone === 'danger' ? 'btn-danger' : 'btn-primary'}`} onClick={handle} disabled={busy}>
            {busy && <Spinner className="size-4 text-white" />}
            {confirmLabel}
          </button>
        </>
      )}>
      <div className="text-[15px] text-ink-soft">{children}</div>
    </Modal>
  );
}
