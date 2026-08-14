const express = require('express');
const axios = require('axios');
const { URL } = require('url');

const app = express();
const PORT = process.env.PORT || 3000;

// Simple CORS allow-all for development. Restrict in production!
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// Generic proxy: fetch any URL server-side and return it (preserves content-type)
app.get('/proxy', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url parameter' });
  try {
    // validate URL
    new URL(url);
  } catch (err) {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  try {
    const r = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000 });
    const contentType = r.headers['content-type'] || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.send(Buffer.from(r.data));
  } catch (err) {
    console.error('Proxy fetch failed', err.message);
    res.status(502).json({ error: 'Failed to fetch URL', detail: err.message });
  }
});

// Catalog aggregator: try /products.json paging first; if that fails, try sitemap -> product.json per-url
app.get('/catalog', async (req, res) => {
  const base = (req.query.base || '').replace(/\/+$/, '');
  if (!base) return res.status(400).json({ error: 'Missing base parameter (e.g. https://store.example.com)' });

  // helper to fetch products.json pages
  async function fetchProductsJsonPages(baseUrl, maxPages = 50) {
    const all = [];
    for (let page = 1; page <= maxPages; page++) {
      const url = `${baseUrl}/products.json?limit=250&page=${page}`;
      try {
        const r = await axios.get(url, { timeout: 10000 });
        if (r.status !== 200) break;
        const data = r.data || {};
        const products = data.products || [];
        if (!products.length) break;
        all.push(...products);
        if (products.length < 250) break;
      } catch (err) {
        // stop on network/CORS failures
        break;
      }
    }
    return all;
  }

  // helper: fetch sitemap and then product JSON endpoints
  async function fetchFromSitemap(baseUrl, maxProducts = 400) {
    const sitemapUrl = `${baseUrl}/sitemap_products_1.xml`;
    const r = await axios.get(sitemapUrl, { timeout: 10000 });
    if (r.status !== 200) throw new Error('Sitemap not found');
    const xml = r.data || '';
    const locMatches = Array.from(xml.matchAll(/<loc>([^<]+)<\/loc>/gi)).map(m => m[1]);
    const products = [];
    for (let i = 0; i < locMatches.length && products.length < maxProducts; i++) {
      const url = locMatches[i];
      const slug = url.split('/').filter(Boolean).pop();
      const candidates = [
        `${url}.json`,
        url.replace(/\.html$/, '') + '.json',
        `${baseUrl}/products/${slug}.json`,
      ];
      for (const c of candidates) {
        try {
          const pr = await axios.get(c, { timeout: 8000 });
          if (pr.status !== 200) continue;
          const data = pr.data || {};
          const p = data.product || data.products || data;
          if (Array.isArray(p)) products.push(...p);
          else if (p && (p.id || p.variants)) products.push(p);
          break;
        } catch (err) {
          // try next candidate
          continue;
        }
      }
      if (i % 20 === 0) await new Promise(r => setTimeout(r, 40));
    }
    return products;
  }

  try {
    let products = await fetchProductsJsonPages(base, 100);
    if (!products.length) {
      try {
        products = await fetchFromSitemap(base, 800);
      } catch (err) {
        console.debug('Sitemap fallback failed', err.message);
      }
    }
    return res.json({ products });
  } catch (err) {
    console.error('Catalog aggregation failed', err.message);
    return res.status(500).json({ error: 'Catalog fetch failed', detail: err.message });
  }
});

app.listen(PORT, () => console.log(`Catalog proxy running on http://localhost:${PORT}`));
