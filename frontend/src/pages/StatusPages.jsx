import { Link } from '../lib/router.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useTitle } from '../lib/hooks.js';

function StatusMessage({ code, title, children }) {
  const { isAdmin } = useAuth();
  return (
    <div className="mx-auto max-w-md py-20 text-center">
      <p className="asset-tag mx-auto px-3 py-1 text-sm">HATA-{code}</p>
      <h1 className="mt-5 text-2xl font-bold">{title}</h1>
      <p className="mt-2 text-steel-dark">{children}</p>
      <Link to={isAdmin ? '/' : '/my-assets'} className="btn btn-primary mt-6">
        {isAdmin ? 'Genel bakışa dön' : 'Zimmetlerime dön'}
      </Link>
    </div>
  );
}

export function ForbiddenPage() {
  useTitle('Erişim yok');
  return (
    <StatusMessage code="403" title="Bu sayfaya erişim yetkiniz yok">
      Bu bölüm yalnızca yöneticilere açıktır. Erişime ihtiyacınız varsa Bilgi İşlem birimine başvurun.
    </StatusMessage>
  );
}

export function NotFoundPage() {
  useTitle('Sayfa bulunamadı');
  return (
    <StatusMessage code="404" title="Sayfa bulunamadı">
      Aradığınız sayfa taşınmış ya da hiç var olmamış olabilir.
    </StatusMessage>
  );
}
