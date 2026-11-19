import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

import jwt


def hash_password(password: str, *, salt: bytes | None = None) -> str:
    if not 12 <= len(password) <= 1024:
        raise ValueError("La contraseña debe tener entre 12 y 1024 caracteres.")
    salt = salt or secrets.token_bytes(16)
    cost, block, parallel = 2**14, 8, 5
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=cost, r=block, p=parallel)
    return f"scrypt:{cost}:{block}:{parallel}:{salt.hex()}:{digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, cost, block, parallel, salt, expected = stored.split(":")
        if scheme != "scrypt" or int(cost) > 2**16 or int(block) > 16 or int(parallel) > 5:
            return False
        digest = hashlib.scrypt(password.encode("utf-8"), salt=bytes.fromhex(salt), n=int(cost), r=int(block), p=int(parallel))
        return hmac.compare_digest(digest, bytes.fromhex(expected))
    except (ValueError, TypeError, OverflowError):
        return False


def create_token(email: str, secret: str, minutes: int) -> str:
    now = datetime.now(timezone.utc)
    return jwt.encode({"sub": email, "role": "admin", "iat": now, "exp": now + timedelta(minutes=minutes)}, secret, algorithm="HS256")


def verify_token(token: str, secret: str, email: str) -> bool:
    try:
        claims = jwt.decode(token, secret, algorithms=["HS256"], options={"require": ["sub", "role", "exp", "iat"]})
        return claims.get("role") == "admin" and hmac.compare_digest(claims.get("sub", "").encode(), email.encode())
    except (jwt.PyJWTError, TypeError, ValueError):
        return False
