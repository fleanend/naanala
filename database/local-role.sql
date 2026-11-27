\getenv app_password NAANALA_DB_PASSWORD

BEGIN;
CREATE ROLE naanala_app LOGIN PASSWORD :'app_password';
REVOKE CONNECT ON DATABASE naanala FROM PUBLIC;
GRANT CONNECT ON DATABASE naanala TO naanala_app;
GRANT USAGE ON SCHEMA auth TO naanala_app;
GRANT SELECT, INSERT ON auth.accounts TO naanala_app;
GRANT UPDATE (password_hash) ON auth.accounts TO naanala_app;
GRANT SELECT, INSERT, DELETE ON auth.sessions TO naanala_app;
COMMIT;
