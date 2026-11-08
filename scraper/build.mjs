// Builds site/data/products.json and site/data/meta.json.
// If a store fails, the previous good data for that store is kept
// (read from PREV_DIR, the checkout of the `data` branch).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fetchMercadona } from './mercadona.mjs';
import { fetchDia } from './dia.mjs';
import { GROUPS } from './common.mjs';

const OUT = new URL('../site/data/', import.meta.url);
const PREV = process.env.PREV_DIR;
const POSTAL = process.env.POSTAL_CODE || '30002';

async function readPrev() {
  if (!PREV) return { items: [], meta: { stores: {} } };
  try {
    const items = JSON.parse(await readFile(`${PREV}/products.json`, 'utf8')).items;
    const meta = JSON.parse(await readFile(`${PREV}/meta.json`, 'utf8'));
    return { items, meta };
  } catch {
    return { items: [], meta: { stores: {} } };
  }
}

const prev = await readPrev();
const stores = {
  m: { name: 'Mercadona', run: () => fetchMercadona({ postalCode: POSTAL }) },
  d: { name: 'Dia', run: () => fetchDia() },
};

const items = [];
const metaStores = {};
for (const [code, st] of Object.entries(stores)) {
  let res = null;
  let error = null;
  try {
    res = await st.run();
  } catch (e) {
    error = e.message;
    console.error(`${st.name} failed:`, e);
  }
  const ok = res && res.items.length > 50;
  if (ok) {
    // Flag price drops against the previous day's snapshot.
    const before = new Map(prev.items.filter((i) => i.s === code).map((i) => [i.id, i.p]));
    for (const it of res.items) {
      const old = before.get(it.id);
      if (!it.pp && old && old > it.p) {
        it.pp = old;
        it.d = Math.round(((old - it.p) / old) * 100);
      }
    }
    items.push(...res.items);
    metaStores[code] = { name: st.name, count: res.items.length, updated: new Date().toISOString(), status: 'ok', ...res.meta };
    // Stores synced from elsewhere carry their own fetch time; flag old data.
    if (Date.now() - new Date(metaStores[code].updated) > 7 * 864e5) metaStores[code].status = 'old';
  } else {
    const old = prev.items.filter((i) => i.s === code);
    items.push(...old);
    const oldMeta = prev.meta.stores?.[code] || {};
    metaStores[code] = {
      ...oldMeta,
      name: st.name,
      count: old.length,
      status: old.length ? 'stale' : res === null && !error ? 'pending' : 'error',
      lastError: error || (res ? `only ${res.items.length} products` : undefined),
    };
  }
}

const meta = {
  built: new Date().toISOString(),
  postalCode: POSTAL,
  groups: [...GROUPS.map(([id, name]) => ({ id, name })), { id: 'otros', name: 'Otros' }],
  stores: metaStores,
};

await mkdir(OUT, { recursive: true });
await writeFile(new URL('products.json', OUT), JSON.stringify({ items }));
await writeFile(new URL('meta.json', OUT), JSON.stringify(meta, null, 2));
console.log('Built', items.length, 'products', JSON.stringify(metaStores));
if (!items.length) process.exit(1);
