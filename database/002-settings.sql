CREATE TABLE IF NOT EXISTS auth.account_settings (
    account_id uuid PRIMARY KEY REFERENCES auth.accounts (id) ON DELETE CASCADE,
    preferences jsonb NOT NULL
);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'naanala_app') THEN
        GRANT SELECT, INSERT, UPDATE ON auth.account_settings TO naanala_app;
    END IF;
END
$$;
