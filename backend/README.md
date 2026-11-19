# Nova Bella — API y base de datos

Backend de Nova Bella con **FastAPI + PostgreSQL 16**, ejecutado localmente mediante Docker Compose. Se utiliza junto con la landing pública y el centro de control. Esta carpeta no contiene la interfaz web; ver el [manual general](../README.md).

## Funciones del servidor

- Catálogo público de productos publicados: `GET /api/v1/public/products`.
- Administración con contraseña verificada mediante scrypt y tokens JWT temporales.
- Operaciones de productos, perfiles por alias, ventas, indicadores y auditoría mediante rutas protegidas `/api/v1/admin/*`.
- Archivado lógico de productos, claves opcionales de idempotencia al registrar ventas, validación de entradas y CORS limitado a orígenes autorizados.
- Una cuenta PostgreSQL de aplicación con permisos limitados y distinta de la cuenta que inicializa el esquema.

**Alcance actual:** el centro de control puede conectar **su catálogo** a esta API. Las pantallas de Ventas, Clientes frecuentes, Consultas y Análisis aún requieren integración para leer y guardar centralizadamente la información. Tampoco hay pagos, facturación fiscal, inventario por talla ni cuentas de clientes.

## Arranque local con recursos mínimos

Requisitos: Docker con Compose y Python 3 con las dependencias de `requirements.txt` para los scripts. Todos los comandos se ejecutan **dentro de `backend/`**; en Windows se puede usar PowerShell y en Linux/macOS una terminal.

1. Crear el archivo de configuración privado a partir de `.env.example`:

   - PowerShell: `Copy-Item .env.example .env`
   - Linux/macOS: `cp .env.example .env`

2. Instalar dependencias del script local y generar secretos con entrada oculta:

   ```bash
   python -m pip install -r requirements.txt
   python -m scripts.generate_secrets
   ```

   El script solicita correo y contraseña administrativos, genera una clave JWT y un hash scrypt y los guarda en `.env`. También configura `POSTGRES_PASSWORD` si todavía está sin generar. **No copiar secretos a GitHub ni enviarlos por chat.**

3. Iniciar únicamente PostgreSQL y esperar a que esté saludable:

   ```bash
   docker compose up -d postgres
   docker compose ps
   ```

4. Preparar las tablas, índices y el usuario restringido **en la base local de este proyecto**:

   ```bash
   python -m scripts.configure_local_database
   ```

   Esta operación utiliza el contenedor `nova-bella-postgres-1` y reemplaza `APP_DATABASE_PASSWORD` por un valor aleatorio. No está diseñada para ejecutarse contra servidores externos o bases compartidas.

5. Levantar solo la API:

   ```bash
   docker compose up -d --build api
   docker compose ps -a
   ```

Solo se necesitan **dos contenedores**: `api` y `postgres`. La configuración limita concurrencia y tamaño de logs, y no añade herramientas de monitoreo ni servicios extra. Ambos puertos se exponen únicamente en `127.0.0.1`.

## Comprobar el estado

| Dirección | Función |
| --- | --- |
| `http://127.0.0.1:8001/api/v1/health` | Estado de la API. Debe responder con `status: ok`. |
| `http://127.0.0.1:8001/docs` | Documentación interactiva de endpoints. |
| `127.0.0.1:5434` | PostgreSQL local, solo para conexiones autorizadas. |

```bash
docker compose ps -a
docker compose logs --tail=80 api
```

Si la API reinicia en bucle, revisar los logs y las variables privadas de `.env` (especialmente `JWT_SECRET`, `ADMIN_PASSWORD_HASH` y `APP_DATABASE_PASSWORD`).

Para detener ambos contenedores **sin borrar la base**:

```bash
docker compose down
```

**No ejecutar `docker compose down -v` sin un respaldo comprobado:** puede eliminar el volumen PostgreSQL.

## Pruebas

```bash
python -m pip install -r requirements-dev.txt
python -m unittest discover -s tests -v
```

Las pruebas de la revisión incluyen 14 casos; dos verificaciones específicas de PostgreSQL se omiten en la ejecución ordinaria sin base de pruebas. También existe `scripts/test_postgres.py` para validar permisos y concurrencia en una **base temporal aislada**. Ese script crea y elimina exclusivamente su base y rol de prueba, pero requiere una URL de mantenimiento y no se debe ejecutar contra infraestructura ajena ni sin respaldo y autorización.

## Uso con las interfaces

- **Landing:** introducir únicamente la URL pública HTTPS del backend en `dist/api-config.js` de la tienda, sin tokens ni claves. Si no hay API configurada, la landing conserva su catálogo visual incorporado.
- **Centro de control:** en «Conexiones y seguridad», introducir la URL de la misma API HTTPS y credenciales administrativas. El token solo permanece en memoria durante la sesión; la conexión actual sincroniza el módulo Catálogo.
- `http://127.0.0.1:8001` **no es una URL remota**: el Site publicado no puede utilizar la API local de otra computadora. El despliegue HTTPS y la base central requieren una configuración independiente.

## Seguridad y lanzamiento

- No subir `.env`, respaldos, contraseñas, tokens ni datos personales a este repositorio.
- Mantener CORS limitado a las direcciones verificadas y requerir JWT para rutas de administración.
- No conceder DDL, DELETE ni privilegios de superusuario a la cuenta de aplicación.
- El archivo `../render.yaml` prepara una configuración de prueba HTTPS, pero **no crea ni acredita un despliegue remoto**.
- Ver [`PRODUCCION.md`](PRODUCCION.md) para los requisitos pendientes de base de datos administrada, certificados, respaldos, políticas de acceso y comprobaciones reales antes del uso comercial.

Esta guía describe los archivos incluidos en el repositorio, no los ajustes de un equipo particular.
