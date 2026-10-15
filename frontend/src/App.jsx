import { useAuth } from './context/AuthContext.jsx';
import { matchPath, useRouter, Redirect } from './lib/router.jsx';
import Layout from './components/Layout.jsx';
import { Spinner } from './components/ui.jsx';
import LoginPage from './pages/LoginPage.jsx';
import SetupPage from './pages/SetupPage.jsx';
import UsersPage from './pages/UsersPage.jsx';
import DepartmentsPage from './pages/DepartmentsPage.jsx';
import AssetsPage from './pages/AssetsPage.jsx';
import AssetFormPage from './pages/AssetFormPage.jsx';
import AssetDetailPage from './pages/AssetDetailPage.jsx';
import AssignmentsPage from './pages/AssignmentsPage.jsx';
import MyAssetsPage from './pages/MyAssetsPage.jsx';
import AuditPage from './pages/AuditPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import AlertsPage from './pages/AlertsPage.jsx';
import ReportsPage from './pages/ReportsPage.jsx';
import { ForbiddenPage, NotFoundPage } from './pages/StatusPages.jsx';
import { ForcedPasswordChangePage } from './components/ChangePassword.jsx';

/**
 * Rota tablosu. admin: true olan sayfalar yalnızca yöneticiye görünür.
 * Bu kontrol yalnızca arayüz içindir; aynı uçlar backend'de requireRole('ADMIN') ile korunur.
 */
const ROUTES = [
  { path: '/', admin: true, element: () => <DashboardPage /> },
  { path: '/alerts', admin: true, element: () => <AlertsPage /> },
  { path: '/users', admin: true, element: () => <UsersPage /> },
  { path: '/departments', admin: true, element: () => <DepartmentsPage /> },
  { path: '/assets', admin: true, element: () => <AssetsPage /> },
  { path: '/assets/new', admin: true, element: () => <AssetFormPage /> },
  { path: '/assets/code/:code', element: ({ code }) => <AssetDetailPage code={code} key={code} /> },
  { path: '/assets/:id/edit', admin: true, element: ({ id }) => <AssetFormPage id={id} key={id} /> },
  // Personel de yalnızca kendi zimmetindeki cihazın detayını görebilir (backend 404 döner).
  { path: '/assets/:id', element: ({ id }) => <AssetDetailPage id={id} key={id} /> },
  { path: '/assignments', admin: true, element: () => <AssignmentsPage /> },
  { path: '/audit', admin: true, element: () => <AuditPage /> },
  { path: '/reports', admin: true, element: () => <ReportsPage /> },
  { path: '/my-assets', element: () => <MyAssetsPage /> },
];

export default function App() {
  const { user, isAdmin, needsSetup } = useAuth();
  const { location } = useRouter();

  if (user === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center" role="status" aria-label="Yükleniyor">
        <Spinner className="size-8" />
      </div>
    );
  }

  // Henüz yönetici yok: kurulum ekranı (sunucu kayıtlarındaki tek kullanımlık kodla korunur).
  if (!user && needsSetup) return <SetupPage />;

  if (!user) {
    if (location.pathname !== '/login') {
      const next = encodeURIComponent(location.pathname + location.search);
      return <Redirect to={`/login?next=${next}`} />;
    }
    return <LoginPage />;
  }

  // Geçici/bilinen parolayla giriş yapan kullanıcı önce kendi parolasını belirler (backend de bunu zorunlu tutar).
  if (user.must_change_password) return <ForcedPasswordChangePage />;

  if (location.pathname === '/login') return <Redirect to={isAdmin ? '/' : '/my-assets'} />;

  for (const route of ROUTES) {
    const params = matchPath(route.path, location.pathname);
    if (!params) continue;
    if (route.admin && !isAdmin) {
      // Personel ana sayfası "Zimmetlerim"dir.
      if (route.path === '/') return <Redirect to="/my-assets" />;
      return <Layout><ForbiddenPage /></Layout>;
    }
    return <Layout>{route.element(params)}</Layout>;
  }
  return <Layout><NotFoundPage /></Layout>;
}
