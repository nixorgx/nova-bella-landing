"""Genera una clave JWT y un hash scrypt, sin imprimir la contraseña original."""
import getpass
import secrets

from app.security import hash_password


if __name__ == "__main__":
    password = getpass.getpass("Contraseña del administrador (mín. 12 caracteres): ")
    confirmation = getpass.getpass("Repetir contraseña: ")
    if password != confirmation:
        raise SystemExit("Las contraseñas no coinciden.")
    print("\nJWT_SECRET=" + secrets.token_urlsafe(48))
    print("ADMIN_PASSWORD_HASH=" + hash_password(password))
    print("Guarda estos valores en backend/.env y nunca los subas a GitHub.")
