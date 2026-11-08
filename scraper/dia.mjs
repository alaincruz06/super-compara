// Dia catalogue importer.
//
// dia.es blocks automated requests from cloud servers (including GitHub
// Actions), so this module does NOT fetch dia.es itself. Dia prices are
// collected on the owner's computer with dia-sync/ and uploaded to the
// `dia-data` branch; the workflow checks that branch out and points
// DIA_SOURCE at its dia.json (a path or https URL; either a JSON array of
// rows or {fetched, items: [...]}).
//
// Rows use Dia's own product schema (as returned by dia.es search/category
// pages, and by most Dia datasets): sku_id, display_name, brand, url, image,
// prices.{price, price_per_unit, measure_unit, strikethrough_price,
// discount_percentage}, l1_category_description, l2_category_description.
import { readFile } from 'node:fs/promises';
import { groupFor, num, quantities, getJSON } from './common.mjs';

// Dia L1 category codes -> names (used when rows only carry the code).
const DIA_L1 = {
  L105: 'Frutas', L104: 'Verduras', L102: 'Carnes', L103: 'Pescados y mariscos',
  L134: 'Charcutería', L101: 'Quesos', L108: 'Huevos, leche y mantequilla',
  L112: 'Panadería', L113: 'Yogures y postres', L119: 'Congelados y helados',
  L106: 'Arroz, pastas y legumbres', L107: 'Aceites, salsas y especias',
  L114: 'Conservas, caldos y cremas', L109: 'Café, cacao e infusiones',
  L132: 'Bollería, repostería y azúcar', L111: 'Galletas, cereales y mermeladas',
  L110: 'Chocolates y golosinas', L116: 'Platos preparados y pizzas',
  L115: 'Aperitivos y frutos secos', L117: 'Agua y refrescos', L127: 'Zumos y smoothies',
  L118: 'Cervezas, vinos y licores', L122: 'Limpieza y hogar',
  L129: 'Higiene y cuidado del cuerpo', L130: 'Cabello y perfumería',
  L131: 'Salud y parafarmacia', L120: 'Infantil', L123: 'Mascotas',
};

export async function fetchDia({ source = process.env.DIA_SOURCE, log = console.log } = {}) {
  if (!source) {
    log('Dia: no DIA_SOURCE configured, skipping');
    return null;
  }
  let rows;
  try {
    rows = /^https?:/.test(source)
      ? (await getJSON(source)).json
      : JSON.parse(await readFile(source, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT' || /HTTP 404/.test(e.message)) {
      log('Dia: no synced data yet');
      return null;
    }
    throw e;
  }
  const list = Array.isArray(rows) ? rows : rows.items || rows.search_items || [];
  const seen = new Map();
  for (const r of list) {
    const item = normalizeDia(r);
    if (item && !seen.has(item.id)) seen.set(item.id, item);
  }
  log(`Dia: ${seen.size} products imported`);
  const meta = { method: rows.method || 'import' };
  if (rows.fetched) meta.updated = rows.fetched;
  return { items: [...seen.values()], meta };
}

export function normalizeDia(r) {
  const pr = r.prices || {};
  const price = num(pr.price ?? r.price);
  if (price == null) return null;
  const id = String(r.sku_id ?? r.object_id ?? r.id ?? '');
  if (!id) return null;
  const qs = quantities(price, num(pr.price_per_unit ?? r.price_per_unit), pr.measure_unit ?? r.measure_unit);
  const { qu, up, uf } = qs;
  let q = qs.q;
  if (!q && r.weight_in_grams) q = num(r.weight_in_grams);
  const prev = num(pr.strikethrough_price);
  const discounted = prev && prev > price;
  const top = r.l1_category_description || DIA_L1[r.l1_category] || '';
  const url = r.url ? (r.url.startsWith('http') ? r.url : `https://www.dia.es${r.url}`) : '';
  const img = r.image ? (r.image.startsWith('http') ? r.image : `https://www.dia.es${r.image}`) : '';
  return {
    s: 'd',
    id,
    n: r.display_name || r.name,
    k: '',
    img,
    u: url,
    p: price,
    pp: discounted ? prev : null,
    d: discounted ? num(pr.discount_percentage) || Math.round(((prev - price) / prev) * 100) : 0,
    up,
    uf,
    q,
    qu,
    c: groupFor(top),
    sc: [r.l2_category_description, top].filter(Boolean)[0] || '',
  };
}
