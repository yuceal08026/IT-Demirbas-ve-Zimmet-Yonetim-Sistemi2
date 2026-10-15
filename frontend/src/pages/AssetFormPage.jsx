import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useApi, useTitle } from '../lib/hooks.js';
import { Link, useNavigate } from '../lib/router.jsx';
import { useToast } from '../components/Toast.jsx';
import { AssetTag, ErrorBlock, Field, LoadingBlock, PageHeader, Spinner } from '../components/ui.jsx';
import { todayLocalIso } from '../lib/format.js';

const EMPTY = { category: '', brand: '', model: '', serial_number: '', purchase_date: '', warranty_end_date: '', notes: '' };
const todayIso = todayLocalIso;

/** İstemci tarafı ön kontrol — aynı kurallar backend'de zod ile tekrar doğrulanır. */
function validate(f) {
  const e = {};
  if (f.category.trim().length < 2) e.category = 'Kategori zorunludur';
  if (!f.brand.trim()) e.brand = 'Marka zorunludur';
  if (!f.model.trim()) e.model = 'Model zorunludur';
  if (f.serial_number.trim().length < 2) e.serial_number = 'Seri numarası zorunludur';
  else if (!/^[A-Za-z0-9\-_./ ]+$/.test(f.serial_number.trim())) e.serial_number = 'Yalnızca harf, rakam ve - _ . / kullanın';
  if (f.purchase_date && f.purchase_date > todayIso()) e.purchase_date = 'Alım tarihi gelecekte olamaz';
  if (f.purchase_date && f.warranty_end_date && f.warranty_end_date < f.purchase_date) {
    e.warranty_end_date = 'Garanti bitişi alım tarihinden önce olamaz';
  }
  return e;
}

export default function AssetFormPage({ id }) {
  const editing = Boolean(id);
  useTitle(editing ? 'Cihazı düzenle' : 'Yeni cihaz');
  const navigate = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const categories = useApi(() => api.get('/assets/categories'), []);
  const existing = useApi(() => (editing ? api.get(`/assets/${id}`) : null), [id]);

  useEffect(() => {
    const a = existing.data;
    if (a) {
      setForm({
        category: a.category, brand: a.brand, model: a.model, serial_number: a.serial_number,
        purchase_date: a.purchase_date || '', warranty_end_date: a.warranty_end_date || '', notes: a.notes || '',
      });
    }
  }, [existing.data]);

  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    if (errors[key]) setErrors((er) => ({ ...er, [key]: undefined }));
  };

  async function submit(e) {
    e.preventDefault();
    const clientErrors = validate(form);
    setErrors(clientErrors);
    if (Object.keys(clientErrors).length) {
      document.getElementById(`f-${Object.keys(clientErrors)[0]}`)?.focus();
      return;
    }
    setBusy(true);
    const payload = {
      category: form.category.trim(), brand: form.brand.trim(), model: form.model.trim(),
      serial_number: form.serial_number.trim(), purchase_date: form.purchase_date || null,
      warranty_end_date: form.warranty_end_date || null, notes: form.notes.trim() || null,
    };
    try {
      const saved = editing ? await api.patch(`/assets/${id}`, payload) : await api.post('/assets', payload);
      toast.success(editing ? 'Cihaz bilgileri kaydedildi' : `Cihaz eklendi: ${saved.asset_code}`);
      navigate(`/assets/${saved.id}`, { replace: editing });
    } catch (err) {
      setErrors(err.fieldErrors?.() || {});
      toast.error(err.message);
      setBusy(false);
    }
  }

  if (editing && existing.loading && !existing.data) return <LoadingBlock />;
  if (editing && existing.error) return <ErrorBlock error={existing.error} onRetry={existing.reload} />;

  const input = (key, props = {}) => ({ id, invalid, describedBy }) => (
    <input id={id} className="field-input" value={form[key]} onChange={set(key)} aria-invalid={invalid}
      aria-describedby={describedBy} {...props} />
  );

  return (
    <>
      <PageHeader title={editing ? `${existing.data.brand} ${existing.data.model}` : 'Yeni cihaz'}
        description={editing ? 'Cihaz bilgilerini güncelleyin. Cihaz kodu değiştirilemez; basılı QR etiketleri geçerli kalır.' : 'Kaydettiğinizde cihaza otomatik bir kod ve QR etiketi üretilir. Cihaz "Depoda" durumunda başlar.'}>
        {editing && <div className="mb-3"><AssetTag code={existing.data.asset_code} size="md" /></div>}
      </PageHeader>

      <form onSubmit={submit} noValidate className="panel max-w-3xl">
        <div className="grid gap-5 p-5 sm:grid-cols-2">
          <Field id="f-category" label="Kategori" error={errors.category} hint="Örn. Dizüstü Bilgisayar, Monitör, Sunucu">
            {input('category', { list: 'category-options', autoComplete: 'off' })}
          </Field>
          <datalist id="category-options">
            {(categories.data?.data || []).map((c) => <option key={c} value={c} />)}
          </datalist>
          <Field id="f-serial_number" label="Seri numarası" error={errors.serial_number} hint="Üreticinin cihaz üzerindeki seri numarası">
            {input('serial_number', { className: 'field-input font-mono uppercase', autoComplete: 'off', spellCheck: false })}
          </Field>
          <Field id="f-brand" label="Marka" error={errors.brand}>{input('brand')}</Field>
          <Field id="f-model" label="Model" error={errors.model}>{input('model')}</Field>
          <Field id="f-purchase_date" label="Alım tarihi" error={errors.purchase_date}>{input('purchase_date', { type: 'date', max: todayIso() })}</Field>
          <Field id="f-warranty_end_date" label="Garanti bitiş tarihi" error={errors.warranty_end_date} hint="Garanti uyarıları bu tarihe göre üretilir">
            {input('warranty_end_date', { type: 'date', min: form.purchase_date || undefined })}
          </Field>
          <Field id="f-notes" label="Not (yalnızca yöneticiler görür)" error={errors.notes} className="sm:col-span-2">
            {({ id, invalid, describedBy }) => (
              <textarea id={id} rows={3} className="field-input" value={form.notes} onChange={set('notes')} maxLength={1000}
                aria-invalid={invalid} aria-describedby={describedBy} />
            )}
          </Field>
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-line px-5 py-3 sm:flex-row sm:justify-end">
          <Link to={editing ? `/assets/${id}` : '/assets'} className="btn btn-secondary">Vazgeç</Link>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy && <Spinner className="size-4 text-white" />}
            {editing ? 'Değişiklikleri kaydet' : 'Cihazı kaydet'}
          </button>
        </div>
      </form>
    </>
  );
}
