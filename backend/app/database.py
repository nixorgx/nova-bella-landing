import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone


SCHEMA = [
    """CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL,
        color TEXT NOT NULL, price_bs INTEGER NOT NULL CHECK(price_bs > 0),
        description TEXT NOT NULL DEFAULT '', image_url TEXT,
        status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','archived')),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS customers (
        id TEXT PRIMARY KEY, alias TEXT NOT NULL UNIQUE, preference TEXT NOT NULL DEFAULT 'Sin definir',
        followup TEXT NOT NULL DEFAULT 'Pendiente', note TEXT NOT NULL DEFAULT '',
        next_contact TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS sales (
        id TEXT PRIMARY KEY, product_id TEXT NOT NULL, product_name TEXT NOT NULL,
        customer_id TEXT, quantity INTEGER NOT NULL CHECK(quantity > 0),
        unit_price_bs INTEGER NOT NULL CHECK(unit_price_bs > 0),
        total_bs INTEGER NOT NULL CHECK(total_bs > 0), sold_at TEXT NOT NULL,
        created_at TEXT NOT NULL, idempotency_key TEXT UNIQUE,
        FOREIGN KEY (product_id) REFERENCES products(id), FOREIGN KEY(customer_id) REFERENCES customers(id)
    )""",
    """CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY, actor TEXT NOT NULL, operation TEXT NOT NULL,
        entity TEXT NOT NULL, entity_id TEXT NOT NULL, happened_at TEXT NOT NULL
    )""",
    "CREATE INDEX IF NOT EXISTS idx_products_status ON products(status)",
    "CREATE INDEX IF NOT EXISTS idx_sales_sold_at ON sales(sold_at)",
    "CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_id)",
    "CREATE INDEX IF NOT EXISTS idx_audit_date ON audit_events(happened_at)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_alias_lower ON customers(lower(alias))",
]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Session:
    def __init__(self, connection, postgres: bool):
        self.connection = connection
        self.postgres = postgres

    def execute(self, statement: str, parameters=()):
        sql = statement.replace("?", "%s") if self.postgres else statement
        return self.connection.execute(sql, parameters)

    def one(self, statement: str, parameters=()):
        row = self.execute(statement, parameters).fetchone()
        return dict(row) if row is not None else None

    def all(self, statement: str, parameters=()):
        return [dict(row) for row in self.execute(statement, parameters).fetchall()]


class Database:
    def __init__(self, url: str):
        self.url = url
        self.postgres = url.startswith(("postgresql://", "postgres://"))
        if not self.postgres and not url.startswith("sqlite:///"):
            raise ValueError("DATABASE_URL debe ser PostgreSQL o sqlite:///")

    def connect(self):
        if self.postgres:
            try:
                import psycopg
                from psycopg.rows import dict_row
            except ImportError as exc:
                raise RuntimeError("Instala psycopg[binary] para usar PostgreSQL.") from exc
            url = self.url.replace("postgres://", "postgresql://", 1)
            return psycopg.connect(url, row_factory=dict_row, connect_timeout=5,
                                   options="-c statement_timeout=10000 -c idle_in_transaction_session_timeout=15000")
        path = self.url.removeprefix("sqlite:///")
        conn = sqlite3.connect(path, timeout=20, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    @contextmanager
    def transaction(self):
        conn = self.connect()
        try:
            yield Session(conn, self.postgres)
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def initialize(self):
        with self.transaction() as db:
            for statement in SCHEMA:
                db.execute(statement)

    def healthy(self) -> bool:
        with self.transaction() as db:
            return bool(db.one("SELECT 1 AS ok")["ok"])
