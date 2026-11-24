# NovaBella — Versión final (guía para presentar)

Sistema de inventario y punto de venta para Naty, con la imagen de la boutique.
Usuarios: **`Naty`** (superadmin) y **`vendedor1`** (vendedor). Las contraseñas se entregan por separado (no están en este documento ni en el código).
El usuario no distingue mayúsculas: `Naty` y `naty` entran igual.

## Qué hay de nuevo frente a las demos
1. **Imagen nueva, pensada para una boutique.** Marfil cálido, rosa antiguo y rubor, ciruela profundo para los botones importantes, dorado champán como detalle y verde salvia para lo que está bien. Títulos en una letra serif elegante (Playfair Display) y el resto en una sans clara (DM Sans). Marca "NovaBella" dibujada en el propio sistema.
2. **Pantallas más suaves y claras**: esquinas redondeadas, sombras suaves, botones con respuesta al tocar, y menú lateral ciruela con el nombre de quien ingresó. El punto de venta sigue siendo grande y rápido, con el total siempre a la vista.
3. **Gráficos y colores que se leen bien**: un solo tono rosa para las cantidades, línea punteada dorada para comparar con el mes anterior, y el azul se reserva para lo que solo ve la superadmin (costos y utilidad). Todo con números y etiquetas, no solo color.
4. **Todo lo de las demos 1 a 3**: catálogo con variantes y etiquetas, compras con costo y tipo de cambio, punto de venta con pagos mixtos, cambios y anulaciones, cajas, reportes con Excel, sucursales y transferencias.
5. **Contraseñas**: cada persona puede cambiar la suya (su nombre en el menú → *Cambiar contraseña*); la superadmin restablece la de una vendedora desde *Usuarios* con una frase sugerida de palabras reales y, si quiere, la obliga a cambiarla al ingresar.
6. El **ticket de 80 mm y las etiquetas** siguen en blanco y negro, con el mismo tamaño (la cabecera del ticket dice NOVABELLA).

## Guion corto (~10 min)
1. **Ingreso.** Abrir la dirección, mostrar la pantalla de entrada y entrar como `Naty`.
2. **Dashboard.** Ventas del mes contra el mes anterior, utilidad (azul, solo superadmin), caja de hoy, "Para reponer" y modelos más vendidos.
3. **Catálogo y etiquetas.** Un modelo con sus colores y tallas; armar e imprimir etiquetas con QR y código de barras.
4. **Stock.** Matriz por color y talla; verde, ámbar y rojo con texto (Disponible, Pocos, Agotado).
5. **Punto de venta** (entrar como `vendedor1`). Escanear o buscar, cambiar el precio si hace falta, pago mixto, confirmar e imprimir el ticket. El vendedor no ve costos en ninguna pantalla.
6. **Cambio y anulación.** Desde el detalle de una venta; la diferencia la calcula el sistema.
7. **Cajas y reportes.** Turnos con efectivo esperado y contado; reportes por período y matriz modelo × talla; descarga de Excel.
8. **Sucursales.** Como superadmin: sucursales y transferencias de stock (La Paz queda lista para activarse).
9. **Contraseñas.** *Usuarios → Restablecer* en una vendedora de prueba; ingresar con la temporal y mostrar que el sistema pide la nueva.

## Notas
- La web pública de ventas (Etapa 2) **no** está incluida: se empieza solo con aprobación.
- Para volver a empezar una demo en local: `npm run db:reset` (solo bases locales).
- Instrucciones de publicación: `DEPLOY.md`. Detalle técnico: `docs/ADMIN-TECNICO.md`.
