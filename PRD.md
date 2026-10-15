# Ürün Gereksinim Belgesi (PRD)
## Proje Adı: IT Demirbaş ve Zimmet Yönetim Sistemi

---

## 1. Proje Genel Bakışı ve Amaç
Bu proje, kurum içindeki bilişim donanımlarının (bilgisayar, monitör, sunucu vb.) envanter kayıtlarının tutulduğu, durumlarının anlık olarak takip edildiği, personele teslim ve iade (zimmet) süreçlerinin yönetildiği ve tüm işlem geçmişinin güvenli bir şekilde saklandığı full-stack bir web uygulamasıdır.

Yapay Zekâ ve Dijital Dönüşüm Koordinatörlüğü Aday Mühendis Değerlendirme Projesi kapsamında geliştirilmektedir.

---

## 2. Temel Hedefler ve Başarı Kriterleri
* **Merkezi Envanter Yönetimi:** Tüm IT varlıklarını tek platform üzerinden izlemek ve yönetmek.
* **Güvenilir Zimmet Süreci:** Cihazların kimde olduğunu, teslim/iade geçmişini ve durumunu hatasız kaydetmek.
* **Uçtan Uca Güvenlik ve Yetkilendirme:** Rol tabanlı erişim kontrolünü (RBAC) hem frontend hem de backend katmanlarında sıkı bir şekilde uygulamak.
* **QR Kod Entegrasyonu:** Her cihaza otomatik ürettirilen QR kodlar ile hızlı erişim sağlamak.
* **Sürdürülebilir Mimari ve Dokümantasyon:** Projeyi temiz kod ilkelerine uygun geliştirmek, anlaşılır bir README.md ve Docker altyapısı ile dağıtıma hazır hale getirmek.

---

## 3. Kullanıcı Rolleri ve Yetki Matrisi

Yetkilendirme kontrolleri sadece arayüzdeki butonları gizleyerek değil, backend API middleware katmanında da doğrulanacaktır.

| İşlev / Modül | Yönetici (Admin) | Standart Personel |
| :--- | :---: | :---: |
| **Sisteme Giriş / Çıkış** | Tam Yetki | Tam Yetki |
| **Kullanıcı Yönetimi** | Ekle / Düzenle / Sil / Şifre Değiştir | Erişimi Yok |
| **Envanter Yönetimi (CRUD)** | Cihaz Ekle / Sil / Düzenle / Pasife Al | Erişimi Yok |
| **Zimmetleme & İade** | Teslim Et / İade Al | Erişimi Yok |
| **Dashboard & İstatistikler** | Tüm Verileri Görüntüleme | Erişimi Yok |
| **Zimmetli Cihaz Takibi** | Tüm Cihazlar | Sadece Kendi Üzerindeki Cihazlar |
| **Cihaz Detayı & QR Kod** | Tüm Cihazlar | Sadece Yetkili Olduğu Cihazlar |

---

## 4. Fonksiyonel Gereksinimler

### 4.1. Web ve Backend Zorunlu İsterleri
* **Kimlik Doğrulama ve Güvenlik:**
  * Login/Logout mekanizması.
  * Oturum yönetimi için JWT veya Session tabanlı mimari. Parolaların veritabanında güvenli özeti (hash/bcrypt) tutulmalıdır.
* **UI/UX ve Genel Arayüz:**
  * Masaüstü, tablet ve mobil uyumlu (Responsive) arayüz tasarımı.
  * Veri tablolarında Sayfalama (Pagination), Arama ve Sıralama yetenekleri.
  * İşlem sonuçları için anlık Toast / Snackbar bildirimleri.
* **Kullanıcı Yönetimi:**
  * Admin kullanıcılarının personel ekleyebileceği, güncelleyebileceği, silebileceği/pasife alabileceği ve şifrelerini yönetebileceği yönetim paneli.
* **Dashboard (Gösterge Paneli):**
  * Toplam cihaz sayısı, arızalı cihaz sayısı ve boşta bekleyen cihaz sayısını gösteren anlık ve gerçek veriye dayalı göstergeler.
* **Envanter Yönetimi:**
  * Cihaz CRUD operasyonları (Marka, Model, Seri No, Alım Tarihi vb.).
  * Cihaz eklendiğinde otomatik benzersiz QR Kod / Barkod üretimi.
* **Zimmet Yönetimi ve İş Kuralları:**
  * Cihazı personele atama ve zimmetten düşme/iade işlemleri.
  * **İş Kuralları (Business Rules):** Aynı cihaz aynı anda iki farklı aktif kullanıcıya zimmetlenemez. İade edilen cihaz durumu "Boşta/Depoda" olarak güncellenir ve yeniden zimmetlenebilir hale gelir.
* **Filtreleme ve Arama:**
  * Cihaz durumuna göre (Aktif, Arızalı, Depoda) ve departman/kullanıcı bazlı dinamik filtreleme.

### 4.2. Farklılaştırıcı / İleri Seviye İsterler (Faz 2)
* **Akıllı Demirbaş Kontrol Merkezi:** Garanti süresi yaklaşan veya uzun süredir depoda bekleyen cihazlar için otomatik uyarılar.
* **Detaylı Cihaz Zaman Çizelgesi (Audit Log):** Cihaz bazında kimin ne zaman teslim aldığını, iade ettiğini veya durum değiştirdiğini kronolojik gösterim.
* **Arıza ve Bakım Takibi:** Arıza kaydı oluşturma, çözüm notu ekleme ve geçmiş arıza kayıtlarını saklama.
* **Raporlama:** Envanter ve zimmet raporlarının CSV/PDF formatlarında dışa aktarılması.

### 4.3. Mobil Uygulama İsterleri (Opsiyonel / Bonus - Faz 3)
* **Mobil Kimlik Doğrulama:** Mobil cihaz üzerinden güvenli giriş.
* **Kamera ile QR Okuma:** Mobil kamera ile QR kod taranarak cihaz detay ekranına hızlı geçiş.
* **Saha Operasyonları:** Taranan cihaz üzerinde sahada "Personele Teslim Et", "İade Al" veya "Arıza Bildir" aksiyonları.
* **Kişisel Zimmet Ekranı:** Giriş yapan personelin kendi cihazlarını listelemesi.

---

## 5. Önerilen Teknik Mimari ve Veri Modeli

### 5.1. Teknoloji Yığını (Tech Stack)
* **Frontend:** React (Tailwind CSS veya Bootstrap)
* **Backend:** Node.js (Express.js)
* **Veritabanı:** PostgreSQL (Relational DB)
* **Auth:** JWT (JSON Web Token)
* **DevOps:** Docker & Docker Compose
* **Mobil (Opsiyonel):** React Native veya Flutter

### 5.2. Veritabanı Şeması Taslağı
| Tablo Adı | Sütunlar / Alanlar |
| :--- | :--- |
| **Users** | id, ad_soyad, email, password_hash, role (ADMIN/USER), department_id, is_active, created_at |
| **Departments** | id, name |
| **Assets** | id, asset_code (Unique/QR), category, brand, model, serial_number (Unique), purchase_date, warranty_end_date, status (ACTIVE, DEFECTIVE, IN_STOCK), is_active, created_at |
| **Assignments** | id, asset_id, user_id, assigned_by (Admin ID), assigned_at, returned_at, note |
| **AuditLogs** | id, user_id, action_type, entity_type, entity_id, timestamp, details |
| **MaintenanceRecords** *(Opsiyonel)* | id, asset_id, issue_description, status, solution_note, created_at, closed_at |

---

## 6. Geliştirme Yol Haritası (Milestones)
1. **Aşama 1 — Analiz, Tasarım ve ERD:** Veritabanı mimarisinin ve API uç noktalarının tasarımı.
2. **Aşama 2 — Proje Kurulumu ve Sağlık Kontrolü:** Repo oluşturma, Express + PostgreSQL bağlantısı ve Docker konfigürasyonu.
3. **Aşama 3 — Auth ve Kullanıcı Yönetimi:** JWT entegrasyonu, rol kontrolü middleware'leri ve kullanıcı CRUD ekranları.
4. **Aşama 4 — Envanter ve QR Kod:** Cihaz yönetimi, arama/sayfalama ve QR kod üretimi.
5. **Aşama 5 — Zimmet ve Log Altyapısı:** Teslim/iade mantığı, veri kısıtlamaları ve işlem geçmişi.
6. **Aşama 6 — Dashboard ve Responsive UI:** İstatistikler, grafikler ve mobil uyumluluk.
7. **Aşama 7 — İleri Özellikler & Testler:** Akıllı uyarılar, bakım takibi ve birim/entegrasyon testleri.
8. **Aşama 8 — Teslimat:** README.md dokümantasyonu, Docker Compose doğrulaması ve GitHub paylaşımı.
9. **Aşama 9 (Opsiyonel) — Mobil Uygulama:** QR taratma ve saha operasyonları için mobil uygulamanın geliştirilmesi.

---

## 7. Kabul ve Test Kriterleri (Validation Criteria)
* **Yetki İhlali Engeli:** Yetkisiz/Standart kullanıcının Admin API endpoint'lerine erişemediği doğrulanmalıdır.
* **Mükerrer Kayıt Koruması:** Aynı Seri Numarasına veya Cihaz Koduna sahip ikinci bir cihaz eklenemez.
* **Çakışan Zimmet Engeli:** Zaten bir personelde aktif zimmetli görünen bir cihaz, iade alınmadan başkasına zimmetlenemez.
* **Veri Tutarlılığı:** Dashboard'daki toplam, arızalı ve depodaki cihaz sayıları veritabanındaki anlık gerçek verilerle birebir eşleşmelidir.
* **Eksiksiz Kurulum:** Sıfır bir ortamda `docker-compose up` çalıştırıldığında tüm sistem sorunsuz ayağa kalkmalıdır.