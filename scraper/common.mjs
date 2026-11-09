// Shared helpers: unified categories, quantity parsing, HTTP with retries.

export const UA =
  'SuperCompara/1.0 (+https://github.com/alaincruz06/super-compara; price comparison, 1 req/250ms)';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const strip = (s = '') =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Unified categories shared by both stores. Each store's top-level category
// name is matched (accent-insensitive) against these patterns, in order.
export const GROUPS = [
  ['fruta-verdura', 'Fruta y verdura', /fruta|verdura/],
  ['carne', 'Carne', /carne|carnic|\baves\b|pollo|cerdo|vacuno|cordero|embutido fresco/],
  ['pescado', 'Pescado y marisco', /pescado|marisco/],
  ['charcuteria', 'Charcutería y quesos', /charcut|queso/],
  ['lacteos', 'Huevos, leche y mantequilla', /huevo|leche|mantequilla/],
  ['yogures', 'Yogures y postres', /yogur|postre/],
  ['panaderia', 'Panadería y bollería', /panader|\bpan\b|bolleria|pasteler|reposter/],
  ['congelados', 'Congelados y helados', /congelad|helad/],
  ['despensa', 'Arroz, pasta y legumbres', /arroz|pasta|legumbre|internacional/],
  ['aceite', 'Aceite, salsas y especias', /aceite|salsa|especia/],
  ['conservas', 'Conservas, caldos y cremas', /conserva|caldo|crema|sopa/],
  ['desayuno', 'Café, cereales y galletas', /cafe|cacao|infusion|cereal|galleta|mermelad/],
  ['dulces', 'Azúcar, chocolate y golosinas', /azucar|chocolate|golosina|caramelo|dulce/],
  ['aperitivos', 'Aperitivos y frutos secos', /aperitivo|frutos secos|snack/],
  ['preparados', 'Platos preparados y pizzas', /preparad|pizza/],
  ['bebidas', 'Agua, refrescos y zumos', /agua|refresco|zumo|smoothie|gaseosa|soda|isotonic|energetic/],
  ['bodega', 'Bodega', /bodega|cerveza|vino|licor/],
  ['limpieza', 'Limpieza y hogar', /limpieza|hogar/],
  ['higiene', 'Cuidado personal', /cuidado|higiene|cabello|perfum|maquillaje|facial|corporal/],
  ['salud', 'Salud y parafarmacia', /salud|parafarmacia|fitoterapia/],
  ['bebe', 'Bebé', /bebe|infantil/],
  ['mascotas', 'Mascotas', /mascota/],
];

export function groupFor(topName) {
  const n = strip(topName);
  for (const [id, , re] of GROUPS) if (re.test(n)) return id;
  return 'otros';
}

// Parse a reference unit ("kg", "L", "100 g", "KILO", "LITRO", "ud"...) into
// [baseUnit, factor] where baseUnit is g, ml or ud and factor is how many base
// units one reference unit holds ("100 g" -> ['g', 100], "kg" -> ['g', 1000]).
export function baseUnit(ref = '') {
  const m = strip(String(ref)).trim().match(/^([0-9]+(?:[.,][0-9]+)?)?\s*([a-z.]*)/);
  const amount = m && m[1] ? parseFloat(m[1].replace(',', '.')) : 1;
  const r = (m ? m[2] : '').replace(/[^a-z]/g, '');
  let unit = ['ud', 1];
  if (/^(kg|kgs|kilo|kilos|kilogramos?)$/.test(r)) unit = ['g', 1000];
  else if (/^(g|gr|grs|gramos?)$/.test(r)) unit = ['g', 1];
  else if (/^(l|lt|litros?)$/.test(r)) unit = ['ml', 1000];
  else if (/^(ml|mililitros?)$/.test(r)) unit = ['ml', 1];
  else if (/^cl$/.test(r)) unit = ['ml', 10];
  return [unit[0], unit[1] * amount];
}

// From pack price + price per reference unit, derive total quantity (in g, ml
// or units) and a normalised unit price (per kg, per L or per unit).
export function quantities(price, refPrice, refFormat) {
  const [qu, factor] = baseUnit(refFormat);
  if (!price || !refPrice) return { q: null, qu, up: null, uf: { g: 'kg', ml: 'L', ud: 'ud' }[qu] };
  const qRaw = (price / refPrice) * factor;
  // Unit counts are integers; small differences come from rounded unit prices.
  const q = qu === 'ud' ? (Math.abs(qRaw - Math.round(qRaw)) < 0.2 ? Math.round(qRaw) : round(qRaw, 1)) : round(qRaw, 0);
  const up = qu === 'ud' ? refPrice / factor : (refPrice / factor) * 1000;
  return { q: q || null, qu, up: round(up, 2), uf: { g: 'kg', ml: 'L', ud: 'ud' }[qu] };
}

export const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(String(v).replace(',', '.').trim());
  return Number.isFinite(n) ? n : null;
};

export const round = (n, d = 2) => (n == null ? null : Math.round(n * 10 ** d) / 10 ** d);

export async function getJSON(url, opts = {}, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        ...opts,
        headers: { 'user-agent': UA, accept: 'application/json', ...(opts.headers || {}) },
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) {
        const e = new Error(`HTTP ${res.status} ${url}`);
        e.fatal = true;
        throw e;
      }
      return { json: await res.json(), headers: res.headers };
    } catch (e) {
      last = e;
      if (e.fatal) break;
      await sleep(1000 * 2 ** i);
    }
  }
  throw last;
}

// Run async fn over items with limited concurrency and a pause between calls.
export async function pool(items, size, fn, pause = 250) {
  const out = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx], idx);
        await sleep(pause);
      }
    }),
  );
  return out;
}
