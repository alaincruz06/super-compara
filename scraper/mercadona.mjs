// Mercadona catalogue via the public JSON API used by tienda.mercadona.es.
import { getJSON, groupFor, num, quantities, pool } from './common.mjs';

const API = 'https://tienda.mercadona.es/api';

export async function fetchMercadona({ postalCode = '30002', log = console.log } = {}) {
  // Resolve the warehouse that serves this postal code.
  const { headers } = await getJSON(`${API}/postal-codes/actions/change-pc/`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ new_postal_code: postalCode }),
  });
  const wh = headers.get('x-customer-wh') || 'vlc1';
  log(`Mercadona: postal code ${postalCode} -> warehouse ${wh}`);

  const { json: tree } = await getJSON(`${API}/categories/?lang=es&wh=${wh}`);
  const subs = [];
  for (const top of tree.results) {
    for (const c of top.categories || []) subs.push({ top: top.name, id: c.id, name: c.name });
  }
  log(`Mercadona: ${subs.length} categories`);

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
      log(`Mercadona: category ${sub.id} failed: ${e.message}`);
    }
  });

  const items = [...seen.values()];
  log(`Mercadona: ${items.length} products`);
  return { items, meta: { warehouse: wh, postalCode } };
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
