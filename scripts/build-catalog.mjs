import { readFile, writeFile } from "node:fs/promises";

const API = "https://graphql.anilist.co";
const MAX_PER_CATEGORY = 1500;
const PER_PAGE = 50;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const FALLBACK_COVER = "data:image/svg+xml;base64," + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450" viewBox="0 0 300 450"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#42131b"/><stop offset="1" stop-color="#0b0809"/></linearGradient></defs><rect width="300" height="450" fill="url(#g)"/><circle cx="150" cy="175" r="75" fill="#e63946" opacity=".28"/><path d="M0 350L300 80M-20 410L280 140" stroke="#e63946" stroke-width="2" opacity=".3"/><text x="150" y="235" fill="#ff8b93" font-family="sans-serif" font-size="46" text-anchor="middle">AniTrack</text><text x="150" y="270" fill="#fff5f5" font-family="sans-serif" font-size="16" text-anchor="middle">Couverture indisponible</text></svg>').toString("base64");

async function readSeed() {
  try { return JSON.parse(await readFile("catalog.json", "utf8")); }
  catch { return { updatedAt: "", catalog: {} }; }
}

const query = `
query ($page: Int, $perPage: Int, $type: MediaType, $sort: [MediaSort]) {
  Page(page: $page, perPage: $perPage) {
    media(type: $type, sort: $sort, isAdult: false) {
      id idMal type format countryOfOrigin
      title { english romaji native }
      coverImage { large extraLarge }
      startDate { year }
      description(asHtml: false)
      averageScore episodes chapters
      genres
      tags { name rank }
    }
  }
}`;

async function fetchPage(type, page, sort) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query, variables: { page, perPage: PER_PAGE, type, sort } }),
        signal: AbortSignal.timeout(25000)
      });
      if (!response.ok) throw new Error("AniList HTTP " + response.status);
      const data = await response.json();
      if (data.errors?.length) throw new Error(data.errors[0].message);
      return data.data?.Page?.media || [];
    } catch (error) {
      lastError = error;
      await pause(1200 * (attempt + 1));
    }
  }
  throw lastError;
}

function titleOf(row) {
  return String(row.title?.english || row.title?.romaji || row.title?.native || "").trim();
}
function normalize(row, category) {
  const title = titleOf(row);
  if (!title) return null;
  const malId = Number(row.idMal) || Number(row.id);
  const type = category === "anime" ? "Anime" : category === "manhwa" ? "Manhwa" : category === "webtoon" ? "Webtoon" : "Manga";
  const cover = row.coverImage?.extraLarge || row.coverImage?.large || FALLBACK_COVER;
  const synopsis = String(row.description || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 1200);
  return {
    id: "anilist-" + category + "-" + malId,
    externalId: malId,
    title,
    type,
    total: Number(category === "anime" ? row.episodes : row.chapters) || 0,
    progress: 0,
    status: "À commencer",
    cover,
    year: row.startDate?.year ? String(row.startDate.year) : "",
    synopsis,
    score: row.averageScore ? Number((row.averageScore / 10).toFixed(1)) : null,
    genres: Array.isArray(row.genres) ? row.genres : [],
    source: "AniList"
  };
}
function unique(rows) {
  const map = new Map();
  for (const row of rows) if (row?.externalId && row?.title && !map.has(String(row.externalId))) map.set(String(row.externalId), row);
  return [...map.values()];
}
function isWebtoon(row) {
  const tags = (row.tags || []).map(t => String(t.name).toLowerCase());
  return tags.some(t => t === "webtoon" || t === "full color" || t === "long strip") ||
    String(row.format || "").toUpperCase() === "WEBTOON";
}
function isManhwa(row) {
  return String(row.countryOfOrigin || "").toUpperCase() === "KR" ||
    (row.tags || []).some(t => /manhwa|korean comic/i.test(t.name || ""));
}

const seed = await readSeed();
const seedCatalog = seed.catalog || {};
const fetched = { anime: [], manga: [], manhwa: [], webtoon: [] };
let sourceOk = false;

try {
  // Popularity pages give a broad, preloaded catalogue; recent pages add newly updated works.
  for (const [kind, type, pagesPopular, pagesRecent] of [
    ["anime", "ANIME", 30, 15],
    ["manga", "MANGA", 50, 20]
  ]) {
    const popular = [];
    const recent = [];
    for (let page = 1; page <= pagesPopular; page++) {
      popular.push(...await fetchPage(type, page, ["POPULARITY_DESC"]));
      await pause(750);
    }
    for (let page = 1; page <= pagesRecent; page++) {
      recent.push(...await fetchPage(type, page, ["UPDATED_AT_DESC"]));
      await pause(750);
    }
    fetched[kind] = unique([...popular, ...recent].map(row => normalize(row, kind)).filter(Boolean));
    if (kind === "manga") {
      const mangaRows = unique([...popular, ...recent]);
      fetched.manhwa = unique(mangaRows.filter(isManhwa).map(row => normalize(row, "manhwa")).filter(Boolean));
      fetched.webtoon = unique(mangaRows.filter(isWebtoon).map(row => normalize(row, "webtoon")).filter(Boolean));
    }
    console.log(`AniList ${kind}: ${fetched[kind].length} fiches, ${kind === "manga" ? fetched.manhwa.length + " manhwa / " + fetched.webtoon.length + " webtoons" : "couvertures chargées"}`);
  }
  sourceOk = fetched.anime.length > 100 && fetched.manga.length > 100;
} catch (error) {
  console.warn("Source AniList indisponible ; conservation du catalogue déjà versionné :", String(error));
}

const catalog = { ...seedCatalog };
if (sourceOk) {
  for (const kind of ["anime", "manga", "manhwa", "webtoon"]) {
    const seedPopular = seedCatalog[kind + ":popular"] || seedCatalog[kind] || [];
    const seedNew = seedCatalog[kind + ":new"] || [];
    const rows = fetched[kind] || [];
    const withSeedCovers = seedPopular.map(item => {
      const found = rows.find(row => String(row.externalId) === String(item.externalId) || row.title.toLowerCase() === String(item.title).toLowerCase());
      return found ? { ...item, ...found, id: item.id, progress: item.progress || 0, status: item.status || "À commencer" } : { ...item, cover: item.cover || FALLBACK_COVER };
    });
    const popular = unique([...withSeedCovers, ...rows]).slice(0, MAX_PER_CATEGORY);
    const recent = unique([...seedNew.map(item => ({ ...item, cover: item.cover || FALLBACK_COVER })), ...rows.slice().reverse()]).slice(0, MAX_PER_CATEGORY);
    catalog[kind + ":popular"] = popular;
    catalog[kind + ":new"] = recent;
    catalog[kind] = popular;
  }
} else {
  // Even the fallback catalog shows a consistent cover image rather than an empty tile.
  for (const [key, rows] of Object.entries(catalog)) {
    if (Array.isArray(rows)) catalog[key] = rows.map(row => ({ ...row, cover: row.cover || FALLBACK_COVER }));
  }
}

const counts = Object.fromEntries(Object.entries(catalog)
  .filter(([key, value]) => key.includes(":") && Array.isArray(value))
  .map(([key, value]) => [key, value.length]));
await writeFile("catalog.json", JSON.stringify({
  updatedAt: new Date().toISOString(),
  catalog,
  source: sourceOk ? "AniList GraphQL" : "catalogue versionné de secours"
}) + "\n", "utf8");
console.log("Catalogue statique prêt :", JSON.stringify(counts));
if (!Object.values(catalog).some(value => Array.isArray(value) && value.length > 0)) {
  throw new Error("Le catalogue statique est vide.");
}
