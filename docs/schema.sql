-- =====================================================================
-- IT Demirbaş ve Zimmet Yönetim Sistemi — DDL taslağı (Aşama 1)
-- PostgreSQL 16. Aşama 3–5 migration'ları bu taslaktan üretilecek.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------- Enum tipleri ----------
CREATE TYPE user_role    AS ENUM ('ADMIN', 'USER');
CREATE TYPE asset_status AS ENUM ('ACTIVE', 'DEFECTIVE', 'IN_STOCK');

-- ---------- Departments ----------
CREATE TABLE departments (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(100) NOT NULL UNIQUE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ---------- Users ----------
CREATE TABLE users (
    id             SERIAL PRIMARY KEY,
    ad_soyad       VARCHAR(150) NOT NULL,
    email          VARCHAR(255) NOT NULL,
    password_hash  VARCHAR(255) NOT NULL,
    role           user_role    NOT NULL DEFAULT 'USER',
    department_id  INT REFERENCES departments(id) ON DELETE SET NULL,
    is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
    token_version  INT          NOT NULL DEFAULT 0,
    must_change_password BOOLEAN NOT NULL DEFAULT FALSE,  -- 005_password_change.sql
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_users_email_lower ON users (lower(email));
CREATE INDEX ix_users_department ON users (department_id);

-- ---------- Assets ----------
CREATE SEQUENCE asset_code_seq START 1;

CREATE TABLE assets (
    id                 SERIAL PRIMARY KEY,
    asset_code         VARCHAR(32)  NOT NULL UNIQUE,
    category           VARCHAR(50)  NOT NULL,
    brand              VARCHAR(100) NOT NULL,
    model              VARCHAR(100) NOT NULL,
    serial_number      VARCHAR(100) NOT NULL UNIQUE,
    purchase_date      DATE,
    warranty_end_date  DATE,
    status             asset_status NOT NULL DEFAULT 'IN_STOCK',
    status_changed_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    is_active          BOOLEAN      NOT NULL DEFAULT TRUE,
    notes              TEXT,
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT chk_assets_warranty CHECK (
        warranty_end_date IS NULL OR purchase_date IS NULL
        OR warranty_end_date >= purchase_date
    )
);
CREATE INDEX ix_assets_status_active ON assets (status) WHERE is_active;
CREATE INDEX ix_assets_created_at    ON assets (created_at DESC);
CREATE INDEX ix_assets_warranty      ON assets (warranty_end_date);
CREATE INDEX ix_assets_search_trgm   ON assets USING gin (
    (asset_code || ' ' || serial_number || ' ' || brand || ' ' || model) gin_trgm_ops
);

-- ---------- Assignments ----------
CREATE TABLE assignments (
    id           SERIAL PRIMARY KEY,
    asset_id     INT NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
    user_id      INT NOT NULL REFERENCES users(id)  ON DELETE RESTRICT,
    assigned_by  INT NOT NULL REFERENCES users(id)  ON DELETE RESTRICT,
    assigned_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    returned_at  TIMESTAMPTZ,
    returned_by  INT REFERENCES users(id) ON DELETE RESTRICT,
    note         TEXT,
    return_note  TEXT,
    CONSTRAINT chk_assignments_return_after CHECK (
        returned_at IS NULL OR returned_at >= assigned_at
    ),
    CONSTRAINT chk_assignments_return_pair CHECK (
        (returned_at IS NULL) = (returned_by IS NULL)
    )
);
-- PRD §7 "Çakışan Zimmet Engeli": cihaz başına en fazla bir aktif zimmet.
CREATE UNIQUE INDEX ux_assignments_active_asset
    ON assignments (asset_id) WHERE returned_at IS NULL;
CREATE INDEX ix_assignments_user_active
    ON assignments (user_id) WHERE returned_at IS NULL;
CREATE INDEX ix_assignments_asset_history
    ON assignments (asset_id, assigned_at DESC);

-- ---------- Audit logs (append-only) ----------
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
    -- ON DELETE SET NULL ile gelen user_id güncellemesine izin ver, başka hiçbir şeye değil.
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

-- ---------- Faz 2: Maintenance records (taslak, Aşama 7'de eklenecek) ----------
-- CREATE TYPE maintenance_status AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED');
-- CREATE TABLE maintenance_records (
--     id                 SERIAL PRIMARY KEY,
--     asset_id           INT NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
--     reported_by        INT REFERENCES users(id) ON DELETE SET NULL,
--     issue_description  TEXT NOT NULL,
--     status             maintenance_status NOT NULL DEFAULT 'OPEN',
--     solution_note      TEXT,
--     created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
--     closed_at          TIMESTAMPTZ
-- );
-- CREATE INDEX ix_maintenance_asset ON maintenance_records (asset_id, created_at DESC);
