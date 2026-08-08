/* ============================================================
   ADDIS OUTFITS · CATALOG EXPORTER  (fixed pagination)
   ------------------------------------------------------------
   Run this ON addisoutfits.com (not on the stockroom app) so it
   reads your store's own public product feed with no CORS issue
   and no API key. It downloads a file you then load into the
   stockroom app with "Fill photos & sizes".

   HOW TO RUN IT
   1. Open addisoutfits.com in Chrome or Edge (any page on the site).
   2. Press F12 (or right-click → Inspect) to open DevTools.
   3. Click the "Console" tab.
   4. If Chrome shows a paste-safety warning, type "allow pasting"
      and press Enter first.
   5. Paste this whole file in and press Enter.
   6. Watch the log lines — it downloads "addisoutfits-catalog.json"
      when done.
   ============================================================ */

(async function () {
  const BASE = location.origin;
  const MAX_PAGES = 100; // safety cap
  let page = 1;
  let allProducts = [];
  let lastFirstId = null; // used to detect a store that ignores ?page=

  console.log('Fetching your product catalog from', BASE, '…');

  while (page <= MAX_PAGES) {
    const res = await fetch(`${BASE}/products.json?limit=250&page=${page}`);
    if (!res.ok) {
      console.error('Request failed:', res.status, res.statusText);
      break;
    }
    const data = await res.json();
    const products = data.products || [];

    if (products.length === 0) {
      console.log(`Empty page — reached the end at page ${page}.`);
      break;
    }

    const firstId = products[0].id;
    if (firstId === lastFirstId) {
      console.log(`Page ${page} repeated the previous page — this store doesn't support paging past here, stopping.`);
      break;
    }
    lastFirstId = firstId;

    allProducts = allProducts.concat(products);
    console.log(`  page ${page}: +${products.length} products (total ${allProducts.length})`);

    if (products.length < 250) {
      console.log('Last page reached.');
      break;
    }
    page++;
  }

  const catalog = {};
  allProducts.forEach(p => {
    const fallbackImage = (p.images && p.images[0] && p.images[0].src) || '';
    (p.variants || []).forEach(v => {
      const image = (v.featured_image && v.featured_image.src) || fallbackImage;
      const sizeColor = (v.title && v.title !== 'Default Title') ? v.title : '';
      catalog[String(v.id)] = {
        image,
        sizeColor,
        product: p.title,
        handle: p.handle,
      };
    });
  });

  const ids = Object.keys(catalog);
  console.log(`Done — ${ids.length} unique variants across ${allProducts.length} product fetches.`);
  console.log('Sample variant IDs found:', ids.slice(0, 5));

  const blob = new Blob([JSON.stringify(catalog, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'addisoutfits-catalog.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
})();
