-- Aşama 3: kullanıcılar, departmanlar ve işlem geçmişi (audit log)
-- Tasarım: docs/ERD.md

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TYPE user_role AS ENUM ('ADMIN', 'USER');

CREATE TABLE departments (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(100) NOT NULL UNIQUE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE users (
    id             SERIAL PRIMARY KEY,
    ad_soyad       VARCHAR(150) NOT NULL,
    email          VARCHAR(255) NOT NULL,
    password_hash  VARCHAR(255) NOT NULL,
    role           user_role    NOT NULL DEFAULT 'USER',
    department_id  INT REFERENCES departments(id) ON DELETE SET NULL,
    is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
    token_version  INT          NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_users_email_lower ON users (lower(email));
CREATE INDEX ix_users_department ON users (department_id);

-- İşlem geçmişi: yalnızca ekleme yapılabilir (append-only).
CREATE TABLE audit_logs (
    id           BIGSERIAL PRIMARY KEY,
    user_id      INT REFERENCES users(id) ON DELETE SET NULL,
    action_type  VARCHAR(50) NOT NULL,
    entity_type  VARCHAR(30) NOT NULL,
    entity_id    INT,
    "timestamp"  TIMESTAMPTZ NOT NULL DEFAULT now(),
    details      JSONB       NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX ix_audit_entity ON audit_logs (entity_type, entity_id, "timestamp" DESC);
CREATE INDEX ix_audit_time   ON audit_logs ("timestamp" DESC);
CREATE INDEX ix_audit_user   ON audit_logs (user_id);

CREATE FUNCTION audit_logs_immutable() RETURNS trigger AS $$
BEGIN
    -- Tek istisna: işlemi yapan kullanıcı silindiğinde FK'nin ON DELETE SET NULL güncellemesi.
    IF TG_OP = 'UPDATE'
       AND NEW.user_id IS NULL AND OLD.user_id IS NOT NULL
       AND NEW.action_type = OLD.action_type AND NEW.entity_type = OLD.entity_type
       AND NEW.entity_id IS NOT DISTINCT FROM OLD.entity_id
       AND NEW."timestamp" = OLD."timestamp" AND NEW.details = OLD.details THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'audit_logs kayıtları değiştirilemez veya silinemez';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_logs_immutable
    BEFORE UPDATE OR DELETE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();
