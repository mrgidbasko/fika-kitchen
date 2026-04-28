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
    if (typeof loadData === 'function') loadData();
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
    loadUsersList();
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
