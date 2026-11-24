# Progreso Etapa 2 (Tienda online)

Archivo de trabajo para poder retomar si el agente se interrumpe. Se actualiza tras cada paso importante.

## Estado (2026-11-24)
- [x] Lectura de PLAN/README/DEPLOY/docs; entorno local (`inventario_tienda`, `inventario_tienda_test`, `.env.local` con `DATABASE_URL_PUBLIC` y `ORDER_TOKEN_SECRET`), `npm ci`.
- [x] Migraciones 019-022 (esquema, rol público, funciones públicas, funciones de pedidos, endurecimiento).
- [x] Tienda pública `/tienda*`, proxy, sitemap/robots, imágenes con sharp.
- [x] Admin: Pedidos web, Tienda online, fotos/publicación, canal web en reportes/Excel/ventas.
- [x] Seed demo de tienda (imágenes abstractas, zonas, QR DEMO, 7 pedidos).
- [x] Pruebas: unit + DB (778 en verde, también con `APP_DEFINER_BYPASSRLS=false` en clúster temporal), e2e completo (169 + las nuevas), axe 0 violaciones, sin desbordes 320-1920.
- [x] Revisión de seguridad independiente (agente security-reviewer) y correcciones (ver docs/SEGURIDAD.md).
- [x] Lighthouse (re-medición en base limpia en curso), documentación (TIENDA.md, GUIA-TIENDA.md, manuales, DEPLOY, SEGURIDAD).
- [x] Git local inicializado (commit baseline de Final); rama Neon `tienda` creada (br-late-bar-bdagu3jm); `.env.neon` generado (git-ignorado).
- [x] Commits por funcionalidad, secret scan limpio, repo privado `suchOpi/novaBella_Tienda` publicado.
- [x] Neon rama `tienda` (br-late-bar-bdagu3jm) migrada y sembrada (BYPASSRLS aceptado); modo alternativo validado en rama temporal `tienda-fallback-tmp` (32 políticas definer_all, seed con pedidos OK) y borrada.
- [x] Vercel `novabella-tienda` (https://novabella-tienda.vercel.app): variables de producción, `vercel deploy --prod`, smoke en vivo con Playwright (25/26 comprobaciones; la restante fue un adelanto del script y se verificó aparte), pedidos de prueba cancelados y rotulados "PRUEBA SMOKE", Lighthouse en vivo (Perf 98-100, A11y 100, LCP 0,96-2,30 s, CLS 0).
- [x] Corrida e2e final completa: 170 pruebas en verde (desktop + móvil). Unit+DB: 779 en verde (también en modo sin BYPASSRLS).
- [x] Zip `../Entregas/Tienda.zip` y informe final.

## Decisiones
- Stock web = stock de UNA sucursal (`store_branch_id`; por defecto la primera activa). El recojo es informativo.
- Venta web: sin caja; total = productos; el envío queda en el pedido. QR -> pago `qr`; contra entrega -> `efectivo` provisional y al entregar se registra el método real.
- Token de pedido: HMAC(ORDER_TOKEN_SECRET, clave de idempotencia) de 256 bits; la base guarda SHA-256 del token y SHA-256 de la clave.
- Subidas: tope 4 MB (Vercel corta en 4,5 MB); el navegador reduce fotos grandes; `serverActions.bodySizeLimit = 4.4mb`.
- Vendedor: solo en_camino/listo/entregado de su sucursal. Superadmin confirma/rechaza/cancela.
- Límites públicos en base (IP por /64, teléfono, token, global); sin IP conocida solo rigen los demás.
- La caché `unstable_cache` persiste en disco: tras recrear la base local borrar `.next`.
