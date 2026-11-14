// Recetas: match the shopping list against SuperCompara's own recipe book.
// Everything runs in the browser — no AI, no API key, no external service.
import BOOK from './recetas-data.js';
import { ensureCP, askCP, loadData } from './data.js';

const LIST_KEY = 'supercompara:list';
const SAVED_KEY = 'supercompara:savedRecipes2';
const OFF_KEY = 'supercompara:recipeOff';
const PREFS_KEY = 'supercompara:recipePrefs';

const $ = (s) => document.querySelector(s);
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
const norm = (s = '') => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const singular = (t) => (t.length > 4 && t.endsWith('es') ? t.slice(0, -2) : t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// ---------- ingredients from the shopping list ----------
let off = new Set(store.get(OFF_KEY, []));
function renderIngredients() {
  const entries = Object.entries(store.get(LIST_KEY, {}));
  $('#ingList').innerHTML = entries.length
    ? entries.map(([k, v]) => `<label class="ing${off.has(k) ? ' off' : ''}"><input type="checkbox" data-k="${esc(k)}" ${off.has(k) ? '' : 'checked'}><span class="dot ${v.s}"></span>${esc(v.n)}</label>`).join('')
    : '<p class="meta">Tu lista está vacía. Añade productos desde <a href="./">Comparar precios</a> con “+ Lista”, o escribe abajo lo que tienes.</p>';
}
$('#ingList').addEventListener('change', (e) => {
  const k = e.target.dataset.k;
  if (!k) return;
  e.target.checked ? off.delete(k) : off.add(k);
  store.set(OFF_KEY, [...off]);
  renderIngredients();
});

// ---------- matching ----------
// What the user has: normalised names from the list + pantry words.
function haves() {
  const list = Object.entries(store.get(LIST_KEY, {})).filter(([k]) => !off.has(k)).map(([, v]) => norm(v.n));
  const pantry = norm($('#pantry').value).split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
  return [...list, ...pantry].map((h) => ` ${h.split(/\s+/).map(singular).join(' ')} `);
}
function termMatches(term, hs) {
  const words = norm(term).split(/\s+/).map(singular);
  // Each word must start a word in what you have ("pan" matches "pan de molde", not "panceta").
  return hs.some((h) => words.every((w) => h.includes(` ${w}`)));
}
function check(ing, hs, basics) {
  const terms = ing[3].split('|');
  const isBasic = terms.includes('*');
  const real = terms.filter((t) => t !== '*');
  if (real.some((t) => termMatches(t, hs))) return 'have';
  if (isBasic && basics) return 'basic';
  return 'missing';
}

function evaluate(r, hs, basics) {
  let have = 0, need = 0, fromList = 0;
  const missing = [];
  const status = r.ing.map((ing) => {
    const st = check(ing, hs, basics);
    const optional = ing[4] === 1;
    if (!optional) {
      need++;
      if (st !== 'missing') have++;
      else missing.push(ing);
    }
    if (st === 'have') fromList++;
    return st;
  });
  return { r, status, have, need, missing, fromList, cover: need ? have / need : 0 };
}

const val = (id) => $(`#${id}`).value;
function candidates() {
  const hs = haves();
  const basics = $('#basics').checked;
  const maxTime = +val('time');
  const meal = val('meal'), diet = val('diet'), dif = val('difficulty'), tools = val('tools'), extras = val('extras');
  return BOOK.map((r) => evaluate(r, hs, basics))
    .filter(({ r, missing, fromList }) => {
      if (fromList === 0) return false; // must use something you have
      if (maxTime < 120 && r.min > maxTime) return false;
      if (meal === 'prep' ? !(r.prep >= 3) : meal && !r.m.includes(meal)) return false;
      if (diet && !(r.diet || '').split(',').includes(diet)) return false;
      if (dif && r.dif !== dif) return false;
      if (tools === 'nooven' && r.oven && !r.micro) return false;
      if (tools === 'micro' && !r.micro) return false;
      if (extras === 'none' && missing.length) return false;
      if (extras === 'few' && missing.length > 2) return false;
      return true;
    })
    .sort((a, b) => b.cover - a.cover || b.fromList - a.fromList || a.r.min - b.r.min);
}

// ---------- quantities ----------
function scaled(q, unit, factor) {
  if (q == null) return '';
  let v = q * factor;
  if (unit === 'g' || unit === 'ml') v = v >= 100 ? Math.round(v / 10) * 10 : Math.round(v);
  else if (unit === 'kg' || unit === 'l') v = Math.round(v * 10) / 10;
  else v = Math.max(0.5, Math.round(v * 2) / 2);
  const n = String(v).replace('.', ',').replace(',5', '½').replace(/^0½/, '½');
  return `${n}${unit ? ` ${unit}` : ''}`;
}

// ---------- catalogue offers for missing ingredients ----------
let catalog = null;
async function loadCatalog() {
  if (catalog) return catalog;
  try { catalog = (await loadData(await ensureCP())).items; }
  catch { catalog = []; }
  return catalog;
}
function bestOffers(term) {
  const toks = norm(term).split(/[^a-z0-9ñ]+/).filter((t) => t.length > 1).map(singular);
  if (!toks.length || !catalog) return {};
  let hits = catalog.filter((it) => toks.every((t) => it._n.includes(t)));
  const lead = hits.filter((it) => it._n.startsWith(toks[0]));
  if (lead.length) hits = lead;
  const counts = {};
  for (const it of hits) counts[it.c] = (counts[it.c] || 0) + 1;
  const cat = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
  hits = hits.filter((it) => it.c === cat).sort((a, b) => (a.up ?? a.p) - (b.up ?? b.p));
  const best = {};
  for (const it of hits) if (!best[it.s]) best[it.s] = it;
  return best;
}
function addToList(it) {
  const l = store.get(LIST_KEY, {});
  const k = `${it.s}:${it.id}`;
  if (!l[k]) l[k] = { qty: 1, n: it.n, p: it.p, s: it.s, img: it.img, u: it.u };
  store.set(LIST_KEY, l);
  renderIngredients();
}

// ---------- rendering ----------
function toCard(ev, servings) {
  const { r, status, have, need } = ev;
  const f = servings / r.r;
  return {
    title: r.t, min: r.min, servings, dif: r.dif === 'f' ? 'fácil' : 'media', prep: r.prep, tip: r.tip,
    have, need, steps: r.steps,
    ing: r.ing.map((g, i) => ({ text: `${scaled(g[0], g[1], f)}${g[0] != null ? ' · ' : ''}${g[2]}`, st: status?.[i], opt: g[4] === 1 })),
  };
}
function recipeCard(c, i, saved = false) {
  return `<article class="recipe">
    <h3>${esc(c.title)}</h3>
    <div class="chips">
      <span class="chip">⏱ ${c.min} min</span>
      <span class="chip">🍽 ${c.servings} raciones</span>
      <span class="chip">${c.dif}</span>
      ${c.need ? `<span class="chip ${c.have === c.need ? 'ok' : 'warn'}">${c.have === c.need ? '✓ Lo tienes todo' : `Tienes ${c.have} de ${c.need}`}</span>` : ''}
      ${c.prep >= 2 ? `<span class="chip">🧊 ${c.prep} días en nevera</span>` : ''}
    </div>
    <h4>Ingredientes</h4>
    <ul>${c.ing.map((g) => `<li class="${g.st === 'missing' && !g.opt ? 'extra' : g.opt ? 'opt' : ''}">${esc(g.text)}${g.st === 'missing' && !g.opt ? ' <small>(falta)</small>' : ''}</li>`).join('')}</ul>
    <h4>Pasos</h4>
    <ol>${c.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
    ${c.tip ? `<div class="tip">💡 ${esc(c.tip)}</div>` : ''}
    <div class="row">${saved ? `<button class="ghost" data-unsave="${i}">Quitar</button>` : `<button class="ghost" data-save="${i}">☆ Guardar</button>`}</div>
  </article>`;
}

let shown = [];
let offset = 0;
let offers = {};
async function search(next = false) {
  savePrefs();
  const all = candidates();
  const n = Math.max(1, Math.min(7, +val('dishes') || 3));
  const servings = Math.max(1, Math.min(12, +val('servings') || 2));
  if (!next) offset = 0;
  if (!all.length) {
    $('#out').innerHTML = `<div class="err">No hay recetas que encajen. Prueba a permitir más ingredientes extra, subir el tiempo o quitar filtros${haves().length ? '' : ', y añade ingredientes a tu lista'}.</div>`;
    return;
  }
  if (offset >= all.length) offset = 0;
  const picked = all.slice(offset, offset + n);
  offset += n;
  shown = picked.map((ev) => toCard(ev, servings));

  await loadCatalog();
  const missing = new Map();
  for (const ev of picked) for (const g of ev.missing) if (!missing.has(g[2])) missing.set(g[2], g[3].split('|').find((t) => t !== '*'));
  offers = {};
  let i = 0;
  const rows = [...missing].map(([name, term]) => {
    const o = bestOffers(term || name);
    offers[i] = o;
    const cells = Object.values(o).map((it) => `<span class="offer"><span class="dot ${it.s}"></span>${esc(it.n)} · <b>${eur.format(it.p)}</b><button data-add="${i}:${it.s}">+ Lista</button></span>`).join('');
    i++;
    return `<div class="extra-row"><b>${esc(name)}</b>${cells || '<span class="meta">No encontrado en el catálogo</span>'}</div>`;
  }).join('');

  $('#out').innerHTML = `
    <div class="out-head"><h2>${all.length} receta${all.length === 1 ? '' : 's'} encajan · mostrando ${picked.length}</h2>
      <div><button class="ghost" id="print">🖨 Imprimir</button> ${all.length > n ? '<button class="ghost" id="again">↻ Otras ideas</button>' : ''}</div></div>
    <div class="recipe-grid">${shown.map((c, k) => recipeCard(c, k)).join('')}</div>
    ${rows ? `<section class="panel extras"><h2>Te falta</h2><p class="meta">El producto más barato que coincide en cada súper. Añádelo a tu lista con un toque.</p>${rows}</section>` : ''}`;
}

function renderSaved() {
  const saved = store.get(SAVED_KEY, []);
  $('#saved').innerHTML = saved.length
    ? `<div class="out-head"><h2>Recetas guardadas</h2></div><div class="recipe-grid">${saved.map((c, i) => recipeCard(c, i, true)).join('')}</div>`
    : '';
}

// ---------- preferences ----------
const PREF_IDS = ['time', 'dishes', 'servings', 'meal', 'diet', 'difficulty', 'extras', 'tools', 'pantry'];
function savePrefs() {
  const p = Object.fromEntries(PREF_IDS.map((id) => [id, val(id)]));
  p.basics = $('#basics').checked;
  store.set(PREFS_KEY, p);
}
function loadPrefs() {
  const p = store.get(PREFS_KEY, null);
  if (!p) return;
  for (const id of PREF_IDS) if (p[id] != null && $(`#${id}`)) $(`#${id}`).value = p[id];
  $('#basics').checked = p.basics !== false;
}

// ---------- events ----------
$('#generate').addEventListener('click', () => search());
document.addEventListener('click', (e) => {
  const t = e.target;
  if (t.id === 'print') window.print();
  if (t.id === 'again') search(true);
  if (t.dataset.save != null) {
    const saved = store.get(SAVED_KEY, []);
    saved.unshift(shown[+t.dataset.save]);
    store.set(SAVED_KEY, saved.slice(0, 50));
    t.textContent = '★ Guardada';
    t.disabled = true;
    renderSaved();
  }
  if (t.dataset.unsave != null) {
    const saved = store.get(SAVED_KEY, []);
    saved.splice(+t.dataset.unsave, 1);
    store.set(SAVED_KEY, saved);
    renderSaved();
  }
  if (t.dataset.add) {
    const [i, s] = t.dataset.add.split(':');
    const it = offers[i]?.[s];
    if (it) { addToList(it); t.textContent = '✓'; t.classList.add('added'); }
  }
});
window.addEventListener('storage', (e) => { if (e.key === LIST_KEY) renderIngredients(); });

// ---------- postal code ----------
async function showCP() { $('#cpText').textContent = await ensureCP(); }
$('#cpBtn').addEventListener('click', async () => {
  const before = $('#cpText').textContent;
  const cp = await askCP();
  if (cp && cp !== before) { $('#cpText').textContent = cp; catalog = null; if ($('#out').innerHTML) search(); }
});

// ---------- init ----------
await showCP();
// Clean up keys from the previous AI version.
try { ['supercompara:apiKey', 'supercompara:model', 'supercompara:lastRecipes', 'supercompara:savedRecipes'].forEach((k) => localStorage.removeItem(k)); } catch {}
loadPrefs();
renderIngredients();
renderSaved();
if (Object.keys(store.get(LIST_KEY, {})).length) search();
