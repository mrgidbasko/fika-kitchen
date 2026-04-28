// offline-queue.js — Универсальная офлайн-очередь
// ============================================================
// Используется для: разделки (cutting) и списания (writeoff, в будущем)
// Хранит очередь в localStorage, автоматически отправляет при восстановлении сети
// Подключается в index.html ПОСЛЕ config.js, ДО cutting.js и других модулей
// ============================================================

var OfflineQueue = (function() {

  var STORAGE_KEY = 'fika_offline_queue';
  var _handlers   = {}; // { type: function(item) → Promise }
  var _processing = false;

  // ── Чтение / запись очереди ──────────────────────────────
  function _load() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch(e) {
      return [];
    }
  }

  function _save(queue) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
    } catch(e) {
      console.error('[OfflineQueue] localStorage write error:', e);
    }
  }

  // ── Публичный API ────────────────────────────────────────

  /**
   * Зарегистрировать обработчик для типа операции.
   * handler(item) должен вернуть Promise.
   * При успехе — запись удаляется из очереди.
   * При ошибке — остаётся для следующей попытки.
   *
   * Пример:
   *   OfflineQueue.register('cutting_record', function(item) {
   *     return cFbPush('/records', item.data);
   *   });
   */
  function register(type, handler) {
    _handlers[type] = handler;
  }

  /**
   * Добавить операцию в очередь.
   * item = { type, data, ...любые доп. поля }
   * Возвращает уникальный localId записи.
   */
  function enqueue(item) {
    var queue = _load();
    var localId = 'local_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    queue.push(Object.assign({}, item, { _localId: localId, _addedAt: Date.now() }));
    _save(queue);
    _updateBadge();
    return localId;
  }

  /**
   * Удалить конкретную запись из очереди по localId.
   */
  function remove(localId) {
    var queue = _load().filter(function(i) { return i._localId !== localId; });
    _save(queue);
    _updateBadge();
  }

  /**
   * Количество записей в очереди.
   */
  function count() {
    return _load().length;
  }

  /**
   * Все записи очереди заданного типа (или все если type не указан).
   */
  function getAll(type) {
    var queue = _load();
    return type ? queue.filter(function(i){ return i.type === type; }) : queue;
  }

  /**
   * Попытаться отправить все накопленные записи.
   * Вызывается автоматически при восстановлении сети.
   * Можно вызвать вручную в любой момент.
   */
  function flush() {
    if (_processing) return;
    var queue = _load();
    if (!queue.length) return;
    if (!navigator.onLine) return;

    _processing = true;
    _updateNetDot('syncing');
    _processNext(queue, 0, function() {
      _processing = false;
      _updateNetDot(navigator.onLine ? 'online' : 'offline');
      _updateBadge();
    });
  }

  function _processNext(queue, index, done) {
    if (index >= queue.length) { done(); return; }

    var item    = queue[index];
    var handler = _handlers[item.type];

    if (!handler) {
      // Нет обработчика — пропускаем (не удаляем, вдруг зарегистрируют позже)
      console.warn('[OfflineQueue] No handler for type:', item.type);
      _processNext(queue, index + 1, done);
      return;
    }

    handler(item).then(function() {
      // Успех — удаляем из очереди
      remove(item._localId);
      // Уведомляем модуль об успешной синхронизации
      _notify(item);
      _processNext(_load(), 0, done); // перечитываем — очередь могла измениться
    }).catch(function(e) {
      console.warn('[OfflineQueue] Failed to sync item, will retry later:', item._localId, e);
      done(); // прекращаем попытки до следующего события online
    });
  }

  // ── Индикатор очереди ────────────────────────────────────
  function _updateBadge() {
    var n   = count();
    var el  = document.getElementById('offline-queue-badge');
    if (!el) return;
    if (n > 0) {
      el.textContent = n + ' ' + plural(n, 'запись', 'записи', 'записей') + ' не отправлено';
      el.style.display = 'block';
    } else {
      el.style.display = 'none';
    }
  }

  function plural(n, one, two, five) {
    var m10=n%10, m100=n%100;
    if (m100>=11&&m100<=19) return five;
    if (m10===1) return one;
    if (m10>=2&&m10<=4) return two;
    return five;
  }

  // ── Подписчики на успешную синхронизацию ────────────────
  var _syncListeners = [];

  function onSynced(fn) {
    _syncListeners.push(fn);
  }

  function _notify(item) {
    _syncListeners.forEach(function(fn) {
      try { fn(item); } catch(e) {}
    });
  }

  // ── Слушатели сети ───────────────────────────────────────
  window.addEventListener('online', function() {
    console.log('[OfflineQueue] Online — flushing queue...');
    _updateNetDot('online');
    setTimeout(flush, 500);
  });

  window.addEventListener('offline', function() {
    _updateNetDot('offline');
  });

  // Инициализация индикатора после загрузки DOM
  document.addEventListener('DOMContentLoaded', function() {
    _injectBadge();
    _updateBadge();
    _updateNetDot(navigator.onLine ? 'online' : 'offline');
    // Попробуем отправить при старте если есть очередь и есть сеть
    if (navigator.onLine && count() > 0) {
      setTimeout(flush, 1500);
    }
  });

  function _updateNetDot(state) {
    // state: 'online' | 'offline' | 'syncing'
    var dot = document.getElementById('net-dot');
    if (!dot) return;
    dot.classList.remove('offline', 'syncing');
    if (state === 'offline') dot.classList.add('offline');
    if (state === 'syncing') dot.classList.add('syncing');
  }

  function _injectBadge() {
    if (document.getElementById('offline-queue-badge')) return;
    var badge = document.createElement('div');
    badge.id = 'offline-queue-badge';
    badge.style.cssText = [
      'display:none',
      'position:fixed',
      'bottom:100px',
      'left:50%',
      'transform:translateX(-50%)',
      'background:#e8a020',
      'color:#fff',
      'font-size:11px',
      'font-weight:600',
      'letter-spacing:0.3px',
      'padding:4px 12px',
      'border-radius:20px',
      'z-index:9998',
      'pointer-events:none',
      'white-space:nowrap',
      'box-shadow:0 2px 8px rgba(0,0,0,0.15)'
    ].join(';');
    document.body.appendChild(badge);
  }

  // ── Публичный интерфейс ──────────────────────────────────
  return {
    register:  register,
    enqueue:   enqueue,
    remove:    remove,
    count:     count,
    getAll:    getAll,
    flush:     flush,
    onSynced:  onSynced
  };

})();
