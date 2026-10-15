-- Güvenlik: geçici veya bilinen (varsayılan) parolayla açılan hesaplar ilk girişte parolasını değiştirmek zorundadır.
-- Mevcut kayıtlara dokunmaz; yalnızca yeni bir sütun ekler (varsayılan FALSE).

ALTER TABLE users ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
