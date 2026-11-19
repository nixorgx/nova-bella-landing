# Nova Bella · Backend inicial

Primera etapa de integración profesional entre la landing pública y el centro de control de Nova Bella.

## Alcance implementado

- API FastAPI con documentación OpenAPI (`/docs`).
- PostgreSQL 16 para productos, perfiles por alias, ventas y auditoría.
- Catálogo **público solo de lectura**: `GET /api/v1/public/products` devuelve únicamente los modelos publicados.
- API administrativa autenticada: productos, perfiles (sin datos personales), ventas, reportes y bitácora.
- Inicio administrativo mediante contraseña verificada con scrypt y tokens JWT de corta duración (30 minutos).
- CORS restringido a los orígenes permitidos; sin contraseñas, claves ni tokens en el repositorio.
- Archivado lógico de productos, para conservar referencias de ventas.
- Operaciones de venta idempotentes cuando se envía `Idempotency-Key`.
- Las tablas se inicializan al arrancar; antes del primer despliegue de producción habrá que introducir migraciones versionadas y copias de seguridad.

**No están implementados aún:** pagos, facturación fiscal, inventario por talla, autenticación de clientes, puntos de fidelización ni despliegue público HTTPS de la API. No cargar información personal real en el prototipo.

## Preparar Docker en Windows

1. Instalar y abrir Docker Desktop, comprobando que `docker compose version` responda.
2. Clonar el repositorio y entrar en `backend` desde PowerShell.
3. Copiar `.env.example` a `.env`:

   ```powershell
   Copy-Item .env.example .env
   ```

4. Generar las credenciales en un entorno Python con las dependencias instaladas:

   ```powershell
   python -m pip install -r requirements.txt
   python -m scripts.generate_secrets
   ```

   El script pedirá una contraseña administrativa y mostrará `JWT_SECRET` y `ADMIN_PASSWORD_HASH`. Copiar ambos valores a `.env`. Establecer un `POSTGRES_PASSWORD` aleatorio distinto (preferentemente alfanumérico, porque se usa dentro de una URL de conexión) y el correo de administración. No publicar ni enviar el `.env`.

5. Levantar los contenedores:

   ```powershell
   docker compose up --build -d
   docker compose ps
   ```

6. Comprobar:

   ```powershell
   Invoke-RestMethod http://127.0.0.1:8001/api/v1/health
   ```

   Abrir <http://127.0.0.1:8001/docs> para los endpoints.

La API se expone **solo en `127.0.0.1:8001`**. PostgreSQL usa `127.0.0.1:5434` para no interferir con la base de datos de Tunari Fire Monitor en el puerto 5432.

## Autenticación administrativa

`POST /api/v1/auth/token` acepta JSON `{ "email": "...", "password": "..." }` y devuelve un `access_token` temporal. Las rutas `/api/v1/admin/*` requieren `Authorization: Bearer <token>`. No guardar el token en `localStorage` ni insertarlo en código del sitio. En producción, el panel deberá acceder a estos endpoints a través de un backend con HTTPS y control de acceso; no exponer Docker directamente.

## Integración con ambos frontends

- **Landing:** `dist/api-config.js` del proyecto público incluye `window.NOVA_BELLA_API_URL = '';`. Cuando exista una API en un dominio HTTPS, editar la URL y desplegar esa revisión. Entonces la landing consultará `GET /api/v1/public/products` sin token; solo mostrará productos publicados.
- **Centro de control:** en «Conexiones y seguridad» está el formulario **Conectar catálogo de la tienda**. Introducir el dominio HTTPS de la API, el correo y la contraseña administrativa. Al autenticarse, las operaciones del módulo «Catálogo» irán al servidor. El token no persiste entre sesiones de navegador.
- **Modo de prueba:** si no hay dominio HTTPS configurado, **ambos sitios mantienen su comportamiento de demostración**. La API Docker local solo escucha en `127.0.0.1`: no conecta directamente con los Sites alojados en Internet. Hace falta un despliegue protegido.
- **Limitación de esta fase:** los módulos «Ventas», «Clientes frecuentes» y «Análisis» del centro de control siguen con datos ilustrativos, aunque existen endpoints iniciales en el backend. No se debe confundirlos con métricas reales.

### Siguientes tareas de producción

1. Desplegar esta API en un proveedor HTTPS y PostgreSQL administrado con copias de seguridad.
2. Configurar el dominio de API y permitir exclusivamente los orígenes definitivos.
3. Conectar el panel administrativo al dominio HTTPS, manteniendo credenciales fuera del repositorio y del almacenamiento persistente del navegador.
4. Importar y verificar el catálogo real, fotos, precios, tallas y existencias.
5. Migrar `localStorage` a la base de datos y crear roles de personal.
6. Incorporar autenticación de clientes, consentimiento, vinculación de compras presenciales y Rewards.

No publiques esta API con un `.env` de ejemplo ni almacenes datos personales antes de completar la revisión de seguridad y privacidad.
