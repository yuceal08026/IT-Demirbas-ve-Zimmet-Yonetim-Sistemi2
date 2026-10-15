import { useEffect, useId, useRef, useState } from 'react';
import { useDebounced } from '../lib/hooks.js';
import { Icon, Spinner } from './ui.jsx';

/**
 * Aranabilir seçim kutusu (combobox). Seçenekler yazdıkça sunucudan getirilir.
 * fetchOptions(search) → Promise<item[]>; renderOption(item) → JSX; getLabel(item) → string.
 */
export default function SearchPicker({
  label, value, onChange, fetchOptions, renderOption, getLabel, placeholder, error, emptyText = 'Sonuç yok', disabled,
}) {
  const id = useId();
  const listId = `${id}-list`;
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const search = useDebounced(text, 250);
  const boxRef = useRef(null);
  const reqRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    const req = ++reqRef.current;
    setLoading(true);
    fetchOptions(search)
      .then((r) => { if (req === reqRef.current) { setItems(r); setActive(0); } })
      .catch(() => { if (req === reqRef.current) setItems([]); })
      .finally(() => { if (req === reqRef.current) setLoading(false); });
  }, [search, open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function onDoc(e) { if (!boxRef.current?.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  function choose(item) {
    onChange(item);
    setText('');
    setOpen(false);
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && open && items[active]) { e.preventDefault(); choose(items[active]); }
    else if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); }
  }

  return (
    <div ref={boxRef} className="relative">
      <label htmlFor={id} className="field-label">{label}</label>
      {value ? (
        <div className="flex items-center justify-between gap-2 rounded-md border border-line bg-paper px-3 py-2">
          <div className="min-w-0">{renderOption(value)}</div>
          {!disabled && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { onChange(null); setTimeout(() => document.getElementById(id)?.focus(), 0); }}>
              Değiştir
            </button>
          )}
        </div>
      ) : (
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-steel"><Icon name="search" className="size-4" /></span>
          <input id={id} type="text" role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
            aria-activedescendant={open && items[active] ? `${listId}-${active}` : undefined}
            aria-invalid={Boolean(error)} autoComplete="off"
            className="field-input pl-9" placeholder={placeholder} value={text} disabled={disabled}
            onChange={(e) => { setText(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)} onKeyDown={onKeyDown} />
          {open && (
            <ul id={listId} role="listbox" aria-label={label}
              className="mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-line bg-surface py-1 shadow-md shadow-ink/5">
              {loading && items.length === 0 && <li className="flex items-center gap-2 px-3 py-2 text-sm text-steel"><Spinner className="size-4" />Aranıyor…</li>}
              {!loading && items.length === 0 && <li className="px-3 py-2 text-sm text-steel">{emptyText}</li>}
              {items.map((item, i) => (
                <li key={item.id} id={`${listId}-${i}`} role="option" aria-selected={i === active}
                  className={`cursor-pointer px-3 py-2 ${i === active ? 'bg-cobalt-tint' : ''}`}
                  onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); choose(item); }}
                  title={getLabel?.(item)}>
                  {renderOption(item)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}
