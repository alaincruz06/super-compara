// Recetas: generate recipes from the shopping list with Claude (user's own key).
const LIST_KEY = 'supercompara:list';
const KEY_KEY = 'supercompara:apiKey';
const MODEL_KEY = 'supercompara:model';
const LAST_KEY = 'supercompara:lastRecipes';
const SAVED_KEY = 'supercompara:savedRecipes';
const OFF_KEY = 'supercompara:recipeOff';
const STORES = { m: 'Mercadona', d: 'Dia' };

const $ = (s) => document.querySelector(s);
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
const norm = (s = '') => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

// ---------- ingredients from the shopping list ----------
let off = new Set(store.get(OFF_KEY, []));
function renderIngredients() {
  const list = store.get(LIST_KEY, {});
  const entries = Object.entries(list);
  if (!entries.length) {
    $('#ingList').innerHTML = '<p class="meta">Tu lista está vacía. Añade productos desde <a href="./">Comparar precios</a> con “+ Lista”, o escribe abajo los ingredientes que tienes.</p>';
    return;
  }
  $('#ingList').innerHTML = entries
    .map(([k, v]) => `<label class="ing${off.has(k) ? ' off' : ''}"><input type="checkbox" data-k="${esc(k)}" ${off.has(k) ? '' : 'checked'}><span class="dot ${v.s}"></span>${esc(v.n)}${v.qty > 1 ? ` ×${v.qty}` : ''}</label>`)
    .join('');
}
$('#ingList').addEventListener('change', (e) => {
  const k = e.target.dataset.k;
  if (!k) return;
  e.target.checked ? off.delete(k) : off.add(k);
  store.set(OFF_KEY, [...off]);
  renderIngredients();
});
function chosenIngredients() {
  const list = store.get(LIST_KEY, {});
  return Object.entries(list).filter(([k]) => !off.has(k)).map(([, v]) => `${v.n}${v.qty > 1 ? ` (x${v.qty})` : ''}`);
}

// ---------- settings ----------
const dlg = $('#settings');
$('#settingsBtn').addEventListener('click', openSettings);
function openSettings() {
  $('#apiKey').value = store.get(KEY_KEY, '');
  $('#model').value = store.get(MODEL_KEY, 'claude-haiku-5-5');
  dlg.showModal();
}
dlg.addEventListener('close', () => {
  if (dlg.returnValue === 'save') {
    store.set(KEY_KEY, $('#apiKey').value.trim());
    store.set(MODEL_KEY, $('#model').value);
    updateKeyBtn();
  }
});
$('#clearKey').addEventListener('click', () => { store.del(KEY_KEY); $('#apiKey').value = ''; updateKeyBtn(); });
function updateKeyBtn() {
  $('#settingsBtn').textContent = store.get(KEY_KEY, '') ? '⚙︎ IA ✓' : '⚙︎ Clave IA';
}

// ---------- prompt & API ----------
const val = (id) => $(`#${id}`).value;
function buildPrompt() {
  const ings = chosenIngredients();
  const pantry = val('pantry').trim();
  const extras = { none: 'Usa SOLO los ingredientes disponibles (agua, sal y pimienta se pueden asumir).', few: 'Usa sobre todo los ingredientes disponibles; puedes añadir como mucho 3 ingredientes extra por receta.', any: 'Puedes añadir los ingredientes extra que hagan falta.' }[val('extras')];
  return `Ingredientes disponibles (de mi lista de la compra de Mercadona/Dia):
${ings.length ? ings.map((i) => `- ${i}`).join('\n') : '- (ninguno de la lista)'}
${pantry ? `Además tengo en casa: ${pantry}` : ''}

Quiero ${val('dishes')} receta(s) distinta(s), cada una para ${val('servings')} ración(es).
- Tiempo máximo por receta (preparación + cocción): ${val('time') === '120' ? 'sin límite' : `${val('time')} minutos`}
- Tipo de comida: ${val('meal')}
- Dieta: ${val('diet')}
- Dificultad: ${val('difficulty')}
- Utensilios: ${val('tools')}
- ${extras}
${val('notes').trim() ? `- Otras preferencias: ${val('notes').trim()}` : ''}

Responde SOLO con JSON válido (sin markdown) con esta forma exacta:
{"recipes":[{"title":"","summary":"una frase","time_minutes":0,"servings":0,"difficulty":"fácil|media|difícil","ingredients":[{"name":"","quantity":"","have":true}],"steps":[""],"storage":"cómo y cuántos días se conserva (o cadena vacía)","tip":""}],"extras":[{"name":"ingrediente que falta","search":"1-3 palabras para buscarlo en el supermercado"}]}
"have" es true si el ingrediente está en mi lista o en casa. "extras" agrupa todos los ingredientes que no tengo (sin repetir). Cantidades en unidades españolas (g, ml, cucharadas). Pasos claros y numerables.`;
}

async function callClaude(prompt) {
  const key = store.get(KEY_KEY, '');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: store.get(MODEL_KEY, 'claude-haiku-5-5'),
      max_tokens: 8000,
      system: 'Eres un chef español práctico que crea recetas caseras, realistas y sabrosas para el día a día, con ingredientes de supermercado. Respondes siempre en español y solo con el JSON pedido.',
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || `HTTP ${res.status}`;
    if (res.status === 401) throw new Error('La clave de API no es válida. Revísala en ⚙︎ Clave IA.');
    if (res.status === 429) throw new Error('Demasiadas peticiones o sin saldo en tu cuenta de Anthropic. Inténtalo en un momento.');
    throw new Error(msg);
  }
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed.recipes)) throw new Error();
    return parsed;
  } catch {
    throw new Error('La IA devolvió una respuesta que no se pudo leer. Prueba otra vez.');
  }
}

// ---------- matching extras to the catalogue ----------
let catalog = null;
async function loadCatalog() {
  if (catalog) return catalog;
  try {
    const p = await fetch('data/products.json').then((r) => r.json());
    catalog = p.items.map((it) => ({ ...it, _n: norm(it.n) }));
  } catch { catalog = []; }
  return catalog;
}
const singular = (t) => (t.length > 4 && t.endsWith('es') ? t.slice(0, -2) : t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t);
function bestOffers(term) {
  const toks = norm(term).split(/[^a-z0-9ñ]+/).filter((t) => t.length > 1).map(singular);
  if (!toks.length || !catalog) return {};
  let hits = catalog.filter((it) => toks.every((t) => it._n.includes(t)));
  const lead = hits.filter((it) => it._n.startsWith(toks[0]));
  if (lead.length) hits = lead;
  // Keep the most common category (e.g. fresh onions, not onion powder),
  // then pick the cheapest per kg/L/unit in each store.
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
let lastOffers = {};
function recipeCard(r, i, saved = false) {
  return `<article class="recipe">
    <h3>${esc(r.title)}</h3>
    ${r.summary ? `<div class="meta">${esc(r.summary)}</div>` : ''}
    <div class="chips">
      ${r.time_minutes ? `<span class="chip">⏱ ${esc(r.time_minutes)} min</span>` : ''}
      ${r.servings ? `<span class="chip">🍽 ${esc(r.servings)} raciones</span>` : ''}
      ${r.difficulty ? `<span class="chip">${esc(r.difficulty)}</span>` : ''}
    </div>
    <h4>Ingredientes</h4>
    <ul>${(r.ingredients || []).map((g) => `<li class="${g.have === false ? 'extra' : ''}">${esc(g.quantity ? `${g.quantity} · ` : '')}${esc(g.name)}${g.have === false ? ' <small>(falta)</small>' : ''}</li>`).join('')}</ul>
    <h4>Pasos</h4>
    <ol>${(r.steps || []).map((s) => `<li>${esc(String(s).replace(/^\d+[.)]\s*/, ''))}</li>`).join('')}</ol>
    ${r.storage ? `<div class="tip">🧊 ${esc(r.storage)}</div>` : ''}
    ${r.tip ? `<div class="tip">💡 ${esc(r.tip)}</div>` : ''}
    <div class="row">
      ${saved ? `<button class="ghost" data-unsave="${i}">Quitar</button>` : `<button class="ghost" data-save="${i}">☆ Guardar</button>`}
    </div>
  </article>`;
}

let current = null;
async function renderResults(res) {
  current = res;
  await loadCatalog();
  lastOffers = {};
  const extras = (res.extras || []).map((x, i) => {
    const offers = bestOffers(x.search || x.name);
    lastOffers[i] = offers;
    const cells = Object.values(offers).map((o) => `<span class="offer"><span class="dot ${o.s}"></span>${esc(o.n)} · <b>${eur.format(o.p)}</b><button data-add="${i}:${o.s}">+ Lista</button></span>`).join('');
    return `<div class="extra-row"><b>${esc(x.name)}</b>${cells || '<span class="meta">No encontrado en el catálogo</span>'}</div>`;
  }).join('');
  $('#out').innerHTML = `
    <div class="out-head"><h2>Tus recetas</h2><div><button class="ghost" id="print">🖨 Imprimir</button> <button class="ghost" id="again">↻ Otras ideas</button></div></div>
    <div class="recipe-grid">${res.recipes.map((r, i) => recipeCard(r, i)).join('')}</div>
    ${extras ? `<section class="panel extras"><h2>Te falta</h2><p class="meta">El producto más barato que coincide en cada súper. Añádelo a tu lista con un toque.</p>${extras}</section>` : ''}`;
}

function renderSaved() {
  const saved = store.get(SAVED_KEY, []);
  $('#saved').innerHTML = saved.length
    ? `<div class="out-head"><h2>Recetas guardadas</h2></div><div class="recipe-grid">${saved.map((r, i) => recipeCard(r, i, true)).join('')}</div>`
    : '';
}

// ---------- actions ----------
async function generate() {
  if (!store.get(KEY_KEY, '')) { openSettings(); return; }
  if (!chosenIngredients().length && !val('pantry').trim()) {
    $('#status').textContent = 'Añade al menos un ingrediente.';
    return;
  }
  const btn = $('#generate');
  btn.disabled = true;
  $('#status').textContent = '';
  $('#out').innerHTML = '<div class="loading"><div class="spin"></div>Cocinando ideas…</div>';
  try {
    const res = await callClaude(buildPrompt());
    store.set(LAST_KEY, res);
    await renderResults(res);
    $('#out').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    $('#out').innerHTML = `<div class="err">${esc(e.message)}</div>`;
  } finally {
    btn.disabled = false;
  }
}
$('#generate').addEventListener('click', generate);

document.addEventListener('click', (e) => {
  const t = e.target;
  if (t.id === 'print') window.print();
  if (t.id === 'again') generate();
  if (t.dataset.save != null && current) {
    const saved = store.get(SAVED_KEY, []);
    saved.unshift(current.recipes[+t.dataset.save]);
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
    const it = lastOffers[i]?.[s];
    if (it) { addToList(it); t.textContent = '✓'; t.classList.add('added'); }
  }
});
window.addEventListener('storage', (e) => { if (e.key === LIST_KEY) renderIngredients(); });

// ---------- init ----------
renderIngredients();
updateKeyBtn();
renderSaved();
const last = store.get(LAST_KEY, null);
if (last?.recipes?.length) renderResults(last);
