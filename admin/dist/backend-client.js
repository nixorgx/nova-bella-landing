/* Adaptador de primera etapa: el catalogo real reside en la API, nunca en el navegador.
   La sesion JWT solo vive en esta variable (se borra al actualizar o cerrar pagina). */
(() => {
  let apiOrigin = '';
  let accessToken = '';
  let expiresAt = 0;
  let sessionNumber = 0;

  const input = document.getElementById('backendUrl');
  const emailInput = document.getElementById('backendEmail');
  const passwordInput = document.getElementById('backendPassword');
  const button = document.getElementById('backendConnect');
  const disconnectButton = document.getElementById('backendDisconnect');
  const statusBadge = document.getElementById('backendStatus');
  const feedback = document.getElementById('backendFeedback');
  const apiBadge = document.getElementById('apiConnectionBadge');
  const dbBadge = document.getElementById('dbConnectionBadge');

  function isConnected() { return !!accessToken && Date.now() < expiresAt; }

  function setConnectedStatus(connected, message = '') {
    statusBadge.textContent = connected ? 'Servidor conectado' : 'Sin conexión';
    apiBadge.textContent = connected ? 'Conectada' : 'No conectada';
    dbBadge.textContent = connected ? 'Operativa' : 'No verificada';
    [statusBadge, apiBadge, dbBadge].forEach(node => {
      node.classList.toggle('badge-good', connected);
      node.classList.toggle('badge-wait', !connected);
    });
    feedback.textContent = message || (connected ? 'Catálogo sincronizado con la API.' : 'No se ha conectado ninguna API.');
    document.getElementById('topEnvironmentStatus').lastChild.textContent = connected ? ' Catálogo conectado' : ' Panel de gestión';
    document.getElementById('productStatTitle').textContent = connected ? 'Modelos del servidor' : 'Modelos del catálogo';
    document.getElementById('productStatSource').textContent = connected ? 'en catálogo de la API' : 'en catálogo';
    document.getElementById('categoryDistributionDescription').textContent = connected ? 'Distribución del catálogo del servidor.' : 'Distribución de modelos por categoría.';
    document.getElementById('integrationValue').textContent = connected ? 'Activa' : 'Pendiente';
    document.getElementById('integrationCaption').textContent = connected ? 'Catálogo sincronizado' : 'Conexión del catálogo';
    disconnectButton.hidden = !connected;
    button.hidden = connected;
    [input, emailInput, passwordInput].forEach(node => { node.disabled = connected; });
    passwordInput.value = '';
    document.getElementById('productCountLabel').title = connected ? 'Datos del servidor' : 'Datos del catálogo';
  }

  function safeOrigin(value) {
    const url = new URL(String(value).trim());
    if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw Error('Escribe solo el dominio HTTPS de la API.');
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1'].includes(url.hostname))) {
      throw Error('La conexión requiere HTTPS (salvo localhost para pruebas).');
    }
    return url.origin;
  }

  async function request(path, options = {}, authenticated = true) {
    const headers = { Accept:'application/json', ...(options.body ? { 'Content-Type':'application/json' } : {}) };
    if (authenticated && accessToken) headers.Authorization = `Bearer ${accessToken}`;
    let response;
    try {
      response = await fetch(`${apiOrigin}${path}`, { ...options, credentials:'omit', cache:'no-store', headers, signal:AbortSignal.timeout(10000) });
    } catch { throw Error('No se pudo contactar la API. Revisa HTTPS y CORS.'); }
    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try { const problem = await response.json(); if (typeof problem.detail === 'string') detail = problem.detail; } catch { /* respuesta sin JSON */ }
      if (response.status === 401 && authenticated) disconnect('La sesión expiró; vuelve a conectarte.');
      throw Error(detail);
    }
    return response.status === 204 ? null : response.json();
  }

  function reflectProducts(data) {
    if (!Array.isArray(data.items)) throw Error('La API devolvió un catálogo inválido.');
    state.products = data.items.map(item => ({
      id:String(item.id), name:String(item.name), category:String(item.category),
      price:Number(item.price_bs), color:String(item.color), visible:item.status === 'published'
    }));
    renderProducts();
    renderOverview();
    window.novaInsights?.renderPage(activePage);
  }

  async function refreshProducts() {
    const iteration = sessionNumber;
    const data = await request('/api/v1/admin/products');
    if (iteration === sessionNumber && isConnected()) reflectProducts(data);
  }

  function disconnect(message = 'Sesión cerrada. Puedes continuar gestionando tu catálogo desde este espacio.') {
    sessionNumber += 1;
    accessToken = '';
    expiresAt = 0;
    apiOrigin = '';
    state = loadState();
    setConnectedStatus(false, message);
    renderProducts();
    renderOverview();
    window.novaInsights?.renderPage(activePage);
  }

  async function connect(event) {
    event.preventDefault();
    button.disabled = true;
    feedback.textContent = 'Verificando el servidor y las credenciales…';
    try {
      const origin = safeOrigin(input.value);
      apiOrigin = origin;
      const health = await request('/api/v1/health', {}, false);
      if (health.status !== 'ok' || health.service !== 'nova-bella-api') throw Error('El dominio no corresponde a la API de Nova Bella.');
      const result = await request('/api/v1/auth/token', { method:'POST', body:JSON.stringify({ email:emailInput.value, password:passwordInput.value }) }, false);
      if (!result.access_token || !Number(result.expires_in)) throw Error('El servidor no devolvió una sesión válida.');
      accessToken = result.access_token;
      expiresAt = Date.now() + (Number(result.expires_in) - 15) * 1000;
      await request('/api/v1/admin/me');
      await refreshProducts();
      setConnectedStatus(true);
      toast('Conexión segura con el catálogo establecida.');
    } catch (error) {
      disconnect(`Conexión fallida: ${error.message}`);
      toast(`No se pudo conectar: ${error.message}`);
    } finally { passwordInput.value = ''; button.disabled = false; }
  }

  async function updateProduct(id, changes) {
    try {
      await request(`/api/v1/admin/products/${encodeURIComponent(id)}`, { method:'PATCH', body:JSON.stringify(changes) });
      await refreshProducts();
      toast('Producto actualizado en el servidor.');
    } catch (error) { toast(`Error al actualizar: ${error.message}`); }
  }

  async function archiveProduct(id) {
    try {
      await request(`/api/v1/admin/products/${encodeURIComponent(id)}`, { method:'DELETE' });
      await refreshProducts();
      toast('Producto archivado en el servidor.');
    } catch (error) { toast(`Error al archivar: ${error.message}`); }
  }

  async function saveProduct(product) {
    const { id, ...changes } = product;
    const path = id ? `/api/v1/admin/products/${encodeURIComponent(id)}` : '/api/v1/admin/products';
    await request(path, { method:id?'PATCH':'POST', body:JSON.stringify(changes) });
    await refreshProducts();
  }

  window.novaBackend = { isConnected, saveProduct, updateProduct, archiveProduct, refreshProducts, disconnect };
  document.getElementById('backendConnectionForm').addEventListener('submit', connect);
  disconnectButton.addEventListener('click', () => disconnect());
  setConnectedStatus(false);
})();
