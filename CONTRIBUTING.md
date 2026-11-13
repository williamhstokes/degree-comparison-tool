# Contributing

Thanks for improving the Degree Comparison Tool.

## Setup

```bash
npm start          # local static server on :4173
npm run sync       # refresh data/programs.json from the public UAGC sitemap
```

Node.js 18+ is recommended (`fetch` is used by the sync script).

## Guidelines

- Keep the app frontend-only (no secrets, no private APIs).
- Prefer updating `scripts/lib/seed-enrichment.js` for summaries, careers, labor IDs, and area tags; then run `npm run sync`.
- Commit both `data/programs.json` and `js/data/catalog-fallback.js` when the catalog changes.
- Preserve the 3-degree comparison cap, optional demographics privacy copy, and UAGC brand colors unless intentionally redesigning.
- Do not commit `.env`, credentials, or machine-specific absolute paths.

## Pull requests

1. Branch from `main`.
2. Describe sync or UX impact in the PR body.
3. Note if `data/sync-report.json` shows adds/updates/removals.
