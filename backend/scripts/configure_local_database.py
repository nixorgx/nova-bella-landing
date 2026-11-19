"""Prepare only the Nova Bella database and a restricted runtime role. No secrets printed."""
from pathlib import Path
import re
import secrets
import subprocess

from app.database import SCHEMA


def main():
    env_path = Path(__file__).resolve().parents[1] / ".env"
    original = env_path.read_text(encoding="utf-8-sig")
    match = re.search(r"^APP_DATABASE_PASSWORD=([A-Za-z0-9_-]{32,})$", original, re.M)
    password = match.group(1) if match else secrets.token_urlsafe(48)
    # Verify write permission before changing any database state.
    with env_path.open("a", encoding="utf-8"):
        pass
    statements = [
        "BEGIN;", *[statement + ";" for statement in SCHEMA],
        "DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='nova_bella_app') THEN CREATE ROLE nova_bella_app LOGIN; END IF; END $$;",
        f"ALTER ROLE nova_bella_app PASSWORD '{password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;",
        "GRANT CONNECT ON DATABASE nova_bella TO nova_bella_app;",
        "GRANT USAGE ON SCHEMA public TO nova_bella_app;",
        "GRANT SELECT, INSERT, UPDATE ON products, customers, sales TO nova_bella_app;",
        "GRANT SELECT, INSERT ON audit_events TO nova_bella_app;",
        "COMMIT;",
    ]
    result = subprocess.run([
        "docker", "exec", "-i", "nova-bella-postgres-1", "psql", "-X", "-q",
        "-v", "ON_ERROR_STOP=1", "-U", "nova_bella", "-d", "nova_bella",
    ], input="\n".join(statements), text=True, capture_output=True)
    if result.returncode:
        raise SystemExit("No se pudo preparar PostgreSQL; no se modificó .env. Diagnóstico omitido para proteger secretos.")
    updated = re.sub(r"^APP_DATABASE_PASSWORD=.*(?:\n|$)", "", original, flags=re.M)
    env_path.write_text(updated.rstrip() + f"\nAPP_DATABASE_PASSWORD={password}\n", encoding="utf-8")
    print("Esquema preparado; rol limitado configurado; credencial guardada en .env.")


if __name__ == "__main__":
    main()
