// Consum catalogue via the JSON API used by tienda.consum.es.
// One national online price list; regular price + offer price.
import { getJSON, groupFor, num, quantities, sleep } from './common.mjs';

const API = 'https://tienda.consum.es/api/rest/V1.0';

// Provinces where Consum (or its Charter franchise) has supermarkets.
export const CONSUM_PROVINCES = ['02', '03', '04', '08', '12', '13', '16', '17', '18', '23', '25', '29', '30', '43', '44', '45', '46', '50'];

// Map every category id to [level1 name, level2 name].
async function categoryPaths() {
  const { json: menu } = await getJSON(`${API}/shopping/category/menu`);
  const paths = new Map();
  const walk = (nodes, trail) => {
    for (const n of nodes || []) {
      const t = [...trail, n.name];
      paths.set(n.id, t);
      walk(n.subcategories, t);
    }
  };
  walk(menu, []);
  return paths;
}

export async function fetchConsum({ log = console.log } = {}) {
  const paths = await categoryPaths();
  const seen = new Map();
  const LIMIT = 100;
  for (let offset = 0, page = 0; page < 200; page++, offset += LIMIT) {
    const { json } = await getJSON(`${API}/catalog/product?limit=${LIMIT}&offset=${offset}`);
    for (const p of json.products || []) {
      const item = normalize(p, paths);
      if (item && !seen.has(item.id)) seen.set(item.id, item);
    }
    if (!json.hasMore || !(json.products || []).length) break;
    await sleep(400);
  }
  const items = [...seen.values()];
  log(`Consum: ${items.length} products`);
  return { items, meta: {} };
}

function normalize(p, paths) {
  const pd = p.productData || {};
  const prices = p.priceData?.prices || [];
  const regular = prices.find((x) => x.id === 'PRICE')?.value;
  const offer = prices.find((x) => x.id === 'OFFER_PRICE')?.value;
  const base = num(regular?.centAmount);
  if (base == null) return null;
  const onOffer = offer && num(offer.centAmount) != null && num(offer.centAmount) < base;
  const price = onOffer ? num(offer.centAmount) : base;
  const unitPrice = num((onOffer ? offer : regular).centUnitAmount);
  const { q, qu, up, uf } = quantities(price, unitPrice, p.priceData?.unitPriceUnitType || '');
  const catId = p.categories?.[0]?.id;
  const trail = paths.get(catId) || [];
  // Consum's top level is broad ("Frescos", "Despensa"); the second level
  // ("Carne", "Lácteos y huevos") maps better to our shared categories.
  let c = groupFor(trail[1] || '');
  if (c === 'otros') c = groupFor(p.categories?.[0]?.name || '');
  if (c === 'otros') c = groupFor(trail[0] || '');
  return {
    s: 'c',
    id: String(p.code || p.id),
    n: pd.brand?.name && !pd.name.toLowerCase().includes(pd.brand.name.toLowerCase()) ? `${pd.name} ${titleCase(pd.brand.name)}` : pd.name,
    k: pd.format || '',
    img: pd.imageURL,
    u: pd.url,
    p: price,
    pp: onOffer ? base : null,
    d: onOffer ? Math.round(((base - price) / base) * 100) : 0,
    up,
    uf,
    q,
    qu,
    c,
    sc: [trail[1], p.categories?.[0]?.name].filter(Boolean).join(' · '),
  };
}

const titleCase = (s) => s.toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase());
