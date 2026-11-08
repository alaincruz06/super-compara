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
  ['carne', 'Carne', /carne/],
  ['pescado', 'Pescado y marisco', /pescado|marisco/],
  ['charcuteria', 'Charcutería y quesos', /charcut|queso/],
  ['lacteos', 'Huevos, leche y mantequilla', /huevo|leche|mantequilla/],
  ['yogures', 'Yogures y postres', /yogur|postre/],
  ['panaderia', 'Panadería y bollería', /panader|\bpan\b|bolleria|pasteler|reposter/],
  ['congelados', 'Congelados y helados', /congelad|helad/],
  ['despensa', 'Arroz, pasta y legumbres', /arroz|pasta|legumbre/],
  ['aceite', 'Aceite, salsas y especias', /aceite|salsa|especia/],
  ['conservas', 'Conservas, caldos y cremas', /conserva|caldo|crema|sopa/],
  ['desayuno', 'Café, cereales y galletas', /cafe|cacao|infusion|cereal|galleta|mermelad/],
  ['dulces', 'Azúcar, chocolate y golosinas', /azucar|chocolate|golosina|caramelo|dulce/],
  ['aperitivos', 'Aperitivos y frutos secos', /aperitivo|frutos secos|snack/],
  ['preparados', 'Platos preparados y pizzas', /preparad|pizza/],
  ['bebidas', 'Agua, refrescos y zumos', /agua|refresco|zumo|smoothie/],
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

// Convert a reference unit ("kg", "L", "ud", "KILO", "LITRO"...) into the
// base unit we compare in: grams, millilitres or units.
export function baseUnit(ref = '') {
  const r = strip(ref).replace(/[^a-z]/g, '');
  if (/^(kg|kilo|kilos|kilogramo)$/.test(r)) return ['g', 1000];
  if (/^(g|gr|gramo|gramos)$/.test(r)) return ['g', 1];
  if (/^(l|litro|litros|lt)$/.test(r)) return ['ml', 1000];
  if (/^(ml|mililitro|mililitros)$/.test(r)) return ['ml', 1];
  if (/^(cl)$/.test(r)) return ['ml', 10];
  return ['ud', 1];
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
