# Accesibilidad y rendimiento (cierre de la Fase 8)

## Accesibilidad
**Pruebas automáticas:** `e2e/a11y.spec.ts` ejecuta axe (`@axe-core/playwright`, etiquetas WCAG 2.0/2.1/2.2 A y AA) sobre:
login (también con errores), y como superadmin dashboard, stock, reportes (3 vistas), cajas, sucursales, transferencias (con una sola sucursal activa y con un producto cargado), compras, nuevo lote, historial, usuarios, catálogo y clientes; el POS con carrito, dos pagos y la lista de resultados abierta; y como vendedor POS, stock, reportes, historial, caja y clientes; además los paneles y diálogos (nuevo cliente, cambio, anulación) y el ticket.
**Resultado final: 0 violaciones.**

**Paleta de la versión final ("boutique suave").** Todos los pares texto/fondo se verificaron con la fórmula de contraste de WCAG antes de usarse; ninguno baja de 4,5:1:

| Par | Contraste |
|---|---|
| texto `#2a1722` sobre marfil `#fffaf6` | 16,3:1 |
| texto secundario `#5b4553` / tenue `#6a5260` sobre marfil | 8,4:1 / 6,8:1 (sobre el fondo hundido `#efe3d8`: 6,9:1 / 5,6:1) |
| botón principal: `#fff7f2` sobre ciruela `#6e2447` | 9,9:1 |
| sobre rubor `#f7dfe1`: ciruela oscuro `#541a37` / rosa `#a23b60` | 10,5:1 / 5,0:1 |
| disponible `#1d4630` sobre salvia `#dcebdd` (borde `#2f6547`) | 5,5:1 o más |
| pocos pares `#5a3900` sobre ámbar `#f6e5bf` | 6,2:1 o más |
| agotado `#a1232d` sobre `#f8d9d6` | 5,7:1 |
| costo (solo superadmin) `#2b4a85` sobre `#dde7f6` | 6,9:1 |
| menú lateral: `#f6e8e6` / `#c9afbf` sobre ciruela `#2c1527` | 14,2:1 / 8,3:1 |
| detalle dorado (etiquetas pequeñas) `#6b4d12` sobre marfil | 7,5:1 |

El mapa de calor usa una sola rampa rosa cuyo paso más oscuro sigue admitiendo texto oscuro (el número siempre se lee); los gráficos distinguen la serie por forma además de color (barras frente a línea punteada) y todo valor está impreso o en la tabla alternativa. Fuentes: Playfair Display (títulos) y DM Sans (interfaz), alojadas por `next/font`, subconjunto latino y `font-display: swap`.

**Comprobado además por prueba:** foco visible en cada control alcanzable con Tab (POS), `prefers-reduced-motion` (transiciones y animaciones ≤ 0,001 ms), venta completa solo con teclado (F2, escribir, flechas, Enter, Ctrl+Enter), diálogos con `<dialog>` nativo (foco atrapado, Esc), combobox de búsqueda con `role="combobox"`, `aria-controls`, `aria-activedescendant` y lista `role="listbox"`.

**Limitaciones conocidas (no automatizables):**
- axe no valida el uso real con lector de pantalla; se recomienda una pasada manual con VoiceOver/NVDA en POS y transferencias antes de producción.
- El escaneo con cámara depende del permiso del navegador y de HTTPS; el lector USB (teclado) y la búsqueda escrita son alternativas completas.
- Los gráficos del dashboard son SVG propios, enfocables con teclado, y axe no reportó problemas; no se probó con zoom al 400 % en todas las vistas (sí a 320 px sin desbordes).

## Capturas responsive
`e2e/final-responsive.spec.ts` guarda en `e2e/screenshots/final/` 78 capturas (login, POS con carrito, stock, reportes, historial, caja del vendedor; dashboard, stock, reportes, cajas, sucursales, transferencias y nueva transferencia del superadmin) a **320, 375, 768, 1024, 1440 y 1920 px**, y falla si alguna tiene desborde horizontal. Resultado: ninguna desborda.

## Rendimiento (Lighthouse, `npm run perf:lighthouse`)
Condiciones: `npm run build && npm start`, base sembrada, Chromium de Playwright, perfil móvil con limitación simulada de red y CPU de Lighthouse (el más severo), mediana de 5 ejecuciones por pantalla, con sesión iniciada para las privadas. Datos en `e2e/perf/lighthouse.json`.

| Pantalla | Perf | A11y | Mejores prácticas | FCP | LCP | TBT | CLS | JS (gzip) | CSS |
|---|---|---|---|---|---|---|---|---|---|
| Login | 94 | 100 | 100 | 0,93 s | 0,93 s | 276 ms* | 0 | 142 KB | 16 KB |
| POS (vendedor) | 99 | 100 | 100 | 0,97 s | 0,97 s | 128 ms | 0 | 167 KB | 16 KB |
| Dashboard | 96 | 100 | 100 | 0,98 s | 0,98 s | 245 ms* | 0 | 166 KB | 16 KB |
| Reportes | 97 | 100 | 100 | 0,97 s | 0,97 s | 183 ms | 0 | 166 KB | 16 KB |
| Stock | 99 | 100 | 100 | 0,98 s | 0,98 s | 143 ms | 0 | 163 KB | 16 KB |

Objetivos (reglas web del proyecto): LCP < 2,5 s, CLS < 0,1, TBT < 200 ms (proxy de INP), FCP < 1,5 s. **LCP, CLS y FCP se cumplen en todas.**
\* **TBT:** esta medición se tomó con el equipo cargado por otro programa (carga media > 5). En una corrida anterior, con la máquina libre, el TBT fue de 30 a 75 ms en todas las pantallas. Repita `npm run perf:lighthouse` en una máquina en reposo para el número definitivo.
Presupuestos de peso (página de aplicación: JS < 300 KB, CSS < 50 KB): cumplidos con amplio margen.

### Mejoras aplicadas
1. **LCP de 2,7–2,9 s a ~0,95 s** en POS, dashboard, reportes y stock: el layout de la aplicación envolvía todo en `<Suspense fallback="Cargando…">`, de modo que el navegador pintaba el aviso y la página real (el elemento LCP) llegaba después, con el trozo transmitido y el JS que lo inserta, bajo limitación. Se quitó el fallback global y el documento llega completo (`src/app/(app)/layout.tsx`); las secciones lentas conservan su `loading.tsx`.
2. **Login sin primer pintado (NO_FCP) en Lighthouse**: las animaciones de entrada partían de `opacity: 0`, ocultando el texto del primer pintado. Ahora solo usan `transform` (`login.css`).
3. Ya estaban bien (verificado): fuentes con `next/font` y `display: swap` y precarga, sin imágenes en las pantallas medidas (no hay riesgo de dimensiones), `@zxing/browser` cargado con `import()` solo al abrir la cámara (chunk de 124 KB gzip que no se descarga en el POS), `exceljs` solo en el servidor, y los gráficos son SVG propios (sin librería de gráficos en el cliente).
4. Probado y descartado: `font-display: optional` (no mejoró el LCP; se mantiene `swap` según la regla).

---

# Etapa 2: tienda online

## Accesibilidad
`e2e/tienda-a11y.spec.ts` ejecuta axe (WCAG 2.0/2.1/2.2 A y AA) a **375 y 1440 px** sobre: catálogo (con filtros abiertos, sin resultados y con filtros inválidos), producto (con y sin talla elegida), carrito vacío y con producto, checkout (domicilio + QR; recojo + contra entrega + factura; con errores de validación), 404, y la página de estado del pedido en **cada uno de los 7 estados**; y en el equipo: *Pedidos web* (lista y filtro), detalle de pedido (con los paneles de rechazar y cancelar abiertos), *Tienda online*, la página de modelo con fotos y publicación, el catálogo con la barra de publicación y Reportes por canal, como superadmin, y *Pedidos* / detalle como vendedor. **Resultado: 0 violaciones.** Correcciones que salieron de la auditoría: el enlace del carrito exponía una etiqueta que no contenía su texto visible (ahora el nombre accesible es "Carrito: N pares"); los radios y casillas son de 24 px; foco visible y `scroll-margin` para que el encabezado fijo no tape el control enfocado.
Además se probó: navegación solo con teclado (elegir talla con Espacio y agregar con Enter, enlace "Saltar al contenido"), `prefers-reduced-motion` (sin animaciones ni transiciones), y **sin desbordes horizontales a 320, 375, 768, 1024, 1440 y 1920 px** en todas las páginas públicas y en las nuevas pantallas del equipo.

## Rendimiento
Medido con Lighthouse móvil (limitación simulada de red y CPU), sobre producción real en Vercel (HTTP/2), mediana de 3 ejecuciones:

| Página | Perf | A11y | Mejores prácticas | FCP | LCP | TBT | CLS |
|---|---|---|---|---|---|---|---|
| Catálogo `/tienda` | 98 | 100 | 100 | 0,89 s | 2,18 s | 56 ms | 0 |
| Producto `/tienda/alba` | 98 | 100 | 100 | 0,96 s | 2,30 s | 35 ms | 0 |
| Carrito | 100 | 100 | 100 | 0,96 s | 0,96 s | 38 ms | 0 |

En local (`npm start`, HTTP/1.1 y el mismo perfil simulado) el catálogo y el producto midieron LCP de 2,6 y 2,85 s por la cola de conexiones de HTTP/1.1; las páginas internas nuevas (*Pedidos web*, *Tienda online*) midieron Perf 100, LCP 0,76 s. Peso de la página de catálogo: **JS 142 KB gzip** (presupuesto ~200 KB) y **CSS 12 KB** (presupuesto 30 KB). CLS 0 porque cada imagen lleva `width` y `height`.

Decisiones: sin scripts de terceros; fuentes con `next/font` (no se quitó la precarga: probado y empeoraba el CLS a 0,19); fotos en WebP con dos tamaños (miniatura 400 px para listados, 900 px para producto) con `srcset`, `loading="lazy"` salvo la primera imagen (`fetchpriority="high"` y `preload`); caché de datos de 30 s (`unstable_cache`); imágenes inmutables con ETag; los estilos del sistema interno ya no se cargan en la tienda; la animación de entrada de las tarjetas se quitó porque retrasaba el pintado de la imagen principal.
Pendiente de medir con datos reales: fotos reales de 100-150 KB (las de la demo son ilustraciones de ~5 KB) aumentarán algo el LCP.
