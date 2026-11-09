// Mercadona catalogue via the JSON API used by tienda.mercadona.es.
// Prices depend on the warehouse serving each postal code, so we resolve one
// postal code per province to a warehouse, then fetch each distinct warehouse.
import { getJSON, groupFor, num, quantities, pool, sleep } from './common.mjs';

const API = 'https://tienda.mercadona.es/api';
const WH_RE = /^[a-z]{3}\d+$/;

export async function resolveWarehouse(postalCode) {
  try {
    const { headers } = await getJSON(`${API}/postal-codes/actions/change-pc/`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ new_postal_code: postalCode }),
    }, 2);
    const wh = headers.get('x-customer-wh') || '';
    return WH_RE.test(wh) ? wh : null;
  } catch {
    return null;
  }
}

// Province code ("01".."52") -> warehouse, for provinces the online shop serves.
export async function provinceWarehouses({ log = console.log } = {}) {
  const map = {};
  // Try a few postal codes per province: the capital's "XX001" isn't always
  // in the online delivery area while other towns in the province are.
  const SUFFIXES = ['001', '003', '005', '010', '100', '200', '500'];
  for (let i = 1; i <= 52; i++) {
    const prov = String(i).padStart(2, '0');
    for (const suf of SUFFIXES) {
      const wh = await resolveWarehouse(`${prov}${suf}`);
      await sleep(250);
      if (wh) { map[prov] = wh; break; }
    }
  }
  log(`Mercadona: warehouses by province ${JSON.stringify(map)}`);
  return map;
}

export async function fetchWarehouse(wh, { log = console.log } = {}) {
  const { json: tree } = await getJSON(`${API}/categories/?lang=es&wh=${wh}`);
  const subs = [];
  for (const top of tree.results) {
    for (const c of top.categories || []) subs.push({ top: top.name, id: c.id, name: c.name });
  }
  const seen = new Map();
  await pool(subs, 3, async (sub) => {
    try {
      const { json } = await getJSON(`${API}/categories/${sub.id}/?lang=es&wh=${wh}`);
      for (const leaf of json.categories || []) {
        for (const p of leaf.products || []) {
          if (seen.has(p.id) || p.published === false) continue;
          const item = normalize(p, sub, leaf.name);
          if (item) seen.set(p.id, item);
        }
      }
    } catch (e) {
      log(`Mercadona ${wh}: category ${sub.id} failed: ${e.message}`);
    }
  });
  const items = [...seen.values()];
  log(`Mercadona ${wh}: ${items.length} products from ${subs.length} categories`);
  return { items, meta: { warehouse: wh } };
}

function normalize(p, sub, leafName) {
  const pi = p.price_instructions || {};
  const price = num(pi.unit_price);
  if (price == null) return null;
  const { q, qu, up, uf } = quantities(price, num(pi.reference_price), pi.reference_format);
  // Mercadona keeps the previous price after a price drop.
  const prev = num(pi.previous_unit_price);
  const discounted = prev && prev > price;
  return {
    s: 'm',
    id: String(p.id),
    n: p.display_name,
    k: p.packaging || '',
    img: p.thumbnail,
    u: p.share_url,
    p: price,
    pp: discounted ? prev : null,
    d: discounted ? Math.round(((prev - price) / prev) * 100) : 0,
    up,
    uf,
    q,
    qu,
    c: groupFor(sub.top),
    sc: `${sub.name} · ${leafName}`,
  };
}
