# NovaBella · Inventario, POS y tienda online (Etapa 1 + Etapa 2)

**Estado: Etapa 1 completa** (catálogo, compras, POS, cambios y anulaciones, cajas, reportes y Excel, dashboard, sucursales y transferencias, endurecimiento y entrega) **y Etapa 2 construida**: tienda pública `/tienda` con catálogo, carrito, pedido por QR bancario o contra entrega, subida de comprobante, estado del pedido por enlace privado, sección "Pedidos web" y "Tienda online" para el equipo, y ventas con canal `web`.
Pendiente de decisiones externas (no inventadas): pasarela de tarjeta, facturación electrónica del SIN, transportistas, QR real del banco, fotos reales y textos legales. Ver [`GUIA-TIENDA.md`](GUIA-TIENDA.md).

Documentos: [`docs/TIENDA.md`](docs/TIENDA.md) (Etapa 2, técnico), [`GUIA-TIENDA.md`](GUIA-TIENDA.md) (para presentar), [`docs/PROGRESO-ETAPA2.md`](docs/PROGRESO-ETAPA2.md), [`DEPLOY.md`](DEPLOY.md) (Neon + Vercel), [`docs/ADMIN-TECNICO.md`](docs/ADMIN-TECNICO.md), [`docs/MANUAL-SUPERADMIN.md`](docs/MANUAL-SUPERADMIN.md), [`docs/MANUAL-VENDEDOR.md`](docs/MANUAL-VENDEDOR.md), [`docs/ACCESIBILIDAD-Y-RENDIMIENTO.md`](docs/ACCESIBILIDAD-Y-RENDIMIENTO.md), [`docs/SEGURIDAD.md`](docs/SEGURIDAD.md).

Next.js 16 (App Router; renderizado por petición, necesario para el CSP con nonce) + TypeScript + Postgres 17 local. Sin Supabase:
autenticación propia (bcrypt + cookie firmada con `jose`) y seguridad por rol aplicada en la base
de datos (GRANT + RLS).

## Comandos

```bash
cp .env.example .env.local      # y poner secretos y contraseñas reales (ver "Variables de entorno")
npm run db:reset                # recrea `inventario`, migra, activa los roles de runtime y siembra (solo local)
npm run db:migrate              # aplica migraciones pendientes y (re)configura los roles de runtime
npm run db:seed                 # siembra datos de DEMOSTRACIÓN (idempotente, solo desarrollo)
npm run db:bootstrap            # producción: solo superadmin + sucursales + configuración (sin demo)
npm run db:wipe-demo -- --confirm=BORRAR-DATOS   # borra los datos de demo (ver docs/ADMIN-TECNICO.md)
npm run dev                     # http://localhost:3000
npm test                        # vitest; crea y migra `inventario_test` automáticamente
npm run test:coverage           # cobertura de src/lib
npm run test:e2e                # Playwright (requiere `npm run build` y `db:reset`)
npm run perf:lighthouse         # Lighthouse sobre login, POS, dashboard, reportes y stock (app en :3100)
```

Postgres local: `localhost:5433`, usuario `postgres` (trust), datos en `../db/pgdata`.

## Credenciales de DESARROLLO

El seed crea un superadmin (usuario por defecto `naty`; se cambia con `SEED_SUPERADMIN_USERNAME`) y `vendedor1` (vendedor). Los usuarios se guardan en minúsculas y el ingreso **no distingue mayúsculas** (escribir `Naty` o `naty` es lo mismo). Sus contraseñas iniciales NO están en el
repositorio: salen de `SEED_SUPERADMIN_PASSWORD` y `SEED_SELLER_PASSWORD` (>= 12 caracteres, en
`.env.local`). Si faltan, el seed genera contraseñas aleatorias y las imprime **una sola vez**.
Las pruebas e2e de Playwright leen esas mismas variables.

| Rol | Usuario | Contraseña |
|---|---|---|
| superadmin | `SEED_SUPERADMIN_USERNAME` (por defecto `naty`) | `<SUPERADMIN_PASSWORD>` |
| vendedor | `vendedor1` | `<SELLER_PASSWORD>` |

## Variables de entorno

| Variable | Uso |
|---|---|
| `DATABASE_URL` | Conexión **dueña/superusuario**. Solo para `db:migrate`, `db:seed`, `db:reset` y fixtures de pruebas. La app en ejecución **nunca** la usa. |
| `TEST_DATABASE_URL` | Base desechable `*_test` para `npm test`. |
| `DATABASE_URL_SELLER` / `DATABASE_URL_SUPERADMIN` / `DATABASE_URL_AUTH` | Logins de runtime de mínimo privilegio (`app_runtime_seller`, `app_runtime_superadmin`, `app_runtime_auth`). La contraseña de cada URL es la que `db:migrate` asigna al rol. |
| `SESSION_SECRET` | Firma la cookie de sesión (>= 32 caracteres). |
| `DB_CONTEXT_SECRET` | Firma la identidad por petición que verifica la base (>= 32 caracteres). Se guarda en `app_private.settings`. |
| `COOKIE_SECURE` | Flag `Secure` de la cookie. Por defecto `true` en producción; `false` solo para `next start` por http en localhost (el `.env.local` de desarrollo lo trae así). |
| `TRUST_PROXY` | Número de proxies de confianza delante de la app (`1` / `true` = uno). Sin definir, `X-Forwarded-For` se ignora (lo controla el cliente) y el límite de intentos de login es por usuario. Con valor, se usa la entrada que escribió el proxy (la n-ésima desde la derecha). |
| `DATABASE_URL_PUBLIC` | Cuarto login de runtime (`app_runtime_public`, migración 019): tráfico **anónimo** de la tienda; solo ejecuta las funciones `public_*()`. |
| `ORDER_TOKEN_SECRET` | Clave (>= 32 caracteres) del HMAC del enlace privado de cada pedido. No reutilizar `SESSION_SECRET`. |
| `SITE_URL` | Opcional: origen público para sitemap y OpenGraph. |
| `BCRYPT_COST` | Costo de bcrypt para contraseñas nuevas (12 por defecto; las pruebas usan 4). |

## Cómo se protege el costo

Cada petición corre en una transacción sobre el **pool que corresponde a su rol** (`src/lib/db.ts#withUser`):
`app_runtime_seller` o `app_runtime_superadmin`. Son logins que no son superusuario ni dueños de nada, miembros
(sin opción SET) de un único rol de privilegios (`app_seller` / `app_superadmin`), así que no existe ningún
`RESET ROLE` / `SET ROLE` / `SET SESSION AUTHORIZATION` que los saque de ahí. `app_seller` no tiene GRANT ni
política RLS sobre `purchase_batches`, `purchase_items`, `variant_costs` ni `exchange_rates`, y solo ve
stock/ventas de su sucursal. El login y la recarga de usuario usan un tercer login, `app_runtime_auth`, que
**no tiene acceso a ninguna tabla**: solo puede ejecutar `auth_login_lookup`, `auth_record_login` y `auth_load_user`.

**Identidad de la petición.** Un `set_config('app.user_id', ...)` lo puede llamar cualquier conexión, así que la
base ya no confía en settings planos. La app firma `usuario|sucursal|expiración` con HMAC-SHA256
(`DB_CONTEXT_SECRET`, `src/lib/db-context.ts`) y lo publica en `app.ctx`; `app_user_id()` / `app_branch_id()`
(migración 009) verifican la firma contra un secreto que solo puede leer `app_definer`. Un token falso, alterado,
vencido o de otro usuario da `NULL`, y entonces `assert_role()` y todas las políticas RLS fallan cerradas. El rol
(`app_role()`) sale del login de la conexión (`session_user`), nunca de un setting.

**Dueño de las funciones.** Todas las funciones `SECURITY DEFINER` pertenecen a `app_definer`: NOLOGIN, no
superusuario, con GRANT explícitos sobre las tablas que escriben y `BYPASSRLS` (atributo permitido a un rol que no
es superusuario). Si el hosting no permite `BYPASSRLS`, sustitúyalo por políticas `to app_definer`. Una tabla
nueva que una función deba escribir necesita su `grant ... to app_definer` en su migración.

Las funciones se crean cerradas: `alter default privileges ... revoke execute ... from public` y cada migración
re-concede explícitamente a los roles que corresponden.

**Límites.** Los logins de runtime traen `statement_timeout=15s`, `lock_timeout=5s` e
`idle_in_transaction_session_timeout=30s` (migración 009). Son defaults del rol, no una barrera contra un
atacante con SQL libre (puede cambiarlos con `SET`); protegen de bugs y consultas lentas.

> Con `trust` en `pg_hba.conf` (como el clúster local de desarrollo) Postgres ni siquiera comprueba las
> contraseñas. En cualquier despliegue real use `scram-sha-256` y contraseñas largas y aleatorias.

Ventas, compras, cambios, anulaciones y transferencias son funciones Postgres transaccionales
(`db/migrations/005..007`, endurecidas en `012`); `stock_movements` es de solo inserción (triggers) y
`stock_levels` nunca puede quedar negativo (CHECK).

Errores de dominio de las funciones usan SQLSTATE `IN001` stock, `IN002` pagos, `IN003` validación,
`IN004` permiso, `IN005` no encontrado/estado.

### Reglas de negocio en la base

- **Ventas** (`create_sale`): precio final > 0, al menos un producto y un pago, y pagos = total. Requiere una
  **caja abierta** en la sucursal (también para el superadmin; se asigna en el servidor y `p_cash_session_id`, si
  llega, debe ser esa caja). Tope de descuento solo para vendedores: `app_settings.max_discount_pct`
  (`NULL` = sin límite; solo el superadmin lo edita) frente al `list_price`.
- **Cajas**: una sola abierta por sucursal; el vendedor solo modifica una caja mientras está abierta; al cerrar se
  fuerza `closed_by` = usuario firmado y `closed_at` = reloj del servidor, y una caja cerrada no se puede modificar.
- **Cambios** (`create_exchange`): la diferencia se calcula con los precios; solo el superadmin puede fijarla
  y dentro de límites (reembolso <= lo pagado, cobro <= precio de lista del nuevo).
- **Compras**: el costo promedio ponderado toma primero el candado de `variant_costs`; las compras concurrentes
  son seguras. **Transferencias**: filas de stock bloqueadas en orden de `branch_id` (sin deadlocks).

## Sesiones y seguridad web

- Cookie JWT (HS256) con `iss`/`aud`, 12 h, `HttpOnly`, `SameSite=Lax` y `Secure` según `COOKIE_SECURE`.
- Cada usuario cambia su contraseña desde el menú (*Cambiar contraseña*, pide la actual) y el superadmin restablece la de otros desde *Usuarios* (migración `018`: funciones `SECURITY DEFINER`, sin `UPDATE` directo sobre `users`; ver `docs/SEGURIDAD.md`). Superadmin que olvidó la suya: `db:bootstrap -- --reset-password`.
- `users.token_version` viaja en el token y se compara con la base en cada petición: cambiar la contraseña,
  (des)activar, cambiar de sucursal o rol, o `select revoke_user_sessions(<id | null>)` (superadmin) invalida las
  sesiones anteriores. Un vendedor de una sucursal inactiva no puede ingresar ni mantener sesión.
- Login: límite por usuario+IP (5 / 15 min) y por usuario (20 / 15 min), reservado **antes** de bcrypt; mapa acotado
  y con limpieza periódica. Contraseñas nuevas: mínimo 12 caracteres, bcrypt costo 12.
- `src/proxy.ts` pone un **CSP con nonce** por petición (sin `unsafe-inline` en scripts) y `next.config.ts` añade
  HSTS solo en producción. Por eso Cache Components / prerender parcial están desactivados: un shell estático no
  puede llevar el nonce. Los atributos `style=""` (colores de muestra) se permiten con `style-src-attr`.

## Catálogo y códigos (Fase 2)

Solo superadmin, en `/catalogo`: resumen, modelos (con generador de variantes colores × tallas),
líneas/colores/tallas (`/catalogo/atributos`) y etiquetas imprimibles (`/catalogo/etiquetas`).

- `src/features/catalog/`: esquemas zod, SKU (`LINEA-MODELO-COLOR-TALLA`, con sufijo `-2`, `-3`… si hay colisión),
  generador transaccional, `searchVariants()` / `resolveScan()` (devuelven precio y stock, nunca costos) y la UI.
- `GET /api/variantes/buscar` y `GET /api/variantes/resolver`: para ambos roles, corren con el rol de base de datos del usuario.
- Componentes reutilizables para Compras y POS: `components/search/VariantSearch`, `components/scan/ScanInput`
  y `components/scan/CameraScanner` (cámara con `@zxing/browser`; requiere HTTPS salvo en localhost).
- Etiquetas: se imprimen con el diálogo del navegador (CSS de impresión, "Guardar como PDF"); QR (`qrcode`) + Code 128 (`bwip-js`).
- Migraciones: `009` roles de runtime y contexto firmado, `010` sesiones (`token_version`) y funciones de login, `011` cajas y `app_settings`, `012` RPCs endurecidos, `013` índices (pg_trgm).
- Migración `008`: `active` en colores y tallas, y permiso de borrado solo para entradas sin uso (las llaves foráneas bloquean el resto).
- El seed carga 7 modelos, 186 variantes y 2 lotes de compra de ejemplo (idempotente).

## Demo 3: cambios, anulaciones, cajas, reportes y Excel (Fases 5 y 6)

**Cambios** (`src/features/exchanges/`): desde el detalle de una venta, "Registrar un cambio" permite elegir los pares
devueltos (con cantidad), buscar o escanear el producto nuevo y ver la diferencia **calculada en el servidor**
(`previewExchangeAction`, misma regla que `create_exchange`: precio de lista del nuevo − precio pagado por el devuelto).
Si hay diferencia, se elige el método de pago (cobrar o devolver) y hace falta una **caja abierta** en la sucursal.
El superadmin puede fijar la diferencia a mano dentro de los límites (no se devuelve más de lo pagado ni se cobra más que
la lista del nuevo). Las líneas confirmadas juntas comparten `group_id` y un comprobante de 80 mm
(`/ventas/<id>/ticket?cambio=<grupo>`); el ticket de la venta muestra "CAMBIO REGISTRADO" y la lista de cambios.

**Anulaciones**: solo superadmin, motivo obligatorio (>= 5 caracteres, validado en zod y en `void_sale`). La venta queda
listada con insignia "Anulada", el motivo y quién la anuló; los pares vuelven al stock con movimientos `void` y no suma
en cajas ni reportes. Una venta con cambios no se puede anular (IN005): la pantalla explica por qué y el camino
recomendado (nuevo cambio, con diferencia fijada por el superadmin si hay que devolver dinero).

**Cajas**: `/cajas` (superadmin: filtros por fecha, sucursal y cajero; detalle `/cajas/<id>`) y `/ventas/caja` (el vendedor
ve solo los turnos que abrió; detalle `/ventas/caja/<id>`). Efectivo esperado = apertura + ventas en efectivo ± diferencias de
cambios en efectivo (cobradas − devueltas). Una venta anulada **después** del cierre sigue contando en esa caja (el cajón ya
se había contado con ese dinero); anulada con la caja abierta, sale de la cuenta.

**Reportes** (`/reportes`, URL compartible: `?periodo=hoy|semana|mes|rango&desde=&hasta=&sucursal=&vendedor=&vista=`):
resumen (ventas, ticket promedio, por método de pago, por día, descuentos), modelos y tallas (más vendidos y matriz
modelo × talla), stock actual (con bajo y agotado), vendedores y descuentos, cambios y anulaciones y, solo superadmin,
costo y utilidad. El vendedor ve "Mis ventas": solo sus ventas de su sucursal y **ninguna** columna de costo, margen o utilidad
(consultas separadas: `reports/queries.ts` no toca tablas de costo; `reports/cost-queries.ts` lanza un error si no es superadmin).
Unidades e ingresos por modelo/talla son **netos de cambios**. El dashboard (`/dashboard`) compara el mes contra el mes
anterior al mismo día.

**Costo y utilidad** (decisión documentada): el costo de cada par vendido es el costo promedio ponderado puesto en tienda
(`variant_costs.avg_cost_bs`) **en el momento de la venta**, congelado por un trigger en `sale_item_costs` (y en
`exchange_costs` para los pares devuelto y entregado de un cambio). Las compras posteriores no reescriben la utilidad de
períodos pasados. Las ventas anteriores a la migración 015 se rellenaron con el promedio vigente en ese momento (aproximación).
Utilidad = (ventas + diferencias de cambios) − (costo de lo vendido ± costo de los cambios).

**Excel** (`GET /reportes/exportar/<ventas|stock|compras|rentabilidad|caja>`, `exceljs`, nunca `xlsx`): archivos .xlsx con
encabezado fijo, autofiltro, anchos, formato `Bs` con 2 decimales y fechas, totales con fórmulas reales (SUBTOTAL / SUMIFS que
excluye las anuladas) y la suma por método de pago. `compras` y `rentabilidad` son solo superadmin (403 al vendedor);
`ventas`, `stock` y `caja` del vendedor se consultan ya acotados a su alcance y sin columnas de costo. Los textos de personas
(clientes, notas, motivos) se escriben como texto con apóstrofo si empiezan con `= + - @` (inyección de fórmulas). Tope de
20.000 filas por archivo (si se supera responde 413 con un mensaje, nunca recorta en silencio).

**Seed de demo**: historial de 3 a 6 semanas (con ventas del vendedor y del superadmin), 3 cambios (mismo precio, más caro por
QR, más barato devuelto en efectivo) y 2 ventas anuladas. Idempotente y sin comandos que requieran superusuario.

Migración `015`: columnas de liquidación en `exchanges`, tablas de costo congelado, `create_exchange` v2 y `void_sale` con motivo obligatorio.

## Sucursales y transferencias (Fase 7)

**Sucursales** (`/sucursales`, superadmin): alta, edición, activar/desactivar y reasignar vendedores. La Paz queda creada e inactiva
para abrirla a mitad de año. La base impide desactivar una sucursal con stock, caja abierta o vendedores activos, o la última
sucursal activa (migración `016`, mensajes claros en español); la pantalla muestra de antemano qué falta. Un vendedor solo puede
estar en una sucursal activa; reasignarlo invalida sus sesiones.

**Transferencias** (`/sucursales/transferencias`, solo superadmin): origen, destino, productos por escaneo o búsqueda (con el stock del
origen a la vista) y cantidades. `create_stock_transfer` mueve todas las líneas en una transacción (todo o nada), bloquea las
filas en orden fijo (sin deadlocks) y deja una cabecera inmutable en `stock_transfers`; `transfer_stock` (una variante) pasa a ser un
envoltorio con las mismas reglas. Historial con filtros y detalle por transferencia.

**Selector de sucursal**: el superadmin elige "todas / una" con `?sucursal=` (URL compartible) en stock, reportes, cajas, historial de
ventas, compras, transferencias y dashboard. El vendedor queda fijo a su sucursal por RLS y la interfaz no le ofrece otras; los Excel
respetan el mismo filtro (`tests/db/branch-isolation.test.ts`).

## Endurecimiento (Fase 8)

- E2E: `e2e/final-journey.spec.ts` recorre login por rol, lote, venta con pagos mixtos, cambio, anulación, reporte, Excel, transferencia y una venta solo con teclado.
- Accesibilidad: `e2e/a11y.spec.ts` (axe, WCAG 2.2 AA, ambos roles). Capturas a 320-1920 px sin desbordes en `e2e/screenshots/final/`.
- Rendimiento y accesibilidad medidos: `docs/ACCESIBILIDAD-Y-RENDIMIENTO.md`. Seguridad: `docs/SEGURIDAD.md`.
- Migración `017`: límite de intentos de login compartido por todas las instancias (en la base), además del limitador en memoria.


## Tienda online (Etapa 2)

Resumen (detalle en [`docs/TIENDA.md`](docs/TIENDA.md)):

- **Público** (`src/app/(store)/tienda`): catálogo editorial con filtros por línea, color, talla y precio, producto con tallas agotadas deshabilitadas, carrito en el navegador revalidado en el servidor, checkout de invitado (domicilio con zonas y tarifas, o recojo gratis), pago por **QR bancario manual** (QR + monto exacto + código + subida de comprobante o n.º de transacción) o **contra entrega / en tienda**, "Quiero factura" (solo se guarda NIT/CI y razón social), página de estado por token y botones de WhatsApp.
- **Interno**: `/pedidos` (superadmin y vendedor; el vendedor solo pasos operativos de su sucursal), `/tienda-online` (ajustes, zonas, recojo, QR, textos), fotos y publicación por modelo y masiva en `/catalogo`, insignia de pedidos nuevos en el menú, canal web como dimensión de Reportes, Dashboard-compatible y Excel (columna "Canal", filtro `?canal=web|tienda`) y etiqueta "Web" en Ventas.
- **Seguridad**: login anónimo propio (`app_runtime_public`) sin acceso a ninguna tabla, solo `EXECUTE` sobre `public_*()` (SECURITY DEFINER, `search_path` fijo, dueña `app_definer`); token de 256 bits (la base guarda solo su SHA-256); límites compartidos en base por IP, teléfono y token; honeypot; sharp para todas las imágenes; CSP con nonce intacto y sin scripts de terceros.
- **Pruebas**: `tests/db/store-*.test.ts` (aislamiento del rol público, creación y confirmación de pedidos, concurrencia, reportes), `tests/unit/store-*.test.ts`, `e2e/tienda-*.spec.ts` (viajes de compra en móvil, admin, seguridad, axe, desbordes) y `perf:lighthouse` con las páginas públicas.
- **Demo**: `npm run db:seed` agrega modelos publicados con imágenes **abstractas** generadas con sharp (marcadas "imagen demostrativa"), zonas, punto de recojo, un QR **DEMO** y 7 pedidos en cada estado. `SEED_STORE=false` lo omite; `db:bootstrap` (producción) no inserta nada de esto y deja la tienda **cerrada** y sin modelos publicados.
