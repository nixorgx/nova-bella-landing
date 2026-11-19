import secrets
import time
import logging
import sqlite3
from collections import Counter, defaultdict
from contextlib import asynccontextmanager
from datetime import date, datetime, timezone
from uuid import uuid4
from zoneinfo import ZoneInfo
from threading import Lock

from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.exceptions import RequestValidationError
import psycopg

from .config import Settings
from .database import Database, utc_now
from .schemas import Credentials, CustomerCreate, CustomerUpdate, ProductCreate, ProductUpdate, SaleCreate
from .security import create_token, verify_password, verify_token


bearer = HTTPBearer(auto_error=False)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    database = Database(settings.database_url) if settings.database_url else None
    login_attempts: dict[str, list[float]] = {}
    login_lock = Lock()
    logger = logging.getLogger("nova_bella")

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        settings.validate()
        if settings.initialize_schema:
            database.initialize()
        elif not database.healthy():
            raise RuntimeError("Base de datos no disponible.")
        yield

    app = FastAPI(title="Nova Bella API", version="0.1.0", lifespan=lifespan,
                  description="API inicial para catálogo y operaciones administrativas. No habilita pagos.")
    app.add_middleware(CORSMiddleware, allow_origins=list(settings.allowed_origins),
                       allow_credentials=False, allow_methods=["GET", "POST", "PATCH", "DELETE"],
                       allow_headers=["Authorization", "Content-Type", "Idempotency-Key"], max_age=600)

    @app.exception_handler(RequestValidationError)
    async def invalid_request(request, exc):
        return JSONResponse(status_code=422, content={"detail": [
            {"loc": error["loc"], "type": error["type"], "msg": "Valor no válido."}
            for error in exc.errors()
        ]})

    async def database_error(request, exc):
        conflict = isinstance(exc, (sqlite3.IntegrityError, psycopg.IntegrityError))
        logger.warning("database_error type=%s", type(exc).__name__)
        return JSONResponse(status_code=409 if conflict else 503, content={
            "detail": "Conflicto de datos." if conflict else "Servicio temporalmente no disponible."
        }, headers={"Cache-Control": "no-store"})

    app.add_exception_handler(sqlite3.Error, database_error)
    app.add_exception_handler(psycopg.Error, database_error)

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-Request-ID"] = uuid4().hex
        if request.url.path.startswith("/api/v1/admin") or request.url.path.startswith("/api/v1/auth"):
            response.headers["Cache-Control"] = "no-store"
        return response

    def require_admin(credentials: HTTPAuthorizationCredentials | None = Depends(bearer)) -> str:
        if not credentials or credentials.scheme.lower() != "bearer" or not verify_token(credentials.credentials, settings.jwt_secret, settings.admin_email):
            raise HTTPException(status_code=401, detail="Sesión administrativa no válida.", headers={"WWW-Authenticate": "Bearer"})
        return settings.admin_email

    def audit(db, actor: str, operation: str, entity: str, entity_id: str):
        db.execute("INSERT INTO audit_events(id,actor,operation,entity,entity_id,happened_at) VALUES(?,?,?,?,?,?)",
                   (uuid4().hex, actor, operation, entity, entity_id, utc_now()))

    @app.get("/api/v1/health")
    def health():
        try:
            if database.healthy():
                return {"status": "ok", "service": "nova-bella-api", "version": "0.1.0"}
        except Exception:
            pass
        return JSONResponse(status_code=503, content={"status": "unavailable"})

    @app.post("/api/v1/auth/token")
    def sign_in(payload: Credentials, request: Request):
        key = request.client.host if request.client else 'unknown'
        now = time.monotonic()
        with login_lock:
            for address in list(login_attempts):
                recent = [moment for moment in login_attempts[address] if now - moment < 900]
                if recent:
                    login_attempts[address] = recent
                else:
                    del login_attempts[address]
            if len(login_attempts.get(key, [])) >= 5 or (key not in login_attempts and len(login_attempts) >= 1024):
                raise HTTPException(status_code=429, detail="Demasiados intentos. Espera unos minutos.", headers={"Retry-After": "900"})
            login_attempts.setdefault(key, []).append(now)
        email = payload.email.lower().strip()
        valid_email = secrets.compare_digest(email.encode(), settings.admin_email.encode())
        valid_password = verify_password(payload.password, settings.admin_password_hash)
        if not (valid_email and valid_password):
            logger.warning("admin_login_failed")
            raise HTTPException(status_code=401, detail="Credenciales incorrectas.")
        with login_lock:
            login_attempts.pop(key, None)
        logger.info("admin_login_success")
        return {"access_token": create_token(settings.admin_email, settings.jwt_secret, settings.token_minutes),
                "token_type": "bearer", "expires_in": settings.token_minutes * 60, "role": "admin"}

    @app.get("/api/v1/admin/me")
    def admin_me(actor: str = Depends(require_admin)):
        return {"email": actor, "role": "admin"}

    @app.get("/api/v1/public/products")
    def public_products(response: Response):
        with database.transaction() as db:
            rows = db.all("SELECT id,name,category,color,price_bs,description,image_url,updated_at FROM products WHERE status='published' ORDER BY updated_at DESC,name ASC")
        response.headers["Cache-Control"] = "no-store"
        return {"items": rows, "count": len(rows), "currency": "BOB"}

    @app.get("/api/v1/admin/products")
    def list_products(actor: str = Depends(require_admin)):
        with database.transaction() as db:
            rows = db.all("SELECT * FROM products WHERE status!='archived' ORDER BY updated_at DESC")
        return {"items": rows, "count": len(rows)}

    @app.post("/api/v1/admin/products", status_code=201)
    def create_product(payload: ProductCreate, actor: str = Depends(require_admin)):
        now, product_id = utc_now(), uuid4().hex
        with database.transaction() as db:
            db.execute("INSERT INTO products(id,name,category,color,price_bs,description,image_url,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
                       (product_id, payload.name, payload.category, payload.color, payload.price_bs,
                        payload.description, str(payload.image_url) if payload.image_url else None, payload.status, now, now))
            audit(db, actor, "create", "product", product_id)
            row = db.one("SELECT * FROM products WHERE id=?", (product_id,))
        return row

    @app.patch("/api/v1/admin/products/{product_id}")
    def update_product(product_id: str, payload: ProductUpdate, actor: str = Depends(require_admin)):
        changes = payload.model_dump(exclude_unset=True)
        if not changes:
            raise HTTPException(status_code=422, detail="No se enviaron cambios.")
        if any(value is None for key,value in changes.items() if key != "image_url"):
            raise HTTPException(status_code=422, detail="No se pueden vaciar los campos obligatorios.")
        if any(key in changes and isinstance(changes[key],str) and not changes[key].strip() for key in ("name","color")):
            raise HTTPException(status_code=422, detail="Nombre y color deben contener texto.")
        changes = {key:(str(value) if key=="image_url" and value is not None else value) for key,value in changes.items()}
        changes = {("price_bs" if key=="price_bs" else key):value for key,value in changes.items()}
        with database.transaction() as db:
            old = db.one("SELECT id FROM products WHERE id=? AND status!='archived'", (product_id,))
            if not old:
                raise HTTPException(status_code=404, detail="Producto no encontrado.")
            columns = ",".join(f"{key}=?" for key in changes)
            db.execute(f"UPDATE products SET {columns},updated_at=? WHERE id=?", (*changes.values(),utc_now(),product_id))
            audit(db, actor, "update", "product", product_id)
            row = db.one("SELECT * FROM products WHERE id=?", (product_id,))
        return row

    @app.delete("/api/v1/admin/products/{product_id}", status_code=204)
    def archive_product(product_id: str, actor: str = Depends(require_admin)):
        with database.transaction() as db:
            if not db.one("SELECT id FROM products WHERE id=? AND status!='archived'", (product_id,)):
                raise HTTPException(status_code=404, detail="Producto no encontrado.")
            db.execute("UPDATE products SET status='archived',updated_at=? WHERE id=?", (utc_now(),product_id))
            audit(db, actor, "archive", "product", product_id)
        return Response(status_code=204)

    @app.get("/api/v1/admin/customers")
    def list_customers(actor: str = Depends(require_admin)):
        with database.transaction() as db:
            customers = db.all("SELECT * FROM customers ORDER BY updated_at DESC")
            sales = db.all("SELECT customer_id,total_bs,sold_at FROM sales WHERE customer_id IS NOT NULL")
        grouped: dict[str,list] = defaultdict(list)
        for sale in sales:
            grouped[sale["customer_id"]].append(sale)
        for customer in customers:
            history = grouped.get(customer["id"], [])
            customer["purchases"] = len(history)
            customer["total_spent_bs"] = sum(row["total_bs"] for row in history)
            customer["last_purchase"] = max((row["sold_at"] for row in history), default=None)
        return {"items": customers, "count": len(customers)}

    @app.post("/api/v1/admin/customers", status_code=201)
    def create_customer(payload: CustomerCreate, actor: str = Depends(require_admin)):
        alias = payload.alias.strip()
        if not alias:
            raise HTTPException(status_code=422, detail="Alias vacío.")
        now, customer_id = utc_now(), uuid4().hex
        with database.transaction() as db:
            if db.one("SELECT id FROM customers WHERE lower(alias)=lower(?)", (alias,)):
                raise HTTPException(status_code=409, detail="Ya existe este alias.")
            db.execute("INSERT INTO customers(id,alias,preference,followup,note,next_contact,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
                       (customer_id, alias, payload.preference, "Pendiente", "", None, now, now))
            audit(db, actor, "create", "customer", customer_id)
            row = db.one("SELECT * FROM customers WHERE id=?", (customer_id,))
        return row

    @app.patch("/api/v1/admin/customers/{customer_id}")
    def update_customer(customer_id: str, payload: CustomerUpdate, actor: str = Depends(require_admin)):
        changes = payload.model_dump(exclude_unset=True)
        if not changes:
            raise HTTPException(status_code=422, detail="No se enviaron cambios.")
        if "next_contact" in changes and changes["next_contact"] is not None:
            changes["next_contact"] = changes["next_contact"].isoformat()
        with database.transaction() as db:
            if not db.one("SELECT id FROM customers WHERE id=?", (customer_id,)):
                raise HTTPException(status_code=404, detail="Perfil no encontrado.")
            columns=",".join(f"{key}=?" for key in changes)
            db.execute(f"UPDATE customers SET {columns},updated_at=? WHERE id=?", (*changes.values(),utc_now(),customer_id))
            audit(db, actor, "update", "customer", customer_id)
            row=db.one("SELECT * FROM customers WHERE id=?", (customer_id,))
        return row

    @app.get("/api/v1/admin/sales")
    def list_sales(limit: int = 100, actor: str = Depends(require_admin)):
        if limit < 1 or limit > 500:
            raise HTTPException(status_code=422, detail="Límite fuera de rango.")
        with database.transaction() as db:
            rows = db.all("SELECT * FROM sales ORDER BY sold_at DESC,created_at DESC LIMIT ?", (limit,))
        return {"items": rows, "count": len(rows)}

    @app.post("/api/v1/admin/sales", status_code=201)
    def create_sale(payload: SaleCreate, idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"), actor: str = Depends(require_admin)):
        if payload.sold_at > datetime.now(ZoneInfo('America/La_Paz')).date():
            raise HTTPException(status_code=422, detail="La venta no puede tener una fecha futura.")
        if idempotency_key is not None and not (8 <= len(idempotency_key) <= 128):
            raise HTTPException(status_code=422, detail="Idempotency-Key inválida.")
        sale_id=uuid4().hex
        def same_sale(existing):
            return (existing["product_id"] == payload.product_id
                    and existing["customer_id"] == payload.customer_id
                    and existing["quantity"] == payload.quantity
                    and existing["sold_at"] == payload.sold_at.isoformat())

        with database.transaction() as db:
            if idempotency_key:
                existing=db.one("SELECT * FROM sales WHERE idempotency_key=?", (idempotency_key,))
                if existing:
                    if not same_sale(existing):
                        raise HTTPException(status_code=409, detail="Idempotency-Key ya usada para otra venta.")
                    return existing
            product=db.one("SELECT * FROM products WHERE id=? AND status!='archived'", (payload.product_id,))
            if not product:
                raise HTTPException(status_code=404, detail="Producto no encontrado.")
            if payload.customer_id and not db.one("SELECT id FROM customers WHERE id=?", (payload.customer_id,)):
                raise HTTPException(status_code=404, detail="Perfil de cliente no encontrado.")
            total=product["price_bs"]*payload.quantity
            inserted = db.one("INSERT INTO sales(id,product_id,product_name,customer_id,quantity,unit_price_bs,total_bs,sold_at,created_at,idempotency_key) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(idempotency_key) DO NOTHING RETURNING id",
                       (sale_id,product["id"],product["name"],payload.customer_id,payload.quantity,
                        product["price_bs"],total,payload.sold_at.isoformat(),utc_now(),idempotency_key))
            if not inserted:
                existing = db.one("SELECT * FROM sales WHERE idempotency_key=?", (idempotency_key,))
                if not same_sale(existing):
                    raise HTTPException(status_code=409, detail="Idempotency-Key ya usada para otra venta.")
                return existing
            audit(db, actor, "create", "sale", sale_id)
            row=db.one("SELECT * FROM sales WHERE id=?", (sale_id,))
        return row

    @app.get("/api/v1/admin/analytics")
    def analytics(actor: str = Depends(require_admin)):
        with database.transaction() as db:
            sales=db.all("SELECT id,product_name,customer_id,quantity,total_bs,sold_at FROM sales ORDER BY sold_at")
            customers=db.all("SELECT id FROM customers")
        monthly=defaultdict(lambda: {"sales":0,"revenue_bs":0})
        ranking=Counter()
        frequency=Counter()
        for item in sales:
            group=monthly[item["sold_at"][:7]]
            group["sales"]+=1
            group["revenue_bs"]+=item["total_bs"]
            ranking[item["product_name"]]+=item["quantity"]
            if item["customer_id"]:
                frequency[item["customer_id"]]+=1
        revenue=sum(item["total_bs"] for item in sales)
        return {"revenue_bs":revenue,"sales_count":len(sales),"average_ticket_bs":round(revenue/len(sales)) if sales else 0,
                "customer_count":len(customers),"frequent_customers":sum(count>=5 for count in frequency.values()),
                "repeat_customers":sum(count>=2 for count in frequency.values()),
                "monthly":[{"month":month,**values} for month,values in sorted(monthly.items())],
                "top_products":[{"name":name,"units":units} for name,units in ranking.most_common(5)]}

    @app.get("/api/v1/admin/audit")
    def audit_log(actor: str = Depends(require_admin)):
        with database.transaction() as db:
            rows=db.all("SELECT actor,operation,entity,entity_id,happened_at FROM audit_events ORDER BY happened_at DESC LIMIT 100")
        return {"items":rows,"count":len(rows)}

    return app


app = create_app()
