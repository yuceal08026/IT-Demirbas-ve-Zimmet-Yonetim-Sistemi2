import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, onPasswordChangeRequired, onUnauthorized } from '../lib/api.js';
import { useNavigate } from '../lib/router.jsx';
import { useToast } from '../components/Toast.jsx';

/**
 * Oturum durumu. user: undefined = kontrol ediliyor, null = giriş yapılmamış.
 * Token httpOnly cookie'de durur; burada yalnızca kullanıcı bilgisi tutulur.
 * Arayüzdeki rol kontrolleri yalnızca görünürlük içindir — yetkiyi backend doğrular.
 */
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined);
  // İlk kurulum: sistemde hiç yönetici yoksa giriş ekranı yerine kurulum ekranı gösterilir.
  const [needsSetup, setNeedsSetup] = useState(false);
  const navigate = useNavigate();
  const toast = useToast();

  useEffect(() => {
    api.get('/auth/me', undefined, { skipAuthRedirect: true })
      .then((r) => setUser(r.user))
      .catch(async () => {
        try {
          const s = await api.get('/setup/status', undefined, { skipAuthRedirect: true });
          setNeedsSetup(Boolean(s.needs_setup));
        } catch {
          setNeedsSetup(false);
        }
        setUser(null);
      });
  }, []);

  // Herhangi bir istek 401 dönerse (oturum süresi doldu, şifre sıfırlandı, hesap pasif) çıkış yap.
  const userRef = useRef(user);
  userRef.current = user;
  useEffect(
    () =>
      onUnauthorized(() => {
        if (userRef.current) toast.info('Oturumunuz sona erdi. Lütfen tekrar giriş yapın.');
        setUser(null);
      }),
    [toast],
  );

  // Sunucu "önce parolanızı değiştirin" derse (ör. yönetici parolayı sıfırladı) parola ekranına geçilir.
  useEffect(
    () =>
      onPasswordChangeRequired(() => {
        setUser((u) => (u ? { ...u, must_change_password: true } : u));
      }),
    [],
  );

  /** portal: 'USER' (Personel girişi) veya 'ADMIN' (Yönetici girişi) — yanlış sekmede sunucu WRONG_PORTAL döner. */
  const login = useCallback(async (email, password, portal) => {
    const r = await api.post('/auth/login', { email, password, portal }, { skipAuthRedirect: true });
    setUser(r.user);
    return r.user;
  }, []);

  /** Tarayıcıdan ilk kurulum tamamlanınca: yönetici oluşturuldu ve oturum açıldı. */
  const completeSetup = useCallback((createdUser) => {
    setNeedsSetup(false);
    setUser(createdUser);
  }, []);

  /** Kendi parolasını değiştirir. Sunucu diğer oturumları kapatır ve bu tarayıcıya yeni oturum çerezi verir. */
  // Yanıtta yeni kurtarma kodu varsa kullanıcı bilgisi hemen güncellenmez: önce kod gösterilir (bkz. ChangePasswordForm).
  const changePassword = useCallback(async (currentPassword, newPassword) => {
    const r = await api.post('/auth/change-password', { current_password: currentPassword, new_password: newPassword }, { skipAuthRedirect: true });
    if (!r.recovery_code) setUser(r.user);
    return r;
  }, []);

  const logout = useCallback(async () => {
    await api.post('/auth/logout', {}, { skipAuthRedirect: true }).catch(() => {});
    setUser(null);
    navigate('/login', { replace: true });
  }, [navigate]);

  const value = useMemo(
    () => ({ user, isAdmin: user?.role === 'ADMIN', needsSetup, login, logout, changePassword, completeSetup, setUser }),
    [user, needsSetup, login, logout, changePassword, completeSetup],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
