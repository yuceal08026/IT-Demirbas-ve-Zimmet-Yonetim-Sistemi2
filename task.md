# IT Demirbaş ve Zimmet Yönetim Sistemi — Görev Listesi

**Kaynak:** [PRD.md](./PRD.md)  
**Teknoloji:** React, Node.js/Express, PostgreSQL, JWT, Docker Compose (mobil opsiyonel)

---

## Çalışma kuralları

- [x] Projeyi tek seferde değil, aşama aşama geliştir.
- [x] Her aşamaya başlamadan önce yapılacakları ve etkilenecek dosyaları netleştir.
- [x] Yetkilendirme yalnızca arayüzde değil, backend middleware ile doğrulansın.
- [x] Aşama 1 (tasarım) onaylanmadan uygulama koduna geçilmesin.
- [x] Her aşama sonunda: **Tamamlanan / Kalan / Sıradaki adım** notu düş.

---

## PRD zorunlu gereksinim kontrol listesi (Faz 1)

PRD §4.1 — tamamlandıkça işaretle:

- [x] Login / Logout
- [x] JWT oturum yönetimi; parolalar bcrypt/hash ile saklanır
- [x] Responsive arayüz (masaüstü, tablet, mobil)
- [x] Listelerde sayfalama, arama, sıralama
- [x] Toast / Snackbar bildirimleri
- [x] Admin: kullanıcı ekle / düzenle / sil veya pasife al / şifre yönetimi
- [x] Dashboard: toplam cihaz, arızalı, boşta (depoda) — gerçek veri
- [x] Cihaz CRUD (marka, model, seri no, alım tarihi vb.)
- [x] Otomatik benzersiz QR kod / barkod
- [x] Zimmet teslim ve iade; geçmiş kayıtlar korunur
- [x] İş kuralı: aynı cihaz aynı anda iki aktif zimmette olamaz
- [x] İade sonrası cihaz IN_STOCK (boşta/depoda) ve yeniden zimmetlenebilir
- [x] Filtre: durum (ACTIVE, DEFECTIVE, IN_STOCK), departman, kullanıcı
- [x] Personel: sadece kendi zimmetleri ve yetkili cihaz detayı

---

## Veri modeli hızlı referans (PRD §5.2)

| Tablo | Önemli alanlar |
|--------|----------------|
| Users | role (ADMIN/USER), department_id, password_hash, is_active |
| Departments | name |
| Assets | asset_code (unique/QR), serial_number (unique), status, warranty_end_date |
| Assignments | asset_id, user_id, assigned_by, assigned_at, returned_at |
| AuditLogs | action_type, entity_type, entity_id, user_id, timestamp |
| MaintenanceRecords | (Faz 2) asset_id, issue_description, status, solution_note |

---

## Önerilen ekranlar

- [x] Giriş
- [x] Admin dashboard
- [x] Cihaz listesi (arama, filtre, sayfalama)
- [x] Cihaz ekle / düzenle
- [x] Cihaz detay (QR + geçmiş)
- [x] Kullanıcı listesi ve düzenleme (Admin)
- [x] Zimmet teslim
- [x] Zimmet iade
- [x] Personel — zimmetlerim
- [x] İşlem geçmişi / audit (Admin)
- [x] (Faz 2) Uyarı merkezi, bakım, raporlama

---

## Aşama 1 — Analiz, tasarım ve ERD

**Tamamlanma ölçütü:** ERD ve API listesi onaylanmadan kod yazımına geçilmez.

### Gereksinim ve roller

- [x] PRD §4.1 maddelerini yukarıdaki checklist ile eşleştir; eksik madde bırakma
- [x] PRD §3 yetki matrisini ekran + API izin haritasına dönüştür (Admin / USER)

### Veritabanı

- [x] ERD çiz (Users, Departments, Assets, Assignments, AuditLogs)
- [x] Foreign key ve indeks planı
- [x] Unique: `Assets.asset_code`, `Assets.serial_number`
- [x] Assets.status enum: ACTIVE, DEFECTIVE, IN_STOCK
- [x] Aktif zimmet kuralı: asset başına en fazla bir `returned_at IS NULL` (constraint veya transaction + unique partial index)
- [x] MaintenanceRecords tablosunu Faz 2 için taslakta bırak

### API tasarımı

- [x] Auth: login, logout, me (JWT)
- [x] Users CRUD + şifre güncelleme (Admin)
- [x] Departments list/create (gerekirse)
- [x] Assets CRUD + list (pagination, search, sort, filter)
- [x] Assignments: assign, return, history
- [x] Dashboard: stats (counts)
- [x] AuditLogs: list (filtre)
- [x] QR: asset_code veya id ile public/authorized lookup

### Güvenlik planı

- [x] JWT süresi, secret env’de
- [x] `authenticate` + `requireRole('ADMIN')` middleware listesi
- [x] Şifre ve token’ların log/commit’e girmemesi

**Test notu:** Tasarım dokümanı PRD §7 ile uyumlu mu kontrol et.

---

## Aşama 2 — Proje kurulumu ve sağlık kontrolü

**Tamamlanma ölçütü:** Frontend ve backend yerelde çalışır; veritabanı bağlantısı doğrulanır.

- [x] Klasör yapısı: `frontend/` + `backend/` (veya monorepo — seçimi README’de yaz)
- [x] Backend: Express, PostgreSQL bağlantısı
- [x] Frontend: Vite + React; Tailwind veya Bootstrap
- [x] `.env.example`, `.gitignore` (`.env`, node_modules, build)
- [x] `GET /health` (isteğe bağlı DB ping)
- [x] Git deposu başlat
- [x] Docker Compose: PostgreSQL servisi (api/web Aşama 8’de tamamlanır)
- [x] README iskeleti (kurulum başlıkları)

**Test notu:** `health` 200; FE dev server açılır; DB migration/connection hatasız.

---

## Aşama 3 — Auth ve kullanıcı yönetimi

**Tamamlanma ölçütü:** Yetkisiz kullanıcı korunan API’lere erişemez; roller test edilir.

### Backend

- [x] Migration: Users, Departments
- [x] Seed: en az bir ADMIN kullanıcı
- [x] Login → JWT; logout (client + opsiyonel blacklist yoksa dokümante et)
- [x] bcrypt ile password_hash
- [x] Middleware: authenticate, requireAdmin
- [x] Admin: kullanıcı listele, oluştur, güncelle, pasifle/sil, şifre sıfırla

### Frontend

- [x] Login / Logout sayfası
- [x] Token saklama stratejisi (header veya httpOnly cookie — dokümante)
- [x] Korunan route’lar; Admin-only sayfalar
- [x] Kullanıcı yönetim paneli (rol, departman, aktif)
- [x] Hata/başarı toast

**Test notu (PRD §7):** Standart USER admin endpoint’lerinde 403; hatalı parola ile giriş reddedilir.

---

## Aşama 4 — Envanter ve QR kod

**Tamamlanma ölçütü:** Cihaz kayıtları kalıcı; mükerrer seri/kod engellenir.

### Backend

- [x] Assets CRUD; pasife alma (`is_active`)
- [x] Otomatik `asset_code` üretimi
- [x] QR üretimi (görsel veya `/assets/by-code/:code` URL)
- [x] Liste: pagination, search, sort
- [x] Filtre: status, department, kullanıcı (zimmet ilişkisi)

### Frontend

- [x] Cihaz listesi tablosu
- [x] Ekle / düzenle formu + client validasyon
- [x] Cihaz detay + QR gösterimi
- [x] Sadece Admin envanter CRUD

**Test notu (PRD §7):** Aynı seri no veya asset_code ile ikinci kayıt reddedilir; QR doğru cihaza gider.

---

## Aşama 5 — Zimmet ve log altyapısı

**Tamamlanma ölçütü:** Çakışan aktif zimmet oluşturulamaz; teslim/iade geçmişi korunur.

### Backend

- [x] Assign: uygun status (ör. IN_STOCK), `assigned_by`, `assigned_at`
- [x] Return: `returned_at`, asset → IN_STOCK
- [x] Aktif zimmet çakışması engeli
- [x] AuditLogs: assign, return, asset/user değişiklikleri
- [x] Geçmiş sorguları; audit silme/güncelleme API’si yok

### Frontend

- [x] Zimmet teslim ekranı (cihaz + personel)
- [x] İade akışı (listeden veya detaydan)
- [x] Personel: Zimmetlerim
- [x] Personel: yetkili cihaz detayı

**Test notu (PRD §7):** Aktif zimmetli cihaz iade alınmadan başkasına verilemez; iade sonrası yeniden zimmet mümkün; geçmiş korunur.

---

## Aşama 6 — Dashboard ve responsive UI

**Tamamlanma ölçütü:** İstatistikler DB ile tutarlı; arayüz mobil/tablet/masaüstünde kullanılabilir.

- [x] Dashboard API: COUNT toplam, DEFECTIVE, IN_STOCK (gerçek sorgular)
- [x] Admin dashboard kartları
- [x] Ana layout: navigasyon, mobil menü
- [x] Responsive tablolar ve formlar
- [x] Global toast/snackbar; loading ve empty state
- [x] Tüm listelerde pagination + arama tutarlılığı

**Test notu (PRD §7):** Dashboard sayıları DB ile birebir; arama + filtre + sayfalama birlikte çalışır.

---

## Aşama 7 — İleri özellikler ve testler (Faz 2)

**Tamamlanma ölçütü:** Her ek özellik gerçek veriyle çalışır; PRD §7 senaryoları geçer.

### Akıllı demirbaş kontrol merkezi (PRD §4.2)

- [x] Garanti süresi yaklaşan cihazlar (`warranty_end_date`)
- [x] Uzun süredir IN_STOCK cihazlar
- [x] Eksik / çelişkili kayıt uyarıları
- [x] Uyarıdan cihaz detayına geçiş
- [x] Uyarılar sabit/sahte değil, DB’den üretilir

### Detaylı cihaz zaman çizelgesi

- [x] Audit + assignment birleşik kronoloji UI
- [x] İşlemi yapan kullanıcı ve tarih görünür
- [x] Geçmiş kayıtlar kullanıcı CRUD ile değiştirilemez

### Arıza ve bakım

- [x] MaintenanceRecords migration
- [x] Arıza oluştur, durum güncelle, çözüm notu, kapat
- [x] Cihaz başına birden fazla arıza kaydı
- [x] Cihaz detayda bakım geçmişi

### Raporlama

- [x] Filtre: durum, departman, tarih aralığı
- [x] CSV dışa aktarma
- [x] (Opsiyonel) PDF export

### Test paketi

- [x] PRD §7 — yetki ihlali engeli
- [x] PRD §7 — mükerrer kayıt koruması
- [x] PRD §7 — çakışan zimmet engeli
- [x] PRD §7 — veri tutarlılığı (dashboard)
- [x] Geçersiz/eksik form backend’de reddedilir
- [x] Gizli bilgiler log ve repoda yok

---

## Aşama 8 — Teslimat

**Tamamlanma ölçütü:** Sıfır ortamda `docker-compose up` ile sistem ayağa kalkar; README yeterli.

- [x] README: proje özeti, tech stack, kurulum, env değişkenleri, seed admin
- [x] Ekran görüntüleri
- [x] Docker Compose: postgres + api + frontend (veya nginx)
- [ ] `docker-compose up` uçtan uca doğrula (PRD §7) — *Docker'ın çalıştığı bir makinede yapılmalı; aşağıdaki nota bakın*
- [ ] Public GitHub/GitLab; `.env` commit edilmemiş — *depo hazır (`.env` yok, `.gitignore` doğru); GitHub'a gönderme sizde*
- [x] Zorunlu PRD checklist’inin tamamı işaretli

---

## Aşama 9 — Mobil uygulama (opsiyonel / Faz 3)

**Tamamlanma ölçütü:** Web backend API ile entegre; zorunlu web kapsamı bitmiş olmalı.

- [ ] React Native veya Flutter proje seçimi ve kurulum
- [ ] JWT ile mobil login
- [ ] Kamera ile QR okuma → cihaz detay
- [ ] Saha: teslim / iade / arıza bildirimi (yetkili kullanıcı)
- [ ] Personel: kişisel zimmet listesi

---

## Kabul testleri özeti (PRD §7)

| Senaryo | İlgili aşama |
|---------|----------------|
| Standart kullanıcı Admin API → erişemez | 3 |
| Hatalı parola → giriş yok | 3 |
| Aynı seri no / cihaz kodu → ikinci kayıt yok | 4 |
| Aktif zimmet varken başkasına zimmet yok | 5 |
| İade sonrası yeniden zimmet | 5 |
| Geçmiş teslim/iade korunur | 5 |
| Dashboard sayıları = DB | 6 |
| Arama + filtre + sayfalama | 4, 6 |
| Backend form validasyonu | 3–5 |
| QR doğru cihaz | 4 |
| docker-compose eksiksiz kurulum | 8 |
| Şifre/token sızıntısı yok | 2, 3, 8 |

---

## Aşama ilerleme notları

Her aşama bittiğinde doldur:

### Aşama 1

- **Tamamlanan:** `docs/ERD.md` (Mermaid ERD, durum makinesi, FK/indeks planı), `docs/schema.sql` (PostgreSQL 16'da kurulup kısıtlar test edildi: mükerrer seri no/e-posta, çakışan zimmet, iade sonrası yeniden zimmet, audit log değiştirilemezliği), `docs/API.md`, `docs/PERMISSIONS.md`, `docs/SECURITY.md`
- **Kalan:** Tasarım onayı (veya revizyon)
- **Sıradaki adım:** Aşama 2 ✓ (tasarım onaylandı)

### Aşama 2

- **Tamamlanan:** `backend/` (Express 5, pg havuzu, transaction yardımcısı, bağımlılıksız migration aracı, merkezi hata yönetimi, `GET /health` + DB ping), `frontend/` (Vite + React 19 + Tailwind v4, tasarım belirteçleri, bağımlılıksız router, API istemcisi, toast), `.env.example` (kök + backend), `.gitignore`, `docker-compose.yml` (postgres), README iskeleti, git deposu. Seçim: ayrı `backend/` + `frontend/` klasörleri (README'de yazıyor).
- **Doğrulama:** `/health` → 200 `{status:ok, db:ok}`; bilinmeyen yol → JSON 404; 32 karakterden kısa `JWT_SECRET` ile API başlamıyor.
- **Kalan:** —
- **Sıradaki adım:** Aşama 3 — Auth ve kullanıcı yönetimi

### Aşama 3

- **Tamamlanan:** Migration'lar (`001` kullanıcı/departman/audit, `002` cihaz, `003` zimmet — Aşama 1'de onaylanan şemanın tamamı; kullanıcı silme/pasife alma kuralları zimmet tablosuna baktığı için birlikte eklendi), seed (admin + isteğe bağlı örnek veri), JWT login/logout/me, httpOnly + SameSite=Strict cookie, mobil için `issueToken`, `token_version` ile anında oturum iptali, `authenticate` / `requireAdmin` / `requireJsonBody` / login rate limit, kullanıcı ve departman API'leri (arama, filtre, sıralama, sayfalama), son yönetici ve kendini değiştirme korumaları. Arayüz: giriş, kenar menülü layout (mobil açılır menü), Personel ve Departmanlar sayfaları, toast, 403/404 sayfaları.
- **Token stratejisi:** Web'de token httpOnly cookie'de (JS erişemez); logout cookie'yi siler; şifre sıfırlama / pasife alma / rol değişimi `token_version`'ı artırıp tüm eski token'ları geçersiz kılar (blacklist gerekmez). Ayrıntı: `docs/SECURITY.md`.
- **Doğrulama:** 23 otomatik test geçti (standart kullanıcı tüm admin uçlarında 403, hatalı parola 401, rate limit 429, CSRF 415, SQL enjeksiyon denemesi, mükerrer e-posta 409 vb.). Ekran görüntüleri masaüstü + mobilde alındı.
- **Kalan:** —
- **Sıradaki adım:** Aşama 4 — Envanter ve QR kod

### Aşama 4

- **Tamamlanan:** Cihaz CRUD + pasife alma, durum değişikliği (Arızalı ↔ Depoda; `ACTIVE` yalnızca zimmetle oluşur), `IT-YYYY-NNNNNN` kod üretimi (sequence), QR (PNG/SVG, indirme, içerik `APP_BASE_URL/assets/code/<kod>`), liste: arama (kod/seri/marka/model/kişi) + çoklu durum + kategori + departman + kullanıcı + aktiflik filtresi, beyaz listeli sıralama, sayfalama. Personel yalnızca kendi zimmetindeki cihazı görür (diğerleri 404, yönetici notu gizli). Arayüz: cihaz listesi (mobilde kart), ekle/düzenle formu (istemci doğrulaması), cihaz detayı (kimde, bilgiler, QR, etiket yazdırma, işlem menüsü), `/assets/code/:kod` QR hedefi.
- **Karar:** Seri numaraları büyük harfe çevrilerek saklanır; böylece `abc-123` ve `ABC-123` aynı cihaz sayılır.
- **Doğrulama:** 11 yeni test (mükerrer seri no/kod 409, form doğrulaması, arama+filtre+sayfalama, departman/kullanıcı filtresi, personel yetki sınırı, QR → doğru cihaz) — toplam 34 test geçti.
- **Kalan:** —
- **Sıradaki adım:** Aşama 5 — Zimmet ve log altyapısı

### Aşama 5

- **Tamamlanan:** Zimmet teslim (cihaz satır kilidi + IN_STOCK kontrolü + partial unique index; pasif kullanıcı/cihaz reddi), iade (sağlam → IN_STOCK, arızalı → DEFECTIVE), zimmet listesi (aktif/iade/tümü, arama, departman, tarih aralığı), `/api/me/assignments` (sorgu her zaman giriş yapan kullanıcıya sabit), cihaz zimmet geçmişi ve zaman çizelgesi, işlem geçmişi API'si (yalnızca okuma). Zimmet kayıtları ve audit log'lar DB trigger'larıyla korunuyor (silinemez; iade dışında değiştirilemez). Arayüz: Zimmetler sayfası, Zimmetle / İade al pencereleri (aranabilir cihaz ve personel seçimi), Zimmetlerim, İşlem geçmişi, cihaz detayında zimmet geçmişi + zaman çizelgesi.
- **Doğrulama:** 10 yeni test — aynı cihaza 8 eşzamanlı zimmet isteğinden yalnızca 1'i başarılı; iade sonrası yeniden zimmet; geçmiş korunuyor; personel 403 / IDOR koruması; audit ve zimmet kayıtları SQL ile bile silinemiyor. Toplam 44 test geçti. Arayüzde uçtan uca zimmet → iade akışı denendi.
- **Kalan:** —
- **Sıradaki adım:** Aşama 6 — Dashboard ve responsive UI

### Aşama 6

- **Tamamlanan:** `GET /api/dashboard/stats` (canlı `COUNT ... FILTER` sorguları, önbellek yok; kategori ve departman dağılımı, son cihaz hareketleri, uyarı özeti). Dashboard: toplam cihaz + Zimmetli/Depoda/Arızalı oran bandı (her parça filtreli listeye gider), dikkat gerektirenler, son hareketler, kategoriye göre yığılmış çubuk (tablo görünümü ile), departmanlara göre zimmet. Grafik renkleri renk körlüğü doğrulayıcısından geçirildi (ilk durum renkleri başarısız olduğu için ayrı bir grafik seti seçildi). Mobil menü, mobilde tablo → kart dönüşümü, yükleniyor/boş durumları tüm listelerde.
- **Doğrulama:** Dashboard sayıları her işlemden (ekleme, arıza, zimmet, pasife alma, arızalı iade) sonra doğrudan SQL sayımıyla birebir karşılaştırıldı; `toplam = zimmetli + depoda + arızalı` her adımda doğru. Masaüstü, tablet ve mobil ekran görüntüleri alındı.
- **Kalan:** —
- **Sıradaki adım:** Aşama 7 — İleri özellikler ve testler

### Aşama 7

- **Tamamlanan:** Akıllı kontrol merkezi (6 kural, hepsi canlı SQL; eşikler env ile ayarlanabilir; uyarıdan cihaz detayına geçiş), cihaz zaman çizelgesi (audit + zimmet + bakım tek kronolojide, işlemi yapan ve tarih görünür), arıza/bakım kayıtları (`004_maintenance.sql`; aç, işleme al, çözüm notuyla kapat, kapanan kayıt kilitli, cihaz başına çoklu kayıt, kapanışta depoya alma), raporlar (envanter + zimmet; durum/departman/kategori/tarih aralığı filtresi; CSV indirme; tarayıcıdan yazdır/PDF).
- **PDF notu:** Ayrı bir PDF kütüphanesi eklenmedi; rapor sayfası yazdırma için biçimlendirildi ve tarayıcının "PDF olarak kaydet" seçeneğiyle PDF alınır.
- **Doğrulama:** Toplam 60 otomatik test geçti. PRD §7'nin dört senaryosu (yetki ihlali, mükerrer kayıt, çakışan zimmet, dashboard tutarlılığı), geçersiz/eksik form reddi ve gizli bilgi sızıntısı testleri (yanıtlarda hash yok, audit'te parola yok, stack trace dönmüyor) bunlara dahil. Bakım akışı ve CSV indirme arayüzden uçtan uca denendi.
- **Kalan:** —
- **Sıradaki adım:** Aşama 8 — Teslimat (Docker, README)

### Aşama 8

- **Tamamlanan:** `backend/Dockerfile` (root olmayan kullanıcı, healthcheck, açılışta migration + seed + API), `frontend/Dockerfile` (Vite derleme + nginx), `frontend/nginx.conf` (SPA yönlendirme, `/api` ters vekil, güvenlik başlıkları, statik dosya önbelleği), `docker-compose.yml` (db + api + web; DB portu dışarı kapalı; `.env` olmadan da çalışır), `docker-compose.dev.yml` (yerel geliştirme/test için DB portu), README (özet, teknoloji, kurulum, env tablosu, demo hesaplar, oturum stratejisi, testler, PRD §7 eşleşmesi, ekran görüntüleri), `docs/screenshots/`.
- **Güvenlik kararı:** `JWT_SECRET` örnek dosyalarda boş; tanımsızsa API rastgele anahtar üretir (bilinen bir varsayılanla çalışma riski yok).
- **Doğrulama:** `docker compose config` geçerli. Konteyner açılış komutu (`migrate → seed → server`) `NODE_ENV=production` ile boş veritabanında birebir çalıştırıldı; ikinci çalıştırmada veri çoğalmadı. 60 backend testi geçti. Tüm ekranlar yönetici ve personel olarak gezildi, tarayıcı hatası yok.
- **Kalan:** Bu geliştirme ortamında Docker daemon ve npm kayıt sunucusu erişimi olmadığından gerçek `docker compose up --build` ve `npm install` burada çalıştırılamadı. İlk çalıştırmayı Docker kurulu bir makinede yapıp oluşan `package-lock.json` dosyalarını commit edin. Public depoya gönderme.
- **Sıradaki adım:** (Opsiyonel) Aşama 9 — Mobil uygulama

---

## Bakım: demo verinin kaldırılması ve güvenlik sıkılaştırması (2026-10)

- Örnek (demo) veri yükleme tamamen kaldırıldı; uygulama boş veritabanıyla başlar. `SEED_DEMO_DATA` yok sayılır.
- Varsayılan yönetici parolası kaldırıldı. İlk yönetici: `npm run create-admin` (veya bir kez `INITIAL_ADMIN_*`). Var olan kullanıcı sessizce yöneticiye yükseltilmez.
- Üretimde eksik/zayıf `JWT_SECRET`, bilinen veritabanı parolası, https'te güvensiz cookie veya varsayılan parolalı yönetici varsa API başlamaz. Compose `.env` olmadan başlamaz.
- `005_password_change.sql`: geçici parola (`must_change_password`); `POST /api/auth/change-password`; arayüzde "Parolamı değiştir" ve zorunlu ilk parola ekranı.
- Eski kurulumlarda veri silinmeden: demo personel parolası geçersiz kılınır, varsayılan parolalı yönetici için kurtarma komutu önerilir.
- Saat dilimi düzeltmesi: "bugün" ve tarih filtreleri kurum saatine göre (`APP_TIMEZONE`); başlangıç > bitiş tarih aralıkları anlaşılır hatayla reddedilir.
- `TRUST_PROXY` varsayılanı: yalnızca yerel/özel ağ vekilleri.
- Yeni testler: `setup-security.test.js`, `password-change.test.js`, `integrity.test.js`.
- Giriş ekranı: "Personel girişi" / "Yönetici girişi" sekmeleri (yanlış sekmede `WRONG_PORTAL`), "Şifremi unuttum" → yöneticiye talep (`006_password_reset_requests.sql`), tarayıcıdan ilk kurulum ekranı (sunucu kayıtlarındaki tek kullanımlık kodla). Test: `login-reset-setup.test.js`.
- Kendi kendine kayıt (yalnızca kurum alan adı, yönetici onaylı) ve e-postasız parola kurtarma (kurtarma kodu) (`007_registration_recovery.sql`). Test: `register-recover.test.js`.
