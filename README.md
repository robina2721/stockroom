# Addis Outfits · Stockroom

A fast, no-backend inventory tracker for your on-hand stock, built from your
Google Sheet export (Title / Variant Id / Qty). Pure HTML/CSS/JS — no build
step, no server, deploys straight to GitHub Pages for free.

**What it does**
- Shows every on-hand item as a stock-tag card with photo, variant ID, size/color, and a stamped **In stock / Low stock / Sold out** status
- **Mark 1 sold** button decrements quantity and keeps a running sold count (with one-tap undo)
- **+ Add item** to log new arrivals, with an image URL field and a live preview
- **Fill photos & sizes**: load a catalog export from your store once (see below) — it's saved permanently in the app
- **Sync from Sheet**: paste rows straight out of Google Sheets (Title, Variant Id, Qty). Matching variant IDs get their quantity added; new ones are created — and if you've loaded a catalog, new and existing items are **automatically matched to their photo and size/color**, no extra step
- Search, filter (all / in stock / low / sold out), and sort
- **Export JSON** any time to back up your data, **Import JSON** to restore it

**Where your data lives:** entirely in this browser, via `localStorage` —
both your inventory list and the catalog you load. Nothing is sent anywhere.
That means the data is per-browser/per-device — export a backup regularly,
and re-import it (or paste your sheet again) if you switch computers.

**About product photos & sizes — set it up once:**

1. Open **addisoutfits.com** in Chrome, press **F12**, open the **Console**
   tab, type `allow pasting` and press Enter if prompted.
2. Paste in the script from `fetch-catalog.js` (included in this folder)
   and press Enter. It reads your store's own public product feed — the
   same data your storefront already shows visitors — and downloads
   `addisoutfits-catalog.json`.
3. Back in the stockroom app, click **Fill photos & sizes** and pick that
   file. It fills in every current item that matches, *and* saves the
   catalog inside the app.

From then on, **every "Sync from Sheet" automatically checks that saved
catalog** and fills in photos and size/color for new or updated rows — you
won't need to repeat the "Fill photos & sizes" step for items already in
that catalog.

**When to re-run the store script:** only when you've added genuinely new
products to addisoutfits.com that aren't in your saved catalog yet (the
status line under the toolbar shows how many variants are loaded and when
you last updated it). A monthly refresh, or right after a new product
drop, is plenty — you don't need to do it for every single sheet sync.

This uses no admin API key and no Shopify app install — it just reads the
same public data your store already serves to shoppers, from a script you
run yourself on your own store's page.

If an item's variant ID isn't found in the catalog (e.g. it was
discontinued or renamed), you can still set its photo manually: open the
product on addisoutfits.com, right-click the photo → "Copy image address",
and paste that URL into the item's Image URL field when editing it.

---

## 1. Try it locally first (optional)

Just open `index.html` in a browser — no install needed. (Some browsers
restrict `fetch()` for local files; if the first-run seed data doesn't
appear, run a tiny local server instead: `python3 -m http.server`, then
visit `http://localhost:8000`.)

## 2. Deploy on GitHub Pages

1. **Create a repository**
   - Go to [github.com/new](https://github.com/new), name it e.g.
     `stockroom` (or anything you like), and create it (public or private —
     Pages works on both if you have GitHub Pro for private, otherwise use
     public).

2. **Upload these files**
   - On the repo page, click **Add file → Upload files**, then drag in:
     `index.html`, `styles.css`, `app.js`, and the `data/` folder
     (containing `products.json`).
   - Commit the changes.

   *Or, from the command line:*
   ```bash
   cd stockroom            # the folder with these files
   git init
   git add .
   git commit -m "Stockroom app"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO.git
   git push -u origin main
   ```

3. **Turn on Pages**
   - In the repo, go to **Settings → Pages**.
   - Under "Build and deployment", set **Source** to **Deploy from a
     branch**.
   - Set **Branch** to `main` and folder to `/ (root)`, then **Save**.
   - GitHub will give you a URL like
     `https://YOUR-USERNAME.github.io/YOUR-REPO/` within a minute or two.

4. **(Optional) Use your own domain**
   - In **Settings → Pages → Custom domain**, enter a subdomain such as
     `stock.addisoutfits.com`.
   - At your domain registrar, add a `CNAME` record pointing that
     subdomain to `YOUR-USERNAME.github.io`.
   - Wait for DNS to propagate, then tick **Enforce HTTPS** once it's
     available.

That's it — the page is now live and installable as a bookmark on your
phone's home screen for quick daily use.

## 3. Updating your stock later

- **Add one item:** use **+ Add item** in the app.
- **Bulk update from Google Sheets:** select and copy your rows (with the
  Title / Variant Id / Qty header), open **Sync from Sheet** in the app, and
  paste. Quantities for existing variant IDs are added to; new ones are
  created.
- **Move to a new device / browser:** click **Export JSON** on the old one,
  then **Import JSON** on the new one.

## File structure

```
├── index.html            the app shell
├── styles.css            design (dark console + manila stock-tag cards)
├── app.js                all app logic (storage, search, filters, CRUD)
├── fetch-catalog.js      run this ON addisoutfits.com to export photos/sizes
├── data/
│   └── products.json     your starting 82 on-hand items, seeded once
└── README.md
```
