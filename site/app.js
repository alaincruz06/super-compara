// SuperCompara front end — plain JS, no build step.
const STORES = { m: { name: 'Mercadona' }, d: { name: 'Dia' } };
const PAGE = 60;
const LIST_KEY = 'supercompara:list';

const $ = (s) => document.querySelector(s);
const eur = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
const fmt = (n) => (n == null ? '' : eur.format(n));
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (s = '') => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

let ALL = [];
let META = null;
let shown = PAGE;
let lastResults = [];

const state = {
  q: '', cat: '', stores: new Set(['m', 'd']), deals: false,
  pMin: '', pMax: '', wMin: '', wMax: '', sort: 'rel', view: 'grid',
};

// ---------- data ----------
async function load() {
  $('#results').innerHTML = '<div class="empty">Cargando productos…</div>';
  try {
    const [p, m] = await Promise.all([
      fetch('data/products.json', { cache: 'no-cache' }).then((r) => r.json()),
      fetch('data/meta.json', { cache: 'no-cache' }).then((r) => r.json()),
    ]);
    META = m;
    ALL = p.items.map((it) => ({ ...it, _n: norm(`${it.n} ${it.k || ''}`), _sc: norm(it.sc || '') }));
  } catch (e) {
    $('#results').innerHTML = '<div class="empty">Todavía no hay datos. Vuelve en unos minutos.</div>';
    return;
  }
  readHash();
  renderChrome();
  run();
}

// ---------- search & filter ----------
function tokens(q) {
  return norm(q).split(/[^a-z0-9ñ.,]+/).filter((t) => t.length > 0);
}
const singular = (t) => (t.length > 4 && t.endsWith('es') ? t.slice(0, -2) : t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t);

function score(it, toks) {
  if (!toks.length) return 1;
  let s = 0;
  for (const t of toks) {
    const t2 = singular(t);
    const inName = it._n.includes(t) || it._n.includes(t2);
    if (!inName && !it._sc.includes(t2)) return 0;
    if (inName) {
      s += 2;
      if (new RegExp(`(^|\\s)${t2.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(it._n)) s += 2;
    } else s += 0.5;
  }
  if (it._n.startsWith(singular(toks[0]))) s += 3;
  return s - it._n.length / 200;
}

function filtered() {
  const toks = tokens(state.q);
  const n = (v) => (v === '' ? null : Number(v));
  const pMin = n(state.pMin), pMax = n(state.pMax), wMin = n(state.wMin), wMax = n(state.wMax);
  const out = [];
  for (const it of ALL) {
    if (!state.stores.has(it.s)) continue;
    if (state.cat && it.c !== state.cat) continue;
    if (state.deals && !it.d) continue;
    if (pMin != null && it.p < pMin) continue;
    if (pMax != null && it.p > pMax) continue;
    if ((wMin != null || wMax != null) && (it.qu === 'ud' || !it.q)) continue;
    if (wMin != null && it.q < wMin) continue;
    if (wMax != null && it.q > wMax) continue;
    const sc = score(it, toks);
    if (!sc) continue;
    out.push({ it, sc });
  }
  const by = {
    rel: (a, b) => b.sc - a.sc || a.it.p - b.it.p,
    'price-asc': (a, b) => a.it.p - b.it.p,
    'price-desc': (a, b) => b.it.p - a.it.p,
    'unit-asc': (a, b) => (a.it.up ?? 1e9) - (b.it.up ?? 1e9),
    'disc-desc': (a, b) => b.it.d - a.it.d || a.it.p - b.it.p,
    'w-asc': (a, b) => (a.it.q ?? 1e12) - (b.it.q ?? 1e12),
    'w-desc': (a, b) => (b.it.q ?? -1) - (a.it.q ?? -1),
  }[state.sort];
  out.sort(by);
  return out.map((x) => x.it);
}

// Cheapest per-unit item for each store among the most relevant results.
// Only items in the dominant category and unit type are compared, so a
// search for "leche" compares milk with milk (not facial cleanser).
function bestPerStore(items) {
  const top = items.slice(0, 30);
  const mode = (arr) => Object.entries(arr.reduce((a, x) => ((a[x] = (a[x] || 0) + 1), a), {})).sort((a, b) => b[1] - a[1])[0]?.[0];
  const cat = mode(top.map((i) => i.c));
  const unit = mode(top.filter((i) => i.c === cat && i.up).map((i) => i.qu));
  const best = {};
  if (!unit) return { best, unit };
  for (const it of items.slice(0, 200)) {
    if (it.c !== cat || it.qu !== unit || !it.up) continue;
    if (!best[it.s] || it.up < best[it.s].up) best[it.s] = it;
  }
  return { best, unit };
}

// ---------- rendering ----------
function sizeText(it) {
  if (!it.q) return '';
  if (it.qu === 'g') return it.q >= 1000 ? `${+(it.q / 1000).toFixed(2)} kg` : `${it.q} g`;
  if (it.qu === 'ml') return it.q >= 1000 ? `${+(it.q / 1000).toFixed(2)} L` : `${it.q} ml`;
  return `${it.q} ud`;
}
const unitText = (it) => (it.up ? `${fmt(it.up)}/${it.uf || it.qu}` : '');
const key = (it) => `${it.s}:${it.id}`;

function card(it, bestKeys) {
  const inList = !!getList()[key(it)];
  const isBest = bestKeys.has(key(it));
  const size = [it.k, sizeText(it)].filter(Boolean).join(' · ');
  return `<article class="card${isBest ? ' best' : ''}">
    <div class="badges">
      <span class="tag ${it.s}">${STORES[it.s].name}</span>
      ${it.d ? `<span class="tag deal">-${it.d}%</span>` : ''}
      ${isBest ? '<span class="tag bestt">Mejor €/kg</span>' : ''}
    </div>
    <a class="img" href="${esc(it.u)}" target="_blank" rel="noopener">${it.img ? `<img loading="lazy" src="${esc(it.img)}" alt="">` : ''}</a>
    <div class="info">
      <h3 class="name"><a href="${esc(it.u)}" target="_blank" rel="noopener" title="${esc(it.n)}">${esc(it.n)}</a></h3>
      <div class="meta">${esc(size)}</div>
      <div class="meta">${esc(it.sc || '')}</div>
    </div>
    <div class="prices">
      <span class="price">${fmt(it.p)}</span>
      ${it.pp ? `<span class="prev">${fmt(it.pp)}</span>` : ''}
      <span class="unit">${unitText(it)}</span>
    </div>
    <div class="actions">
      <button class="${inList ? 'added' : 'add'}" data-add="${esc(key(it))}">${inList ? '✓ En lista' : '+ Lista'}</button>
      <button data-similar="${esc(key(it))}" title="Buscar productos parecidos en ambas tiendas">Comparar</button>
    </div>
  </article>`;
}

function run(resetPage = true) {
  if (resetPage) shown = PAGE;
  lastResults = filtered();
  render();
  writeHash();
}

function render() {
  const items = lastResults;
  const res = $('#results');
  const { best, unit } = bestPerStore(items);
  const bestKeys = new Set(Object.values(best).map(key));
  const counts = { m: 0, d: 0 };
  for (const it of items) counts[it.s]++;

  const unitLabel = { g: 'kg', ml: 'L', ud: 'ud' }[unit];
  const bestHtml = state.q && Object.keys(best).length
    ? `<div class="best-box">${Object.values(best).map((b) => `<div>Más barato por ${unitLabel} en <b class="${b.s}">${STORES[b.s].name}</b>: ${esc(b.n)} · <b>${unitText(b)}</b></div>`).join('')}</div>`
    : '';
  $('#summary').innerHTML = `<span>${items.length.toLocaleString('es-ES')} productos (Mercadona ${counts.m.toLocaleString('es-ES')} · Dia ${counts.d.toLocaleString('es-ES')})</span>${bestHtml}`;

  if (!items.length) {
    res.innerHTML = `<div class="empty">No hay productos que coincidan. Prueba con otra palabra o quita filtros.</div>`;
    $('#more').hidden = true;
    return;
  }

  if (state.view === 'compare') {
    const cols = ['m', 'd'].map((s) => {
      const list = items.filter((i) => i.s === s);
      const st = META.stores[s] || {};
      const body = list.length
        ? `<div class="grid">${list.slice(0, shown).map((i) => card(i, bestKeys)).join('')}</div>`
        : `<div class="empty">${st.status === 'pending' ? 'Datos de Dia aún no disponibles.' : 'Sin resultados en esta tienda.'}</div>`;
      return `<div><div class="col-head ${s}"><span>${STORES[s].name}</span><span>${list.length}</span></div>${body}</div>`;
    });
    res.innerHTML = `<div class="compare">${cols.join('')}</div>`;
    $('#more').hidden = Math.max(counts.m, counts.d) <= shown;
  } else {
    res.innerHTML = `<div class="${state.view === 'list' ? 'rows' : 'grid'}">${items.slice(0, shown).map((i) => card(i, bestKeys)).join('')}</div>`;
    $('#more').hidden = items.length <= shown;
  }
}

function renderChrome() {
  const cats = [{ id: '', name: 'Todas' }, ...META.groups];
  const present = new Set(ALL.map((i) => i.c));
  $('#cats').innerHTML = cats
    .filter((c) => !c.id || present.has(c.id))
    .map((c) => `<button data-cat="${c.id}" class="${state.cat === c.id ? 'on' : ''}">${esc(c.name)}</button>`)
    .join('');

  $('#storeToggles').innerHTML = Object.entries(STORES)
    .map(([s, st]) => {
      const has = ALL.some((i) => i.s === s);
      return `<button data-s="${s}" class="${state.stores.has(s) && has ? 'on' : ''}" ${has ? '' : 'disabled title="Sin datos todavía"'}>${st.name}</button>`;
    })
    .join('');

  document.querySelectorAll('.views button').forEach((b) => b.classList.toggle('on', b.dataset.view === state.view));
  $('#q').value = state.q;
  $('#onlyDeals').checked = state.deals;
  for (const k of ['pMin', 'pMax', 'wMin', 'wMax']) $(`#${k}`).value = state[k];
  $('#sort').value = state.sort;

  const notes = [];
  for (const [s, st] of Object.entries(META.stores)) {
    if (st.status === 'pending') notes.push(`${st.name}: los precios todavía no están disponibles.`);
    else if (st.status === 'stale' || st.status === 'error') notes.push(`${st.name}: la última actualización falló; se muestran los precios del ${new Date(st.updated).toLocaleDateString('es-ES')}.`);
  }
  $('#notices').innerHTML = notes.map((n) => `<div class="notice">${esc(n)}</div>`).join('');

  const upd = Object.values(META.stores)
    .filter((s) => s.updated)
    .map((s) => `${s.name}: ${new Date(s.updated).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' })}${s.warehouse ? ` (CP ${META.postalCode}, almacén ${s.warehouse})` : ''}`)
    .join(' · ');
  $('#foot').innerHTML = `Precios actualizados a diario. ${esc(upd)}<br>Proyecto independiente, sin relación con Mercadona ni Dia. Los precios pueden variar; confirma siempre en la web de cada tienda.`;
  updateListCount();
}

// ---------- URL hash state ----------
function writeHash() {
  const p = new URLSearchParams();
  if (state.q) p.set('q', state.q);
  if (state.cat) p.set('cat', state.cat);
  if (state.sort !== 'rel') p.set('sort', state.sort);
  if (state.view !== 'grid') p.set('view', state.view);
  if (state.deals) p.set('ofertas', '1');
  if (state.stores.size < 2) p.set('tiendas', [...state.stores].join(''));
  for (const k of ['pMin', 'pMax', 'wMin', 'wMax']) if (state[k] !== '') p.set(k, state[k]);
  const h = p.toString();
  history.replaceState(null, '', h ? `#${h}` : location.pathname);
}
function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  state.q = p.get('q') || '';
  state.cat = p.get('cat') || '';
  state.sort = p.get('sort') || 'rel';
  state.view = p.get('view') || (localStorage.getItem('supercompara:view') ?? 'grid');
  state.deals = p.get('ofertas') === '1';
  if (p.get('tiendas')) state.stores = new Set(p.get('tiendas').split(''));
  for (const k of ['pMin', 'pMax', 'wMin', 'wMax']) state[k] = p.get(k) || '';
}

// ---------- shopping list ----------
function getList() {
  try { return JSON.parse(localStorage.getItem(LIST_KEY)) || {}; } catch { return {}; }
}
function setList(l) {
  try { localStorage.setItem(LIST_KEY, JSON.stringify(l)); } catch {}
  updateListCount();
}
function updateListCount() {
  const n = Object.values(getList()).reduce((a, x) => a + x.qty, 0);
  $('#listCount').textContent = n;
}
function toggleList(k) {
  const l = getList();
  if (l[k]) delete l[k];
  else {
    const it = ALL.find((i) => key(i) === k);
    if (!it) return;
    l[k] = { qty: 1, n: it.n, p: it.p, s: it.s, img: it.img, u: it.u };
  }
  setList(l);
}
function renderList() {
  const l = getList();
  // Refresh prices from current data.
  for (const [k, v] of Object.entries(l)) {
    const it = ALL.find((i) => key(i) === k);
    if (it) v.p = it.p;
  }
  const entries = Object.entries(l);
  if (!entries.length) {
    $('#listBody').innerHTML = '<p class="meta">Tu lista está vacía. Pulsa “+ Lista” en cualquier producto.</p>';
    return;
  }
  const tot = { m: 0, d: 0 };
  const rows = ['m', 'd'].map((s) => {
    const items = entries.filter(([, v]) => v.s === s);
    if (!items.length) return '';
    return `<h3 class="tag ${s}">${STORES[s].name}</h3>` + items.map(([k, v]) => {
      tot[s] += v.p * v.qty;
      return `<div class="li">
        ${v.img ? `<img src="${esc(v.img)}" alt="">` : ''}
        <div class="n"><a href="${esc(v.u)}" target="_blank" rel="noopener">${esc(v.n)}</a><div class="meta">${fmt(v.p)} / ud</div></div>
        <div class="qty"><button data-dec="${esc(k)}">−</button><span>${v.qty}</span><button data-inc="${esc(k)}">+</button></div>
        <b>${fmt(v.p * v.qty)}</b>
      </div>`;
    }).join('');
  }).join('');
  $('#listBody').innerHTML = `${rows}
    <div class="totals">
      ${tot.m ? `<div><span>Mercadona</span><b>${fmt(tot.m)}</b></div>` : ''}
      ${tot.d ? `<div><span>Dia</span><b>${fmt(tot.d)}</b></div>` : ''}
      <div class="grand"><span>Total</span><span>${fmt(tot.m + tot.d)}</span></div>
    </div>
    <p><button class="link" id="clearList">Vaciar lista</button></p>`;
}
function openList(open) {
  $('#drawer').hidden = !open;
  $('#scrim').hidden = !open;
  if (open) renderList();
}

// ---------- events ----------
let typing;
$('#q').addEventListener('input', (e) => {
  clearTimeout(typing);
  typing = setTimeout(() => { state.q = e.target.value.trim(); run(); }, 180);
});
$('#searchForm').addEventListener('submit', (e) => {
  e.preventDefault();
  state.q = $('#q').value.trim();
  run();
});
$('#cats').addEventListener('click', (e) => {
  const b = e.target.closest('[data-cat]');
  if (!b) return;
  state.cat = b.dataset.cat;
  document.querySelectorAll('#cats button').forEach((x) => x.classList.toggle('on', x === b));
  run();
});
$('#storeToggles').addEventListener('click', (e) => {
  const b = e.target.closest('[data-s]');
  if (!b || b.disabled) return;
  const s = b.dataset.s;
  if (state.stores.has(s) && state.stores.size > 1) state.stores.delete(s);
  else state.stores.add(s);
  renderChrome();
  run();
});
$('#onlyDeals').addEventListener('change', (e) => { state.deals = e.target.checked; run(); });
for (const k of ['pMin', 'pMax', 'wMin', 'wMax']) {
  $(`#${k}`).addEventListener('input', (e) => { state[k] = e.target.value; clearTimeout(typing); typing = setTimeout(run, 250); });
}
$('#sort').addEventListener('change', (e) => { state.sort = e.target.value; run(); });
document.querySelector('.views').addEventListener('click', (e) => {
  const b = e.target.closest('[data-view]');
  if (!b) return;
  state.view = b.dataset.view;
  try { localStorage.setItem('supercompara:view', state.view); } catch {}
  document.querySelectorAll('.views button').forEach((x) => x.classList.toggle('on', x === b));
  run(false);
});
$('#reset').addEventListener('click', () => {
  Object.assign(state, { q: '', cat: '', deals: false, pMin: '', pMax: '', wMin: '', wMax: '', sort: 'rel', stores: new Set(['m', 'd']) });
  renderChrome();
  run();
});
$('#home').addEventListener('click', (e) => { e.preventDefault(); $('#reset').click(); });
$('#more').addEventListener('click', () => { shown += PAGE; render(); });
new IntersectionObserver((ents) => {
  if (ents[0].isIntersecting && !$('#more').hidden) { shown += PAGE; render(); }
}, { rootMargin: '600px' }).observe($('#more'));

$('#results').addEventListener('click', (e) => {
  const add = e.target.closest('[data-add]');
  if (add) { toggleList(add.dataset.add); render(); return; }
  const sim = e.target.closest('[data-similar]');
  if (sim) {
    const it = ALL.find((i) => key(i) === sim.dataset.similar);
    if (!it) return;
    // Use the first meaningful words of the name (drop brands/sizes).
    const words = it.n.replace(/[0-9].*$/, '').split(/\s+/).filter((w) => w.length > 2 && !/^(hacendado|deliplus|dia|bosque|verde|compy|del|con|para|las|los)$/i.test(w));
    state.q = words.slice(0, 3).join(' ');
    state.cat = it.c;
    state.stores = new Set(['m', 'd']);
    state.view = 'compare';
    state.sort = 'unit-asc';
    renderChrome();
    run();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
});
$('#toggleFilters').addEventListener('click', (e) => {
  const open = $('#toolbar').classList.toggle('open');
  e.currentTarget.setAttribute('aria-expanded', open);
});
$('#openList').addEventListener('click', () => openList(true));
$('#closeList').addEventListener('click', () => openList(false));
$('#scrim').addEventListener('click', () => openList(false));
$('#listBody').addEventListener('click', (e) => {
  const l = getList();
  const inc = e.target.closest('[data-inc]'), dec = e.target.closest('[data-dec]');
  if (inc) l[inc.dataset.inc].qty++;
  else if (dec) { const k = dec.dataset.dec; if (--l[k].qty <= 0) delete l[k]; }
  else if (e.target.id === 'clearList') { setList({}); renderList(); render(); return; }
  else return;
  setList(l);
  renderList();
  render();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') openList(false);
  if (e.key === '/' && document.activeElement.tagName !== 'INPUT') { e.preventDefault(); $('#q').focus(); }
});

load();
