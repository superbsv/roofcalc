// Автооновлення: якщо на сервері вже нова збірка (інший main.js в asset-manifest.json), а браузер показує
// стару з кешу — перезавантажуємо сторінку. Перевірка при запуску, при поверненні на вкладку і раз на 10 хв.
const current = () => {
  const s = Array.from(document.scripts).map(x => x.getAttribute('src') || '').find(x => /\/static\/js\/main\.[\w]+\.js$/.test(x));
  return s ? s.replace(/^https?:\/\/[^/]+/, '') : '';
};

let busy = false;
async function check() {
  if (busy || process.env.NODE_ENV !== 'production') return;
  busy = true;
  try {
    const r = await fetch(`/asset-manifest.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return;
    const latest: string = (await r.json())?.files?.['main.js'] || '';
    const mine = current();
    if (latest && mine && latest !== mine) {
      // захист від нескінченного перезавантаження, якщо сервер ще віддає старий index.html
      const key = 'rk_reload_to';
      let tried = '';
      try { tried = sessionStorage.getItem(key) || ''; } catch { /* приватний режим */ }
      if (tried === latest) return;
      try { sessionStorage.setItem(key, latest); } catch { /* приватний режим */ }
      // інша адреса (?v=…) — браузер гарантовано бере свіжий index.html, а не кешований
      const u = new URL(window.location.href);
      u.searchParams.set('v', latest.replace(/^.*main\.|\.js$/g, ''));
      window.location.replace(u.toString());
    }
  } catch { /* офлайн — пропускаємо */ } finally { busy = false; }
}

export function initVersionCheck() {
  check();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  window.setInterval(check, 10 * 60 * 1000);
}
