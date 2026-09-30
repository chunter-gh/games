const fs = require('fs');
const path = require('path');

// Keep Castle Walk available by direct URL, but hide it from automatic game discovery.
const originalReaddir = fs.readdir.bind(fs);
fs.readdir = function (...args) {
  const callbackIndex = args.findIndex(arg => typeof arg === 'function');
  if (callbackIndex === -1) return originalReaddir(...args);

  const callback = args[callbackIndex];
  args[callbackIndex] = (err, entries) => {
    if (!err && Array.isArray(entries)) {
      entries = entries.filter(entry => {
        const name = typeof entry === 'string' ? entry : entry && entry.name;
        return String(name || '').toLowerCase() !== 'castlewalk.html';
      });
    }
    callback(err, entries);
  };
  return originalReaddir(...args);
};

// Inject the hidden Castle Walk launcher into the existing game-room page.
const originalReadFile = fs.readFile.bind(fs);
fs.readFile = function (...args) {
  const fileArg = args[0];
  const callbackIndex = args.findIndex(arg => typeof arg === 'function');
  if (callbackIndex === -1) return originalReadFile(...args);

  const callback = args[callbackIndex];
  args[callbackIndex] = (err, data) => {
    if (!err && path.basename(String(fileArg)).toLowerCase() === 'index.html') {
      let html = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
      const secretLauncher = `
<script id="castle-walk-coconut-launcher">
(() => {
  const CASTLE_URL = 'castlewalk.html';

  function removeCastleTile() {
    document.querySelectorAll('.game-button').forEach(button => {
      if ((button.textContent || '').toUpperCase().includes('CASTLE WALK')) {
        button.remove();
      }
    });
  }

  function wireCoconut() {
    const coconut = document.getElementById('fallingCoconut');
    if (!coconut || coconut.dataset.castleLauncher === '1') return;

    coconut.dataset.castleLauncher = '1';
    coconut.style.pointerEvents = 'auto';
    coconut.style.touchAction = 'manipulation';

    const syncCursor = () => {
      const falling = coconut.classList.contains('falling');
      coconut.style.cursor = falling ? 'pointer' : 'default';
      coconut.setAttribute('aria-label', falling ? 'Open Castle Walk' : '');
      coconut.setAttribute('title', falling ? 'Castle Walk' : '');
    };

    new MutationObserver(syncCursor).observe(coconut, {
      attributes: true,
      attributeFilter: ['class']
    });
    syncCursor();

    const launch = event => {
      if (!coconut.classList.contains('falling')) return;
      event.preventDefault();
      event.stopPropagation();
      window.location.href = CASTLE_URL;
    };

    coconut.addEventListener('click', launch);
    coconut.addEventListener('pointerup', event => {
      if (event.pointerType === 'touch') launch(event);
    });
  }

  function initSecretCastleLauncher() {
    removeCastleTile();
    wireCoconut();

    const menu = document.getElementById('gameMenu') || document.querySelector('.menu');
    if (menu) {
      new MutationObserver(removeCastleTile).observe(menu, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSecretCastleLauncher, { once: true });
  } else {
    initSecretCastleLauncher();
  }
})();
</script>`;

      html = html.includes('</body>')
        ? html.replace('</body>', `${secretLauncher}\n</body>`)
        : html + secretLauncher;
      data = Buffer.from(html, 'utf8');
    }
    callback(err, data);
  };

  return originalReadFile(...args);
};

require('./server11');
