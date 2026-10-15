-- Kendi kendine kayıt (yönetici onaylı) ve e-postasız parola kurtarma (kurtarma kodu).
-- Mevcut kullanıcılar onaylı sayılır; hiçbir kayıt silinmez.

ALTER TABLE users ADD COLUMN is_approved BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN self_registered BOOLEAN NOT NULL DEFAULT FALSE;
-- Kurtarma kodu yalnızca bcrypt özeti olarak saklanır; kodun kendisi kullanıcıya bir kez gösterilir.
ALTER TABLE users ADD COLUMN recovery_code_hash VARCHAR(255);
ALTER TABLE users ADD COLUMN recovery_code_created_at TIMESTAMPTZ;

CREATE INDEX ix_users_pending_approval ON users (created_at) WHERE NOT is_approved;
