import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

/**
 * Küçük, bağımlılıksız istemci tarafı yönlendirici (History API).
 * Uygulamanın ihtiyacı: yol eşleştirme (:param), sorgu parametreleri, Link ve navigate.
 */

const RouterContext = createContext(null);

function currentLocation() {
  return { pathname: window.location.pathname, search: window.location.search };
}

export function RouterProvider({ children }) {
  const [location, setLocation] = useState(currentLocation);

  useEffect(() => {
    const onPop = () => setLocation(currentLocation());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((to, { replace = false } = {}) => {
    if (to === window.location.pathname + window.location.search) return;
    window.history[replace ? 'replaceState' : 'pushState']({}, '', to);
    setLocation(currentLocation());
    window.scrollTo(0, 0);
  }, []);

  const value = useMemo(() => ({ location, navigate }), [location, navigate]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter() {
  return useContext(RouterContext);
}

export function useNavigate() {
  return useContext(RouterContext).navigate;
}

/** "/assets/:id" kalıbını yol ile eşleştirir; eşleşirse parametreleri döner. */
export function matchPath(pattern, pathname) {
  const keys = [];
  const source = pattern
    .replace(/\/+$/, '')
    .replace(/:(\w+)/g, (_, key) => {
      keys.push(key);
      return '([^/]+)';
    });
  const match = new RegExp(`^${source}/?$`).exec(pathname);
  if (!match) return null;
  return Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(match[i + 1])]));
}

/** URL sorgu parametrelerini nesne olarak okur ve günceller (filtre/sayfa durumu URL'de tutulur). */
export function useSearchParams() {
  const { location, navigate } = useRouter();
  const params = useMemo(() => Object.fromEntries(new URLSearchParams(location.search)), [location.search]);

  const setParams = useCallback(
    (updates, { replace = true } = {}) => {
      const next = new URLSearchParams(location.search);
      for (const [key, value] of Object.entries(updates)) {
        if (value === undefined || value === null || value === '') next.delete(key);
        else next.set(key, String(value));
      }
      const qs = next.toString();
      navigate(location.pathname + (qs ? `?${qs}` : ''), { replace });
    },
    [location.pathname, location.search, navigate],
  );

  return [params, setParams];
}

export function Link({ to, children, onClick, replace, ...rest }) {
  const navigate = useNavigate();
  function handleClick(event) {
    onClick?.(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      rest.target === '_blank'
    ) {
      return;
    }
    event.preventDefault();
    navigate(to, { replace });
  }
  return (
    <a href={to} onClick={handleClick} {...rest}>
      {children}
    </a>
  );
}

export function Redirect({ to }) {
  const navigate = useNavigate();
  useEffect(() => {
    navigate(to, { replace: true });
  }, [navigate, to]);
  return null;
}
