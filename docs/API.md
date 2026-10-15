# REST API Tasarımı — Aşama 1

Temel yol: `/api` · Biçim: JSON (`Content-Type: application/json`) · Kimlik: JWT (bkz. [SECURITY.md](./SECURITY.md))

Yetki kısaltmaları: **Herkes** = giriş yapmamış dahil · **Auth** = giriş yapmış her kullanıcı · **Admin** = `role=ADMIN` · **Sahip** = cihazın aktif zimmet sahibi.

## 0. Ortak kurallar

### Sayfalı liste yanıtı
```json
{
  "data": [ ... ],
  "meta": { "page": 1, "limit": 20, "total": 137, "totalPages": 7 }
}
```
Ortak sorgu parametreleri: `page` (≥1, varsayılan 1), `limit` (1–100, varsayılan 20), `search`, `sort` (izinli alan listesi — beyaz liste dışı değer `400`), `order` (`asc` | `desc`).

### Hata yanıtı
```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Seri numarası zorunludur", "details": [{ "field": "serial_number", "message": "..." }] } }
```

| HTTP | `code` | Ne zaman |
|------|--------|----------|
| 400 | `VALIDATION_ERROR` | Eksik/geçersiz alan, beyaz liste dışı sıralama alanı |
| 401 | `UNAUTHENTICATED` | Token yok, süresi dolmuş, geçersiz, kullanıcı pasif |
| 401 | `INVALID_CREDENTIALS` | Hatalı e-posta/parola (hangisinin yanlış olduğu söylenmez) |
| 403 | `FORBIDDEN` | Rol yetersiz (USER → Admin endpoint) |
| 404 | `NOT_FOUND` | Kayıt yok **veya** USER'ın görme yetkisi olmayan cihaz (varlık bilgisi sızdırılmaz) |
| 409 | `DUPLICATE_SERIAL_NUMBER`, `DUPLICATE_ASSET_CODE`, `DUPLICATE_EMAIL`, `DUPLICATE_DEPARTMENT` | Benzersizlik ihlali |
| 409 | `ASSET_ALREADY_ASSIGNED` | Aktif zimmetli cihaza yeni zimmet |
| 409 | `ASSET_NOT_AVAILABLE` | Cihaz `IN_STOCK` değil veya pasif |
| 409 | `USER_INACTIVE` | Pasif kullanıcıya zimmet |
| 409 | `ASSIGNMENT_ALREADY_RETURNED` | Zaten iade edilmiş zimmet |
| 409 | `HAS_ACTIVE_ASSIGNMENTS` | Zimmetli cihaz/kullanıcıyı silme, pasife alma, durum değiştirme |
| 409 | `HAS_HISTORY` | Geçmişi olan kaydı fiziksel silme (pasife alma önerilir) |
| 409 | `CANNOT_MODIFY_SELF` | Admin'in kendini silmesi / pasife alması / rolünü düşürmesi |
| 409 | `LAST_ADMIN` | Son aktif yöneticinin pasife alınması / silinmesi / rolünün düşürülmesi |
| 409 | `HAS_USERS` | Personeli olan departmanın silinmesi |
| 413 | `PAYLOAD_TOO_LARGE` | 100 KB'tan büyük gövde |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | POST/PATCH gövdesi `application/json` değil (CSRF koruması) |
| 429 | `TOO_MANY_REQUESTS` | Login rate limit |
| 500 | `INTERNAL_ERROR` | Beklenmeyen hata (ayrıntı istemciye dönülmez) |

---

## 1. Sağlık kontrolü

| Metot | Yol | Yetki | Açıklama |
|-------|-----|-------|----------|
| GET | `/health` | Herkes | `200 {"status":"ok","db":"ok"}`; DB erişilemezse `503 {"status":"degraded","db":"down"}` |

## 2. Kimlik doğrulama — `/api/auth`

| Metot | Yol | Yetki | Gövde / Yanıt |
|-------|-----|-------|---------------|
| POST | `/api/auth/login` | Herkes (rate limited) | `{email, password, issueToken?}` → `200 {user, expiresIn}` + `httpOnly` cookie. `issueToken: true` (mobil/API istemcisi) gönderilirse yanıta `token` da eklenir; web istemcisi token'ı hiç görmez. Pasif kullanıcı → `401 INVALID_CREDENTIALS` |
| POST | `/api/auth/logout` | Herkes (idempotent) | Cookie temizlenir → `204` |
| GET | `/api/auth/me` | Auth (parola değişikliği bekleyen kullanıcı da) | `{id, ad_soyad, email, role, department, must_change_password}` |
| POST | `/api/auth/change-password` | Auth (parola değişikliği bekleyen kullanıcı da; ayrı rate limit) | `{current_password, new_password}` → `200 {user}` + yeni cookie (Bearer ile çağrıldıysa gövdede yeni `token`). Diğer tüm oturumlar kapanır. Hatalı mevcut parola / zayıf / aynı parola → `400` |

| POST | `/api/auth/forgot-password` | Herkes (rate limited) | `{email}` → her durumda `202 {message}`. Kayıtlı aktif kullanıcıysa yöneticiye talep açılır (bekleyen talep varsa yenisi açılmaz) |
| GET | `/api/setup/status` | Herkes | `{needs_setup}` — hiç aktif yönetici yoksa `true` (kurulum kodu sunucu kayıtlarına yazılır) |
| POST | `/api/setup/admin` | Herkes, yalnızca kurulum gerekiyorken (rate limited) | `{setup_code, ad_soyad, email, password}` → `201 {user}` + cookie. Hatalı kod `403 INVALID_SETUP_CODE`, kurulum yapılmışsa `409 SETUP_DONE` |

| GET | `/api/auth/registration` | Herkes | `{enabled, domains}` |
| POST | `/api/auth/register` | Herkes (rate limited) | `{ad_soyad, email, password}`; yalnızca izinli alan adları. `201 {recovery_code, message}`; hesap onaylanana kadar girişte `403 ACCOUNT_PENDING` |
| POST | `/api/auth/recover` | Herkes (rate limited) | `{email, recovery_code, new_password}` → `200 {recovery_code (yeni), message}`; hatalı → `400 INVALID_RECOVERY`. Tüm oturumlar kapanır |
| POST | `/api/auth/recovery-code` | Auth (ayrı rate limit) | `{current_password}` → yeni `recovery_code`, eskisi geçersiz |
| POST | `/api/users/:id/approve` | Yönetici | `{department_id?}` onay bekleyen kaydı açar |
| POST | `/api/users/:id/reject` | Yönetici | Onay bekleyen kaydı siler |

`GET /api/users` varsayılan olarak yalnızca onaylı hesapları listeler; `?approval=pending` onay bekleyenleri döner.

Login gövdesinde isteğe bağlı `portal: 'ADMIN' | 'USER'` (giriş ekranındaki sekme): rol uyuşmazsa `403 WRONG_PORTAL`, oturum açılmaz.

### Parola sıfırlama talepleri — `/api/password-reset-requests` (yalnızca yönetici)

| Metot | Yol | Açıklama |
|-------|-----|----------|
| GET | `/` | `?status=PENDING` (varsayılan) / `RESOLVED` / `REJECTED` / `all` |
| POST | `/:id/resolve` | `{password}` geçici parola atar (kişi ilk girişte değiştirir), talebi kapatır → `204` |
| POST | `/:id/reject` | Talebi reddeder, parola değişmez → `204` |

`must_change_password = true` olan kullanıcı (yöneticinin verdiği geçici parola) yukarıdaki iki uç dışında her yerde `403 PASSWORD_CHANGE_REQUIRED` alır.

`user` nesnesi hiçbir yanıtta `password_hash` veya `token_version` içermez.

## 3. Kullanıcılar — `/api/users` (tamamı **Admin**)

| Metot | Yol | Açıklama |
|-------|-----|----------|
| GET | `/api/users` | Liste. Filtre: `role`, `department_id`, `is_active`; `search` (ad, e-posta); `sort` ∈ `ad_soyad, email, created_at, role`. Her satırda `active_assignment_count` |
| GET | `/api/users/:id` | Detay + departman |
| POST | `/api/users` | `{ad_soyad, email, password, role, department_id?}` → `201` |
| PATCH | `/api/users/:id` | `{ad_soyad?, email?, role?, department_id?, is_active?}`. Pasife alma: aktif zimmeti varsa `409 HAS_ACTIVE_ASSIGNMENTS`; pasife alma ve rol değişikliği `token_version`'ı artırır (oturumlar düşer) |
| PATCH | `/api/users/:id/password` | `{password}` → `204`; `token_version++` |
| DELETE | `/api/users/:id` | Zimmet geçmişi yoksa fiziksel silme `204`; varsa `409 HAS_HISTORY` (arayüz "Pasife al" önerir) |

Doğrulama: `email` geçerli biçim; `password` ≥ 8 karakter, en az bir harf ve bir rakam; `role` ∈ `ADMIN|USER`.

## 4. Departmanlar — `/api/departments`

| Metot | Yol | Yetki | Açıklama |
|-------|-----|-------|----------|
| GET | `/api/departments` | Admin | Tüm departmanlar + `user_count` (sayfasız; küçük liste) |
| POST | `/api/departments` | Admin | `{name}` → `201` |
| PATCH | `/api/departments/:id` | Admin | `{name}` |
| DELETE | `/api/departments/:id` | Admin | Kullanıcısı varsa `409` |

## 5. Cihazlar (envanter) — `/api/assets`

| Metot | Yol | Yetki | Açıklama |
|-------|-----|-------|----------|
| GET | `/api/assets` | Admin | Liste (aşağıya bakınız) |
| GET | `/api/assets/:id` | Admin, Sahip | Detay + `current_assignment` (kişi, departman, tarih) |
| GET | `/api/assets/by-code/:code` | Admin, Sahip | QR okutma sonrası arama; yanıt `/:id` ile aynı |
| GET | `/api/assets/:id/qr` | Admin, Sahip | `?format=png` (varsayılan) veya `svg`; içerik `${APP_BASE_URL}/assets/code/{asset_code}` |
| GET | `/api/assets/:id/assignments` | Admin | Cihazın tüm zimmet geçmişi (yeni→eski) |
| GET | `/api/assets/:id/history` | Admin | Cihazın audit log kronolojisi |
| POST | `/api/assets` | Admin | `{category, brand, model, serial_number, purchase_date?, warranty_end_date?, notes?}` → `201`; `asset_code` sunucuda üretilir, istemciden gelirse yok sayılır; `status=IN_STOCK` |
| PATCH | `/api/assets/:id` | Admin | Düzenlenebilir: `category, brand, model, serial_number, purchase_date, warranty_end_date, notes, is_active`. `asset_code` ve `status` bu uçla değişmez. Zimmetli cihaz pasife alınamaz (`409`) |
| PATCH | `/api/assets/:id/status` | Admin | `{status: "DEFECTIVE" \| "IN_STOCK", note?}`. `ACTIVE` verilemez (`400`); zimmetli cihazda `409 HAS_ACTIVE_ASSIGNMENTS` |
| DELETE | `/api/assets/:id` | Admin | Zimmet geçmişi yoksa fiziksel silme; varsa `409 HAS_HISTORY` |

**Liste parametreleri (`GET /api/assets`):**

| Parametre | Değer | Davranış |
|-----------|-------|----------|
| `search` | metin | `asset_code`, `serial_number`, `brand`, `model` içinde `ILIKE` |
| `status` | `ACTIVE` \| `DEFECTIVE` \| `IN_STOCK` (virgülle çoklu) | Durum filtresi |
| `category` | metin | Kategori eşitliği |
| `department_id` | int | Aktif zimmet sahibinin departmanı |
| `user_id` | int | Aktif zimmet sahibi |
| `is_active` | `true` \| `false` \| `all` | Varsayılan `true` |
| `sort` | `asset_code, brand, model, category, status, purchase_date, warranty_end_date, created_at` | Varsayılan `created_at desc` |

Her satır: cihaz alanları + `assigned_user: {id, ad_soyad, department} | null`.

## 6. Zimmet — `/api/assignments`

| Metot | Yol | Yetki | Açıklama |
|-------|-----|-------|----------|
| POST | `/api/assignments` | Admin | `{asset_id, user_id, note?}` → `201`. Transaction: cihaz satırı `FOR UPDATE` kilitlenir → `IN_STOCK` ve aktif mi → kullanıcı aktif mi → insert → `status=ACTIVE` → audit `ASSIGN` |
| POST | `/api/assignments/:id/return` | Admin | `{return_note?, condition?: "IN_STOCK" \| "DEFECTIVE"}` (varsayılan `IN_STOCK`) → `200`. `returned_at=now()`, `returned_by`, cihaz durumu güncellenir, audit `RETURN` |
| GET | `/api/assignments` | Admin | Liste. Filtre: `active` (`true\|false`), `user_id`, `asset_id`, `department_id`, `from`, `to`; `search` (cihaz kodu, seri no, personel adı); `sort` ∈ `assigned_at, returned_at` |
| GET | `/api/me/assignments` | Auth | Giriş yapan kullanıcının zimmetleri. `?active=true` (varsayılan) / `false` / `all`; sayfalı |

Zimmet kayıtları için **güncelleme/silme ucu yoktur**; tek değişiklik iade işlemidir.

## 7. Dashboard — `/api/dashboard`

| Metot | Yol | Yetki | Yanıt |
|-------|-----|-------|-------|
| GET | `/api/dashboard/stats` | Admin | `{ assets: {total, active, in_stock, defective, inactive}, users: {total, active}, by_category[], by_department[], recent_activity[], alerts: {total, by_type, by_severity}, generated_at }` |

Tanımlar (PRD §7 veri tutarlılığı): her istekte canlı `COUNT` sorgusu, önbellek yok.
- `total` = `COUNT(*) WHERE is_active`
- `defective` / `in_stock` / `active` = aynı küme içinde `status` bazında `COUNT(*) FILTER (...)`
- `inactive` = pasife alınmış cihazlar (toplamın dışında)
- Garanti: `total = active + defective + in_stock`

## 8. Audit log — `/api/audit-logs`

| Metot | Yol | Yetki | Açıklama |
|-------|-----|-------|----------|
| GET | `/api/audit-logs` | Admin | Filtre: `entity_type`, `entity_id`, `user_id`, `action_type`, `from`, `to`; sayfalı; varsayılan `timestamp desc` |

Yalnızca okuma. POST/PATCH/DELETE yok; DB trigger'ı da değişikliği engeller.

**`action_type` sözlüğü:** `LOGIN`, `LOGIN_FAILED`, `USER_CREATE`, `USER_UPDATE`, `USER_PASSWORD_RESET`, `USER_DEACTIVATE`, `USER_ACTIVATE`, `USER_DELETE`, `DEPARTMENT_CREATE`, `DEPARTMENT_UPDATE`, `DEPARTMENT_DELETE`, `ASSET_CREATE`, `ASSET_UPDATE`, `ASSET_STATUS_CHANGE`, `ASSET_DEACTIVATE`, `ASSET_ACTIVATE`, `ASSET_DELETE`, `ASSIGN`, `RETURN`.
`details` alanı değişen alanların önceki/sonraki değerlerini ve ilgili adların anlık görüntüsünü içerir; parola veya hash **asla** yazılmaz.

## 9. Faz 2 — uyarılar, bakım, raporlar (Aşama 7'de uygulandı)

Tamamı **Admin**.

| Metot | Yol | Açıklama |
|-------|-----|----------|
| GET | `/api/alerts?type=&severity=` | DB'den anlık üretilen uyarılar + tür bazında özet. Türler: `INCONSISTENT_STATUS` (kritik: "Zimmetli" ama aktif zimmet yok / zimmet var ama durum farklı / pasif kullanıcı veya pasif cihazda aktif zimmet), `WARRANTY_EXPIRING` (≤ `ALERT_WARRANTY_DAYS`, vars. 60), `LONG_DEFECTIVE` (> `ALERT_DEFECTIVE_DAYS`, vars. 30), `LONG_IN_STOCK` (> `ALERT_IDLE_DAYS`, vars. 90), `WARRANTY_EXPIRED_IN_USE`, `MISSING_INFO` |
| GET | `/api/assets/:id/maintenance` | Cihazın arıza kayıtları (yeni → eski) |
| POST | `/api/assets/:id/maintenance` | `{issue_description, mark_defective?=true}` → `201`. Depodaki cihaz `DEFECTIVE` olur; zimmetli cihaz personelde kalır |
| GET | `/api/maintenance?status=OPEN\|IN_PROGRESS\|RESOLVED\|open` | Tüm arıza kayıtları |
| PATCH | `/api/maintenance/:id` | `{status?, solution_note?, return_to_stock?}`. `RESOLVED` için çözüm notu zorunlu; kapalı kayıt değiştirilemez (`409 MAINTENANCE_CLOSED`); `return_to_stock` açık kaydı kalmayan arızalı cihazı `IN_STOCK` yapar |
| GET | `/api/reports/assets.csv` | Filtre: `status, department_id, category, from, to` (alım tarihi), `include_inactive` |
| GET | `/api/reports/assignments.csv` | Filtre: `active, department_id, from, to` (teslim tarihi) |
| GET | `/api/reports/assets`, `/api/reports/assignments` | Aynı filtrelerle JSON önizleme (arayüz tablosu ve yazdır/PDF için) |

CSV biçimi: UTF-8 BOM + `;` ayraç (Türkçe Excel doğrudan açar), tarih-saatler `REPORT_TIMEZONE` (vars. Europe/Istanbul) ile, `= + - @` ile başlayan hücreler formül enjeksiyonuna karşı `'` ile kaçırılır. PDF: rapor sayfasındaki "Yazdır / PDF" tarayıcının yazdırma diyaloğunu kullanır.

Bakım işlemleri cihaz zaman çizelgesine `MAINTENANCE_OPEN`, `MAINTENANCE_UPDATE`, `MAINTENANCE_RESOLVE` olarak yazılır.

### Yardımcı uçlar

| Metot | Yol | Yetki | Açıklama |
|-------|-----|-------|----------|
| GET | `/api/assets/categories` | Admin | Kayıtlı kategoriler (filtre ve form önerileri) |
| GET | `/api/audit-logs/actions` | Admin | Kayıtlı işlem tipleri (filtre) |

## 10. PRD §7 kabul kriterleri ↔ API

| Kriter | Nasıl karşılanıyor |
|--------|--------------------|
| Yetki ihlali engeli | Tüm `/api/users`, `/api/departments`, `/api/dashboard`, `/api/audit-logs`, envanter yazma ve zimmet uçlarında `requireRole('ADMIN')` → `403` |
| Mükerrer kayıt | `UNIQUE(serial_number)`, `UNIQUE(asset_code)` → `409 DUPLICATE_*` |
| Çakışan zimmet | Servis kontrolü + `FOR UPDATE` kilit + partial unique index → `409 ASSET_ALREADY_ASSIGNED` |
| Veri tutarlılığı | `/api/dashboard/stats` canlı `COUNT` |
| Eksiksiz kurulum | Aşama 8: `docker compose up` migration + seed'i otomatik çalıştırır |
