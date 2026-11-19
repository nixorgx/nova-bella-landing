const STORE_KEY = 'nova-bella-control-prototipo-v1';
const SITE_URL = 'https://nova-bella-boutique-2026.keenorbit34.chatgpt.site/';
const PAGES = {
  resumen: 'Resumen', analitica: 'Análisis del negocio', ventas: 'Ventas', clientes: 'Clientes frecuentes', catalogo: 'Catálogo', consultas: 'Consultas',
  contenido: 'Contenido web', conexiones: 'Conexiones y seguridad',
  actividad: 'Actividad', configuracion: 'Configuración'
};

const DEFAULT_CONTENT = {
  eyebrow: 'NUEVA TEMPORADA · CONCEPTO 2026',
  title: 'No es solo un par. Es tu actitud.',
  description: 'Hay zapatos que completan un look. Y otros que lo transforman. Descubre inspiración para tu siguiente gran paso.'
};

function initialState() {
  return {
    version: 1,
    products: [
      { id: 'alba', name: 'Alba · Slingback', category: 'Tacones', price: 429, color: 'Marfil', visible: true },
      { id: 'vega', name: 'Vega · Bota alta', category: 'Botas', price: 549, color: 'Negro', visible: true },
      { id: 'roma', name: 'Roma · Botín', category: 'Botas', price: 489, color: 'Vino', visible: true },
      { id: 'duna', name: 'Duna · Mocasín', category: 'Casuales', price: 399, color: 'Caramelo', visible: true }
    ],
    inquiries: [
      { id: 'NB-1042', topic: 'Disponibilidad de Alba Slingback', date: '2026-11-18', status: 'Pendiente', channel: 'WhatsApp' },
      { id: 'NB-1043', topic: 'Consulta de tallas para botas', date: '2026-11-18', status: 'Pendiente', channel: 'Formulario web' },
      { id: 'NB-1044', topic: 'Horarios y ubicación', date: '2026-11-17', status: 'Pendiente', channel: 'WhatsApp' }
    ],
    content: { ...DEFAULT_CONTENT },
    activities: []
  };
}

function loadState() {
  try {
    const item = localStorage.getItem(STORE_KEY);
    if (!item) return initialState();
    const saved = JSON.parse(item);
    if (saved?.version !== 1 || !Array.isArray(saved.products) || !Array.isArray(saved.inquiries) || !Array.isArray(saved.activities) || !saved.content) throw Error('Formato incompatible');
    return saved;
  } catch {
    return initialState();
  }
}

let state = loadState();
let activePage = 'resumen';
let lastModalFocus = null;
let confirmAction = null;
let toastTimer;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const icon = (name) => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[character]));
const padded = (value) => String(value).padStart(2, '0');
const formatPrice = (value) => `Bs ${Number(value).toLocaleString('es-BO')}`;
const formatDate = (value) => { try { return new Intl.DateTimeFormat('es-BO',{day:'numeric',month:'short',year:'numeric',timeZone:'America/La_Paz'}).format(new Date(`${value}T12:00:00-04:00`)); } catch { return value; } };
const formatTime = (value) => { try { return new Intl.DateTimeFormat('es-BO',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'America/La_Paz'}).format(new Date(value)); } catch { return 'Reciente'; } };

function persist() {
  // El modo conectado no guarda una copia silenciosa del catalogo real en localStorage.
  if (window.novaBackend?.isConnected()) return true;
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); return true; }
  catch { toast('No se pudo guardar en el navegador. Revisa el almacenamiento.'); return false; }
}

function logAction(title, detail) {
  state.activities.unshift({ id: Date.now().toString(36)+Math.random().toString(36).slice(2,6), title, detail, at: new Date().toISOString() });
  state.activities = state.activities.slice(0, 100);
  persist();
}

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('show'), 3100);
}

function openPage(page, updateHash = true) {
  if (!PAGES[page]) page = 'resumen';
  activePage = page;
  $$('.page-section').forEach(section => {
    const selected = section.id === `page-${page}`;
    section.classList.toggle('active-page', selected);
    section.hidden = !selected;
  });
  $$('.nav-item').forEach(button => {
    const selected = button.dataset.page === page;
    button.classList.toggle('active', selected);
    if (selected) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  $('#currentCrumb').textContent = PAGES[page];
  if (updateHash && location.hash !== `#${page}`) history.replaceState(null, '', `#${page}`);
  closeSidebar();
  window.scrollTo({ top: 0, behavior: 'instant' });
  if (page === 'resumen') renderOverview();
  if (page === 'catalogo') renderProducts();
  if (page === 'consultas') renderInquiries();
  if (page === 'actividad') renderActivity();
  window.novaInsights?.renderPage(page);
}

function closeSidebar() {
  $('#sidebar').classList.remove('is-open');
  $('#mobileOverlay').hidden = true;
  $('#menuToggle').setAttribute('aria-expanded', 'false');
}

function renderCounts() {
  const pending = state.inquiries.filter(item => item.status === 'Pendiente').length;
  $('#navProductCount').textContent = state.products.length;
  $('#navInquiryCount').textContent = pending;
  $('#statProducts').textContent = padded(state.products.length);
  $('#statVisible').textContent = `${state.products.filter(item=>item.visible).length} visibles`;
  $('#statPending').textContent = padded(pending);
  $('#statActions').textContent = padded(state.activities.length);
  $('#countAllInquiries').textContent = padded(state.inquiries.length);
  $('#countNewInquiries').textContent = padded(pending);
  $('#countDoneInquiries').textContent = padded(state.inquiries.filter(item=>item.status==='Atendida').length);
}

function renderOverview() {
  renderCounts();
  const max = Math.max(state.products.length, 1);
  $('#categoryBars').innerHTML = ['Tacones','Botas','Casuales'].map(category => {
    const count = state.products.filter(item => item.category === category).length;
    return `<div class="bar-row"><span class="bar-label">${category}</span><div class="bar-track"><div class="bar-fill" style="width:${(count/max)*100}%"></div></div><span class="bar-value">${padded(count)}</span></div>`;
  }).join('');
  renderActivity();
  window.novaInsights?.renderOverview();
}

function renderProducts() {
  const query = $('#productSearch').value.trim().toLocaleLowerCase('es');
  const category = $('#categoryFilter').value;
  const filtered = state.products.filter(item => {
    return (category === 'all' || item.category === category) && `${item.name} ${item.color}`.toLocaleLowerCase('es').includes(query);
  });
  $('#productCountLabel').textContent = `${filtered.length} modelo${filtered.length===1?'':'s'}`;
  $('#productsBody').innerHTML = filtered.length ? filtered.map(item => `
    <tr><td><div class="product-cell"><span class="product-thumb" aria-hidden="true">${escapeHtml(item.name[0] || 'N')}</span><div><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.color)}</small></div></div></td>
    <td>${escapeHtml(item.category)}</td><td class="price-cell">${formatPrice(item.price)}</td>
    <td><span class="badge ${item.visible?'badge-good':'badge-slate'}">${window.novaBackend?.isConnected() ? (item.visible?'Publicado':'Oculto') : (item.visible?'Visible en catálogo':'Oculto en catálogo')}</span></td>
    <td><div class="row-actions"><button class="icon-button" data-product-action="toggle" data-id="${escapeHtml(item.id)}" aria-label="${item.visible?'Ocultar':'Mostrar'} ${escapeHtml(item.name)}" title="Cambiar visibilidad">${icon('eye')}</button><button class="icon-button" data-product-action="edit" data-id="${escapeHtml(item.id)}" aria-label="Editar ${escapeHtml(item.name)}" title="Editar">${icon('edit')}</button><button class="icon-button danger-icon" data-product-action="delete" data-id="${escapeHtml(item.id)}" aria-label="Eliminar ${escapeHtml(item.name)}" title="Eliminar">${icon('trash')}</button></div></td></tr>`).join('') : '<tr><td colspan="5"><div class="empty-state">No hay productos con estos filtros.</div></td></tr>';
  renderCounts();
}

function renderInquiries() {
  const query = $('#inquirySearch').value.trim().toLocaleLowerCase('es');
  const filter = $('#inquiryFilter').value;
  const filtered = state.inquiries.filter(item => (filter === 'all' || item.status === filter) && `${item.id} ${item.topic}`.toLocaleLowerCase('es').includes(query));
  const statuses = ['Pendiente','En seguimiento','Atendida'];
  $('#inquiriesBody').innerHTML = filtered.length ? filtered.map(item => `
    <tr><td><div class="inquiry-cell"><strong>${escapeHtml(item.id)}</strong><small>${escapeHtml(item.channel)}</small></div></td><td>${escapeHtml(item.topic)}</td><td>${formatDate(item.date)}</td>
    <td><span class="badge ${item.status==='Atendida'?'badge-good':item.status==='En seguimiento'?'badge-purple':'badge-wait'}">${escapeHtml(item.status)}</span></td>
    <td class="actions-header"><select class="inline-select" data-inquiry-id="${escapeHtml(item.id)}" aria-label="Actualizar estado de ${escapeHtml(item.id)}">${statuses.map(status=>`<option value="${status}" ${status===item.status?'selected':''}>${status}</option>`).join('')}</select></td></tr>`).join('') : '<tr><td colspan="5"><div class="empty-state">No hay consultas con estos filtros.</div></td></tr>';
  renderCounts();
}

function renderActivity() {
  const activityMarkup = (entry) => `<div class="activity-row"><span class="activity-glyph">${icon('activity')}</span><div><strong>${escapeHtml(entry.title)}</strong><p>${escapeHtml(entry.detail)}</p></div><time class="activity-time" datetime="${escapeHtml(entry.at)}">${escapeHtml(formatTime(entry.at))}</time></div>`;
  const empty = '<div class="empty-state">Aún no hay movimientos registrados. Agrega un producto o actualiza su información.</div>';
  $('#recentActivity').innerHTML = state.activities.length ? state.activities.slice(0,3).map(activityMarkup).join('') : empty;
  $('#fullActivity').innerHTML = state.activities.length ? state.activities.map(activityMarkup).join('') : empty;
  renderCounts();
}

function loadContentFields() {
  $('#contentEyebrow').value = state.content.eyebrow;
  $('#contentTitle').value = state.content.title;
  $('#contentDescription').value = state.content.description;
  updateContentPreview();
}

function updateContentPreview() {
  $('#previewEyebrow').textContent = $('#contentEyebrow').value;
  $('#previewTitle').textContent = $('#contentTitle').value || 'Título de portada';
  $('#previewDescription').textContent = $('#contentDescription').value;
}

function openProductModal(product = null) {
  lastModalFocus = document.activeElement;
  $('#productForm').reset();
  $('#productModalTitle').textContent = product ? 'Editar producto' : 'Nuevo producto';
  $('#editProductId').value = product?.id ?? '';
  $('#productName').value = product?.name ?? '';
  $('#productCategory').value = product?.category ?? 'Tacones';
  $('#productPrice').value = product?.price ?? '';
  $('#productColor').value = product?.color ?? '';
  $('#productVisible').checked = product?.visible ?? true;
  $('#productModal').hidden = false;
  $('#productName').focus();
}

function closeProductModal() {
  $('#productModal').hidden = true;
  lastModalFocus?.focus?.();
}

function askConfirm(title, message, onAccept) {
  lastModalFocus = document.activeElement;
  confirmAction = onAccept;
  $('#confirmTitle').textContent = title;
  $('#confirmMessage').textContent = message;
  $('#confirmModal').hidden = false;
  $('#cancelConfirm').focus();
}

function closeConfirm() {
  $('#confirmModal').hidden = true;
  confirmAction = null;
  lastModalFocus?.focus?.();
}

function handleProductAction(event) {
  const button = event.target.closest('button[data-product-action]');
  if (!button) return;
  const item = state.products.find(product => product.id === button.dataset.id);
  if (!item) return;
  const action = button.dataset.productAction;
  if (action === 'edit') return openProductModal(item);
  if (window.novaBackend?.isConnected()) {
    if (action === 'toggle') return window.novaBackend.updateProduct(item.id, { status: item.visible ? 'draft' : 'published' });
    if (action === 'delete') return askConfirm('Archivar producto', `¿Archivar «${item.name}» en el catálogo del servidor? No aparecerá en la landing.`, () => window.novaBackend.archiveProduct(item.id));
  }
  if (action === 'toggle') {
    item.visible = !item.visible;
    logAction('Visibilidad de producto', `${item.name}: ${item.visible?'visible':'oculto'} en el catálogo.`);
    renderProducts(); renderOverview(); toast('Visibilidad actualizada.');
  }
  if (action === 'delete') askConfirm('Eliminar producto', `¿Quitar «${item.name}» de la lista de productos?`, () => {
    state.products = state.products.filter(product => product.id !== item.id);
    logAction('Producto eliminado', `${item.name} se quitó del catálogo.`);
    renderProducts(); renderOverview(); toast('Producto eliminado.');
  });
}

function handleProductSubmit(event) {
  event.preventDefault();
  const name = $('#productName').value.trim();
  const price = Number($('#productPrice').value);
  const color = $('#productColor').value.trim();
  if (!name || !color || !Number.isInteger(price) || price < 1 || price > 99999) return toast('Completa los datos correctamente.');
  const id = $('#editProductId').value;
  const product = { id: id || `${Date.now()}-${Math.random().toString(36).slice(2,7)}`, name, category: $('#productCategory').value, price, color, visible: $('#productVisible').checked };
  if (window.novaBackend?.isConnected()) {
    window.novaBackend.saveProduct({ id, name, category: product.category, color, price_bs: price, status: product.visible ? 'published' : 'draft' })
      .then(() => { closeProductModal(); toast('Producto guardado en el servidor.'); })
      .catch(error => toast(`No se guardó: ${error.message}`));
    return;
  }
  if (id) {
    const index = state.products.findIndex(item => item.id === id);
    if (index < 0) return toast('No se encontró el producto.');
    state.products[index] = product;
    logAction('Producto actualizado', `${name} se actualizó en el catálogo.`);
  } else {
    state.products.unshift(product);
    logAction('Producto creado', `${name} se agregó al catálogo.`);
  }
  closeProductModal();
  renderProducts(); renderOverview(); toast('Cambios guardados correctamente.');
}

function saveContent(event) {
  event.preventDefault();
  state.content = { eyebrow: $('#contentEyebrow').value.trim(), title: $('#contentTitle').value.trim(), description: $('#contentDescription').value.trim() };
  if (!state.content.eyebrow || !state.content.title || !state.content.description) return toast('Completa los tres campos.');
  logAction('Contenido guardado', 'Se actualizaron los textos de la portada.');
  toast('Texto guardado en el editor de contenido.');
}

function exportJson(data, filename) {
  const blob = new Blob([JSON.stringify(data,null,2)], { type:'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function bindEvents() {
  $$('.nav-item').forEach(button => button.addEventListener('click', () => openPage(button.dataset.page)));
  $$('[data-open-page]').forEach(button => button.addEventListener('click', () => openPage(button.dataset.openPage)));
  $('#menuToggle').addEventListener('click', () => { const isOpen = $('#sidebar').classList.toggle('is-open'); $('#mobileOverlay').hidden = !isOpen; $('#menuToggle').setAttribute('aria-expanded', String(isOpen)); });
  $('#mobileOverlay').addEventListener('click', closeSidebar);
  $('#addProduct').addEventListener('click', () => openProductModal());
  $('#quickAddProduct').addEventListener('click', () => { openPage('catalogo'); openProductModal(); });
  $('#productSearch').addEventListener('input', renderProducts);
  $('#categoryFilter').addEventListener('change', renderProducts);
  $('#productsBody').addEventListener('click', handleProductAction);
  $('#productForm').addEventListener('submit', handleProductSubmit);
  $('#closeProductModal').addEventListener('click', closeProductModal);
  $('#cancelProduct').addEventListener('click', closeProductModal);
  $('#inquirySearch').addEventListener('input', renderInquiries);
  $('#inquiryFilter').addEventListener('change', renderInquiries);
  $('#inquiriesBody').addEventListener('change', event => {
    const select = event.target.closest('select[data-inquiry-id]');
    if (!select) return;
    const inquiry = state.inquiries.find(item=>item.id===select.dataset.inquiryId);
    if (!inquiry || !['Pendiente','En seguimiento','Atendida'].includes(select.value)) return;
    inquiry.status = select.value;
    logAction('Seguimiento actualizado', `${inquiry.id}: ${select.value}.`);
    renderInquiries(); renderOverview(); toast('Estado de consulta actualizado.');
  });
  $('#contentForm').addEventListener('submit', saveContent);
  ['#contentEyebrow','#contentTitle','#contentDescription'].forEach(selector => $(selector).addEventListener('input', updateContentPreview));
  $('#resetContent').addEventListener('click', () => { state.content = { ...DEFAULT_CONTENT }; loadContentFields(); logAction('Texto restaurado','Los textos de portada volvieron a su versión inicial.'); toast('Textos restaurados.'); });
  $('#exportActivity').addEventListener('click', () => exportJson(state.activities, 'nova-bella-actividad.json'));
  $('#exportData').addEventListener('click', () => exportJson({ exportedAt:new Date().toISOString(), note:'Respaldo del centro de control de Nova Bella.', ...state }, 'nova-bella-respaldo.json'));
  $('#resetDemo').addEventListener('click', () => askConfirm('Restablecer espacio','Se eliminarán los cambios guardados en este dispositivo, incluyendo productos, consultas, textos y actividad.', () => {
    if (window.novaBackend?.isConnected()) return toast('Desconecta la API antes de restablecer este espacio.');
    state = initialState(); window.novaInsights?.reset(); persist(); loadContentFields(); renderProducts(); renderInquiries(); renderOverview(); toast('Espacio restablecido.');
  }));
  $('#cancelConfirm').addEventListener('click', closeConfirm);
  $('#acceptConfirm').addEventListener('click', () => { const action = confirmAction; closeConfirm(); action?.(); });
  $$('.modal-backdrop').forEach(backdrop => backdrop.addEventListener('click', event => { if (event.target === backdrop) { if (backdrop.id==='productModal') closeProductModal(); else if (backdrop.id==='confirmModal') closeConfirm(); else window.novaInsights?.closeModal(backdrop.id); } }));
  document.addEventListener('keydown', event => { if (event.key === 'Escape') { if (!$('#confirmModal').hidden) closeConfirm(); else if (!$('#productModal').hidden) closeProductModal(); else if (window.novaInsights?.closeAnyModal()) return; else closeSidebar(); } });
  window.addEventListener('hashchange', () => openPage(location.hash.slice(1),false));
}

function boot() {
  $('#headingDate').textContent = new Intl.DateTimeFormat('es-BO',{weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:'America/La_Paz'}).format(new Date());
  bindEvents();
  loadContentFields();
  renderProducts();
  renderInquiries();
  renderOverview();
  openPage(location.hash.slice(1) || 'resumen', false);
}

boot();
