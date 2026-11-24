# NovaBella — Tienda online (Etapa 2): guía para presentar

Esta etapa agrega al sistema de la Etapa 1 una **tienda pública** donde las clientas de Naty compran directo, sin reservas, y la venta entra sola al inventario. Las claves de acceso se entregan por separado (no están en este documento ni en el código).

## Qué hay de nuevo frente a la Etapa 1
1. **Tienda pública en `/tienda`**: productos con precio primero, filtros por línea, color, talla y precio, buscador y orden. Lo de "cómo comprar" (pagos, envíos, cambios) está al final, como pidió Naty. Pensada para el celular.
2. **Fotos de los modelos** (Naty las sube desde el sistema, por modelo y por color): se optimizan solas para que la tienda cargue rápido. Mientras un modelo no tenga fotos se muestra una imagen de marca.
3. **Compra en 3 pasos**: elegir color y talla → carrito → pedido (datos, entrega y pago). Sin cuentas ni contraseñas para la clienta.
4. **Pago por QR del banco** (la clienta ve el QR, el monto exacto y su código de pedido, paga desde su app y sube el comprobante) **o contra entrega / en tienda**.
5. **Entrega a domicilio con tarifa por zona** o **recojo gratis** en la sucursal elegida.
6. **"Quiero factura"**: la clienta deja NIT/CI y razón social; la tienda emite la factura de forma manual (ver más abajo).
7. **Página de seguimiento por enlace privado** con el estado del pedido, y botones de WhatsApp (consultar un producto, enviar el resumen del pedido).
8. **Para el equipo**: *Pedidos web* (con insignia de pedidos nuevos) y *Tienda online* (abrir/cerrar, WhatsApp, zonas, recojo, QR, textos). Cada pedido confirmado crea la **venta con canal "web"** y descuenta el stock; los reportes y el Excel se pueden filtrar por canal.

## Recorrido de la clienta (celular)
1. Abre la tienda, filtra (por ejemplo "Dama", talla 38) o busca por nombre.
2. Entra a un modelo, elige color y talla (las tallas agotadas se ven pero no se pueden elegir; solo las "últimas unidades" muestran cuántas quedan), agrega al carrito.
3. En el carrito ve los precios y la disponibilidad **actualizados desde el servidor** (nunca confiamos en lo que guarda el teléfono).
4. En *Finalizar pedido* escribe nombre y celular, elige domicilio o recojo y cómo pagar; opcionalmente factura. Al confirmar se crea el pedido (un doble clic no crea dos).
5. Aparece su pedido con código (`NB-XXXXXX`), el QR, el monto exacto y el botón de subir comprobante; puede "Enviar por WhatsApp" el resumen. El enlace es privado: quien lo tiene ve el estado.
6. Cuando el equipo confirma el pago, el estado pasa a *Confirmado*, luego *En camino* o *Listo para recoger*, y *Entregado*.

## Recorrido del equipo
1. **Naty (superadmin)** abre *Pedidos web*: ve los pedidos con su estado, abre uno, revisa el comprobante y pulsa **Confirmar pago y crear venta**. Si el comprobante no sirve, lo rechaza con un motivo que la clienta ve y puede enviar otro. Si el stock ya no alcanza, el sistema lo dice con claridad y no confirma (nunca queda stock negativo).
2. Después marca **en camino** o **listo para recoger** y **entregado**. En pagos contra entrega, al entregar elige cómo cobró (efectivo, QR, transferencia o tarjeta).
3. Puede **cancelar** con motivo: si ya estaba confirmado, la venta se anula y el stock vuelve.
4. La **vendedora** ve los pedidos de su sucursal y solo marca en camino / listo / entregado. No ve costos, no confirma pagos, no ve comprobantes ni ajustes.
5. En *Tienda online* Naty abre o cierra la tienda (cerrada: el catálogo se ve pero no se reciben pedidos), cambia el WhatsApp, las zonas y tarifas, los puntos de recojo, sube el QR de su banco y escribe sus textos de cambios y envíos. En *Catálogo* publica los modelos (uno a uno o todos los listos) y sube sus fotos.

## Guion corto (~10 min)
1. Abrir la tienda en el celular: catálogo, filtro, producto, talla agotada deshabilitada.
2. Hacer un pedido por QR hasta subir un comprobante y ver la página de estado.
3. Como superadmin: *Pedidos web* → abrir el pedido → confirmar → mostrar en *Ventas* la venta con la etiqueta **Web** y el stock descontado.
4. Marcar en camino y entregado; mostrar que la clienta ve el cambio en su enlace.
5. Como vendedora: ver el pedido sin costos y que no puede confirmar ni entrar a *Tienda online*.
6. Mostrar *Tienda online* (cerrar la tienda y ver el aviso) y *Reportes → Canal: Tienda web* con su descarga de Excel.

## Cómo funcionan hoy los pagos, la factura y la entrega
- **Pagos**: QR bancario **manual** (la persona confirma mirando el comprobante o su banco) y contra entrega. **No hay cobro con tarjeta** (no se simuló ninguno).
- **Factura**: solo se guardan NIT/CI y razón social, y el pedido queda "pendiente de emitir (manual)". La facturación electrónica real del SIN requiere un proveedor autorizado.
- **Entrega**: tarifa fija por zona configurable. No hay transportista integrado ni seguimiento de repartidores.
- **Stock**: la tienda vende el stock de **una** sucursal (la que se elija como "despacha"). El recojo es informativo.
- **Envío en la venta**: el costo de envío queda en el pedido; la venta registra el valor de los productos.

## Decisiones externas pendientes (con Mauricio y la clienta)
1. **Pasarela de tarjeta** (Stripe, PagoPlux, Tigo Money u otra): necesita cuenta de comercio; el sistema ya tiene el punto de conexión (`PaymentProvider`) pero no se construyó ningún formulario de tarjeta falso.
2. **Facturación electrónica del SIN**: elegir un proveedor autorizado; el punto de conexión es `InvoiceProvider`.
3. **Transportistas / delivery**: tarifas reales por zona o convenio con una empresa.
4. **Número de WhatsApp real** de la tienda (en la demo es un número de prueba).
5. **QR real del banco** y los datos de la cuenta (el QR de la demo dice DEMO y no es válido).
6. **Fotos reales** de los modelos (las de la demo son imágenes abstractas marcadas "imagen demostrativa").
7. **Textos legales**: política de privacidad (datos que se guardan: nombre, celular, dirección, NIT, comprobante), términos de compra, cambios y devoluciones.
8. **Varias sucursales**: si abre La Paz con stock propio, definir si la tienda venderá de ambas (hoy es una sola sucursal que despacha).

## Datos de la demostración
- La demo incluye 6 modelos publicados, 3 zonas de entrega, un punto de recojo, un QR **DEMO** y 7 pedidos de ejemplo, uno por cada estado. Son datos de prueba; antes de entregar a producción se usa una base nueva con `db:bootstrap` (tienda cerrada y sin modelos publicados).
- Los pedidos creados durante la verificación en línea llevan un nombre de prueba claramente identificable y pueden cancelarse desde *Pedidos web*.

## Dónde leer más
`docs/TIENDA.md` (técnico), `DEPLOY.md` (publicación), `docs/SEGURIDAD.md` (revisión de seguridad), `docs/MANUAL-SUPERADMIN.md` y `docs/MANUAL-VENDEDOR.md` (uso diario).
