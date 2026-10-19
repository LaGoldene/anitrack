import { readFile, writeFile } from "node:fs/promises";

const SOURCE = "https://raw.githubusercontent.com/anime-and-manga/lists/main";
const MAX_PER_CATEGORY = 1500;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function readSeed() {
  try { return JSON.parse(await readFile("catalog.json", "utf8")); }
  catch { return { updatedAt: "", catalog: {} }; }
}

async function fetchDataset(path) {
  const response = await fetch(`${SOURCE}/${path}`, { signal: AbortSignal.timeout(45000), headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data)) throw new Error(`${path}: format JSON inattendu`);
  return data;
}

function titleOf(row) {
  const titles = row.titles || {};
  return String(titles.english || titles.romaji || titles.native || "").trim();
}

function normalize(row, category) {
  const externalId = Number(row.idMal);
  const title = titleOf(row);
  if (!externalId || !title) return null;
  const rawType = String(row.type || "").toUpperCase();
  const type = category === "anime" ? "Anime" : rawType === "MANHWA" ? "Manhwa" : rawType === "WEBTOON" ? "Webtoon" : "Manga";
  return {
    id: `jikan-${category}-${externalId}`,
    externalId,
    title,
    type,
    total: 0,
    progress: 0,
    status: "À commencer",
    cover: "",
    year: "",
    synopsis: "",
    score: null,
    genres: [],
    source: "Catalogue statique"
  };
}

function mergeUnique(seedRows, rows, category) {
  const merged = new Map();
  for (const row of [...(Array.isArray(seedRows) ? seedRows : []), ...rows]) {
    if (!row || !row.externalId || !row.title) continue;
    const normalized = row.source === "Catalogue statique" ? row : normalize({
      idMal: row.externalId,
      title: { english: row.title },
      type: row.type
    }, category) || row;
    const key = String(normalized.externalId);
    if (!merged.has(key)) merged.set(key, normalized);
  }
  return [...merged.values()];
}

const seed = await readSeed();
const catalog = { ...(seed.catalog || {}) };
let sourceOk = false;
try {
  const [animeRows, mangaRows] = await Promise.all([
    fetchDataset("anime-full.json"),
    fetchDataset("manga-full.json")
  ]);

  const mapRows = (rows, category) => rows
    .filter(row => Number(row.idMal) > 0 && titleOf(row))
    .sort((a, b) => Number(b.idMal) - Number(a.idMal))
    .map(row => normalize(row, category))
    .filter(Boolean);

  const anime = mapRows(animeRows, "anime");
  const manga = mapRows(mangaRows, "manga");
  const manhwa = mangaRows
    .filter(row => ["MANHWA", "WEBTOON"].includes(String(row.type || "").toUpperCase()))
    .sort((a, b) => Number(b.idMal) - Number(a.idMal))
    .map(row => normalize(row, String(row.type).toUpperCase() === "WEBTOON" ? "webtoon" : "manhwa"))
    .filter(Boolean);

  const seedAnime = catalog["anime:popular"] || catalog.anime || [];
  const seedManga = catalog["manga:popular"] || catalog.manga || [];
  const seedManhwa = catalog["manhwa:popular"] || catalog.manhwa || [];
  const seedWebtoon = catalog["webtoon:popular"] || catalog.webtoon || [];

  catalog["anime:popular"] = mergeUnique(seedAnime, anime, "anime").slice(0, MAX_PER_CATEGORY);
  catalog["anime:new"] = mergeUnique(catalog["anime:new"] || [], anime, "anime")
    .sort((a, b) => Number(b.externalId) - Number(a.externalId)).slice(0, MAX_PER_CATEGORY);
  catalog.anime = catalog["anime:popular"];

  catalog["manga:popular"] = mergeUnique(seedManga, manga, "manga").slice(0, MAX_PER_CATEGORY);
  catalog["manga:new"] = mergeUnique(catalog["manga:new"] || [], manga, "manga")
    .sort((a, b) => Number(b.externalId) - Number(a.externalId)).slice(0, MAX_PER_CATEGORY);
  catalog.manga = catalog["manga:popular"];

  if (manhwa.length) {
    catalog["manhwa:popular"] = mergeUnique(seedManhwa, manhwa, "manhwa").slice(0, MAX_PER_CATEGORY);
    catalog["manhwa:new"] = mergeUnique(catalog["manhwa:new"] || [], manhwa, "manhwa")
      .sort((a, b) => Number(b.externalId) - Number(a.externalId)).slice(0, MAX_PER_CATEGORY);
    catalog.manhwa = catalog["manhwa:popular"];
  }
  if (manhwa.length) {
    catalog["webtoon:popular"] = mergeUnique(seedWebtoon, manhwa.filter(x => x.type === "Webtoon"), "webtoon").slice(0, MAX_PER_CATEGORY);
    catalog["webtoon:new"] = mergeUnique(catalog["webtoon:new"] || [], manhwa.filter(x => x.type === "Webtoon"), "webtoon")
      .sort((a, b) => Number(b.externalId) - Number(a.externalId)).slice(0, MAX_PER_CATEGORY);
    catalog.webtoon = catalog["webtoon:popular"];
  }
  sourceOk = true;
  console.log(`Source chargée : ${animeRows.length} animes, ${mangaRows.length} mangas.`);
} catch (error) {
  console.warn("Source distante indisponible ; conservation du catalogue déjà versionné :", String(error));
}

const counts = Object.fromEntries(Object.entries(catalog)
  .filter(([key, value]) => key.includes(":") && Array.isArray(value))
  .map(([key, value]) => [key, value.length]));
await writeFile("catalog.json", JSON.stringify({
  updatedAt: new Date().toISOString(),
  catalog,
  source: sourceOk ? "anime-and-manga/lists" : "catalogue versionné de secours"
}) + "\n", "utf8");
console.log("Catalogue statique prêt :", JSON.stringify(counts));
if (!Object.values(catalog).some(value => Array.isArray(value) && value.length > 0)) {
  throw new Error("Le catalogue statique est vide.");
}
