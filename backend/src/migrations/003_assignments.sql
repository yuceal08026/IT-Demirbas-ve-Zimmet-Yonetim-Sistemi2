-- Aşama 5: zimmet kayıtları
-- returned_at IS NULL olan kayıt = aktif zimmet.

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
    CONSTRAINT chk_assignments_return_after CHECK (returned_at IS NULL OR returned_at >= assigned_at),
    CONSTRAINT chk_assignments_return_pair  CHECK ((returned_at IS NULL) = (returned_by IS NULL))
);

-- PRD §7 "Çakışan Zimmet Engeli": bir cihazın aynı anda en fazla bir aktif zimmeti olabilir.
-- Servis katmanındaki kontrol + satır kilidi eşzamanlı isteklerde aşılsa bile bu indeks ikinci kaydı reddeder.
CREATE UNIQUE INDEX ux_assignments_active_asset ON assignments (asset_id) WHERE returned_at IS NULL;
CREATE INDEX ix_assignments_user_active   ON assignments (user_id) WHERE returned_at IS NULL;
CREATE INDEX ix_assignments_asset_history ON assignments (asset_id, assigned_at DESC);
CREATE INDEX ix_assignments_assigned_at   ON assignments (assigned_at DESC);

-- Zimmet geçmişi korunur: kayıt silinemez; iade dışında alanlar değiştirilemez.
CREATE FUNCTION assignments_protect() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Zimmet kayıtları silinemez';
    END IF;
    IF OLD.returned_at IS NOT NULL THEN
        RAISE EXCEPTION 'İade edilmiş zimmet kaydı değiştirilemez';
    END IF;
    IF NEW.asset_id <> OLD.asset_id OR NEW.user_id <> OLD.user_id
       OR NEW.assigned_by <> OLD.assigned_by OR NEW.assigned_at <> OLD.assigned_at
       OR NEW.note IS DISTINCT FROM OLD.note THEN
        RAISE EXCEPTION 'Zimmet kaydında yalnızca iade bilgileri güncellenebilir';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_assignments_protect
    BEFORE UPDATE OR DELETE ON assignments
    FOR EACH ROW EXECUTE FUNCTION assignments_protect();
