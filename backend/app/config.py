import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    database_url: str
    jwt_secret: str
    admin_email: str
    admin_password_hash: str
    allowed_origins: tuple[str, ...]
    token_minutes: int = 30

    @classmethod
    def from_env(cls) -> "Settings":
        origins = os.getenv(
            "ALLOWED_ORIGINS",
            "https://nova-bella-boutique-2026.keenorbit34.chatgpt.site,"
            "https://nova-bella-centro-control-2026.keenorbit34.chatgpt.site,"
            "http://localhost:5173,http://localhost:5174",
        )
        return cls(
            database_url=os.getenv("DATABASE_URL", "sqlite:///./nova-bella.db"),
            jwt_secret=os.getenv("JWT_SECRET", ""),
            admin_email=os.getenv("ADMIN_EMAIL", "").strip().lower(),
            admin_password_hash=os.getenv("ADMIN_PASSWORD_HASH", ""),
            allowed_origins=tuple(o.strip().rstrip("/") for o in origins.split(",") if o.strip()),
            token_minutes=int(os.getenv("TOKEN_MINUTES", "30")),
        )

    def validate(self) -> None:
        if len(self.jwt_secret) < 32:
            raise RuntimeError("JWT_SECRET debe contener al menos 32 caracteres aleatorios.")
        if not self.admin_email or "@" not in self.admin_email:
            raise RuntimeError("Configura ADMIN_EMAIL antes de iniciar la API.")
        if not self.admin_password_hash.startswith("scrypt:"):
            raise RuntimeError("Configura ADMIN_PASSWORD_HASH con scripts/generate_secrets.py.")
        if self.token_minutes < 5 or self.token_minutes > 120:
            raise RuntimeError("TOKEN_MINUTES debe estar entre 5 y 120.")
