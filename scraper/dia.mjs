// Dia catalogue importer.
//
// dia.es sits behind Akamai bot protection that blocks automated requests from
// cloud servers (including GitHub Actions), so this module does NOT fetch
// dia.es itself. It imports Dia product rows from a source you configure:
//
//   DIA_SOURCE=<path or https URL to a JSON array of Dia product rows>
//
// Rows use Dia's own product schema (as returned by dia.es search/category
// pages, and by most Dia datasets): sku_id, display_name, brand, url, image,
// prices.{price, price_per_unit, measure_unit, strikethrough_price,
// discount_percentage}, l1_category_description, l2_category_description.
import { readFile } from 'node:fs/promises';
import { groupFor, baseUnit, num, round, getJSON } from './common.mjs';

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
  const rows = /^https?:/.test(source)
    ? (await getJSON(source)).json
    : JSON.parse(await readFile(source, 'utf8'));
  const list = Array.isArray(rows) ? rows : rows.items || rows.search_items || [];
  const seen = new Map();
  for (const r of list) {
    const item = normalizeDia(r);
    if (item && !seen.has(item.id)) seen.set(item.id, item);
  }
  log(`Dia: ${seen.size} products imported`);
  return { items: [...seen.values()], meta: { source: /^https?:/.test(source) ? 'url' : 'file' } };
}

export function normalizeDia(r) {
  const pr = r.prices || {};
  const price = num(pr.price ?? r.price);
  if (price == null) return null;
  const id = String(r.sku_id ?? r.object_id ?? r.id ?? '');
  if (!id) return null;
  const ref = num(pr.price_per_unit ?? r.price_per_unit);
  const [qu, factor] = baseUnit(pr.measure_unit ?? r.measure_unit);
  let q = ref ? round((price / ref) * factor, 0) : null;
  if (qu === 'ud' && q) q = round(price / ref, 2);
  if (!q && r.weight_in_grams) q = num(r.weight_in_grams);
  const prev = num(pr.strikethrough_price);
  const discounted = prev && prev > price;
  const top = r.l1_category_description || DIA_L1[r.l1_category] || '';
  const url = r.url ? (r.url.startsWith('http') ? r.url : `https://www.dia.es${r.url}`) : '';
  const img = r.image ? (r.image.startsWith('http') ? r.image : `https://www.dia.es${r.image}`) : '';
  const unitLabel = { g: 'kg', ml: 'L', ud: 'ud' }[qu];
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
    up: ref,
    uf: unitLabel,
    q,
    qu,
    c: groupFor(top),
    sc: [r.l2_category_description, top].filter(Boolean)[0] || '',
  };
}
