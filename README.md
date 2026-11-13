# Degree Comparison Tool (UAGC-branded)

Static, Drupal-embeddable web app for comparing University of Arizona Global Campus (UAGC) online degree programs—state, degree level, areas of interest, up to three programs, optional demographics, and career-outlook charts.

> **Trademark:** UAGC / University of Arizona names and brand colors are used for an institutional comparison experience. See [LICENSE](LICENSE) for the MIT grant and trademark notice. This repo is not an official UAGC product unless your organization says otherwise.

## Features

- Centered **Degree Comparison Tool** title with Arizona Red (`#AB0520`) / Blue (`#0C234B`) and Montserrat
- US state selector (includes North Carolina enrollment notice when applicable)
- Degree levels: Associate, Bachelor, Masters, Doctoral
- Multi-select areas of interest
- Programs filtered from a **syncable JSON catalog**; compare up to **3**
- Optional demographics + privacy disclaimer
- Result cards with **Learn more** links to live UAGC program pages
- Wage / growth charts and table (curated public BLS / O*NET-style figures, sources cited in-app)
- Offline fallback if catalog fetch fails

## Quick start

```bash
git clone https://github.com/williamhstokes/degree-comparison-tool.git
cd degree-comparison-tool
npm run sync    # optional — refresh catalog from the public UAGC sitemap
npm start       # serves this folder at http://localhost:4173
```

Open [http://localhost:4173](http://localhost:4173). Entry file: `index.html`.

Requires **Node.js 18+** for `npm run sync` (uses global `fetch`).

## Catalog sync

```bash
npm run sync
# equivalent:
node scripts/sync-programs.mjs
```

The sync script:

1. Fetches `https://www.uagc.edu/online-degrees/sitemap.xml`
2. Collects associate / bachelors / masters / doctoral URLs
3. Reads public page titles for display / Learn more labels
4. Merges curated enrichment from `scripts/lib/seed-enrichment.js`
5. Writes:
   - `data/programs.json` — runtime catalog (**committed snapshot**)
   - `js/data/catalog-fallback.js` — offline bundle
   - `data/sync-report.json` — adds / updates / removals

**Cadence:** weekly, or after UAGC catalog publish / term start. Commit the updated JSON + fallback JS after sync.

### How the app loads the catalog

1. `fetch(window.UAGC_CATALOG_URL || <html data-catalog-url> || 'data/programs.json')`
2. On failure → `window.UAGC_CATALOG_FALLBACK` from `js/data/catalog-fallback.js`
3. UI shows catalog timestamp/source; **Reload catalog** re-fetches without a full page reload

```html
<script>window.UAGC_CATALOG_URL = '/sites/default/files/dct/programs.json';</script>
```

## Drupal embed

### Iframe (recommended)

Host this folder (or built assets) on your origin/CDN, then:

```html
<iframe
  src="/path/to/degree-comparison-tool/index.html"
  title="Degree Comparison Tool"
  loading="lazy"
  style="width:100%;min-height:1400px;border:0;border-radius:12px;"
></iframe>
```

### Host `programs.json` separately

1. Publish `data/programs.json` to Drupal public files or a CDN.
2. Set `Content-Type: application/json` (and CORS if HTML and JSON origins differ).
3. Point `UAGC_CATALOG_URL` at that URL.
4. Keep `js/data/catalog-fallback.js` in the theme/library for outages.
5. After each `npm run sync`, deploy the new JSON (atomic replace) and purge caches.

### Inline / library

Register CSS/JS in a Drupal library, attach to a custom block/Twig template that prints the markup from `index.html`. Prefer iframe if text formats strip scripts.

## Repository layout

```
.
├── index.html
├── css/styles.css
├── js/
│   ├── app.js
│   └── data/
│       ├── catalog-fallback.js
│       ├── labor-market.js
│       └── states.js
├── data/
│   ├── programs.json
│   └── sync-report.json
├── scripts/
│   ├── sync-programs.mjs
│   └── lib/seed-enrichment.js
├── package.json
├── LICENSE
├── CONTRIBUTING.md
└── README.md
```

## Pushing to GitHub

Remote (already configured in this checkout):

`https://github.com/williamhstokes/degree-comparison-tool.git`

```bash
git push -u origin main
```

Requires GitHub authentication on the machine (`gh auth login`, HTTPS PAT, or SSH key).

## Deploy to GitHub Pages

This app is static — no build step. `index.html` must sit at the **repo root**.

1. Push your files to the `main` branch of  
   `https://github.com/williamhstokes/degree-comparison-tool`
2. On GitHub: **Settings → Pages**
3. Under **Build and deployment**:
   - **Source:** Deploy from a branch
   - **Branch:** `main`
   - **Folder:** `/ (root)`
4. Click **Save**
5. Wait 1–2 minutes, then open:

   **https://williamhstokes.github.io/degree-comparison-tool/**

(The app redirects to a trailing slash automatically so CSS/JS/JSON load correctly.)

### Update the live site later

```bash
# optional: refresh program catalog
npm run sync
git add data/programs.json js/data/catalog-fallback.js data/sync-report.json
git commit -m "Refresh program catalog"
git push origin main
```

Pages republishes from `main` after each push.

### Checklist if the page looks broken

- Use the URL with a trailing slash (or let the app redirect)
- Confirm Pages source is `main` / `/ (root)`, not `/docs`
- Hard-refresh the browser (Ctrl/Cmd+Shift+R)
- Repo must be **public**, or you need a GitHub Pro plan for private Pages

## License

MIT — see [LICENSE](LICENSE). Labor figures and program listings are informational; verify current offerings and disclosures on [uagc.edu](https://www.uagc.edu/online-degrees).
