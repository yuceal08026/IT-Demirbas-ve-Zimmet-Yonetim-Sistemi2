-- Aşama 4: envanter (cihazlar)
-- asset_code uygulama tarafından asset_code_seq ile üretilir: IT-<YIL>-<6 hane>

CREATE TYPE asset_status AS ENUM ('ACTIVE', 'DEFECTIVE', 'IN_STOCK');

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
CREATE INDEX ix_assets_category      ON assets (category);
CREATE INDEX ix_assets_search_trgm   ON assets USING gin (
    (asset_code || ' ' || serial_number || ' ' || brand || ' ' || model) gin_trgm_ops
);
