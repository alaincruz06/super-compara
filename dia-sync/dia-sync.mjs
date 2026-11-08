#!/usr/bin/env node
// Dia sync — run on YOUR computer (home connection). No dependencies, Node 18+.
//
//   node dia-sync.mjs                 fetch Dia products and upload them
//   node dia-sync.mjs --no-upload     fetch only, write dia.json next to this file
//   node dia-sync.mjs --upload FILE   upload an existing JSON file (e.g. the one
//                                     the browser snippet downloaded)
//
// Uploading needs a GitHub fine-grained token for alaincruz06/super-compara
// with "Contents: Read and write" and "Actions: Read and write", in the env
// var SUPERCOMPARA_TOKEN (or in a file named .token next to this script).
// It stores dia.json on the data-only `dia-data` branch and starts a rebuild.
//
// It uses Dia's own product search (the same one the website's search box
// uses) for a list of everyday grocery terms, one request per second.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = 'alaincruz06/super-compara';
const BRANCH = 'dia-data';
const UA = 'SuperCompara-DiaSync/1.0 (personal price comparison; +https://github.com/alaincruz06/super-compara)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const args = process.argv.slice(2);

async function fetchPage(q, page) {
  const url = `https://www.dia.es/api/v1/search-back/search/reduced?q=${encodeURIComponent(q)}&page=${page}`;
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json', 'accept-language': 'es-ES' } });
  const text = await res.text();
  if (!res.ok || text.trimStart().startsWith('<')) {
    const e = new Error(`Dia answered HTTP ${res.status}${/Access Denied/i.test(text) ? ' (Access Denied)' : ''}`);
    e.blocked = res.status === 403;
    throw e;
  }
  return JSON.parse(text);
}

async function fetchAll() {
  const terms = JSON.parse(await readFile(join(HERE, 'terms.json'), 'utf8'));
  const items = new Map();
  let requests = 0;
  for (const [i, q] of terms.entries()) {
    for (let page = 1; page <= 30; page++) {
      let data;
      try {
        data = await fetchPage(q, page);
      } catch (e) {
        if (e.blocked && requests === 0) {
          console.error(`\n${e.message}. Dia is not accepting requests from this script.`);
          console.error('Use the browser method instead: see dia-sync/README.md ("Option B").');
          process.exit(2);
        }
        console.warn(`  ${q} p${page}: ${e.message}`);
        break;
      }
      requests++;
      const rows = data.search_items || data.items || [];
      let added = 0;
      for (const r of rows) {
        const id = String(r.sku_id ?? r.object_id ?? '');
        if (id && !items.has(id)) { items.set(id, r); added++; }
      }
      const total = data.pagination?.total_pages ?? data.total_pages;
      await sleep(1000);
      if (!rows.length || (total && page >= total) || (!total && !added)) break;
    }
    process.stdout.write(`\r[${i + 1}/${terms.length}] ${q.padEnd(22)} products: ${items.size}   `);
  }
  console.log(`\nDone: ${items.size} products, ${requests} requests.`);
  return { fetched: new Date().toISOString(), method: 'node', items: [...items.values()] };
}

async function token() {
  if (process.env.SUPERCOMPARA_TOKEN) return process.env.SUPERCOMPARA_TOKEN.trim();
  try { return (await readFile(join(HERE, '.token'), 'utf8')).trim(); } catch { return null; }
}

async function gh(path, opts = {}) {
  const t = await token();
  const res = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    ...opts,
    headers: { authorization: `Bearer ${t}`, accept: 'application/vnd.github+json', 'user-agent': UA, ...(opts.headers || {}) },
  });
  return res;
}

async function upload(json) {
  if (!(await token())) {
    console.error('No token: set SUPERCOMPARA_TOKEN or create dia-sync/.token. File saved locally only.');
    return false;
  }
  const call = async (path, body) => {
    const r = await gh(path, body ? { method: 'POST', body: JSON.stringify(body) } : {});
    if (!r.ok && r.status !== 404) throw new Error(`GitHub ${path}: ${r.status} ${await r.text()}`);
    return r.status === 404 ? null : r.json();
  };
  // dia-data is a data-only branch holding just dia.json (latest snapshot).
  const ref = await call(`/git/ref/heads/${BRANCH}`);
  const blob = await call('/git/blobs', { content: Buffer.from(JSON.stringify(json)).toString('base64'), encoding: 'base64' });
  const tree = await call('/git/trees', { tree: [{ path: 'dia.json', mode: '100644', type: 'blob', sha: blob.sha }] });
  const commit = await call('/git/commits', {
    message: `Dia prices ${json.fetched.slice(0, 10)} (${json.items.length} products)`,
    tree: tree.sha,
    parents: ref ? [ref.object.sha] : [],
  });
  if (ref) {
    const r = await gh(`/git/refs/heads/${BRANCH}`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha, force: true }) });
    if (!r.ok) throw new Error(`Update branch failed: ${r.status} ${await r.text()}`);
  } else {
    await call('/git/refs', { ref: `refs/heads/${BRANCH}`, sha: commit.sha });
  }
  console.log(`Uploaded ${json.items.length} Dia products to GitHub.`);
  // Rebuild the site now.
  const r = await gh('/actions/workflows/update.yml/dispatches', { method: 'POST', body: JSON.stringify({ ref: 'main' }) });
  console.log(r.ok ? 'Site rebuild started; it will be live in ~3 minutes.' : `Could not start the rebuild (${r.status}); it will run at the next daily update.`);
  return true;
}

const i = args.indexOf('--upload');
if (i >= 0) {
  const file = args[i + 1];
  const json = JSON.parse(await readFile(file, 'utf8'));
  if (!json.items?.length) throw new Error('File has no items');
  json.fetched ||= new Date().toISOString();
  await upload(json);
} else {
  const json = await fetchAll();
  if (json.items.length < 50) { console.error('Too few products, not uploading.'); process.exit(1); }
  const out = join(HERE, 'dia.json');
  await writeFile(out, JSON.stringify(json));
  console.log(`Saved ${out}`);
  if (!args.includes('--no-upload')) await upload(json);
}
