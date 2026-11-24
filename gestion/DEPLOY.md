# Despliegue: Neon (Postgres) + Vercel (Next.js)

Guía corta y en orden. Los comandos de `npm run db:*` se corren **desde su computadora**, apuntando a Neon; Vercel solo ejecuta la aplicación (las migraciones **no** corren en el build).

## 0. Qué se necesita
- Cuenta en Neon y en Vercel, y el repositorio publicado en GitHub.
- Node 22 o superior y este proyecto con `npm install`.
- Cuatro secretos largos y aleatorios (>= 32 caracteres) y tres contraseñas para los logins de la base:
  `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`

## 1. Neon: crear la base
1. Proyecto nuevo, región cercana a la de Vercel (para Bolivia: `aws-sa-east-1`, São Paulo), base `inventario`.
2. Copie dos cadenas de conexión del dueño de la base (el rol por defecto, **no superusuario**):
   - **directa** (`ep-xxxx.region.aws.neon.tech`): para migraciones y bootstrap.
   - **pooled** (`ep-xxxx-pooler...`): para la aplicación en Vercel (PgBouncer en modo transacción es compatible: la identidad de cada petición se fija con `set_config(..., true)` dentro de la transacción).
3. Neon exige TLS: agregue `?sslmode=require` a cada URL.

## 2. Preparar `.env.local` (solo en su computadora, nunca en git)
```
DATABASE_URL=postgres://<dueño>:<clave>@<host-directo>/inventario?sslmode=require
DATABASE_URL_SELLER=postgres://app_runtime_seller:<clave-1>@<host-pooled>/inventario?sslmode=require
DATABASE_URL_SUPERADMIN=postgres://app_runtime_superadmin:<clave-2>@<host-pooled>/inventario?sslmode=require
DATABASE_URL_AUTH=postgres://app_runtime_auth:<clave-3>@<host-pooled>/inventario?sslmode=require
DATABASE_URL_PUBLIC=postgres://app_runtime_public:<clave-4>@<host-pooled>/inventario?sslmode=require
ORDER_TOKEN_SECRET=<secreto-3>
SESSION_SECRET=<secreto-1>
DB_CONTEXT_SECRET=<secreto-2>
BOOTSTRAP_SUPERADMIN_USERNAME=naty
BOOTSTRAP_SUPERADMIN_PASSWORD=<clave larga de Naty>
BOOTSTRAP_BRANCHES=Central:Santa Cruz;La Paz:La Paz:inactiva
```
El rol interno `app_definer` se crea con `BYPASSRLS` si el dueño puede; si el proveedor lo prohíbe (puede pasar en Neon), el migrador lo detecta, crea el rol sin ese atributo y agrega políticas equivalentes: no hace falta intervenir. Para forzar un modo use `APP_DEFINER_BYPASSRLS=true|false`. **Verifique que `db:migrate` termine sin error** en su primer despliegue real. Verificado en Neon real (migraciones 001 a 017 y el flujo de ventas, cambios, anulaciones, cajas, sucursales y Excel): en modo `BYPASSRLS` (lo que Neon aceptó) y en modo políticas (`APP_DEFINER_BYPASSRLS=false`, 24 políticas `definer_all`).

## 3. Crear el esquema y el primer superadmin (sin datos de demo)
```bash
npm run db:migrate      # crea tablas, roles de runtime y aplica sus contraseñas
npm run db:bootstrap    # superadmin + sucursales + configuración. NO inserta demo
```
`db:bootstrap` es repetible: si el superadmin ya existe no toca su contraseña (use `-- --reset-password` para cambiarla).
**No** corra `db:seed` ni `db:reset` contra producción (el seed se niega con `NODE_ENV=production`; `db:reset` solo corre en bases locales).

## 4. Vercel: crear el proyecto
1. *Add New → Project*, importe el repositorio. Framework: Next.js. Build: `npm run build` (por defecto).
2. Variables de entorno (Production y Preview si lo desea):
   | Variable | Valor |
   |---|---|
   | `DATABASE_URL_SELLER`, `DATABASE_URL_SUPERADMIN`, `DATABASE_URL_AUTH`, `DATABASE_URL_PUBLIC` | las cuatro URL **pooled** del paso 2 |
   | `ORDER_TOKEN_SECRET` | el secreto-3 (clave del enlace privado de cada pedido; no cambiarlo después: los enlaces enviados dejarían de abrir) |
   | `SESSION_SECRET`, `DB_CONTEXT_SECRET` | los mismos del paso 2 (el de contexto **debe coincidir** con el guardado en la base por `db:migrate`) |
   | `TRUST_PROXY` | `1` (Vercel pone la IP real en `X-Forwarded-For`; así los límites de login y de la tienda distinguen IPs) |
   | `COOKIE_SECURE` | no definir (en producción es `true`) |
   No cargue `DATABASE_URL` (la del dueño) en Vercel: la aplicación nunca la usa.
3. Región de las funciones: la más cercana a Neon (*Settings → Functions*).
4. Deploy. Pruebe `https://<su-dominio>/login` con el superadmin del bootstrap.

## 5. Dominio y HTTPS
Agregue el dominio en *Settings → Domains*. HSTS y cookies `Secure` ya vienen activos en producción.

## 6. Cada actualización
1. Hacer `git push` a la rama principal (Vercel despliega solo).
2. Si hay migraciones nuevas: **antes** de promover el despliegue, `npm run db:migrate` con el `.env.local` de producción. Las migraciones son aditivas; nunca se editan las ya aplicadas.

## 7. Revisión después del primer despliegue
- [ ] Ingresa el superadmin; el vendedor de prueba (creado en *Usuarios*) ve solo su sucursal.
- [ ] El vendedor recibe 403/redirección en `/compras`, `/sucursales`, `/cajas`.
- [ ] *Reportes → Descargar Excel* funciona (el `.xlsx` se genera en el servidor).
- [ ] Encabezados: `curl -sI https://<dominio>/login` muestra `content-security-policy` con nonce y `strict-transport-security`.

Más detalle técnico (roles, secretos, respaldos): `docs/ADMIN-TECNICO.md`.

## 8. Tienda online (Etapa 2)
- Tras `db:migrate` (migraciones 019 a 021) el rol `app_runtime_public` queda con LOGIN y la clave de `DATABASE_URL_PUBLIC`.
- `db:bootstrap` deja la tienda **cerrada** y sin modelos publicados. Para abrirla: iniciar sesión como superadmin, *Tienda online* (WhatsApp, zonas, recojo, QR, instrucciones de pago), publicar modelos con sus fotos desde *Catálogo* y activar "Tienda abierta".
- Nunca ejecute `db:seed` (datos y QR DEMO) contra producción real.
- El modo de `app_definer` es el mismo de siempre (`BYPASSRLS` si el proveedor lo permite; si no, políticas `definer_all`, que `db:migrate` agrega también a las tablas nuevas). Probar el modo alternativo: levantar un clúster local nuevo y correr `APP_DEFINER_BYPASSRLS=false npm test` con `TEST_DATABASE_URL` y las URL de runtime apuntando a él.
- Vercel: las imágenes y comprobantes viajan en acciones de servidor (límite de cuerpo 4,4 MB configurado en `next.config.ts`; Vercel corta en 4,5 MB).
