// Shared by every page: the visitor's postal code and loading the price lists
// that apply to it.
export const STORES = {
  m: { name: 'Mercadona' },
  c: { name: 'Consum' },
  d: { name: 'Dia' },
};
const CP_KEY = 'supercompara:cp';
const CP_RE = /^(0[1-9]|[1-4]\d|5[0-2])\d{3}$/;
const norm = (s = '') => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function getCP() {
  try { const v = localStorage.getItem(CP_KEY); return CP_RE.test(v || '') ? v : null; } catch { return null; }
}
function setCP(cp) {
  try { localStorage.setItem(CP_KEY, cp); } catch {}
}

// Modal asking for the postal code. Resolves with the saved code.
export function askCP({ required = false } = {}) {
  return new Promise((resolve) => {
    const current = getCP();
    const dlg = document.createElement('dialog');
    dlg.className = 'cp-dialog';
    dlg.innerHTML = `
      <form method="dialog" class="cp-form">
        <div class="cp-emoji">📍</div>
        <h2>¿Cuál es tu código postal?</h2>
        <p>Lo usamos para mostrarte los supermercados y precios de tu zona. Se guarda solo en este navegador.</p>
        <input name="cp" inputmode="numeric" autocomplete="postal-code" maxlength="5" pattern="[0-9]{5}" placeholder="p. ej. 30002" value="${current || ''}" required />
        <p class="cp-err" hidden>Introduce un código postal español válido (5 cifras).</p>
        <div class="cp-actions">
          ${required ? '' : '<button type="button" class="ghost" value="cancel">Cancelar</button>'}
          <button class="primary" value="ok">Ver precios</button>
        </div>
      </form>`;
    document.body.appendChild(dlg);
    const input = dlg.querySelector('input');
    const err = dlg.querySelector('.cp-err');
    dlg.addEventListener('cancel', (e) => { if (required) e.preventDefault(); });
    dlg.querySelector('[value=cancel]')?.addEventListener('click', () => { dlg.close(); dlg.remove(); resolve(current); });
    dlg.querySelector('form').addEventListener('submit', (e) => {
      const v = input.value.trim();
      if (!CP_RE.test(v)) { e.preventDefault(); err.hidden = false; input.focus(); return; }
      setCP(v);
      setTimeout(() => { dlg.remove(); resolve(v); });
    });
    dlg.showModal();
    input.focus();
    input.select();
  });
}

export async function ensureCP() {
  return getCP() || askCP({ required: true });
}

let metaCache = null;
async function getMeta() {
  if (!metaCache) metaCache = await fetch('data/meta.json', { cache: 'no-cache' }).then((r) => r.json());
  return metaCache;
}

// Which price lists apply to a postal code, and what to tell the visitor.
export async function plan(cp) {
  const meta = await getMeta();
  const prov = cp.slice(0, 2);
  const files = [];
  const notes = [];
  const m = meta.stores.m;
  if (m) {
    const wh = m.provinces[prov];
    if (wh) files.push(`m-${wh}`);
    else {
      files.push(`m-${m.fallback}`);
      notes.push(`Mercadona no tiene tienda online en tu provincia: mostramos sus precios online de Madrid como referencia.`);
    }
  }
  if (meta.stores.c) {
    if (meta.stores.c.provinces.includes(prov)) files.push('c');
    else notes.push('Consum no tiene supermercados en tu zona.');
  }
  if (meta.stores.d) files.push('d');
  return { meta, files: files.filter((f) => meta.datasets[f]?.count), allFiles: files, notes };
}

export async function loadData(cp) {
  const p = await plan(cp);
  const parts = await Promise.all(
    p.files.map((f) => fetch(`data/${f}.json`, { cache: 'no-cache' }).then((r) => r.json()).then((j) => j.items).catch(() => [])),
  );
  const items = parts.flat().map((it) => ({ ...it, _n: norm(`${it.n} ${it.k || ''}`), _sc: norm(it.sc || '') }));
  return { ...p, items };
}
