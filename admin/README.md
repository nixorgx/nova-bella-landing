# Nova Bella — Centro de control

Interfaz administrativa independiente de la landing pública, incluida en el mismo repositorio para centralizar el mantenimiento del proyecto.

- **Centro publicado:** [Nova Bella · Centro de control](https://nova-bella-centro-control-2026.keenorbit34.chatgpt.site/) — acceso restringido mediante los permisos del alojamiento.
- **Landing pública:** [Nova Bella · Boutique](https://nova-bella-boutique-2026.keenorbit34.chatgpt.site/).
- **Manual general:** [`../README.md`](../README.md), especialmente las secciones 3 a 8 para entender pantallas, métricas y flujos.

## Ejecutar localmente

Desde la **raíz del repositorio** y con Python instalado:

```powershell
python -m http.server 5174 --directory admin/dist
```

Abrir <http://127.0.0.1:5174/>. Para detener el servidor, presionar `Ctrl+C`.

La interfaz usa HTML, CSS y JavaScript nativo: no necesita `npm` ni compilar paquetes. La carpeta `admin/dist/` contiene los archivos listos para servir:

| Archivo | Función |
| --- | --- |
| `index.html` | Estructura de las pantallas y formularios. |
| `styles.css` | Diseño responsivo y componentes visuales. |
| `app.js` | Navegación, catálogo local, consultas, contenido y actividad. |
| `insights.js` | Ventas, clientes, segmentación, indicadores y gráficas. |
| `backend-client.js` | Conexión HTTPS y sesión temporal para el catálogo de la API. |
| `favicon.svg`, `nova-bella-logo.jpg` | Identidad visual. |

## Uso de la interfaz

| Apartado | Para qué sirve |
| --- | --- |
| **Resumen** | Estado del catálogo, consultas y evolución reciente. |
| **Análisis del negocio** | Ingresos, variaciones, ticket promedio, recurrencia, metas y categorías. |
| **Ventas** | Ver y registrar operaciones para calcular resultados comerciales. |
| **Clientes frecuentes** | Perfiles por alias, compras vinculadas y seguimiento. |
| **Catálogo** | Crear, editar, ocultar o publicar modelos. |
| **Consultas** | Clasificar solicitudes como pendientes, en seguimiento o atendidas. |
| **Contenido web** | Editar textos y ver una vista previa en el panel. |
| **Conexiones y seguridad** | Conectar la API HTTPS y autenticar al administrador. |
| **Actividad** | Consultar acciones recientes. |
| **Configuración** | Descargar JSON y restablecer el estado local. |

## Datos y conexión con el backend

- Al iniciar, las gráficas, ventas, perfiles y consultas incluyen **datos de ejemplo** para mostrar el funcionamiento. No deben citarse como resultados contables reales de Nova Bella.
- En la versión actual, los cambios de ventas, clientes, consultas y contenido se guardan en el **navegador local** (`localStorage`) y no se sincronizan entre computadoras.
- El módulo **Catálogo** puede conectarse al backend: en «Conexiones y seguridad» se indica la URL HTTPS de la API y se autentica al administrador. Entonces los productos se gestionan mediante el servidor.
- Para que la landing muestre los mismos modelos, debe apuntar a la **misma API HTTPS** mediante su propio `dist/api-config.js`.
- La API dispone de endpoints para ventas, clientes e indicadores, pero la interfaz todavía no utiliza esos endpoints para todos esos apartados.
- «Descargar respaldo» exporta datos locales a JSON. **No hay importación/restauración automática** desde ese archivo en la interfaz actual.

## Seguridad y publicación

**El código fuente está en un repositorio público: esto no hace público el acceso al Site administrativo ya alojado.** Son mecanismos distintos. Mantener restringido el Site y utilizar autenticación en la API para cualquier operación protegida.

- No incluir `.env`, contraseñas, secretos JWT, tokens, credenciales PostgreSQL ni información personal en el repositorio.
- Nunca confiar en que ocultar una página HTML protege sus datos: toda información sensible necesita permisos aplicados en el servidor.
- El formulario del panel conserva contraseña y token **solo en memoria** durante la sesión. No añadir persistencia de credenciales en el navegador.
- Para uso empresarial real, completar integración de datos, roles y permisos, respaldos y auditoría centralizada.
- El centro de control publicado en ChatGPT Sites tiene su **propio proyecto y permisos**. Copiar estos archivos a GitHub **no redespliega** ni cambia el acceso del Site existente.
- El servidor estático de desarrollo `http://127.0.0.1:5174` **no implementa el control de acceso** del Site publicado y solo debe usarse en el ordenador del desarrollador.

## Convención de mantenimiento

1. Editar y comprobar los archivos dentro de `admin/dist/`.
2. Validar en el navegador las rutas principales, los cálculos de analíticas y la adaptación a móviles.
3. Confirmar que no se añadieron datos privados ni credenciales.
4. Versionar los cambios en GitHub.
5. Si se desea actualizar también el sitio alojado, desplegar **por separado** la revisión correspondiente en su proyecto de ChatGPT Sites, conservando su acceso restringido.

El manual general del repositorio contiene más información sobre métricas, backend, Docker y las tareas pendientes para el lanzamiento.
