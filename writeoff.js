// writeoff.js — Модуль списания FIKA KITCHEN
// Этап 9 — структура 1-в-1 как cutting.js
// ============================================================

var WRITEOFF_FB = 'https://fika-d21a6-default-rtdb.europe-west1.firebasedatabase.app'
  + (typeof DB_PREFIX !== 'undefined' ? DB_PREFIX : '')
  + '/writeoff';

// Причины по роли
var WRITEOFF_REASONS_COOK  = ['Порча', 'На сотрудника', 'Стаф'];
var WRITEOFF_REASONS_ADMIN = ['Порча', 'На сотрудника', 'Стаф', 'ББК', 'Отработки', 'Фотосессия', 'Бракераж', 'На сотрудника (адм)'];
var REASON_NEEDS_COMMENT   = 'На сотрудника (адм)';

// Яйца — конвертация: 1 шт = 60 г
var EGG_G_PER_PIECE = 60;
var EGG_KEYWORDS    = ['яйцо', 'яйца', 'яиц'];

// Состояние модуля
var writeoffProducts   = []; // доп. продукты из /products (только admin)
var writeoffRecords    = {}; // записи из /records
var writeoffPfNames    = []; // П/Ф из /pf Firebase
var _writeoffEditId    = null;
var writeoffFilterFrom = null;
var writeoffFilterTo   = null;

// ============================================================
// OFFLINE QUEUE — регистрация обработчика
// ============================================================
document.addEventListener('DOMContentLoaded', function() {
  if (typeof OfflineQueue === 'undefined') return;

  OfflineQueue.register('writeoff_record', function(item) {
    return woFbPush('/records', item.data).then(function(res) {
      if (res && res.name) {
        if (item._localId && writeoffRecords[item._localId]) {
          delete writeoffRecords[item._localId];
        }
        writeoffRecords[res.name] = item.data;
      }
    });
  });

  OfflineQueue.onSynced(function(item) {
    if (item.type !== 'writeoff_record') return;
    renderWriteoffMain();
  });
});

// ============================================================
// HELPERS (свои, не ломаем cutting)
// ============================================================
function woPad(n) { return n < 10 ? '0'+n : ''+n; }

function woTodayStr() {
  var n = new Date();
  return n.getFullYear() + '-' + woPad(n.getMonth()+1) + '-' + woPad(n.getDate());
}

function woFormatDate(s) {
  if (!s) return '';
  var p = s.split('-');
  return p[2]+'.'+p[1]+'.'+p[0];
}

function woIsAdmin() {
  return typeof currentUser !== 'undefined' && currentUser && currentUser.role === 'admin';
}

function woIsCook() {
  return typeof currentUser !== 'undefined' && currentUser && currentUser.role === 'cook';
}

function woIsEgg(name) {
  if (!name) return false;
  var low = name.toLowerCase();
  return EGG_KEYWORDS.some(function(k){ return low.indexOf(k) !== -1; });
}

// ============================================================
// FIREBASE HELPERS
// ============================================================
function woFbGet(path) {
  return fetch(WRITEOFF_FB + path + '.json').then(function(r){
    if (!r.ok) throw new Error('HTTP '+r.status);
    return r.json();
  });
}

function woFbSet(path, data) {
  return fetch(WRITEOFF_FB + path + '.json', {
    method: 'PUT',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify(data)
  }).then(function(r){
    if (!r.ok) throw new Error('HTTP '+r.status);
    return r.json();
  });
}

function woFbPush(path, data) {
  return fetch(WRITEOFF_FB + path + '.json', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify(data)
  }).then(function(r){
    if (!r.ok) throw new Error('HTTP '+r.status);
    return r.json();
  });
}

function woFbDelete(path) {
  return fetch(WRITEOFF_FB + path + '.json', {method:'DELETE'})
    .then(function(r){ return r.json(); });
}

function woFbPushSafe(path, data, retries) {
  retries = retries || 3;
  return woFbPush(path, data).catch(function(e) {
    if (retries > 1) {
      return new Promise(function(res){ setTimeout(res, 1000); })
        .then(function(){ return woFbPushSafe(path, data, retries-1); });
    }
    throw e;
  });
}

// ============================================================
// LOAD DATA
// ============================================================
function loadWriteoff() {
  // Загружаем /writeoff и /pf параллельно
  var fbBase = 'https://fika-d21a6-default-rtdb.europe-west1.firebasedatabase.app'
    + (typeof DB_PREFIX !== 'undefined' ? DB_PREFIX : '');

  var woPromise  = woFbGet('').catch(function(){ return null; });
  var pfPromise  = fetch(fbBase + '/pf.json').then(function(r){ return r.json(); }).catch(function(){ return null; });

  Promise.all([woPromise, pfPromise]).then(function(results) {
    var woData = results[0] || {};
    var pfData = results[1] || {};

    // Доп. продукты (admin-only список из /writeoff/products)
    writeoffProducts = (woData.products && Array.isArray(woData.products))
      ? woData.products : [];

    // Записи
    writeoffRecords = (woData.records && typeof woData.records === 'object')
      ? woData.records : {};

    // Собираем П/Ф из /pf — берём все названия позиций из всех цехов
    writeoffPfNames = [];
    Object.keys(pfData).forEach(function(zone) {
      var zoneItems = pfData[zone];
      if (!zoneItems || typeof zoneItems !== 'object') return;
      var arr = Array.isArray(zoneItems) ? zoneItems : Object.values(zoneItems);
      arr.forEach(function(item) {
        if (item && item.name && !item._empty) {
          if (writeoffPfNames.indexOf(item.name) === -1) {
            writeoffPfNames.push(item.name);
          }
        }
      });
    });
    writeoffPfNames.sort();

    renderWriteoffScreen();
  }).catch(function(e) {
    console.error('loadWriteoff error:', e);
    writeoffRecords = {};
    renderWriteoffScreen();
  });
}

// ============================================================
// OPEN WRITEOFF
// ============================================================
function openWriteoff() {
  // Проверяем право доступа к модулю списания
  if (typeof hasPermission === 'function' && !hasPermission('writeOff')) return;
  _writeoffEditId = null;
  var today = woTodayStr();
  writeoffFilterFrom = today;
  writeoffFilterTo   = today;
  // Инициализируем текстовое поле
  var rangeInp = document.getElementById('wo-filter-range');
  if (rangeInp) rangeInp.value = woFormatDate(today);
  // Показываем фиксированную кнопку
  var addBtn = document.getElementById('wo-add-btn-wrap');
  if (addBtn) addBtn.style.display = 'block';
  goTo('writeoff');
  loadWriteoff();
}

// ============================================================
// FILTER LOGIC
// ============================================================
function getWriteoffFilteredRecords(allRecords) {
  return allRecords.filter(function(r) {
    if (writeoffFilterFrom && r.date < writeoffFilterFrom) return false;
    if (writeoffFilterTo   && r.date > writeoffFilterTo)   return false;
    return true;
  });
}

function applyWriteoffFilter() {
  // Читаем единое поле диапазона
  var rangeInp = document.getElementById('wo-filter-range');
  if (!rangeInp) return;
  var val = rangeInp.value; // формат: "YYYY-MM-DD / YYYY-MM-DD" или "YYYY-MM-DD"
  if (!val) { writeoffFilterFrom = null; writeoffFilterTo = null; }
  else if (val.indexOf(' / ') !== -1) {
    var parts = val.split(' / ');
    writeoffFilterFrom = parts[0] || null;
    writeoffFilterTo   = parts[1] || null;
  } else {
    writeoffFilterFrom = val;
    writeoffFilterTo   = val;
  }
  renderWriteoffMain();
}

function resetWriteoffFilter() {
  var today = woTodayStr();
  writeoffFilterFrom = today;
  writeoffFilterTo   = today;
  var rangeInp = document.getElementById('wo-filter-range');
  if (rangeInp) rangeInp.value = woFormatDate(today);
  _woClosePicker();
  renderWriteoffMain();
}

// ============================================================
// RENDER SCREEN
// ============================================================
function renderWriteoffScreen() {
  var rangeInp  = document.getElementById('wo-filter-range');
  var exportBtn = document.getElementById('wo-export-btn');
  var editBtn   = document.getElementById('wo-edit-products-btn');
  var today     = woTodayStr();

  if (woIsCook()) {
    // Повар: только сегодня, поле заблокировано
    writeoffFilterFrom = today;
    writeoffFilterTo   = today;
    if (rangeInp) { rangeInp.value = today; rangeInp.disabled = true; }
    if (exportBtn) exportBtn.style.display = 'none';
    if (editBtn) {
      // Повар с правом editRaw может редактировать список продуктов списания
      editBtn.style.display = (typeof hasPermission === 'function' && hasPermission('editRaw')) ? 'flex' : 'none';
    }
  } else {
    // Admin: свободный выбор диапазона
    if (rangeInp) {
      rangeInp.disabled = false;
      if (!rangeInp.value) {
        rangeInp.value = (writeoffFilterFrom || today)
          + (writeoffFilterTo && writeoffFilterTo !== (writeoffFilterFrom || today)
              ? ' / ' + writeoffFilterTo : '');
      }
    }
    if (exportBtn) exportBtn.style.display = 'flex';
    if (editBtn)   editBtn.style.display   = woIsAdmin() ? 'flex' : 'none';
  }

  renderWriteoffMain();
}

// ============================================================
// RENDER MAIN — группировка по причине, внутри по продукту
// ============================================================
function renderWriteoffMain() {
  var container = document.getElementById('wo-summary');
  if (!container) return;

  var allRec = Object.keys(writeoffRecords).map(function(k){
    return Object.assign({_id:k}, writeoffRecords[k]);
  });
  var records = getWriteoffFilteredRecords(allRec);

  container.innerHTML = '';

  if (!records.length) {
    container.innerHTML = '<div style="text-align:center;padding:40px 0;color:var(--text-muted);font-size:14px;">Нет записей за выбранный период</div>';
    return;
  }

  // Группируем: reason → product → [{...}]
  var byReason = {};
  records.forEach(function(r) {
    var reason = r.reason || 'Без причины';
    if (!byReason[reason]) byReason[reason] = {};
    var prod = r.name || 'Неизвестно';
    if (!byReason[reason][prod]) byReason[reason][prod] = [];
    byReason[reason][prod].push(r);
  });

  var reasonOrder = WRITEOFF_REASONS_ADMIN.slice();
  var sortedReasons = Object.keys(byReason).sort(function(a, b) {
    var ia = reasonOrder.indexOf(a), ib = reasonOrder.indexOf(b);
    if (ia === -1) ia = 999; if (ib === -1) ib = 999;
    return ia - ib;
  });

  sortedReasons.forEach(function(reason) {
    // Заголовок причины
    var reasonHeader = document.createElement('div');
    reasonHeader.style.cssText = 'font-family:Syne,sans-serif;font-size:13px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin:16px 0 8px;padding-bottom:4px;border-bottom:1px solid var(--border);';
    reasonHeader.textContent = reason;
    container.appendChild(reasonHeader);

    var products = byReason[reason];
    Object.keys(products).sort().forEach(function(prod) {
      var rows = products[prod];

      // Считаем итого по продукту
      var totalQty = 0;
      var unit = rows[0].unit || '';
      var isPortions = unit === 'порц';
      var isEgg = woIsEgg(prod);

      rows.forEach(function(r) {
        totalQty += parseFloat(r.amount) || 0;
      });

      // Карточка продукта
      var card = document.createElement('div');
      card.style.cssText = 'background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px;margin-bottom:10px;cursor:pointer;';

      var totalStr = isPortions
        ? totalQty + ' порц.'
        : (isEgg && unit === 'шт'
            ? totalQty + ' шт ≈ ' + (totalQty * EGG_G_PER_PIECE / 1000).toFixed(2) + ' кг'
            : _woFmtWeight(totalQty, unit));

      card.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">'
        + '<div style="font-family:Syne,sans-serif;font-size:17px;font-weight:700;color:var(--text-primary);">' + prod + '</div>'
        + '<div style="font-size:12px;color:var(--text-muted);">' + rows.length + ' ' + _woPlural(rows.length, 'запись', 'записи', 'записей') + '</div>'
        + '</div>'
        + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">'
        + woStatBox('Кол-во', totalStr)
        + woStatBox('Ед.', unit)
        + '</div>';

      // Детали при клике
      (function(reason, prod, rows) {
        card.onclick = function() { openWriteoffDetail(reason, prod, rows); };
      })(reason, prod, rows);

      container.appendChild(card);
    });
  });
}

function woStatBox(label, value) {
  return '<div style="background:var(--surface2);border-radius:8px;padding:8px 10px;">'
    + '<div style="font-size:10px;color:var(--text-muted);font-weight:500;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">' + label + '</div>'
    + '<div style="font-size:14px;font-weight:600;color:var(--text-primary);">' + value + '</div>'
    + '</div>';
}

function _woPlural(n, one, two, five) {
  var m10=n%10, m100=n%100;
  if (m100>=11&&m100<=19) return five;
  if (m10===1) return one;
  if (m10>=2&&m10<=4) return two;
  return five;
}

function _woFmtWeight(val, unit) {
  var v = parseFloat(val) || 0;
  if (unit === 'г') {
    return v >= 1000 ? (v/1000).toFixed(2) + ' кг' : v + ' г';
  }
  if (unit === 'кг') {
    return v.toFixed(3) + ' кг';
  }
  return v + (unit ? ' ' + unit : '');
}

// ============================================================
// DETAIL VIEW — записи по продукту+причине
// ============================================================
function openWriteoffDetail(reason, product, rows) {
  document.getElementById('wo-detail-title').textContent = product;
  _renderWriteoffDetailList(reason, product, rows);
  // Скрываем фиксированную кнопку на экране деталей
  var addBtn = document.getElementById('wo-add-btn-wrap');
  if (addBtn) addBtn.style.display = 'none';
  goTo('writeoff-detail');
}

function _renderWriteoffDetailList(reason, product, rows) {
  var list = document.getElementById('wo-detail-list');
  if (!list) return;

  // Актуальные данные из writeoffRecords (не переданный snapshot)
  var today = woTodayStr();
  var allRec = Object.keys(writeoffRecords)
    .map(function(k){ return Object.assign({_id:k}, writeoffRecords[k]); })
    .filter(function(r){ return r.name === product && r.reason === reason; });

  if (woIsCook()) {
    allRec = allRec.filter(function(r){ return r.date === today; });
  }
  var records = getWriteoffFilteredRecords(allRec);
  records.sort(function(a,b){ return b.timestamp - a.timestamp; });

  list.innerHTML = '';
  if (!records.length) {
    list.innerHTML = '<div style="text-align:center;padding:40px 0;color:var(--text-muted);font-size:14px;">Нет записей</div>';
    return;
  }

  records.forEach(function(r) {
    var isToday  = r.date === today;
    var canEdit  = woIsAdmin()
      || (woIsCook() && isToday && r.user === _woCurrentName())
      || (typeof hasPermission === 'function' && hasPermission('writeOff') && isToday && r.user === _woCurrentName());
    var isEgg    = woIsEgg(r.name || '');
    var amtStr   = r.unit === 'порц'
      ? (r.amount + ' порц.')
      : (isEgg && r.unit === 'шт'
          ? r.amount + ' шт ≈ ' + (r.amount * EGG_G_PER_PIECE / 1000).toFixed(2) + ' кг'
          : _woFmtWeight(r.amount, r.unit));

    var row = document.createElement('div');
    row.style.cssText = 'background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px 14px;margin-bottom:8px;';

    var commentHtml = r.comment
      ? '<div style="font-size:12px;color:var(--text-muted);margin-top:6px;font-style:italic;">💬 ' + r.comment + '</div>'
      : '';

    row.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">'
      + '<div style="font-size:13px;font-weight:600;color:var(--text-primary);">' + (r.user || '') + '</div>'
      + '<div style="font-size:12px;color:var(--text-muted);">' + woFormatDate(r.date) + ' ' + (r.time || '') + '</div>'
      + '</div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">'
      + woMiniStat('Количество', amtStr)
      + woMiniStat('Причина', r.reason || '')
      + '</div>'
      + commentHtml;

    if (canEdit) {
      var btnRow = document.createElement('div');
      btnRow.style.cssText = 'display:flex;gap:10px;margin-top:8px;';

      var editBtn = document.createElement('button');
      editBtn.style.cssText = 'background:none;border:none;color:var(--accent2,#C04F14);font-size:12px;cursor:pointer;font-weight:500;';
      editBtn.textContent = 'Редактировать';
      (function(rid){ editBtn.onclick = function(){ openWriteoffForm(rid); }; })(r._id);
      btnRow.appendChild(editBtn);

      var delBtn = document.createElement('button');
      delBtn.style.cssText = 'background:none;border:none;color:var(--text-muted);font-size:12px;cursor:pointer;';
      delBtn.textContent = 'Удалить';
      (function(rid){ delBtn.onclick = function(){ deleteWriteoffRecord(rid); }; })(r._id);
      btnRow.appendChild(delBtn);

      row.appendChild(btnRow);
    }
    list.appendChild(row);
  });
}

function woMiniStat(label, value) {
  return '<div style="background:var(--surface2);border-radius:6px;padding:6px 8px;">'
    + '<div style="font-size:10px;color:var(--text-muted);margin-bottom:2px;">' + label + '</div>'
    + '<div style="font-size:13px;font-weight:500;color:var(--text-primary);">' + value + '</div>'
    + '</div>';
}

function _woCurrentName() {
  return (typeof currentUser !== 'undefined' && currentUser)
    ? (currentUser.name || currentUser.login) : '';
}

function deleteWriteoffRecord(id) {
  if (!confirm('Удалить запись?')) return;
  woFbDelete('/records/' + id).then(function() {
    delete writeoffRecords[id];
    goTo('writeoff');
    renderWriteoffMain();
  }).catch(function(e) {
    alert('Ошибка удаления. Попробуй снова.');
    console.error('WO delete error:', e);
  });
}

// ============================================================
// FORM — открыть/закрыть
// ============================================================
function openWriteoffForm(editId) {
  if (editId && woIsCook()) {
    var rec = writeoffRecords[editId];
    if (rec && rec.date !== woTodayStr()) {
      alert('Повар может редактировать только записи за сегодня');
      return;
    }
  }
  _writeoffEditId = editId || null;

  // Сбрасываем форму
  var titleEl = document.getElementById('wo-form-title');
  if (titleEl) titleEl.textContent = _writeoffEditId ? 'Редактировать' : 'Новое списание';

  _buildWriteoffProductList();
  _buildWriteoffReasons();

  // Сбрасываем поля
  var nameInput  = document.getElementById('wo-name-input');
  var searchInp  = document.getElementById('wo-product-search');
  var amountInp  = document.getElementById('wo-amount');
  var unitSel    = document.getElementById('wo-unit');
  var commentWr  = document.getElementById('wo-comment-wrap');
  var commentInp = document.getElementById('wo-comment');
  var errEl      = document.getElementById('wo-form-error');
  var delRow     = document.getElementById('wo-form-del-row');

  if (searchInp)  searchInp.value  = '';
  if (nameInput)  nameInput.value  = '';
  if (amountInp)  amountInp.value  = '';
  if (errEl)      { errEl.textContent = ''; errEl.style.display = 'none'; }
  if (commentInp) commentInp.value  = '';
  if (commentWr)  commentWr.style.display = 'none';

  _woShowProductDropdown(false);
  _woSelectedProduct = null;

  if (_writeoffEditId && writeoffRecords[_writeoffEditId]) {
    var r = writeoffRecords[_writeoffEditId];
    _woSelectedProduct = { name: r.name, type: r.type };
    if (searchInp) searchInp.value = r.name;
    if (amountInp) amountInp.value = r.amount;
    _woSetUnit(r.name, r.unit);
    _woSelectReason(r.reason);
    if (r.comment && commentInp) {
      commentInp.value = r.comment;
      if (commentWr) commentWr.style.display = 'block';
    }
    if (delRow) delRow.style.display = 'flex';
  } else {
    _woSetUnit('', 'кг');
    if (delRow) delRow.style.display = 'none';
  }

  document.getElementById('wo-form-overlay').classList.add('open');
}

function closeWriteoffForm() {
  document.getElementById('wo-form-overlay').classList.remove('open');
  _writeoffEditId = null;
  _woSelectedProduct = null;
}

// ============================================================
// FORM INTERNALS — поиск продукта, единицы, причины
// ============================================================
var _woSelectedProduct = null; // {name, type: 'dish'|'pf'|'custom'|'free'}

function _buildWriteoffProductList() {
  // Собираем все источники
  var allItems = [];

  // 1. Блюда из DISHES
  if (typeof DISHES !== 'undefined') {
    Object.keys(DISHES).forEach(function(sec) {
      var arr = DISHES[sec];
      if (!Array.isArray(arr)) return;
      arr.forEach(function(d) {
        if (d && d.name) allItems.push({ name: d.name, type: 'dish', group: 'Блюда' });
      });
    });
  }

  // 2. П/Ф из Firebase /pf
  writeoffPfNames.forEach(function(name) {
    allItems.push({ name: name, type: 'pf', group: 'П/Ф и сырьё' });
  });

  // 3. Доп. продукты admin-списка
  writeoffProducts.forEach(function(name) {
    allItems.push({ name: name, type: 'custom', group: 'Дополнительно' });
  });

  // Сохраняем для поиска
  document.getElementById('wo-product-search')._allItems = allItems;
}

function onWriteoffSearch() {
  var inp   = document.getElementById('wo-product-search');
  var query = inp.value.trim().toLowerCase();
  var items = inp._allItems || [];

  if (!query) {
    _woShowProductDropdown(false);
    _woSelectedProduct = null;
    _woSetUnit('', 'кг');
    return;
  }

  var filtered = items.filter(function(i){ return i.name.toLowerCase().indexOf(query) !== -1; });

  // Свободный ввод — только admin
  var freeItem = null;
  if (woIsAdmin()) {
    freeItem = { name: inp.value.trim(), type: 'free', group: 'Свободный ввод' };
  }

  _woRenderDropdown(filtered, freeItem, inp.value.trim());
}

function _woRenderDropdown(items, freeItem, rawInput) {
  var dd = document.getElementById('wo-product-dropdown');
  dd.innerHTML = '';

  if (!items.length && !freeItem) {
    _woShowProductDropdown(false);
    return;
  }

  // Группируем
  var groups = {};
  items.forEach(function(i) {
    if (!groups[i.group]) groups[i.group] = [];
    groups[i.group].push(i);
  });

  Object.keys(groups).forEach(function(group) {
    var grpDiv = document.createElement('div');
    grpDiv.style.cssText = 'font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;padding:6px 12px 2px;font-weight:600;';
    grpDiv.textContent = group;
    dd.appendChild(grpDiv);

    groups[group].forEach(function(item) {
      var opt = document.createElement('div');
      opt.style.cssText = 'padding:10px 12px;font-size:14px;color:var(--text-primary);cursor:pointer;border-radius:6px;';
      opt.textContent = item.name;
      opt.onmouseover = function(){ opt.style.background = 'var(--surface2)'; };
      opt.onmouseout  = function(){ opt.style.background = ''; };
      (function(it){
        opt.onclick = function(){ _woSelectProduct(it); };
      })(item);
      dd.appendChild(opt);
    });
  });

  // Свободный ввод
  if (freeItem && rawInput) {
    var grpDiv2 = document.createElement('div');
    grpDiv2.style.cssText = 'font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;padding:6px 12px 2px;font-weight:600;';
    grpDiv2.textContent = 'Свободный ввод';
    dd.appendChild(grpDiv2);

    var freeOpt = document.createElement('div');
    freeOpt.style.cssText = 'padding:10px 12px;font-size:14px;color:var(--accent2,#C04F14);cursor:pointer;border-radius:6px;';
    freeOpt.textContent = '+ "' + rawInput + '"';
    freeOpt.onmouseover = function(){ freeOpt.style.background = 'var(--surface2)'; };
    freeOpt.onmouseout  = function(){ freeOpt.style.background = ''; };
    var fi = { name: rawInput, type: 'free', group: 'Свободный ввод' };
    freeOpt.onclick = function(){ _woSelectProduct(fi); };
    dd.appendChild(freeOpt);
  }

  _woShowProductDropdown(true);
}

function _woSelectProduct(item) {
  _woSelectedProduct = item;
  document.getElementById('wo-product-search').value = item.name;
  _woShowProductDropdown(false);
  _woSetUnit(item.name, null);

  // Обновляем плейсхолдер количества
  var amtInp = document.getElementById('wo-amount');
  if (amtInp) {
    if (item.type === 'dish') {
      amtInp.placeholder = '1, 2, 3...';
    } else if (woIsEgg(item.name)) {
      amtInp.placeholder = 'Введи количество';
    } else {
      amtInp.placeholder = '1.5 или 1500';
    }
  }
}

function _woShowProductDropdown(show) {
  var dd = document.getElementById('wo-product-dropdown');
  if (dd) dd.style.display = show ? 'block' : 'none';
}

function _woSetUnit(name, forceUnit) {
  var unitSel = document.getElementById('wo-unit');
  if (!unitSel) return;
  unitSel.innerHTML = '';

  var units;
  if (!name && !forceUnit) {
    units = ['кг', 'г'];
  } else if (_woSelectedProduct && _woSelectedProduct.type === 'dish') {
    units = ['порц'];
  } else if (woIsEgg(name)) {
    units = ['шт', 'кг', 'г'];
  } else {
    units = ['кг', 'г'];
  }

  units.forEach(function(u) {
    var opt = document.createElement('option');
    opt.value = opt.textContent = u;
    if (forceUnit && u === forceUnit) opt.selected = true;
    unitSel.appendChild(opt);
  });
}

function _buildWriteoffReasons() {
  var cont = document.getElementById('wo-reasons');
  if (!cont) return;
  cont.innerHTML = '';
  var reasons = woIsAdmin() ? WRITEOFF_REASONS_ADMIN : WRITEOFF_REASONS_COOK;
  reasons.forEach(function(r, i) {
    var btn = document.createElement('button');
    btn.className = 'wo-reason-btn';
    btn.textContent = r;
    btn.dataset.reason = r;
    btn.style.cssText = 'background:var(--surface2);border:1px solid var(--border);border-radius:20px;padding:7px 14px;font-size:13px;color:var(--text-primary);cursor:pointer;font-family:inherit;white-space:nowrap;';
    if (i === 0) _woSelectReasonBtn(btn);
    btn.onclick = function() {
      _woSelectReasonBtn(btn);
      _woCheckCommentRequired();
    };
    cont.appendChild(btn);
  });
}

function _woSelectReason(reason) {
  var btns = document.querySelectorAll('#wo-reasons .wo-reason-btn');
  btns.forEach(function(b) {
    if (b.dataset.reason === reason) _woSelectReasonBtn(b);
  });
  _woCheckCommentRequired();
}

function _woSelectReasonBtn(activeBtn) {
  var btns = document.querySelectorAll('#wo-reasons .wo-reason-btn');
  btns.forEach(function(b) {
    b.style.background = 'var(--surface2)';
    b.style.color = 'var(--text-primary)';
    b.style.borderColor = 'var(--border)';
    b.style.fontWeight = '400';
  });
  activeBtn.style.background = 'var(--accent2,#C04F14)';
  activeBtn.style.color = '#fff';
  activeBtn.style.borderColor = 'transparent';
  activeBtn.style.fontWeight = '600';
}

function _woGetSelectedReason() {
  var active = document.querySelector('#wo-reasons .wo-reason-btn[style*="rgb(192"]')
    || document.querySelector('#wo-reasons .wo-reason-btn[style*="#C04F14"]');
  // fallback: ищем по цвету фона
  var btns = document.querySelectorAll('#wo-reasons .wo-reason-btn');
  for (var i = 0; i < btns.length; i++) {
    if (btns[i].style.background.indexOf('C04F14') !== -1 ||
        btns[i].style.background.indexOf('192') !== -1) {
      return btns[i].dataset.reason;
    }
    // альтернатива через data-selected
    if (btns[i].dataset.selected === '1') return btns[i].dataset.reason;
  }
  // fallback: первая кнопка
  return btns.length ? btns[0].dataset.reason : '';
}

// Переписываем логику выбора через data-selected для надёжности
function _woSelectReasonBtnV2(activeBtn) {
  var btns = document.querySelectorAll('#wo-reasons .wo-reason-btn');
  btns.forEach(function(b) {
    b.dataset.selected = '0';
    b.style.background = 'var(--surface2)';
    b.style.color = 'var(--text-primary)';
    b.style.borderColor = 'var(--border)';
    b.style.fontWeight = '400';
  });
  activeBtn.dataset.selected = '1';
  activeBtn.style.background = 'var(--accent2,#C04F14)';
  activeBtn.style.color = '#fff';
  activeBtn.style.borderColor = 'transparent';
  activeBtn.style.fontWeight = '600';
}

// Переинициализируем _buildWriteoffReasons с надёжным выбором
function _buildWriteoffReasonsV2() {
  var cont = document.getElementById('wo-reasons');
  if (!cont) return;
  cont.innerHTML = '';
  var reasons = woIsAdmin() ? WRITEOFF_REASONS_ADMIN : WRITEOFF_REASONS_COOK;
  reasons.forEach(function(r, i) {
    var btn = document.createElement('button');
    btn.className = 'wo-reason-btn';
    btn.textContent = r;
    btn.dataset.reason = r;
    btn.dataset.selected = i === 0 ? '1' : '0';
    btn.style.cssText = [
      'border-radius:20px',
      'padding:7px 14px',
      'font-size:13px',
      'cursor:pointer',
      'font-family:inherit',
      'white-space:nowrap',
      i === 0
        ? 'background:var(--accent2,#C04F14);color:#fff;border:1px solid transparent;font-weight:600;'
        : 'background:var(--surface2);color:var(--text-primary);border:1px solid var(--border);font-weight:400;'
    ].join(';');
    btn.onclick = function() {
      _woSelectReasonBtnV2(btn);
      _woCheckCommentRequired();
    };
    cont.appendChild(btn);
  });
}

function _woGetSelectedReasonV2() {
  var btns = document.querySelectorAll('#wo-reasons .wo-reason-btn');
  for (var i = 0; i < btns.length; i++) {
    if (btns[i].dataset.selected === '1') return btns[i].dataset.reason;
  }
  return btns.length ? btns[0].dataset.reason : '';
}

function _woCheckCommentRequired() {
  var reason = _woGetSelectedReasonV2();
  var wrap   = document.getElementById('wo-comment-wrap');
  if (!wrap) return;
  wrap.style.display = (reason === REASON_NEEDS_COMMENT) ? 'block' : 'none';
  var lbl = wrap.querySelector('label');
  if (lbl) lbl.textContent = 'Комментарий' + (reason === REASON_NEEDS_COMMENT ? ' *' : '');
}

// Переопределяем _buildWriteoffReasons
function _buildWriteoffReasons() { _buildWriteoffReasonsV2(); }
function _woGetSelectedReason()  { return _woGetSelectedReasonV2(); }
function _woSelectReason(reason) {
  var btns = document.querySelectorAll('#wo-reasons .wo-reason-btn');
  btns.forEach(function(b) {
    b.dataset.selected = (b.dataset.reason === reason) ? '1' : '0';
    if (b.dataset.reason === reason) _woSelectReasonBtnV2(b);
  });
  _woCheckCommentRequired();
}

// ============================================================
// SAVE RECORD
// ============================================================
function saveWriteoffRecord() {
  var searchInp  = document.getElementById('wo-product-search');
  var amountInp  = document.getElementById('wo-amount');
  var unitSel    = document.getElementById('wo-unit');
  var commentInp = document.getElementById('wo-comment');
  var errEl      = document.getElementById('wo-form-error');
  var btn        = document.getElementById('wo-save-btn');

  errEl.textContent = ''; errEl.style.display = 'none';

  // Валидация продукта
  var productName = searchInp ? searchInp.value.trim() : '';
  if (!productName) {
    errEl.textContent = 'Выбери или введи продукт'; errEl.style.display = 'block'; return;
  }

  // Если не выбрали из dropdown — создаём как free (только admin)
  if (!_woSelectedProduct) {
    if (!woIsAdmin()) {
      errEl.textContent = 'Выбери продукт из списка'; errEl.style.display = 'block'; return;
    }
    _woSelectedProduct = { name: productName, type: 'free' };
  }

  // Валидация количества
  var amountRaw = amountInp ? amountInp.value.trim().replace(',', '.') : '';
  var amount    = parseFloat(amountRaw);
  if (!amountRaw || isNaN(amount) || amount <= 0) {
    errEl.textContent = 'Введи количество'; errEl.style.display = 'block'; return;
  }

  var unit = unitSel ? unitSel.value : 'кг';

  // Умный парсер веса (как в разделке): >100 = граммы
  if (unit !== 'порц' && unit !== 'шт') {
    if (amount > 100) {
      amount = amount / 1000;
      unit = 'кг';
    }
  }

  // Яйца — если шт, сохраняем и шт и кг-эквивалент
  var eggKg = null;
  if (woIsEgg(productName) && unit === 'шт') {
    eggKg = +(amount * EGG_G_PER_PIECE / 1000).toFixed(3);
  }

  // Причина
  var reason = _woGetSelectedReasonV2();
  if (!reason) { errEl.textContent = 'Выбери причину'; errEl.style.display = 'block'; return; }

  // Комментарий (обязателен для «На сотрудника (адм)»)
  var comment = commentInp ? commentInp.value.trim() : '';
  if (reason === REASON_NEEDS_COMMENT && !comment) {
    errEl.textContent = 'Для этой причины обязателен комментарий'; errEl.style.display = 'block'; return;
  }

  var now      = new Date();
  var today    = woTodayStr();
  // Дата записи: для admin — из выбранного диапазона (начало), для повара — всегда сегодня
  var dateStr;
  if (_writeoffEditId && writeoffRecords[_writeoffEditId] && woIsAdmin()) {
    dateStr = writeoffRecords[_writeoffEditId].date; // при редактировании — сохраняем оригинал
  } else if (woIsAdmin() && writeoffFilterFrom) {
    dateStr = writeoffFilterFrom; // admin: дата = начало выбранного диапазона
  } else {
    dateStr = today; // повар: всегда сегодня
  }
  var timeStr  = woPad(now.getHours()) + ':' + woPad(now.getMinutes());
  var userName = _woCurrentName();

  var record = {
    type:      _woSelectedProduct.type,
    name:      productName,
    amount:    +amount.toFixed(3),
    unit:      unit,
    reason:    reason,
    comment:   comment || null,
    user:      userName,
    date:      dateStr,
    time:      timeStr,
    timestamp: now.getTime()
  };
  if (eggKg !== null) record.eggKg = eggKg;

  btn.disabled = true; btn.textContent = '...';

  if (_writeoffEditId) {
    // Редактирование
    woFbSet('/records/' + _writeoffEditId, record).then(function() {
      writeoffRecords[_writeoffEditId] = record;
      btn.disabled = false; btn.textContent = 'Сохранить';
      closeWriteoffForm();
      renderWriteoffMain();
      goTo('writeoff');
    }).catch(function(e) {
      btn.disabled = false; btn.textContent = 'Сохранить';
      errEl.textContent = 'Ошибка сохранения. Попробуй снова.'; errEl.style.display = 'block';
      console.error('WO edit error:', e);
    });
  } else {
    // Новая запись
    if (!navigator.onLine && typeof OfflineQueue !== 'undefined') {
      var localId = OfflineQueue.enqueue({ type: 'writeoff_record', data: record });
      writeoffRecords[localId] = Object.assign({}, record, { _pending: true });
      btn.disabled = false; btn.textContent = 'Сохранить';
      closeWriteoffForm();
      renderWriteoffMain();
      _showWriteoffToast('Нет сети — запись сохранена и отправится автоматически');
    } else {
      woFbPushSafe('/records', record).then(function(res) {
        if (res && res.name) writeoffRecords[res.name] = record;
        btn.disabled = false; btn.textContent = 'Сохранить';
        closeWriteoffForm();
        renderWriteoffMain();
      }).catch(function(e) {
        if (typeof OfflineQueue !== 'undefined') {
          var localId2 = OfflineQueue.enqueue({ type: 'writeoff_record', data: record });
          writeoffRecords[localId2] = Object.assign({}, record, { _pending: true });
          btn.disabled = false; btn.textContent = 'Сохранить';
          closeWriteoffForm();
          renderWriteoffMain();
          _showWriteoffToast('Ошибка сети — запись сохранена и отправится автоматически');
        } else {
          btn.disabled = false; btn.textContent = 'Сохранить';
          errEl.textContent = 'Ошибка сохранения! Проверь интернет.'; errEl.style.display = 'block';
          console.error('WO save error:', e);
        }
      });
    }
  }
}

function deleteWriteoffFromForm() {
  if (!_writeoffEditId) return;
  if (!confirm('Удалить эту запись?')) return;
  woFbDelete('/records/' + _writeoffEditId).then(function() {
    delete writeoffRecords[_writeoffEditId];
    closeWriteoffForm();
    renderWriteoffMain();
    goTo('writeoff');
  }).catch(function() { alert('Ошибка удаления'); });
}

// ============================================================
// PRODUCTS EDITOR (admin only — доп. продукты для свободного ввода)
// ============================================================
function openWriteoffProductsEditor() {
  if (!woIsAdmin()) return;
  var list = document.getElementById('wo-products-list');
  list.innerHTML = '';
  writeoffProducts.forEach(function(p) {
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px;';
    row.innerHTML = '<input type="text" value="' + p + '" style="flex:1;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);padding:8px 10px;font-size:14px;color:var(--text-primary);outline:none;-webkit-user-select:text;user-select:text;">'
      + '<button onclick="this.parentNode.remove()" style="background:none;border:none;color:var(--text-muted);font-size:20px;cursor:pointer;line-height:1;">×</button>';
    list.appendChild(row);
  });
  document.getElementById('wo-products-overlay').classList.add('open');
}

function closeWriteoffProductsEditor() {
  document.getElementById('wo-products-overlay').classList.remove('open');
}

function addWriteoffProduct() {
  var list = document.getElementById('wo-products-list');
  var row  = document.createElement('div');
  row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px;';
  row.innerHTML = '<input type="text" placeholder="Название продукта" style="flex:1;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);padding:8px 10px;font-size:14px;color:var(--text-primary);outline:none;-webkit-user-select:text;user-select:text;">'
    + '<button onclick="this.parentNode.remove()" style="background:none;border:none;color:var(--text-muted);font-size:20px;cursor:pointer;line-height:1;">×</button>';
  list.appendChild(row);
  row.querySelector('input').focus();
}

function saveWriteoffProducts() {
  var inputs   = document.querySelectorAll('#wo-products-list input');
  var products = [];
  inputs.forEach(function(inp) {
    var val = inp.value.trim();
    if (val && products.indexOf(val) === -1) products.push(val);
  });
  writeoffProducts = products;
  woFbSet('/products', products.length ? products : null).then(function() {
    closeWriteoffProductsEditor();
  }).catch(function() { alert('Ошибка сохранения'); });
}

// ============================================================
// ============================================================
// DATE RANGE PICKER — inline, без библиотек
// ============================================================
var _woPickerStep  = 0;   // 0 = выбор начала, 1 = выбор конца
var _woPickerFrom  = null; // 'YYYY-MM-DD'
var _woPickerTo    = null;
var _woPickerMonth = null; // текущий месяц в пикере (Date)

function openWoDatePicker() {
  var rangeInp = document.getElementById('wo-filter-range');
  if (rangeInp && rangeInp.disabled) return; // повар не может
  var wrap = document.getElementById('wo-datepicker-wrap');
  if (!wrap) return;
  if (wrap.style.display !== 'none') { wrap.style.display = 'none'; return; }
  // Инициализируем месяц из текущего фильтра или сегодня
  var baseDate = writeoffFilterFrom ? new Date(writeoffFilterFrom) : new Date();
  _woPickerMonth = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1);
  _woPickerFrom  = writeoffFilterFrom || null;
  _woPickerTo    = writeoffFilterTo   || null;
  _woPickerStep  = 0;
  wrap.style.display = 'block';
  _woRenderPicker();
}

function _woRenderPicker() {
  var wrap = document.getElementById('wo-datepicker-wrap');
  if (!wrap) return;
  var m = _woPickerMonth;
  var year = m.getFullYear(), month = m.getMonth();
  var monthNames = ['Январь','Февраль','Март','Апрель','Май','Июнь',
                    'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  var dayNames   = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];

  var hint = _woPickerStep === 0 ? 'Выбери начало периода' : 'Выбери конец периода';

  var html = '<div style="font-size:12px;color:var(--text-muted);text-align:center;margin-bottom:8px;">' + hint + '</div>'
    + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">'
    + '<button onclick="_woPrevMonth()" style="background:none;border:none;font-size:18px;cursor:pointer;color:var(--text-primary);padding:4px 8px;">‹</button>'
    + '<div style="font-family:Syne,sans-serif;font-size:15px;font-weight:700;color:var(--text-primary);">' + monthNames[month] + ' ' + year + '</div>'
    + '<button onclick="_woNextMonth()" style="background:none;border:none;font-size:18px;cursor:pointer;color:var(--text-primary);padding:4px 8px;">›</button>'
    + '</div>'
    + '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;text-align:center;">';

  // Заголовки дней
  dayNames.forEach(function(d) {
    html += '<div style="font-size:10px;color:var(--text-muted);font-weight:600;padding:2px 0;">' + d + '</div>';
  });

  // Первый день месяца (0=Вс → нам нужен 0=Пн)
  var firstDay = new Date(year, month, 1).getDay();
  firstDay = (firstDay + 6) % 7; // Пн=0
  for (var i = 0; i < firstDay; i++) {
    html += '<div></div>';
  }

  var daysInMonth = new Date(year, month + 1, 0).getDate();
  var todayStr2   = woTodayStr();

  for (var d2 = 1; d2 <= daysInMonth; d2++) {
    var dateStr2 = year + '-' + woPad(month + 1) + '-' + woPad(d2);
    var isFrom   = dateStr2 === _woPickerFrom;
    var isTo     = dateStr2 === _woPickerTo;
    var inRange  = _woPickerFrom && _woPickerTo && dateStr2 > _woPickerFrom && dateStr2 < _woPickerTo;
    var isToday  = dateStr2 === todayStr2;

    var bg = 'transparent', clr = 'var(--text-primary)', fw = '400', br = '50%';
    if (isFrom || isTo) { bg = 'var(--accent2,#C04F14)'; clr = '#fff'; fw = '700'; }
    else if (inRange)   { bg = 'rgba(192,79,20,.15)'; br = '4px'; }
    else if (isToday)   { clr = 'var(--accent2,#C04F14)'; fw = '600'; }

    html += '<div onclick="_woPickDay(\'' + dateStr2 + '\')" '
      + 'style="padding:6px 2px;cursor:pointer;border-radius:' + br + ';background:' + bg + ';color:' + clr + ';font-weight:' + fw + ';font-size:13px;">'
      + d2 + '</div>';
  }

  html += '</div>';

  // Кнопки
  html += '<div style="display:flex;gap:8px;margin-top:10px;">'
    + '<button onclick="_woClosePicker()" style="flex:1;background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:8px;font-size:13px;cursor:pointer;font-family:inherit;color:var(--text-muted);">Отмена</button>'
    + '<button onclick="_woApplyPicker()" style="flex:1;background:var(--accent2,#C04F14);color:#fff;border:none;border-radius:var(--radius-sm);padding:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;">Применить</button>'
    + '</div>';

  wrap.innerHTML = html;
}

function _woPrevMonth() {
  _woPickerMonth = new Date(_woPickerMonth.getFullYear(), _woPickerMonth.getMonth() - 1, 1);
  _woRenderPicker();
}

function _woNextMonth() {
  _woPickerMonth = new Date(_woPickerMonth.getFullYear(), _woPickerMonth.getMonth() + 1, 1);
  _woRenderPicker();
}

function _woPickDay(dateStr) {
  if (_woPickerStep === 0) {
    _woPickerFrom = dateStr;
    _woPickerTo   = null;
    _woPickerStep = 1;
  } else {
    if (dateStr < _woPickerFrom) {
      // Выбрали раньше начала — меняем местами
      _woPickerTo   = _woPickerFrom;
      _woPickerFrom = dateStr;
    } else {
      _woPickerTo = dateStr;
    }
    _woPickerStep = 0;
  }
  _woRenderPicker();
}

function _woApplyPicker() {
  if (!_woPickerFrom) return;
  writeoffFilterFrom = _woPickerFrom;
  writeoffFilterTo   = _woPickerTo || _woPickerFrom;

  // Обновляем текстовое поле
  var rangeInp = document.getElementById('wo-filter-range');
  if (rangeInp) {
    if (writeoffFilterFrom === writeoffFilterTo) {
      rangeInp.value = woFormatDate(writeoffFilterFrom);
    } else {
      rangeInp.value = woFormatDate(writeoffFilterFrom) + ' — ' + woFormatDate(writeoffFilterTo);
    }
  }
  _woClosePicker();
  renderWriteoffMain();
}

function _woClosePicker() {
  var wrap = document.getElementById('wo-datepicker-wrap');
  if (wrap) wrap.style.display = 'none';
}

// TOAST
// ============================================================
function _showWriteoffToast(msg) {
  var toast = document.getElementById('wo-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'wo-toast';
    toast.style.cssText = [
      'position:fixed',
      'bottom:140px',
      'left:50%',
      'transform:translateX(-50%)',
      'background:rgba(30,30,30,0.92)',
      'color:#fff',
      'font-size:12px',
      'font-weight:500',
      'padding:8px 16px',
      'border-radius:20px',
      'z-index:9999',
      'pointer-events:none',
      'opacity:0',
      'transition:opacity 0.3s',
      'max-width:280px',
      'text-align:center',
      'white-space:normal'
    ].join(';');
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = '1';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(function() { toast.style.opacity = '0'; }, 3500);
}

// ============================================================
// EXCEL EXPORT (admin only)
// ============================================================
function exportWriteoffExcel() {
  if (!woIsAdmin()) return;

  var allRec = Object.keys(writeoffRecords).map(function(k){
    return Object.assign({_id:k}, writeoffRecords[k]);
  });
  var records = getWriteoffFilteredRecords(allRec);
  if (!records.length) { alert('Нет данных для экспорта'); return; }

  function doExport(XLSX) {
    var wb  = XLSX.utils.book_new();
    var tag = (writeoffFilterFrom || '') + (writeoffFilterTo && writeoffFilterTo !== writeoffFilterFrom ? '_' + writeoffFilterTo : '');

    // Группируем по причине
    var byReason = {};
    records.forEach(function(r) {
      var reason = r.reason || 'Без причины';
      if (!byReason[reason]) byReason[reason] = [];
      byReason[reason].push(r);
    });

    // Лист «Сводка» — все записи
    var summaryData = [['Дата', 'Время', 'Продукт', 'Количество', 'Ед.', 'Причина', 'Комментарий', 'Повар']];
    records.sort(function(a,b){ return a.timestamp - b.timestamp; }).forEach(function(r) {
      summaryData.push([
        woFormatDate(r.date),
        r.time || '',
        r.name || '',
        r.amount || 0,
        r.unit || '',
        r.reason || '',
        r.comment || '',
        r.user || ''
      ]);
    });
    var wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
    wsSummary['!cols'] = [{wch:12},{wch:8},{wch:25},{wch:12},{wch:6},{wch:20},{wch:30},{wch:18}];
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Все записи');

    // Лист «Сводка» — по причине → продукт → итого
    var svData = [];
    if (writeoffFilterFrom || writeoffFilterTo) {
      var svFrom = writeoffFilterFrom ? woFormatDate(writeoffFilterFrom) : 'начало';
      var svTo   = writeoffFilterTo   ? woFormatDate(writeoffFilterTo)   : 'конец';
      svData.push(['Период: ' + svFrom + ' — ' + svTo]);
      svData.push([]);
    }
    svData.push(['Причина', 'Продукт', 'Итого', 'Ед.']);
    var reasonOrder0 = WRITEOFF_REASONS_ADMIN.slice();
    var svReasons = Object.keys(byReason).sort(function(a,b){
      var ia = reasonOrder0.indexOf(a), ib = reasonOrder0.indexOf(b);
      if (ia===-1) ia=999; if (ib===-1) ib=999; return ia-ib;
    });
    svReasons.forEach(function(reason) {
      var byProdSv = {};
      byReason[reason].forEach(function(r) {
        var prod = r.name || 'Неизвестно';
        if (!byProdSv[prod]) byProdSv[prod] = { total: 0, unit: r.unit || '' };
        byProdSv[prod].total += parseFloat(r.amount) || 0;
      });
      var firstProd = true;
      Object.keys(byProdSv).sort().forEach(function(prod) {
        var row = byProdSv[prod];
        svData.push([
          firstProd ? reason : '',
          prod,
          +row.total.toFixed(3),
          row.unit
        ]);
        firstProd = false;
      });
      svData.push([]); // пустая строка между причинами
    });
    var wsСводка = XLSX.utils.aoa_to_sheet(svData);
    wsСводка['!cols'] = [{wch:22},{wch:25},{wch:12},{wch:6}];
    XLSX.utils.book_append_sheet(wb, wsСводка, 'Сводка');

    // Листы по причинам
    var reasonOrder = WRITEOFF_REASONS_ADMIN.slice();
    var sortedReasons = Object.keys(byReason).sort(function(a,b){
      var ia = reasonOrder.indexOf(a), ib = reasonOrder.indexOf(b);
      if (ia===-1) ia=999; if (ib===-1) ib=999;
      return ia-ib;
    });

    sortedReasons.forEach(function(reason) {
      var rows = byReason[reason];

      // Группируем по продукту внутри причины
      var byProd = {};
      rows.forEach(function(r) {
        var prod = r.name || 'Неизвестно';
        if (!byProd[prod]) byProd[prod] = [];
        byProd[prod].push(r);
      });

      var sheetData = [['Причина: ' + reason], []];
      if (writeoffFilterFrom || writeoffFilterTo) {
        var from = writeoffFilterFrom ? woFormatDate(writeoffFilterFrom) : 'начало';
        var to   = writeoffFilterTo   ? woFormatDate(writeoffFilterTo)   : 'конец';
        sheetData.unshift(['Период: ' + from + ' — ' + to], []);
      }

      sheetData.push(['Продукт', 'Дата', 'Время', 'Количество', 'Ед.', 'Комментарий', 'Повар']);

      Object.keys(byProd).sort().forEach(function(prod) {
        var pRows = byProd[prod];
        pRows.sort(function(a,b){ return a.timestamp - b.timestamp; });
        var total = 0;
        pRows.forEach(function(r) {
          total += parseFloat(r.amount) || 0;
          sheetData.push([prod, woFormatDate(r.date), r.time||'', r.amount||0, r.unit||'', r.comment||'', r.user||'']);
        });
        sheetData.push(['ИТОГО: ' + prod, '', '', +total.toFixed(3), pRows[0].unit||'', '', '']);
        sheetData.push([]);
      });

      var ws = XLSX.utils.aoa_to_sheet(sheetData);
      ws['!cols'] = [{wch:25},{wch:12},{wch:8},{wch:12},{wch:6},{wch:30},{wch:18}];
      var sheetName = reason.replace(/[:\/?*\[\]]/g,'').slice(0,31);
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    });

    var filename = 'spisanie' + (tag ? '_' + tag : '') + '.xlsx';
    XLSX.writeFile(wb, filename);
  }

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
