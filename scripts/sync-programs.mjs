#!/usr/bin/env node
/**
 * Refresh UAGC areas + programs from the public online-degrees sitemap (and page titles).
 *
 * Usage:
 *   node scripts/sync-programs.mjs
 *   npm run sync
 *
 * Writes:
 *   data/programs.json          — runtime catalog
 *   js/data/catalog-fallback.js — offline/Drupal fallback bundle
 *   data/sync-report.json       — adds / updates / removals summary
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const enrichment = require("./lib/seed-enrichment.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_JSON = path.join(ROOT, "data", "programs.json");
const OUT_FALLBACK = path.join(ROOT, "js", "data", "catalog-fallback.js");
const OUT_REPORT = path.join(ROOT, "data", "sync-report.json");

const SITEMAP_URL = "https://www.uagc.edu/online-degrees/sitemap.xml";
const USER_AGENT =
  "UAGC-DegreeComparisonSync/1.1 (+public catalog research; contact local webmaster)";
const FETCH_CONCURRENCY = 4;
const LEVEL_MAP = {
  associate: "associate",
  bachelors: "bachelor",
  masters: "masters",
  doctoral: "doctoral",
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

function decodeEntities(str) {
  return str
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function titleFromSlug(slugPart) {
  return slugPart
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function defaultName(levelKey, slug) {
  const pretty = titleFromSlug(slug);
  if (levelKey === "associate") return `Associate of Arts in ${pretty}`;
  if (levelKey === "bachelor") {
    if (/nursing|computer-software|cyber|information-technology|health-information/.test(slug)) {
      return `Bachelor of Science in ${pretty}`;
    }
    return `Bachelor of Arts in ${pretty}`;
  }
  if (levelKey === "masters") {
    if (slug === "business-administration") return "Master of Business Administration";
    if (slug === "accounting") return "Master of Accountancy";
    if (slug === "public-health") return "Master of Public Health";
    if (slug.startsWith("technology") || slug.includes("science") || slug.includes("criminal") || slug.includes("finance") || slug.includes("informatics") || slug.includes("instructional") || slug.includes("information")) {
      return `Master of Science in ${pretty}`;
    }
    return `Master of Arts in ${pretty}`;
  }
  return `Doctoral program: ${pretty}`;
}

function inferAreas(slugPath) {
  const s = slugPath.toLowerCase();
  const areas = new Set();
  if (/business|accounting|finance|marketing|management|leadership|project|operations|supply|human-resource|mba/.test(s))
    areas.add("business");
  if (/early-childhood|education|child-development|instructional|teaching|special-education/.test(s))
    areas.add("education");
  if (/health|nursing|wellness|public-health|informatics/.test(s)) areas.add("healthcare");
  if (/technology|cyber|software|information|systems|data-security/.test(s))
    areas.add("technology");
  if (/criminal|homeland|security|military/.test(s)) areas.add("criminal-justice");
  if (/psychology|behavioral|sociology|human-services|social-science/.test(s))
    areas.add("psychology");
  if (/liberal|communication|social-science|sociology/.test(s)) areas.add("liberal-arts");
  if (/military/.test(s)) areas.add("military");
  if (!areas.size) areas.add("business");
  return [...areas];
}

function idFromSlugPath(slugPath) {
  return slugPath.replace(/\//g, "-");
}

function extractProgramUrls(sitemapXml) {
  const urls = [...sitemapXml.matchAll(/<loc>(https:\/\/www\.uagc\.edu\/online-degrees\/(associate|bachelors|masters|doctoral)\/[^<]+)<\/loc>/g)];
  const seen = new Set();
  const out = [];
  for (const m of urls) {
    const url = m[1].replace(/\/$/, "");
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out.sort();
}

function parseTitle(html) {
  const h1 =
    html.match(/<h1[^>]*class="[^"]*paid-hero-space__main-heading[^"]*"[^>]*>([\s\S]*?)<\/h1>/i) ||
    html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) {
    const text = decodeEntities(h1[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
    if (text && text.length > 5 && !/please provide/i.test(text)) return text;
  }
  const og = html.match(/property="og:title"\s+content="([^"]+)"/i);
  if (og) {
    const t = decodeEntities(og[1]).replace(/\s*\|\s*UAGC.*$/i, "").trim();
    if (t) return t;
  }
  const title = html.match(/<title>([^<]+)<\/title>/i);
  if (title) {
    const t = decodeEntities(title[1]).replace(/\s*\|\s*UAGC.*$/i, "").trim();
    if (t && t !== "UAGC") return t;
  }
  return null;
}

async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

function loadPrevious() {
  if (!fs.existsSync(OUT_JSON)) return null;
  try {
    return JSON.parse(fs.readFileSync(OUT_JSON, "utf8"));
  } catch {
    return null;
  }
}

function fingerprint(p) {
  return JSON.stringify({
    name: p.name,
    url: p.url,
    level: p.level,
    areas: p.areas,
    credits: p.credits,
    summary: p.summary,
  });
}

async function main() {
  console.log("Fetching sitemap…", SITEMAP_URL);
  const sitemap = await fetchText(SITEMAP_URL);
  const urls = extractProgramUrls(sitemap);
  console.log(`Found ${urls.length} program URLs`);

  const previous = loadPrevious();
  const prevById = new Map((previous?.programs || []).map((p) => [p.id, p]));

  console.log("Fetching program pages for titles…");
  const scraped = await mapPool(urls, FETCH_CONCURRENCY, async (url) => {
    const m = url.match(/\/online-degrees\/(associate|bachelors|masters|doctoral)\/([^/?#]+)/);
    if (!m) return null;
    const [, levelSeg, slug] = m;
    const level = LEVEL_MAP[levelSeg];
    const slugPath = `${levelSeg}/${slug}`;
    let liveName = null;
    try {
      const html = await fetchText(url);
      liveName = parseTitle(html);
      await sleep(120);
    } catch (err) {
      console.warn(`  ! ${slugPath}: ${err.message}`);
    }
    return { url, level, slug, slugPath, liveName };
  });

  const programs = [];
  for (const row of scraped.filter(Boolean)) {
    const seed = enrichment.bySlug[row.slugPath] || {};
    const prev = prevById.get(idFromSlugPath(row.slugPath)) || prevById.get(row.slugPath);
    const id = idFromSlugPath(row.slugPath);
    const name =
      seed.nameOverride ||
      row.liveName ||
      prev?.name ||
      defaultName(row.level, row.slug);

    const program = {
      id,
      name,
      level: row.level,
      areas: seed.areas || prev?.areas || inferAreas(row.slugPath),
      url: row.url,
      college: seed.college || prev?.college || "University of Arizona Global Campus",
      credits: seed.credits ?? prev?.credits ?? null,
      summary:
        seed.summary ||
        prev?.summary ||
        `Explore the ${name} online at the University of Arizona Global Campus.`,
      careers: seed.careers || prev?.careers || ["Related professional roles"],
      laborIds: seed.laborIds || prev?.laborIds || ["general-managers"],
      slugPath: row.slugPath,
      syncedAt: new Date().toISOString(),
    };
    if (seed.note || prev?.note) program.note = seed.note || prev.note;
    if (!seed.summary && !prev?.summary) program.needsReview = true;
    programs.push(program);
  }

  programs.sort((a, b) => a.name.localeCompare(b.name));

  const catalog = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: SITEMAP_URL,
    areas: enrichment.areas,
    levels: enrichment.levels,
    programs,
  };

  const prevIds = new Set((previous?.programs || []).map((p) => p.id));
  const nextIds = new Set(programs.map((p) => p.id));
  const added = programs.filter((p) => !prevIds.has(p.id)).map((p) => ({ id: p.id, name: p.name, url: p.url }));
  const removed = (previous?.programs || [])
    .filter((p) => !nextIds.has(p.id))
    .map((p) => ({ id: p.id, name: p.name, url: p.url }));
  const updated = programs
    .filter((p) => prevIds.has(p.id) && fingerprint(p) !== fingerprint(prevById.get(p.id)))
    .map((p) => ({ id: p.id, name: p.name, url: p.url }));

  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(catalog, null, 2) + "\n");
  fs.writeFileSync(
    OUT_FALLBACK,
    `/* Auto-generated by scripts/sync-programs.mjs — do not edit by hand */\nwindow.UAGC_CATALOG_FALLBACK = ${JSON.stringify(catalog)};\n`
  );

  const report = {
    generatedAt: catalog.generatedAt,
    totals: {
      programs: programs.length,
      areas: catalog.areas.length,
      added: added.length,
      updated: updated.length,
      removed: removed.length,
      needsReview: programs.filter((p) => p.needsReview).length,
    },
    added,
    updated,
    removed,
  };
  fs.writeFileSync(OUT_REPORT, JSON.stringify(report, null, 2) + "\n");

  console.log("\nSync complete");
  console.log(`  Wrote ${OUT_JSON}`);
  console.log(`  Wrote ${OUT_FALLBACK}`);
  console.log(`  Wrote ${OUT_REPORT}`);
  console.log(
    `  Programs: ${programs.length} | +${added.length} ~${updated.length} -${removed.length}`
  );
  if (added.length) {
    console.log("  Added:");
    added.forEach((p) => console.log(`    + ${p.name}`));
  }
  if (updated.length) {
    console.log(`  Updated: ${updated.length} program(s)`);
  }
  if (removed.length) {
    console.log("  Removed:");
    removed.forEach((p) => console.log(`    - ${p.name}`));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
