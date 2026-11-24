# Nova Bella — Integración de la landing con el sistema de gestión del equipo

**Objetivo:** conservar la landing de Nova Bella (diseño, hero, animaciones, lookbook, cartas, fotos) y sustituir el centro de control anterior por el sistema de inventario y ventas de `novaBella_Tienda-main.zip`.

## Qué se integró

- `dist/` sigue siendo la landing original. El script `tools/apply-landing-integration.mjs` adapta su catálogo sin sustituir el HTML ni las fotografías.
- `gestion/` contiene **íntegramente el sistema Next.js + PostgreSQL de tu compañero** (inventario, tallas/colores, lotes, tipos de cambio, costos, POS, cambios, usuarios, reportes, tienda web y pedidos).
- `gestion/src/app/api/v1/public/products/route.ts` publica **solo** los productos de venta autorizados por el mismo origen de datos de la tienda del equipo. No expone costos, clientes ni ventas.
- La landing recibe modelos, fotos, precios y disponibilidad por talla desde ese endpoint, con filtros que usan las líneas reales; el botón «Elegir talla y comprar» abre la ficha del producto en `/tienda/{slug}` del sistema nuevo.
- **No hay dos inventarios sincronizándose:** el inventario y el precio real se guardan solo en PostgreSQL del sistema nuevo. La compra y el descuento de stock se realizan en ese sistema, no en JavaScript de la landing.
- Los directorios originales `admin/` y `backend/` pueden permanecer en GitHub **para histórico/rollback**. No son el sistema operativo vigente y no deben desplegarse para uso de la tienda.

## Cómo incorporarlo al repositorio existente

1. Haz una copia de seguridad de tu repositorio actual y comprueba `git status`. No uses `git reset --hard`.
2. **Descomprime este paquete en la raíz del repositorio existente** `nova-bella-landing/`, de modo que queden `gestion/`, `tools/`, `dist/api-config.js` y este README a nivel raíz. No descomprimas un directorio externo extra.
3. Con Node.js 22+ instalado, desde la raíz ejecuta:

   ```powershell
   node tools/apply-landing-integration.mjs
   node --check dist/script.js
   node tools/check-integration.mjs
   ```

4. El script conserva la landing y modifica su código JS de catálogo, añadiendo el enlace de compra y la lectura del inventario del sistema nuevo. Es **idempotente**: una segunda ejecución no duplica los cambios.
5. Para guardar todo el proyecto en GitHub, inspecciona `git diff`, verifica que no haya credenciales y ejecuta:

   ```powershell
   git add dist/script.js dist/styles.css dist/api-config.js gestion tools README-INTEGRACION.md
   git status --short
   git commit -m "feat: integrar landing con sistema de inventario del equipo"
   git push origin main
   ```

No agregues `.env`, `.env.local`, archivos de datos de Postgres ni claves. El repositorio actual conserva un README general antiguo: este documento indica la nueva arquitectura; puedes actualizar el README general después de completar el despliegue.

## Pruebas locales sin duplicar el antiguo backend

El sistema nuevo necesita **su propio esquema PostgreSQL** (no es compatible con las tablas de FastAPI). No debes apuntar sus migraciones a la base de datos del backend viejo.

1. En `gestion/`, copia `.env.docker.example` como `.env` y genera una contraseña fuerte para `POSTGRES_PASSWORD`.
2. Si no tienes una base Postgres 17 dedicada, ejecuta `docker compose up -d postgres` **desde `gestion/`**. Solo crea un contenedor Postgres 17 en `127.0.0.1:5435`; no inicia Redis ni otro servidor.
3. Copia `gestion/.env.example` como `gestion/.env.local`. Configura **todas** las URLs de `DATABASE_URL*` para `localhost:5435` con contraseñas coincidentes, incluyendo `DATABASE_URL_PUBLIC`. `DATABASE_URL` es solo para migración; la aplicación usa roles de mínimo privilegio. Genera `SESSION_SECRET`, `DB_CONTEXT_SECRET`, `ORDER_TOKEN_SECRET` y las contraseñas de los roles con un generador criptográfico; no publiques su valor.
4. Desde `gestion/` ejecuta:

   ```powershell
   npm ci
   npm run db:migrate
   npm run db:bootstrap
   npm run dev
   ```

5. Abre `http://localhost:3000/login` (gestión) y `http://localhost:3000/tienda` (carrito/checkout). Para probar la landing **localmente**, cambia temporalmente `dist/api-config.js` a `window.NOVA_BELLA_API_URL = 'http://localhost:3000';`, abre la landing con `python -m http.server 5173 --directory dist` desde la raíz, y entra a `http://localhost:5173`.
6. En administración, registra modelos, variantes, stock y publica los modelos; sin ellos, el catálogo público estará vacío. `db:bootstrap` no crea información ficticia. **No ejecutes `db:seed` ni `db:reset` contra datos reales.**

### Validaciones de integración

- `GET http://localhost:3000/api/v1/public/products` debe entregar `items` públicos.
- Publica un modelo con una foto y tallas desde `/catalogo` y confirma que aparece en la landing tras recargar; los productos no publicados no deberían aparecer.
- Comprueba que el botón de compra lleva a `/tienda/{slug}`; en ese flujo la disponibilidad se valida otra vez contra la base de datos antes de completar el pedido.
- Simula una operación **solo en una base de prueba** y verifica en `/stock` y `/pedidos` que el estado corresponde.
- Accede como vendedor: no debe poder abrir compras, costos, rentabilidad privada ni gestión de usuarios. Los permisos deben verificarse en el servidor, no solo en menús.
- Ejecuta `npm test` y, con el entorno de pruebas preparado, `npm run test:e2e` desde `gestion/`. No se afirma que pasaron aquí: este entorno no tenía las dependencias npm ni una base Postgres disponible.

## Despliegue público

El código **no publica por sí solo** una base de datos ni una nueva aplicación HTTPS. Para activar la conexión remota:

1. Despliega `gestion/` como proyecto Next.js, por ejemplo en Vercel, estableciendo **Root Directory** `gestion`. Configura una base Postgres dedicada (Neon u otro proveedor compatible), crea secretos en el proveedor y ejecuta migraciones y bootstrap con permisos de mantenimiento, siguiendo `gestion/DEPLOY.md`. No cargues `DATABASE_URL` del propietario en el runtime.
2. En el proyecto Next configura `NOVA_BELLA_LANDING_ORIGIN` con el **origen exacto** de la landing publicada (por defecto ya admite `https://nova-bella-boutique-2026.keenorbit34.chatgpt.site`).
3. En `dist/api-config.js`, después del despliegue, sustituye la cadena vacía por la **URL HTTPS real del sistema nuevo**, por ejemplo:

   ```js
   window.NOVA_BELLA_API_URL = 'https://TU-DOMINIO-DE-GESTION';
   ```

4. Publica **la landing actualizada** en su alojamiento. Hacer `git push` no actualiza automáticamente el Site de ChatGPT. Si cambias de alojamiento, actualiza también el CORS permitido (`NOVA_BELLA_LANDING_ORIGIN`).
5. Verifica el flujo en vivo (modelo publicado → landing → ficha de producto → carrito → pedido → gestión → venta/stock). No inventes precios, fotos o QR: deben ser datos reales autorizados por la boutique.

## Seguridad y límites actuales

- La API pública es **GET anónimo y de solo lectura**, utilizando el rol restringido `app_runtime_public` del sistema de tu compañero; **no** ofrece endpoints de creación o edición de inventario.
- `Access-Control-Allow-Origin` solo se devuelve para la landing autorizada y los orígenes locales de desarrollo. CORS no reemplaza el control de acceso al backend; los costos nunca se seleccionan para el catálogo público.
- El panel del equipo requiere login y se beneficia de roles más estrictos, incluida la separación de vendedores y superadministrador. La seguridad real depende también de configurar correctamente la base de datos y los secretos al desplegar.
- QR bancario, pago con tarjeta y facturación electrónica: respeta el alcance documentado por el equipo (`gestion/GUIA-TIENDA.md`); **no** marques como conectado a un banco o al SIN un flujo aún manual.
- El nuevo sistema incluye una tienda en `/tienda`; la landing funciona como portada editorial de acceso. No dupliques un segundo carrito ni mantengas dos precios distintos.
- **No uses el `backend/` FastAPI antiguo** como fuente de inventario ni el `admin/` antiguo para cargar ventas nuevas; ambos podrían generar datos divergentes.

## Resumen de la arquitectura

```text
Landing editorial (dist, la tuya)
   ├── GET /api/v1/public/products  ──> Next.js gestion/ ──> public_*() ──> PostgreSQL
   └── Comprar /tienda/<modelo>     ──> Next.js gestion/ ──> carrito / pedido

Personal / propietario  ──> /login ──> Next.js gestion/ ──> roles + funciones SQL ──> PostgreSQL
```

**Estado de esta entrega:** archivos integrados y puente de catálogo implementado; falta instalar en el repositorio local, disponer de Postgres para pruebas end-to-end, subir los archivos a GitHub y desplegar el sistema nuevo para que la landing pública consulte datos reales.
