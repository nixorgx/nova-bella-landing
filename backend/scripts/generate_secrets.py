"""Guarda credenciales en .env mediante entrada oculta; nunca las imprime."""
import getpass
from pathlib import Path
import re
import secrets

from app.security import hash_password


if __name__ == "__main__":
    env_path = Path(__file__).resolve().parents[1] / '.env'
    original = env_path.read_text(encoding='utf-8-sig') if env_path.exists() else ''
    email = input("Correo del administrador: ").strip().lower()
    if '@' not in email or any(char in email for char in '\r\n'):
        raise SystemExit('Correo no válido.')
    password = getpass.getpass("Contraseña del administrador (mín. 12 caracteres): ")
    confirmation = getpass.getpass("Repetir contraseña: ")
    if password != confirmation:
        raise SystemExit("Las contraseñas no coinciden.")
    values = {'JWT_SECRET': secrets.token_urlsafe(48), 'ADMIN_PASSWORD_HASH':hash_password(password), 'ADMIN_EMAIL':email}
    if not re.search(r'^POSTGRES_PASSWORD=(?!REEMPLAZAR)\S+', original, re.M):
        values['POSTGRES_PASSWORD']=secrets.token_urlsafe(48)
    updated=original
    for key,value in values.items():
        updated=re.sub(r'^'+key+r'=.*(?:\n|$)', '', updated, flags=re.M)
        updated=updated.rstrip()+f'\n{key}={value}\n'
    env_path.write_text(updated.lstrip(),encoding='utf-8')
    print('Credenciales guardadas en backend/.env. Recrea la API para usar las nuevas credenciales.')
