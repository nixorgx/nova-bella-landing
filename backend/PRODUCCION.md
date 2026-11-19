# Preparación HTTPS · pendiente de despliegue

Arquitectura: centro privado → FastAPI → PostgreSQL y landing → catálogo público FastAPI. Los navegadores nunca reciben credenciales ni cadenas de conexión PostgreSQL.

## Render + Supabase

`render.yaml` prepara un servicio Docker único, plan gratuito, despliegue automático desactivado, puerto 10000, healthcheck y variables privadas pendientes. Guardarlo no crea recursos externos. Confirmar repositorio `nixorgx/nova-bella-landing` y revisión antes del push; crear servicios solo en una cuenta autorizada.

Render gratuito permite validar la integración: se suspende tras 15 minutos inactivo y el arranque puede tardar aproximadamente un minuto. No garantiza disponibilidad comercial; no crear pings para impedir la suspensión. La landing espera siete segundos, por lo que puede mostrar indisponibilidad y requerir recarga durante el arranque frío. Render desaconseja este plan para producción. [Documentación](https://render.com/docs/free).

## Base de datos y secretos

1. Elegir una base Supabase dedicada a Nova Bella y región próxima al servicio. No alterar proyectos compartidos ni importar datos reales.
2. Conexión directa si hay IPv6 o pooler en **modo sesión** para IPv4. No se necesita modo transacción. Configurar `sslmode=verify-full` y certificado raíz mediante archivo secreto; `sslmode=require` cifra pero no verifica identidad. [Conexiones Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres).
3. Inicializar tablas e índices con cuenta de mantenimiento mediante `Database(...).initialize()`. Revisar esquema y respaldo antes de futuros cambios; no hay todavía un sistema general de migraciones versionadas.
4. Crear cuenta distinta de aplicación: `NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`, USAGE del esquema, SELECT/INSERT/UPDATE en products/customers/sales y SELECT/INSERT en audit_events. No debe ser propietaria ni recibir DDL o DELETE. El script local ilustra los privilegios pero solo apunta a Docker; no ejecutarlo contra Supabase.
5. Desactivar Data API en el proyecto dedicado si no se usa. Si debe seguir activa, retirar privilegios de `anon` y `authenticated` sobre estas cuatro tablas y habilitar RLS con políticas solo para la cuenta de aplicación. Verificar que REST no exponga ocultos, ventas, clientes ni auditoría. No alterar otras tablas o proyectos. [Seguridad Data API](https://supabase.com/docs/guides/api/securing-your-api).
6. Guardar `DATABASE_URL` de la cuenta limitada, `JWT_SECRET`, `ADMIN_EMAIL` y `ADMIN_PASSWORD_HASH` en variables privadas Render. Usar `INITIALIZE_SCHEMA=false`. Regenerar el hash antiguo mediante entrada oculta; no enviarlo por chat ni subir `.env`.

## Activación pendiente

1. Acceso del propietario a Render/Supabase, elección de cuenta/región y revisión del plan sin gasto autorizado. No se contrató nada.
2. Publicar la revisión aprobada, configurar variables/certificado y desplegar manualmente. Render termina HTTPS. [Referencia del despliegue](https://render.com/docs/blueprint-spec).
3. Verificar health, CORS de los dos dominios exactos, rechazo sin JWT y crear → publicar → consultar → ocultar → archivar con datos aislados.
4. El comando preparado no confía en cabeceras de proxy del cliente; tras Render, el límite de login puede agrupar usuarios. Para límites por IP, configurar solo proxies verificados. No confiar en `*` sin comprobar que el proveedor sanea cabeceras manipulables. El comportamiento conservador es apropiado para esta prueba de un administrador.
5. Configurar HTTPS en `dist/api-config.js` y publicar con autorización. Introducir la misma URL en «Conexiones y seguridad» del centro y autenticar al administrador; JWT en memoria.
6. Verificar ambas interfaces reales. Ventas/clientes/análisis del panel requieren integración posterior; sus endpoints de backend ya existen.
7. Para migrar datos: respaldo restaurado en aislamiento, autorización, importación y comparación posterior. No se realizó migración.

Esta guía no acredita TLS remoto, backups administrados ni integración remota verificados. Esas comprobaciones requieren el despliegue real.
