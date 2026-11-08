// Dia sync — browser method. Open https://www.dia.es in your normal browser,
// press F12 → Console, paste this whole file and press Enter. Keep the tab open
// (about 10 minutes). When it finishes it downloads dia.json; then run:
//   node dia-sync.mjs --upload ~/Downloads/dia.json
(async () => {
  const TERMS = ["leche", "yogur", "queso", "mantequilla", "huevos", "nata", "bebida vegetal", "kefir", "postre", "flan", "natillas", "pan", "pan de molde", "tostadas", "picos", "bolleria", "magdalenas", "croissant", "galletas", "cereales", "muesli", "mermelada", "cacao", "cafe", "capsulas", "te", "infusion", "azucar", "edulcorante", "harina", "levadura", "chocolate", "bombones", "caramelos", "chicles", "gominolas", "turron", "arroz", "pasta", "espaguetis", "macarrones", "fideos", "legumbres", "garbanzos", "lentejas", "alubias", "aceite", "aceite de oliva", "vinagre", "sal", "especias", "pimienta", "oregano", "mayonesa", "ketchup", "mostaza", "salsa", "tomate frito", "atun", "sardinas", "mejillones", "conservas", "aceitunas", "pepinillos", "encurtidos", "maiz", "esparragos", "pimientos", "caldo", "sopa", "crema", "pure", "fruta", "manzana", "platano", "naranja", "pera", "uva", "fresas", "limon", "melon", "sandia", "kiwi", "aguacate", "verdura", "patata", "cebolla", "ajo", "zanahoria", "lechuga", "ensalada", "tomate", "pepino", "calabacin", "berenjena", "brocoli", "champiñones", "setas", "carne", "pollo", "pavo", "cerdo", "ternera", "cordero", "hamburguesa", "salchichas", "carne picada", "pescado", "salmon", "merluza", "bacalao", "gambas", "langostinos", "calamar", "pulpo", "surimi", "jamon", "jamon serrano", "jamon cocido", "chorizo", "salchichon", "fuet", "lomo", "bacon", "mortadela", "pate", "congelados", "helado", "pizza", "croquetas", "empanadillas", "verduras congeladas", "patatas fritas", "lasaña", "tortilla", "gazpacho", "hummus", "platos preparados", "sandwich", "snacks", "patatas chips", "frutos secos", "almendras", "nueces", "pistachos", "cacahuetes", "palomitas", "agua", "refresco", "cola", "naranjada", "limonada", "tonica", "zumo", "smoothie", "bebida isotonica", "bebida energetica", "cerveza", "cerveza sin alcohol", "vino", "vino tinto", "vino blanco", "cava", "sidra", "licor", "ginebra", "ron", "whisky", "vermut", "detergente", "suavizante", "lavavajillas", "friegasuelos", "lejia", "limpiador", "bayetas", "estropajo", "papel higienico", "servilletas", "papel de cocina", "bolsas de basura", "papel aluminio", "film", "insecticida", "ambientador", "pilas", "velas", "champu", "gel", "jabon", "desodorante", "pasta de dientes", "cepillo de dientes", "colutorio", "crema corporal", "crema facial", "protector solar", "maquinilla", "espuma de afeitar", "compresas", "tampones", "salvaslip", "algodon", "toallitas", "pañales", "papilla", "leche infantil", "potitos", "perfume", "colonia", "laca", "tinte", "maquillaje", "esmalte", "tiritas", "alcohol", "comida para perros", "comida para gatos", "arena gatos", "snacks mascotas", "dia", "bio", "sin gluten", "sin lactosa"];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const items = new Map();
  for (const [i, q] of TERMS.entries()) {
    for (let page = 1; page <= 30; page++) {
      let data;
      try {
        const r = await fetch(`/api/v1/search-back/search/reduced?q=${encodeURIComponent(q)}&page=${page}`, { headers: { accept: 'application/json' } });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        data = await r.json();
      } catch (e) { console.warn(q, page, e.message); break; }
      const rows = data.search_items || data.items || [];
      let added = 0;
      for (const row of rows) {
        const id = String(row.sku_id ?? row.object_id ?? '');
        if (id && !items.has(id)) { items.set(id, row); added++; }
      }
      const total = data.pagination?.total_pages ?? data.total_pages;
      await sleep(1000);
      if (!rows.length || (total && page >= total) || (!total && !added)) break;
    }
    console.log(`[${i + 1}/${TERMS.length}] ${q}: ${items.size} productos`);
  }
  const json = { fetched: new Date().toISOString(), method: 'browser', items: [...items.values()] };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(json)], { type: 'application/json' }));
  a.download = 'dia.json';
  a.click();
  console.log(`Listo: ${items.size} productos descargados en dia.json`);
})();
