# Güvenlik Planı — Aşama 1

## 1. Parolalar

- `bcrypt` (Node: `bcryptjs`), **cost = 12**. Veritabanında yalnızca `password_hash` tutulur.
- Politika: en az 8 karakter, en az bir harf ve bir rakam; eski sürümlerde varsayılan olarak kullanılan (`Admin12345`, `Personel123`) ve çok yaygın parolalar reddedilir. İlk yönetici için en az 12 karakter. Backend'de doğrulanır (frontend sadece ön kontrol).
- Yöneticinin verdiği veya sıfırladığı parola **geçicidir** (`users.must_change_password`): kullanıcı giriş yapabilir ama parolasını değiştirene kadar `/api/auth/me` ve `/api/auth/change-password` dışındaki tüm uçlar `403 PASSWORD_CHANGE_REQUIRED` döner.
- Her kullanıcı `POST /api/auth/change-password` ile kendi parolasını değiştirir (mevcut parola zorunlu, ayrı hız sınırı); başarılı olunca diğer tüm oturumları kapanır.
- Login'de kullanıcı bulunamasa bile sahte bir hash ile `bcrypt.compare` çalıştırılır → yanıt süresinden e-posta varlığı anlaşılmaz.
- Hata mesajı her durumda aynıdır: "E-posta veya parola hatalı".

## 2. JWT

| Ayar | Değer |
|------|-------|
| Algoritma | `HS256` (doğrulamada algoritma sabitlenir, `none` kabul edilmez) |
| Secret | `JWT_SECRET` ortam değişkeni, ≥ 32 karakter. Kısaysa uygulama **başlamaz**. Üretimde (`NODE_ENV=production`) tanımsız veya yer tutucu bir değerse uygulama **başlamaz**; yalnızca geliştirme ortamında tanımsızsa geçici rastgele anahtar üretilir |
| Süre | `JWT_EXPIRES_IN`, varsayılan `8h` (bir mesai günü) |
| Payload | `{ sub: userId, role, tv: token_version }` — kişisel veri yok |

**Taşıma:**
- **Web:** Token `httpOnly; SameSite=Strict; Path=/` cookie'de (HTTPS arkasında `COOKIE_SECURE=true` ile `Secure` bayrağı da eklenir). JavaScript erişemez → XSS ile token çalınamaz. Frontend ve API aynı origin'den sunulur (dev'de Vite proxy, prod'da nginx), bu yüzden CORS gerekmez.
- **Mobil (Faz 3) / API istemcileri:** Login yanıtındaki `token` alanı `Authorization: Bearer` ile gönderilir. `authenticate` önce başlığa, sonra cookie'ye bakar.
- **CSRF:** `SameSite=Strict` + API yalnızca `application/json` gövde kabul eder (form-POST ile tetiklenemez).

**Oturum iptali (logout & token geçersizleştirme):**
- Logout cookie'yi siler.
- Blacklist tutulmaz; bunun yerine `users.token_version` kullanılır. Şifre sıfırlama, pasife alma ve rol değişikliğinde sürüm artırılır → o kullanıcının tüm eski token'ları bir sonraki istekte `401` olur.
- Her istekte kullanıcı DB'den okunur (`is_active`, `role`, `token_version`). Ek maliyet tek bir PK sorgusu; karşılığında anında iptal ve güncel rol kontrolü.
- Bilinen sınır: Bearer kullanan istemcide logout yalnızca istemci tarafında token'ı silmektir; token süresi dolana kadar geçerlidir (bu README'de belirtilecek).

## 3. Middleware listesi

`helmet` (güvenlik başlıkları) → `express.json({ limit: '100kb' })` → `cookieParser` → route bazında: `loginRateLimit`, `authenticate`, `requireRole('ADMIN')`, `canViewAsset`, `validate(zodSchema)` → merkezi `errorHandler`.

Ayrıntılı uç-middleware eşleşmesi: [PERMISSIONS.md](./PERMISSIONS.md).

## 4. Girdi güvenliği

- Tüm SQL sorguları parametreli (`pg` `$1, $2`). Sıralama alanları **beyaz liste** ile seçilir; kullanıcı girdisi asla SQL'e string olarak eklenmez.
- Tüm gövde ve query parametreleri `zod` şemalarıyla doğrulanır; bilinmeyen alanlar atılır (`strip`), böylece `role`, `asset_code`, `status` gibi alanlar yanlış uçtan değiştirilemez (mass assignment koruması).
- `id` parametreleri pozitif tamsayı olarak doğrulanır.

## 5. Gizli bilgilerin log ve repoya girmemesi

- `.env` `.gitignore`'da; repoda yalnızca `.env.example` (sahte değerlerle).
- Varsayılan yönetici hesabı veya parolası **yoktur**; örnek (demo) veri yüklenmez. İlk yönetici iki yoldan biriyle oluşturulur:
  1. `npm run create-admin -- --email ... --name "..."` (önerilen): parola ekranda gösterilmeden sorulur, hiçbir dosyaya yazılmaz.
  2. `INITIAL_ADMIN_EMAIL` + `INITIAL_ADMIN_PASSWORD` (≥ 12 karakter): yalnızca hiç aktif yönetici yokken bir kez kullanılır; sonrasında `.env`'den silinmesi loglarla hatırlatılır.
- Kurulum betiği var olan bir kullanıcıyı **sessizce yöneticiye yükseltmez**; bu yalnızca sunucuda `create-admin --reset` ile bilinçli olarak yapılır (parolasını unutan yöneticinin kurtarılması da bu komutladır).
- Eski sürümden yükseltilen kurulumlar için (veri silinmeden): bilinen demo personel parolası (`Personel123`) geçersiz kılınır; varsayılan parolalı (`Admin12345` vb.) aktif yönetici varsa üretimde uygulama başlamaz ve `create-admin --reset` komutu önerilir.
- HTTP istek logları (`morgan`) gövde içermez; `Authorization` ve `Cookie` başlıkları loglanmaz.
- `errorHandler` 500 hatalarında stack trace'i istemciye dönmez; sunucu logunda tutar.
- Audit log `details` alanına parola/hash/token yazılmaz (servis katmanında `sanitize` yardımcı fonksiyonu).
- API yanıtlarında `password_hash` ve `token_version` hiçbir zaman dönmez (SELECT'lerde açık sütun listesi).

## 5a. Kayıt ve e-postasız parola kurtarma

- Kendi kendine kayıt yalnızca `REGISTRATION_EMAIL_DOMAINS` alan adlarıyla ve yönetici onayıyla; kayıt olan herkes `USER` rolündedir.
- E-posta gönderilmediği için "şifremi unuttum" **kurtarma kodu** ile çalışır: 16 karakter (~79 bit) rastgele kod, bcrypt özeti olarak saklanır, tek kullanımlıktır, IP başına deneme sınırı vardır; hatalı kod ile bilinmeyen e-posta aynı yanıtı verir. Kodu ve e-postayı bilen kişi parolayı değiştirebileceği için kullanıcıya kodu gizli tutması söylenir.
- Kodu kaybeden kullanıcı için yedek yol yönetici talebidir (geçici parola).

## 6. Üretimde zorunlu ayarlar (fail fast)

`NODE_ENV=production` iken aşağıdakilerden biri eksik/hatalıysa API başlamaz ve nedenini loglar:
- `JWT_SECRET` tanımlı, ≥ 32 karakter, yer tutucu değil.
- Veritabanı parolası boş veya bilinen bir varsayılan (`zimmet-local-dev`, `postgres` …) değil.
- `APP_BASE_URL` https ise `COOKIE_SECURE=true`.
- `BCRYPT_ROUNDS` ≥ 10.
Docker Compose da `POSTGRES_PASSWORD` ve `JWT_SECRET` tanımlanmadan başlamaz.

## 7. Diğer

- Login rate limit: IP başına 15 dakikada 10 başarısız deneme (`express-rate-limit`); parola değiştirme için ayrı sayaç.
- `TRUST_PROXY` varsayılanı yalnızca yerel/özel ağdaki vekillere güvenir; API doğrudan dışarı açılsa bile `X-Forwarded-For` ile hız sınırı atlatılamaz.
- Docker'da API konteyneri root olmayan kullanıcıyla çalışır; PostgreSQL portu yalnızca iç ağda açık (Aşama 8).
- QR kod içeriği yalnızca bir URL'dir; kimlik bilgisi içermez. URL açıldığında normal oturum + yetki kontrolü uygulanır.
