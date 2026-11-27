# Manual del superadmin — Inventario Naty

Para quien administra el negocio. Menú: *Dashboard, Catálogo, Compras, Ventas, Clientes, Stock, Cajas, Reportes, Sucursales, Usuarios*.

## 1. Rutina diaria (5 minutos)
1. **Dashboard:** ventas del mes frente al anterior, utilidad, stock bajo y cajas abiertas. Arriba a la derecha, el selector **Sucursal** limita todo a una sucursal (o “Todas”).
2. **Cajas:** revise los turnos cerrados y las diferencias (contado − esperado).
3. **Reportes → Stock:** lo agotado o con pocos pares para reponer.

## 2. Ingresar mercadería (compras)
1. *Compras → Tipos de cambio*: registre el TC oficial y el paralelo del día.
2. *Compras → Nuevo lote*: fecha, sucursal, proveedor, **TC 70 %** y **TC 30 %** (botón *Usar último TC*), % que va al TC 70 y flete total.
3. **Escanee** o busque cada producto y escriba **cantidad** y **costo en USD**. A la derecha ve el costo en Bs por par antes de confirmar.
4. **Confirmar ingreso**: sube el stock y fija el costo. El costo del lote **no se recalcula** si después cambia el TC.
5. *Compras → Precios y margen*: el sistema **sugiere** precios según el margen objetivo; nunca los cambia solo.

Productos nuevos: primero créelos en *Catálogo* (modelo, colores y tallas) y genere las variantes; imprima etiquetas en *Catálogo → Etiquetas*.

## 3. Sucursales y transferencias
- *Sucursales*: cree, edite, active o desactive. **La Paz** ya está creada e inactiva: **Activar** cuando abra.
- Una sucursal **no se puede desactivar** mientras tenga stock, caja abierta o vendedores activos (la pantalla dice qué falta).
- *Vendedores por sucursal*: elija la sucursal y toque **Asignar**. El vendedor deberá ingresar de nuevo.
- *Sucursales → Nueva transferencia*: elija origen y destino, escanee los productos, ajuste cantidades (no puede pasar del stock del origen) y **Confirmar**. Se mueve todo o nada. El historial queda en *Transferencias*.

## 4. Vendedores
*Usuarios → Nuevo vendedor*: usuario, nombre, sucursal y contraseña inicial de 12 o más caracteres. **Desactivar** corta el acceso al instante.

**Contraseñas.** *Usuarios → Restablecer* (en la fila de un vendedor u otra superadmin): escriba una contraseña temporal o toque **Sugerir una frase** (palabras reales, por ejemplo cuatro palabras y un número). Déjela marcada en *Pedir que la cambie al ingresar*: la persona entra con la temporal y debe elegir una propia antes de usar el sistema. La contraseña se muestra **una sola vez** al confirmar; el sistema solo guarda su huella. Sus sesiones abiertas se cierran. La tabla muestra "Cambiar al ingresar" o la fecha del último cambio. Para su **propia** clave use su nombre en el menú → *Cambiar contraseña* (pide la actual). Si usted, la superadmin, olvidó la suya, el soporte técnico la restablece con `npm run db:bootstrap -- --reset-password` (ver ADMIN-TECNICO).

## 5. Ventas, cambios y anulaciones
- *Ventas → Historial* con filtros (fechas, vendedor, documento, sucursal).
- **Anular una venta**: abra la venta → *Anular esta venta*, escriba el motivo (obligatorio) y confirme. El stock vuelve; la venta queda marcada, no se borra. Una venta que ya tuvo un cambio no se anula: haga un nuevo cambio.
- Usted puede fijar a mano la diferencia de dinero de un cambio.

## 6. Reportes y Excel
*Reportes*: período **Hoy / Semana / Mes / Rango**, filtro por sucursal y vendedor. Vistas: *Resumen, Modelos y tallas, Stock, Vendedores, Cambios y anulaciones, Rentabilidad*. La **utilidad** usa el costo promedio al momento de la venta.
**Descargar Excel** (en cada reporte y en *Cajas*): ventas, stock con costos, compras, rentabilidad y cajas, con totales y suma por método de pago. El Excel del vendedor nunca trae costos.

## 7. Cajas
*Cajas* lista cada turno: efectivo esperado (apertura + ventas en efectivo ± cambios), lo contado y la diferencia, con filtros por fecha, sucursal y cajero. Una caja que quedó abierta se cierra desde la cuenta del vendedor (*Ventas → Caja*); mientras esté abierta aparece “en curso”.

## 8. Errores comunes
| Situación | Qué hacer |
|---|---|
| No deja desactivar una sucursal | Transfiera o ajuste el stock a cero, cierre la caja y reasigne vendedores. |
| “Stock insuficiente en el origen” | La transferencia pide más pares de los que hay: baje la cantidad. |
| Excel “demasiadas filas” | Acorte el rango de fechas (tope de 20.000 filas). |
| Un vendedor no puede vender | ¿Caja abierta? ¿Usuario activo? ¿Sucursal activa? |
| “Demasiados intentos” al ingresar | Espere los minutos que indica el mensaje. |
| Un vendedor olvidó su contraseña | *Usuarios → Restablecer*: asígnele una temporal. |
| Usted olvidó la suya | El soporte técnico ejecuta `db:bootstrap -- --reset-password` (ver ADMIN-TECNICO). |

## 9. Tienda online
- **Abrir / cerrar**: *Tienda online → Estado y contacto → Tienda abierta*. Cerrada, el catálogo se ve pero no se reciben pedidos.
- **Publicar modelos**: *Catálogo*: marque los modelos y pulse *Publicar seleccionados*, o *Publicar todos los listos*. Cada modelo tiene su bloque *Tienda online* para publicar y subir fotos (por color o para todos). Un modelo sin fotos se muestra con una imagen de marca.
- **Zonas y recojo**: nombre y costo de cada zona de entrega; puntos de recojo por sucursal (gratis). Sin zonas solo hay recojo; sin puntos solo hay envío.
- **QR y pagos**: suba la imagen del QR de su banco y escriba las instrucciones (titular, cuenta). Los pedidos por QR muestran el QR, el monto exacto y el código del pedido.
- **Pedidos web**: abra el pedido, mire el comprobante y pulse *Confirmar pago y crear venta* (crea la venta con canal Web y descuenta el stock). *Rechazar comprobante* pide un motivo que la clienta verá. *Marcar en camino / listo para recoger / entregado*; en contra entrega elija cómo cobró al entregar. *Cancelar pedido* (con motivo) anula la venta si ya estaba confirmada.
- Si al confirmar el sistema dice que ya no hay stock, no se creó nada: avise a la clienta o cancele el pedido.
- **Reportes**: filtro *Canal* (todos / tienda física / tienda web); el Excel de ventas trae la columna *Canal*.
