// One-off probe: fetches a Dia category page and search API via Bright Data
// Web Unlocker and prints what endpoints/data structures are available.
const KEY = process.env.BRIGHTDATA_API_KEY, ZONE = process.env.BRIGHTDATA_ZONE;
if (!KEY || !ZONE) { console.log('Missing BRIGHTDATA_API_KEY / BRIGHTDATA_ZONE secrets'); process.exit(1); }
async function unlock(url) {
  const r = await fetch('https://api.brightdata.com/request', {
    method: 'POST',
    headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ zone: ZONE, url, format: 'raw', country: 'es' }),
  });
  return { status: r.status, text: await r.text() };
}
const plp = await unlock('https://www.dia.es/frutas/c/L105');
console.log('PLP', plp.status, plp.text.length);
console.log('api paths:', [...new Set(plp.text.match(/\/api\/v1\/[\w\-\/]+/g) || [])].slice(0, 40));
console.log('globals:', [...new Set(plp.text.match(/window\.__[A-Z_]+__|__NEXT_DATA__|vike_pageContext|__INITIAL_STATE__/g) || [])]);
const i = plp.text.indexOf('display_name');
console.log('display_name context:', i, plp.text.slice(Math.max(0, i - 600), i + 900));
const scripts = [...new Set(plp.text.match(/src="([^"]+\.js)"/g) || [])].slice(0, 15);
console.log('scripts:', scripts);
for (const u of ['https://www.dia.es/api/v1/search-back/search/reduced?q=leche&page=1',
                 'https://www.dia.es/api/v1/plp-back/reduced/L105?page=1']) {
  const r = await unlock(u);
  console.log('\n==', u, r.status, r.text.slice(0, 1500));
}
