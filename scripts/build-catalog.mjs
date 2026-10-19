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

const ANILIST = "https://graphql.anilist.co";
async function fetchAniListPage(type, page, filters = {}) {
  const query = `query ($page: Int, $type: MediaType, $country: CountryCode, $format: MediaFormat) {
    Page(page: $page, perPage: 50) {
      pageInfo { hasNextPage total }
      media(type: $type, countryOfOrigin: $country, format: $format, sort: POPULARITY_DESC, isAdult: false) {
        id idMal type format countryOfOrigin
        title { english romaji native }
        description(asHtml: false)
        coverImage { extraLarge large }
        startDate { year }
        episodes chapters volumes averageScore genres status
      }
    }
  }`;
  const variables = { page, type, country: filters.country || null, format: filters.format || null };
  let lastError;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(ANILIST, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(30000)
      });
      if (response.status === 429 || response.status >= 500) {
        lastError = new Error("AniList HTTP " + response.status);
        await pause(2500 * (attempt + 1));
        continue;
      }
      if (!response.ok) throw new Error("AniList HTTP " + response.status);
      const payload = await response.json();
      if (payload.errors?.length) throw new Error("AniList GraphQL : " + payload.errors.map(x => x.message).join("; "));
      return payload.data?.Page || { media: [], pageInfo: { hasNextPage: false } };
    } catch (error) {
      lastError = error;
      if (attempt < 3) await pause(1500 * (attempt + 1));
    }
  }
  throw lastError || new Error("AniList indisponible");
}
function fromAniList(item, category) {
  const titles = item.title || {};
  const title = titles.english || titles.romaji || titles.native || "";
  const altTitle = [...new Set([titles.romaji, titles.native, titles.english].filter(Boolean).filter(x => x !== title))].join(" · ");
  const id = Number(item.idMal) || Number(item.id);
  const cover = item.coverImage?.extraLarge || item.coverImage?.large || FALLBACK_COVER;
  const total = category === "Anime" ? item.episodes : item.chapters;
  return {
    ...makeRow({
      id,
      title,
      type: category,
      cover,
      year: item.startDate?.year || "",
      synopsis: item.description || "",
      score: item.averageScore == null ? null : Number((item.averageScore / 10).toFixed(1)),
      total: total || 0,
      genres: item.genres || [],
      source: "AniList",
      altTitle,
      format: item.format || "",
      publicationStatus: item.status || "",
      volumes: item.volumes || 0,
      countryOfOrigin: item.countryOfOrigin || ""
    }),
    externalId: id,
    anilistId: item.id,
    malId: item.idMal || null
  };
}
async function fetchAniListCollection(category, filters = {}, max = MAX_PER_CATEGORY) {
  const rows = [];
  const maxPages = Math.ceil(max / 50);
  for (let pageNo = 1; pageNo <= maxPages; pageNo++) {
    try {
      const page = await fetchAniListPage(category === "Anime" ? "ANIME" : "MANGA", pageNo, filters);
      const items = page.media || [];
      rows.push(...items.map(item => fromAniList(item, category)).filter(row => row?.title));
      console.log("AniList", category, "page", pageNo, ":", items.length, "fiches.");
      if (!page.pageInfo?.hasNextPage || items.length === 0) break;
    } catch (error) {
      console.warn("AniList", category, "interrompu page", pageNo, ":", String(error), "—", rows.length, "fiches conservées.");
      break;
    }
    if (pageNo < maxPages) await pause(850);
  }
  return unique(rows).slice(0, max);
}
function titleOf(row) {
  const titles = row.titles || {};
  return String(titles.english || titles.romaji || titles.native || "").trim();
}
function makeRow({ id, title, type, cover, year = "", synopsis = "", score = null, total = 0, genres = [], source = "Catalogue statique", altTitle = "", format = "", publicationStatus = "", volumes = 0, countryOfOrigin = "" }) {
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
    source,
    altTitle: String(altTitle || "").trim(),
    format: String(format || "").trim(),
    publicationStatus: String(publicationStatus || "").trim(),
    volumes: Number(volumes) || 0,
    countryOfOrigin: String(countryOfOrigin || "").trim()
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
function malRow(row, category, imageMap = new Map()) {
  const id = Number(row.idMal);
  const title = titleOf(row);
  if (!id || !title) return null;
  const image = imageMap.get(id);
  return makeRow({
    id,
    title,
    type: category === "anime" ? "Anime" : category === "manhwa" ? "Manhwa" : category === "webtoon" ? "Webtoon" : "Manga",
    cover: image || FALLBACK_COVER,
    source: "Catalogue statique"
  });
}
async function fetchAnimeImageMap() {
  const response = await fetch("https://raw.githubusercontent.com/meesvandongen/anime-dataset/main/data/anime.csv", { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error("anime.csv HTTP " + response.status);
  const lines = (await response.text()).split(/\r?\n/);
  const headers = parseCsvLine(lines[0]).map(x => x.trim().toLowerCase());
  const idIndex = headers.findIndex(x => ["id", "mal_id", "anime_id"].includes(x));
  const imageIndex = headers.findIndex(x => ["image", "picture", "main_picture", "image_url", "picture_url"].includes(x));
  if (idIndex < 0 || imageIndex < 0) throw new Error("Colonnes image absentes : " + headers.slice(0, 15).join(","));
  const map = new Map();
  for (const line of lines.slice(1)) {
    if (!line) continue;
    const cols = parseCsvLine(line); const id = Number(cols[idIndex]); let image = String(cols[imageIndex] || "").trim();
    if (!id || !image) continue;
    if (!/^https?:\/\//i.test(image)) image = "https://cdn.myanimelist.net/images/anime/" + image.replace(/\.jpg$/i, "") + ".jpg";
    map.set(id, image);
  }
  console.log("Images d’animes chargées :", map.size);
  return map;
}
async function fetchMangaDexPage(offset, filters = {}) {
  const url = new URL(MANGADEX);
  url.searchParams.set("limit", "100");
  url.searchParams.set("offset", String(offset));
  url.searchParams.append("includes[]", "cover_art");
  url.searchParams.append("contentRating[]", "safe");
  url.searchParams.set("order[followedCount]", "desc");
  if (filters.language) url.searchParams.append("originalLanguage[]", filters.language);
  if (filters.tagId) url.searchParams.append("includedTags[]", filters.tagId);
  return getJson(url.toString(), 20000);
}
async function fetchMangaDexCollection(filters = {}, max = MAX_PER_CATEGORY, forcedType = "") {
  const rows = [];
  for (let offset = 0; offset < max; offset += 100) {
    const page = await fetchMangaDexPage(offset, filters);
    const items = page.data || [];
    rows.push(...items.map(fromMangaDex).filter(x => x?.title).map(row => {
      if (!forcedType) return row;
      return { ...row, type: forcedType, id: "catalog-" + forcedType.toLowerCase() + "-" + (row.externalId || row.mangaDexId) };
    }));
    if (items.length < 100 || offset + 100 >= Number(page.total || 0)) break;
    await pause(900);
  }
  return rows;
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
try {
  const [animeData, mangaData, animeImages] = await Promise.all([
    fetchDataset("anime-full.json"),
    fetchDataset("manga-full.json"),
    fetchAnimeImageMap().catch(error => { console.warn("Images anime indisponibles :", String(error)); return new Map(); })
  ]);
  animeRows = unique(animeData
    .filter(row => Number(row.idMal) > 0 && titleOf(row))
    .map(row => malRow(row, "anime", animeImages))
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

  // AniList fournit les fiches complètes (synopsis, genres, couverture, score, année et format).
  // Les collections sont paginées et une erreur conserve les pages déjà récupérées.
  const anilistAnime = await fetchAniListCollection("Anime");
  const anilistManga = await fetchAniListCollection("Manga", { country: "JP", format: "MANGA" });
  const anilistManhwa = await fetchAniListCollection("Manhwa", { country: "KR" });
  const anilistWebtoon = await fetchAniListCollection("Webtoon", { format: "WEBTOON" });
  if (anilistAnime.length) animeRows = unique([...anilistAnime, ...animeRows]);
  const mangaDexRows = [...anilistManga, ...anilistManhwa, ...anilistWebtoon];
  const normalizeTitle = title => String(title || "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const anilistByTitle = new Map(mangaDexRows.map(row => [normalizeTitle(row.title), row]));
  const withMangaDexCover = row => {
    const found = anilistByTitle.get(normalizeTitle(row.title));
    if (!found) return row;
    return {
      ...row,
      cover: found.cover || row.cover,
      synopsis: found.synopsis || row.synopsis,
      year: found.year || row.year,
      score: found.score ?? row.score,
      genres: found.genres?.length ? found.genres : row.genres,
      altTitle: found.altTitle || row.altTitle || "",
      format: found.format || row.format || "",
      publicationStatus: found.publicationStatus || row.publicationStatus || "",
      volumes: found.volumes || row.volumes || 0,
      countryOfOrigin: found.countryOfOrigin || row.countryOfOrigin || "",
      source: "AniList + catalogue statique"
    };
  };
  const manhwaRows = unique([...anilistManhwa, ...sourceManhwa.map(withMangaDexCover)]);
  const webtoonRows = unique([...anilistWebtoon, ...sourceWebtoon.map(withMangaDexCover)]);
  const otherMangaDex = unique([...anilistManga, ...mangaSeedRows.map(withMangaDexCover)]);
  console.log("AniList total :", JSON.stringify({ anime: anilistAnime.length, manga: anilistManga.length, manhwa: anilistManhwa.length, webtoon: anilistWebtoon.length }));
  sourceOk = animeRows.length > 100 && mangaSeedRows.length > 100;
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
  const popularAnime = unique([...animeRows, ...coverSeed(seedAnime, "Anime")]).slice(0, MAX_PER_CATEGORY);
  const newAnime = unique([...animeRows.slice().reverse(), ...coverSeed(seedCatalog["anime:new"] || [], "Anime")]).slice(0, MAX_PER_CATEGORY);
  const popularManga = unique([...anilistManga, ...otherMangaDex, ...mangaRows.map(withMangaDexCover), ...coverSeed(seedManga, "Manga")]).slice(0, MAX_PER_CATEGORY);
  const newManga = unique([...anilistManga.slice().reverse(), ...otherMangaDex.slice().reverse(), ...mangaRows.slice().reverse().map(withMangaDexCover), ...coverSeed(seedCatalog["manga:new"] || [], "Manga")]).slice(0, MAX_PER_CATEGORY);
  const popularManhwa = unique([...anilistManhwa, ...manhwaRows, ...coverSeed(seedManhwa, "Manhwa")]).slice(0, MAX_PER_CATEGORY);
  const newManhwa = unique([...anilistManhwa.slice().reverse(), ...manhwaRows.slice().reverse(), ...coverSeed(seedCatalog["manhwa:new"] || [], "Manhwa")]).slice(0, MAX_PER_CATEGORY);
  const popularWebtoon = unique([...anilistWebtoon, ...webtoonRows, ...coverSeed(seedWebtoon, "Webtoon")]).slice(0, MAX_PER_CATEGORY);
  const newWebtoon = unique([...anilistWebtoon.slice().reverse(), ...webtoonRows.slice().reverse(), ...coverSeed(seedCatalog["webtoon:new"] || [], "Webtoon")]).slice(0, MAX_PER_CATEGORY);
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
  console.log("Couvertures réelles par liste :", JSON.stringify(Object.fromEntries(Object.entries(catalog).filter(([key, value]) => key.includes(":") && Array.isArray(value)).map(([key, rows]) => [key, rows.filter(row => row.cover && row.cover !== FALLBACK_COVER).length]))));
  console.log("Catalogue statique prêt :", JSON.stringify(counts));
} catch (error) {
  console.warn("Source distante indisponible ; conservation du catalogue déjà versionné :", String(error));
  const catalog = { ...seedCatalog };
  for (const [key, rows] of Object.entries(catalog)) if (Array.isArray(rows)) catalog[key] = rows.map(row => ({ ...row, cover: row.cover || FALLBACK_COVER }));
  await writeFile("catalog.json", JSON.stringify({ updatedAt: new Date().toISOString(), catalog, source: "catalogue versionné de secours" }) + "\n", "utf8");
}
