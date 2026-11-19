# Nova Bella — propuesta de landing page

Prototipo estático y responsivo para **Nova Bella**, boutique de calzado femenino en Cochabamba (Bolivia).

## Idea creativa

**Concepto:** «Cada paso, una declaración».

La experiencia combina un lenguaje visual editorial de boutique con interacción propia de una tienda digital: fotografía protagonista, tipografía refinada, navegación por colecciones y exploración de productos. La identidad cromática es **provisional** (vino, rosa empolvado, marfil) y se puede ajustar cuando la tienda confirme sus colores oficiales.

## Funciones de la maqueta

- Portada con carrusel de tres campañas visuales.
- Sección de colecciones con enlaces y filtros.
- Lookbook interactivo que permite alternar entre cuatro modelos de calzado.
- Catálogo ilustrativo de cuatro modelos y precios en bolivianos.
- Búsqueda de modelos, filtros por tipo, ordenamiento por precio o nombre y lista de favoritos guardada en el navegador.
- Vista rápida de cada modelo, selección de talla y consulta por WhatsApp.
- Guía orientativa de medidas para elegir tallas; la equivalencia real debe confirmarse con la tienda.
- Preguntas frecuentes, avisos de interacción y acceso flotante a WhatsApp.
- Información de contacto, dirección de referencia verificada y enlace a mapas.
- Diseño adaptable a móvil, tableta y computadora, con controles accesibles.

## Alcance actual

**No hay backend, base de datos, gestión de inventario, carrito, cobros ni recepción automática de pedidos.** Los productos, imágenes, nombres y precios son demostrativos. El número de contacto y la dirección proceden de referencias públicas de la tienda y deberán confirmarse antes de una publicación comercial.

## Tecnologías

HTML5, CSS3 y JavaScript nativo. No requiere Node.js, npm, servidor de aplicaciones ni claves de API. Las fotografías conceptuales están incluidas localmente como WebP. Las tipografías de Google Fonts requieren conexión; existen fuentes de respaldo.

## Probar localmente

Abre `dist/index.html` en tu navegador. También puedes iniciar un servidor HTTP estático desde la carpeta del proyecto:

```bash
python -m http.server 5173 --directory dist
```

Visita `http://localhost:5173`.

## Siguiente fase sugerida

1. Confirmar logo, paleta, fotos originales, productos y precios.
2. Conectar un catálogo real y administrar tallas/variantes/disponibilidad.
3. Crear panel de control independiente para productos, stock, ventas y reportes.
4. Evaluar pedidos, usuarios y métodos de pago tras validar el flujo comercial.

Diseño conceptual: propuesta de demostración, no una tienda online operativa.
