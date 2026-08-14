Catalog Proxy
===============

Small Node/Express proxy to fetch product catalogs and bypass CORS during development.

Usage
-----

1. Install dependencies:

```bash
cd catalog-proxy
npm install
```

2. Run the server:

```bash
npm start
```

3. Endpoints

- `/proxy?url=` — fetches any URL and returns it. Example:
  `http://localhost:3000/proxy?url=https://example.com/products.json`

- `/catalog?base=` — tries to fetch catalog data from the store at `base`:
  `http://localhost:3000/catalog?base=https://your-store.com`

Security note
-------------
This proxy allows any origin by default and should be used for local development only. If you run it in production, restrict allowed origins and add authentication.
