// ============================================================
// AUTH LOADER — runs before app code
// Loads auth scripts, builds UI, checks session
// ============================================================
(function() {
  'use strict';

  var SCRIPTS_LOADED = false;

  function loadScript(src, cb) {
    var existing = document.querySelector('script[src="' + src + '"]');
    if (existing) { if (cb) cb(); return; }
    var s = document.createElement('script');
    s.src = src;
    s.onload = cb || function(){};
    s.onerror = function() { console.error('Failed to load', src); if (cb) cb(); };
    document.head.appendChild(s);
  }

  function buildAuthScreen() {
    if (document.getElementById('auth-screen')) return;
    var el = document.createElement('div');
    el.id = 'auth-screen';
    el.style.cssText = 'display:none;position:fixed;inset:0;background:var(--bg);z-index:9998;align-items:center;justify-content:center;flex-direction:column;padding:20px;';
    el.innerHTML = [
      '<div style="width:100%;max-width:360px;">',
        '<div style="font-family:Syne,sans-serif;font-size:28px;font-weight:700;text-align:center;margin-bottom:8px;">',
          'Fika <span style="color:#C04F14;">Kitchen</span>',
        '</div>',
        '<div style="font-size:13px;color:#ABA59E;text-align:center;margin-bottom:32px;">Войдите в аккаунт</div>',
        '<div style="background:var(--surface,#fff);border-radius:20px;padding:24px;box-shadow:0 8px 32px rgba(0,0,0,.10);">',
          '<div id="auth-error" style="display:none;background:#fff0f0;color:#e24b4a;border-radius:8px;padding:10px 12px;font-size:13px;margin-bottom:14px;"></div>',
          '<div style="margin-bottom:12px;">',
            '<label style="display:block;font-size:11px;font-weight:500;text-transform:uppercase;color:#ABA59E;margin-bottom:6px;">Логин</label>',
            '<input id="auth-login" type="text" autocomplete="username" placeholder=""',
              ' style="width:100%;background:var(--bg,#F7F4EF);border:1px solid rgba(26,26,26,.08);border-radius:10px;padding:11px 12px;font-size:15px;outline:none;color:var(--text-primary,#1A1A1A);-webkit-user-select:text;user-select:text;">',
          '</div>',
          '<div style="margin-bottom:20px;">',
            '<label style="display:block;font-size:11px;font-weight:500;text-transform:uppercase;color:#ABA59E;margin-bottom:6px;">Пароль</label>',
            '<input id="auth-password" type="password" autocomplete="current-password" placeholder="••••••••"',
              ' style="width:100%;background:var(--bg,#F7F4EF);border:1px solid rgba(26,26,26,.08);border-radius:10px;padding:11px 12px;font-size:15px;outline:none;color:var(--text-primary,#1A1A1A);-webkit-user-select:text;user-select:text;">',
          '</div>',
          '<button id="auth-submit-btn"',
            ' style="width:100%;padding:14px;background:#C04F14;color:#fff;border:none;border-radius:10px;font-size:16px;font-weight:500;cursor:pointer;">',
            'Войти',
          '</button>',
        '</div>',
      '</div>'
    ].join('');
    document.body.appendChild(el);

    // Bind events
    document.getElementById('auth-submit-btn').addEventListener('click', function() {
      if (typeof authSubmit === 'function') authSubmit();
    });
    ['auth-login', 'auth-password'].forEach(function(id) {
      var inp = document.getElementById(id);
      if (inp) inp.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && typeof authSubmit === 'function') authSubmit();
      });
    });
  }

  function buildAdminPanel() {
    if (document.getElementById('admin-panel-overlay')) return;
    var el = document.createElement('div');
    el.className = 'admin-overlay';
    el.id = 'admin-panel-overlay';
    el.innerHTML = [
      '<div class="admin-sheet" style="max-height:88vh;overflow-y:auto;-webkit-overflow-scrolling:touch;">',
        '<div class="admin-top">',
          '<div class="admin-title">Пользователи</div>',
          '<button class="admin-close" onclick="closeAdminPanel()">&times;</button>',
        '</div>',
        '<div style="background:var(--surface2);border-radius:var(--radius-sm,10px);padding:14px;margin-bottom:16px;">',
          '<div style="font-size:12px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px;">Новый пользователь</div>',
          '<div class="admin-field"><label>Логин</label>',
            '<input id="new-user-login" type="text" placeholder="ivan"',
              ' style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);padding:9px 12px;font-size:14px;color:var(--text-primary);outline:none;-webkit-user-select:text;user-select:text;">',
          '</div>',
          '<div class="admin-field"><label>Имя</label>',
            '<input id="new-user-name" type="text" placeholder="Иван Петров"',
              ' style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);padding:9px 12px;font-size:14px;color:var(--text-primary);outline:none;-webkit-user-select:text;user-select:text;">',
          '</div>',
          '<div class="admin-field"><label>Пароль</label>',
            '<input id="new-user-password" type="password" placeholder="минимум 6 символов"',
              ' style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);padding:9px 12px;font-size:14px;color:var(--text-primary);outline:none;-webkit-user-select:text;user-select:text;">',
          '</div>',
          '<div class="admin-field"><label>Роль</label>',
            '<select id="new-user-role" style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);padding:9px 12px;font-size:14px;color:var(--text-primary);outline:none;">',
              '<option value="cook">Повар</option>',
              '<option value="admin">Администратор</option>',
            '</select>',
          '</div>',
          '<button id="create-user-btn" onclick="adminCreateNewUser()"',
            ' style="width:100%;padding:11px;background:#C04F14;color:#fff;border:none;border-radius:var(--radius-sm);font-size:14px;font-weight:500;cursor:pointer;">',
            'Создать',
          '</button>',
        '</div>',
        '<div style="font-size:12px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">Список пользователей</div>',
        '<div id="users-list"></div>',
      '</div>'
    ].join('');
    document.body.appendChild(el);
  }

  function buildProfileBtn() {
    if (document.getElementById('profile-btn')) return;
    var brand = document.getElementById('brand-tap');
    if (!brand) return;

    var headerRight = document.getElementById('header-right');
    if (!headerRight) return;

    var profileBtn = document.createElement('button');
    profileBtn.id = 'profile-btn';
    profileBtn.style.cssText = 'width:36px;height:36px;border-radius:50%;background:#C04F14;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;';
    profileBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>';

    var themeToggle = document.createElement('button');
    themeToggle.id = 'theme-btn';
    themeToggle.className = 'theme-btn';
    themeToggle.title = 'Тема';
    themeToggle.onclick = function() { if (typeof toggleTheme === 'function') toggleTheme(); };

    var menu = document.createElement('div');
    menu.id = 'profile-menu';
    menu.style.cssText = 'display:none;position:absolute;top:calc(100% + 8px);right:0;background:var(--surface,#fff);border:1px solid var(--border);border-radius:16px;padding:8px;box-shadow:0 8px 32px rgba(0,0,0,.10);min-width:190px;z-index:400;';

    var nameDiv = document.createElement('div');
    nameDiv.id = 'profile-name';
    nameDiv.style.cssText = 'font-size:14px;font-weight:500;color:var(--text-primary);padding:6px 10px 2px;';

    var roleDiv = document.createElement('div');
    roleDiv.id = 'profile-role';
    roleDiv.style.cssText = 'font-size:11px;color:var(--text-muted);padding:0 10px 10px;border-bottom:1px solid var(--border);margin-bottom:6px;';

    try {
      var u = JSON.parse(localStorage.getItem('fika_user') || '{}');
      nameDiv.textContent = u.name || u.login || '';
      roleDiv.textContent = u.role === 'admin' ? 'Администратор' : 'Повар';
    } catch(e) {}

    var adminPanelBtn = document.createElement('button');
    adminPanelBtn.id = 'admin-panel-btn';
    adminPanelBtn.style.cssText = 'display:none;width:100%;padding:9px 10px;background:none;border:none;border-radius:10px;font-family:inherit;font-size:14px;font-weight:500;color:var(--text-primary);cursor:pointer;text-align:left;';
    adminPanelBtn.textContent = 'Пользователи';
    adminPanelBtn.addEventListener('click', function() {
      if (typeof openAdminPanel === 'function') openAdminPanel();
    });

    var logoutBtn = document.createElement('button');
    logoutBtn.style.cssText = 'width:100%;padding:9px 10px;background:none;border:none;border-radius:10px;font-family:inherit;font-size:14px;font-weight:500;color:#e24b4a;cursor:pointer;text-align:left;';
    logoutBtn.textContent = 'Выйти';
    logoutBtn.addEventListener('click', function() {
      if (typeof authLogout === 'function') authLogout();
    });

    menu.appendChild(nameDiv);
    menu.appendChild(roleDiv);
    menu.appendChild(adminPanelBtn);
    menu.appendChild(logoutBtn);

    profileBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      var isOpen = menu.style.display !== 'none';
      menu.style.display = isOpen ? 'none' : 'block';
      if (!isOpen) {
        setTimeout(function() {
          document.addEventListener('click', function closeMenu() {
            menu.style.display = 'none';
            document.removeEventListener('click', closeMenu);
          });
        }, 10);
      }
    });

    // Профиль сверху, toggle снизу — в правой колонке шапки
    headerRight.style.position = 'relative';
    headerRight.appendChild(profileBtn);
    headerRight.appendChild(themeToggle);
    headerRight.appendChild(menu);
  }

  function onAllScriptsLoaded() {
    SCRIPTS_LOADED = true;
    // Set adminUnlocked based on role — not PIN
    if (typeof authRestoreSession === 'function') {
      var user = authRestoreSession();
      if (user && user.role === 'admin') {
        if (typeof adminUnlocked !== 'undefined') adminUnlocked = true;
        localStorage.setItem('fika_admin', '1');
      } else {
        // Cook or not logged in — ensure admin is locked
        if (typeof adminUnlocked !== 'undefined') adminUnlocked = false;
        localStorage.removeItem('fika_admin');
        // Clear any leftover admin state
        if (typeof lockAdmin === 'function') lockAdmin();
      }
    }
    // Init app first (registers event handlers), then auth
    if (typeof appInit === 'function') {
      appInit();
    }
    // Trigger initAuth
    if (typeof initAuth === 'function') {
      initAuth();
    }
  }

  document.addEventListener('DOMContentLoaded', function() {
    // 1. Hide zones label until logged in
    var zw = document.querySelector('.zones-wrap');
    if (zw) zw.querySelectorAll('div[style*="text-transform:uppercase"]')
      .forEach(function(el){ el.style.display = 'none'; });

    // 2. Build static UI elements
    buildAuthScreen();
    buildAdminPanel();
    buildProfileBtn();

    // 3. Load auth scripts in order
    loadScript('/auth.js', function() {
      loadScript('/auth_logic.js', function() {
        onAllScriptsLoaded();
      });
    });
  });
})();

