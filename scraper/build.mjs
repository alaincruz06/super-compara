// Builds one data file per price list plus meta.json:
//   site/data/m-<warehouse>.json   Mercadona, one per warehouse
//   site/data/c.json               Consum (national online prices)
//   site/data/d.json               Dia (synced from the owner's computer)
// The site picks the files that apply to the visitor's postal code.
// If a dataset fails, the previous good file is kept (PREV_DIR = last deploy's data/).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { provinceWarehouses, fetchWarehouse } from './mercadona.mjs';
import { fetchConsum, CONSUM_PROVINCES } from './consum.mjs';
import { fetchDia } from './dia.mjs';
import { GROUPS } from './common.mjs';

const OUT = new URL('../site/data/', import.meta.url);
const PREV = process.env.PREV_DIR;
const FALLBACK_WH = 'mad3';

const readJSON = async (name) => {
  if (!PREV) return null;
  try { return JSON.parse(await readFile(`${PREV}/${name}`, 'utf8')); } catch { return null; }
};
const prevMeta = (await readJSON('meta.json')) || {};
const legacy = await readJSON('products.json'); // single-file format used before

async function prevItems(id, store) {
  const f = await readJSON(`${id}.json`);
  if (f?.items) return f.items;
  if (legacy?.items && id === 'm-alc1') return legacy.items.filter((i) => i.s === store);
  if (legacy?.items && id === store) return legacy.items.filter((i) => i.s === store);
  return [];
}

// ---------- decide which datasets to build ----------
let provinces = await provinceWarehouses();
if (Object.keys(provinces).length < 3) {
  console.log('Mercadona province lookup failed; reusing previous map');
  provinces = prevMeta.stores?.m?.provinces || { '30': 'alc1', '03': 'alc1' };
}
const warehouses = [...new Set([...Object.values(provinces), FALLBACK_WH])].sort();

const jobs = [
  ...warehouses.map((wh) => ({ id: `m-${wh}`, store: 'm', name: `Mercadona (${wh})`, run: () => fetchWarehouse(wh) })),
  { id: 'c', store: 'c', name: 'Consum', run: () => fetchConsum() },
  { id: 'd', store: 'd', name: 'Dia', run: () => fetchDia() },
];

// ---------- run ----------
await mkdir(OUT, { recursive: true });
const datasets = {};
for (const job of jobs) {
  let res = null;
  let error = null;
  try {
    res = await job.run();
  } catch (e) {
    error = e.message;
    console.error(`${job.name} failed:`, e.message);
  }
  const before = await prevItems(job.id, job.store);
  let items;
  let info;
  if (res && res.items.length > 50) {
    // Flag price drops against the previous snapshot.
    const old = new Map(before.map((i) => [i.id, i.p]));
    for (const it of res.items) {
      const o = old.get(it.id);
      if (!it.pp && o && o > it.p) {
        it.pp = o;
        it.d = Math.round(((o - it.p) / o) * 100);
      }
    }
    items = res.items;
    info = { store: job.store, count: items.length, updated: new Date().toISOString(), status: 'ok', ...res.meta };
    if (Date.now() - new Date(info.updated) > 7 * 864e5) info.status = 'old';
  } else {
    items = before;
    const pm = prevMeta.datasets?.[job.id] || {};
    info = {
      ...pm,
      store: job.store,
      count: items.length,
      status: items.length ? 'stale' : res === null && !error ? 'pending' : 'error',
      lastError: error || (res ? `only ${res.items.length} products` : undefined),
    };
  }
  datasets[job.id] = info;
  if (items.length) await writeFile(new URL(`${job.id}.json`, OUT), JSON.stringify({ items }));
}

const meta = {
  built: new Date().toISOString(),
  groups: [...GROUPS.map(([id, name]) => ({ id, name })), { id: 'otros', name: 'Otros' }],
  stores: {
    m: { name: 'Mercadona', provinces, fallback: FALLBACK_WH },
    c: { name: 'Consum', provinces: CONSUM_PROVINCES },
    d: { name: 'Dia', national: true },
  },
  datasets,
};
await writeFile(new URL('meta.json', OUT), JSON.stringify(meta, null, 2));
console.log('Built', JSON.stringify(datasets));
if (!Object.values(datasets).some((d) => d.count)) process.exit(1);
