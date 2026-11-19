let products = [
  { id: 'alba', name: 'Alba · Slingback', category: 'Tacones', color: 'Marfil', price: 'Bs 429', badge: 'ELEGANCIA DIARIA', imageClass: 'shot-ivory', description: 'Una silueta delicada y contemporánea, pensada para aportar elegancia a cada ocasión.' },
  { id: 'vega', name: 'Vega · Bota alta', category: 'Botas', color: 'Negro', price: 'Bs 549', badge: 'ESTILO ICÓNICO', imageClass: 'shot-black', description: 'Una bota de líneas definidas que transforma cualquier look con carácter.' },
  { id: 'roma', name: 'Roma · Botín', category: 'Botas', color: 'Vino', price: 'Bs 489', badge: 'NUEVO ESTILO', imageClass: 'shot-wine', description: 'Una textura de acabado intenso y una forma audaz para destacar sin esfuerzo.' },
  { id: 'duna', name: 'Duna · Mocasín', category: 'Casuales', color: 'Caramelo', price: 'Bs 399', badge: 'VERSÁTIL', imageClass: 'shot-tan', description: 'Una propuesta cómoda y sofisticada para acompañarte durante todo el día.' }
];

const slides = [
  { eyebrow: 'NUEVA TEMPORADA · CONCEPTO 2026', title: 'No es solo<br>un par.<br><em>Es tu actitud.</em>', description: 'Hay zapatos que completan un look. Y otros que lo transforman. Descubre inspiración para tu siguiente gran paso.', image: 'assets/campana-hero.webp', alt: 'Botines color vino en una sesión editorial de moda', caption: 'Inconfundible.' },
  { eyebrow: 'EL ESTILO ES UNA ACTITUD', title: 'Atrévete a<br><em>pisar fuerte.</em>', description: 'Haz espacio para nuevas versiones de ti. Una silueta puede cambiar por completo la forma de llevar tu día.', image: 'assets/editorial-pasos.webp', alt: 'Zapatos de tacón color vino sobre escalones de piedra', caption: 'Auténtica.' },
  { eyebrow: 'PARA CADA VERSIÓN DE TI', title: 'Hay días que<br>merecen<br><em>destacar.</em>', description: 'De lo cotidiano a lo extraordinario: encuentra ese detalle que hace que todo el look se sienta diferente.', image: 'assets/zapato-tacones.webp', alt: 'Zapatos de tacón marfil sobre fondo rosa', caption: 'Esencial.' }
];

const productGrid = document.getElementById('productGrid');
const productCounter = document.getElementById('productCounter');
const productSort = document.getElementById('productSort');
const filterButtons = [...document.querySelectorAll('[data-filter]')];
const favoriteCount = document.getElementById('favoriteCount');
const favoriteToggle = document.getElementById('favoriteToggle');
const searchPanel = document.getElementById('searchPanel');
const searchToggle = document.getElementById('searchToggle');
const searchClose = document.getElementById('searchClose');
const searchInput = document.getElementById('searchInput');
const menuToggle = document.getElementById('menuToggle');
const mobileMenu = document.getElementById('mobileMenu');
const dialog = document.getElementById('productDialog');
const guideDialog = document.getElementById('sizeGuideDialog');
const toast = document.getElementById('toast');
const spotlightPhoto = document.getElementById('spotlightPhoto');
const spotlightOptions = [...document.querySelectorAll('[data-spotlight]')];

let currentCategory = 'Todos';
let showOnlyFavorites = false;
let currentSearch = '';
let currentSlide = 0;
let slideTimer;
let activeDialogProduct = null;
let selectedSize = null;
let currentSpotlight = 'alba';
let favorites = new Set();
let toastTimer;
let liveCatalog = false;

try {
  const stored = JSON.parse(localStorage.getItem('nova-bella-favoritos') || '[]');
  favorites = new Set(Array.isArray(stored) ? stored.filter(id => products.some(product => product.id === id)) : []);
} catch (_) {
  favorites = new Set();
}

const heartIcon = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20.3 5.4a5.3 5.3 0 0 0-7.5 0L12 6.2l-.8-.8a5.3 5.3 0 0 0-7.5 7.5L12 21l8.3-8.1a5.3 5.3 0 0 0 0-7.5Z"/></svg>';

const escapeProductHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const visualForColor = color => {
  const tone = String(color || '').toLocaleLowerCase('es');
  if (/negro|black/.test(tone)) return 'shot-black';
  if (/vino|rojo|granate/.test(tone)) return 'shot-wine';
  if (/café|cafe|caramelo|marrón|camel/.test(tone)) return 'shot-tan';
  return 'shot-ivory';
};

async function hydrateCatalog() {
  const base = String(window.NOVA_BELLA_API_URL || '').trim().replace(/\/+$/, '');
  if (!base || !/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(base)) return;
  try {
    const response = await fetch(`${base}/api/v1/public/products`, { headers: { Accept: 'application/json' }, credentials: 'omit', signal: AbortSignal.timeout(7000) });
    if (!response.ok) throw Error(`API HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.items)) throw Error('Respuesta del catalogo incorrecta');
    products = data.items.map(item => ({
      id: String(item.id), name: String(item.name), category: String(item.category),
      color: String(item.color), price: `Bs ${Number(item.price_bs).toLocaleString('es-BO')}`,
      description: String(item.description || ''), badge: 'DISPONIBLE',
      imageClass: visualForColor(item.color),
      imageUrl: typeof item.image_url === 'string' && /^https:\/\//i.test(item.image_url) ? item.image_url : ''
    }));
    liveCatalog = true;
    document.getElementById('catalogNote').textContent = 'ⓘ Modelos y precios consultados al catálogo de Nova Bella. Consulta por WhatsApp para confirmar tallas, existencias y cambios recientes; las imágenes sin fotografía propia son ilustrativas.';
    document.getElementById('catalogFaqAnswer').textContent = 'Estos modelos provienen del catálogo publicado por la tienda. La disponibilidad por talla puede cambiar; escríbenos para confirmar existencias y precios antes de visitarnos.';
    favorites = new Set([...favorites].filter(id => products.some(product => product.id === id)));
    localStorage.setItem('nova-bella-favoritos', JSON.stringify([...favorites]));
    renderProducts();
  } catch (error) {
    console.warn('Catalogo no disponible. Se mantienen las ilustraciones.', error.message);
  }
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add('is-visible');
  toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 2800);
}

function updateFavoriteCount() {
  favoriteCount.textContent = String(favorites.size);
  favoriteCount.hidden = favorites.size === 0;
  favoriteToggle.setAttribute('aria-pressed', String(showOnlyFavorites));
  favoriteToggle.setAttribute('aria-label', showOnlyFavorites ? 'Mostrar todos los productos' : 'Ver productos favoritos');
}

function visibleProducts() {
  const term = currentSearch.trim().toLocaleLowerCase('es');
  const filtered = products.filter(product => {
    const categoryMatch = currentCategory === 'Todos' || product.category === currentCategory;
    const favoriteMatch = !showOnlyFavorites || favorites.has(product.id);
    const searchMatch = !term || [product.name, product.category, product.color].join(' ').toLocaleLowerCase('es').includes(term);
    return categoryMatch && favoriteMatch && searchMatch;
  });
  const numericPrice = product => Number(product.price.replace(/[^0-9]/g,''));
  if (productSort.value === 'price-asc') filtered.sort((a,b) => numericPrice(a) - numericPrice(b));
  if (productSort.value === 'price-desc') filtered.sort((a,b) => numericPrice(b) - numericPrice(a));
  if (productSort.value === 'name') filtered.sort((a,b) => a.name.localeCompare(b.name,'es'));
  return filtered;
}

function renderProducts() {
  const filtered = visibleProducts();
  productCounter.textContent = `${String(filtered.length).padStart(2, '0')} ${filtered.length === 1 ? 'MODELO' : 'MODELOS'}`;
  if (!filtered.length) {
    productGrid.innerHTML = `<p class="no-products">${showOnlyFavorites ? 'No hay modelos favoritos con estos filtros. Guarda tus preferidos usando el corazón.' : 'No encontramos modelos para esa búsqueda. Prueba otra categoría.'}</p>`;
    updateFavoriteCount();
    return;
  }
  productGrid.innerHTML = filtered.map((product, index) => `
    <article class="product-card" style="animation-delay:${index * 65}ms">
      <div class="product-art">
        ${product.imageUrl ? `<img class="product-photo live-product-photo" src="${escapeProductHtml(product.imageUrl)}" alt="${escapeProductHtml(product.name)}" loading="lazy">` : `<div class="product-photo product-shot ${product.imageClass}" role="img" aria-label="Imagen ilustrativa de ${escapeProductHtml(product.name)}"></div>`}
        <span class="product-badge">${escapeProductHtml(product.badge)}</span>
        <button type="button" class="product-heart ${favorites.has(product.id) ? 'is-favorite' : ''}" data-favorite="${escapeProductHtml(product.id)}" aria-label="${favorites.has(product.id) ? 'Quitar de favoritos' : 'Agregar a favoritos'}: ${escapeProductHtml(product.name)}" aria-pressed="${favorites.has(product.id)}">${heartIcon}</button>
        <button type="button" class="product-quick" data-quick-view="${escapeProductHtml(product.id)}" aria-label="Ver detalles de ${escapeProductHtml(product.name)}">Vista rápida</button>
      </div>
      <div class="product-data">
        <span class="product-category">${escapeProductHtml(product.category.toUpperCase())}</span>
        <h3>${escapeProductHtml(product.name)}</h3>
        <div class="product-meta"><span class="product-price">${escapeProductHtml(product.price)}</span><span class="product-color"><span class="card-swatch ${product.imageClass.replace('shot-','swatch-')}"></span>${escapeProductHtml(product.color)}</span></div>
      </div>
    </article>
  `).join('');
  updateFavoriteCount();
}

function setCategory(category) {
  currentCategory = category;
  showOnlyFavorites = false;
  filterButtons.forEach(button => {
    const active = button.dataset.filter === category;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  renderProducts();
}

filterButtons.forEach(button => button.addEventListener('click', () => setCategory(button.dataset.filter)));
productSort.addEventListener('change', () => { renderProducts(); showToast('Orden de productos actualizado'); });
document.querySelectorAll('[data-category-link]').forEach(link => link.addEventListener('click', () => {
  currentSearch = '';
  searchInput.value = '';
  setCategory(link.dataset.categoryLink);
}));

productGrid.addEventListener('click', event => {
  const favoriteButton = event.target.closest('[data-favorite]');
  if (favoriteButton) {
    const id = favoriteButton.dataset.favorite;
    const wasFavorite = favorites.has(id);
    if (wasFavorite) favorites.delete(id);
    else favorites.add(id);
    try { localStorage.setItem('nova-bella-favoritos', JSON.stringify([...favorites])); } catch (_) { /* Navegadores sin almacenamiento. */ }
    renderProducts();
    showToast(wasFavorite ? 'Modelo eliminado de favoritos' : 'Guardado en tus favoritos');
    return;
  }
  const detailButton = event.target.closest('[data-quick-view]');
  if (detailButton) openProductDialog(detailButton.dataset.quickView);
});

favoriteToggle.addEventListener('click', () => {
  showOnlyFavorites = !showOnlyFavorites;
  currentCategory = 'Todos';
  filterButtons.forEach(button => {
    const active = button.dataset.filter === 'Todos';
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  renderProducts();
  document.getElementById('destacados').scrollIntoView({ behavior: 'smooth' });
});

function selectSpotlight(id) {
  const product = products.find(item => item.id === id);
  if (!product || id === currentSpotlight) return;
  currentSpotlight = id;
  spotlightPhoto.classList.add('is-changing');
  spotlightOptions.forEach(button => {
    const active = button.dataset.spotlight === id;
    button.classList.toggle('is-active',active);
    button.setAttribute('aria-pressed',String(active));
  });
  window.setTimeout(() => {
    spotlightPhoto.className = `spotlight-photo product-shot ${product.imageClass}`;
    spotlightPhoto.setAttribute('aria-label',`Fotografía del modelo ${product.name}`);
    document.getElementById('spotlightName').textContent = product.name.replace(' · ',' ');
    document.getElementById('spotlightCategory').textContent = `${product.category.toUpperCase()} · ${product.color.toUpperCase()}`;
  },230);
}

spotlightOptions.forEach(button => button.addEventListener('click', () => selectSpotlight(button.dataset.spotlight)));
document.getElementById('spotlightOpen').addEventListener('click', () => openProductDialog(currentSpotlight));

function setSearchOpen(open) {
  searchPanel.hidden = !open;
  searchToggle.setAttribute('aria-expanded', String(open));
  if (open) {
    setMenuOpen(false);
    searchInput.focus();
  } else {
    currentSearch = '';
    searchInput.value = '';
    renderProducts();
  }
}
searchToggle.addEventListener('click', () => setSearchOpen(searchPanel.hidden));
searchClose.addEventListener('click', () => setSearchOpen(false));
searchPanel.addEventListener('submit', event => {
  event.preventDefault();
  document.getElementById('destacados').scrollIntoView({ behavior: 'smooth' });
});
searchInput.addEventListener('input', () => {
  currentSearch = searchInput.value;
  setCategory('Todos');
  if (currentSearch.trim()) document.getElementById('destacados').scrollIntoView({ behavior: 'smooth' });
});

function setMenuOpen(open) {
  mobileMenu.hidden = !open;
  menuToggle.setAttribute('aria-expanded', String(open));
  menuToggle.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú');
}
menuToggle.addEventListener('click', () => {
  if (mobileMenu.hidden) setSearchOpen(false);
  setMenuOpen(mobileMenu.hidden);
});
mobileMenu.querySelectorAll('a').forEach(link => link.addEventListener('click', () => setMenuOpen(false)));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    setMenuOpen(false);
    if (!searchPanel.hidden) setSearchOpen(false);
  }
});

function updateDialogLink() {
  if (!activeDialogProduct) return;
  const sizeText = selectedSize ? ` en talla ${selectedSize}` : '';
  const message = `Hola Nova Bella. Vi el modelo ${activeDialogProduct.name}${sizeText} en su página. ¿Podrían confirmarme disponibilidad, tallas y precio?`;
  document.getElementById('dialogWhatsApp').href = `https://wa.me/59171439946?text=${encodeURIComponent(message)}`;
}

function openProductDialog(id) {
  const product = products.find(item => item.id === id);
  if (!product) return;
  activeDialogProduct = product;
  selectedSize = null;
  const image = document.getElementById('dialogProductImage');
  image.className = `dialog-product-image product-shot ${product.imageClass}`;
  image.setAttribute('aria-label', `Imagen ilustrativa de ${product.name}`);
  image.style.backgroundImage = product.imageUrl ? `url("${product.imageUrl.replace(/["\\]/g, '')}")` : '';
  image.style.backgroundSize = product.imageUrl ? 'cover' : '';
  image.style.backgroundPosition = product.imageUrl ? 'center' : '';
  document.getElementById('dialogProductName').textContent = product.name;
  document.getElementById('dialogProductDescription').textContent = product.description;
  document.getElementById('dialogPrice').textContent = `${product.price} · ${liveCatalog ? 'Precio de catálogo' : 'Referencial'}`;
  document.getElementById('dialogDisclaimer').textContent = liveCatalog ? 'Consulta la disponibilidad de tu talla y confirma el precio con la tienda antes de comprar.' : 'Modelo conceptual: consulta directamente con la tienda para confirmar disponibilidad y precio.';
  document.getElementById('dialogWhatsApp').textContent = liveCatalog ? 'Consultar disponibilidad' : 'Consultar modelo similar';
  document.getElementById('dialogSizes').innerHTML = [35,36,37,38,39,40].map(size => `<button type="button" data-size="${size}" aria-pressed="false">${size}</button>`).join('');
  updateDialogLink();
  dialog.showModal();
}

document.getElementById('dialogClose').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => {
  if (event.target === dialog) dialog.close();
});
document.getElementById('dialogSizes').addEventListener('click', event => {
  const button = event.target.closest('[data-size]');
  if (!button) return;
  selectedSize = button.dataset.size;
  document.querySelectorAll('#dialogSizes button').forEach(item => {
    const active = item === button;
    item.classList.toggle('is-active', active);
    item.setAttribute('aria-pressed', String(active));
  });
  updateDialogLink();
});

function openSizeGuide() {
  if (dialog.open) dialog.close();
  guideDialog.showModal();
}
document.getElementById('openSizeGuide').addEventListener('click',openSizeGuide);
document.getElementById('dialogSizeGuide').addEventListener('click',openSizeGuide);
document.getElementById('sizeGuideClose').addEventListener('click',() => guideDialog.close());
guideDialog.addEventListener('click',event => { if(event.target === guideDialog) guideDialog.close(); });

document.querySelectorAll('.faq-item').forEach(item => item.addEventListener('toggle', () => {
  if (!item.open) return;
  document.querySelectorAll('.faq-item').forEach(other => { if (other !== item) other.open = false; });
}));

const visitMail = document.getElementById('visitMail');
const visitEnvelopeToggle = document.getElementById('visitEnvelopeToggle');
const visitLetter = document.getElementById('visitLetter');

function setVisitEnvelopeOpen(open) {
  visitMail.classList.toggle('is-open', open);
  visitEnvelopeToggle.setAttribute('aria-expanded', String(open));
  visitEnvelopeToggle.setAttribute('aria-label', open ? 'Cerrar sobre de Nova Bella' : 'Abrir sobre con la información de Nova Bella');
  visitLetter.setAttribute('aria-hidden', String(!open));
  visitLetter.inert = !open;
  document.getElementById('mailInstruction').textContent = open ? 'Con cariño, Nova Bella' : 'Una invitación especial para ti';
}

visitEnvelopeToggle.addEventListener('click', () => setVisitEnvelopeOpen(!visitMail.classList.contains('is-open')));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && visitMail.classList.contains('is-open')) setVisitEnvelopeOpen(false);
});

function goToSlide(index) {
  currentSlide = index;
  const slide = slides[index];
  const image = document.getElementById('heroImage');
  image.classList.add('is-changing');
  const swap = () => {
    image.src = slide.image;
    image.alt = slide.alt;
    document.getElementById('heroEyebrow').textContent = slide.eyebrow;
    document.getElementById('heroTitle').innerHTML = slide.title;
    document.getElementById('heroDescription').textContent = slide.description;
    document.querySelector('.caption-large').textContent = slide.caption;
    document.getElementById('heroSlideCount').textContent = `${String(index + 1).padStart(2,'0')} / 03`;
    document.querySelectorAll('[data-slide]').forEach(dot => {
      const active = Number(dot.dataset.slide) === index;
      dot.classList.toggle('is-active', active);
      if (active) dot.setAttribute('aria-current','true');
      else dot.removeAttribute('aria-current');
    });
    image.classList.remove('is-changing');
  };
  window.setTimeout(swap, 220);
}

function restartSlider() {
  if (slideTimer) window.clearInterval(slideTimer);
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  slideTimer = window.setInterval(() => goToSlide((currentSlide + 1) % slides.length), 7500);
}

document.querySelectorAll('[data-slide]').forEach(dot => dot.addEventListener('click', () => {
  goToSlide(Number(dot.dataset.slide));
  restartSlider();
}));
document.getElementById('heroPrev').addEventListener('click', () => {
  goToSlide((currentSlide + slides.length - 1) % slides.length);
  restartSlider();
});
document.getElementById('heroNext').addEventListener('click', () => {
  goToSlide((currentSlide + 1) % slides.length);
  restartSlider();
});
const hero = document.querySelector('.hero');
hero.addEventListener('mouseenter', () => { if (slideTimer) window.clearInterval(slideTimer); });
hero.addEventListener('mouseleave', restartSlider);
let heroTouchStartX = 0;
hero.addEventListener('touchstart', event => { heroTouchStartX = event.changedTouches[0].clientX; }, { passive: true });
hero.addEventListener('touchend', event => {
  const delta = event.changedTouches[0].clientX - heroTouchStartX;
  if (Math.abs(delta) < 70) return;
  goToSlide((currentSlide + (delta < 0 ? 1 : slides.length - 1)) % slides.length);
  restartSlider();
}, { passive: true });

let scrollFramePending = false;
const navLinks = [...document.querySelectorAll('.desktop-nav a')];
function updateScrollDetails() {
  const limit = document.documentElement.scrollHeight - window.innerHeight;
  const progress = limit > 0 ? Math.min(100,Math.max(0,window.scrollY / limit * 100)) : 0;
  document.getElementById('scrollIndicator').style.width = `${progress}%`;
  document.querySelector('.floating-whatsapp').classList.toggle('is-visible',window.scrollY > 440);
  const position = window.scrollY + window.innerHeight * .4;
  let currentSection = '';
  navLinks.forEach(link => {
    const target = document.querySelector(link.getAttribute('href'));
    if (target && target.offsetTop <= position) currentSection = target.id;
  });
  navLinks.forEach(link => {
    const active = link.getAttribute('href') === `#${currentSection}`;
    link.classList.toggle('is-current', active);
    if (active) link.setAttribute('aria-current','location');
    else link.removeAttribute('aria-current');
  });
  scrollFramePending = false;
}
window.addEventListener('scroll', () => {
  if (scrollFramePending) return;
  scrollFramePending = true;
  window.requestAnimationFrame(updateScrollDetails);
}, { passive: true });
updateScrollDetails();

document.getElementById('year').textContent = String(new Date().getFullYear());

if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.08 });
  document.querySelectorAll('.reveal').forEach(element => observer.observe(element));
} else {
  document.querySelectorAll('.reveal').forEach(element => element.classList.add('is-visible'));
}

renderProducts();
hydrateCatalog();
restartSlider();
