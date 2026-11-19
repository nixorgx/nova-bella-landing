import tempfile
import unittest
import os
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo
from urllib.parse import urlsplit

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.security import hash_password, verify_password
from app.database import Database


class ApiIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        db = Path(self.tmp.name) / "nova.sqlite3"
        test_url = os.getenv("NOVA_BELLA_TEST_DATABASE_URL")
        if test_url:
            if not urlsplit(test_url).path.startswith('/nova_bella_test_'):
                raise RuntimeError('Las pruebas PostgreSQL requieren una base temporal nova_bella_test_.')
            with Database(os.environ['NOVA_BELLA_TEST_ADMIN_URL']).transaction() as session:
                session.execute('TRUNCATE audit_events, sales, customers, products')
        settings = Settings(database_url=test_url or f"sqlite:///{db}", jwt_secret="t" * 48,
                            admin_email="admin@example.test", admin_password_hash=hash_password("correcthorsebatterystaple"),
                            allowed_origins=("http://localhost:5173",), initialize_schema=not bool(test_url))
        self.settings = settings
        self.client = TestClient(create_app(settings))
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.tmp.cleanup()

    def admin_headers(self):
        response = self.client.post("/api/v1/auth/token", json={"email": "admin@example.test", "password": "correcthorsebatterystaple"})
        self.assertEqual(response.status_code, 200)
        return {"Authorization": f"Bearer {response.json()['access_token']}"}

    def test_health_and_protected_routes(self):
        self.assertEqual(self.client.get("/api/v1/health").json()["status"], "ok")
        self.assertEqual(self.client.get("/api/v1/admin/products").status_code, 401)
        self.assertEqual(self.client.post("/api/v1/auth/token", json={"email": "admin@example.test", "password": "bad"}).status_code, 401)
        self.assertEqual(self.client.get("/api/v1/admin/me", headers=self.admin_headers()).json()["role"], "admin")

    def test_public_catalog_and_sales(self):
        headers = self.admin_headers()
        product = {"name":"Alba Slingback","category":"Tacones","color":"Marfil","price_bs":429,"status":"draft"}
        created = self.client.post("/api/v1/admin/products", json=product, headers=headers)
        self.assertEqual(created.status_code, 201, created.text)
        item = created.json()
        self.assertEqual(self.client.get("/api/v1/public/products").json()["count"], 0)
        updated = self.client.patch(f"/api/v1/admin/products/{item['id']}", json={"status":"published"}, headers=headers)
        self.assertEqual(updated.status_code, 200)
        public = self.client.get("/api/v1/public/products").json()
        self.assertEqual(public["count"], 1)
        self.assertEqual(public["items"][0]["price_bs"], 429)
        self.assertNotIn("status", public["items"][0])
        customer = self.client.post("/api/v1/admin/customers", json={"alias":"Cliente 001"}, headers=headers)
        self.assertEqual(customer.status_code, 201)
        sale_body = {"product_id":item["id"],"customer_id":customer.json()["id"],"quantity":2,"sold_at":datetime.now(ZoneInfo('America/La_Paz')).date().isoformat()}
        sale_headers={**headers,"Idempotency-Key":"test-venta-0001"}
        sale=self.client.post("/api/v1/admin/sales", json=sale_body, headers=sale_headers)
        self.assertEqual(sale.status_code, 201, sale.text)
        self.assertEqual(sale.json()["total_bs"], 858)
        duplicate=self.client.post("/api/v1/admin/sales", json=sale_body, headers=sale_headers)
        self.assertEqual(duplicate.json()["id"], sale.json()["id"])
        report=self.client.get("/api/v1/admin/analytics",headers=headers).json()
        self.assertEqual(report["sales_count"],1)
        self.assertEqual(report["revenue_bs"],858)
        customer_list=self.client.get("/api/v1/admin/customers",headers=headers).json()
        self.assertEqual(customer_list["items"][0]["purchases"],1)
        self.assertEqual(self.client.delete(f"/api/v1/admin/products/{item['id']}", headers=headers).status_code, 204)
        self.assertEqual(self.client.get("/api/v1/public/products").json()["count"],0)
        self.assertEqual(self.client.get("/api/v1/admin/audit",headers=headers).json()["count"],5)

    def test_cors_only_allows_listed_origins(self):
        accepted=self.client.options("/api/v1/public/products", headers={"Origin":"http://localhost:5173","Access-Control-Request-Method":"GET"})
        rejected=self.client.options("/api/v1/public/products", headers={"Origin":"https://other.example","Access-Control-Request-Method":"GET"})
        self.assertEqual(accepted.headers.get("access-control-allow-origin"),"http://localhost:5173")
        self.assertIsNone(rejected.headers.get("access-control-allow-origin"))

    def test_password_hash(self):
        encoded=hash_password("a-very-long-secret")
        self.assertTrue(verify_password("a-very-long-secret",encoded))
        self.assertFalse(verify_password("wrong",encoded))


if __name__ == "__main__":
    unittest.main()
