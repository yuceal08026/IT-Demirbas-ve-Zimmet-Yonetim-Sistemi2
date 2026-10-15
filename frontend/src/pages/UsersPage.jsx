import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useApi, useDebounced, useTitle } from '../lib/hooks.js';
import { useSearchParams } from '../lib/router.jsx';
import { ROLE_LABELS, formatDate } from '../lib/format.js';
import { useToast } from '../components/Toast.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import ResetRequestsPanel from '../components/ResetRequestsPanel.jsx';
import PendingRegistrationsPanel from '../components/PendingRegistrationsPanel.jsx';
import {
  ConfirmDialog, DataTable, EmptyState, ErrorBlock, Field, FilterSelect, Icon, LoadingBlock, Modal,
  PageHeader, Pagination, Pill, SearchInput, Spinner,
} from '../components/ui.jsx';

const EMPTY_FORM = { ad_soyad: '', email: '', password: '', role: 'USER', department_id: '' };

function UserFormModal({ open, user, departments, onClose, onSaved }) {
  const toast = useToast();
  const editing = Boolean(user);
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setForm(user ? { ad_soyad: user.ad_soyad, email: user.email, password: '', role: user.role, department_id: user.department_id ?? '' } : EMPTY_FORM);
  }, [open, user]);

  function validate() {
    const e = {};
    if (form.ad_soyad.trim().length < 2) e.ad_soyad = 'Ad soyad en az 2 karakter olmalıdır';
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) e.email = 'Geçerli bir e-posta adresi girin';
    if (!editing) {
      if (form.password.length < 8) e.password = 'Parola en az 8 karakter olmalıdır';
      else if (!/\d/.test(form.password) || !/[A-Za-zÇĞİÖŞÜçğıöşü]/.test(form.password)) e.password = 'Parola en az bir harf ve bir rakam içermelidir';
    }
    return e;
  }

  async function submit(ev) {
    ev.preventDefault();
    const clientErrors = validate();
    setErrors(clientErrors);
    if (Object.keys(clientErrors).length) return;
    setBusy(true);
    const payload = {
      ad_soyad: form.ad_soyad.trim(),
      email: form.email.trim(),
      role: form.role,
      department_id: form.department_id === '' ? null : Number(form.department_id),
    };
    try {
      if (editing) {
        await api.patch(`/users/${user.id}`, payload);
        toast.success('Kullanıcı güncellendi');
      } else {
        await api.post('/users', { ...payload, password: form.password });
        toast.success('Kullanıcı eklendi');
      }
      onSaved();
    } catch (err) {
      setErrors(err.fieldErrors?.() || {});
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Kullanıcıyı düzenle' : 'Yeni kullanıcı'}
      footer={(
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Vazgeç</button>
          <button type="submit" form="user-form" className="btn btn-primary" disabled={busy}>
            {busy && <Spinner className="size-4 text-white" />}
            {editing ? 'Değişiklikleri kaydet' : 'Kullanıcıyı ekle'}
          </button>
        </>
      )}>
      <form id="user-form" className="grid gap-4 sm:grid-cols-2" onSubmit={submit} noValidate>
        <Field label="Ad soyad" error={errors.ad_soyad} className="sm:col-span-2">
          {({ id, invalid, describedBy }) => (
            <input id={id} className="field-input" value={form.ad_soyad} onChange={set('ad_soyad')} aria-invalid={invalid} aria-describedby={describedBy} />
          )}
        </Field>
        <Field label="E-posta" error={errors.email} className="sm:col-span-2">
          {({ id, invalid, describedBy }) => (
            <input id={id} type="email" className="field-input" value={form.email} onChange={set('email')} aria-invalid={invalid} aria-describedby={describedBy} autoComplete="off" />
          )}
        </Field>
        {!editing && (
          <Field label="Geçici parola" error={errors.password} hint="En az 8 karakter; harf ve rakam içermeli. Kişi ilk girişte kendi parolasını belirler." className="sm:col-span-2">
            {({ id, invalid, describedBy }) => (
              <input id={id} type="password" className="field-input" value={form.password} onChange={set('password')} aria-invalid={invalid} aria-describedby={describedBy} autoComplete="new-password" />
            )}
          </Field>
        )}
        <Field label="Rol" error={errors.role}>
          {({ id }) => (
            <select id={id} className="field-input" value={form.role} onChange={set('role')}>
              <option value="USER">Personel</option>
              <option value="ADMIN">Yönetici</option>
            </select>
          )}
        </Field>
        <Field label="Departman" error={errors.department_id}>
          {({ id }) => (
            <select id={id} className="field-input" value={form.department_id} onChange={set('department_id')}>
              <option value="">Departman yok</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          )}
        </Field>
      </form>
    </Modal>
  );
}

function PasswordModal({ user, onClose }) {
  const toast = useToast();
  const { user: me, logout } = useAuth();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { setPassword(''); setError(''); }, [user]);

  async function submit(ev) {
    ev.preventDefault();
    if (password.length < 8 || !/\d/.test(password) || !/[A-Za-zÇĞİÖŞÜçğıöşü]/.test(password)) {
      setError('Parola en az 8 karakter olmalı, harf ve rakam içermelidir');
      return;
    }
    setBusy(true);
    try {
      await api.patch(`/users/${user.id}/password`, { password });
      toast.success(`${user.ad_soyad} için geçici parola belirlendi. Açık oturumları kapatıldı; ilk girişte kendi parolasını belirleyecek.`);
      onClose();
      if (user.id === me.id) logout();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={Boolean(user)} onClose={onClose} title="Parola sıfırla"
      footer={(
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Vazgeç</button>
          <button type="submit" form="pw-form" className="btn btn-primary" disabled={busy}>
            {busy && <Spinner className="size-4 text-white" />}Parolayı değiştir
          </button>
        </>
      )}>
      <form id="pw-form" onSubmit={submit} noValidate className="space-y-3">
        <p className="text-sm text-ink-soft"><strong>{user?.ad_soyad}</strong> için geçici bir parola belirleyin. Kişinin tüm açık oturumları kapanır ve ilk girişte kendi parolasını belirlemesi istenir.</p>
        <Field label="Yeni parola" error={error}>
          {({ id, invalid, describedBy }) => (
            <input id={id} type="password" className="field-input" value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={invalid} aria-describedby={describedBy} autoComplete="new-password" />
          )}
        </Field>
      </form>
    </Modal>
  );
}

export default function UsersPage() {
  useTitle('Personel');
  const toast = useToast();
  const { user: me } = useAuth();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.search || '');
  const debouncedSearch = useDebounced(search);
  const [formState, setFormState] = useState({ open: false, user: null });
  const [pwUser, setPwUser] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const page = Number(params.page || 1);
  const sort = params.sort || 'created_at';
  const order = params.order || 'desc';

  useEffect(() => {
    if ((params.search || '') !== debouncedSearch) setParams({ search: debouncedSearch, page: undefined });
  }, [debouncedSearch]); // eslint-disable-line react-hooks/exhaustive-deps

  const departments = useApi(() => api.get('/departments'), []);
  const list = useApi(
    () => api.get('/users', { page, limit: 20, search: params.search, sort, order, role: params.role, department_id: params.department_id, is_active: params.is_active }),
    [page, params.search, sort, order, params.role, params.department_id, params.is_active],
  );

  function toggleSort(key) {
    setParams({ sort: key, order: sort === key && order === 'asc' ? 'desc' : 'asc', page: undefined });
  }

  async function runConfirm() {
    const { type, user } = confirm;
    try {
      if (type === 'delete') {
        await api.delete(`/users/${user.id}`);
        toast.success(`${user.ad_soyad} silindi`);
      } else {
        await api.patch(`/users/${user.id}`, { is_active: type === 'activate' });
        toast.success(type === 'activate' ? `${user.ad_soyad} aktifleştirildi` : `${user.ad_soyad} pasife alındı`);
      }
      setConfirm(null);
      list.reload();
    } catch (err) {
      toast.error(err.message);
      setConfirm(null);
    }
  }

  const columns = [
    {
      key: 'ad_soyad', header: 'Ad soyad', sortKey: 'ad_soyad', primary: true,
      render: (u) => (
        <div className="min-w-0">
          <p className="font-semibold">{u.ad_soyad}{u.id === me.id && <span className="ml-1.5 text-sm font-normal text-steel">(siz)</span>}</p>
          <p className="truncate text-sm text-steel-dark">{u.email}</p>
        </div>
      ),
    },
    { key: 'role', header: 'Rol', sortKey: 'role', render: (u) => (u.role === 'ADMIN' ? <Pill tone="cobalt">Yönetici</Pill> : ROLE_LABELS[u.role]) },
    { key: 'department', header: 'Departman', sortKey: 'department', render: (u) => u.department_name || <span className="text-steel">—</span> },
    { key: 'active_assignment_count', header: 'Zimmet', className: 'text-right md:text-center', render: (u) => u.active_assignment_count },
    {
      key: 'is_active', header: 'Durum',
      render: (u) => (!u.is_active ? <Pill tone="muted">Pasif</Pill> : u.must_change_password
        ? <span title="Geçici parolayla açıldı; kişi ilk girişte kendi parolasını belirleyecek.">Aktif <span className="text-sm text-steel-dark">(parola bekliyor)</span></span>
        : 'Aktif'),
    },
    { key: 'created_at', header: 'Eklenme', sortKey: 'created_at', hideOnMobile: true, render: (u) => formatDate(u.created_at) },
    {
      key: 'actions', header: <span className="sr-only">İşlemler</span>, className: 'text-right',
      render: (u) => (
        <div className="flex justify-end gap-1">
          <button type="button" className="btn btn-ghost btn-sm px-2" title="Düzenle" aria-label={`${u.ad_soyad} düzenle`}
            onClick={() => setFormState({ open: true, user: u })}><Icon name="edit" className="size-4" /></button>
          <button type="button" className="btn btn-ghost btn-sm px-2" title="Parola sıfırla" aria-label={`${u.ad_soyad} parola sıfırla`}
            onClick={() => setPwUser(u)}><Icon name="key" className="size-4" /></button>
          {u.id !== me.id && (
            <>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirm({ type: u.is_active ? 'deactivate' : 'activate', user: u })}>
                {u.is_active ? 'Pasife al' : 'Aktifleştir'}
              </button>
              <button type="button" className="btn btn-ghost btn-sm px-2 text-st-defect hover:bg-st-defect-tint" title="Sil" aria-label={`${u.ad_soyad} sil`}
                onClick={() => setConfirm({ type: 'delete', user: u })}><Icon name="trash" className="size-4" /></button>
            </>
          )}
        </div>
      ),
    },
  ];

  const confirmText = {
    delete: { title: 'Kullanıcıyı sil', label: 'Kalıcı olarak sil', body: 'Bu işlem geri alınamaz. Zimmet geçmişi olan kullanıcılar silinemez; onları pasife alın.' },
    deactivate: { title: 'Kullanıcıyı pasife al', label: 'Pasife al', body: 'Kullanıcı giriş yapamaz ve açık oturumları kapanır. Kayıtları ve geçmişi korunur. Üzerinde zimmetli cihaz varsa önce iade alınmalıdır.' },
    activate: { title: 'Kullanıcıyı aktifleştir', label: 'Aktifleştir', body: 'Kullanıcı tekrar giriş yapabilir ve kendisine cihaz zimmetlenebilir.' },
  };

  return (
    <>
      <PageHeader title="Personel" description="Sisteme giriş yapabilen kullanıcılar, rolleri ve departmanları."
        actions={(
          <button type="button" className="btn btn-primary" onClick={() => setFormState({ open: true, user: null })}>
            <Icon name="plus" className="size-4" />Kullanıcı ekle
          </button>
        )} />

      <PendingRegistrationsPanel departments={departments.data?.data || []} onChanged={list.reload} />
      <ResetRequestsPanel onChanged={list.reload} />

      <div className="panel">
        <div className="flex flex-col gap-2 border-b border-line p-3 sm:flex-row sm:flex-wrap sm:items-center">
          <SearchInput value={search} onChange={setSearch} placeholder="Ad veya e-posta ara" />
          <FilterSelect label="Rol" value={params.role} onChange={(v) => setParams({ role: v, page: undefined })}>
            <option value="">Tüm roller</option>
            <option value="ADMIN">Yönetici</option>
            <option value="USER">Personel</option>
          </FilterSelect>
          <FilterSelect label="Departman" value={params.department_id} onChange={(v) => setParams({ department_id: v, page: undefined })}>
            <option value="">Tüm departmanlar</option>
            {(departments.data?.data || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </FilterSelect>
          <FilterSelect label="Durum" value={params.is_active} onChange={(v) => setParams({ is_active: v, page: undefined })}>
            <option value="">Aktif ve pasif</option>
            <option value="true">Yalnızca aktif</option>
            <option value="false">Yalnızca pasif</option>
          </FilterSelect>
        </div>

        {list.error && <div className="p-4"><ErrorBlock error={list.error} onRetry={list.reload} /></div>}
        {!list.data && list.loading ? <LoadingBlock /> : list.data && (
          <div className={list.loading ? 'opacity-60 transition-opacity' : ''}>
            <DataTable columns={columns} rows={list.data.data} sort={sort} order={order} onSort={toggleSort}
              empty={<EmptyState title="Eşleşen kullanıcı yok">Aramayı veya filtreleri değiştirin.</EmptyState>} />
            <Pagination meta={list.data.meta} onPage={(p) => setParams({ page: p }, { replace: false })} />
          </div>
        )}
      </div>

      <UserFormModal open={formState.open} user={formState.user} departments={departments.data?.data || []}
        onClose={() => setFormState({ open: false, user: null })}
        onSaved={() => { setFormState({ open: false, user: null }); list.reload(); }} />
      <PasswordModal user={pwUser} onClose={() => setPwUser(null)} />
      {confirm && (
        <ConfirmDialog open title={confirmText[confirm.type].title} confirmLabel={confirmText[confirm.type].label}
          tone={confirm.type === 'activate' ? 'primary' : 'danger'} onConfirm={runConfirm} onClose={() => setConfirm(null)}>
          <p className="mb-2 font-semibold text-ink">{confirm.user.ad_soyad}</p>
          <p>{confirmText[confirm.type].body}</p>
        </ConfirmDialog>
      )}
    </>
  );
}
