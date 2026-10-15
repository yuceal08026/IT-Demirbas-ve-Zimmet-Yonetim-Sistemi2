# Yetki Haritası (RBAC) — Aşama 1

PRD §3 yetki matrisinin ekran ve API düzeyine çevrilmiş hâli. **Kural:** Frontend yalnızca gösterimi kolaylaştırır; asıl karar her zaman backend middleware'inde verilir. Bir buton gizli olsa bile ilgili API ucu rolü tekrar kontrol eder.

## 1. Middleware zinciri

| Middleware | Görev | Başarısızlıkta |
|-----------|-------|----------------|
| `authenticate` | JWT'yi cookie'den veya `Authorization: Bearer` başlığından okur, imza + süre doğrular; DB'den kullanıcıyı çeker; `is_active` ve `token_version` eşleşmesini kontrol eder; `req.user` atar | `401 UNAUTHENTICATED` |
| `requireRole('ADMIN')` | `req.user.role === 'ADMIN'` | `403 FORBIDDEN` |
| `canViewAsset` | Admin ise geçer; USER ise cihazın **aktif** zimmet sahibi olmalı | `404 NOT_FOUND` (varlık bilgisi sızdırılmaz) |
| `validate(schema)` | Gövde / query doğrulaması (zod) | `400 VALIDATION_ERROR` |
| `loginRateLimit` | IP başına 15 dakikada 10 başarısız deneme | `429` |

Rol bilgisi JWT'den değil, her istekte **DB'deki güncel kullanıcıdan** alınır; böylece rolü düşürülen bir admin'in eski token'ı admin yetkisi taşımaz.

## 2. API izin haritası

| Uç nokta | Admin | USER | Middleware |
|----------|:-----:|:----:|-----------|
| `GET /health` | ✅ | ✅ | — |
| `POST /api/auth/login` | ✅ | ✅ | `loginRateLimit`, `validate` |
| `POST /api/auth/logout` | ✅ | ✅ | — (idempotent, yalnızca cookie'yi siler) |
| `GET /api/auth/me` | ✅ | ✅ | `authenticateAllowPasswordChange` |
| `POST /api/auth/change-password` | ✅ (kendi) | ✅ (kendi) | `passwordChangeRateLimit`, `authenticateAllowPasswordChange`, `validate` |
| `POST /api/auth/forgot-password` | ✅ | ✅ | `forgotRateLimit`, `validate` (oturum gerekmez) |
| `GET /api/setup/status`, `POST /api/setup/admin` | — | — | Oturum gerekmez; yalnızca hiç aktif yönetici yokken ve kurulum koduyla |
| `* /api/password-reset-requests/**` | ✅ | ❌ 403 | `authenticate`, `requireRole('ADMIN')` |
| `* /api/users/**` | ✅ | ❌ 403 | `authenticate`, `requireRole('ADMIN')` |
| `* /api/departments/**` | ✅ | ❌ 403 | `authenticate`, `requireRole('ADMIN')` |
| `GET /api/assets` (liste) | ✅ | ❌ 403 | `authenticate`, `requireRole('ADMIN')` |
| `GET /api/assets/:id` | ✅ tümü | ✅ yalnız kendi zimmeti, diğerleri 404 | `authenticate`, `canViewAsset` |
| `GET /api/assets/by-code/:code` | ✅ tümü | ✅ yalnız kendi zimmeti, diğerleri 404 | `authenticate`, `canViewAsset` |
| `GET /api/assets/:id/qr` | ✅ tümü | ✅ yalnız kendi zimmeti, diğerleri 404 | `authenticate`, `canViewAsset` |
| `GET /api/assets/:id/assignments` | ✅ | ❌ 403 | `authenticate`, `requireRole('ADMIN')` |
| `GET /api/assets/:id/history` | ✅ | ❌ 403 | `authenticate`, `requireRole('ADMIN')` |
| `POST/PATCH/DELETE /api/assets/**` | ✅ | ❌ 403 | `authenticate`, `requireRole('ADMIN')` |
| `POST /api/assignments` | ✅ | ❌ 403 | `authenticate`, `requireRole('ADMIN')` |
| `POST /api/assignments/:id/return` | ✅ | ❌ 403 | `authenticate`, `requireRole('ADMIN')` |
| `GET /api/assignments` | ✅ | ❌ 403 | `authenticate`, `requireRole('ADMIN')` |
| `GET /api/me/assignments` | ✅ (kendi) | ✅ (kendi) | `authenticate`; sorgu `user_id = req.user.id` ile sabitlenir |
| `GET /api/dashboard/stats` | ✅ | ❌ 403 | `authenticate`, `requireRole('ADMIN')` |
| `GET /api/audit-logs` | ✅ | ❌ 403 | `authenticate`, `requireRole('ADMIN')` |

USER'ın kendi zimmet listesinde `user_id` parametresi **gönderilse bile yok sayılır**; başka kullanıcının verisine erişim yolu yoktur (IDOR koruması).

## 3. Ekran izin haritası

| Ekran (rota) | Admin | USER | Not |
|--------------|:-----:|:----:|-----|
| Giriş `/login` | ✅ | ✅ | Giriş yapmışsa role göre yönlendirilir |
| Dashboard `/` | ✅ | ↪ | USER `/my-assets`'e yönlendirilir |
| Cihaz listesi `/assets` | ✅ | ❌ | |
| Cihaz ekle `/assets/new` | ✅ | ❌ | |
| Cihaz düzenle `/assets/:id/edit` | ✅ | ❌ | |
| Cihaz detay `/assets/:id` | ✅ tam (QR, geçmiş, işlemler) | ✅ sınırlı (bilgi + QR; geçmiş/işlem butonları yok) | Yetkisizse "Cihaz bulunamadı" |
| QR hedefi `/assets/code/:code` | ✅ | ✅ (yalnız kendi cihazı) | Girişsizse login → geri dönüş |
| Kullanıcı listesi/düzenleme `/users` | ✅ | ❌ | |
| Departmanlar `/departments` | ✅ | ❌ | Kullanıcı ekranında sekme olabilir |
| Zimmet teslim `/assignments/new` | ✅ | ❌ | Cihaz detayından da açılır |
| Zimmet listesi / iade `/assignments` | ✅ | ❌ | Detaydan "İade al" |
| Zimmetlerim `/my-assets` | ✅ | ✅ | Herkes kendi zimmetini görür |
| İşlem geçmişi `/audit` | ✅ | ❌ | |
| (Faz 2) Uyarılar, bakım, rapor | ✅ | ❌ | |

Yetkisiz ekrana doğrudan URL ile girilirse frontend "403 — Bu sayfaya erişim yetkiniz yok" sayfası gösterir; arka planda zaten API `403` döner.

## 4. PRD §3 ↔ uygulama eşleşmesi

| PRD işlevi | Admin | USER | Karşılık |
|-----------|-------|------|----------|
| Giriş / Çıkış | Tam | Tam | `/api/auth/*` |
| Kullanıcı yönetimi | Ekle/Düzenle/Sil/Şifre | Yok | `/api/users/**` (Admin) |
| Envanter CRUD | Ekle/Sil/Düzenle/Pasife al | Yok | `/api/assets` yazma uçları (Admin) |
| Zimmet & iade | Teslim/İade | Yok | `/api/assignments/**` (Admin) |
| Dashboard | Tümü | Yok | `/api/dashboard/stats` (Admin) |
| Zimmetli cihaz takibi | Tüm cihazlar | Kendi cihazları | `/api/assignments` (Admin) · `/api/me/assignments` (herkes, kendi) |
| Cihaz detayı & QR | Tüm cihazlar | Yetkili olduğu cihazlar | `canViewAsset` = aktif zimmet sahibi |

## 5. Admin kendini koruma kuralları

- Admin kendi hesabını silemez, pasife alamaz, rolünü `USER`'a düşüremez (`409 CANNOT_MODIFY_SELF`). Böylece sistem admin'siz kalmaz.
- Son aktif admin'in rolü düşürülemez / pasife alınamaz.
