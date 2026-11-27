/**
 * Adaptador idempotente sobre la landing existente. Ejecutar desde la raíz del
 * repositorio actual después de copiar gestion/ (no sustituye HTML ni estilos).
 * Preserva el hero, el lookbook, las fotografías y el resto de la landing.
 */
import fs from 'node:fs';
import path from 'node:path';

const file = path.resolve(process.cwd(), 'dist', 'script.js');
if (!fs.existsSync(file)) throw Error(`No se encontró ${file}. Ejecuta desde la raíz del repositorio de la landing.`);
let source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
if (source.includes('/* NOVA_BELLA_TEAM_INTEGRATION_V1 */')) {
  console.log('La integración ya está aplicada.');
  process.exit(0);
}

function replaceOnce(before, after, label) {
  if (!source.includes(before)) throw Error(`No se encontró el bloque «${label}». No se modificó el archivo.`);
  source = source.replace(before, after);
}

replaceOnce(
  '\nconst slides = [',
  '\nconst editorialProducts = [...products];\n\nconst slides = [',
  'productos editoriales'
);

const start = source.indexOf('async function hydrateCatalog() {');
const end = source.indexOf('\nfunction showToast(', start);
if (start < 0 || end < start) throw Error('No se encontró hydrateCatalog. No se modificó el archivo.');
const hydrate = `/* NOVA_BELLA_TEAM_INTEGRATION_V1 */
async function hydrateCatalog() {
  const base = String(window.NOVA_BELLA_API_URL || '').trim().replace(/\\/+$/, '');
  // El dominio se configura al desplegar el nuevo sistema de gestión.
  if (!base) return;
  let origin;
  try {
    const url = new URL(base);
    if (url.href !== url.origin + '/' && url.href !== url.origin) throw Error('URL inválida');
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw Error('URL insegura');
    origin = url.origin;
  } catch {
    document.getElementById('catalogNote').textContent = 'La conexión del catálogo necesita una URL HTTPS válida.';
    return;
  }
  try {
    const response = await fetch(origin + '/api/v1/public/products', {
      headers: { Accept: 'application/json' }, credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) throw Error('Respuesta HTTP ' + response.status);
    const payload = await response.json();
    if (!Array.isArray(payload.items) || payload.items.length > 1000) throw Error('Catálogo inválido');
    const mapped = payload.items.map(item => {
      if (!item || typeof item.id !== 'string' || typeof item.name !== 'string' || typeof item.category !== 'string' || !Number.isFinite(Number(item.price_bs)) || Number(item.price_bs) <= 0) throw Error('Producto inválido');
      const verifyUrl = (value, prefix) => {
        if (typeof value !== 'string') return '';
        try { const url = new URL(value, origin); return url.origin === origin && url.pathname.startsWith(prefix) ? url.href : ''; }
        catch { return ''; }
      };
      const sizes = Array.isArray(item.sizes) ? item.sizes.slice(0, 40).filter(size => size && typeof size.label === 'string').map(size => ({ label: size.label, available: Boolean(size.available) })) : [];
      const imageUrl = verifyUrl(item.image_url, '/tienda/img/');
      const shopUrl = verifyUrl(item.shop_url, '/tienda/');
      return {
        id: item.id, name: item.name, category: item.category,
        color: String(item.color || 'Consultar colores'),
        price: 'Bs ' + Number(item.price_bs).toLocaleString('es-BO', { maximumFractionDigits: 2 }),
        priceValue: Number(item.price_bs),
        description: String(item.description || ''), badge: item.available ? 'DISPONIBLE' : 'AGOTADO',
        imageClass: visualForColor(item.color), imageUrl, shopUrl, sizes, available: Boolean(item.available)
      };
    });
    products = mapped;
    liveCatalog = true;
    const categories = [...new Set(products.map(product => product.category))];
    const slots = filterButtons.filter(button => button.dataset.filter !== 'Todos');
    slots.forEach((button, index) => {
      button.hidden = !categories[index];
      if (categories[index]) { button.dataset.filter = categories[index]; button.textContent = categories[index]; }
    });
    if (categories.length > slots.length) {
      const parent = slots[0]?.parentElement;
      categories.slice(slots.length).forEach(category => {
        const button = document.createElement('button');
        button.className = 'filter-button'; button.type = 'button';
        button.dataset.filter = category; button.textContent = category;
        button.setAttribute('aria-pressed', 'false');
        button.addEventListener('click', () => setCategory(category));
        parent?.appendChild(button);
        filterButtons.push(button);
      });
    }
    currentCategory = 'Todos';
    filterButtons.forEach(button => {
      const active = button.dataset.filter === 'Todos';
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    if (!productSort.querySelector('option[value="price-asc"]')) {
      productSort.add(new Option('Precio de menor a mayor', 'price-asc'));
      productSort.add(new Option('Precio de mayor a menor', 'price-desc'));
    }
    document.getElementById('catalogNote').textContent = 'Modelos, precios y disponibilidad consultados al inventario actualizado de Nova Bella.';
    document.getElementById('catalogFaqAnswer').textContent = 'Consulta las tallas disponibles y completa tu compra desde la tienda en línea.';
    favorites = new Set([...favorites].filter(id => products.some(product => product.id === id)));
    try { localStorage.setItem('nova-bella-favoritos', JSON.stringify([...favorites])); } catch { /* opcional */ }
    renderProducts();
  } catch (error) {
    document.getElementById('catalogNote').textContent = 'No pudimos actualizar los precios y existencias. Consulta directamente con Nova Bella.';
    console.warn('Catálogo conectado no disponible:', error.message);
  }
}
`;
source = source.slice(0, start) + hydrate + source.slice(end);

// Use a numeric amount rather than parsing the locale-formatted price.
source = source.replace(
  "const numericPrice = product => Number(product.price.replace(/[^0-9]/g,''));",
  "const numericPrice = product => Number(product.priceValue ?? String(product.price).replace(/[^0-9]/g, ''));"
);

// Keep the editorial lookbook usable even when the connected inventory has new IDs.
replaceOnce(
  'const product = products.find(item => item.id === id);\n  if (!product) return;\n  activeDialogProduct',
  'const product = products.find(item => item.id === id) || editorialProducts.find(item => item.id === id);\n  if (!product) return;\n  activeDialogProduct',
  'vista rápida del producto'
);

replaceOnce(
  "document.getElementById('dialogSizes').innerHTML = [35,36,37,38,39,40].map(size => `<button type=\"button\" data-size=\"${size}\" aria-pressed=\"false\">${size}</button>`).join('');",
  `const sizes = product.sizes?.length ? product.sizes : (product.shopUrl ? [] : [35,36,37,38,39,40].map(size => ({ label: String(size), available: true })));
  document.getElementById('dialogSizes').innerHTML = sizes.map(size =>
    \`<button type="button" data-size="\${escapeProductHtml(size.label)}" aria-pressed="false" \${size.available ? '' : 'disabled title="Talla agotada"'}>\${escapeProductHtml(size.label)}</button>\`
  ).join('') || '<span>Consulta las tallas en la tienda</span>';
  let shopLink = document.getElementById('dialogBuyOnline');
  if (!shopLink) {
    shopLink = document.createElement('a');
    shopLink.id = 'dialogBuyOnline';
    shopLink.className = 'button button-outline dialog-whatsapp';
    shopLink.target = '_blank'; shopLink.rel = 'noopener noreferrer';
    document.getElementById('dialogWhatsApp').insertAdjacentElement('afterend', shopLink);
  }
  shopLink.hidden = !product.shopUrl;
  if (product.shopUrl) {
    shopLink.href = product.shopUrl;
    shopLink.textContent = product.available ? 'Elegir talla y comprar' : 'Ver modelo en la tienda';
  }`,
  'tallas y enlace de compra'
);

// Keep the editorial gallery independent from the server's IDs and categories.
source = source.replace(
  'function selectSpotlight(id) {\n  const product = products.find(item => item.id === id);',
  'function selectSpotlight(id) {\n  const product = editorialProducts.find(item => item.id === id) || products.find(item => item.id === id);'
);
source = source.replace(
  'function setCategory(category) {\n  currentCategory = category;',
  "function setCategory(category) {\n  if (liveCatalog && category !== 'Todos' && !products.some(item => item.category === category)) category = 'Todos';\n  currentCategory = category;"
);
fs.writeFileSync(file, source, 'utf8');
const cssFile = path.resolve(process.cwd(), 'dist', 'styles.css');
if (fs.existsSync(cssFile)) {
  let css = fs.readFileSync(cssFile, 'utf8');
  if (!css.includes('/* Gestión Nova Bella: enlace de compra */')) {
    css += '\n/* Gestión Nova Bella: enlace de compra */\n#dialogBuyOnline[hidden] { display: none !important; }\n#dialogBuyOnline { margin-top: .6rem; }\n';
    fs.writeFileSync(cssFile, css);
  }
}
console.log('Landing conectada al catálogo del nuevo sistema (URL pendiente de configurar en dist/api-config.js).');
