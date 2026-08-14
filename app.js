/* ============================================================
   ADDIS OUTFITS · STOCKROOM
   All data lives in this browser's localStorage. Nothing is
   sent to a server — export regularly to back up.
   ============================================================ */

const STORAGE_KEY = 'addisoutfits_inventory_v1';
const CATALOG_KEY = 'addisoutfits_catalog_v1';
const GITHUB_KEY = 'addisoutfits_github_sync_v1';
const DIRTY_KEY = 'addisoutfits_github_dirty_v1';
const LOW_STOCK_THRESHOLD = 1; // qty <= this (and > 0) counts as "low stock"
const DISCOUNT_KEY = 'addisoutfits_discount_pct_v1';
const THEME_KEY = 'addisoutfits_theme_v1';
const PROXY_KEY = 'addisoutfits_proxy_url_v1';

// ------------------------------------------------------------------
// PUBLIC DATA SOURCE — fill this in once and every visitor to your
// site (no login, no token) automatically sees the live inventory,
// straight from your public GitHub repo. Only editing requires the
// ☁ token setup (that's still just for you, the owner).
// ------------------------------------------------------------------
const PUBLIC_DATA_SOURCE = {
  owner: 'robina2721',
  repo: 'stockroom',
  branch: 'main',
  path: 'data/inventory-live.json',
};
function publicSourceConfigured() {
  return PUBLIC_DATA_SOURCE.owner !== 'YOUR-GITHUB-USERNAME' && PUBLIC_DATA_SOURCE.repo !== 'YOUR-REPO-NAME';
}
function publicRawUrl() {
  return `https://raw.githubusercontent.com/${PUBLIC_DATA_SOURCE.owner}/${PUBLIC_DATA_SOURCE.repo}/${PUBLIC_DATA_SOURCE.branch}/${PUBLIC_DATA_SOURCE.path}`;
}

let state = {
  items: [],
  catalog: {},        // variantId -> { image, sizeColor, product, handle }
  catalogMeta: null,  // { count, updatedAt }
  github: null,        // { owner, repo, branch, path, token } — only set on the owner's own device(s)
  search: '',
  filter: 'all',
  sort: 'newest',
  editingId: null,
};

// ---------- persistence ----------

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      state.items = JSON.parse(raw);
      render();
      // ensure any loaded catalog can backfill missing price/image data
      if (state.catalog && Object.keys(state.catalog).length) backfillItemsFromCatalog();
      return;
    } catch (e) {
      console.error('Could not read saved stockroom data', e);
    }
  }
  // first run — seed from the bundled spreadsheet export
  fetch('data/products.json')
    .then(r => r.ok ? r.json() : [])
    .then(seed => {
      state.items = seed;
      saveState();
      render();
    })
    .catch(() => { state.items = []; render(); });
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.items));
  if (state.github) localStorage.setItem(DIRTY_KEY, '1'); // mark "not yet pushed" immediately, synchronously
  scheduleGithubPush();
}function loadCatalog() {
  const raw = localStorage.getItem(CATALOG_KEY);
  if (!raw) return;
  try {
    const saved = JSON.parse(raw);
    state.catalog = saved.catalog || {};
    state.catalogMeta = saved.meta || null;
    // recompute prices using current discount and backfill items
    applyDiscountPctToCatalog(loadDiscountPct());
    backfillItemsFromCatalog();
  } catch (e) {
    console.error('Could not read saved catalog', e);
  }
}

function backfillItemsFromCatalog() {
  let changed = false;
  const pct = loadDiscountPct();
  const mult = Math.max(0, Math.min(100, Number(pct || 30))) / 100;
  state.items.forEach(item => {
    const entry = state.catalog[item.variantId];
    if (!entry) return;
    if (entry.image && !item.imageUrl) { item.imageUrl = entry.image; changed = true; }
    if (entry.sizeColor && !item.sizeColor) { item.sizeColor = entry.sizeColor; changed = true; }
    if (entry.listPrice != null && item.listPrice == null) {
      item.listPrice = entry.listPrice;
      item.price = Math.round((Number(entry.listPrice) * mult) * 100) / 100;
      changed = true;
    } else if (entry.price != null && item.price == null) {
      item.price = entry.price;
      if (item.listPrice == null) item.listPrice = Math.round((Number(entry.price) / Math.max(mult, 0.00001)) * 100) / 100;
      changed = true;
    }
  });
  if (changed) saveState();
}

function loadDiscountPct() {
  const raw = localStorage.getItem(DISCOUNT_KEY);
  if (raw == null) return 30;
  const n = Number(raw);
  return isNaN(n) ? 30 : n;
}

function saveDiscountPct(pct) {
  localStorage.setItem(DISCOUNT_KEY, String(pct));
}

function applyDiscountPctToCatalog(pct) {
  const mult = Math.max(0, Math.min(100, Number(pct || 30))) / 100;
  Object.keys(state.catalog || {}).forEach(k => {
    const e = state.catalog[k] || {};
    if (e.listPrice != null) {
      e.price = Math.round((Number(e.listPrice) * mult) * 100) / 100;
    } else if (e.price != null) {
      e.listPrice = Math.round((Number(e.price) / Math.max(mult, 0.00001)) * 100) / 100;
    }
  });
  // update items too
  state.items.forEach(item => {
    if (item.listPrice != null) {
      item.price = Math.round((Number(item.listPrice) * mult) * 100) / 100;
    } else {
      const entry = state.catalog[item.variantId];
      if (entry && entry.price != null) {
        item.listPrice = entry.listPrice;
        item.price = entry.price;
      }
    }
  });
  saveCatalog();
  saveState();
}

function loadTheme() {
  const t = localStorage.getItem(THEME_KEY);
  return t === 'dark' ? 'dark' : 'light';
}

function saveTheme(theme) {
  localStorage.setItem(THEME_KEY, theme === 'dark' ? 'dark' : 'light');
}

function applyTheme(theme) {
  const t = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', t === 'dark' ? 'dark' : '');
  // update quick toggle button aria/visual state if present
  const btn = document.getElementById('btnThemeToggle');
  if (btn) btn.textContent = t === 'dark' ? '🌙' : '🌓';
}

function loadProxyUrl() {
  return localStorage.getItem(PROXY_KEY) || '';
}

function saveProxyUrl(url) {
  if (!url) localStorage.removeItem(PROXY_KEY);
  else localStorage.setItem(PROXY_KEY, url);
}

async function fetchCatalogViaCustomProxy(proxyBase) {
  const statusEl = document.getElementById('catalogStatus');
  if (!proxyBase) return false;
  const base = proxyBase.replace(/\/+$/, '');
  try {
    if (statusEl) statusEl.textContent = `Fetching catalog via proxy…`;
    const start = Date.now();
    const url = `${base}/catalog?base=${encodeURIComponent(location.origin)}`;
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`Proxy returned ${r.status}`);
    const data = await r.json();
    const products = data.products || [];
    if (!products.length) {
      if (statusEl) statusEl.textContent = `Proxy returned no products.`;
      return false;
    }
    const catalog = buildCatalogFromProducts(products);
    state.catalog = catalog;
    state.catalogMeta = { count: Object.keys(catalog).length, updatedAt: new Date().toISOString().slice(0,10), source: base };
    saveCatalog();
    applyDiscountPctToCatalog(loadDiscountPct());
    backfillItemsFromCatalog();
    renderCatalogStatus();
    render();
    const took = ((Date.now() - start)/1000).toFixed(1);
    if (statusEl) statusEl.textContent = `Loaded ${state.catalogMeta.count} variants via proxy in ${took}s`;
    toast(`<span>Catalog loaded via proxy — ${state.catalogMeta.count} variants</span>`);
    return true;
  } catch (err) {
    console.error('Proxy fetch error', err);
    if (statusEl) statusEl.textContent = `Proxy fetch failed: ${err.message}`;
    toast(`<span>Proxy fetch failed: ${escapeHtml(err.message || String(err))}</span>`);
    return false;
  }
}

// Build catalog entries from a Shopify-like products array (products with variants)
function buildCatalogFromProducts(allProducts) {
  const catalog = {};
  const pct = loadDiscountPct();
  const mult = Math.max(0, Math.min(100, Number(pct || 30))) / 100;
  allProducts.forEach(p => {
    const fallbackImage = (p.images && p.images[0] && p.images[0].src) || '';
    (p.variants || []).forEach(v => {
      const image = (v.featured_image && v.featured_image.src) || fallbackImage || '';
      const sizeColor = (v.title && v.title !== 'Default Title') ? v.title : '';
      const priceRaw = v.price || v.price_amount || v.price_raw || v.compare_at_price || v.presentment_price || null;
      const priceNum = priceRaw != null ? Number(priceRaw) : null;
      const discounted = priceNum != null ? Math.round((priceNum * mult) * 100) / 100 : null;
      catalog[String(v.id)] = {
        image,
        sizeColor,
        product: p.title,
        handle: p.handle,
        listPrice: priceNum != null ? priceNum : undefined,
        price: discounted != null ? discounted : undefined,
      };
    });
  });
  return catalog;
}

// Try to auto-fetch the product catalog from the current origin using paged products.json (Shopify-style)
async function tryAutoFetchCatalogFromOrigin(maxPages = 50) {
  try {
    const BASE = location.origin;
    let page = 1;
    let allProducts = [];
    while (page <= maxPages) {
      const res = await fetch(`${BASE}/products.json?limit=250&page=${page}`);
      if (!res.ok) break;
      const data = await res.json();
      const products = data.products || [];
      if (!products.length) break;
      allProducts = allProducts.concat(products);
      if (products.length < 250) break;
      page++;
    }
    // If the bulk products.json endpoint returned nothing (CORS or store doesn't expose it),
    // try parsing the sitemap and fetching individual product JSON endpoints as a fallback.
    if (!allProducts.length) {
      try {
        const sitemapProducts = await tryFetchSitemapAndProducts(BASE, 400);
        if (sitemapProducts && sitemapProducts.length) allProducts = sitemapProducts;
      } catch (e) {
        console.debug('Sitemap/product fetch fallback failed', e);
      }
    }

    if (allProducts.length) {
      const catalog = buildCatalogFromProducts(allProducts);
      state.catalog = catalog;
      state.catalogMeta = { count: Object.keys(catalog).length, updatedAt: new Date().toISOString().slice(0,10), source: location.origin };
      saveCatalog();
      renderCatalogStatus();
      // backfill items with price/image/sizeColor when matches found
      let matched = 0;
      state.items.forEach(item => {
        const entry = catalog[item.variantId];
        if (entry) {
          if (entry.image) item.imageUrl = entry.image;
          if (entry.sizeColor) item.sizeColor = entry.sizeColor;
          if (entry.price) { item.listPrice = entry.listPrice; item.price = entry.price; }
          matched++;
        }
      });
      saveState();
      render();
      toast(`<span>Auto-loaded catalog (${state.catalogMeta.count} variants) from this site — filled ${matched} items.</span>`);
      return true;
    }
  } catch (e) {
    console.debug('Auto-fetch catalog failed:', e);
  }
  // last resort: try a local proxy (useful during development). Run the provided proxy at http://localhost:3000
  try {
    const proxyUrl = `http://localhost:3000/catalog?base=${encodeURIComponent(location.origin)}`;
    const r = await fetch(proxyUrl);
    if (r.ok) {
      const data = await r.json();
      const products = data.products || [];
      if (products.length) {
        const catalog = buildCatalogFromProducts(products);
        state.catalog = catalog;
        state.catalogMeta = { count: Object.keys(catalog).length, updatedAt: new Date().toISOString().slice(0,10), source: proxyUrl };
        saveCatalog();
        renderCatalogStatus();
        backfillItemsFromCatalog();
        render();
        toast(`<span>Loaded catalog via local proxy (${state.catalogMeta.count} variants)</span>`);
        return true;
      }
    }
  } catch (err) {
    console.debug('Proxy fetch failed', err);
  }

  return false;
}

// Fallback: fetch the store's sitemap_products_1.xml (if present), extract product URLs,
// then attempt to fetch per-product JSON endpoints. This is best-effort and may be CORS-blocked.
async function tryFetchSitemapAndProducts(BASE, maxProducts = 400) {
  const sitemapUrl = `${BASE}/sitemap_products_1.xml`;
  const res = await fetch(sitemapUrl);
  if (!res.ok) throw new Error(`Sitemap fetch failed: ${res.status}`);
  const xml = await res.text();
  const locs = Array.from(xml.matchAll(/<loc>([^<]+)<\/loc>/gi)).map(m => m[1]).filter(Boolean);
  if (!locs.length) return [];

  const products = [];
  for (let i = 0; i < locs.length && products.length < maxProducts; i++) {
    const url = locs[i];
    // try common JSON endpoints for Shopify stores
    const candidates = [
      `${url}.json`,
      url.replace(/\.html$/, '') + '.json',
      `${BASE}/products/${url.split('/').filter(Boolean).pop()}.json`,
    ];
    let ok = false;
    for (const c of candidates) {
      try {
        const r = await fetch(c);
        if (!r.ok) continue;
        const data = await r.json();
        // product JSON may be wrapped (e.g. { product: {...} }) or be the product directly
        const p = data.product || data.products || data;
        // normalize: if it's an object with product, take it; if an array, concat
        if (Array.isArray(p)) p.forEach(x => products.push(x));
        else if (p && p.id) products.push(p);
        ok = true;
        break;
      } catch (err) {
        // network/CORS error - try next candidate
        continue;
      }
    }
    // small delay to avoid spamming the origin (keeps UI responsive)
    if (i % 20 === 0) await new Promise(r => setTimeout(r, 60));
  }
  return products;
}

function saveCatalog() {
  try {
    localStorage.setItem(CATALOG_KEY, JSON.stringify({ catalog: state.catalog, meta: state.catalogMeta }));
  } catch (e) {
    console.error('Could not save catalog (it may be too large for this browser)', e);
    alert("Couldn't save the catalog locally — it may be too large for this browser's storage. Photos were still applied to your current items, but you'll need to re-load the catalog file next time you sync new items.");
  }
}

function catalogLookup(item) {
  return state.catalog[item.variantId];
}

// ---------- GitHub cross-device sync ----------
// Stores the inventory as a JSON file in your GitHub repo via the Contents
// API, so any device with the same settings reads/writes the same file.

let githubSha = null;      // current file's blob sha, needed to overwrite it
let githubPushTimer = null;
let githubBusy = false;

function loadGithubSettings() {
  const raw = localStorage.getItem(GITHUB_KEY);
  if (!raw) return;
  try {
    state.github = JSON.parse(raw);
  } catch (e) {
    console.error('Could not read saved GitHub sync settings', e);
  }
}

function saveGithubSettings(cfg) {
  state.github = cfg;
  localStorage.setItem(GITHUB_KEY, JSON.stringify(cfg));
}

function clearGithubSettings() {
  state.github = null;
  githubSha = null;
  localStorage.removeItem(GITHUB_KEY);
}

function githubApiUrl(cfg) {
  return `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${cfg.path.split('/').map(encodeURIComponent).join('/')}`;
}

function b64EncodeUnicode(str) {
  return btoa(unescape(encodeURIComponent(str)));
}
function b64DecodeUnicode(str) {
  return decodeURIComponent(escape(atob(str)));
}

async function githubPull(cfg) {
  const res = await fetch(`${githubApiUrl(cfg)}?ref=${encodeURIComponent(cfg.branch || 'main')}`, {
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/vnd.github+json',
    },
  });
  if (res.status === 404) {
    githubSha = null;
    return null; // file doesn't exist yet — that's fine on first use
  }
  if (!res.ok) throw new Error(`GitHub pull failed: ${res.status} ${res.statusText}`);
  const data = await res.json();
  githubSha = data.sha;
  const content = b64DecodeUnicode(data.content.replace(/\n/g, ''));
  return JSON.parse(content);
}

async function githubPush(cfg, items) {
  const body = {
    message: `Stockroom update — ${new Date().toISOString()}`,
    content: b64EncodeUnicode(JSON.stringify(items, null, 2)),
    branch: cfg.branch || 'main',
  };
  if (githubSha) body.sha = githubSha;

  const res = await fetch(githubApiUrl(cfg), {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (res.status === 409) {
    // someone else (another device) wrote in the meantime — refetch sha and retry once
    const latest = await githubPull(cfg);
    body.sha = githubSha;
    const retry = await fetch(githubApiUrl(cfg), {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!retry.ok) throw new Error(`GitHub push failed after retry: ${retry.status}`);
    const retryData = await retry.json();
    githubSha = retryData.content.sha;
    return;
  }

  if (!res.ok) throw new Error(`GitHub push failed: ${res.status} ${res.statusText}`);
  const data = await res.json();
  githubSha = data.content.sha;
}

function scheduleGithubPush() {
  if (!state.github) return;
  clearTimeout(githubPushTimer);
  githubPushTimer = setTimeout(() => flushGithubPush(), 1000);
}

async function flushGithubPush() {
  if (!state.github) return false;
  if (githubBusy) return false;
  githubBusy = true;
  renderGithubStatus('Syncing to GitHub…');
  try {
    await githubPush(state.github, state.items);
    localStorage.setItem(DIRTY_KEY, '0');
    renderGithubStatus(`Synced to GitHub · ${new Date().toLocaleTimeString()}`);
    return true;
  } catch (e) {
    console.error(e);
    renderGithubStatus('Sync failed — check your connection or token (☁ button). Your change is saved on this device and will retry.');
    return false;
  } finally {
    githubBusy = false;
  }
}

async function githubPullIntoState(cfg, { silent } = {}) {
  if (!silent) renderGithubStatus('Pulling latest from GitHub…');
  try {
    const remote = await githubPull(cfg);
    if (remote && Array.isArray(remote)) {
      state.items = remote;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.items));
      render();
    }
    renderGithubStatus(`Synced to GitHub · ${new Date().toLocaleTimeString()}`);
    return true;
  } catch (e) {
    console.error(e);
    renderGithubStatus('Could not reach GitHub — check your token/repo settings (☁ button)');
    return false;
  }
}

function renderGithubStatus(text) {
  const el = document.getElementById('githubStatus');
  if (!el) return;
  if (state.github) {
    el.textContent = text;
  } else if (publicSourceConfigured()) {
    el.textContent = text || 'Live public view — connect ☁ with a token to edit';
  } else {
    el.textContent = 'Not syncing across devices — click ☁ to set up';
  }
}

async function loadPublicData() {
  try {
    const res = await fetch(`${publicRawUrl()}?_=${Date.now()}`); // cache-bust so visitors see fresh stock
    if (!res.ok) throw new Error(`${res.status}`);
    const items = await res.json();
    if (Array.isArray(items)) {
      state.items = items;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.items));
      render();
      renderGithubStatus(`Live public view · updated ${new Date().toLocaleTimeString()}`);
      return true;
    }
  } catch (e) {
    console.error('Could not load public inventory file', e);
    renderGithubStatus('Could not reach the public data file — showing your last local view');
  }
  return false;
}

// ---------- GitHub sync modal ----------

const githubBackdrop = document.getElementById('githubBackdrop');
document.getElementById('btnGithubSync').addEventListener('click', () => {
  const cfg = state.github || {};
  document.getElementById('gh_owner').value = cfg.owner || PUBLIC_DATA_SOURCE.owner;
  document.getElementById('gh_repo').value = cfg.repo || PUBLIC_DATA_SOURCE.repo;
  document.getElementById('gh_branch').value = cfg.branch || PUBLIC_DATA_SOURCE.branch;
  document.getElementById('gh_path').value = cfg.path || PUBLIC_DATA_SOURCE.path;
  document.getElementById('gh_token').value = cfg.token || '';
  document.getElementById('githubTestResult').textContent = '';
  githubBackdrop.style.display = 'flex';
});
document.getElementById('githubClose').addEventListener('click', () => githubBackdrop.style.display = 'none');
document.getElementById('githubCancel').addEventListener('click', () => githubBackdrop.style.display = 'none');
githubBackdrop.addEventListener('click', e => { if (e.target === githubBackdrop) githubBackdrop.style.display = 'none'; });

document.getElementById('githubDisconnect').addEventListener('click', () => {
  if (!confirm('Stop syncing this device with GitHub? Your local data stays as-is.')) return;
  clearGithubSettings();
  renderGithubStatus('');
  githubBackdrop.style.display = 'none';
  toast('Disconnected from GitHub sync on this device');
});

document.getElementById('githubSave').addEventListener('click', async () => {
  const cfg = {
    owner: document.getElementById('gh_owner').value.trim(),
    repo: document.getElementById('gh_repo').value.trim(),
    branch: document.getElementById('gh_branch').value.trim() || 'main',
    path: document.getElementById('gh_path').value.trim() || 'data/inventory-live.json',
    token: document.getElementById('gh_token').value.trim(),
  };
  if (!cfg.owner || !cfg.repo || !cfg.token) {
    document.getElementById('githubTestResult').textContent = 'Please fill in username, repo, and token.';
    return;
  }
  document.getElementById('githubTestResult').textContent = 'Connecting…';
  saveGithubSettings(cfg);

  try {
    const remoteItems = await githubPull(cfg);
    if (remoteItems && Array.isArray(remoteItems) && remoteItems.length) {
      const useRemote = confirm(
        `Found existing data on GitHub (${remoteItems.length} items). Click OK to use that as this device's inventory, or Cancel to keep what's on this device and overwrite GitHub with it.`
      );
      if (useRemote) {
        state.items = remoteItems;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state.items));
        render();
      } else {
        await githubPush(cfg, state.items);
      }
    } else {
      // nothing on GitHub yet — push what's here now
      await githubPush(cfg, state.items);
    }
    localStorage.setItem(DIRTY_KEY, '0');
    document.getElementById('githubTestResult').textContent = 'Connected!';
    renderGithubStatus(`Synced to GitHub · ${new Date().toLocaleTimeString()}`);
    setTimeout(() => { githubBackdrop.style.display = 'none'; }, 700);
    toast('This device is now syncing with GitHub');
  } catch (e) {
    console.error(e);
    document.getElementById('githubTestResult').textContent =
      "Couldn't connect — double check the username, repo name, and that the token has Contents: Read & write access to this repo.";
  }
});

// ---------- helpers ----------

function statusOf(item) {
  if (item.qty <= 0) return 'sold';
  if (item.qty <= LOW_STOCK_THRESHOLD) return 'low';
  return 'stock';
}

function initials(title) {
  return title
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0].toUpperCase())
    .join('') || '?';
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function uid() {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

let toastTimer = null;
function toast(html, { undo } = {}) {
  const wrap = document.getElementById('toastWrap');
  const el = document.createElement('div');
  el.className = 'toast' + (undo ? ' undo' : '');
  el.innerHTML = html;
  if (undo) {
    el.addEventListener('click', () => { undo(); el.remove(); });
  }
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

// ---------- rendering ----------

function renderStats() {
  const items = state.items;
  const totalSkus = items.length;
  const unitsOnHand = items.reduce((s, i) => s + Math.max(i.qty, 0), 0);
  const soldTotal = items.reduce((s, i) => s + (i.sold || 0), 0);
  const lowOrOut = items.filter(i => statusOf(i) !== 'stock').length;

  document.getElementById('stats').innerHTML = `
    <div class="stat"><div class="stat-label">SKUs tracked</div><div class="stat-value">${totalSkus}</div></div>
    <div class="stat"><div class="stat-label">Units on hand</div><div class="stat-value green">${unitsOnHand}</div></div>
    <div class="stat"><div class="stat-label">Units sold</div><div class="stat-value gold">${soldTotal}</div></div>
    <div class="stat"><div class="stat-label">Low / sold out</div><div class="stat-value red">${lowOrOut}</div></div>
  `;
}

function getVisibleItems() {
  let items = [...state.items];

  if (state.search.trim()) {
    const q = state.search.trim().toLowerCase();
    items = items.filter(i =>
      (i.title || '').toLowerCase().includes(q) ||
      (i.variantId || '').toLowerCase().includes(q) ||
      (i.sizeColor || '').toLowerCase().includes(q) ||
      (i.notes || '').toLowerCase().includes(q)
    );
  }

  if (state.filter !== 'all') {
    items = items.filter(i => statusOf(i) === state.filter);
  }

  switch (state.sort) {
    case 'title': items.sort((a, b) => a.title.localeCompare(b.title)); break;
    case 'qtyLow': items.sort((a, b) => a.qty - b.qty); break;
    case 'qtyHigh': items.sort((a, b) => b.qty - a.qty); break;
    default: items.sort((a, b) => (b.dateAdded || '').localeCompare(a.dateAdded || '')); break;
  }

  return items;
}

// Find related items for queries that return no exact matches.
function findRelated(query, maxResults = 12) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const terms = q.split(/\s+/).filter(Boolean);

  const scored = state.items.map(item => {
    let score = 0;
    const title = (item.title || '').toLowerCase();
    const vid = (item.variantId || '').toLowerCase();
    const sc = (item.sizeColor || '').toLowerCase();

    if (title === q) score += 80;
    if (title.includes(q)) score += 50;
    if (title.startsWith(q)) score += 30;
    if (vid.includes(q)) score += 40;

    terms.forEach(t => {
      if (!t) return;
      if (title.includes(t)) score += 12;
      if (title.split(/\s+/).some(w => w.startsWith(t))) score += 8;
      if (vid.includes(t)) score += 8;
      if (sc.includes(t)) score += 6;
    });

    return { item, score };
  });

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map(s => s.item);
}

function cardTemplate(item) {
  const status = statusOf(item);
  const stampText = status === 'stock' ? 'In stock' : status === 'low' ? 'Low stock' : 'Sold out';
  const stampClass = status === 'stock' ? '' : status === 'low' ? 'low' : 'sold';

  const media = item.imageUrl
    ? `<img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.title)}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=&quot;monogram&quot;>${initials(item.title)}</div>'">`
    : `<div class="monogram">${initials(item.title)}</div>`;

  return `
  <article class="card" data-id="${item.id}">
    <div class="card-media">
      ${media}
      <div class="stamp ${stampClass}">${stampText}</div>
    </div>
    <div class="card-body">
      <div class="card-title">${escapeHtml(item.title)}</div>
      <div class="card-meta">
        <span class="vid" data-copy="${escapeHtml(item.variantId)}" title="Click to copy variant ID">#${escapeHtml(item.variantId)}</span>
      </div>
      ${typeof item.price !== 'undefined' ? `<div class="card-price">${item.listPrice ? `<span class="orig">$${Number(item.listPrice).toFixed(2)}</span>` : ''}<span class="now">$${Number(item.price).toFixed(2)}</span></div>` : ''}
      ${item.sizeColor ? `<div class="card-tags"><span>${escapeHtml(item.sizeColor)}</span></div>` : ''}
      <div class="qty-row">
        <span class="qty-label">On hand</span>
        <div class="stepper">
          <button data-action="dec" aria-label="Decrease quantity">−</button>
          <span class="qty-num">${item.qty}</span>
          <button data-action="inc" aria-label="Increase quantity">+</button>
        </div>
      </div>
      ${item.sold ? `<div class="sold-count">${item.sold} sold to date</div>` : ''}
      <div class="card-actions">
        <button class="btn mark-sold" data-action="sell" ${item.qty <= 0 ? 'disabled' : ''}>Mark 1 sold</button>
        <button class="btn icon-btn" data-action="edit" title="Edit">✎</button>
        <button class="btn icon-btn" data-action="delete" title="Delete">🗑</button>
      </div>
    </div>
  </article>`;
}

function render() {
  renderStats();
  const grid = document.getElementById('grid');
  const items = getVisibleItems();

  if (items.length === 0) {
    if (state.search && state.search.trim()) {
      const related = findRelated(state.search);
      if (related.length) {
        grid.innerHTML = `<div class="empty" style="grid-column:1/-1;">
          <h3>No exact matches</h3>
          <p>Showing related products instead.</p>
        </div>` + related.map(cardTemplate).join('');
        return;
      }
    }

    grid.innerHTML = `<div class="empty" style="grid-column:1/-1;">
      <h3>Nothing here</h3>
      <p>Try a different search or filter, or add a new item to the stockroom.</p>
    </div>`;
    return;
  }

  grid.innerHTML = items.map(cardTemplate).join('');
}

// ---------- item actions ----------

function findItem(id) {
  return state.items.find(i => i.id === id);
}

function changeQty(id, delta) {
  const item = findItem(id);
  if (!item) return;
  item.qty = Math.max(0, item.qty + delta);
  saveState();
  render();
}

function markSold(id) {
  const item = findItem(id);
  if (!item || item.qty <= 0) return;
  item.qty -= 1;
  item.sold = (item.sold || 0) + 1;
  saveState();
  render();
  toast(`<span>Marked <strong>${escapeHtml(item.title)}</strong> as sold</span> — <u>undo</u>`, {
    undo: () => {
      item.qty += 1;
      item.sold = Math.max(0, item.sold - 1);
      saveState();
      render();
    }
  });
}

function deleteItem(id) {
  const item = findItem(id);
  if (!item) return;
  if (!confirm(`Remove "${item.title}" (#${item.variantId}) from the stockroom?`)) return;
  const idx = state.items.findIndex(i => i.id === id);
  const removed = state.items.splice(idx, 1)[0];
  saveState();
  render();
  toast(`<span>Deleted <strong>${escapeHtml(removed.title)}</strong></span> — <u>undo</u>`, {
    undo: () => {
      state.items.splice(idx, 0, removed);
      saveState();
      render();
    }
  });
}

// ---------- modal (add / edit) ----------

const modalBackdrop = document.getElementById('modalBackdrop');
const modalTitle = document.getElementById('modalTitle');
const f_title = document.getElementById('f_title');
const f_variant = document.getElementById('f_variant');
const f_qty = document.getElementById('f_qty');
const f_sizecolor = document.getElementById('f_sizecolor');
const f_image = document.getElementById('f_image');
const f_price = document.getElementById('f_price');
const f_notes = document.getElementById('f_notes');
const imgPreview = document.getElementById('imgPreview');

function openModal(item) {
  state.editingId = item ? item.id : null;
  modalTitle.textContent = item ? 'Edit item' : 'Add item';
  f_title.value = item?.title || '';
  f_variant.value = item?.variantId || '';
  f_qty.value = item ? item.qty : 1;
  f_sizecolor.value = item?.sizeColor || '';
  f_image.value = item?.imageUrl || '';
  f_price.value = item?.listPrice != null ? item.listPrice : '';
  f_notes.value = item?.notes || '';
  updateImgPreview();
  modalBackdrop.style.display = 'flex';
  f_title.focus();
}

function closeModal() {
  modalBackdrop.style.display = 'none';
}

function updateImgPreview() {
  const url = f_image.value.trim();
  imgPreview.innerHTML = url
    ? `<img src="${escapeHtml(url)}" alt="preview" onerror="this.parentElement.innerHTML='<span>Couldn\\'t load that image URL</span>'">`
    : `<span>No image yet</span>`;
}

f_image.addEventListener('input', updateImgPreview);

document.getElementById('btnAdd').addEventListener('click', () => openModal(null));
document.getElementById('modalClose').addEventListener('click', closeModal);
document.getElementById('modalCancel').addEventListener('click', closeModal);
modalBackdrop.addEventListener('click', e => { if (e.target === modalBackdrop) closeModal(); });

document.getElementById('modalSave').addEventListener('click', () => {
  const title = f_title.value.trim();
  const variantId = f_variant.value.trim();
  const qty = Math.max(0, parseInt(f_qty.value, 10) || 0);
  const listPriceVal = f_price ? (f_price.value ? Number(f_price.value) : null) : null;

  if (!title) { f_title.focus(); return; }
  if (!variantId) { f_variant.focus(); return; }

  if (state.editingId) {
    const item = findItem(state.editingId);
    Object.assign(item, {
      title, variantId, qty,
      sizeColor: f_sizecolor.value.trim(),
      imageUrl: f_image.value.trim(),
      notes: f_notes.value.trim(),
    });
    // apply manual price if provided
    if (listPriceVal != null && !isNaN(listPriceVal)) {
      item.listPrice = listPriceVal;
      const mult = Math.max(0, Math.min(100, Number(loadDiscountPct() || 30))) / 100;
      item.price = Math.round((Number(listPriceVal) * mult) * 100) / 100;
    }
    toast(`<span>Saved changes to <strong>${escapeHtml(title)}</strong></span>`);
  } else {
    state.items.unshift({
      id: uid(),
      variantId, title, qty,
      sold: 0,
      imageUrl: f_image.value.trim(),
      sizeColor: f_sizecolor.value.trim(),
      listPrice: listPriceVal != null && !isNaN(listPriceVal) ? listPriceVal : undefined,
      price: listPriceVal != null && !isNaN(listPriceVal) ? Math.round((Number(listPriceVal) * (Math.max(0, Math.min(100, Number(loadDiscountPct() || 30))) / 100)) * 100) / 100 : undefined,
      notes: f_notes.value.trim(),
      dateAdded: new Date().toISOString().slice(0, 10),
    });
    toast(`<span>Added <strong>${escapeHtml(title)}</strong> to the stockroom</span>`);
  }
  saveState();
  closeModal();
  render();
});

// ---------- grid delegated events ----------

document.getElementById('grid').addEventListener('click', e => {
  const card = e.target.closest('.card');
  if (!card) return;
  const id = card.dataset.id;
  const action = e.target.closest('[data-action]')?.dataset.action;

  if (action === 'inc') changeQty(id, 1);
  else if (action === 'dec') changeQty(id, -1);
  else if (action === 'sell') markSold(id);
  else if (action === 'edit') openModal(findItem(id));
  else if (action === 'delete') deleteItem(id);
  else if (e.target.closest('.vid')) {
    const vid = e.target.closest('.vid').dataset.copy;
    navigator.clipboard?.writeText(vid).then(() => toast(`Copied variant ID <strong>${vid}</strong>`));
  }
});

// ---------- search / filter / sort ----------

document.getElementById('search').addEventListener('input', e => {
  state.search = e.target.value;
  render();
});

document.getElementById('filterChips').addEventListener('click', e => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  chip.classList.add('active');
  state.filter = chip.dataset.filter;
  render();
});

document.getElementById('sortSelect').addEventListener('change', e => {
  state.sort = e.target.value;
  render();
});

// ---------- export / import JSON ----------

document.getElementById('btnExport').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state.items, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `addisoutfits-stockroom-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('fileImport').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const incoming = JSON.parse(reader.result);
      if (!Array.isArray(incoming)) throw new Error('not an array');
      state.items = incoming;
      saveState();
      render();
      toast(`<span>Imported <strong>${incoming.length}</strong> items</span>`);
    } catch (err) {
      alert('That file did not look like a stockroom export. Please pick a JSON file exported from this app.');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

// ---------- fill photos & sizes from store catalog export ----------

const CATALOG_SCRIPT = `(async function () {
  const BASE = location.origin;
  const MAX_PAGES = 100;
  let page = 1;
  let allProducts = [];
  let lastFirstId = null;
  console.log('Fetching your product catalog from', BASE, '\u2026');
  while (page <= MAX_PAGES) {
    const res = await fetch(\`\${BASE}/products.json?limit=250&page=\${page}\`);
    if (!res.ok) { console.error('Request failed:', res.status, res.statusText); break; }
    const data = await res.json();
    const products = data.products || [];
    if (products.length === 0) { console.log('Empty page \u2014 reached the end at page ' + page + '.'); break; }
    const firstId = products[0].id;
    if (firstId === lastFirstId) { console.log('Page ' + page + ' repeated the previous page \u2014 this store does not support paging past here, stopping.'); break; }
    lastFirstId = firstId;
    allProducts = allProducts.concat(products);
    console.log('  page ' + page + ': +' + products.length + ' products (total ' + allProducts.length + ')');
    if (products.length < 250) { console.log('Last page reached.'); break; }
    page++;
  }
  const catalog = {};
  allProducts.forEach(p => {
    const fallbackImage = (p.images && p.images[0] && p.images[0].src) || '';
    (p.variants || []).forEach(v => {
      const image = (v.featured_image && v.featured_image.src) || fallbackImage;
      const sizeColor = (v.title && v.title !== 'Default Title') ? v.title : '';
      catalog[String(v.id)] = { image, sizeColor, product: p.title, handle: p.handle };
    });
  });
  const ids = Object.keys(catalog);
  console.log('Done \u2014 ' + ids.length + ' unique variants across ' + allProducts.length + ' product fetches.');
  console.log('Sample variant IDs found:', ids.slice(0, 5));
  const blob = new Blob([JSON.stringify(catalog, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'addisoutfits-catalog.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
})();`;

const catalogHelpBackdrop = document.getElementById('catalogHelpBackdrop');
document.getElementById('btnCatalogHelp').addEventListener('click', () => {
  document.getElementById('catalogScriptArea').value = CATALOG_SCRIPT;
  catalogHelpBackdrop.style.display = 'flex';
});
document.getElementById('catalogHelpClose').addEventListener('click', () => catalogHelpBackdrop.style.display = 'none');
document.getElementById('catalogHelpDone').addEventListener('click', () => catalogHelpBackdrop.style.display = 'none');
catalogHelpBackdrop.addEventListener('click', e => { if (e.target === catalogHelpBackdrop) catalogHelpBackdrop.style.display = 'none'; });

document.getElementById('btnCopyScript').addEventListener('click', () => {
  navigator.clipboard?.writeText(CATALOG_SCRIPT).then(() => toast("Script copied — paste it into your store's console"));
});

document.getElementById('fileCatalog').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    let catalog;
    try {
      catalog = JSON.parse(reader.result);
    } catch (err) {
      alert('That did not look like a catalog file. Run the script from "?" above and load the addisoutfits-catalog.json it downloads.');
      return;
    }

    // save the catalog itself so future "Sync from Sheet" merges auto-fill too
    // If uploaded file is a plain products array, convert it
    if (Array.isArray(catalog)) {
      catalog = buildCatalogFromProducts(catalog);
    }

    // Ensure prices are present and compute discounted price when possible
    const pct = loadDiscountPct();
    const mult = Math.max(0, Math.min(100, Number(pct || 30))) / 100;
    Object.keys(catalog).forEach(k => {
      const entry = catalog[k] || {};
      if (entry.listPrice == null && entry.price != null) entry.listPrice = Math.round((Number(entry.price) / Math.max(mult, 0.00001)) * 100) / 100;
      if (entry.price == null && entry.listPrice != null) entry.price = Math.round((Number(entry.listPrice) * mult) * 100) / 100;
    });

    state.catalog = catalog;
    state.catalogMeta = { count: Object.keys(catalog).length, updatedAt: new Date().toISOString().slice(0, 10) };
    saveCatalog();
    renderCatalogStatus();

    let matched = 0, unmatched = 0;
    const unmatchedSamples = [];
    state.items.forEach(item => {
      const entry = catalog[item.variantId];
      if (entry) {
        if (entry.image) item.imageUrl = entry.image;
        if (entry.sizeColor) item.sizeColor = entry.sizeColor;
        if (entry.price) { item.listPrice = entry.listPrice; item.price = entry.price; }
        matched++;
      } else {
        unmatched++;
        if (unmatchedSamples.length < 5) unmatchedSamples.push(item.variantId);
      }
    });
    if (unmatchedSamples.length) {
      console.log('Stockroom variant IDs with no catalog match (sample):', unmatchedSamples);
      console.log('Catalog variant IDs (sample):', Object.keys(catalog).slice(0, 5));
    }
    saveState();
    render();
    toast(`<span>Catalog saved (${state.catalogMeta.count} variants). Filled <strong>${matched}</strong> items now${unmatched ? ` — ${unmatched} had no match` : ''}. Future sheet syncs will auto-fill too.</span>`);
  };
  reader.readAsText(file);
  e.target.value = '';
});

function renderCatalogStatus() {
  const el = document.getElementById('catalogStatus');
  if (!el) return;
  if (state.catalogMeta) {
    el.textContent = `Catalog loaded: ${state.catalogMeta.count.toLocaleString()} variants · updated ${state.catalogMeta.updatedAt}`;
  } else {
    el.textContent = 'No catalog loaded yet — sheet syncs won\u2019t auto-fill photos until you load one.';
  }
}

// ---------- sync from sheet (paste TSV/CSV) ----------

const csvBackdrop = document.getElementById('csvBackdrop');
document.getElementById('btnImportCsv').addEventListener('click', () => {
  document.getElementById('csvArea').value = '';
  csvBackdrop.style.display = 'flex';
});
document.getElementById('csvClose').addEventListener('click', () => csvBackdrop.style.display = 'none');
document.getElementById('csvCancel').addEventListener('click', () => csvBackdrop.style.display = 'none');
csvBackdrop.addEventListener('click', e => { if (e.target === csvBackdrop) csvBackdrop.style.display = 'none'; });

function parseDelimitedText(text) {
  // Handles quoted fields (which may contain the delimiter itself, or an
  // embedded line break, like Google Sheets sometimes produces) rather than
  // naively splitting on newlines/commas first.
  const delim = text.includes('\t') ? '\t' : ',';
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') { field += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { field += ch; }
      continue;
    }

    if (ch === '"') { inQuotes = true; }
    else if (ch === delim) { row.push(field); field = ''; }
    else if (ch === '\r') { /* ignore */ }
    else if (ch === '\n') { row.push(field); field = ''; rows.push(row); row = []; }
    else { field += ch; }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }

  return rows
    .map(r => r.map(c => c.replace(/\s+/g, ' ').trim()))
    .filter(r => r.some(c => c.length));
}

function parsePastedRows(text) {
  const allRows = parseDelimitedText(text);
  if (allRows.length === 0) return { rows: [], totalLines: 0, skippedRows: [] };
  // detect header row (if present) and column indexes for title, variant, qty, price
  let start = 0;
  const headerRow = allRows[0].map(c => (c || '').toString().toLowerCase());
  const looksLikeHeader = headerRow.some(h => /title|variant|qty|quantity|price|id/.test(h));
  let titleIdx = 0, variantIdx = 1, qtyIdx = 2, priceIdx = -1;
  if (looksLikeHeader) {
    start = 1;
    titleIdx = headerRow.findIndex(h => /title/.test(h)); if (titleIdx === -1) titleIdx = 0;
    variantIdx = headerRow.findIndex(h => /variant|id/.test(h)); if (variantIdx === -1) variantIdx = 1;
    qtyIdx = headerRow.findIndex(h => /qty|quantity|count|stock/.test(h)); if (qtyIdx === -1) qtyIdx = 2;
    priceIdx = headerRow.findIndex(h => /price|list price|unit price|cost/.test(h)); // may be -1
  } else {
    // no header — guess price is column 3 if many rows have numeric values there
    const col3Numeric = allRows.slice(0, 10).reduce((c, r) => c + (isNumeric(r[3]) ? 1 : 0), 0);
    if (col3Numeric >= Math.min(3, allRows.length)) priceIdx = 3;
  }

  const rows = [];
  const skippedRows = [];
  for (let i = start; i < allRows.length; i++) {
    const cols = allRows[i];
    const title = (cols[titleIdx] || '').trim();
    const variantId = (cols[variantIdx] || '').trim();
    const qty = parseInt(cols[qtyIdx], 10);
    let price = null;
    if (priceIdx >= 0) price = parsePrice(cols[priceIdx]);
    // if price wasn't recognized but there is an extra column at end that looks like a price, try that
    if (price == null && cols.length > Math.max(titleIdx, variantIdx, qtyIdx) + 1) {
      for (let j = Math.max(titleIdx, variantIdx, qtyIdx) + 1; j < cols.length; j++) {
        const p = parsePrice(cols[j]); if (p != null) { price = p; break; }
      }
    }
    if (!title || !variantId || isNaN(qty)) {
      skippedRows.push(cols.join(' | ') || '(blank row)');
      continue;
    }
    rows.push({ title, variantId, qty, price });
  }
  return { rows, totalLines: allRows.length - start, skippedRows };
}

function isNumeric(v) {
  if (v == null) return false;
  return !isNaN(Number(String(v).replace(/[^0-9.-]+/g, '').replace(/,/g, '.')));
}

function parsePrice(cell) {
  if (cell == null) return null;
  const s = String(cell).trim();
  if (!s) return null;
  // remove currency symbols and whitespace, normalize comma to dot
  const cleaned = s.replace(/[^0-9.,-]+/g, '').replace(/,/g, '.');
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

document.getElementById('csvSave').addEventListener('click', () => {
  const { rows, totalLines, skippedRows } = parsePastedRows(document.getElementById('csvArea').value);
  if (rows.length === 0 && skippedRows.length === 0) {
    alert('Nothing was pasted, or no rows could be found at all.');
    return;
  }
  // Deduplicate rows by variantId so duplicates within the pasted content are ignored
  const unique = new Map();
  let duplicateLines = 0;
  rows.forEach(row => {
    if (!unique.has(row.variantId)) unique.set(row.variantId, row);
    else duplicateLines++;
  });

  let added = 0, updated = 0, autoFilled = 0;
  Array.from(unique.values()).forEach(row => {
    const catalogEntry = state.catalog[row.variantId];
    const existing = state.items.find(i => i.variantId === row.variantId);
    if (existing) {
      existing.qty += row.qty;
      if (catalogEntry) {
        if (!existing.imageUrl && catalogEntry.image) { existing.imageUrl = catalogEntry.image; autoFilled++; }
        if (!existing.sizeColor && catalogEntry.sizeColor) existing.sizeColor = catalogEntry.sizeColor;
        if (catalogEntry.price && !existing.price) { existing.listPrice = catalogEntry.listPrice; existing.price = catalogEntry.price; }
      }
      // apply pasted price if provided
      if (row.price != null) {
        existing.listPrice = row.price;
        const mult = Math.max(0, Math.min(100, Number(loadDiscountPct() || 30))) / 100;
        existing.price = Math.round((Number(row.price) * mult) * 100) / 100;
      }
      updated++;
    } else {
      const listP = row.price != null ? row.price : (catalogEntry?.listPrice);
      const computedPrice = listP != null ? Math.round((Number(listP) * (Math.max(0, Math.min(100, Number(loadDiscountPct() || 30))) / 100)) * 100) / 100 : undefined;
      state.items.unshift({
        id: uid(),
        variantId: row.variantId,
        title: row.title,
        qty: row.qty,
        sold: 0,
        imageUrl: catalogEntry?.image || '',
        sizeColor: catalogEntry?.sizeColor || '',
        listPrice: listP,
        price: computedPrice,
        notes: '',
        dateAdded: new Date().toISOString().slice(0, 10),
      });
      if (catalogEntry) autoFilled++;
      if (row.price != null) autoFilled++; // count that we set price from paste
      added++;
    }
  });
  saveState();
  render();
  csvBackdrop.style.display = 'none';

  // show a results panel — always, so it's clear even when everything worked
  const summaryParts = [
    `<strong>${totalLines}</strong> rows read from your paste`,
    `<strong>${added}</strong> new items added`,
    `<strong>${updated}</strong> existing items updated`,
  ];
  if (duplicateLines) summaryParts.push(`<strong>${duplicateLines}</strong> duplicate rows ignored`);
  if (state.catalogMeta) summaryParts.push(`<strong>${autoFilled}</strong> auto-filled with a photo from your catalog`);
  if (skippedRows.length) summaryParts.push(`<strong>${skippedRows.length}</strong> rows could not be read`);

  document.getElementById('syncResultsSummary').innerHTML = summaryParts.join('<br>');
  const skippedWrap = document.getElementById('syncResultsSkippedWrap');
  if (skippedRows.length) {
    skippedWrap.style.display = 'block';
    document.getElementById('syncResultsSkipped').value = skippedRows.join('\n');
  } else {
    skippedWrap.style.display = 'none';
  }
  document.getElementById('syncResultsBackdrop').style.display = 'flex';
});

document.getElementById('syncResultsClose').addEventListener('click', () => document.getElementById('syncResultsBackdrop').style.display = 'none');
document.getElementById('syncResultsDone').addEventListener('click', () => document.getElementById('syncResultsBackdrop').style.display = 'none');
document.getElementById('syncResultsBackdrop').addEventListener('click', e => {
  if (e.target === document.getElementById('syncResultsBackdrop')) document.getElementById('syncResultsBackdrop').style.display = 'none';
});

// ---------- boot ----------

loadCatalog();
loadGithubSettings();
renderCatalogStatus();
renderGithubStatus('');

if (state.github) {
  // this device is the owner's — pull with the token, which also enables editing
  loadState(); // show cached data immediately while we sync
  const wasDirty = localStorage.getItem(DIRTY_KEY) === '1';
  if (wasDirty) {
    // an earlier change never made it to GitHub (e.g. the page was closed too soon) —
    // push it now BEFORE pulling, so we don't overwrite it with stale remote data
    flushGithubPush().then(ok => {
      if (ok) {
        // now safe to pull, in case another device also pushed something newer since
        githubPullIntoState(state.github, { silent: true });
      }
    });
  } else {
    githubPullIntoState(state.github, { silent: true });
  }
} else if (publicSourceConfigured()) {
  // a regular visitor — show the shared public data automatically, no login needed
  loadState(); // show cached data immediately
  loadPublicData();
  // try to auto-load a catalog from this origin (best-effort; may be blocked by CORS)
  tryAutoFetchCatalogFromOrigin().catch(() => {});
} else {
  // no GitHub source configured at all yet — just use local/seed data
  loadState();
}

// Discount input wiring: set initial value and listen for changes
(function () {
  const el = document.getElementById('discountPct');
  if (!el) return;
  const pct = loadDiscountPct();
  el.value = pct;
  el.addEventListener('input', () => {
    let v = Number(el.value);
    if (isNaN(v) || v < 0) v = 0;
    if (v > 99) v = 99;
    el.value = v;
    saveDiscountPct(v);
    applyDiscountPctToCatalog(v);
    toast(`<span>Discount set to <strong>${v}%</strong> — prices updated</span>`);
  });
})();

// Theme and settings wiring
(function () {
  // Apply initial theme
  const current = loadTheme();
  applyTheme(current);

  // Quick theme toggle
  const themeBtn = document.getElementById('btnThemeToggle');
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      const t = loadTheme() === 'dark' ? 'light' : 'dark';
      saveTheme(t);
      applyTheme(t);
      toast(`<span>Theme: <strong>${t}</strong></span>`);
    });
  }

  // Settings modal
  const settingsBackdrop = document.getElementById('settingsBackdrop');
  const btnSettings = document.getElementById('btnSettings');
  const settingsClose = document.getElementById('settingsClose');
  const settingsCancel = document.getElementById('settingsCancel');
  const settingsSave = document.getElementById('settingsSave');
  const discountModal = document.getElementById('discountPctModal');
  const themeSelect = document.getElementById('themeSelect');

  function openSettings() {
    if (!settingsBackdrop) return;
    // sync current values
    const pct = loadDiscountPct();
    if (discountModal) discountModal.value = pct;
    const th = loadTheme();
    if (themeSelect) themeSelect.value = th;
    settingsBackdrop.style.display = 'flex';
  }

  function closeSettings() { if (settingsBackdrop) settingsBackdrop.style.display = 'none'; }

  if (btnSettings) btnSettings.addEventListener('click', openSettings);
  if (settingsClose) settingsClose.addEventListener('click', closeSettings);
  if (settingsCancel) settingsCancel.addEventListener('click', closeSettings);
  if (settingsBackdrop) settingsBackdrop.addEventListener('click', e => { if (e.target === settingsBackdrop) closeSettings(); });

  if (settingsSave) settingsSave.addEventListener('click', () => {
    const v = Number(discountModal?.value || loadDiscountPct());
    const bounded = isNaN(v) ? 30 : Math.max(0, Math.min(99, v));
    saveDiscountPct(bounded);
    // update topbar input if present
    const top = document.getElementById('discountPct'); if (top) top.value = bounded;
    applyDiscountPctToCatalog(bounded);

    const sel = themeSelect?.value || loadTheme();
    saveTheme(sel);
    applyTheme(sel);

    toast(`<span>Settings saved</span>`);
    closeSettings();
  });
})();

// Proxy UI wiring: load saved proxy URL into the input and wire fetch button
(function () {
  const input = document.getElementById('proxyUrl');
  const btn = document.getElementById('btnFetchProxy');
  if (!input || !btn) return;
  const saved = loadProxyUrl();
  input.value = saved || '';
  input.classList.add('proxy-input');
  input.addEventListener('change', () => saveProxyUrl(input.value.trim()));
  btn.addEventListener('click', async () => {
    const url = (input.value || '').trim();
    if (!url) {
      toast('<span>Please enter a proxy URL first</span>');
      return;
    }
    saveProxyUrl(url);
    await fetchCatalogViaCustomProxy(url);
  });
})();
