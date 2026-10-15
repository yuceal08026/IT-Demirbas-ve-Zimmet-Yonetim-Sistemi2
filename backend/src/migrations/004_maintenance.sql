-- Aşama 7 (Faz 2): arıza ve bakım kayıtları

CREATE TYPE maintenance_status AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED');

CREATE TABLE maintenance_records (
    id                 SERIAL PRIMARY KEY,
    asset_id           INT NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
    reported_by        INT REFERENCES users(id) ON DELETE SET NULL,
    issue_description  TEXT NOT NULL,
    status             maintenance_status NOT NULL DEFAULT 'OPEN',
    solution_note      TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at          TIMESTAMPTZ,
    closed_by          INT REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT chk_maintenance_closed CHECK ((status = 'RESOLVED') = (closed_at IS NOT NULL)),
    CONSTRAINT chk_maintenance_solution CHECK (status <> 'RESOLVED' OR solution_note IS NOT NULL)
);

CREATE INDEX ix_maintenance_asset  ON maintenance_records (asset_id, created_at DESC);
CREATE INDEX ix_maintenance_open   ON maintenance_records (status) WHERE status <> 'RESOLVED';
