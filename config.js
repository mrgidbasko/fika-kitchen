// config.js — DEV/PROD режим
// ============================================================
// Автоматически: localhost / 127.0.0.1 = DEV, всё остальное = PROD
// DEV данные хранятся в /dev/... той же Firebase (users — общие!)
// ============================================================

var IS_DEV = (
  location.hostname === 'localhost' ||
  location.hostname === '127.0.0.1'
);

var DB_PREFIX = IS_DEV ? '/dev' : '';

// Показываем индикатор DEV режима
if (IS_DEV) {
  document.addEventListener('DOMContentLoaded', function() {
    var badge = document.createElement('div');
    badge.id = 'dev-badge';
    badge.textContent = 'DEV';
    badge.style.cssText = [
      'position:fixed',
      'bottom:60px',
      'left:50%',
      'transform:translateX(-50%)',
      'background:#e24b4a',
      'color:#fff',
      'font-size:11px',
      'font-weight:700',
      'letter-spacing:1px',
      'padding:3px 10px',
      'border-radius:20px',
      'z-index:9999',
      'pointer-events:none',
      'opacity:0.85'
    ].join(';');
    document.body.appendChild(badge);
  });
}
