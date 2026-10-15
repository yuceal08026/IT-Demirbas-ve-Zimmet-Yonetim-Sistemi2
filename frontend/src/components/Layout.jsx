import { useEffect, useState } from 'react';
import { Link, useRouter } from '../lib/router.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { ROLE_LABELS } from '../lib/format.js';
import { Icon } from './ui.jsx';
import { ChangePasswordModal, RecoveryCodeModal } from './ChangePassword.jsx';

const NAV_ICONS = {
  overview: 'M3.5 3.5h5v6h-5zM11.5 3.5h5v3.5h-5zM11.5 10h5v6.5h-5zM3.5 12.5h5v4h-5z',
  assets: 'M2.5 5.5h15v9h-15zM6 17h8M10 14.5V17',
  assign: 'M7 6.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM2.5 15c0-2.5 2-4.5 4.5-4.5s4.5 2 4.5 4.5M12.5 9.5h5m-2-2 2 2-2 2',
  mine: 'M4 3.5h12v13H4zM7 7.5h6M7 10.5h6M7 13.5h3',
  users: 'M7.5 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2 16.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5M13.5 3.5a3 3 0 0 1 0 5.5M15 11.5c1.7.6 3 2.4 3 5',
  departments: 'M3 16.5V6l7-3 7 3v10.5M7 16.5v-4h6v4M7 8.5h.01M10 8.5h.01M13 8.5h.01',
  audit: 'M10 5.5V10l3 2M10 17.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15Z',
  alerts: 'M10 3 2.5 16h15L10 3Zm0 5v4m0 2.5h.01',
  reports: 'M5 2.5h7l3 3v12H5zM8 9.5h4M8 12.5h4M10 14.5v-5',
};

const NAV = [
  { to: '/', label: 'Genel bakış', icon: 'overview', admin: true, exact: true },
  { to: '/assets', label: 'Cihazlar', icon: 'assets', admin: true },
  { to: '/assignments', label: 'Zimmetler', icon: 'assign', admin: true },
  { to: '/alerts', label: 'Uyarılar', icon: 'alerts', admin: true },
  { to: '/users', label: 'Personel', icon: 'users', admin: true },
  { to: '/departments', label: 'Departmanlar', icon: 'departments', admin: true },
  { to: '/audit', label: 'İşlem geçmişi', icon: 'audit', admin: true },
  { to: '/reports', label: 'Raporlar', icon: 'reports', admin: true },
  { to: '/my-assets', label: 'Zimmetlerim', icon: 'mine', admin: false },
];

function Brand() {
  return (
    <Link to="/" className="flex items-center gap-2.5 rounded px-1 text-white">
      <svg viewBox="0 0 32 32" className="size-8" aria-hidden="true">
        <rect x="2" y="8" width="28" height="16" rx="3" fill="#D5DCE3" />
        <circle cx="7" cy="16" r="1.6" fill="#1D2733" />
        <circle cx="25" cy="16" r="1.6" fill="#1D2733" />
        <path d="M11 12v8M13.5 12v8M16 12v8M19 12v8M21 12v8" stroke="#1D2733" strokeWidth="1.4" />
      </svg>
      <span className="leading-tight">
        <span className="block text-[17px] font-bold">Zimmet</span>
        <span className="block text-xs text-white/60">IT demirbaş yönetimi</span>
      </span>
    </Link>
  );
}

function NavList({ onNavigate }) {
  const { isAdmin } = useAuth();
  const { location } = useRouter();
  const items = NAV.filter((n) => isAdmin || !n.admin);
  return (
    <ul className="space-y-0.5">
      {items.map((item) => {
        const active = item.exact
          ? location.pathname === item.to
          : location.pathname === item.to || location.pathname.startsWith(`${item.to}/`);
        return (
          <li key={item.to}>
            <Link to={item.to} onClick={onNavigate} aria-current={active ? 'page' : undefined}
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-[15px] transition-colors ${
                active ? 'bg-white/12 font-semibold text-white' : 'text-white/72 hover:bg-white/6 hover:text-white'
              }`}>
              <svg viewBox="0 0 20 20" className="size-[18px] flex-none" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d={NAV_ICONS[item.icon]} />
              </svg>
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function UserBox() {
  const { user, logout } = useAuth();
  const [pwOpen, setPwOpen] = useState(false);
  const [rcOpen, setRcOpen] = useState(false);
  return (
    <div className="border-t border-white/10 pt-4">
      <p className="truncate font-semibold text-white">{user.ad_soyad}</p>
      <p className="truncate text-sm text-white/60">
        {ROLE_LABELS[user.role]}{user.department ? `, ${user.department.name}` : ''}
      </p>
      <button type="button" onClick={() => setPwOpen(true)}
        className="mt-3 w-full rounded-md px-3 py-1.5 text-left text-sm font-semibold text-white/80 hover:bg-white/10 hover:text-white">
        Parolamı değiştir
      </button>
      <button type="button" onClick={() => setRcOpen(true)}
        className="w-full rounded-md px-3 py-1.5 text-left text-sm font-semibold text-white/80 hover:bg-white/10 hover:text-white">
        Kurtarma kodu{!user.has_recovery_code && <span className="ml-1.5 rounded-full bg-warn-tint px-1.5 text-[12px] text-warn">oluşturun</span>}
      </button>
      <button type="button" onClick={logout}
        className="mt-1 w-full rounded-md border border-white/20 px-3 py-1.5 text-sm font-semibold text-white/90 hover:bg-white/10">
        Çıkış yap
      </button>
      <ChangePasswordModal open={pwOpen} onClose={() => setPwOpen(false)} />
      <RecoveryCodeModal open={rcOpen} onClose={() => setRcOpen(false)} />
    </div>
  );
}

export default function Layout({ children }) {
  const [open, setOpen] = useState(false);
  const { location } = useRouter();

  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="min-h-screen lg:flex">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2">
        İçeriğe geç
      </a>

      {/* Masaüstü kenar menü */}
      <aside className="sticky top-0 hidden h-screen print:!hidden w-64 flex-none flex-col bg-ink px-4 py-5 lg:flex">
        <Brand />
        <nav className="mt-8 flex-1 overflow-y-auto" aria-label="Ana menü"><NavList /></nav>
        <UserBox />
      </aside>

      {/* Mobil/tablet üst çubuk */}
      <header className="sticky top-0 z-30 flex items-center justify-between bg-ink px-4 py-3 lg:hidden print:hidden">
        <Brand />
        <button type="button" onClick={() => setOpen(true)} className="rounded-md p-2 text-white hover:bg-white/10"
          aria-label="Menüyü aç" aria-expanded={open}>
          <Icon name="menu" className="size-6" />
        </button>
      </header>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink/50" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="absolute inset-y-0 right-0 flex w-72 max-w-[85vw] flex-col bg-ink px-4 py-5 shadow-2xl" role="dialog" aria-modal="true" aria-label="Menü">
            <div className="flex items-center justify-end">
              <button type="button" onClick={() => setOpen(false)} className="rounded-md p-2 text-white hover:bg-white/10" aria-label="Menüyü kapat">
                <Icon name="close" className="size-6" />
              </button>
            </div>
            <nav className="mt-2 flex-1 overflow-y-auto" aria-label="Ana menü"><NavList onNavigate={() => setOpen(false)} /></nav>
            <UserBox />
          </div>
        </div>
      )}

      <main id="main" className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-9 print:p-0">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
