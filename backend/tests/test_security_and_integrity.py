import os
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from zoneinfo import ZoneInfo

import jwt
import psycopg

from app.database import Database
from tests import test_api as original


class SecurityAndIntegrityTests(unittest.TestCase):
    setUp = original.ApiIntegrationTests.setUp
    tearDown = original.ApiIntegrationTests.tearDown
    admin_headers = original.ApiIntegrationTests.admin_headers

    def product(self, headers, **changes):
        body = dict(name='Modelo de prueba', category='Tacones', color='Marfil', price_bs=429)
        body.update(changes)
        response = self.client.post('/api/v1/admin/products', json=body, headers=headers)
        self.assertEqual(response.status_code, 201)
        return response.json()

    def test_every_admin_route_requires_auth(self):
        spec = self.client.get('/openapi.json').json()
        for path, methods in spec['paths'].items():
            if path.startswith('/api/v1/admin/'):
                for method in methods:
                    response = self.client.request(method, path.replace('{product_id}', 'unknown').replace('{customer_id}', 'unknown'), json={})
                    self.assertEqual(response.status_code, 401, (method, path))

    def test_expired_tampered_and_incorrect_claims(self):
        now = datetime.now(timezone.utc)
        claims = dict(sub=self.settings.admin_email, role='admin', iat=now, exp=now+timedelta(minutes=5))
        variants = [dict(claims, exp=now-timedelta(seconds=1)), dict(claims, role='customer'),
                    dict(claims, sub='other@example.test'), {k:v for k,v in claims.items() if k != 'exp'}]
        tokens = [jwt.encode(item, self.settings.jwt_secret, algorithm='HS256') for item in variants]
        tokens.append(jwt.encode(claims, 'different-key-' * 4, algorithm='HS256'))
        for token in tokens:
            self.assertEqual(self.client.get('/api/v1/admin/me', headers={'Authorization':f'Bearer {token}'}).status_code, 401)
        result = self.client.post('/api/v1/auth/token', json={'email': self.settings.admin_email, 'password':'correcthorsebatterystaple'})
        self.assertEqual(result.json()['expires_in'], 1800)
        self.assertEqual(result.headers['cache-control'], 'no-store')

    def test_rate_limit_cannot_rotate_email_or_forwarded_header(self):
        for n in range(5):
            response = self.client.post('/api/v1/auth/token', json={'email':f'user{n}@example.test','password':'incorrect'}, headers={'X-Forwarded-For':f'192.0.2.{n}'})
            self.assertEqual(response.status_code, 401)
        result = self.client.post('/api/v1/auth/token', json={'email':'other@example.test','password':'incorrect'})
        self.assertEqual(result.status_code, 429)
        self.assertIn('retry-after', result.headers)

    def test_unicode_login_and_redacted_validation(self):
        result = self.client.post('/api/v1/auth/token', json={'email':'ñ@example.test','password':'incorrect'})
        self.assertEqual(result.status_code, 401)
        marker = 'PRIVATE_INPUT_' * 100
        result = self.client.post('/api/v1/auth/token', json={'email':self.settings.admin_email,'password':marker})
        self.assertEqual(result.status_code, 422)
        self.assertNotIn(marker, result.text)
        self.assertNotIn('input', result.json()['detail'][0])

    def test_validation_and_hidden_archived_products(self):
        headers = self.admin_headers()
        item = self.product(headers)
        for changes in ({'price_bs':0}, {'price_bs':True}, {'price_bs':2.5}, {'name':'  '},
                        {'category':'Invalid'}, {'color':None}, {'unexpected':'value'}, {'image_url':'javascript:alert(1)'}):
            result = self.client.patch('/api/v1/admin/products/'+item['id'], json=changes, headers=headers)
            self.assertEqual(result.status_code, 422, changes)
        for status, count in [('published',1),('draft',0),('published',1),('archived',0)]:
            response = self.client.patch('/api/v1/admin/products/'+item['id'], json={'status':status}, headers=headers)
            self.assertEqual(response.status_code, 200)
            public = self.client.get('/api/v1/public/products')
            self.assertEqual(public.json()['count'], count)
            self.assertEqual(public.headers['cache-control'], 'no-store')
        self.assertEqual(self.client.get('/api/v1/admin/products',headers=headers).json()['count'],0)
        self.assertEqual(self.client.post('/api/v1/public/products',json={}).status_code,405)

    def test_customer_integrity_and_sql_parameters(self):
        headers = self.admin_headers()
        alias = "Client'); DROP TABLE products; --"
        result = self.client.post('/api/v1/admin/customers',json={'alias':alias},headers=headers)
        self.assertEqual(result.status_code,201)
        item = result.json()
        self.assertEqual(item['alias'],alias)
        self.assertEqual(self.client.post('/api/v1/admin/customers',json={'alias':alias.upper()},headers=headers).status_code,409)
        for field in ('note','followup','preference'):
            response = self.client.patch('/api/v1/admin/customers/'+item['id'],json={field:None},headers=headers)
            self.assertEqual(response.status_code,422)
        self.assertEqual(self.client.patch('/api/v1/admin/customers/'+item['id'],json={'next_contact':None},headers=headers).status_code,200)
        self.assertEqual(self.client.get('/api/v1/admin/products',headers=headers).status_code,200)

    def test_sales_idempotency_conflict_and_failed_write(self):
        headers=self.admin_headers()
        item=self.product(headers)
        body=dict(product_id=item['id'],quantity=2,sold_at=datetime.now(ZoneInfo('America/La_Paz')).date().isoformat())
        sale_headers={**headers,'Idempotency-Key':'same-sale-test'}
        first=self.client.post('/api/v1/admin/sales',json=body,headers=sale_headers)
        self.assertEqual(first.status_code,201)
        duplicate=self.client.post('/api/v1/admin/sales',json=body,headers=sale_headers)
        self.assertEqual(first.json()['id'],duplicate.json()['id'])
        self.assertEqual(self.client.post('/api/v1/admin/sales',json={**body,'quantity':3},headers=sale_headers).status_code,409)
        self.assertEqual(self.client.post('/api/v1/admin/sales',json={**body,'customer_id':'missing'},headers=headers).status_code,404)
        self.assertEqual(self.client.get('/api/v1/admin/analytics',headers=headers).json()['sales_count'],1)
        self.assertEqual(self.client.get('/api/v1/admin/audit',headers=headers).json()['count'],2)

    @unittest.skipUnless(os.getenv('NOVA_BELLA_TEST_DATABASE_URL'), 'PostgreSQL concurrency')
    def test_concurrent_sale_is_recorded_once(self):
        headers={**self.admin_headers(),'Idempotency-Key':'concurrent-sale-test'}
        item=self.product(headers)
        body=dict(product_id=item['id'],quantity=1,sold_at=datetime.now(ZoneInfo('America/La_Paz')).date().isoformat())
        with ThreadPoolExecutor(max_workers=4) as pool:
            responses=list(pool.map(lambda _:self.client.post('/api/v1/admin/sales',json=body,headers=headers),range(4)))
        self.assertEqual([r.status_code for r in responses],[201]*4)
        self.assertEqual(len({r.json()['id'] for r in responses}),1)
        self.assertEqual(self.client.get('/api/v1/admin/analytics',headers=headers).json()['sales_count'],1)

    def test_database_failures_do_not_expose_details(self):
        with patch.object(Database,'connect',side_effect=psycopg.OperationalError('private database details')):
            result=self.client.get('/api/v1/public/products')
            self.assertEqual(result.status_code,503)
            self.assertNotIn('private',result.text)
            self.assertEqual(self.client.get('/api/v1/health').status_code,503)

    @unittest.skipUnless(os.getenv('NOVA_BELLA_TEST_DATABASE_URL'), 'PostgreSQL role permissions')
    def test_runtime_role_has_no_ddl_or_superuser_access(self):
        with Database(self.settings.database_url).transaction() as db:
            role=db.one('SELECT rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname=current_user')
            self.assertFalse(any(role.values()))
        with self.assertRaises(psycopg.errors.InsufficientPrivilege):
            with Database(self.settings.database_url).transaction() as db:
                db.execute('CREATE TABLE forbidden_test(id integer)')
