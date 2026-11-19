import './style.css';
import { renderHome } from './ui/home';
import { renderJob } from './ui/job';
import { renderChunk } from './ui/chunk';
import { renderSettings } from './ui/settings';

const app = document.getElementById('app')!;
let cleanup: (() => void) | null = null;
let seq = 0;

async function route() {
  const my = ++seq;
  cleanup?.();
  cleanup = null;
  const hash = location.hash.replace(/^#/, '') || '/';
  const parts = hash.split('/').filter(Boolean);
  try {
    if (parts[0] === 'settings') renderSettings(app);
    else if (parts[0] === 'job' && parts[2] === 'chunk') {
      const c = await renderChunk(app, parts[1], Number(parts[3]));
      if (my !== seq) c();
      else cleanup = c;
    } else if (parts[0] === 'job') {
      const c = await renderJob(app, parts[1]);
      if (my !== seq) c();
      else cleanup = c;
    } else await renderHome(app);
  } catch (e) {
    app.innerHTML = `<div class="alert error">Lỗi: ${(e instanceof Error ? e.message : String(e)).replace(/</g, '&lt;')}</div><p><a href="#/">Về trang chủ</a></p>`;
  }
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', route);
void route();

if ('storage' in navigator && navigator.storage.persist) void navigator.storage.persist().catch(() => undefined);
