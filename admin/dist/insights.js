/* Herramientas de análisis comercial y seguimiento de clientes. */
(() => {
  const money = (number) => `Bs ${Math.round(number).toLocaleString('es-BO')}`;
  const compactMoney = (number) => number >= 1000 ? `${(number/1000).toFixed(1)} mil` : String(Math.round(number));
  const monthKey = (date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
  const relativeMonth = (offset) => { const d=new Date();d.setDate(1);d.setMonth(d.getMonth()+offset);return monthKey(d); };
  const bolivianDate = () => new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'America/La_Paz'}).format(new Date());
  const monthName = (key) => { const [year,month]=key.split('-').map(Number);return new Intl.DateTimeFormat('es-BO',{month:'short',timeZone:'UTC'}).format(new Date(Date.UTC(year,month-1,10))).replace('.',''); };
  const customerIds = ['c001','c002','c003','c004','c005','c006','c007','c008','c009','c010','c011','c012','c013','c014'];
  const categoryColors = { Tacones:'#9f627c', Botas:'#d4a0ac', Casuales:'#8e8ca8' };
  const segmentColors = { frecuente:'#578d70', recurrente:'#a782bb', nuevo:'#d3a665', potencial:'#aeb0b9' };
  const segmentLabels = { frecuente:'Frecuentes', recurrente:'Recurrentes', nuevo:'Primera compra', potencial:'Sin compras' };

  function seedCustomers() {
    return customerIds.map((id,index) => ({
      id, alias:`Cliente ${String(index+1).padStart(3,'0')}`,
      preference:['Tacones','Botas','Casuales'][index%3],
      followup:index%5===0?'Contactado':index%4===0?'Sin pendiente':'Pendiente',
      nextDate:'', note:''
    }));
  }

  function seedSales() {
    const catalog = [
      {id:'alba',name:'Alba · Slingback',category:'Tacones',price:429},
      {id:'vega',name:'Vega · Bota alta',category:'Botas',price:549},
      {id:'roma',name:'Roma · Botín',category:'Botas',price:489},
      {id:'duna',name:'Duna · Mocasín',category:'Casuales',price:399}
    ];
    const volumes=[5,6,7,9,8,10,11,13,15,17,19,23];
    const clientPattern=['c001','c002',null,'c003','c004','c001','c005',null,'c006','c002','c007',null,'c003',null,'c001',null];
    const records=[];
    volumes.forEach((quantity,m) => {
      const month=relativeMonth(m-11);
      const maxDay = m===11 ? Math.max(Number(bolivianDate().slice(-2)),1) : 26;
      for(let index=0;index<quantity;index++) {
        const item=catalog[(index*3+m)%catalog.length];
        const day=String(1+(index*5+m)%maxDay).padStart(2,'0');
        const id=`V-${String(records.length+1).padStart(4,'0')}`;
        let customerId=clientPattern[(index+m*3)%clientPattern.length];
        if (m>=8 && index===quantity-2) customerId='c008';
        if (m>=9 && index===quantity-3) customerId='c009';
        if (m>=10 && index===quantity-4) customerId='c010';
        if (m>=9 && index===quantity-1) customerId=['c011','c012','c013'][m-9] ?? customerId;
        records.push({id,productId:item.id,productName:item.name,category:item.category,customerId,date:`${month}-${day}`,quantity:1,amount:item.price});
      }
    });
    return records;
  }

  function ensureData() {
    let changed=false;
    if(!Array.isArray(state.customers)) { state.customers=seedCustomers(); changed=true; }
    if(!Array.isArray(state.sales)) { state.sales=seedSales(); changed=true; }
    if(!state.business || typeof state.business.monthlyGoal!=='number') { state.business={monthlyGoal:9500}; changed=true; }
    if(changed) persist();
  }

  const salesForCustomer = (id) => state.sales.filter(item => item.customerId===id);
  const periodMonths = (count) => Array.from({length:count},(_,index)=>relativeMonth(index-count+1));
  const salesInMonths = (months) => state.sales.filter(item=>months.includes(item.date.slice(0,7)));
  const revenueOf = (items) => items.reduce((sum,item)=>sum+Number(item.amount||0),0);
  const customerSegment = (count) => count>=5?'frecuente':count>=2?'recurrente':count>=1?'nuevo':'potencial';
  const percent = (value) => `${Math.round(value)}%`;
  const latestSales = () => [...state.sales].sort((a,b)=>b.date.localeCompare(a.date)||b.id.localeCompare(a.id));
  const customerStats = (customer) => {
    const history=salesForCustomer(customer.id);
    return {history,count:history.length,total:revenueOf(history),lastDate:history.length?history.map(item=>item.date).sort().at(-1):null,segment:customerSegment(history.length)};
  };

  function growthFor(count) {
    const current=periodMonths(count),prior=Array.from({length:count},(_,index)=>relativeMonth(index-count*2+1));
    const currentTotal=revenueOf(salesInMonths(current)),priorTotal=revenueOf(salesInMonths(prior));
    return {currentTotal,priorTotal,rate:priorTotal>0?(currentTotal-priorTotal)/priorTotal*100:null};
  }

  function lineChart(values,small=false) {
    if(!values.length) return '';
    const width=760,height=small?155:300,left=small?10:57,right=small?10:15,top=small?12:23,bottom=small?13:24;
    const usableW=width-left-right,usableH=height-top-bottom;
    const max=Math.max(100,Math.ceil(Math.max(...values)*1.15/500)*500);
    const points=values.map((value,index)=>({x:left+usableW*(values.length===1?.5:index/(values.length-1)),y:top+usableH*(1-value/max),value}));
    const line=points.map((point,index)=>`${index===0?'M':'L'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
    const area=`${line} L${points.at(-1).x.toFixed(1)} ${(height-bottom).toFixed(1)} L${points[0].x.toFixed(1)} ${(height-bottom).toFixed(1)} Z`;
    const ticks=small?'':[0,.25,.5,.75,1].map(p=>{const y=top+usableH*(1-p);return `<line x1="${left}" y1="${y}" x2="${width-right}" y2="${y}" stroke="#eee9ed" stroke-width="1"/><text x="${left-9}" y="${y+4}" text-anchor="end" fill="#a59da8" font-size="12">${compactMoney(max*p)}</text>`;}).join('');
    return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><defs><linearGradient id="${small?'mini':'main'}RevenueGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b78096" stop-opacity=".22"/><stop offset="1" stop-color="#b78096" stop-opacity="0"/></linearGradient></defs>${ticks}<path d="${area}" fill="url(#${small?'mini':'main'}RevenueGradient)"/><path d="${line}" fill="none" stroke="#a46c82" stroke-width="${small?3.5:3}" stroke-linecap="round" stroke-linejoin="round"/>${points.map(point=>`<circle cx="${point.x}" cy="${point.y}" r="${small?3.6:4.3}" fill="#fff" stroke="#a46c82" stroke-width="2"><title>${money(point.value)}</title></circle>`).join('')}</svg>`;
  }

  function renderOverview() {
    const monthly=periodMonths(6);
    const values=monthly.map(month=>revenueOf(salesInMonths([month])));
    const lastMonth=values.at(-1),previous=values.at(-2);
    $('#homeRevenue').textContent=money(lastMonth);
    const growth=previous>0?(lastMonth-previous)/previous*100:null;
    const badge=$('#homeGrowth');
    badge.textContent=growth===null?'Sin comparación':`${growth>=0?'+':''}${growth.toFixed(1)}% ${growth>=0?'de crecimiento':'de variación'}`;
    badge.classList.toggle('negative',growth!==null&&growth<0);
    $('#homeSalesChart').innerHTML=lineChart(values,true);
  }

  function renderAnalytics() {
    const period=Number($('#analyticsPeriod').value)||6;
    const months=periodMonths(period),sales=salesInMonths(months),revenue=revenueOf(sales);
    const growth=growthFor(period);
    $('#metricRevenue').textContent=money(revenue);
    $('#metricRevenueTrend').textContent=growth.rate===null?'Sin período anterior comparable':`${growth.rate>=0?'+':''}${growth.rate.toFixed(1)}% frente al período anterior`;
    $('#metricTransactions').textContent=sales.length.toLocaleString('es-BO');
    $('#metricSalesDetail').textContent=`${period} meses de actividad`;
    $('#metricAverage').textContent=money(sales.length?revenue/sales.length:0);
    const identified=new Set(sales.map(item=>item.customerId).filter(Boolean));
    const returning=[...identified].filter(id=>salesForCustomer(id).length>=2).length;
    $('#metricReturning').textContent=percent(identified.size?returning/identified.size*100:0);
    $('#metricReturningCount').textContent=`${returning} de ${identified.size} perfiles identificados`;
    const monthlyValues=months.map(month=>revenueOf(salesInMonths([month])));
    $('#revenueChart').innerHTML=lineChart(monthlyValues);
    $('#revenueMonths').innerHTML=months.map(month=>`<span>${escapeHtml(monthName(month))}</span>`).join('');
    const currentMonth=revenueOf(salesInMonths([relativeMonth(0)])),goal=state.business.monthlyGoal;
    $('#goalActual').textContent=money(currentMonth);
    $('#goalAmount').textContent=money(goal);
    $('#goalPercent').textContent=percent(goal>0?currentMonth/goal*100:0);
    $('#goalFill').style.width=`${Math.min(100,goal>0?currentMonth/goal*100:0)}%`;
    $('#monthlyGoal').value=goal;
    renderCategoryChart(sales);
    renderRanking(sales);
  }

  function renderCategoryChart(sales) {
    const categories=['Tacones','Botas','Casuales'];
    const revenue=revenueOf(sales);
    let start=0;
    const parts=categories.map(category=>{
      const value=revenueOf(sales.filter(item=>item.category===category));
      const share=revenue?value/revenue*100:0;
      const stop=start+share;
      const part=`${categoryColors[category]} ${start.toFixed(2)}% ${stop.toFixed(2)}%`;
      start=stop;
      return {category,value,share,part};
    });
    $('#categoryDonut').style.background=revenue?`conic-gradient(${parts.map(x=>x.part).join(',')})`:'#efecf0';
    $('#donutTotal').textContent=sales.length.toLocaleString('es-BO');
    $('#categoryLegend').innerHTML=parts.map(item=>`<div class="legend-row"><span class="legend-dot" style="background:${categoryColors[item.category]}"></span><span>${item.category}</span><strong>${percent(item.share)}</strong></div>`).join('');
  }

  function renderRanking(sales) {
    const totals=new Map();
    sales.forEach(item=>{const key=item.productName;totals.set(key,(totals.get(key)||0)+Number(item.quantity||1));});
    const ranked=[...totals].sort((a,b)=>b[1]-a[1]).slice(0,5),max=ranked[0]?.[1]||1;
    $('#productRanking').innerHTML=ranked.length?ranked.map(([name,count],index)=>`<div class="ranking-row"><span class="ranking-position">${String(index+1).padStart(2,'0')}</span><span class="ranking-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span><div class="ranking-track"><div class="ranking-fill" style="width:${count/max*100}%"></div></div><strong>${count}</strong></div>`).join(''):'<div class="empty-state">Aún no hay ventas registradas en este período.</div>';
  }

  function renderSales() {
    const all=latestSales(),last=all[0];
    $('#salesTotalCount').textContent=all.length.toLocaleString('es-BO');
    $('#salesLifetimeRevenue').textContent=money(revenueOf(all));
    $('#salesLatestDate').textContent=last?formatDate(last.date):'Sin ventas';
    const months=[...new Set(all.map(item=>item.date.slice(0,7)))].sort().reverse();
    const selector=$('#saleMonthFilter'),current=selector.value;
    selector.innerHTML='<option value="all">Todos los meses</option>'+months.map(key=>`<option value="${escapeHtml(key)}">${escapeHtml(monthName(key))} ${escapeHtml(key.slice(0,4))}</option>`).join('');
    selector.value=months.includes(current)?current:'all';
    const query=$('#saleSearch').value.trim().toLocaleLowerCase('es');
    const visible=all.filter(item=>{
      const alias=state.customers.find(client=>client.id===item.customerId)?.alias||'Venta ocasional';
      return (selector.value==='all'||item.date.startsWith(selector.value))&&`${item.id} ${item.productName} ${alias}`.toLocaleLowerCase('es').includes(query);
    });
    $('#salesCountLabel').textContent=`${visible.length} registros`;
    $('#salesBody').innerHTML=visible.length?visible.map(item=>{
      const customer=state.customers.find(client=>client.id===item.customerId);
      return `<tr><td><strong>${escapeHtml(item.id)}</strong></td><td><div class="inquiry-cell"><strong>${escapeHtml(item.productName)}</strong><small>${escapeHtml(item.category)} · ${Number(item.quantity)||1} ud.</small></div></td><td>${escapeHtml(customer?.alias||'Venta ocasional')}</td><td>${escapeHtml(formatDate(item.date))}</td><td class="actions-header price-cell">${money(item.amount)}</td></tr>`;
    }).join(''):'<tr><td colspan="5"><div class="empty-state">No hay ventas con estos filtros.</div></td></tr>';
  }

  function renderCustomers() {
    const all=state.customers.map(customer=>({customer,...customerStats(customer)})).sort((a,b)=>b.total-a.total||a.customer.alias.localeCompare(b.customer.alias));
    const frequent=all.filter(item=>item.segment==='frecuente').length;
    $('#customerTotal').textContent=all.length;
    $('#customerFrequent').textContent=frequent;
    $('#customerFollowups').textContent=all.filter(item=>item.customer.followup==='Pendiente').length;
    const active=all.filter(item=>item.count>0);
    $('#customerAvgValue').textContent=money(active.length?active.reduce((sum,item)=>sum+item.total,0)/active.length:0);
    renderSegments(all);
    const query=$('#customerSearch').value.trim().toLocaleLowerCase('es');
    const segment=$('#customerSegmentFilter').value;
    const filtered=all.filter(item=>(segment==='all'||segment===item.segment)&&item.customer.alias.toLocaleLowerCase('es').includes(query));
    $('#customerCountLabel').textContent=`${filtered.length} perfiles`;
    $('#customersBody').innerHTML=filtered.length?filtered.map(item=>`<tr><td><div class="client-alias"><span class="alias-avatar">${escapeHtml(item.customer.alias.slice(-2))}</span><div><strong>${escapeHtml(item.customer.alias)}</strong><small>${escapeHtml(item.customer.preference)}</small></div></div></td><td><strong>${item.count}</strong><br><span class="client-segment ${item.segment}">${segmentLabels[item.segment]}</span></td><td class="price-cell">${money(item.total)}</td><td>${item.lastDate?escapeHtml(formatDate(item.lastDate)):'Sin compras'}</td><td><span class="badge ${item.customer.followup==='Contactado'?'badge-good':item.customer.followup==='Pendiente'?'badge-wait':'badge-slate'}">${escapeHtml(item.customer.followup)}</span></td><td class="actions-header"><button class="secondary-button compact-button" data-customer-profile="${escapeHtml(item.customer.id)}">Ver ficha</button></td></tr>`).join(''):'<tr><td colspan="6"><div class="empty-state">No se encontraron perfiles con estos criterios.</div></td></tr>';
  }

  function renderSegments(all) {
    const total=all.length||1;
    const segments=['frecuente','recurrente','nuevo','potencial'].map(key=>({key,count:all.filter(item=>item.segment===key).length,color:segmentColors[key]}));
    $('#segmentTrack').innerHTML=segments.map(item=>`<div style="width:${item.count/total*100}%;background:${item.color}" title="${segmentLabels[item.key]}: ${item.count}"></div>`).join('');
    $('#segmentLegend').innerHTML=segments.map(item=>`<div><i style="background:${item.color}"></i><span>${segmentLabels[item.key]}</span><strong>${item.count}</strong></div>`).join('');
  }

  function renderPage(page) {
    if(page==='analitica') renderAnalytics();
    else if(page==='ventas') renderSales();
    else if(page==='clientes') renderCustomers();
  }

  function refresh() {
    renderCounts();renderOverview();renderPage(activePage);renderActivity();
  }

  let modalFocus=null;
  function showModal(id) { modalFocus=document.activeElement; $(`#${id}`).hidden=false; }
  function closeModal(id) { if(!['saleModal','customerModal','profileModal'].includes(id)) return; $(`#${id}`).hidden=true;modalFocus?.focus?.(); }
  function closeAnyModal() { for(const id of ['profileModal','customerModal','saleModal']) if(!$(`#${id}`).hidden){closeModal(id);return true;}return false; }

  function updateSaleTotal() {
    const quantity=Number($('#saleQuantity').value)||0,price=Number($('#saleUnitPrice').value)||0;
    $('#saleFormTotal').textContent=money(quantity*price);
  }
  function openSaleModal() {
    const options=state.products.map(item=>`<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)} · ${money(item.price)}</option>`).join('');
    $('#saleProduct').innerHTML=options||'<option value="">Primero agrega un producto</option>';
    $('#saleCustomer').innerHTML='<option value="">Venta ocasional (sin perfil)</option>'+state.customers.map(item=>`<option value="${escapeHtml(item.id)}">${escapeHtml(item.alias)}</option>`).join('');
    $('#saleForm').reset();
    $('#saleDate').value=bolivianDate();
    $('#saleUnitPrice').value=state.products[0]?.price||'';
    $('#saleQuantity').value='1';
    updateSaleTotal();showModal('saleModal');$('#saleProduct').focus();
  }
  function saveSale(event) {
    event.preventDefault();
    const product=state.products.find(item=>item.id===$('#saleProduct').value);
    const date=$('#saleDate').value,quantity=Number($('#saleQuantity').value),unitPrice=Number($('#saleUnitPrice').value);
    if(!product||!/^\d{4}-\d{2}-\d{2}$/.test(date)||date>bolivianDate()||!Number.isInteger(quantity)||quantity<1||quantity>100||!Number.isFinite(unitPrice)||unitPrice<1||unitPrice>99999)return toast('Revisa producto, fecha, cantidad y precio.');
    const customerId=$('#saleCustomer').value||null;
    if(customerId&&!state.customers.some(item=>item.id===customerId))return toast('El perfil seleccionado no existe.');
    state.sales.push({id:`V-${Date.now().toString(36).toUpperCase()}`,productId:product.id,productName:product.name,category:product.category,customerId,date,quantity,amount:Math.round(quantity*unitPrice)});
    logAction('Venta registrada',`${product.name}, ${quantity} ud. por ${money(quantity*unitPrice)}.`);
    closeModal('saleModal');refresh();toast('Venta incorporada al análisis.');
  }

  function openCustomerModal() { $('#customerForm').reset();showModal('customerModal');$('#customerAlias').focus(); }
  function saveCustomer(event) {
    event.preventDefault();
    const alias=$('#customerAlias').value.trim();
    if(alias.length<3)return toast('Introduce un alias de al menos 3 caracteres.');
    if(state.customers.some(item=>item.alias.toLocaleLowerCase('es')===alias.toLocaleLowerCase('es')))return toast('Ya existe un perfil con ese alias.');
    const id=`c${Date.now().toString(36)}`;
    state.customers.push({id,alias,preference:$('#customerPreference').value,followup:'Pendiente',nextDate:'',note:''});
    logAction('Perfil creado',`${alias} se agregó al seguimiento.`);
    closeModal('customerModal');refresh();toast('Perfil creado correctamente.');
  }

  function openProfile(id) {
    const customer=state.customers.find(item=>item.id===id);
    if(!customer)return;
    const stats=customerStats(customer);
    $('#profileId').value=customer.id;
    $('#profileModalTitle').textContent=customer.alias;
    $('#profileSubtitle').textContent=`Preferencia: ${customer.preference} · ${segmentLabels[stats.segment]}`;
    $('#profileKpis').innerHTML=`<div><span>Compras</span><strong>${stats.count}</strong></div><div><span>Valor histórico</span><strong>${money(stats.total)}</strong></div><div><span>Última compra</span><strong>${stats.lastDate?escapeHtml(formatDate(stats.lastDate)):'—'}</strong></div>`;
    $('#profilePurchases').innerHTML=stats.history.length?[...stats.history].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,5).map(item=>`<div class="profile-purchase"><span>${escapeHtml(item.productName)}<br><small>${escapeHtml(formatDate(item.date))}</small></span><strong>${money(item.amount)}</strong></div>`).join(''):'<div class="empty-state">Este perfil todavía no tiene compras.</div>';
    $('#profileFollowup').value=customer.followup;
    $('#profileNextDate').value=customer.nextDate||'';
    $('#profileNote').value=customer.note||'';
    showModal('profileModal');$('#profileFollowup').focus();
  }
  function saveProfile(event) {
    event.preventDefault();
    const customer=state.customers.find(item=>item.id===$('#profileId').value);
    if(!customer)return toast('No se encontró el perfil.');
    customer.followup=$('#profileFollowup').value;
    customer.nextDate=$('#profileNextDate').value;
    customer.note=$('#profileNote').value.trim();
    logAction('Seguimiento actualizado',`${customer.alias}: ${customer.followup}.`);
    closeModal('profileModal');refresh();toast('Seguimiento guardado.');
  }

  function saveGoal() {
    const value=Number($('#monthlyGoal').value);
    if(!Number.isInteger(value)||value<100||value>1000000)return toast('La meta debe estar entre Bs 100 y Bs 1.000.000.');
    state.business.monthlyGoal=value;
    logAction('Objetivo de ventas actualizado',`Nueva meta mensual: ${money(value)}.`);
    renderAnalytics();renderActivity();toast('Objetivo mensual guardado.');
  }

  function bindEvents() {
    $('#analyticsPeriod').addEventListener('change',renderAnalytics);
    $('#saveGoal').addEventListener('click',saveGoal);
    $('#saleSearch').addEventListener('input',renderSales);
    $('#saleMonthFilter').addEventListener('change',renderSales);
    $('#customerSearch').addEventListener('input',renderCustomers);
    $('#customerSegmentFilter').addEventListener('change',renderCustomers);
    $('#addSale').addEventListener('click',() => openPage('pos'));
    $('#addCustomer').addEventListener('click',openCustomerModal);
    $('#saleProduct').addEventListener('change',()=>{$('#saleUnitPrice').value=state.products.find(item=>item.id===$('#saleProduct').value)?.price||'';updateSaleTotal();});
    $('#saleQuantity').addEventListener('input',updateSaleTotal);
    $('#saleUnitPrice').addEventListener('input',updateSaleTotal);
    $('#saleForm').addEventListener('submit',saveSale);
    $('#customerForm').addEventListener('submit',saveCustomer);
    $('#profileForm').addEventListener('submit',saveProfile);
    $('#customersBody').addEventListener('click',event=>{const button=event.target.closest('[data-customer-profile]');if(button)openProfile(button.dataset.customerProfile);});
    $$('[data-close-business]').forEach(button=>button.addEventListener('click',()=>closeModal(button.dataset.closeBusiness)));
  }

  function reset() { ensureData();refresh(); }

  ensureData();
  bindEvents();
  window.novaInsights={renderPage,renderOverview,closeModal,closeAnyModal,reset};
  renderOverview();renderPage(activePage);
})();
