"""Run the suite in a disposable PostgreSQL database, using the existing server.

Requires DATABASE_URL for an administrative connection. Does not print credentials.
Only the database and role created by this invocation are removed.
"""
import os
import secrets
import unittest
from urllib.parse import urlsplit, urlunsplit, quote
from uuid import uuid4

import psycopg
from psycopg import sql

from app.database import Database


def main():
    admin_url = os.environ['DATABASE_URL']
    source = urlsplit(admin_url)
    if source.scheme not in ('postgresql','postgres'):
        raise SystemExit('DATABASE_URL debe apuntar a PostgreSQL.')
    suffix=uuid4().hex
    name='nova_bella_test_'+suffix
    role='nova_bella_test_role_'+suffix
    password=secrets.token_urlsafe(48)
    database_created=role_created=False
    with psycopg.connect(admin_url,autocommit=True) as admin:
        try:
            admin.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(name)))
            database_created=True
            admin.execute(sql.SQL('CREATE ROLE {} LOGIN PASSWORD {} NOSUPERUSER NOCREATEDB NOCREATEROLE').format(sql.Identifier(role),sql.Literal(password)))
            role_created=True
            test_admin=urlunsplit(source._replace(path='/'+name))
            Database(test_admin).initialize()
            with psycopg.connect(test_admin) as setup:
                setup.execute(sql.SQL('GRANT USAGE ON SCHEMA public TO {}').format(sql.Identifier(role)))
                setup.execute(sql.SQL('GRANT SELECT, INSERT, UPDATE ON products, customers, sales TO {}').format(sql.Identifier(role)))
                setup.execute(sql.SQL('GRANT SELECT, INSERT ON audit_events TO {}').format(sql.Identifier(role)))
            host=source.hostname
            if ':' in host:
                host=f'[{host}]'
            netloc=f'{role}:{quote(password,safe="")}@{host}'+(f':{source.port}' if source.port else '')
            os.environ['NOVA_BELLA_TEST_DATABASE_URL']=urlunsplit(source._replace(netloc=netloc,path='/'+name))
            os.environ['NOVA_BELLA_TEST_ADMIN_URL']=test_admin
            suite=unittest.defaultTestLoader.discover('tests')
            result=unittest.TextTestRunner(verbosity=2).run(suite)
        finally:
            os.environ.pop('NOVA_BELLA_TEST_DATABASE_URL',None)
            os.environ.pop('NOVA_BELLA_TEST_ADMIN_URL',None)
            if database_created:
                admin.execute(sql.SQL('DROP DATABASE {}').format(sql.Identifier(name)))
            if role_created:
                admin.execute(sql.SQL('DROP ROLE {}').format(sql.Identifier(role)))
    print('Base y rol temporales retirados; base principal sin registros de prueba.')
    raise SystemExit(0 if result.wasSuccessful() else 1)


if __name__=='__main__':
    main()
