# Revisión de seguridad (Etapa 1)

Autoauditoría con la lista de seguridad del proyecto. Alcance: base de datos, acciones de servidor, rutas, sesión, cabeceras y dependencias. Fecha: cierre de la Fase 8.

## Resultado
Sin hallazgos CRÍTICOS abiertos. Un hallazgo ALTO encontrado y corregido. Quedan abiertos puntos MEDIOS/BAJOS listados abajo.

## Verificado (sin cambios necesarios)
| Control | Cómo se comprobó |
|---|---|
| Costos aislados del vendedor (RLS + GRANT) | Consulta al catálogo de la base: el login del vendedor solo tiene SELECT sobre tablas sin costo; `purchase_*`, `variant_costs`, `exchange_rates`, `sale_item_costs`, `exchange_costs` y `app_settings` (clave de margen) no son legibles. Pruebas `rls.test.ts`, `runtime-isolation.test.ts`, `cost-boundary.test.ts`, e2e de seguridad. |
| Todas las tablas con RLS | Única excepción: `schema_migrations` (sin permiso para ningún login de runtime). `stock_transfers` y `auth_login_attempts` nacen con RLS. |
| Funciones `SECURITY DEFINER` | Todas con `search_path` fijo, dueñas de `app_definer` (no superusuario), sin EXECUTE para PUBLIC. El vendedor solo ejecuta `create_sale`, `create_exchange`, `team_directory` y los helpers de contexto. |
| Identidad de la petición | Firmada con HMAC y verificada por la base (migración 009); `app_role()` sale del login de la conexión, no de un setting. |
| Aislamiento por sucursal | `tests/db/branch-isolation.test.ts`: un vendedor de A no vende, no lista, no ve el detalle, no exporta ni consulta stock/ventas de B, aunque fuerce `?sucursal=` o parámetros de API. |
| CSRF | Acciones de servidor de Next.js (comprobación de Origin/Host integrada, sin `allowedOrigins` extra); cookie `SameSite=Lax`; los route handlers son GET de solo lectura. |
| Validación de entradas | zod en cada acción; UUID de rutas y parámetros validados; las funciones SQL revalidan forma, rangos y límites (p. ej. transferencias: máx. 200 líneas, cantidades 1–100000). |
| Autorización en acciones | Cada archivo `"use server"` llama `requireRole`/`requireUser` (excepto login/logout, públicos por naturaleza). |
| Mensajes de error | Solo mensajes de dominio (`IN001..IN005`) o genéricos; sin SQL ni trazas. Las API devuelven mensajes fijos. |
| Sesión | JWT HS256 con `iss/aud`, 12 h, HttpOnly, SameSite=Lax, Secure en producción, `token_version` revalidado en cada petición (desactivar, cambiar clave, sucursal o rol invalida las sesiones). Sucursal inactiva = sin acceso. |
| Cabeceras | CSP con nonce, sin `unsafe-inline` en scripts; HSTS en producción; `X-Frame-Options: DENY`; `nosniff`; `Referrer-Policy`; `Permissions-Policy`. |
| Secretos | Ninguno en el repositorio (`.env*` ignorado salvo `.env.example`); el seed y el bootstrap leen contraseñas del entorno. |
| Excel | `exceljs`; neutralización de fórmulas en textos de personas; tope de filas con error explícito. |
| SQL de superusuario | Ningún script ni migración lo necesita (probado contra un propietario sin superusuario en el migrador y la limpieza de demo). |

## Hallazgo corregido
**ALTO — Límite de intentos de login solo en memoria.** En un host sin estado (Vercel) cada instancia y cada arranque en frío tenía contadores propios, así que el límite real era un múltiplo del previsto y se reiniciaba. Corrección (migración `017`): contadores en la base (`auth_login_attempts`) con bloqueo atómico por clave (advisory lock), accesibles solo por el login de autenticación mediante dos funciones `SECURITY DEFINER`; el limitador en memoria se mantiene como primera barrera barata. Pruebas: `tests/db/login-throttle.test.ts`.

## Gestión de contraseñas (migración 018)
Se agregaron el cambio de la propia contraseña y el restablecimiento por el superadmin, sin dar `UPDATE` sobre `users` a ningún login de runtime:
- `change_own_password(hash_actual, hash_nuevo)`: `SECURITY DEFINER`, `search_path` fijo, dueña `app_definer`, sin EXECUTE para PUBLIC. La identidad sale del contexto firmado (`app_user_id()`), nunca de un argumento; si la huella guardada ya no es la verificada (otra pestaña, un reset) no escribe y avisa. Exige formato bcrypt.
- `admin_reset_password(usuario, hash, forzar_cambio)`: solo `app_superadmin` puede ejecutarla; rechaza la propia cuenta y usuarios inexistentes.
- Ambas suben `token_version` (todas las demás sesiones mueren) y dejan quién/cuándo; la clave nunca se guarda ni se registra, solo su hash bcrypt.
- La actual se verifica en la app (bcrypt) detrás del limitador compartido de la base: 5 intentos cada 15 min por usuario; el mensaje de error es uno solo y no revela nada más.
- `must_change_password`: un usuario con cambio pendiente no puede usar páginas, acciones, APIs ni exportaciones hasta cambiarla (`getCurrentUser` devuelve nulo; `requireUser` redirige a `/cuenta/contrasena`).
- Pruebas: `tests/db/password-management.test.ts`, `tests/db/password-actions.test.ts`, `tests/unit/passphrase.test.ts` y `e2e/password.spec.ts`.

## Dependencias
`npm audit` reportaba 2 avisos moderados: `uuid` < 11.1.1 arrastrado por `exceljs` (el defecto afecta a v3/v5/v6 con buffer propio; aquí no era explotable). Corregido con `overrides: { "uuid": "^11.1.1" }` en `package.json`; las pruebas de exportación y el e2e de Excel pasan. Resultado: **0 vulnerabilidades**. Al actualizar `exceljs`, revise si el `override` sigue haciendo falta.
Nota: `recharts` figura en `package.json` pero ningún archivo lo importa (los gráficos son propios); puede quitarse en una limpieza futura.

## Abiertos (no bloquean la entrega)
| Nivel | Hallazgo | Mitigación / siguiente paso |
|---|---|---|
| MEDIO | El bloqueo por usuario (20 intentos / 15 min) permite a un atacante dejar sin acceso temporal a una cuenta (denegación de servicio acotada). | Aceptado a cambio de frenar la adivinación distribuida; se muestra el tiempo de espera. |
| BAJO | Cerrar sesión borra la cookie pero no invalida el token en el servidor (vence a las 12 h). | `revoke_user_sessions` lo invalida cuando hace falta. No se invalida al salir porque subir `token_version` cerraría también las sesiones del mismo usuario en otros aparatos. |
| BAJO | Una superadmin que olvida su clave solo la recupera por línea de comandos (`db:bootstrap -- --reset-password`); no hay correo ni preguntas de recuperación. | Decisión consciente: menos superficie de ataque. |
| BAJO | No hay bitácora general de auditoría; solo `password_changed_by/at` en `users`. | Suficiente para quién y cuándo se cambió una clave. |
| BAJO | `GET /api/sesion/reiniciar` cierra la sesión de quien lo visite (logout CSRF). | Impacto mínimo; solo borra la cookie. |
| BAJO | `style-src-attr 'unsafe-inline'` por los colores de muestra (`style=""`). | Documentado; los elementos `<style>` sí exigen nonce. |
| BAJO | Con `trust` en `pg_hba.conf` (clúster local) la base no comprueba contraseñas. | Solo desarrollo; Neon exige TLS y contraseña. |
| BAJO | En Neon el rol `app_definer` puede quedar sin `BYPASSRLS`; el migrador lo cubre con políticas. | Verificado contra Neon real en ambos modos con las migraciones 001 a 017 (ver DEPLOY.md); la 018 se aplica igual. |

---

# Revisión de seguridad — Etapa 2 (tienda online, superficie pública anónima)

Alcance: migraciones 019 a 022, `src/features/store/**`, `src/app/(store)/**`, proxy y CSP, subida y servido de imágenes, lado del equipo (`pedidos`, `tienda-online`, publicación y fotos) y el canal web en reportes. Se hizo una autoauditoría y una revisión independiente con el agente `security-reviewer` (solo lectura). Resultado: **0 CRÍTICOS**; 1 ALTO y 3 MEDIOS corregidos (abajo); BAJOS corregidos o documentados.

## Controles verificados (pruebas automáticas)
| Control | Cómo se comprobó |
|---|---|
| El login anónimo `app_runtime_public` no tiene ningún privilegio sobre tablas, columnas ni secuencias, ni sobre `app_private`; solo ejecuta `public_*()` | `tests/db/store-public-role.test.ts` (catálogo de privilegios, 42501 en cada tabla, en las funciones de administración y en `create_sale`) |
| Todas las funciones `public_*` son `SECURITY DEFINER`, dueñas de `app_definer`, con `search_path` fijo y sin EXECUTE para PUBLIC | mismo archivo |
| RLS activa en las 8 tablas nuevas; el vendedor solo lee pedidos de su sucursal, nunca comprobantes, ajustes ni imágenes; ni la superadmin escribe pedidos con SQL directo | `tests/db/store-confirm.test.ts` |
| Precio, tarifa y disponibilidad salen de la base (el cliente solo manda `variant_id` y cantidad); no se acepta un precio manipulado | `tests/db/store-orders.test.ts`, e2e (localStorage alterado) |
| Sin sobreventa ni stock negativo: confirmar vuelve a bloquear y comprobar; dos pedidos por la última unidad (uno confirma, otro falla limpio); doble clic = una venta | `tests/db/store-concurrency.test.ts`, `store-confirm.test.ts` |
| Token del pedido de 256 bits (HMAC), la base guarda solo SHA-256; un comprobante o cancelación solo aplica al pedido del token | `tests/db/store-orders.test.ts`, `tests/unit/store-core.test.ts` |
| Ninguna respuesta pública contiene costo, margen, proveedor, tipo de cambio, hashes ni secretos (funciones SQL, HTML, payload RSC, sitemap) | `tests/db/store-catalog.test.ts` (`FORBIDDEN`), `e2e/tienda-seguridad.spec.ts` |
| Imágenes: solo JPEG/PNG/WebP por bytes mágicos (SVG, GIF, HEIC y PDF rechazados), recodificadas con sharp (sin EXIF/GPS, sin transparencia), WebP verificado también por la base, `nosniff`, `CSP: sandbox`, tope 4 MiB y 30 Mpx | `tests/unit/store-cart-images.test.ts`, e2e (QR y SVG) |
| CSP con nonce sin `unsafe-inline` en scripts, sin hosts de terceros, sin violaciones ni errores de consola en la tienda; acciones de servidor rechazan `Origin` ajeno | `e2e/tienda-seguridad.spec.ts` |
| La página del pedido es `noindex`, `referrer: no-referrer`, sin caché; el robots oculta las rutas privadas; los modelos no publicados y sus fotos no son públicos | idem |
| Único `dangerouslySetInnerHTML`: JSON-LD, con `<`, `>`, `&` y separadores de línea escapados | `tests/unit/store-core.test.ts` |
| El modo de `app_definer` sin `BYPASSRLS` también funciona (políticas `definer_all` en las tablas nuevas) | suite completa con `APP_DEFINER_BYPASSRLS=false` en un clúster nuevo: 779 pruebas en verde |

## Hallazgos de la revisión y su resolución
| Nivel | Hallazgo | Resolución |
|---|---|---|
| ALTO | Límites del checkout: el límite por IP se esquivaba con IPv6 (cada dirección de un /64 era una cuenta nueva); el cupo global de 400/h permitía a un atacante dejar sin servicio a todos; sin IP conocida no regía el límite por IP; sin forma de limpiar pedidos spam (no se pueden borrar) | IPv6 se cuenta por /64 (`ipBucket`); cupo global subido a 1000/h (solo respaldo); el límite por teléfono y el tope de 5 pendientes por teléfono siguen; con `TRUST_PROXY=1` en Vercel hay IP real; migración `022` y botón **Limpiar pedidos sin pagar** (cancela pendientes sin comprobante de más de N días); el pedido spam no reserva stock |
| MEDIO | `idempotency_key` se guardaba en claro y el token deriva de ella: un vendedor con `SELECT` sobre `web_orders` de su sucursal podía reproducir el checkout y obtener el enlace de un cliente | La app guarda solo `sha256(clave)`; la clave original nunca llega a la base (el token se deriva en el servidor) |
| MEDIO | Una clave de idempotencia reutilizada devolvía un pedido anterior ignorando datos nuevos (misma pestaña, mismo carrito) | La clave guardada en `sessionStorage` se borra al terminar un pedido y depende del contenido del carrito |
| MEDIO | Un desconocido podía hacer correr sharp (hasta 30 Mpx) antes de verificar el token, y cancelar no tenía límite por IP | Se verifica que el pedido exista **antes** de decodificar; límite por IP/64 en comprobantes y cancelación; límite por token con su hash |
| BAJO | `/tienda/img/[id]?x=aleatorio` generaba entradas de caché distintas hacia la base | La ruta solo acepta `?t=1`; cualquier otro parámetro es 404 |
| BAJO | Las instrucciones bancarias eran públicas aunque el QR requiere token | Ya no se imprimen en "Cómo comprar"; solo las ve quien tiene el enlace de un pedido |
| BAJO | Se podía crear objetos en el esquema `public` si el servidor es antiguo | `revoke create on schema public from public` (022) |
| BAJO | Claves de idempotencia fijas del seed permitían abrir los pedidos demo a quien leyera el repositorio | `SEED_STORE_RANDOM_KEYS=true` para demos desplegadas |
| BAJO (aceptado) | El token viaja en la URL (aparece en registros de acceso e historial de equipos compartidos); la página muestra nombre, celular, correo y dirección a quien tenga el enlace | Diseño aceptado (alternativa sin cuentas); página sin caché ni referer ni índice; documentado |
| BAJO (aceptado) | Las fotos son inmutables un año: despublicar no las retira de cachés ya llenas | Aceptado; el id es aleatorio y no se enumera |
| BAJO (aceptado) | Un recojo en una sucursal distinta de la que despacha no aparece al vendedor de esa sucursal | Limitación documentada (`docs/TIENDA.md`, sección 4) |

## Riesgos residuales y decisiones externas
- Sin un desafío anti-bots (Turnstile o similar) un atacante con muchas direcciones IPv4 puede crear pedidos spam; el costo es ruido, no sobreventa ni acceso a datos. Evaluar un CAPTCHA si aparece abuso real.
- El comprobante se acepta tal cual lo muestra la imagen: la confirmación humana es el control (QR manual). Una pasarela real sustituirá esa verificación.
- Los datos personales de los pedidos se conservan (parte del historial de ventas); definir con la clienta la política de retención y privacidad.
