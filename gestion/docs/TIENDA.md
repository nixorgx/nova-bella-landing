# Tienda online (Etapa 2) — documentación técnica

La tienda pública vive en el mismo proyecto Next.js que el sistema interno: grupo de rutas `src/app/(store)/tienda/**`, sin sesión. Lee variantes con stock y **nunca** costos; las ventas entran al sistema como `sales.channel = 'web'`.

## 1. Rutas

| Ruta | Quién | Qué |
|---|---|---|
| `/tienda` | público | Catálogo: productos con precio primero, filtros (línea, color, talla, precio), búsqueda, orden, paginación de 24. "Cómo comprar" al final. |
| `/tienda/[slug]` | público | Producto: galería, color, talla (las agotadas se ven deshabilitadas), cantidad, WhatsApp. JSON-LD `Product` (BOB, disponibilidad). |
| `/tienda/carrito` | público | Carrito (localStorage) revalidado en el servidor. |
| `/tienda/pedido` | público | Checkout de invitado: datos, entrega/recojo, pago, factura. |
| `/tienda/pedido/[token]` | quien tenga el enlace | Estado, QR + monto + código, subida de comprobante, resumen, WhatsApp, cancelar (solo sin pagar). |
| `/tienda/img/[id]`, `/tienda/qr/[token]` | público / token | Fotos (inmutables, ETag) y QR de pago (solo con el token de un pedido por QR). |
| `/sitemap.xml`, `/robots.txt` | público | SEO. Las rutas internas son `noindex`. |
| `/pedidos`, `/pedidos/[id]` | superadmin y vendedor | Lista con estados y conteos, detalle y acciones. |
| `/tienda-online` | superadmin | Abrir/cerrar tienda, WhatsApp, sucursal que despacha, zonas y tarifas, puntos de recojo, QR de pago, textos. |
| `/catalogo` (+ modelo) | superadmin | Publicar (masivo o por modelo) y fotos por modelo/color. |

`/` y `/login` no cambian (el login tiene un enlace discreto "Ir a la tienda en línea").

## 2. Modelo de datos (migraciones 019 a 021)

- `models.published_online` (por defecto `false`) y `models.slug` (único, estable, generado por trigger).
- `model_images`: WebP (completa ≤ 900 px y ≤ 150 KB, miniatura ≤ 400 px) en `bytea`, por modelo y opcionalmente por color. Máx. 12 por modelo.
- `store_delivery_zones`, `store_pickup_points`, `store_assets` (QR de pago) y claves `store_*` en `app_settings`.
- `web_orders`, `web_order_items` (precio y nombres congelados), `web_order_events` (historial), `web_order_proofs` (comprobantes: solo superadmin).
- Todas con RLS. Las tablas de pedidos solo se escriben desde funciones `SECURITY DEFINER`.

## 3. Ciclo de vida del pedido

```
pendiente_pago ──(comprobante o n.º de transacción)──▶ pago_en_revision ──(superadmin confirma)──▶ confirmado ──▶ en_camino | listo_para_recoger ──▶ entregado
      ▲                                                        │
      └───────────(superadmin rechaza el comprobante, con motivo)┘            cualquier estado no final ──(superadmin, con motivo)──▶ cancelado
```

Reglas exactas (funciones en `021_store_admin_functions.sql`, espejo en `src/features/store/order-state.ts`):

1. **Crear** (`public_create_order`): precios, tarifa de envío y disponibilidad salen de la base; el cliente solo manda `variant_id` y cantidad (1 a 10; hasta 30 líneas). **No reserva stock**. La misma clave de idempotencia devuelve el mismo pedido.
2. **Confirmar** (`web_order_confirm`, solo superadmin): en una transacción bloquea las filas de stock en orden, comprueba disponibilidad (si falta, error `IN001` claro y **no queda nada a medias**), reutiliza o crea el cliente por teléfono, crea `sales` (canal `web`, sin caja, vendedor = quien confirma, `factura` si pidió factura), `sale_items` (precio del pedido), `sale_payments` y los movimientos `sale` que descuentan stock. Confirmar dos veces (doble clic) devuelve la misma venta.
3. **QR**: la venta registra el pago `qr` por el monto de los productos. **Contra entrega**: la venta se crea al confirmar con pago `efectivo` provisional; al marcar **entregado** quien entrega elige cómo cobró (efectivo, QR, transferencia o tarjeta) y se corrige el pago de la venta.
4. El **costo de envío** queda en el pedido (no es ingreso de producto): el total de la venta es el de los productos.
5. Las ventas web **no pertenecen a ninguna caja**: no entran al efectivo esperado de un turno.
6. **Cancelar** un pedido ya confirmado anula su venta (el stock vuelve con movimientos `void`). Un pedido entregado no se cancela (use cambio o anulación en Ventas). Si alguien anula la venta desde *Ventas*, el pedido pasa solo a `cancelado`.
7. **Vendedor**: solo ve los pedidos de su sucursal y solo puede marcar *en camino*, *listo para recoger* y *entregado*. No confirma, rechaza, cancela ni ve comprobantes (también lo impide la base: sin `EXECUTE` ni `SELECT`).

## 4. Stock web y recojo

Los clientes ven y compran el stock de **una** sucursal (ajuste "Sucursal que despacha la tienda"; por defecto la primera activa). El punto de recojo es informativo: si la tienda tiene varias sucursales activas, el stock debe estar en la que despacha (use *Transferencias*). Disponibilidad pública: "Disponible", "Últimas unidades" (1 a 3, con la cantidad) o "Agotado"; nunca se muestra más de "+10".

## 5. Pagos y factura (puntos de integración)

- `src/features/store/providers/payment.ts`: `PaymentProvider` con dos proveedores manuales (`manual_qr`, `cash_on_delivery`). Un proveedor de tarjeta (Stripe, PagoPlux, Tigo Money…) se enchufa implementando la interfaz, guardando la sesión del proveedor en el pedido y confirmando desde su **webhook firmado** con el mismo flujo de confirmación. No hay formulario de tarjeta falso.
- `src/features/store/providers/invoice.ts`: `InvoiceProvider` con la implementación `manual` (la tienda emite la factura; el pedido queda con `invoice_status = 'pending_manual'`). La facturación electrónica real del SIN requiere un proveedor autorizado que se elige con Mauricio y la clienta; hoy solo se guardan NIT/CI y razón social.

## 6. Fotos y archivos subidos

`src/features/store/images.ts`: tope de 4 MiB (Vercel corta en 4,5 MB; el navegador reduce las fotos grandes antes de subirlas), verificación de bytes mágicos (solo JPEG, PNG y WebP; se rechazan SVG, GIF, HEIC, PDF), decodificación y recodificación con **sharp** (borra metadatos/GPS, aplana transparencia, límite de 30 Mpx) y WebP de salida. Lo que se guarda son los bytes que produjo sharp, nunca el archivo del usuario; la base además exige la cabecera `RIFF....WEBP`. Se sirven con `Cache-Control: public, max-age=31536000, immutable`, `ETag` (304), `nosniff` y `CSP: default-src 'none'; sandbox`. El QR se guarda sin pérdida. Los comprobantes solo los ve la superadmin (`/pedidos/[id]/comprobante/[id]`, `no-store`).

## 7. Rendimiento y caché

El CSP con nonce obliga a renderizar por petición (Cache Components está apagado). Para que el catálogo sea rápido se cachean las lecturas públicas con `unstable_cache` (30 s, etiqueta `store`); las acciones del admin que cambian lo visible llaman `updateTag('store')`. La caché es *stale-while-revalidate*: tras un rato sin visitas la primera persona puede ver datos de hasta unos segundos antes; el carrito y el checkout **siempre** consultan la base en vivo. No usa JavaScript de terceros; el JS del catálogo es ~137 KB gzip (presupuesto 200) y el CSS ~11 KB.

## 8. Variables de entorno nuevas

| Variable | Uso |
|---|---|
| `DATABASE_URL_PUBLIC` | Login `app_runtime_public` (tráfico anónimo). Solo puede ejecutar `public_*()`. |
| `ORDER_TOKEN_SECRET` | Clave (≥ 32 caracteres) del HMAC que deriva el token de cada pedido. **Distinta** de `SESSION_SECRET` a propósito: rotar la sesión no debe matar los enlaces ya enviados. Si se rota, los enlaces viejos dejan de abrir. |
| `SITE_URL` (opcional) | Origen público para sitemap y OpenGraph (en Vercel se usa `VERCEL_PROJECT_PRODUCTION_URL`). |
| `TRUST_PROXY=1` | **Imprescindible en Vercel**: sin él la dirección IP es desconocida y solo rigen los límites por teléfono, token y globales. |

## 9. Retención y privacidad

Se guardan solo los datos del pedido: nombre, celular, correo (opcional), dirección y referencia (si es envío), NIT/CI y razón social (si pide factura) y el comprobante. No se guardan IP, agentes de usuario ni cookies de seguimiento; no hay analítica ni scripts de terceros; los registros del servidor no incluyen datos personales. Los pedidos no se borran (son parte del historial de ventas). Recomendación: conservar los comprobantes de pedidos entregados 12 meses y luego eliminarlos con una tarea manual de la superadmin (pendiente de definir con la clienta junto con los textos legales de privacidad).

## 10. Probar

`npm test` (unitarias y de base de datos, incluido `tests/db/store-*.test.ts`), `npm run test:e2e` (viajes de compra en móvil, admin, seguridad, axe y desbordes), `npm run perf:lighthouse` (incluye las páginas públicas). El modo alternativo del dueño de funciones (sin `BYPASSRLS`) se prueba con `APP_DEFINER_BYPASSRLS=false` contra un clúster nuevo (ver `DEPLOY.md`).
