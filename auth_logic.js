// auth_logic.js — Auth UI + Admin Panel

// ============================================================
// AUTH SCREEN
// ============================================================

function showAuthScreen() {
  var screen = document.getElementById('auth-screen');
  if (screen) screen.style.display = 'flex';
  var app = document.querySelector('.app');
  if (app) app.style.display = 'none';
  var tb = document.getElementById('theme-btn');
  if (tb) tb.style.display = 'none';
  _hideZonesLabel();
  // Clear fields and errors
  var loginEl = document.getElementById('auth-login');
  var passEl  = document.getElementById('auth-password');
  var errEl   = document.getElementById('auth-error');
  var btn     = document.getElementById('auth-submit-btn');
  if (loginEl)  loginEl.value = '';
  if (passEl)   passEl.value  = '';
  if (errEl)    errEl.style.display = 'none';
  if (btn)    { btn.disabled = false; btn.textContent = 'Войти'; }
  // Re-bind submit in case it was lost
  if (btn) {
    btn.onclick = function() { if (typeof authSubmit === 'function') authSubmit(); };
  }
  // Focus login field
  setTimeout(function() { if (loginEl) loginEl.focus(); }, 100);
}

function hideAuthScreen() {
  var screen = document.getElementById('auth-screen');
  if (screen) screen.style.display = 'none';
  var app = document.querySelector('.app');
  if (app) app.style.display = '';
  var tb = document.getElementById('theme-btn');
  if (tb) tb.style.display = '';
  _showZonesLabel();
  _updateProfileBar();
  // Set admin/cook access based on role
  if (isAdmin()) {
    if (typeof unlockAdmin === 'function') unlockAdmin();
  } else {
    if (typeof lockAdmin === 'function') lockAdmin();
  }
}

function _hideZonesLabel() {
  var zw = document.querySelector('.zones-wrap');
  if (zw) zw.querySelectorAll('div[style*="text-transform:uppercase"]')
    .forEach(function(el){ el.style.display='none'; });
}

function _showZonesLabel() {
  var zw = document.querySelector('.zones-wrap');
  if (zw) zw.querySelectorAll('div[style*="text-transform:uppercase"]')
    .forEach(function(el){ el.style.display=''; });
}

function _updateProfileBar() {
  var nameEl = document.getElementById('profile-name');
  var roleEl = document.getElementById('profile-role');
  if (nameEl && currentUser) nameEl.textContent = currentUser.name || currentUser.login;
  if (roleEl && currentUser) roleEl.textContent = currentUser.role === 'admin' ? 'Администратор' : 'Повар';
  // Show admin panel button only for admins
  var apb = document.getElementById('admin-panel-btn');
  if (apb) apb.style.display = isAdmin() ? 'block' : 'none';
}

function toggleProfileMenu() {
  var menu = document.getElementById('profile-menu');
  if (!menu) return;
  var open = menu.style.display !== 'none';
  menu.style.display = open ? 'none' : 'block';
  if (!open) {
    setTimeout(function() {
      document.addEventListener('click', function close(e) {
        var btn = document.getElementById('profile-btn');
        if (btn && !btn.contains(e.target) && !menu.contains(e.target)) {
          menu.style.display = 'none';
          document.removeEventListener('click', close);
        }
      });
    }, 50);
  }
}

// ============================================================
// LOGIN FORM
// ============================================================

function authShowError(msg) {
  var errors = {
    'EMAIL_NOT_FOUND': 'Пользователь не найден',
    'INVALID_PASSWORD': 'Неверный пароль',
    'USER_DISABLED': 'Аккаунт заблокирован',
    'ACCOUNT_DISABLED': 'Доступ запрещён. Обратитесь к администратору.',
    'INVALID_LOGIN_CREDENTIALS': 'Неверный логин или пароль',
    'TOO_MANY_ATTEMPTS_TRY_LATER': 'Слишком много попыток. Подождите.'
  };
  var el = document.getElementById('auth-error');
  if (el) { el.textContent = errors[msg] || msg; el.style.display = 'block'; }
}

function authSubmit() {
  var login    = (document.getElementById('auth-login').value || '').trim();
  var password = (document.getElementById('auth-password').value || '').trim();
  var btn      = document.getElementById('auth-submit-btn');
  if (!login || !password) { authShowError('Заполни все поля'); return; }
  var errEl = document.getElementById('auth-error');
  if (errEl) errEl.style.display = 'none';
  btn.disabled = true; btn.textContent = '...';
  authLogin(login, password)
    .then(function() {
      hideAuthScreen();
      if (typeof loadData === 'function') loadData();
    })
    .catch(function(err) {
      authShowError(err.message);
      btn.disabled = false; btn.textContent = 'Войти';
    });
}

function initAuth() {
  var user = authRestoreSession();
  if (user) {
    hideAuthScreen();
    // Гарантируем свежий ID-токен ДО загрузки данных: токен живёт 1 час,
    // после неактивности он почти всегда протухший, и Firebase Rules
    // вернут 401 на все 6 fbGet'ов в loadData → битый главный экран.
    var ensure = (typeof authGetFreshToken === 'function')
      ? authGetFreshToken()
      : Promise.resolve(currentUser && currentUser.token);
    ensure.then(function() {
      if (typeof loadData === 'function') loadData();
    }).catch(function() {
      // Даже если рефреш упал — пробуем loadData (он сам разрулит ретраем в catch)
      if (typeof loadData === 'function') loadData();
    });
  } else {
    showAuthScreen();
  }
}

// ============================================================
// ADMIN PANEL
// ============================================================

function openAdminPanel() {
  if (!isAdmin()) return;
  toggleProfileMenu();
  var panel = document.getElementById('admin-panel-overlay');
  if (panel) {
    panel.classList.add('open');
    switchAdminPanelTab('users');
  }
}

function closeAdminPanel() {
  var panel = document.getElementById('admin-panel-overlay');
  if (panel) panel.classList.remove('open');
}

function loadUsersList() {
  var list = document.getElementById('users-list');
  if (!list) return;
  list.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:20px;">Загрузка...</div>';
  adminGetUsers().then(function(users) {
    list.innerHTML = '';
    if (!users) { list.innerHTML = '<div style="color:var(--text-muted);padding:12px;">Нет пользователей</div>'; return; }
    Object.keys(users).forEach(function(uid) {
      var u = users[uid];
      if (!uid || uid === 'undefined') return;
      if (u && u.disabled === true) return; // скрываем заблокированных
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:12px 0;border-bottom:1px solid var(--border);';
      row.innerHTML = '<div style="flex:1;min-width:0;">'
        + '<div style="font-size:15px;font-weight:500;color:var(--text-primary);">' + (u.name || u.login || '') + '</div>'
        + '<div style="font-size:12px;color:var(--text-muted);">' + (u.login || '') + '</div>'
        + '</div>'
        + '<select style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:5px 8px;font-size:13px;color:var(--text-primary);cursor:pointer;" onchange="adminChangeRole(\'' + uid + '\',this.value)">'
        + '<option value="cook"' + (u.role==='cook'?' selected':'') + '>Повар</option>'
        + '<option value="admin"' + (u.role==='admin'?' selected':'') + '>Админ</option>'
        + '</select>'
        + '<button onclick="adminRemoveUser(\'' + uid + '\',this)" style="background:none;border:none;color:var(--text-muted);font-size:20px;cursor:pointer;padding:0 4px;line-height:1;">×</button>';
      list.appendChild(row);
    });
  }).catch(function() {
    list.innerHTML = '<div style="color:#e24b4a;padding:12px;">Ошибка загрузки</div>';
  });
}

function adminChangeRole(uid, role) {
  adminUpdateRole(uid, role).catch(function() { alert('Ошибка изменения роли'); });
}

function adminRemoveUser(uid, btn) {
  if (!confirm('Удалить пользователя?')) return;
  adminDeleteUser(uid).then(function() {
    var row = btn.closest('div[style*="border-bottom"]');
    if (row) row.remove();
  }).catch(function() { alert('Ошибка удаления'); });
}

function adminCreateNewUser() {
  var login    = (document.getElementById('new-user-login').value || '').trim();
  var password = (document.getElementById('new-user-password').value || '').trim();
  var name     = (document.getElementById('new-user-name').value || '').trim();
  var role     = document.getElementById('new-user-role').value;
  var btn      = document.getElementById('create-user-btn');

  if (!login || !password) { alert('Введи логин и пароль'); return; }
  if (password.length < 6) { alert('Пароль минимум 6 символов'); return; }

  btn.disabled = true; btn.textContent = '...';
  adminCreateUser(login, password, name || login, role)
    .then(function() {
      document.getElementById('new-user-login').value = '';
      document.getElementById('new-user-password').value = '';
      document.getElementById('new-user-name').value = '';
      btn.disabled = false; btn.textContent = 'Создать';
      loadUsersList();
    })
    .catch(function(err) {
      var msgs = {
        'EMAIL_EXISTS': 'Логин уже занят',
        'WEAK_PASSWORD': 'Пароль слишком короткий'
      };
      alert(msgs[err.message] || err.message);
      btn.disabled = false; btn.textContent = 'Создать';
    });
}

// ============================================================
// ADMIN PANEL — TABS
// ============================================================

function switchAdminPanelTab(tab) {
  // Переключаем табы
  document.querySelectorAll('[data-panel-tab]').forEach(function(btn) {
    if (btn.dataset.panelTab === tab) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
  // Показываем нужный контент
  var usersTab       = document.getElementById('admin-tab-users');
  var permissionsTab = document.getElementById('admin-tab-permissions');
  if (usersTab)       usersTab.style.display       = tab === 'users'       ? 'block' : 'none';
  if (permissionsTab) permissionsTab.style.display = tab === 'permissions' ? 'block' : 'none';
  // Загружаем данные нужной вкладки
  if (tab === 'users')       loadUsersList();
  if (tab === 'permissions') loadPermissionsList();
}

// ============================================================
// PERMISSIONS TAB
// ============================================================

var PERMISSIONS_LIST = [
  { key: 'writeOff',    label: 'Списание' },
  { key: 'editRaw',     label: 'Редактирование П/Ф' },
  { key: 'editDishes',  label: 'Редактирование блюд' }
];

function loadPermissionsList() {
  var list = document.getElementById('permissions-list');
  if (!list) return;
  list.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:20px;">Загрузка...</div>';

  adminGetUsers().then(function(users) {
    list.innerHTML = '';
    if (!users) {
      list.innerHTML = '<div style="color:var(--text-muted);padding:12px;">Нет пользователей</div>';
      return;
    }

    Object.keys(users).forEach(function(uid) {
      var u = users[uid];
      if (!uid || uid === 'undefined') return;
      var perms = (u && u.permissions) ? u.permissions : {};

      var card = document.createElement('div');
      card.style.cssText = 'padding:12px 0;border-bottom:1px solid var(--border);';

      // Шапка пользователя
      var header = document.createElement('div');
      header.style.cssText = 'margin-bottom:8px;';
      header.innerHTML = '<div style="font-size:15px;font-weight:500;color:var(--text-primary);">' + (u.name || u.login || '') + '</div>'
        + '<div style="font-size:12px;color:var(--text-muted);">' + (u.login || '') + ' · ' + (u.role === 'admin' ? 'Администратор' : 'Повар') + '</div>';
      card.appendChild(header);

      // Чекбоксы — через addEventListener, не inline onchange
      var grid = document.createElement('div');
      grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:6px;';

      PERMISSIONS_LIST.forEach(function(p) {
        // admin по умолчанию имеет все права; cook — нет (если не задано явно)
        var defaultVal = u.role === 'admin';
        var checked = (perms[p.key] !== undefined && perms[p.key] !== null)
          ? !!perms[p.key]
          : defaultVal;

        var lbl = document.createElement('label');
        lbl.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text-primary);cursor:pointer;padding:4px 0;';

        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = checked;
        cb.style.cssText = 'width:16px;height:16px;cursor:pointer;accent-color:var(--accent2,#C04F14);flex-shrink:0;';
        cb.dataset.uid    = uid;
        cb.dataset.permKey = p.key;

        cb.addEventListener('change', function() {
          var cbUid = this.dataset.uid;
          var cbKey = this.dataset.permKey;
          var cbVal = this.checked;
          savePermission(cbUid, cbKey, cbVal);
        });

        lbl.appendChild(cb);
        lbl.appendChild(document.createTextNode(p.label));
        grid.appendChild(lbl);
      });

      card.appendChild(grid);
      list.appendChild(card);
    });
  }).catch(function(e) {
    console.error('loadPermissionsList error:', e);
    list.innerHTML = '<div style="color:#e24b4a;padding:12px;">Ошибка загрузки</div>';
  });
}

function savePermission(uid, permKey, value) {
  if (!uid || uid === 'undefined') {
    console.error('savePermission: invalid uid', uid);
    return;
  }
  if (!currentUser) {
    console.error('savePermission: no currentUser');
    return;
  }

  // Получаем токен (с возможностью обновления)
  var tokenPromise = typeof authGetFreshToken === 'function'
    ? authGetFreshToken()
    : Promise.resolve(currentUser.token);

  tokenPromise.then(function(token) {
    if (!token) { console.error('savePermission: no token'); return; }

    var url = FIREBASE_URL + '/users/' + uid + '/permissions/' + permKey + '.json?auth=' + token;
    return fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value)
    });
  }).then(function(r) {
    if (!r) return;
    if (r.status === 401 || r.status === 403) {
      // Токен протух — пробуем обновить и повторить
      console.warn('savePermission: token expired, refreshing...');
      if (typeof authRefreshToken === 'function') {
        authRefreshToken().then(function(newToken) {
          if (!newToken) { alert('Сессия истекла. Перезайди в аккаунт.'); return; }
          var url2 = FIREBASE_URL + '/users/' + uid + '/permissions/' + permKey + '.json?auth=' + newToken;
          fetch(url2, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(value)
          }).then(function(r2) {
            if (!r2.ok) console.error('savePermission retry failed:', r2.status);
          });
        });
      } else {
        alert('Сессия истекла. Перезайди в аккаунт.');
      }
      return;
    }
    if (!r.ok) {
      r.text().then(function(t) { console.error('savePermission error:', r.status, t); });
    }
  }).catch(function(e) {
    console.error('savePermission fetch error:', e);
    alert('Ошибка сети при сохранении доступа');
  });
}

// ============================================================
// FALLBACK: hasPermission(key) — используй вместо прямой проверки роли
// ============================================================
function hasPermission(key) {
  if (!currentUser) return false;
  if (currentUser.role === 'admin') return true;
  if (currentUser.permissions && currentUser.permissions[key] !== undefined) {
    return !!currentUser.permissions[key];
  }
  return false;
}
