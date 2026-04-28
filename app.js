// FIKA KITCHEN — app.js
// ============================================================

var FIREBASE_URL = 'https://fika-d21a6-default-rtdb.europe-west1.firebasedatabase.app';
var ADMIN_PIN    = '1234'; // резервный PIN (используется только если нет роли)

// ============================================================
// FIREBASE REST API
// ============================================================
function fbGet(path) {
  return fetch(FIREBASE_URL + DB_PREFIX + path + '.json').then(function(r){ return r.json(); });
}
function fbSet(path, data) {
  return fetch(FIREBASE_URL + DB_PREFIX + path + '.json', {
    method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data)
  }).then(function(r){ return r.json(); });
}
function fbUpdate(path, data) {
  return fetch(FIREBASE_URL + DB_PREFIX + path + '.json', {
    method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data)
  }).then(function(r){ return r.json(); });
}

// ============================================================
// STATE
// ============================================================
var adminUnlocked = false; // set by loader.js based on role, never from localStorage directly
var currentZone   = '';
var currentSubcat = '';
var currentIsPf   = false;
var currentItems  = [];
var editIndex     = -1;
var photoData     = '';
var listSortable  = null;
var clipboard     = { item: null, type: null, srcSection: null };

var DEFAULT_PF_ZONES = ['Горячий цех','Холодный цех','Заготовочный цех','Гриль цех','Раздача'];

// ============================================================
// DATA
// ============================================================
function ensurePfZones() {
  DEFAULT_PF_ZONES.forEach(function(z){ if (!Array.isArray(PF[z])) PF[z] = []; });
  // Clean any undefined values
  Object.keys(PF).forEach(function(k){ if (!Array.isArray(PF[k])) PF[k] = []; });
}

function loadData() {
  showLoader(true);
  fbGet('/').then(function(data) {
    if (!data) data = {};

    // Migration: if zones are at root level (old structure), move them to /pf
    var rootZoneKeys = Object.keys(data).filter(function(k) {
      return Array.isArray(data[k]) && k !== 'dishes' && k !== 'pf' &&
             k !== 'sectionMeta' && k !== 'zoneMeta' && k !== 'sectionOrder' &&
             k !== 'zoneOrder' && k !== 'users' && k !== 'cutting' &&
             k !== '__dishes__' && k !== '__cutting__';
    });
    if (rootZoneKeys.length > 0 && (!data.pf || Object.keys(data.pf).length === 0)) {
      // Migrate root zones to /pf
      var migratedPF = {};
      rootZoneKeys.forEach(function(k) { migratedPF[k] = data[k]; });
      data.pf = migratedPF;
      console.log('Migrating zones to /pf:', rootZoneKeys);
      // Save migrated structure
      var migratedPFSave = {};
      Object.keys(migratedPF).forEach(function(k) {
        migratedPFSave[k] = (Array.isArray(migratedPF[k]) && migratedPF[k].length === 0) ? {'_empty': true} : migratedPF[k];
      });
      fbSet('/pf', migratedPFSave);
    }

    DISHES = (data.dishes && typeof data.dishes === 'object') ? data.dishes
           : (typeof DISHES === 'object' ? DISHES : {});
    var rawPF = (data.pf && typeof data.pf === 'object') ? data.pf
            : (typeof PF === 'object' ? PF : {});
    // Restore empty zones from Firebase placeholder
    PF = {};
    Object.keys(rawPF).forEach(function(k) {
      PF[k] = (rawPF[k] && rawPF[k]._empty) ? [] : rawPF[k];
    });
    window.SECTION_META  = (data.sectionMeta  && typeof data.sectionMeta  === 'object') ? data.sectionMeta  : {};
    window.ZONE_META     = (data.zoneMeta     && typeof data.zoneMeta     === 'object') ? data.zoneMeta     : {};
    window.SECTION_ORDER = (data.sectionOrder && Array.isArray(data.sectionOrder))     ? data.sectionOrder : null;
    window.ZONE_ORDER    = (data.zoneOrder    && Array.isArray(data.zoneOrder))        ? data.zoneOrder    : null;
    ensurePfZones();
    showLoader(false);
    refreshSectionSelect();
    renderZonesGrid();
    // Removed auto-seed: it was overwriting Firebase with default data.js zones
  }).catch(function() {
    if (typeof DISHES !== 'object') DISHES = {};
    if (typeof PF     !== 'object') PF     = {};
    ensurePfZones();
    showLoader(false);
    refreshSectionSelect();
    renderZonesGrid();
  });
}

function saveToFirebase() {
  showSaving(true);
  // Preserve existing ZONE_ORDER — only rebuild if missing
  window.SECTION_ORDER = Object.keys(DISHES);
  if (!window.ZONE_ORDER || !Array.isArray(window.ZONE_ORDER) || window.ZONE_ORDER.length === 0) {
    window.ZONE_ORDER = Object.keys(PF).concat(['__dishes__', '__cutting__']);
  }
  return Promise.all([
    fbSet('/dishes',       DISHES),
    fbSet('/pf', (function() {
      var pf = {};
      Object.keys(PF).forEach(function(k) {
        pf[k] = (Array.isArray(PF[k]) && PF[k].length === 0) ? {'_empty': true} : PF[k];
      });
      return pf;
    })()),
    fbSet('/sectionMeta',  window.SECTION_META  || {}),
    fbSet('/zoneMeta',     window.ZONE_META     || {}),
    fbSet('/sectionOrder', window.SECTION_ORDER),
    fbSet('/zoneOrder',    window.ZONE_ORDER)
  ]).then(function(){ showSaving(false); return true; })
    .catch(function(e){ showSaving(false); console.error(e); alert('Ошибка сохранения'); return false; });
}

function refreshCurrentView() {
  var active = document.querySelector('.view.active');
  if (!active) return;
  if (active.id === 'view-list') {
    currentItems = currentIsPf ? (PF[currentZone] || []) : (DISHES[currentSubcat] || []);
    renderList(currentItems, !currentIsPf);
  } else if (active.id === 'view-sections') {
    renderSectionsGrid();
  }
}

function showLoader(show) {
  var el = document.getElementById('loader');
  if (el) el.style.display = show ? 'flex' : 'none';
}
function showSaving(show) {
  var el = document.getElementById('saving-indicator');
  if (el) el.style.display = show ? 'flex' : 'none';
}

// ============================================================
// NAVIGATION
// ============================================================
function goTo(id) {
  document.querySelectorAll('.view').forEach(function(v){ v.classList.remove('active'); });
  document.getElementById('view-' + id).classList.add('active');
  document.querySelector('.app').scrollTo(0, 0);
}

function openZonePf(zone) {
  currentZone = zone; currentIsPf = true;
  currentItems = PF[zone] || [];
  document.getElementById('list-title').textContent = zone;
  document.getElementById('list-back-btn').onclick = function(){ goTo('zones'); };
  renderList(currentItems, false);
  updatePasteBtn();
  goTo('list');
}

function openDishesGrid() {
  renderSectionsGrid();
  goTo('sections');
}

function renderSectionsGrid() {
  var grid = document.getElementById('sections-grid');
  if (!grid) return;
  if (!DISHES || typeof DISHES !== 'object') DISHES = {};
  grid.innerHTML = '';
  var msb = document.getElementById('manage-sections-btn');
  if (msb) msb.style.display = adminUnlocked ? 'block' : 'none';
  // Sort sections by saved order if available
  var secKeys = Object.keys(DISHES);
  if (window.SECTION_ORDER && Array.isArray(window.SECTION_ORDER)) {
    secKeys.sort(function(a, b) {
      var ai = window.SECTION_ORDER.indexOf(a);
      var bi = window.SECTION_ORDER.indexOf(b);
      if (ai === -1) ai = 999;
      if (bi === -1) bi = 999;
      return ai - bi;
    });
  }
  secKeys.forEach(function(sec){
    (function(s){
      var meta = window.SECTION_META && window.SECTION_META[s];
      var card = document.createElement('div');
      card.className = 'section-card' + (s === 'Special' && !(meta && meta.bgColor) ? ' special-card' : '');
      if (meta && meta.bgColor) { card.style.background = meta.bgColor; card.style.borderColor = meta.bgColor; }
      var lblStyle = (meta && meta.color ? 'color:'+meta.color+';' : '') + (meta && meta.fontSize ? 'font-size:'+meta.fontSize+'px;' : '');
      card.innerHTML = '<div class="section-card-label" style="'+lblStyle+'">' + s + '</div>';
      if (adminUnlocked) {
        var eb = document.createElement('button');
        eb.className = 'edit-btn style-edit-btn no-drag';
        eb.dataset.secName = s;
        eb.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9.5 1.5l3 3L4 13H1v-3L9.5 1.5z"/></svg>';
        card.appendChild(eb);
      }
      card.style.cursor = 'pointer';
      card.dataset.subcatName = s;
      grid.appendChild(card);
    })(sec);
  });
}

function openSubcat(cat) {
  currentSubcat = cat; currentIsPf = false;
  currentItems = DISHES[cat] || [];
  document.getElementById('list-title').textContent = cat;
  document.getElementById('list-back-btn').onclick = function(){ goTo('sections'); };
  renderList(currentItems, true);
  updatePasteBtn();
  goTo('list');
}

// ============================================================
// EDIT BUTTON — uses data attributes, handled by global delegation
// ============================================================
function createEditButton(idx) {
  var btn = document.createElement('button');
  btn.className = 'edit-btn no-drag';
  btn.dataset.editIdx = idx;
  btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9.5 1.5l3 3L4 13H1v-3L9.5 1.5z"/></svg>';
  return btn;
}

// ============================================================
// LIST
// ============================================================
function renderList(items, isBluda) {
  var list = document.getElementById('item-list');
  list.innerHTML = '';
  if (!items.length) {
    var empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Пока пусто';
    list.appendChild(empty);
  } else {
    items.forEach(function(item, i){
      var row = document.createElement('div');
      row.className = 'item-row';
      row.dataset.idx = i;
      if (adminUnlocked) {
        var handle = document.createElement('span');
        handle.className = 'drag-handle';
        handle.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="3" y1="5" x2="13" y2="5"/><line x1="3" y1="8" x2="13" y2="8"/><line x1="3" y1="11" x2="13" y2="11"/></svg>';
        row.appendChild(handle);
      }
      var nameSpan = document.createElement('span');
      nameSpan.className = 'item-name';
      nameSpan.textContent = item.name;
      row.appendChild(nameSpan);
      if (adminUnlocked) {
        row.appendChild(createEditButton(i));
      }
      var arrow = document.createElement('span');
      arrow.innerHTML = '<svg class="item-arrow" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="6,3 11,8 6,13"/></svg>';
      row.appendChild(arrow);
      row.style.cursor = 'pointer';
      row.dataset.isBluda = isBluda ? '1' : '0';
      list.appendChild(row);
    });
  }
  // ADD BUTTON
  if (adminUnlocked) {
    var addBtn = document.createElement('button');
    addBtn.className = 'add-item-btn';
    addBtn.style.cssText += ';position:relative;z-index:10;pointer-events:auto;';
    addBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2"><line x1="7" y1="1" x2="7" y2="13"/><line x1="1" y1="7" x2="13" y2="7"/></svg> Добавить';
    addBtn.dataset.action = 'openAdmin';
    list.appendChild(addBtn);
  }
  initListSortable(list, isBluda);
}

function initListSortable(list, isBluda) {
  if (listSortable) { listSortable.destroy(); listSortable = null; }
  if (!adminUnlocked || typeof Sortable === 'undefined') return;
  listSortable = Sortable.create(list, {
    handle: '.drag-handle',
    filter: '.no-drag,.add-item-btn',
    preventOnFilter: true,
    animation: 150,
    ghostClass: 'sortable-ghost',
    dragClass: 'sortable-drag',
    onEnd: function(evt) {
      var rows = Array.prototype.slice.call(list.querySelectorAll('.item-row'));
      var newItems = [];
      rows.forEach(function(row){
        var idx = parseInt(row.dataset.idx);
        if (!isNaN(idx) && currentItems[idx] !== undefined) newItems.push(currentItems[idx]);
      });
      if (newItems.length === currentItems.length) {
        if (currentIsPf) PF[currentZone] = newItems; else DISHES[currentSubcat] = newItems;
        currentItems = newItems;
      } else if (evt.oldIndex !== evt.newIndex) {
        var moved = currentItems.splice(evt.oldIndex, 1)[0];
        currentItems.splice(evt.newIndex, 0, moved);
      }
      saveToFirebase().then(function(){ renderList(currentItems, isBluda); });
    }
  });
}

// ============================================================
// DETAIL
// ============================================================
function openDetail(dish, isBluda) {
  document.getElementById('detail-name').textContent = dish.name;
  var wrap = document.getElementById('detail-photo-wrap');
  var img  = document.getElementById('detail-photo');
  if (isBluda && dish.photo) { img.src = dish.photo; img.alt = dish.name; wrap.style.display = 'block'; }
  else { wrap.style.display = 'none'; }
  var ing = document.getElementById('detail-ing');
  ing.innerHTML = '';
  (dish.ingredients || []).forEach(function(i){
    var tr = document.createElement('tr');
    tr.innerHTML = '<td>' + i.name + '</td><td>' + i.weight + '</td>';
    ing.appendChild(tr);
  });
  if (dish.yield) {
    var yr = document.createElement('tr'); yr.className = 'ing-yield';
    yr.innerHTML = '<td>Выход</td><td>' + dish.yield + '</td>';
    ing.appendChild(yr);
  }
  var dl = document.getElementById('desc-label'), dt = document.getElementById('detail-desc');
  if (dish.desc) { dl.style.display='block'; dt.style.display='block'; dt.textContent=dish.desc; }
  else { dl.style.display='none'; dt.style.display='none'; }
  goTo('detail');
}

// ============================================================
// SEARCH
// ============================================================
function initSearch() {
  document.querySelector('.search-input').addEventListener('input', function(){
    var q = this.value.trim().toLowerCase();
    if (!q) { goTo('zones'); return; }
    var results = [];
    Object.keys(DISHES || {}).forEach(function(sec){
      (DISHES[sec]||[]).forEach(function(d){ if(matchDish(d,q)) results.push({dish:d,sec:sec,isPf:false}); });
    });
    Object.keys(PF || {}).forEach(function(zone){
      (PF[zone]||[]).forEach(function(d){ if(matchDish(d,q)) results.push({dish:d,sec:zone+' (п/ф)',isPf:true}); });
    });
    renderSearch(results);
  });
}
function matchDish(d, q) {
  if (d.name.toLowerCase().indexOf(q)!==-1) return true;
  if ((d.desc||'').toLowerCase().indexOf(q)!==-1) return true;
  return (d.ingredients||[]).some(function(i){ return i.name.toLowerCase().indexOf(q)!==-1; });
}
function renderSearch(results) {
  var c = document.getElementById('search-results');
  c.innerHTML = '';
  if (!results.length) { c.innerHTML = '<div class="empty-state">Ничего не найдено</div>'; }
  else {
    var grouped = {};
    results.forEach(function(r){ if(!grouped[r.sec]) grouped[r.sec]=[]; grouped[r.sec].push(r); });
    Object.keys(grouped).forEach(function(sec){
      var lbl = document.createElement('div'); lbl.className='search-section-label'; lbl.textContent=sec;
      c.appendChild(lbl);
      grouped[sec].forEach(function(r){
        var row = document.createElement('div'); row.className='item-row'; row.style.cursor='pointer';
        row.innerHTML='<span class="item-name">'+r.dish.name+'</span>'
          +'<svg class="item-arrow" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="6,3 11,8 6,13"/></svg>';
        (function(d,isPf){
          row.onclick = function(e){ if(e.target.closest('.edit-btn')) return; openDetail(d,!isPf); };
        })(r.dish,r.isPf);
        c.appendChild(row);
      });
    });
  }
  goTo('search');
}

// ============================================================
// CLIPBOARD
// ============================================================
function copyItem(idx) {
  clipboard = { item: JSON.parse(JSON.stringify(currentItems[idx])), type: currentIsPf?'pf':'dish', srcSection: currentIsPf?currentZone:currentSubcat, cut: false };
  showToast('Скопировано: ' + currentItems[idx].name); updatePasteBtn();
}
function cutItem(idx) {
  clipboard = { item: JSON.parse(JSON.stringify(currentItems[idx])), type: currentIsPf?'pf':'dish', srcSection: currentIsPf?currentZone:currentSubcat, cut: true };
  showToast('Вырезано: ' + currentItems[idx].name); updatePasteBtn();
}
function pasteItem() {
  if (!clipboard.item) return;
  var item = JSON.parse(JSON.stringify(clipboard.item));
  if (clipboard.type==='dish' && !currentIsPf) {
    if (!DISHES[currentSubcat]) DISHES[currentSubcat]=[];
    DISHES[currentSubcat].push(item);
    if (clipboard.cut && DISHES[clipboard.srcSection]) {
      var a=DISHES[clipboard.srcSection], idx=a.findIndex?a.findIndex(function(x){return x.name===item.name;}):0;
      if(idx>=0) a.splice(idx,1);
    }
    currentItems=DISHES[currentSubcat]; renderList(currentItems,true);
  } else if (clipboard.type==='pf' && currentIsPf) {
    if (!PF[currentZone]) PF[currentZone]=[];
    PF[currentZone].push(item);
    if (clipboard.cut && PF[clipboard.srcSection]) {
      var b=PF[clipboard.srcSection], idx2=b.findIndex?b.findIndex(function(x){return x.name===item.name;}):0;
      if(idx2>=0) b.splice(idx2,1);
    }
    currentItems=PF[currentZone]; renderList(currentItems,false);
  } else { alert('Нельзя вставить: тип не совпадает'); return; }
  if (clipboard.cut) clearClipboard();
  saveToFirebase().then(function(){ refreshCurrentView(); renderZonesGrid(); });
}
function clearClipboard() { clipboard={item:null,type:null,srcSection:null}; updatePasteBtn(); hideToast(); }
function updatePasteBtn() { var btn=document.getElementById('paste-btn'); if(btn) btn.style.display=(adminUnlocked&&clipboard.item)?'block':'none'; }
function showToast(msg) { var t=document.getElementById('clipboard-toast'),tx=document.getElementById('clipboard-toast-text'); if(t){tx.textContent=msg;t.style.display='flex';} }
function hideToast() { var t=document.getElementById('clipboard-toast'); if(t) t.style.display='none'; }

// ============================================================
// ADMIN — unlock based on ROLE (no PIN needed for admins)
// ============================================================
function initAdmin() {
  // 5 taps on brand to enter PIN (fallback / dev mode)
  var brand = document.getElementById('brand-tap');
  if (!brand) return;
  var taps = 0, tapTimer = null;
  brand.style.cursor = 'pointer';
  brand.addEventListener('click', function() {
    taps++;
    clearTimeout(tapTimer);
    tapTimer = setTimeout(function(){ taps=0; }, 2000);
    if (taps >= 5) { taps=0; showPinPrompt(); }
  });
}

function showPinPrompt() {
  // Admins don't need PIN — they get access via role
  if (typeof isAdmin === 'function' && isAdmin()) {
    if (!adminUnlocked) unlockAdmin();
    return;
  }
  // Non-admin or not logged in — do nothing
}

function unlockAdmin() {
  // Only admins can unlock — double check role
  if (typeof isAdmin === 'function' && !isAdmin()) return;
  adminUnlocked = true;
  localStorage.setItem('fika_admin', '1');
  var ezb = document.getElementById('edit-zones-btn');
  if (ezb) ezb.style.display = 'flex';
  var msb = document.getElementById('manage-sections-btn');
  if (msb) msb.style.display = 'flex';
  var apb = document.getElementById('admin-panel-btn');
  if (apb) apb.style.display = 'block';
  refreshCurrentView();
  renderZonesGrid();
  updatePasteBtn();
}

function lockAdmin() {
  adminUnlocked = false;
  localStorage.removeItem('fika_admin');
  var ezb = document.getElementById('edit-zones-btn');
  if (ezb) ezb.style.display = 'none';
  var msb = document.getElementById('manage-sections-btn');
  if (msb) msb.style.display = 'none';
  var apb = document.getElementById('admin-panel-btn');
  if (apb) apb.style.display = 'none';
  refreshCurrentView();
  renderZonesGrid();
  updatePasteBtn();
}

var _adminMode = 'dish';
var _adminLastCall = 0;

function openAdmin(mode, idx) {
  var now = Date.now();
  if (now - _adminLastCall < 500) return;
  _adminLastCall = now;
  _adminMode = mode; editIndex = (idx !== undefined) ? idx : -1; photoData = '';
  document.querySelectorAll('.admin-tab').forEach(function(t){ t.classList.toggle('active', t.dataset.tab===mode); });
  document.getElementById('admin-form-dish').style.display = mode==='dish'?'block':'none';
  document.getElementById('admin-form-pf').style.display   = mode==='pf'  ?'block':'none';
  if (mode==='dish') {
    var dish = editIndex>=0 ? currentItems[editIndex] : null;
    var sel = document.getElementById('admin-dish-section');
    if (sel) { for(var i=0;i<sel.options.length;i++) if(sel.options[i].value===currentSubcat){sel.selectedIndex=i;break;} }
    document.getElementById('admin-name-dish').value  = dish ? dish.name  : '';
    document.getElementById('admin-photo-dish').value = dish ? (dish.photo||'') : '';
    document.getElementById('admin-desc-dish').value  = dish ? (dish.desc ||'') : '';
    photoData = dish ? (dish.photo||'') : ''; updatePhotoPreview();
    clearIngRows('admin-ings-dish');
    if (dish && dish.ingredients && dish.ingredients.length) dish.ingredients.forEach(function(i){ addIngRow('admin-ings-dish',i.name,i.weight); });
    else addIngRow('admin-ings-dish');
    document.getElementById('admin-del-dish').style.display = editIndex>=0?'flex':'none';
    document.getElementById('admin-save-dish-lbl').textContent = editIndex>=0?'Сохранить':'Добавить';
  } else {
    var pf = editIndex>=0 ? currentItems[editIndex] : null;
    var sel2 = document.getElementById('admin-pf-zone');
    if (sel2) { for(var j=0;j<sel2.options.length;j++) if(sel2.options[j].value===currentZone){sel2.selectedIndex=j;break;} }
    document.getElementById('admin-name-pf').value  = pf ? pf.name  : '';
    document.getElementById('admin-yield-pf').value = pf ? (pf.yield||'') : '';
    document.getElementById('admin-desc-pf').value  = pf ? (pf.desc ||'') : '';
    clearIngRows('admin-ings-pf');
    if (pf && pf.ingredients && pf.ingredients.length) pf.ingredients.forEach(function(i){ addIngRow('admin-ings-pf',i.name,i.weight); });
    else addIngRow('admin-ings-pf');
    document.getElementById('admin-del-pf').style.display = editIndex>=0?'flex':'none';
    document.getElementById('admin-save-pf-lbl').textContent = editIndex>=0?'Сохранить':'Добавить';
  }
  document.getElementById('admin-overlay').classList.add('open');
}

function openEditItem(idx) { openAdmin(currentIsPf?'pf':'dish', idx); }
function closeAdmin() { document.getElementById('admin-overlay').classList.remove('open'); photoData=''; }
function switchAdminTab(tab) { openAdmin(tab,-1); }

// ============================================================
// ZONES GRID + EDITOR
// ============================================================
function renderZonesGrid() {
  var grid = document.getElementById('zones-grid');
  if (!grid) return;
  grid.innerHTML = '';
  if (!PF || typeof PF !== 'object') PF = {};
  var ezb = document.getElementById('edit-zones-btn');
  if (ezb) ezb.style.display = adminUnlocked ? 'block' : 'none';
  // Sort zones by saved order if available
  var zoneKeys = Object.keys(PF);
  // Build full order including fixed cards
  var fullOrder = window.ZONE_ORDER && Array.isArray(window.ZONE_ORDER) ? window.ZONE_ORDER : [];
  // If no fixed zones in order yet, append them at end
  var dishesInOrder   = fullOrder.indexOf('__dishes__')   >= 0;
  var cuttingInOrder  = fullOrder.indexOf('__cutting__')  >= 0;

  if (fullOrder.length) {
    zoneKeys.sort(function(a, b) {
      var ai = fullOrder.indexOf(a); if (ai===-1) ai=999;
      var bi = fullOrder.indexOf(b); if (bi===-1) bi=999;
      return ai - bi;
    });
  }

  // Determine if fixed cards should come before or after based on ZONE_ORDER
  var dishPos   = dishesInOrder  ? fullOrder.indexOf('__dishes__')   : 9998;
  var cutPos    = cuttingInOrder ? fullOrder.indexOf('__cutting__')  : 9999;

  // We'll insert fixed cards in renderZonesGrid based on their position
  // Build mixed render order: PF zones + fixed slots
  var mixedOrder = [];
  var pfKeys = zoneKeys.slice();
  var allPos = [];
  pfKeys.forEach(function(k){ allPos.push({k:k, pos: fullOrder.indexOf(k)<0?500:fullOrder.indexOf(k)}); });
  allPos.push({k:'__dishes__',   pos: dishPos});
  allPos.push({k:'__cutting__',  pos: cutPos});
  allPos.sort(function(a,b){ return a.pos-b.pos; });

  zoneKeys = allPos.filter(function(x){ return x.k!=='__dishes__'&&x.k!=='__cutting__'; }).map(function(x){ return x.k; });
  var renderOrder = allPos.map(function(x){ return x.k; });

  renderOrder.forEach(function(zone){
    if (zone === '__dishes__' || zone === '__cutting__') return; // rendered separately below
  });

  // Render all cards in order (PF zones + Блюда + Разделка)
  renderOrder.forEach(function(zone){
    if (zone === '__dishes__') {
      // Блюда card - inserted at this position
      var dishMeta2 = (window.ZONE_META && window.ZONE_META['__dishes__']) || {};
      var dishBg2   = dishMeta2.bgColor || '#C04F14';
      var dishClr2  = dishMeta2.color   || '#fff';
      var dishFs2   = dishMeta2.fontSize ? 'font-size:'+dishMeta2.fontSize+'px;' : '';
      var dc = document.createElement('div');
      dc.className = 'zone-card';
      dc.style.cssText = 'background:'+dishBg2+';border-color:'+dishBg2+';cursor:pointer;';
      dc.innerHTML = '<div class="zone-label" style="color:'+dishClr2+';'+dishFs2+'">Блюда</div>';
      dc.dataset.action = 'openDishes';
      if (adminUnlocked) {
        var deb2 = document.createElement('button');
        deb2.className = 'edit-btn style-edit-btn no-drag';
        deb2.dataset.fixedZone = '__dishes__';
        deb2.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9.5 1.5l3 3L4 13H1v-3L9.5 1.5z"/></svg>';
        dc.appendChild(deb2);
      }
      grid.appendChild(dc);
      return;
    }
    if (zone === '__cutting__') {
      // Разделка card
      var cutMeta2 = (window.ZONE_META && window.ZONE_META['__cutting__']) || {};
      var cutBg2   = cutMeta2.bgColor || '#2D3142';
      var cutClr2  = cutMeta2.color   || '#fff';
      var cutFs2   = cutMeta2.fontSize ? 'font-size:'+cutMeta2.fontSize+'px;' : '';
      var cc = document.createElement('div');
      cc.className = 'zone-card';
      cc.style.cssText = 'background:'+cutBg2+';border-color:'+cutBg2+';cursor:pointer;';
      cc.innerHTML = '<div class="zone-label" style="color:'+cutClr2+';'+cutFs2+'">Разделка</div>';
      cc.dataset.action = 'openCutting';
      if (adminUnlocked) {
        var ceb2 = document.createElement('button');
        ceb2.className = 'edit-btn style-edit-btn no-drag';
        ceb2.dataset.fixedZone = '__cutting__';
        ceb2.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9.5 1.5l3 3L4 13H1v-3L9.5 1.5z"/></svg>';
        cc.appendChild(ceb2);
      }
      grid.appendChild(cc);
      return;
    }
    (function(z){
      var meta = (window.ZONE_META && window.ZONE_META[z]) || {};
      var card = document.createElement('div');
      card.className = 'zone-card';
      if (meta.bgColor) { card.style.background=meta.bgColor; card.style.borderColor=meta.bgColor; }
      var lblStyle = (meta.color?'color:'+meta.color+';':'') + (meta.fontSize?'font-size:'+meta.fontSize+'px;':'');
      card.innerHTML = '<div class="zone-label" style="'+lblStyle+'">' + z + '</div>';
      if (adminUnlocked) {
        var zeb = document.createElement('button');
        zeb.className = 'edit-btn style-edit-btn no-drag';
        zeb.dataset.zoneName = z;
        zeb.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9.5 1.5l3 3L4 13H1v-3L9.5 1.5z"/></svg>';
        card.appendChild(zeb);
      }
      card.style.cursor = 'pointer';
      card.dataset.zonePf = z;
      grid.appendChild(card);
    })(zone);
  });
  // Show/hide admin-only cutting products editor button
  var cpb = document.getElementById('cutting-edit-products-btn');
  if (cpb) cpb.style.display = adminUnlocked ? 'flex' : 'none';
}

// Zone style editor
function openZoneStyleEditor(zone, meta) {
  document.querySelectorAll('.se-style-popover').forEach(function(p){ p.remove(); });
  var pop = document.createElement('div');
  pop.className = 'se-style-popover';
  pop.style.cssText = 'position:fixed;bottom:0;left:0;right:0;max-width:430px;margin:0 auto;z-index:1500;border-radius:20px 20px 0 0;padding:24px 20px 48px;background:var(--surface);animation:slideUp .25s ease;max-height:80vh;overflow-y:auto;box-shadow:0 -8px 32px rgba(0,0,0,.15);';
  var curBg=meta.bgColor||'#ffffff', curClr=meta.color||'#1A1A1A', curFs=meta.fontSize||17;
  pop.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">'
    +'<div style="font-family:Syne,sans-serif;font-size:17px;font-weight:700;color:var(--text-primary);">Стиль: '+zone+'</div>'
    +'<button style="background:var(--surface2);border:none;border-radius:50%;width:32px;height:32px;font-size:18px;cursor:pointer;" onclick="this.closest(\'.se-style-popover\').remove()">&times;</button>'
    +'</div>'
    +'<div class="admin-field"><label>Фон кнопки</label><input type="color" id="ze-bg" value="'+curBg+'" style="width:100%;height:44px;border:1px solid var(--border);border-radius:var(--radius-sm);cursor:pointer;padding:2px 4px;"></div>'
    +'<div class="admin-field"><label>Цвет текста</label><input type="color" id="ze-clr" value="'+curClr+'" style="width:100%;height:44px;border:1px solid var(--border);border-radius:var(--radius-sm);cursor:pointer;padding:2px 4px;"></div>'
    +'<div class="admin-field"><label>Размер шрифта — <span id="ze-fs-val">'+curFs+'</span>px</label><input type="range" min="12" max="28" value="'+curFs+'" style="width:100%;" oninput="document.getElementById(\'ze-fs-val\').textContent=this.value"></div>'
    +'<div class="admin-btn-row"><button class="admin-btn cancel" onclick="this.closest(\'.se-style-popover\').remove()">Отмена</button><button class="admin-btn save" id="ze-save">Применить</button></div>';
  document.body.appendChild(pop);
  pop.querySelector('#ze-save').addEventListener('click', function(){
    if (!window.ZONE_META) window.ZONE_META = {};
    window.ZONE_META[zone] = { bgColor:pop.querySelector('#ze-bg').value, color:pop.querySelector('#ze-clr').value, fontSize:parseInt(pop.querySelector('[type=range]').value) };
    pop.remove(); saveToFirebase().then(function(){ renderZonesGrid(); });
  });
}

var _zeWorkingZones=[], _zeSortable=null;
var FIXED_ZONES = ['__dishes__', '__cutting__']; // special non-deletable cards

function openZonesEditor() {
  if (window.ZONE_ORDER && Array.isArray(window.ZONE_ORDER) && window.ZONE_ORDER.length) {
    _zeWorkingZones = window.ZONE_ORDER.slice();
    Object.keys(PF).forEach(function(k) {
      if (_zeWorkingZones.indexOf(k) === -1) _zeWorkingZones.push(k);
    });
    if (_zeWorkingZones.indexOf('__dishes__')  === -1) _zeWorkingZones.push('__dishes__');
    if (_zeWorkingZones.indexOf('__cutting__') === -1) _zeWorkingZones.push('__cutting__');
  } else {
    _zeWorkingZones = Object.keys(PF).concat(['__dishes__', '__cutting__']);
  }
  renderZeList();
  document.getElementById('zones-editor-overlay').classList.add('open');
}
function closeZonesEditor() { document.getElementById('zones-editor-overlay').classList.remove('open'); if(_zeSortable){_zeSortable.destroy();_zeSortable=null;} }
function renderZeList() {
  var list = document.getElementById('ze-list'); list.innerHTML='';
  var fixedLabels = {'__dishes__':'Блюда', '__cutting__':'Разделка'};
  _zeWorkingZones.forEach(function(zone,i){
    var isFixed = zone === '__dishes__' || zone === '__cutting__';
    var item=document.createElement('div');
    item.className='se-item'; item.dataset.zone=zone;
    if (isFixed) item.style.opacity = '0.6';
    var handle=document.createElement('span'); handle.className='drag-handle';
    handle.innerHTML='<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="3" y1="5" x2="13" y2="5"/><line x1="3" y1="8" x2="13" y2="8"/><line x1="3" y1="11" x2="13" y2="11"/></svg>';
    item.appendChild(handle);
    var inp=document.createElement('input'); inp.type='text'; inp.className='se-item-name';
    inp.value = isFixed ? fixedLabels[zone] : zone;
    if (isFixed) { inp.disabled=true; inp.style.color='var(--text-muted)'; }
    item.appendChild(inp);
    (function(z,idx){
      if (!isFixed) {
        var del=document.createElement('button'); del.className='se-del-btn no-drag'; del.textContent='×';
        del.onclick=function(){ var cnt=PF[z]?PF[z].length:0; if(cnt>0&&!confirm('В цехе "'+z+'" есть '+cnt+' п/ф. Удалить?')) return; _zeWorkingZones.splice(idx,1); renderZeList(); };
        item.appendChild(del);
      } else {
        // Lock icon instead of delete
        var lock=document.createElement('span');
        lock.style.cssText='color:var(--text-muted);font-size:14px;padding:0 4px;';
        lock.textContent='🔒';
        item.appendChild(lock);
      }
    })(zone,i);
    list.appendChild(item);
  });
  if(_zeSortable) _zeSortable.destroy();
  if (typeof Sortable !== 'undefined') {
    _zeSortable=Sortable.create(list,{ handle:'.drag-handle',filter:'.no-drag',preventOnFilter:true,animation:150,ghostClass:'sortable-ghost',
      onEnd:function(){ _zeWorkingZones=[]; list.querySelectorAll('.se-item').forEach(function(el){_zeWorkingZones.push(el.dataset.zone);}); }
    });
  }
}
function addNewZone() {
  var name=prompt('Название нового цеха:'); if(!name||!name.trim()) return;
  var key=name.trim(); if(_zeWorkingZones.indexOf(key)>=0){alert('Цех уже существует');return;}
  if(PF[key]===undefined) PF[key]=[]; _zeWorkingZones.push(key); renderZeList();
}
function saveZonesEditor() {
  // Read current order from DOM (Sortable updates DOM order on drag)
  var items = document.querySelectorAll('#ze-list .se-item');
  var newPF = {}, newZM = {}, fullOrder = [];

  items.forEach(function(el) {
    var orig = el.dataset.zone;
    // Fixed cards — record position only
    if (orig === '__dishes__' || orig === '__cutting__') {
      fullOrder.push(orig);
      return;
    }
    var inp = el.querySelector('.se-item-name');
    var newName = (inp ? inp.value : '').trim() || orig;
    // Always use array — PF[orig] may be undefined if zone was just added
    newPF[newName] = (PF[orig] && Array.isArray(PF[orig])) ? PF[orig] : (PF[newName] && Array.isArray(PF[newName])) ? PF[newName] : [];
    if (window.ZONE_META && window.ZONE_META[orig]) {
      newZM[newName] = window.ZONE_META[orig];
    }
    fullOrder.push(newName);
  });

  // Apply
  PF = newPF;
  if (window.ZONE_META) window.ZONE_META = newZM;
  window.ZONE_ORDER = fullOrder;

  refreshSectionSelect();
  closeZonesEditor();

  // Save directly to Firebase
  showSaving(true);
  // Clean PF — remove undefined values, ensure all values are arrays
  Object.keys(PF).forEach(function(k) {
    if (!Array.isArray(PF[k])) PF[k] = [];
  });
  // Firebase deletes empty arrays — use null placeholder for empty zones
  var pfSnapshot = {};
  Object.keys(PF).forEach(function(k) {
    pfSnapshot[k] = (Array.isArray(PF[k]) && PF[k].length === 0) ? {'_empty': true} : PF[k];
  });
  console.log('Saving to Firebase, PF keys:', Object.keys(pfSnapshot));
  Promise.all([
    fbSet('/pf',        pfSnapshot),
    fbSet('/zoneMeta',  window.ZONE_META  || {}),
    fbSet('/zoneOrder', window.ZONE_ORDER)
  ]).then(function() {
    showSaving(false);
    renderZonesGrid();
    refreshCurrentView();
    console.log('Saved PF:', Object.keys(PF), 'Order:', window.ZONE_ORDER);
  }).catch(function(e) {
    showSaving(false);
    console.error('Save error:', e);
    alert('Ошибка сохранения');
  });
}

// ============================================================
// SECTION EDITOR
// ============================================================
var _seSortable=null, _seWorkingKeys=[];
function openSectionEditor() {
  // Use SECTION_ORDER as source of truth
  var allKeys = Object.keys(DISHES);
  if (window.SECTION_ORDER && Array.isArray(window.SECTION_ORDER)) {
    _seWorkingKeys = window.SECTION_ORDER.filter(function(k){ return DISHES[k] !== undefined; });
    allKeys.forEach(function(k){ if (_seWorkingKeys.indexOf(k) === -1) _seWorkingKeys.push(k); });
  } else {
    _seWorkingKeys = allKeys;
  }
  renderSeList(); document.getElementById('section-editor-overlay').classList.add('open');
}
function closeSectionEditor() { document.getElementById('section-editor-overlay').classList.remove('open'); if(_seSortable){_seSortable.destroy();_seSortable=null;} }
function renderSeList() {
  var list=document.getElementById('se-list'); list.innerHTML='';
  _seWorkingKeys.forEach(function(key,i){
    var item=document.createElement('div'); item.className='se-item'; item.dataset.key=key;
    var handle=document.createElement('span'); handle.className='drag-handle';
    handle.innerHTML='<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="3" y1="5" x2="13" y2="5"/><line x1="3" y1="8" x2="13" y2="8"/><line x1="3" y1="11" x2="13" y2="11"/></svg>';
    item.appendChild(handle);
    var inp=document.createElement('input'); inp.type='text'; inp.className='se-item-name'; inp.value=key; inp.dataset.origKey=key;
    item.appendChild(inp);
    (function(k,idx){
      var del=document.createElement('button'); del.className='se-del-btn no-drag'; del.textContent='×';
      del.onclick=function(){ var cnt=DISHES[k]?DISHES[k].length:0; if(cnt>0&&!confirm('В разделе "'+k+'" есть '+cnt+' блюд. Удалить?')) return; _seWorkingKeys.splice(idx,1); renderSeList(); };
      item.appendChild(del);
    })(key,i);
    list.appendChild(item);
  });
  if(_seSortable) _seSortable.destroy();
  if (typeof Sortable !== 'undefined') {
    _seSortable=Sortable.create(list,{ handle:'.drag-handle',filter:'.no-drag',preventOnFilter:true,animation:150,ghostClass:'sortable-ghost',
      onEnd:function(){ _seWorkingKeys=[]; list.querySelectorAll('.se-item').forEach(function(el){_seWorkingKeys.push(el.dataset.key);}); }
    });
  }
}
function addNewSection() {
  var name=prompt('Название нового раздела:'); if(!name||!name.trim()) return;
  var key=name.trim(); if(DISHES[key]!==undefined){alert('Раздел уже существует');return;}
  DISHES[key]=[]; _seWorkingKeys.push(key); renderSeList();
}
function saveSectionEditor() {
  var items=document.querySelectorAll('#se-list .se-item');
  var newOrder=[], renames={};
  items.forEach(function(el){ var orig=el.dataset.key, nk=el.querySelector('.se-item-name').value.trim()||orig; newOrder.push({orig:orig,nk:nk}); if(orig!==nk) renames[orig]=nk; });
  var newD={}, newSM={};
  newOrder.forEach(function(p){ newD[p.nk]=DISHES[p.orig]||[]; if(window.SECTION_META&&window.SECTION_META[p.orig]) newSM[p.nk]=window.SECTION_META[p.orig]; });
  DISHES=newD; if(window.SECTION_META) window.SECTION_META=newSM;
  window.SECTION_ORDER = Object.keys(newD); // preserve new order
  refreshSectionSelect(); closeSectionEditor();
  saveToFirebase().then(function(){ renderSectionsGrid(); refreshCurrentView(); renderZonesGrid(); });
}

// Section style editor
function openSectionStyleEditor(sec, cardEl, meta) {
  document.querySelectorAll('.se-style-popover').forEach(function(p){ p.remove(); });
  var pop=document.createElement('div'); pop.className='se-style-popover';
  pop.style.cssText='position:fixed;bottom:0;left:0;right:0;max-width:430px;margin:0 auto;z-index:1500;border-radius:20px 20px 0 0;padding:24px 20px 48px;background:var(--surface);animation:slideUp .25s ease;max-height:80vh;overflow-y:auto;box-shadow:0 -8px 32px rgba(0,0,0,.15);';
  var curBg=meta.bgColor||'#ffffff', curClr=meta.color||'#1A1A1A', curFs=meta.fontSize||19;
  pop.innerHTML='<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">'
    +'<div style="font-family:Syne,sans-serif;font-size:17px;font-weight:700;color:var(--text-primary);">Стиль: '+sec+'</div>'
    +'<button style="background:var(--surface2);border:none;border-radius:50%;width:32px;height:32px;font-size:18px;cursor:pointer;" onclick="this.closest(\'.se-style-popover\').remove()">&times;</button>'
    +'</div>'
    +'<div class="admin-field"><label>Фон кнопки</label><input type="color" id="se-bg" value="'+curBg+'" style="width:100%;height:44px;border:1px solid var(--border);border-radius:var(--radius-sm);cursor:pointer;padding:2px 4px;"></div>'
    +'<div class="admin-field"><label>Цвет текста</label><input type="color" id="se-clr" value="'+curClr+'" style="width:100%;height:44px;border:1px solid var(--border);border-radius:var(--radius-sm);cursor:pointer;padding:2px 4px;"></div>'
    +'<div class="admin-field"><label>Размер шрифта — <span id="se-fs-val">'+curFs+'</span>px</label><input type="range" min="12" max="28" value="'+curFs+'" style="width:100%;" oninput="document.getElementById(\'se-fs-val\').textContent=this.value"></div>'
    +'<div class="admin-btn-row"><button class="admin-btn cancel" onclick="this.closest(\'.se-style-popover\').remove()">Отмена</button><button class="admin-btn save" id="se-save-style">Применить</button></div>';
  document.body.appendChild(pop);
  pop.querySelector('#se-save-style').addEventListener('click', function(){
    if(!window.SECTION_META) window.SECTION_META={};
    window.SECTION_META[sec]={bgColor:pop.querySelector('#se-bg').value,color:pop.querySelector('#se-clr').value,fontSize:parseInt(pop.querySelector('[type=range]').value)};
    pop.remove(); saveToFirebase().then(function(){ renderSectionsGrid(); });
  });
}

function refreshSectionSelect() {
  var sel=document.getElementById('admin-dish-section');
  if(sel){
    var cur=sel.value; sel.innerHTML='';
    var dk=Object.keys(DISHES||{});
    if(window.SECTION_ORDER) dk.sort(function(a,b){var ai=window.SECTION_ORDER.indexOf(a),bi=window.SECTION_ORDER.indexOf(b);return(ai<0?999:ai)-(bi<0?999:bi);});
    dk.forEach(function(k){ var o=document.createElement('option'); o.value=k; o.textContent=k; if(k===cur) o.selected=true; sel.appendChild(o); });
  }
  var sel2=document.getElementById('admin-pf-zone');
  if(sel2){
    var cur2=sel2.value; sel2.innerHTML='';
    var zk=Object.keys(PF||{});
    if(window.ZONE_ORDER) zk.sort(function(a,b){var ai=window.ZONE_ORDER.indexOf(a),bi=window.ZONE_ORDER.indexOf(b);return(ai<0?999:ai)-(bi<0?999:bi);});
    zk.forEach(function(k){ var o=document.createElement('option'); o.value=k; o.textContent=k; if(k===cur2) o.selected=true; sel2.appendChild(o); });
  }
}

// ============================================================
// SAVE / DELETE DISH & PF
// ============================================================
function saveDish() {
  var sec=document.getElementById('admin-dish-section').value;
  var name=document.getElementById('admin-name-dish').value.trim();
  var desc=document.getElementById('admin-desc-dish').value.trim();
  if(!name){alert('Введите название');return;}
  var ings=getIngRows('admin-ings-dish');
  var photo=photoData||document.getElementById('admin-photo-dish').value.trim();
  var dish={name:name,photo:photo,ingredients:ings,desc:desc};
  if(!DISHES[sec]) DISHES[sec]=[];
  if(editIndex>=0&&currentSubcat===sec) DISHES[sec][editIndex]=dish; else DISHES[sec].push(dish);
  var wasSec=sec, wasEdit=editIndex;
  closeAdmin();
  saveToFirebase().then(function(){
    if(currentSubcat===wasSec){currentItems=DISHES[wasSec]||[];renderList(currentItems,true);}
    else if(wasEdit<0) alert('Блюдо добавлено в раздел "'+wasSec+'"');
    renderZonesGrid();
  });
}
function deleteDish() {
  if(editIndex<0) return;
  if(!confirm('Удалить "'+currentItems[editIndex].name+'"?')) return;
  currentItems.splice(editIndex,1);
  closeAdmin(); saveToFirebase().then(function(){ renderList(currentItems,!currentIsPf); });
}
function savePf() {
  var zone=document.getElementById('admin-pf-zone').value;
  var name=document.getElementById('admin-name-pf').value.trim();
  var yld=document.getElementById('admin-yield-pf').value.trim();
  var desc=document.getElementById('admin-desc-pf').value.trim();
  if(!name){alert('Введите название');return;}
  var ings=getIngRows('admin-ings-pf');
  var item={name:name,photo:'',ingredients:ings,yield:yld,desc:desc};
  if(!PF[zone]) PF[zone]=[];
  if(editIndex>=0&&currentZone===zone) PF[zone][editIndex]=item; else PF[zone].push(item);
  var wasZone=zone, wasEdit=editIndex;
  closeAdmin();
  saveToFirebase().then(function(){
    if(currentZone===wasZone&&currentIsPf){currentItems=PF[wasZone]||[];renderList(currentItems,false);}
    else if(wasEdit<0) alert('П/Ф добавлен в "'+wasZone+'"');
    renderZonesGrid();
  });
}
function deletePf() {
  if(editIndex<0) return;
  if(!confirm('Удалить "'+currentItems[editIndex].name+'"?')) return;
  currentItems.splice(editIndex,1);
  closeAdmin(); saveToFirebase().then(function(){ renderList(currentItems,false); });
}

// ============================================================
// INGREDIENTS
// ============================================================
function clearIngRows(id){ document.getElementById(id).innerHTML=''; }
function addIngRow(containerId,name,weight){
  var c=document.getElementById(containerId);
  var row=document.createElement('div'); row.className='ing-row-admin';
  row.innerHTML='<input type="text" placeholder="Ингредиент" value="'+(name||'')+'">'
    +'<input type="text" placeholder="100 г" class="weight" value="'+(weight||'')+'">'
    +'<button class="ing-rm no-drag" onclick="this.parentNode.remove()">×</button>';
  c.appendChild(row);
}
function getIngRows(containerId){
  var rows=document.querySelectorAll('#'+containerId+' .ing-row-admin'), result=[];
  rows.forEach(function(row){ var inp=row.querySelectorAll('input'); var n=inp[0].value.trim(),w=inp[1].value.trim(); if(n) result.push({name:n,weight:w}); });
  return result;
}

// ============================================================
// PHOTO
// ============================================================
function onPhotoFileChange(e){ var f=e.target.files[0]; if(f) openPhotoCrop(f); }
function openPhotoCrop(file){
  var reader=new FileReader();
  reader.onload=function(ev){ var img=new Image(); img.onload=function(){ setupCropCanvas(img); document.getElementById('photo-crop-overlay').classList.add('open'); }; img.src=ev.target.result; };
  reader.readAsDataURL(file);
}
function openCropFromUrl(){
  var url=photoData||document.getElementById('admin-photo-dish').value.trim();
  if(!url){alert('Сначала введи ссылку');return;}
  var img=new Image(); img.crossOrigin='anonymous';
  img.onload=function(){ setupCropCanvas(img); document.getElementById('photo-crop-overlay').classList.add('open'); };
  img.onerror=function(){ alert('Не удалось загрузить фото'); };
  img.src=url;
}
var cropImg=null,cropScale=1,cropX=0,cropY=0,cropDragging=false,cropLastX=0,cropLastY=0,pinchStartDist=0,pinchStartScale=1;
function setupCropCanvas(img){
  cropImg=img; var canvas=document.getElementById('crop-canvas');
  var maxW=Math.min(window.innerWidth-20,800); canvas.width=maxW; canvas.height=Math.round(maxW*.75);
  var scale=Math.min(maxW/img.width,canvas.height/img.height); cropScale=scale;
  cropX=(maxW-img.width*scale)/2; cropY=(canvas.height-img.height*scale)/2; drawCrop();
}
function drawCrop(){
  var canvas=document.getElementById('crop-canvas'),ctx=canvas.getContext('2d');
  ctx.clearRect(0,0,canvas.width,canvas.height); ctx.fillStyle='#1a1a1a'; ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(cropImg,cropX,cropY,cropImg.width*cropScale,cropImg.height*cropScale);
}
function initCropCanvas(){
  var canvas=document.getElementById('crop-canvas');
  if (!canvas) return; // crop canvas may not exist in HTML — skip safely
  canvas.addEventListener('mousedown',function(e){cropDragging=true;cropLastX=e.clientX;cropLastY=e.clientY;});
  window.addEventListener('mousemove',function(e){if(!cropDragging)return;cropX+=e.clientX-cropLastX;cropY+=e.clientY-cropLastY;cropLastX=e.clientX;cropLastY=e.clientY;drawCrop();});
  window.addEventListener('mouseup',function(){cropDragging=false;});
  canvas.addEventListener('touchstart',function(e){if(e.touches.length===1){cropDragging=true;cropLastX=e.touches[0].clientX;cropLastY=e.touches[0].clientY;}else if(e.touches.length===2){cropDragging=false;pinchStartDist=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);pinchStartScale=cropScale;}e.preventDefault();},{passive:false});
  canvas.addEventListener('touchmove',function(e){if(e.touches.length===1&&cropDragging){cropX+=e.touches[0].clientX-cropLastX;cropY+=e.touches[0].clientY-cropLastY;cropLastX=e.touches[0].clientX;cropLastY=e.touches[0].clientY;drawCrop();}else if(e.touches.length===2){var d=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);cropScale=Math.max(0.1,Math.min(5,pinchStartScale*(d/pinchStartDist)));drawCrop();}e.preventDefault();},{passive:false});
  canvas.addEventListener('touchend',function(){cropDragging=false;});
  canvas.addEventListener('wheel',function(e){cropScale=Math.max(0.1,Math.min(5,cropScale+(e.deltaY<0?.1:-.1)));drawCrop();e.preventDefault();},{passive:false});
}
function cropZoom(delta){cropScale=Math.max(0.1,Math.min(5,cropScale+delta));drawCrop();}
function applyCrop(){
  var canvas=document.getElementById('crop-canvas');
  try{photoData=canvas.toDataURL('image/jpeg',0.97);}catch(e){photoData=canvas.toDataURL('image/png');}
  document.getElementById('photo-crop-overlay').classList.remove('open');
  document.getElementById('admin-photo-dish').value=''; updatePhotoPreview();
}
function closeCrop(){document.getElementById('photo-crop-overlay').classList.remove('open');}
function updatePhotoPreview(){
  var preview=document.getElementById('photo-preview');
  var cropBtn=document.getElementById('url-crop-btn');
  if(photoData){preview.style.display='block';preview.style.backgroundImage='url("'+photoData+'")';if(cropBtn)cropBtn.style.display='block';}
  else{preview.style.display='none';preview.style.backgroundImage='none';if(cropBtn)cropBtn.style.display='none';}
}

// ============================================================
// THEME
// ============================================================
function initTheme(){
  var saved=localStorage.getItem('fika_theme')||'light'; applyTheme(saved);
}
function applyTheme(theme){
  document.body.classList.toggle('dark',theme==='dark');
  localStorage.setItem('fika_theme',theme);
  var btn=document.getElementById('theme-btn'); if(btn) btn.textContent=theme==='dark'?'☀️':'🌙';
  var meta=document.getElementById('theme-color-meta'); if(meta) meta.setAttribute('content',theme==='dark'?'#141414':'#F7F4EF');
  document.documentElement.style.background=theme==='dark'?'#141414':'#F7F4EF';
}
function toggleTheme(){ applyTheme(document.body.classList.contains('dark')?'light':'dark'); }

// ============================================================
// GLOBAL EVENT DELEGATION — single handler for all clicks
// ============================================================
function initGlobalEvents() {
  var _lastHandled = 0; // debounce touchend+click double-fire

  function handle(e) {
    var now = Date.now();
    if (e.type === 'click' && now - _lastHandled < 400) return;
    if (e.type === 'touchend') _lastHandled = now;

    // SVG child elements don't have .closest — walk up to real Element
    var target = e.target;
    while (target && typeof target.closest !== 'function') {
      target = target.parentElement;
    }
    if (!target) return;

    // Edit button (pencil)
    var editBtn = target.closest('.edit-btn');
    if (editBtn) {
      var idx       = editBtn.dataset.editIdx;
      var sec       = editBtn.dataset.secName;
      var zone      = editBtn.dataset.zoneName;
      var fixedZone = editBtn.dataset.fixedZone;
      if (idx !== undefined && idx !== '') { openEditItem(parseInt(idx)); return; }
      if (sec  !== undefined) { openSectionStyleEditor(sec, editBtn.closest('.section-card'), (window.SECTION_META && window.SECTION_META[sec]) || {}); return; }
      if (zone !== undefined) { openZoneStyleEditor(zone, (window.ZONE_META && window.ZONE_META[zone]) || {}); return; }
      if (fixedZone !== undefined) { openZoneStyleEditor(fixedZone, (window.ZONE_META && window.ZONE_META[fixedZone]) || {}); return; }
      return;
    }

    // Section card
    var secCard = target.closest('.section-card[data-subcat-name]');
    if (secCard) { openSubcat(secCard.dataset.subcatName); return; }

    // Zone card
    var zoneCard = target.closest('.zone-card[data-zone-pf]');
    if (zoneCard) { openZonePf(zoneCard.dataset.zonePf); return; }

    // Action elements (dishes card, cutting card, add button)
    var actionEl = target.closest('[data-action]');
    if (actionEl) {
      var action = actionEl.dataset.action;
      if (action === 'openDishes')  { openDishesGrid(); return; }
      if (action === 'openCutting') { openCutting();    return; }
      if (action === 'openAdmin')   { openAdmin(currentIsPf ? 'pf' : 'dish', -1); return; }
    }

    // Item row
    var itemRow = target.closest('.item-row[data-idx]');
    if (itemRow && !target.closest('.edit-btn') && !target.closest('.drag-handle')) {
      var itemIdx = parseInt(itemRow.dataset.idx);
      var isBluda = itemRow.dataset.isBluda === '1';
      if (!isNaN(itemIdx) && currentItems[itemIdx]) {
        openDetail(currentItems[itemIdx], isBluda); return;
      }
    }
  }

  document.addEventListener('click',    handle);
  document.addEventListener('touchend', handle, {passive: true});
}

// ============================================================
// INIT — called by loader after auth scripts are ready
// ============================================================
function appInit() {
  initTheme();
  initSearch();
  initAdmin();
  initCropCanvas();
  initGlobalEvents();
}

// appInit() is called by loader.js after auth scripts load
// Do NOT call it here — loader controls the init sequence
