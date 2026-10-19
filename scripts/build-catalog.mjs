import { readFile, writeFile } from "node:fs/promises";

const LISTS = "https://raw.githubusercontent.com/anime-and-manga/lists/main";
const ANIME_CSV = "https://raw.githubusercontent.com/meesvandongen/anime-dataset/main/data/anime.csv";
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
async function fetchAnimeImageMap() {
  const response = await fetch(ANIME_CSV, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error("anime.csv HTTP " + response.status);
  const csv = await response.text();
  const lines = csv.split(/\r?\n/);
  const headers = parseCsvLine(lines[0]).map(x => x.trim().toLowerCase());
  const idIndex = headers.findIndex(x => x === "id" || x === "mal_id" || x === "anime_id");
  const imageIndex = headers.findIndex(x => ["image", "picture", "main_picture", "image_url", "picture_url"].includes(x));
  const titleIndex = headers.findIndex(x => x === "title" || x === "title_english");
  const yearIndex = headers.findIndex(x => ["year", "start_year"].includes(x));
  const scoreIndex = headers.findIndex(x => ["mean", "score", "rating"].includes(x));
  const map = new Map();
  if (idIndex < 0 || imageIndex < 0) {
    console.warn("Colonnes d'images non reconnues dans anime.csv :", headers.slice(0, 15).join(","));
    return map;
  }
  for (const line of lines.slice(1)) {
    if (!line) continue;
    const row = parseCsvLine(line);
    const id = Number(row[idIndex]);
    let image = String(row[imageIndex] || "").trim();
    if (!id || !image) continue;
    if (/^https?:\/\//i.test(image)) { /* full image URL */ }
    else image = `https://cdn.myanimelist.net/images/anime/${image}.jpg`;
    map.set(id, { cover: image, title: row[titleIndex] || "", year: row[yearIndex] || "", score: row[scoreIndex] || null });
  }
  console.log("Images anime trouvées dans le dataset :", map.size);
  return map;
}
function malRow(row, category, imageMap = new Map()) {
  const id = Number(row.idMal);
  const title = titleOf(row);
  if (!id || !title) return null;
  const image = imageMap.get(id);
  return makeRow({
    id,
    title,
    type: category === "anime" ? "Anime" : "Manga",
    cover: image?.cover || FALLBACK_COVER,
    year: image?.year || "",
    score: image?.score,
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
  return getJson(url.toString(), 30000);
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
  const [animeData, mangaData, imageMap] = await Promise.all([
    fetchDataset("anime-full.json"),
    fetchDataset("manga-full.json"),
    fetchAnimeImageMap().catch(error => { console.warn("Images anime indisponibles :", String(error)); return new Map(); })
  ]);
  animeRows = unique(animeData
    .filter(row => Number(row.idMal) > 0 && titleOf(row))
    .map(row => malRow(row, "anime", imageMap))
    .filter(Boolean));
  const mangaSeedRows = unique(mangaData
    .filter(row => Number(row.idMal) > 0 && titleOf(row))
    .map(row => malRow(row, "manga"))
    .filter(Boolean));
  console.log(`Source de titres : ${animeRows.length} animes, ${mangaSeedRows.length} mangas.`);

  // MangaDex fournit les couvertures et identifie les œuvres coréennes/webtoon.
  for (let offset = 0; offset < 3000; offset += 100) {
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
  const manhwaRows = mangaDexRows.filter(x => x.type === "Manhwa");
  const webtoonRows = mangaDexRows.filter(x => x.type === "Webtoon");
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
