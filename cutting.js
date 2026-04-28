// cutting.js — Разделка v2
// ============================================================

// DB_PREFIX задаётся в config.js (''/'/dev') — DEV/PROD автоматически по домену
var CUTTING_FB = 'https://fika-d21a6-default-rtdb.europe-west1.firebasedatabase.app'
  + (typeof DB_PREFIX !== 'undefined' ? DB_PREFIX : '')
  + '/cutting';

var CUTTING_PRODUCTS_DEFAULT = [
  'Форель', 'Лосось', 'Сёмга', 'Окунь', 'Судак',
  'Говядина', 'Свинина', 'Баранина', 'Курица', 'Индейка'
];

var cuttingProducts    = [];
var cuttingRecords     = {};
var cuttingViewProduct = null;
var cuttingFilterFrom  = null; // 'YYYY-MM-DD'
var cuttingFilterTo    = null; // 'YYYY-MM-DD'

// ============================================================
// HELPERS
// ============================================================

function todayStr() {
  var n = new Date();
  return n.getFullYear() + '-' + pad(n.getMonth()+1) + '-' + pad(n.getDate());
}

function pad(n) { return n < 10 ? '0'+n : ''+n; }

function formatDate(s) {
  if (!s) return '';
  var p = s.split('-');
  return p[2]+'.'+p[1]+'.'+p[0];
}

function plural(n, one, two, five) {
  var m10=n%10, m100=n%100;
  if (m100>=11&&m100<=19) return five;
  if (m10===1) return one;
  if (m10>=2&&m10<=4) return two;
  return five;
}

function fmtKg(val) {
  return (parseFloat(val)||0).toFixed(3)+' кг';
}

// Smart number parser:
// >10 → grams → divide by 1000
// ≤10 → kg already
// handles comma as decimal separator
function parseWeight(raw) {
  if (raw === null || raw === undefined || raw === '') return NaN;
  var s = String(raw).trim().replace(',', '.');
  var v = parseFloat(s);
  if (isNaN(v) || v < 0) return NaN;
  if (v > 100) return v / 1000; // grams → kg (>100 = grams, ≤100 = kg)
  return v; // already kg
}

function weightHint(raw) {
  var v = parseWeight(raw);
  if (isNaN(v)) return '';
  var isGrams = parseFloat(String(raw).replace(',','.')) > 100;
  return '= ' + fmtKg(v) + (isGrams ? ' (граммы → кг)' : '');
}

function isAdmin() {
  return typeof currentUser !== 'undefined' && currentUser && currentUser.role === 'admin';
}

function isCook() {
  return typeof currentUser !== 'undefined' && currentUser && currentUser.role === 'cook';
}

// ============================================================
// FIREBASE HELPERS — with retry for reliability
// ============================================================
function cFbGet(path) {
  return fetch(CUTTING_FB + path + '.json').then(function(r){
    if (!r.ok) throw new Error('HTTP '+r.status);
    return r.json();
  });
}

function cFbSet(path, data) {
  return fetch(CUTTING_FB + path + '.json', {
    method: 'PUT',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify(data)
  }).then(function(r){
    if (!r.ok) throw new Error('HTTP '+r.status);
    return r.json();
  });
}

function cFbPush(path, data) {
  return fetch(CUTTING_FB + path + '.json', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify(data)
  }).then(function(r){
    if (!r.ok) throw new Error('HTTP '+r.status);
    return r.json();
  });
}

function cFbPatch(path, data) {
  return fetch(CUTTING_FB + path + '.json', {
    method: 'PATCH',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify(data)
  }).then(function(r){
    if (!r.ok) throw new Error('HTTP '+r.status);
    return r.json();
  });
}

function cFbDelete(path) {
  return fetch(CUTTING_FB + path + '.json', {method:'DELETE'})
    .then(function(r){ return r.json(); });
}

// Safe push with retry — for critical saves
function cFbPushSafe(path, data, retries) {
  retries = retries || 3;
  return cFbPush(path, data).catch(function(e) {
    if (retries > 1) {
      return new Promise(function(res){ setTimeout(res, 1000); })
        .then(function(){ return cFbPushSafe(path, data, retries-1); });
    }
    throw e;
  });
}

// ============================================================
// LOAD DATA
// ============================================================
function loadCutting() {
  cFbGet('').then(function(data) {
    if (!data) data = {};
    cuttingProducts = (data.products && Array.isArray(data.products))
      ? data.products : CUTTING_PRODUCTS_DEFAULT.slice();
    cuttingRecords = (data.records && typeof data.records === 'object')
      ? data.records : {};
    renderCuttingScreen();
  }).catch(function(e) {
    console.error('loadCutting error:', e);
    cuttingProducts = CUTTING_PRODUCTS_DEFAULT.slice();
    cuttingRecords  = {};
    renderCuttingScreen();
  });
}

// ============================================================
// OPEN CUTTING
// ============================================================
function openCutting() {
  cuttingViewProduct = null;
  // Always reset filter to today on open
  var today = todayStr();
  cuttingFilterFrom = today;
  cuttingFilterTo   = today;
  goTo('cutting');
  loadCutting();
}

// ============================================================
// FILTER LOGIC
// ============================================================
function getFilteredRecords(allRecords) {
  return allRecords.filter(function(r) {
    if (cuttingFilterFrom && r.date < cuttingFilterFrom) return false;
    if (cuttingFilterTo   && r.date > cuttingFilterTo)   return false;
    return true;
  });
}

function applyFilter() {
  var from = document.getElementById('cutting-filter-from');
  var to   = document.getElementById('cutting-filter-to');
  cuttingFilterFrom = (from && from.value) ? from.value : null;
  cuttingFilterTo   = (to   && to.value)   ? to.value   : null;
  renderCuttingMain();
}

function resetFilter() {
  var today = todayStr();
  cuttingFilterFrom = today;
  cuttingFilterTo   = today;
  var from = document.getElementById('cutting-filter-from');
  var to   = document.getElementById('cutting-filter-to');
  if (from) from.value = today;
  if (to)   to.value   = today;
  renderCuttingMain();
}

// ============================================================
// RENDER MAIN SCREEN
// ============================================================
function renderCuttingScreen() {
  // Update filter inputs
  var from = document.getElementById('cutting-filter-from');
  var to   = document.getElementById('cutting-filter-to');
  if (from && !from.value) from.value = cuttingFilterFrom || todayStr();
  if (to   && !to.value)   to.value   = cuttingFilterTo   || todayStr();

  // Cook: restrict to today only, hide export, hide products editor
  var exportBtn = document.getElementById('cutting-export-btn');
  var editBtn   = document.getElementById('cutting-edit-products-btn');
  var filterRow = document.getElementById('cutting-filter-row');

  if (isCook()) {
    // Force today
    cuttingFilterFrom = todayStr();
    cuttingFilterTo   = todayStr();
    if (from) { from.value = cuttingFilterFrom; from.disabled = true; }
    if (to)   { to.value   = cuttingFilterTo;   to.disabled   = true; }
    if (exportBtn) exportBtn.style.display = 'none';
    if (editBtn)   editBtn.style.display   = 'none';
  } else {
    if (from) from.disabled = false;
    if (to)   to.disabled   = false;
    if (exportBtn) exportBtn.style.display = '';
    if (editBtn)   editBtn.style.display   = isAdmin() ? 'flex' : 'none';
  }

  renderCuttingMain();
}

function renderCuttingMain() {
  var container = document.getElementById('cutting-summary');
  if (!container) return;

  var allRec = Object.keys(cuttingRecords).map(function(k){
    return Object.assign({_id:k}, cuttingRecords[k]);
  });
  var records = getFilteredRecords(allRec);

  // Group by product
  var groups = {};
  records.forEach(function(r) {
    if (!groups[r.product]) groups[r.product] = {count:0, brutto:0, netto:0};
    groups[r.product].count++;
    groups[r.product].brutto += parseFloat(r.brutto)||0;
    groups[r.product].netto  += parseFloat(r.netto) ||0;
  });

  container.innerHTML = '';

  if (!Object.keys(groups).length) {
    container.innerHTML = '<div style="text-align:center;padding:40px 0;color:var(--text-muted);font-size:14px;">Нет записей за выбранный период</div>';
    return;
  }

  var sorted = cuttingProducts.filter(function(p){ return groups[p]; });
  Object.keys(groups).forEach(function(p){ if (sorted.indexOf(p)===-1) sorted.push(p); });

  sorted.forEach(function(product) {
    var g = groups[product]; if (!g) return;
    var waste    = g.brutto - g.netto;
    var wastePct = g.brutto > 0 ? ((waste/g.brutto)*100).toFixed(1) : '0.0';

    var card = document.createElement('div');
    card.style.cssText = 'background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px;margin-bottom:10px;cursor:pointer;';
    card.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">'
      + '<div style="font-family:Syne,sans-serif;font-size:17px;font-weight:700;color:var(--text-primary);">'+product+'</div>'
      + '<div style="font-size:12px;color:var(--text-muted);">'+g.count+' '+plural(g.count,'разделка','разделки','разделок')+'</div>'
      + '</div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;">'
      + statBox('Брутто', fmtKg(g.brutto))
      + statBox('Нетто',  fmtKg(g.netto))
      + statBox('Отход',  fmtKg(waste) + (isCook() ? '' : '<div style="font-size:11px;color:#e24b4a;font-weight:600;margin-top:2px;">'+wastePct+'%</div>'))
      + '</div>';

    (function(p){
      card.onclick = function(){ openCuttingProduct(p); };
    })(product);
    container.appendChild(card);
  });
}

function statBox(label, value) {
  return '<div style="background:var(--surface2);border-radius:8px;padding:8px 10px;">'
    + '<div style="font-size:10px;color:var(--text-muted);font-weight:500;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">'+label+'</div>'
    + '<div style="font-size:14px;font-weight:600;color:var(--text-primary);">'+value+'</div>'
    + '</div>';
}

// ============================================================
// PRODUCT DETAIL
// ============================================================
function openCuttingProduct(product) {
  cuttingViewProduct = product;
  document.getElementById('cutting-product-title').textContent = product;
  renderCuttingProductList();
  goTo('cutting-product');
}

function renderCuttingProductList() {
  var list = document.getElementById('cutting-product-list');
  if (!list) return;

  var allRec = Object.keys(cuttingRecords)
    .map(function(k){ return Object.assign({_id:k}, cuttingRecords[k]); })
    .filter(function(r){ return r.product === cuttingViewProduct; });

  // Cook: force today only
  if (isCook()) {
    var today = todayStr();
    allRec = allRec.filter(function(r){ return r.date === today; });
  }
  var records = getFilteredRecords(allRec);
  records.sort(function(a,b){ return b.timestamp-a.timestamp; });

  list.innerHTML = '';

  if (!records.length) {
    list.innerHTML = '<div style="text-align:center;padding:40px 0;color:var(--text-muted);font-size:14px;">Нет записей за выбранный период</div>';
    return;
  }

  records.forEach(function(r) {
    var waste    = (parseFloat(r.brutto)||0)-(parseFloat(r.netto)||0);
    var wastePct = r.brutto>0 ? ((waste/parseFloat(r.brutto))*100).toFixed(1) : '0.0';
    var isToday  = r.date === todayStr();

    var row = document.createElement('div');
    row.style.cssText = 'background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px 14px;margin-bottom:8px;';
    row.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">'
      + '<div style="font-size:13px;font-weight:600;color:var(--text-primary);">'+r.user+'</div>'
      + '<div style="font-size:12px;color:var(--text-muted);">'+formatDate(r.date)+' '+r.time+'</div>'
      + '</div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;">'
      + miniStat('Брутто', fmtKg(r.brutto))
      + miniStat('Нетто',  fmtKg(r.netto))
      + miniStat('Отход',  fmtKg(waste) + (isCook() ? '' : ' / '+wastePct+'%'))
      + '</div>';

    // Edit & Delete: admin always, cook only today
    var canEdit   = isAdmin() || (isCook() && isToday);
    var canDelete = canEdit;
    if (canEdit) {
      var btnRow = document.createElement('div');
      btnRow.style.cssText = 'display:flex;gap:10px;margin-top:8px;';
      var editBtn2 = document.createElement('button');
      editBtn2.style.cssText = 'background:none;border:none;color:var(--accent2,#C04F14);font-size:12px;cursor:pointer;font-weight:500;';
      editBtn2.textContent = 'Редактировать';
      (function(rid){
        editBtn2.onclick = function(){ openCuttingForm(rid); };
      })(r._id);
      btnRow.appendChild(editBtn2);
      var delBtn = document.createElement('button');
      delBtn.style.cssText = 'background:none;border:none;color:var(--text-muted);font-size:12px;cursor:pointer;';
      delBtn.textContent = 'Удалить';
      (function(rid){
        delBtn.onclick = function(){ deleteCuttingRecord(rid); };
      })(r._id);
      btnRow.appendChild(delBtn);
      row.appendChild(btnRow);
    }
    list.appendChild(row);
  });
}

function miniStat(label, value) {
  return '<div style="background:var(--surface2);border-radius:6px;padding:6px 8px;">'
    + '<div style="font-size:10px;color:var(--text-muted);margin-bottom:2px;">'+label+'</div>'
    + '<div style="font-size:13px;font-weight:500;color:var(--text-primary);">'+value+'</div>'
    + '</div>';
}

// ============================================================
// ADD / EDIT RECORD FORM
// ============================================================
var _cuttingEditId = null; // null = new record

function openCuttingForm(editId) {
  // Cook can only edit today's records
  if (editId && isCook()) {
    var rec = cuttingRecords[editId];
    if (rec && rec.date !== todayStr()) {
      alert('Повар может редактировать только записи за сегодня');
      return;
    }
  }
  _cuttingEditId = editId || null;

  var sel = document.getElementById('cutting-product-sel');
  sel.innerHTML = '';
  cuttingProducts.forEach(function(p) {
    var opt = document.createElement('option');
    opt.value = opt.textContent = p;
    sel.appendChild(opt);
  });

  // Pre-select current product
  if (cuttingViewProduct) {
    for (var i=0; i<sel.options.length; i++) {
      if (sel.options[i].value===cuttingViewProduct) { sel.selectedIndex=i; break; }
    }
  }

  var titleEl = document.getElementById('cutting-form-title');

  if (_cuttingEditId && cuttingRecords[_cuttingEditId]) {
    var r = cuttingRecords[_cuttingEditId];
    if (titleEl) titleEl.textContent = 'Редактировать';
    document.getElementById('cutting-brutto').value = r.brutto;
    document.getElementById('cutting-netto').value  = r.netto;
    document.getElementById('cutting-waste-input').value = (parseFloat(r.brutto)-parseFloat(r.netto)).toFixed(3);
    for (var j=0; j<sel.options.length; j++) {
      if (sel.options[j].value===r.product) { sel.selectedIndex=j; break; }
    }
    var delRow = document.getElementById('cutting-form-del-row');
    if (delRow) delRow.style.display = 'flex';
  } else {
    if (titleEl) titleEl.textContent = 'Новая запись';
    document.getElementById('cutting-brutto').value = '';
    document.getElementById('cutting-netto').value  = '';
    document.getElementById('cutting-waste-input').value = '';
    var delRow2 = document.getElementById('cutting-form-del-row');
    if (delRow2) delRow2.style.display = 'none';
  }

  // Reset hints
  ['cutting-brutto','cutting-netto','cutting-waste-input'].forEach(function(id){
    var hint = document.getElementById(id+'-hint');
    if (hint) hint.textContent = '';
  });
  document.getElementById('cutting-calc').style.display = 'none';
  document.getElementById('cutting-form-error').textContent = '';
  document.getElementById('cutting-form-error').style.display = 'none';

  document.getElementById('cutting-form-overlay').classList.add('open');
}

function closeCuttingForm() {
  document.getElementById('cutting-form-overlay').classList.remove('open');
  _cuttingEditId = null;
}

// Called on any input change — update hints and validate
function onCuttingInput(field) {
  var bruttoRaw = document.getElementById('cutting-brutto').value;
  var nettoRaw  = document.getElementById('cutting-netto').value;
  var wasteRaw  = document.getElementById('cutting-waste-input').value;

  // Update hints
  if (bruttoRaw) {
    var bh = document.getElementById('cutting-brutto-hint');
    if (bh) bh.textContent = weightHint(bruttoRaw);
  }
  if (nettoRaw) {
    var nh = document.getElementById('cutting-netto-hint');
    if (nh) nh.textContent = weightHint(nettoRaw);
  }
  if (wasteRaw) {
    var wh = document.getElementById('cutting-waste-input-hint');
    if (wh) wh.textContent = weightHint(wasteRaw);
  }

  // Live calculation
  var brutto = parseWeight(bruttoRaw);
  var netto  = parseWeight(nettoRaw);
  var waste  = parseWeight(wasteRaw);
  var calc   = document.getElementById('cutting-calc');
  var errEl  = document.getElementById('cutting-form-error');
  errEl.textContent = ''; errEl.style.display = 'none';

  // Determine which two fields are filled
  var hasBrutto = !isNaN(brutto) && bruttoRaw !== '';
  var hasNetto  = !isNaN(netto)  && nettoRaw  !== '';
  var hasWaste  = !isNaN(waste)  && wasteRaw  !== '';

  if (!hasBrutto) { calc.style.display='none'; return; }

  var computedNetto, computedWaste, pct;

  if (hasBrutto && hasNetto && !hasWaste) {
    // Mode: brutto + netto → compute waste
    computedWaste = brutto - netto;
    if (netto > brutto) {
      errEl.textContent = 'Нетто не может быть больше брутто'; errEl.style.display='block';
      calc.style.display='none'; return;
    }
    pct = brutto>0 ? ((computedWaste/brutto)*100).toFixed(1) : '0.0';
    showCuttingCalc(null, computedWaste, pct);
  } else if (hasBrutto && hasWaste && !hasNetto) {
    // Mode: brutto + waste → compute netto
    computedNetto = brutto - waste;
    if (waste > brutto) {
      errEl.textContent = 'Отход не может быть больше брутто'; errEl.style.display='block';
      calc.style.display='none'; return;
    }
    pct = brutto>0 ? ((waste/brutto)*100).toFixed(1) : '0.0';
    showCuttingCalc(computedNetto, waste, pct);
  } else if (hasBrutto && hasNetto && hasWaste) {
    // All three filled — validate consistency
    var expectedWaste = Math.round((brutto - netto)*1000)/1000;
    var actualWaste   = Math.round(waste*1000)/1000;
    if (Math.abs(expectedWaste - actualWaste) > 0.001) {
      errEl.textContent = 'Ошибка: Брутто − Нетто ≠ Отход. Проверь данные.';
      errEl.style.display = 'block';
      calc.style.display='none'; return;
    }
    computedWaste = waste;
    pct = brutto>0 ? ((waste/brutto)*100).toFixed(1) : '0.0';
    showCuttingCalc(null, computedWaste, pct);
  } else {
    calc.style.display='none';
  }
}

function showCuttingCalc(netto, waste, pct) {
  var calc = document.getElementById('cutting-calc');
  var cols = netto !== null ? '1fr 1fr 1fr' : '1fr 1fr';
  calc.style.display = 'block';
  calc.innerHTML = '<div style="display:grid;grid-template-columns:'+cols+';gap:8px;margin-top:8px;">'
    + (netto!==null ? '<div style="background:var(--surface2);border-radius:8px;padding:10px;text-align:center;"><div style="font-size:11px;color:var(--text-muted);">Нетто</div><div style="font-size:16px;font-weight:700;color:var(--text-primary);">'+fmtKg(netto)+'</div></div>' : '')
    + '<div style="background:var(--surface2);border-radius:8px;padding:10px;text-align:center;"><div style="font-size:11px;color:var(--text-muted);">Отход</div><div style="font-size:16px;font-weight:700;color:#e24b4a;">'+fmtKg(waste)+'</div></div>'
    + '<div style="background:var(--surface2);border-radius:8px;padding:10px;text-align:center;"><div style="font-size:11px;color:var(--text-muted);">%</div><div style="font-size:16px;font-weight:700;color:#e24b4a;">'+pct+'%</div></div>'
    + '</div>';
}

function saveCuttingRecord() {
  var product   = document.getElementById('cutting-product-sel').value;
  var bruttoRaw = document.getElementById('cutting-brutto').value;
  var nettoRaw  = document.getElementById('cutting-netto').value;
  var wasteRaw  = document.getElementById('cutting-waste-input').value;
  var errEl     = document.getElementById('cutting-form-error');

  if (!product) { errEl.textContent='Выбери продукт'; errEl.style.display='block'; return; }

  var brutto = parseWeight(bruttoRaw);
  var netto  = parseWeight(nettoRaw);
  var waste  = parseWeight(wasteRaw);

  if (isNaN(brutto) || brutto<=0) { errEl.textContent='Введи брутто'; errEl.style.display='block'; return; }

  var hasBrutto = true;
  var hasNetto  = !isNaN(netto)  && nettoRaw  !== '';
  var hasWaste  = !isNaN(waste)  && wasteRaw  !== '';

  if (!hasNetto && !hasWaste) { errEl.textContent='Введи нетто или отход'; errEl.style.display='block'; return; }

  var finalNetto, finalWaste;

  if (hasNetto && !hasWaste) {
    if (netto > brutto) { errEl.textContent='Нетто не может быть больше брутто'; errEl.style.display='block'; return; }
    finalNetto = netto;
    finalWaste = brutto - netto;
  } else if (hasWaste && !hasNetto) {
    if (waste > brutto) { errEl.textContent='Отход не может быть больше брутто'; errEl.style.display='block'; return; }
    finalWaste = waste;
    finalNetto = brutto - waste;
  } else {
    // Both filled — validate
    finalNetto = netto; finalWaste = waste;
    var check = Math.round((brutto-netto)*1000)/1000;
    var actual = Math.round(waste*1000)/1000;
    if (Math.abs(check-actual)>0.001) {
      errEl.textContent='Ошибка: Брутто − Нетто ≠ Отход. Проверь данные.';
      errEl.style.display='block'; return;
    }
  }

  var wastePct = brutto>0 ? ((finalWaste/brutto)*100).toFixed(2) : '0';
  var now      = new Date();
  // For edit: preserve original date (admin can edit any day)
  // For new record: always use today
  var dateStr;
  if (_cuttingEditId && cuttingRecords[_cuttingEditId] && isAdmin()) {
    dateStr = cuttingRecords[_cuttingEditId].date; // preserve original date
  } else {
    dateStr = now.getFullYear()+'-'+pad(now.getMonth()+1)+'-'+pad(now.getDate());
  }
  var timeStr  = pad(now.getHours())+':'+pad(now.getMinutes());
  var userName = (typeof currentUser!=='undefined'&&currentUser) ? (currentUser.name||currentUser.login) : 'Неизвестно';

  var record = {
    product:      product,
    brutto:       +brutto.toFixed(3),
    netto:        +finalNetto.toFixed(3),
    waste:        +finalWaste.toFixed(3),
    wastePercent: +parseFloat(wastePct),
    user:         userName,
    date:         dateStr,
    time:         timeStr,
    timestamp:    now.getTime()
  };

  var btn = document.getElementById('cutting-save-btn');
  btn.disabled = true; btn.textContent = '...';
  errEl.textContent = ''; errEl.style.display = 'none';

  if (_cuttingEditId) {
    // Update existing
    cFbSet('/records/'+_cuttingEditId, record).then(function() {
      cuttingRecords[_cuttingEditId] = record;
      btn.disabled=false; btn.textContent='Сохранить';
      closeCuttingForm();
      renderCuttingProductList();
      renderCuttingMain();
    }).catch(function(e) {
      btn.disabled=false; btn.textContent='Сохранить';
      errEl.textContent='Ошибка сохранения. Попробуй снова.'; errEl.style.display='block';
      console.error('Edit error:', e);
    });
  } else {
    // New record — with retry
    cFbPushSafe('/records', record).then(function(res) {
      if (res && res.name) cuttingRecords[res.name] = record;
      btn.disabled=false; btn.textContent='Сохранить';
      closeCuttingForm();
      renderCuttingMain();
      if (cuttingViewProduct===product) renderCuttingProductList();
    }).catch(function(e) {
      btn.disabled=false; btn.textContent='Сохранить';
      errEl.textContent='Ошибка сохранения! Проверь интернет и попробуй снова.';
      errEl.style.display='block';
      console.error('Save error:', e);
    });
  }
}

function deleteCuttingRecord(id) {
  if (!confirm('Удалить запись?')) return;
  cFbDelete('/records/'+id).then(function() {
    delete cuttingRecords[id];
    renderCuttingProductList();
    renderCuttingMain();
  }).catch(function(e) {
    alert('Ошибка удаления. Попробуй снова.');
    console.error('Delete error:', e);
  });
}

function deleteFromForm() {
  if (!_cuttingEditId) return;
  if (!confirm('Удалить эту запись?')) return;
  cFbDelete('/records/'+_cuttingEditId).then(function() {
    delete cuttingRecords[_cuttingEditId];
    closeCuttingForm();
    renderCuttingProductList();
    renderCuttingMain();
  }).catch(function() { alert('Ошибка удаления'); });
}

// ============================================================
// PRODUCTS EDITOR (admin only)
// ============================================================
function openCuttingProductsEditor() {
  if (!isAdmin()) return;
  var list = document.getElementById('cutting-products-list');
  list.innerHTML = '';
  cuttingProducts.forEach(function(p) {
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px;';
    row.innerHTML = '<input type="text" value="'+p+'" style="flex:1;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);padding:8px 10px;font-size:14px;color:var(--text-primary);outline:none;-webkit-user-select:text;user-select:text;">'
      + '<button onclick="this.parentNode.remove()" style="background:none;border:none;color:var(--text-muted);font-size:20px;cursor:pointer;line-height:1;">×</button>';
    list.appendChild(row);
  });
  document.getElementById('cutting-products-overlay').classList.add('open');
}

function closeCuttingProductsEditor() {
  document.getElementById('cutting-products-overlay').classList.remove('open');
}

function addCuttingProduct() {
  var list = document.getElementById('cutting-products-list');
  var row  = document.createElement('div');
  row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px;';
  row.innerHTML = '<input type="text" placeholder="Название продукта" style="flex:1;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);padding:8px 10px;font-size:14px;color:var(--text-primary);outline:none;-webkit-user-select:text;user-select:text;">'
    + '<button onclick="this.parentNode.remove()" style="background:none;border:none;color:var(--text-muted);font-size:20px;cursor:pointer;line-height:1;">×</button>';
  list.appendChild(row);
  row.querySelector('input').focus();
}

function saveCuttingProducts() {
  var inputs   = document.querySelectorAll('#cutting-products-list input');
  var products = [];
  inputs.forEach(function(inp) {
    var val = inp.value.trim();
    if (val && products.indexOf(val)===-1) products.push(val);
  });
  if (!products.length) { alert('Добавь хотя бы один продукт'); return; }
  cuttingProducts = products;
  cFbSet('/products', products).then(function() {
    closeCuttingProductsEditor();
  }).catch(function() { alert('Ошибка сохранения'); });
}

// ============================================================
// EXCEL EXPORT (admin only)
// ============================================================
function exportCuttingExcel() {
  if (!isAdmin()) return;

  var allRec = Object.keys(cuttingRecords).map(function(k){
    return Object.assign({_id:k}, cuttingRecords[k]);
  });
  var records = getFilteredRecords(allRec);
  if (!records.length) { alert('Нет данных для экспорта'); return; }

  // Group by product
  var groups = {};
  records.forEach(function(r) {
    if (!groups[r.product]) groups[r.product] = [];
    groups[r.product].push(r);
  });

  // Load SheetJS and generate xlsx
  function doExport(XLSX) {
    var wb = XLSX.utils.book_new();
    var tag = (cuttingFilterFrom||'') + (cuttingFilterTo&&cuttingFilterTo!==cuttingFilterFrom?'_'+cuttingFilterTo:'');

    Object.keys(groups).forEach(function(product) {
      var rows = groups[product].sort(function(a,b){ return a.timestamp-b.timestamp; });

      // Build sheet data
      var sheetData = [];

      // Period header
      if (cuttingFilterFrom || cuttingFilterTo) {
        var from = cuttingFilterFrom ? formatDate(cuttingFilterFrom) : 'начало';
        var to   = cuttingFilterTo   ? formatDate(cuttingFilterTo)   : 'конец';
        sheetData.push(['Период: ' + from + ' — ' + to]);
        sheetData.push([]);
      }

      // Product header
      sheetData.push(['Продукт: ' + product]);
      sheetData.push([]);

      // Column headers
      sheetData.push(['Повар', 'Дата', 'Время', 'Брутто (кг)', 'Нетто (кг)', 'Отход (кг)', 'Отход (%)']);

      // Data rows
      rows.forEach(function(r) {
        var brutto   = parseFloat(r.brutto) || 0;
        var netto    = parseFloat(r.netto)  || 0;
        var waste    = brutto - netto;
        var wastePct = brutto > 0 ? parseFloat(((waste/brutto)*100).toFixed(2)) : 0;
        sheetData.push([
          r.user,
          formatDate(r.date),
          r.time,
          parseFloat(brutto.toFixed(3)),
          parseFloat(netto.toFixed(3)),
          parseFloat(waste.toFixed(3)),
          wastePct
        ]);
      });

      // Total row
      var totB = rows.reduce(function(s,r){ return s+(parseFloat(r.brutto)||0); }, 0);
      var totN = rows.reduce(function(s,r){ return s+(parseFloat(r.netto) ||0); }, 0);
      var totW = totB - totN;
      var totP = totB > 0 ? parseFloat(((totW/totB)*100).toFixed(2)) : 0;
      sheetData.push(['ИТОГО', '', '',
        parseFloat(totB.toFixed(3)),
        parseFloat(totN.toFixed(3)),
        parseFloat(totW.toFixed(3)),
        totP
      ]);

      // Create worksheet
      var ws = XLSX.utils.aoa_to_sheet(sheetData);

      // Column widths
      ws['!cols'] = [
        {wch: 18}, // Повар
        {wch: 12}, // Дата
        {wch: 8},  // Время
        {wch: 13}, // Брутто
        {wch: 12}, // Нетто
        {wch: 12}, // Отход кг
        {wch: 11}  // Отход %
      ];

      // Sheet name max 31 chars, no special symbols
      var sheetName = product.replace(/[:\/?*\[\]]/g, '').slice(0, 31);
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    });

    // Download
    var filename = 'razdelka' + (tag ? '_' + tag : '') + '.xlsx';
    XLSX.writeFile(wb, filename);
  }

  // Load SheetJS if not already loaded
  if (typeof XLSX !== 'undefined') {
    doExport(XLSX);
  } else {
    var script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    script.onload = function() { doExport(XLSX); };
    script.onerror = function() { alert('Ошибка загрузки библиотеки Excel'); };
    document.head.appendChild(script);
  }
}
