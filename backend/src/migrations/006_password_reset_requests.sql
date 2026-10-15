-- "Şifremi unuttum" talepleri. E-posta altyapısı gerektirmez: talep yönetici paneline düşer,
-- yönetici kişiye geçici parola verir (kişi ilk girişte kendi parolasını belirler).

CREATE TYPE reset_request_status AS ENUM ('PENDING', 'RESOLVED', 'REJECTED');

CREATE TABLE password_reset_requests (
    id           SERIAL PRIMARY KEY,
    user_id      INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status       reset_request_status NOT NULL DEFAULT 'PENDING',
    requested_ip VARCHAR(64),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at  TIMESTAMPTZ,
    resolved_by  INT REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT chk_reset_resolved CHECK ((status = 'PENDING') = (resolved_at IS NULL))
);

-- Bir kullanıcının aynı anda en fazla bir bekleyen talebi olur (tekrarlanan talepler yığılmaz).
CREATE UNIQUE INDEX ux_reset_pending_user ON password_reset_requests (user_id) WHERE status = 'PENDING';
CREATE INDEX ix_reset_status_created ON password_reset_requests (status, created_at DESC);
