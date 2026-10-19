import { readFile, writeFile } from "node:fs/promises";

const LISTS = "https://raw.githubusercontent.com/anime-and-manga/lists/main";
const MANGADEX = "https://api.mangadex.org/manga";
const MAX_PER_CATEGORY = 1500;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const FALLBACK_COVER = "data:image/svg+xml;base64," + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450" viewBox="0 0 300 450"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#42131b"/><stop offset="1" stop-color="#0b0809"/></linearGradient></defs><rect width="300" height="450" fill="url(#g)"/><circle cx="150" cy="175" r="75" fill="#e63946" opacity=".28"/><path d="M0 350L300 80M-20 410L280 140" stroke="#e63946" stroke-width="2" opacity=".3"/><text x="150" y="235" fill="#ff8b93" font-family="sans-serif" font-size="46" text-anchor="middle">AniTrack</text><text x="150" y="270" fill="#fff5f5" font-family="sans-serif" font-size="16" text-anchor="middle">Couverture indisponible</text></svg>').toString("base64");

async function readSeed() {
  try { return JSON.parse(await readFile("catalog.json", "utf8")); }
  catch { return { updatedAt: "", catalog: {} }; }
}
async function getJson(url, timeout = 45000) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeout), headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(url + " HTTP " + response.status);
  return response.json();
}
async function fetchDataset(path) {
  const data = await getJson(`${LISTS}/${path}`);
  if (!Array.isArray(data)) throw new Error(path + ": format JSON inattendu");
  return data;
}
function titleOf(row) {
  const titles = row.titles || {};
  return String(titles.english || titles.romaji || titles.native || "").trim();
}
function makeRow({ id, title, type, cover, year = "", synopsis = "", score = null, total = 0, genres = [], source = "Catalogue statique" }) {
  if (!id || !title) return null;
  return {
    id: `catalog-${type.toLowerCase()}-${id}`,
    externalId: Number(id) || 0,
    title: String(title).trim(),
    type,
    total: Number(total) || 0,
    progress: 0,
    status: "À commencer",
    cover: cover || FALLBACK_COVER,
    year: year ? String(year) : "",
    synopsis: String(synopsis || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 1200),
    score: score == null ? null : Number(score),
    genres: Array.isArray(genres) ? genres : [],
    source
  };
}
function unique(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!row?.title) continue;
    const key = row.externalId ? String(row.externalId) : row.title.toLowerCase();
    if (!map.has(key)) map.set(key, row);
  }
  return [...map.values()];
}
function parseCsvLine(line) {
  const out = []; let value = ""; let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && quoted && line[i + 1] === '"') { value += '"'; i++; }
    else if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) { out.push(value); value = ""; }
    else value += ch;
  }
  out.push(value); return out;
}
function malRow(row, category) {
  const id = Number(row.idMal);
  const title = titleOf(row);
  if (!id || !title) return null;
  return makeRow({
    id,
    title,
    type: category === "anime" ? "Anime" : "Manga",
    cover: FALLBACK_COVER,
    source: "Catalogue statique"
  });
}
async function fetchMangaDexPage(offset) {
  const url = new URL(MANGADEX);
  url.searchParams.set("limit", "100");
  url.searchParams.set("offset", String(offset));
  url.searchParams.append("includes[]", "cover_art");
  url.searchParams.append("contentRating[]", "safe");
  url.searchParams.set("order[followedCount]", "desc");
  return getJson(url.toString(), 12000);
}
function fromMangaDex(item) {
  const a = item.attributes || {};
  const title = a.title?.en || Object.values(a.title || {})[0] || "";
  const coverRel = (item.relationships || []).find(r => r.type === "cover_art");
  const filename = coverRel?.attributes?.fileName;
  const cover = filename ? `https://uploads.mangadex.org/covers/${item.id}/${filename}.256.jpg` : FALLBACK_COVER;
  const malId = Number(a.links?.mal) || Number(a.links?.anilist) || 0;
  const tagNames = (a.tags || []).map(t => String(t.attributes?.name?.en || "").toLowerCase());
  const isKorean = String(a.originalLanguage || "").toLowerCase() === "ko";
  const isWebtoon = tagNames.some(t => t === "webtoon" || t === "long strip");
  const type = isWebtoon ? "Webtoon" : isKorean ? "Manhwa" : "Manga";
  return {
    ...makeRow({
      id: malId || item.id,
      title,
      type,
      cover,
      synopsis: a.description?.en || "",
      year: a.year || "",
      genres: tagNames.filter(t => t && t !== "webtoon"),
      source: "MangaDex"
    }),
    externalId: malId || Number.parseInt(item.id.replace(/-/g, "").slice(0, 10), 16) || 0,
    mangaDexId: item.id
  };
}

const seed = await readSeed();
const seedCatalog = seed.catalog || {};
let sourceOk = false;
let animeRows = [];
let mangaDexRows = [];
try {
  const [animeData, mangaData] = await Promise.all([
    fetchDataset("anime-full.json"),
    fetchDataset("manga-full.json")
  ]);
  animeRows = unique(animeData
    .filter(row => Number(row.idMal) > 0 && titleOf(row))
    .map(row => malRow(row, "anime"))
    .filter(Boolean));
  const mangaRecords = mangaData.filter(row => Number(row.idMal) > 0 && titleOf(row));
  const mangaSeedRows = unique(mangaRecords.map(row => malRow(row, "manga")).filter(Boolean));
  const categoryOf = row => {
    const kind = String(row.type || row.format || row.subtype || "").toUpperCase().replace(/[ _-]/g, "");
    if (kind.includes("WEBTOON")) return "Webtoon";
    if (kind.includes("MANHWA") || String(row.countryOfOrigin || row.country || "").toUpperCase() === "KR") return "Manhwa";
    return "Manga";
  };
  const sourceManhwa = unique(mangaRecords.filter(row => categoryOf(row) === "Manhwa").map(row => malRow(row, "manhwa")).filter(Boolean));
  const sourceWebtoon = unique(mangaRecords.filter(row => categoryOf(row) === "Webtoon").map(row => malRow(row, "webtoon")).filter(Boolean));
  const typeCounts = {};
  for (const row of mangaRecords) { const kind = String(row.type || row.format || row.subtype || "unknown"); typeCounts[kind] = (typeCounts[kind] || 0) + 1; }
  console.log(`Source de titres : ${animeRows.length} animes, ${mangaSeedRows.length} mangas, ${sourceManhwa.length} manhwas, ${sourceWebtoon.length} webtoons.`);
  console.log("Types source manga :", JSON.stringify(typeCounts));

  // MangaDex fournit les couvertures et identifie les œuvres coréennes/webtoon.
  for (let offset = 0; offset < 1500; offset += 100) {
    try {
      const page = await fetchMangaDexPage(offset);
      const items = page.data || [];
      mangaDexRows.push(...items.map(fromMangaDex).filter(x => x?.title));
      if (items.length < 100 || offset + 100 >= Number(page.total || 0)) break;
      await pause(1200);
    } catch (error) {
      console.warn("MangaDex interrompu à offset " + offset + " :", String(error));
      break;
    }
  }
  console.log("MangaDex : " + mangaDexRows.length + " fiches récupérées.");
  sourceOk = animeRows.length > 100 && mangaSeedRows.length > 100;
  // Keep the broad MAL list but replace matching titles with MangaDex covers where possible.
  const coverByMal = new Map(mangaDexRows.filter(x => x.externalId).map(x => [String(x.externalId), x]));
  const mangaRows = mangaSeedRows.map(row => {
    const found = coverByMal.get(String(row.externalId));
    return found ? { ...row, cover: found.cover, synopsis: found.synopsis || row.synopsis, genres: found.genres || row.genres, source: "MangaDex" } : row;
  });
  const mangaDexByTitle = new Map(mangaDexRows.map(row => [row.title.toLowerCase().replace(/[^\\p{L}\\p{N}]/gu, ""), row]));
  const withMangaDexCover = row => {
    const key = row.title.toLowerCase().replace(/[^\\p{L}\\p{N}]/gu, "");
    const found = mangaDexByTitle.get(key);
    return found ? { ...row, cover: found.cover || row.cover, synopsis: found.synopsis || row.synopsis, genres: found.genres?.length ? found.genres : row.genres, source: "MangaDex + catalogue statique" } : row;
  };
  const manhwaRows = unique([...sourceManhwa.map(withMangaDexCover), ...mangaDexRows.filter(x => x.type === "Manhwa")]);
  const webtoonRows = unique([...sourceWebtoon.map(withMangaDexCover), ...mangaDexRows.filter(x => x.type === "Webtoon")]);
  const otherMangaDex = mangaDexRows.filter(x => x.type === "Manga");
  const seedManhwa = seedCatalog["manhwa:popular"] || seedCatalog.manhwa || [];
  const seedWebtoon = seedCatalog["webtoon:popular"] || seedCatalog.webtoon || [];
  const seedManga = seedCatalog["manga:popular"] || seedCatalog.manga || [];
  const seedAnime = seedCatalog["anime:popular"] || seedCatalog.anime || [];

  const coverSeed = (items, type) => items.map(item => {
    if (item.cover) return item;
    const match = type === "Anime"
      ? animeRows.find(row => row.externalId === item.externalId || row.title.toLowerCase() === String(item.title).toLowerCase())
      : mangaDexRows.find(row => row.title.toLowerCase() === String(item.title).toLowerCase());
    return { ...item, cover: match?.cover || FALLBACK_COVER };
  });
  const popularAnime = unique([...coverSeed(seedAnime, "Anime"), ...animeRows]).slice(0, MAX_PER_CATEGORY);
  const newAnime = unique([...coverSeed(seedCatalog["anime:new"] || [], "Anime"), ...animeRows.slice().reverse()]).slice(0, MAX_PER_CATEGORY);
  const popularManga = unique([...coverSeed(seedManga, "Manga"), ...otherMangaDex, ...mangaRows]).slice(0, MAX_PER_CATEGORY);
  const newManga = unique([...coverSeed(seedCatalog["manga:new"] || [], "Manga"), ...otherMangaDex.slice().reverse(), ...mangaRows.slice().reverse()]).slice(0, MAX_PER_CATEGORY);
  const popularManhwa = unique([...coverSeed(seedManhwa, "Manhwa"), ...manhwaRows]).slice(0, MAX_PER_CATEGORY);
  const newManhwa = unique([...coverSeed(seedCatalog["manhwa:new"] || [], "Manhwa"), ...manhwaRows.slice().reverse()]).slice(0, MAX_PER_CATEGORY);
  const popularWebtoon = unique([...coverSeed(seedWebtoon, "Webtoon"), ...webtoonRows]).slice(0, MAX_PER_CATEGORY);
  const newWebtoon = unique([...coverSeed(seedCatalog["webtoon:new"] || [], "Webtoon"), ...webtoonRows.slice().reverse()]).slice(0, MAX_PER_CATEGORY);
  const catalog = {
    ...seedCatalog,
    "anime:popular": popularAnime, "anime:new": newAnime, anime: popularAnime,
    "manga:popular": popularManga, "manga:new": newManga, manga: popularManga,
    "manhwa:popular": popularManhwa, "manhwa:new": newManhwa, manhwa: popularManhwa,
    "webtoon:popular": popularWebtoon, "webtoon:new": newWebtoon, webtoon: popularWebtoon
  };
  for (const [key, rows] of Object.entries(catalog)) if (Array.isArray(rows)) catalog[key] = rows.map(row => ({ ...row, cover: row.cover || FALLBACK_COVER }));
  const counts = Object.fromEntries(Object.entries(catalog).filter(([key, value]) => key.includes(":") && Array.isArray(value)).map(([key, value]) => [key, value.length]));
  await writeFile("catalog.json", JSON.stringify({ updatedAt: new Date().toISOString(), catalog, source: "MAL static list + MangaDex covers" }) + "\n", "utf8");
  console.log("Catalogue statique prêt :", JSON.stringify(counts));
} catch (error) {
  console.warn("Source distante indisponible ; conservation du catalogue déjà versionné :", String(error));
  const catalog = { ...seedCatalog };
  for (const [key, rows] of Object.entries(catalog)) if (Array.isArray(rows)) catalog[key] = rows.map(row => ({ ...row, cover: row.cover || FALLBACK_COVER }));
  await writeFile("catalog.json", JSON.stringify({ updatedAt: new Date().toISOString(), catalog, source: "catalogue versionné de secours" }) + "\n", "utf8");
}
