/* Inventario por variante, lotes, caja y cambios. Los flujos locales se migrarán
   a transacciones protegidas de FastAPI antes de habilitar cuentas de empleados. */
(() => {
  const el = (id) => document.getElementById(id);
  const cents = (number) => Math.round(Number(number) * 100);
  const amount = (number) => `Bs ${(Number(number) / 100).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const today = () => new Intl.DateTimeFormat('en-CA', { year:'numeric', month:'2-digit', day:'2-digit', timeZone:'America/La_Paz' }).format(new Date());
  const clean = (text) => String(text ?? '').trim();
  const key = (text) => clean(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es');
  const id = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
  const emptyRow = (columns, message) => `<tr><td colspan="${columns}"><div class="empty-state">${escapeHtml(message)}</div></td></tr>`;
  const findVariant = (variantId) => state.operations.variants.find(variant => variant.id === variantId);
  const productFor = (variant) => state.products.find(product => product.id === variant.productId);
  const title = (variant) => productFor(variant)?.name || variant.name || 'Modelo retirado';
  const listPrice = (variant) => Number(productFor(variant)?.price ?? variant.price ?? 0);
  const variantLabel = (variant) => `${title(variant)} · ${variant.color} · ${variant.size}`;
  const operationsReady = () => {
    if (window.novaBackend?.isConnected()) {
      toast('La API conectada aún no admite inventario por variantes ni punto de venta. No se registró ningún movimiento.');
      return false;
    }
    return true;
  };

  function ensureData() {
    if (!state.operations || typeof state.operations !== 'object') state.operations = {};
    for (const section of ['variants', 'batches', 'exchanges']) {
      if (!Array.isArray(state.operations[section])) state.operations[section] = [];
    }
    persist();
  }

  function renderInventory() {
    const variants = state.operations.variants;
    const units = variants.reduce((sum, variant) => sum + variant.quantity, 0);
    el('navStockCount').textContent = units;
    el('stockSkuCount').textContent = variants.length;
    el('stockUnits').textContent = units.toLocaleString('es-BO');
    el('stockLow').textContent = variants.filter(variant => variant.quantity > 0 && variant.quantity <= 3).length;
    el('stockValue').textContent = amount(variants.reduce((sum, variant) => sum + variant.valueCents, 0));
    const query = key(el('stockSearch').value), filter = el('stockFilter').value;
    const visible = variants.filter(variant => {
      const matches = key(`${title(variant)} ${variant.color} ${variant.size} ${variant.code || ''}`).includes(query);
      return matches && (filter === 'all' || (filter === 'available' && variant.quantity > 0) || (filter === 'low' && variant.quantity > 0 && variant.quantity <= 3) || (filter === 'empty' && variant.quantity === 0));
    });
    el('stockCountLabel').textContent = `${visible.length} variantes`;
    el('stockBody').innerHTML = visible.length ? visible.map(variant => `<tr><td><strong>${escapeHtml(title(variant))}</strong><small class="ops-cell-detail">${escapeHtml(productFor(variant)?.category || variant.category || 'Calzado')}</small></td><td>${escapeHtml(variant.color)} · <strong>${escapeHtml(variant.size)}</strong></td><td>${escapeHtml(variant.code || '—')}</td><td><strong>${variant.quantity}</strong> pares</td><td>${formatPrice(listPrice(variant))}</td><td><span class="badge ${variant.quantity === 0 ? 'badge-slate' : variant.quantity <= 3 ? 'badge-wait' : 'badge-good'}">${variant.quantity === 0 ? 'Agotado' : variant.quantity <= 3 ? 'Stock bajo' : 'Disponible'}</span></td></tr>`).join('') : emptyRow(6, 'No hay existencias registradas con estos filtros.');
  }

  function populateModel() {
    const selected = el('batchModel').value;
    el('batchModel').innerHTML = state.products.length ? state.products.map(product => `<option value="${escapeHtml(product.id)}">${escapeHtml(product.name)} · ${escapeHtml(product.category)}</option>`).join('') : '<option value="">Primero agrega un modelo al catálogo</option>';
    if (state.products.some(product => product.id === selected)) el('batchModel').value = selected;
    const product = state.products.find(item => item.id === el('batchModel').value);
    if (product && !el('batchColor').value.trim()) el('batchColor').value = product.color;
  }

  function batchCosts() {
    const usd = Number(el('batchUsd').value), share = Number(el('batchShare').value), fx1 = Number(el('batchFx1').value), fx2 = Number(el('batchFx2').value), freight = Number(el('batchFreight').value), qty = Number(el('batchQty').value);
    const valid = [usd, share, fx1, fx2, freight, qty].every(Number.isFinite) && usd >= 0 && share >= 0 && share <= 100 && fx1 > 0 && fx2 > 0 && freight >= 0 && Number.isInteger(qty) && qty > 0;
    const total = valid ? cents(usd * (share / 100) * fx1 + usd * (1 - share / 100) * fx2 + freight) : 0;
    el('batchCostTotal').textContent = amount(total);
    el('batchCostUnit').textContent = amount(valid ? total / qty : 0);
    return valid ? { total, usd, share, fx1, fx2, freight, qty } : null;
  }

  function recordBatch(event) {
    event.preventDefault();
    if (!operationsReady()) return;
    const cost = batchCosts(), product = state.products.find(item => item.id === el('batchModel').value);
    const color = clean(el('batchColor').value), size = clean(el('batchSize').value), code = clean(el('batchCode').value), date = el('batchDate').value;
    if (!product || !cost || cost.total <= 0 || cost.qty > 10000 || !color || color.length > 40 || !size || size.length > 8 || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today()) return toast('Revisa variante, fecha, cantidades y cálculo de costos.');
    let variant = state.operations.variants.find(item => item.productId === product.id && key(item.color) === key(color) && key(item.size) === key(size));
    if (code && state.operations.variants.some(item => item.id !== variant?.id && key(item.code) === key(code))) return toast('Ese código ya identifica otra variante. Comprueba talla y color.');
    if (variant && code && variant.code && key(variant.code) !== key(code)) return toast('Esta variante ya tiene otro código asociado. Revisa la etiqueta.');
    if (!variant) {
      variant = { id:id(), productId:product.id, name:product.name, category:product.category, price:product.price, color, size, code, quantity:0, valueCents:0 };
      state.operations.variants.push(variant);
    }
    if (code && !variant.code) variant.code = code;
    variant.quantity += cost.qty;
    variant.valueCents += cost.total;
    state.operations.batches.unshift({ id:id(), date, variantId:variant.id, productName:product.name, color, size, quantity:cost.qty, totalCents:cost.total, usd:cost.usd, share:cost.share, fx1:cost.fx1, fx2:cost.fx2, freight:cost.freight });
    logAction('Ingreso de mercadería', `${variantLabel(variant)}: +${cost.qty} pares, costo ${amount(cost.total)}.`);
    el('batchForm').reset(); el('batchDate').value = today(); el('batchShare').value = '70'; el('batchQty').value = '1'; el('batchUsd').value = '0'; el('batchFreight').value = '0'; el('batchColor').value = '';
    refresh(); toast('Lote registrado. Existencias actualizadas.');
  }

  function renderBatches() {
    populateModel();
    el('batchBody').innerHTML = state.operations.batches.length ? state.operations.batches.slice(0,80).map(batch => `<tr><td>${formatDate(batch.date)}</td><td><strong>${escapeHtml(batch.productName)}</strong><small class="ops-cell-detail">${escapeHtml(batch.color)} · ${escapeHtml(batch.size)}</small></td><td>${batch.quantity}</td><td>${amount(batch.totalCents)}</td><td>${amount(batch.totalCents / batch.quantity)}</td></tr>`).join('') : emptyRow(5, 'Todavía no se registraron ingresos de mercadería.');
    batchCosts();
  }

  function populatePOS() {
    const chosen = el('posVariant').value;
    const available = state.operations.variants.filter(variant => variant.quantity > 0);
    el('posVariant').innerHTML = available.length ? available.map(variant => `<option value="${escapeHtml(variant.id)}">${escapeHtml(variantLabel(variant))} · ${variant.quantity} pares</option>`).join('') : '<option value="">No hay productos disponibles</option>';
    if (available.some(item => item.id === chosen)) el('posVariant').value = chosen;
    const selectedCustomer = el('posCustomer').value;
    el('posCustomer').innerHTML = '<option value="">Venta ocasional</option>' + state.customers.map(customer => `<option value="${escapeHtml(customer.id)}">${escapeHtml(customer.alias)}</option>`).join('');
    if (state.customers.some(item => item.id === selectedCustomer)) el('posCustomer').value = selectedCustomer;
    return findVariant(el('posVariant').value);
  }

  function syncPOSVariant() {
    const variant = findVariant(el('posVariant').value);
    el('posPrice').value = variant ? listPrice(variant).toFixed(2) : '';
    el('posAvailable').textContent = variant ? `${variant.quantity} pares` : '—';
    el('posListPrice').textContent = variant ? formatPrice(listPrice(variant)) : '—';
    el('posStockHint').textContent = variant ? `${variant.color} · talla ${variant.size} · ${variant.quantity} disponibles` : 'Primero registra existencias en Ingreso de mercadería.';
    syncPOSTotal(true);
  }

  function syncPOSTotal(fillFirstPayment = false) {
    const quantity = Number(el('posQuantity').value), price = Number(el('posPrice').value);
    const total = Number.isFinite(quantity) && Number.isFinite(price) && quantity > 0 && price > 0 ? cents(quantity * price) : 0;
    if (fillFirstPayment) { el('posAmount1').value = (total / 100).toFixed(2); el('posAmount2').value = '0'; el('posPayment2').value = ''; }
    const paid = cents(Number(el('posAmount1').value || 0)) + cents(Number(el('posAmount2').value || 0));
    el('posTotal').textContent = amount(total);
    el('posDifference').textContent = amount(total - paid);
    el('posDifference').classList.toggle('ops-unbalanced', paid !== total);
    return { total, paid };
  }

  function recordSale(event) {
    event.preventDefault();
    if (!operationsReady()) return;
    const variant = findVariant(el('posVariant').value), quantity = Number(el('posQuantity').value), price = Number(el('posPrice').value), date = el('posDate').value;
    const { total, paid } = syncPOSTotal();
    const payment1 = el('posPayment1').value, payment2 = el('posPayment2').value, amt1 = cents(el('posAmount1').value), amt2 = cents(el('posAmount2').value);
    if (!variant || !Number.isInteger(quantity) || quantity < 1 || quantity > 100 || quantity > variant.quantity || !Number.isFinite(price) || price <= 0 || price > 999999 || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today()) return toast('Revisa existencia, precio, cantidad y fecha de la venta.');
    if (total < 1 || paid !== total || !Number.isSafeInteger(amt1) || !Number.isSafeInteger(amt2) || amt1 < 0 || amt2 < 0 || (!payment2 && amt2 > 0) || (payment2 && amt2 <= 0)) return toast('Los importes de los métodos de pago deben sumar exactamente el total.');
    const customerId = el('posCustomer').value || null;
    if (customerId && !state.customers.some(item => item.id === customerId)) return toast('El cliente ya no figura en el registro.');
    const inventoryValue = Math.min(variant.valueCents, Math.round(variant.valueCents / variant.quantity) * quantity);
    const sale = { id:`V-${id().toUpperCase()}`, productId:variant.productId, productName:title(variant), category:productFor(variant)?.category || variant.category, variantId:variant.id, color:variant.color, size:variant.size, customerId, date, quantity, amount:total / 100, costCents:inventoryValue, unitPrice:price, listPrice:listPrice(variant), discountCents:cents((listPrice(variant) - price) * quantity), payments:[{ method:payment1, amountCents:amt1 }, ...(amt2 ? [{ method:payment2, amountCents:amt2 }] : [])], source:'pos' };
    variant.quantity -= quantity;
    variant.valueCents -= inventoryValue;
    if (variant.quantity === 0) variant.valueCents = 0;
    state.sales.push(sale);
    logAction('Venta en mostrador', `${variantLabel(variant)} · ${quantity} pares · ${amount(total)} · ${sale.id}${sale.discountCents ? ` · ajuste respecto a lista ${amount(sale.discountCents)}` : ''}.`);
    el('posForm').reset(); el('posDate').value = today(); el('posQuantity').value = 1;
    refresh(); toast(`Venta ${sale.id} registrada y stock actualizado.`);
  }

  function renderExchanges() {
    const original = el('exchangeSale').value;
    const eligible = state.sales.filter(sale => sale.variantId && state.operations.exchanges.filter(item => item.saleId === sale.id).length < sale.quantity);
    el('exchangeSale').innerHTML = eligible.length ? eligible.map(sale => `<option value="${escapeHtml(sale.id)}">${escapeHtml(sale.id)} · ${escapeHtml(sale.productName)} · ${escapeHtml(sale.size)}</option>`).join('') : '<option value="">No hay ventas con cambios disponibles</option>';
    if (eligible.some(sale => sale.id === original)) el('exchangeSale').value = original;
    const replacement = el('exchangeVariant').value;
    const available = state.operations.variants.filter(variant => variant.quantity > 0);
    el('exchangeVariant').innerHTML = available.length ? available.map(variant => `<option value="${escapeHtml(variant.id)}">${escapeHtml(variantLabel(variant))} · ${variant.quantity} pares</option>`).join('') : '<option value="">Sin variantes disponibles</option>';
    if (available.some(variant => variant.id === replacement)) el('exchangeVariant').value = replacement;
    el('exchangeBody').innerHTML = state.operations.exchanges.length ? state.operations.exchanges.slice(0,80).map(change => `<tr><td>${formatDate(change.date)}</td><td>${escapeHtml(change.saleId)}</td><td>${escapeHtml(change.from)}</td><td>${escapeHtml(change.to)}</td><td>${escapeHtml(change.reason)}</td></tr>`).join('') : emptyRow(5, 'Aún no se registraron cambios de modelos o tallas.');
  }

  function recordExchange(event) {
    event.preventDefault();
    if (!operationsReady()) return;
    const sale = state.sales.find(item => item.id === el('exchangeSale').value && item.variantId), replacement = findVariant(el('exchangeVariant').value);
    if (!sale || !replacement || replacement.quantity < 1 || replacement.id === sale.variantId) return toast('Selecciona una venta y una variante diferente con existencias.');
    if (state.operations.exchanges.filter(item => item.saleId === sale.id).length >= sale.quantity) return toast('Ya se han cambiado todos los pares de esa venta.');
    if (cents(listPrice(replacement)) !== cents(sale.listPrice)) return toast('Este cambio tiene diferencia de precio; debe gestionarse como ajuste de caja por separado.');
    const returned = findVariant(sale.variantId);
    if (!returned) return toast('No se encontró la variante de la venta original.');
    if (!Number.isSafeInteger(sale.originalCostCents)) sale.originalCostCents = sale.costCents;
    const returnedCost = Math.round(sale.originalCostCents / sale.quantity);
    const replacementCost = Math.min(replacement.valueCents, Math.round(replacement.valueCents / replacement.quantity));
    returned.quantity += 1; returned.valueCents += returnedCost;
    replacement.quantity -= 1; replacement.valueCents -= replacementCost;
    sale.costCents += replacementCost - returnedCost;
    if (replacement.quantity === 0) replacement.valueCents = 0;
    const reason = el('exchangeReason').value;
    state.operations.exchanges.unshift({ id:id(), date:today(), saleId:sale.id, from:variantLabel(returned), to:variantLabel(replacement), reason });
    logAction('Cambio de mercadería', `${sale.id}: ${variantLabel(returned)} por ${variantLabel(replacement)}.`);
    refresh(); toast('Cambio registrado y existencias ajustadas.');
  }

  function renderProfit() {
    const period = Number(el('analyticsPeriod').value) || 6;
    const now = new Date(); const currentMonth = now.getFullYear() * 12 + now.getMonth();
    const sales = state.sales.filter(sale => sale.source === 'pos' && Number.isSafeInteger(sale.costCents) && /^\d{4}-\d{2}/.test(sale.date) && (() => { const [year, month] = sale.date.slice(0,7).split('-').map(Number); const index = year * 12 + month - 1; return index <= currentMonth && index > currentMonth - period; })());
    const revenue = sales.reduce((sum,sale) => sum + cents(sale.amount), 0);
    const costs = sales.reduce((sum,sale) => sum + sale.costCents, 0);
    el('opsRevenue').textContent = amount(revenue);
    el('opsCost').textContent = amount(costs);
    el('opsProfit').textContent = amount(revenue - costs);
    el('opsMargin').textContent = `${revenue ? ((revenue - costs) / revenue * 100).toFixed(1) : '0'}%`;
  }

  function csvCell(value) {
    let text = String(value ?? '');
    if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }
  function exportCsv(columns, rows, filename) {
    const csv = '\uFEFF' + [columns, ...rows].map(row => row.map(csvCell).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], {type:'text/csv;charset=utf-8'}));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; document.body.appendChild(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportBatches() {
    exportCsv(['Fecha','Modelo','Color','Talla','Pares','USD','Porcentaje primer pago','Cambio 1','Cambio 2','Flete Bs','Costo total Bs','Costo por par Bs'], state.operations.batches.map(batch => [batch.date,batch.productName,batch.color,batch.size,batch.quantity,batch.usd,batch.share,batch.fx1,batch.fx2,batch.freight,(batch.totalCents/100).toFixed(2),(batch.totalCents/batch.quantity/100).toFixed(2)]), 'nova-bella-ingresos.csv');
  }
  function exportInventory() {
    exportCsv(['Modelo','Línea','Color','Talla','Código','Pares disponibles','Precio de venta Bs','Costo almacenado Bs'], state.operations.variants.map(variant => [title(variant),productFor(variant)?.category || variant.category,variant.color,variant.size,variant.code || '',variant.quantity,listPrice(variant).toFixed(2),(variant.valueCents/100).toFixed(2)]), 'nova-bella-inventario.csv');
  }
  function exportSales() {
    exportCsv(['Fecha','Venta','Modelo','Color','Talla','Pares','Ingreso Bs','Costo Bs','Utilidad bruta Bs','Pagos'], state.sales.filter(sale => sale.source === 'pos').map(sale => [sale.date,sale.id,sale.productName,sale.color,sale.size,sale.quantity,Number(sale.amount).toFixed(2),(sale.costCents/100).toFixed(2),(sale.amount-sale.costCents/100).toFixed(2),sale.payments.map(payment => `${payment.method}: ${(payment.amountCents/100).toFixed(2)}`).join(' + ')]), 'nova-bella-ventas.csv');
  }

  function refresh() {
    renderInventory(); renderBatches();
    populatePOS(); syncPOSVariant();
    renderExchanges(); renderProfit();
    window.novaInsights?.renderOverview();
    window.novaInsights?.renderPage(activePage);
    renderOverview();
  }
  function renderPage(page) {
    if (page === 'inventario') renderInventory();
    if (page === 'ingresos') renderBatches();
    if (page === 'pos') { const before = el('posVariant').value; populatePOS(); if (before !== el('posVariant').value) syncPOSVariant(); }
    if (page === 'cambios') renderExchanges();
    if (page === 'analitica') renderProfit();
  }
  function reset() { ensureData(); refresh(); }

  ensureData();
  el('batchDate').value = today(); el('posDate').value = today();
  ['batchUsd','batchShare','batchFx1','batchFx2','batchFreight','batchQty'].forEach(field => el(field).addEventListener('input',batchCosts));
  el('batchModel').addEventListener('change', () => { el('batchColor').value = ''; populateModel(); });
  el('batchForm').addEventListener('submit', recordBatch);
  el('stockSearch').addEventListener('input', renderInventory);
  el('stockFilter').addEventListener('change', renderInventory);
  el('posVariant').addEventListener('change', syncPOSVariant);
  const scanCode = () => {
    const code = key(el('posCode').value);
    const variant = code && state.operations.variants.find(item => item.quantity > 0 && key(item.code) === code);
    if (variant) { el('posVariant').value = variant.id; syncPOSVariant(); return true; }
    return false;
  };
  el('posCode').addEventListener('input', scanCode);
  el('posCode').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); if (!scanCode()) toast('No se encontró una variante disponible con ese código.'); } });
  ['posQuantity','posPrice'].forEach(field => el(field).addEventListener('input', () => syncPOSTotal(true)));
  ['posAmount1','posAmount2','posPayment2'].forEach(field => el(field).addEventListener('input', () => syncPOSTotal()));
  el('posForm').addEventListener('submit', recordSale);
  el('exchangeForm').addEventListener('submit', recordExchange);
  el('analyticsPeriod').addEventListener('change', renderProfit);
  el('exportBatches').addEventListener('click', exportBatches);
  el('exportInventory').addEventListener('click', exportInventory);
  el('exportOperations').addEventListener('click', exportSales);
  window.novaOperations = { renderPage, refresh, reset };
  refresh();
})();
