# Administración técnica — Inventario Naty

Resumen para quien mantiene el sistema. Detalle de seguridad y reglas de negocio: `README.md`. Despliegue paso a paso: `DEPLOY.md`.

## 1. Arquitectura
- **Next.js 16** (App Router, render por petición: el CSP lleva un *nonce* por solicitud, por eso no hay prerender estático) + TypeScript estricto + Tailwind 4.
- **Postgres 17** (local en desarrollo, Neon en producción). Sin ORM: SQL parametrizado con `pg`. Las operaciones críticas (venta, compra, cambio, anulación, transferencia) son **funciones Postgres transaccionales**.
- **Autenticación propia**: bcrypt + cookie JWT firmada (`jose`), 12 h, `HttpOnly`, `SameSite=Lax`, `Secure` en producción. En cada petición se revalida contra la base (`token_version`).
- **Carpetas**: `src/features/<área>` (acciones, consultas, UI de cada módulo), `src/components` (UI compartida), `src/lib` (db, auth, dinero, formato), `db/migrations` (SQL numerado), `scripts` (migrar, sembrar, bootstrap, limpiar, Lighthouse), `tests` (Vitest unitarias y de base de datos), `e2e` (Playwright).
- **Excel**: `exceljs` en el servidor (nunca `xlsx`). Gráficos: Recharts. Códigos: `bwip-js`, `qrcode`, `@zxing/browser`.

## 2. Modelo de roles
| Rol | Acceso |
|---|---|
| `superadmin` | Todo: catálogo, compras (costos), cajas, reportes con utilidad, sucursales, transferencias, usuarios. Ve todas las sucursales o elige una con `?sucursal=`. |
| `seller` | Punto de venta, clientes, stock, “mis ventas” y su caja, **solo de su sucursal**. Nunca ve costos. En la tienda web: ve los *pedidos web* de su sucursal y solo marca en camino / listo / entregado (no confirma pagos, no cancela, no ve comprobantes ni ajustes). |
| `public` (anónimo) | Login `app_runtime_public`: sin acceso a ninguna tabla; solo `EXECUTE` sobre `public_*()` que devuelven columnas seguras y crean pedidos. Ver `docs/TIENDA.md`. |

El rol se aplica en la base, no solo en la interfaz: cada petición corre en un pool de un login distinto (`app_runtime_seller`, `app_runtime_superadmin`, `app_runtime_auth`) con GRANT mínimos y RLS por sucursal. Las funciones `SECURITY DEFINER` pertenecen a `app_definer` (NOLOGIN) y revalidan rol y sucursal. Ver README, secciones “Cómo se protege el costo” y “Sesiones y seguridad web”.

## 3. Variables de entorno
Ver `.env.example`. Resumen:
- `DATABASE_URL` (dueño): solo migraciones/seed/bootstrap/pruebas, nunca la aplicación.
- `DATABASE_URL_SELLER|SUPERADMIN|AUTH|PUBLIC`: logins de la aplicación; `db:migrate` les asigna la contraseña que figura en la URL.
- `SESSION_SECRET`, `DB_CONTEXT_SECRET`, `ORDER_TOKEN_SECRET`: >= 32 caracteres (la tercera firma los enlaces de pedidos).
- `COOKIE_SECURE`, `TRUST_PROXY`, `BCRYPT_COST`, `APP_DEFINER_BYPASSRLS`: opcionales (ver README y DEPLOY).
- Solo para scripts: `SEED_SUPERADMIN_PASSWORD`, `SEED_SELLER_PASSWORD` (demo) y `BOOTSTRAP_SUPERADMIN_USERNAME|NAME|PASSWORD`, `BOOTSTRAP_BRANCHES` (producción).

## 4. Migraciones, demo y producción
| Comando | Qué hace | Dónde |
|---|---|---|
| `npm run db:migrate` | Aplica migraciones pendientes (`db/migrations/NNN_*.sql`, en orden, cada una en su transacción, con checksum: **nunca editar una ya aplicada**, agregue la siguiente) y configura los roles de runtime. | todos |
| `npm run db:seed` | Datos de **demostración** (catálogo, lotes, ventas, cambios, anulaciones). | solo desarrollo |
| `npm run db:reset` | Recrea la base local, migra y siembra. Se niega en bases remotas y en producción. | solo local |
| `npm run db:bootstrap` | **Producción**: crea solo el superadmin (clave de `BOOTSTRAP_SUPERADMIN_PASSWORD`), las sucursales de `BOOTSTRAP_BRANCHES` (`Nombre:Ciudad[:inactiva];...`) y la configuración por defecto. Repetible; no pisa la clave existente salvo `-- --reset-password`. | producción |
| `npm run db:wipe-demo -- --confirm=BORRAR-DATOS` | Borra ventas, stock, compras, clientes, cajas, catálogo y **todos los vendedores**; conserva sucursales, superadmin, configuración y migraciones. `--keep-catalog` conserva el catálogo. Pide `--allow-remote` si la base no es local. | antes de entregar |

Flujo recomendado para entregar a la clienta con la base de demostración: `db:seed` en una base de pruebas; para producción, base **nueva** + `db:migrate` + `db:bootstrap`. Si se mostró la demo en la misma base: `db:wipe-demo` y luego crear usuarios reales.

## 5. Pruebas y calidad
`npm test` (unitarias + base de datos en `inventario_test`, se recrea sola), `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:e2e` (requiere `build` y la base sembrada con `db:reset`), `npm run perf:lighthouse` (con la app corriendo).

## 6. Usuarios
- **Vendedores**: pantalla *Usuarios* (crear/desactivar) y *Sucursales* (reasignar).
- **Otro superadmin**: ejecute `npm run db:bootstrap` con otro `BOOTSTRAP_SUPERADMIN_USERNAME` y su clave (no toca los existentes).
- **Cambiar la clave de un superadmin**: `db:bootstrap -- --reset-password` con su usuario y la nueva clave en el entorno.
- **Clave olvidada de un vendedor (u otra superadmin)**: *Usuarios → Restablecer* (contraseña temporal, con o sin cambio obligatorio). Es la función SQL `admin_reset_password` (migración `018`): solo el rol superadmin puede ejecutarla, no sirve para la propia cuenta y sube `token_version`.
- **Cambio de la propia contraseña**: *menú → Cambiar contraseña* (cualquier usuario). La app verifica la actual con bcrypt tras reservar un intento en el limitador compartido (`pwchg|<usuario>`, 5 cada 15 min) y escribe con `change_own_password(hash_actual, hash_nuevo)`: `SECURITY DEFINER`, dueña `app_definer`, toma la identidad del contexto firmado y solo toca la fila propia. Sube `token_version` (las demás sesiones mueren) y la sesión actual se reemite.
- **Auditoría mínima**: `users.password_changed_at` y `password_changed_by` (quién y cuándo; nunca la clave) y `must_change_password`. No existe una tabla de bitácora general.
- Los logins de runtime **no** tienen `UPDATE` sobre `users` (la `018` también retira el de `password_hash` al superadmin).
- **Superadmin que olvidó su clave**: `BOOTSTRAP_SUPERADMIN_USERNAME=<usuario> BOOTSTRAP_SUPERADMIN_PASSWORD=<nueva> npm run db:bootstrap -- --reset-password` (con el `.env` de la base que corresponda).
- **Cerrar todas las sesiones**: `select revoke_user_sessions(null);` (o con un id de usuario).

## 7. Rotación de secretos
1. **`SESSION_SECRET`**: cámbielo en Vercel y redespliegue; todos deberán ingresar de nuevo.
2. **`DB_CONTEXT_SECRET`**: cámbielo en `.env.local`, corra `npm run db:migrate` (lo escribe en la base) y de inmediato actualice Vercel y redespliegue. Entre ambos pasos las peticiones fallan cerradas (sin acceso a datos), por eso hágalo fuera del horario de venta.
3. **Contraseñas de los logins** `app_runtime_*`: edite las tres URL en `.env.local`, `npm run db:migrate` (aplica las nuevas), actualice Vercel y redespliegue.
4. **Contraseña del dueño en Neon**: rótela en el panel y actualice `DATABASE_URL` local.
Ante sospecha de filtración: rote todo lo anterior y ejecute `select revoke_user_sessions(null);`.

## 8. Respaldos
- **Neon**: restauración a un punto en el tiempo (*Branches → Restore*) según la retención de su plan; verifique cuántos días cubre.
- **Copia lógica propia** (recomendada, semanal): `pg_dump --format=custom --no-owner "$DATABASE_URL" -f inventario-$(date +%F).dump` con la URL **directa**; guarde el archivo fuera del proveedor (disco cifrado o almacenamiento aparte).
- **Restaurar** en una base nueva: `createdb`/Neon nueva, `pg_restore --no-owner -d <url> archivo.dump`, luego `npm run db:migrate` (reaplica roles, permisos y contraseñas).
- Pruebe una restauración antes del lanzamiento.

## 9. Agregar una sucursal
Pantalla *Sucursales → Nueva sucursal* (nombre, ciudad, activa o no). Para que opere: active la sucursal, cree o reasigne sus vendedores, transfiera o ingrese stock (*Compras* con esa sucursal) y el vendedor abre su caja. No hay que tocar código ni la base. Una sucursal no se desactiva mientras tenga stock, caja abierta o vendedores activos.

## 10. Limitaciones conocidas
- Un superadmin que olvidó su contraseña no tiene autoservicio: se restablece por línea de comandos (sección 6). No hay correo ni SMS.
- El cierre de sesión borra la cookie pero no invalida el token en el servidor (vence en 12 h); `revoke_user_sessions` sí lo invalida. No se corrigió subiendo `token_version` al salir porque también cerraría las sesiones del mismo usuario en otros aparatos (el mostrador compartido).
- Facturación electrónica del SIN: la tienda solo guarda NIT/CI y razón social (`InvoiceProvider` manual); requiere un proveedor autorizado.
- Pasarela de tarjeta: no existe (hay QR manual y contra entrega); el punto de integración es `PaymentProvider` (`docs/TIENDA.md`).
- La caché de lectura de la tienda (`unstable_cache`, 30 s) es *stale-while-revalidate* y persiste en disco: tras recrear la base en local borre `.next` antes de arrancar.

## 11. Tienda online: operación diaria
- **Pedidos nuevos**: insignia dorada en el menú *Pedidos web* (superadmin: pagos por revisar; vendedor: pedidos confirmados por despachar).
- **Cambiar la sucursal que despacha**: *Tienda online → Estado y contacto*.
- **Un pedido spam**: *Cancelar pedido* con motivo (no hay reserva de stock, no pasa nada más).
- **Rotar `ORDER_TOKEN_SECRET`**: los enlaces ya enviados dejan de abrir; solo con sospecha de filtración.
- **Contraseña del login público**: editar `DATABASE_URL_PUBLIC`, `npm run db:migrate`, actualizar Vercel y redesplegar.
