import { mkdir, writeFile } from "node:fs/promises";

const categories = ["anime", "manga", "manhwa", "webtoon"];
const sorts = ["popular", "new"];
const catalog = {};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function mapEntry(a, type) {
  return {
    id: "jikan-" + type + "-" + a.mal_id,
    externalId: a.mal_id,
    title: a.title_english || a.title || a.title_japanese || "Sans titre",
    type: type === "anime" ? "Anime" : type === "manhwa" ? "Manhwa" : type === "webtoon" ? "Webtoon" : "Manga",
    total: type === "anime" ? (a.episodes || 0) : (a.chapters || 0),
    progress: 0,
    status: "À commencer",
    cover: a.images?.jpg?.large_image_url || a.images?.jpg?.image_url || "",
    year: a.year || a.published?.from?.slice(0, 4) || "",
    synopsis: a.synopsis || "",
    score: a.score || null,
    genres: (a.genres || []).map(g => g.name),
    source: "Jikan"
  };
}

async function fetchCategory(type, sortMode) {
  const base = type === "anime" ? "anime" : "manga";
  const order = sortMode === "new" ? "start_date" : "members";
  const params = new URLSearchParams({ limit: "24", page: "1", sfw: "true", order_by: order, sort: "desc" });
  if (type === "manhwa" || type === "webtoon") params.set("type", "manhwa");
  const url = `https://api.jikan.moe/v4/${base}?${params}`;
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "AniTrack-Catalog-Builder" } });
      if (response.status === 429 || response.status >= 500) throw new Error(`Jikan HTTP ${response.status}`);
      if (!response.ok) throw new Error(`Jikan HTTP ${response.status}`);
      const body = await response.json();
      if (!Array.isArray(body.data)) throw new Error("Réponse Jikan invalide");
      return body.data.map(item => mapEntry(item, type));
    } catch (error) {
      lastError = error;
      if (attempt < 2) await pause(1800 * (attempt + 1));
    }
  }
  console.warn(`Impossible de précharger ${type}:${sortMode}:`, String(lastError));
  return [];
}

for (const type of categories) {
  for (const sortMode of sorts) {
    catalog[`${type}:${sortMode}`] = await fetchCategory(type, sortMode);
    await pause(1300);
  }
}

await mkdir("data", { recursive: true });
await writeFile("catalog.json", JSON.stringify({ updatedAt: new Date().toISOString(), catalog }, null, 2) + "\n", "utf8");
const counts = Object.fromEntries(Object.entries(catalog).map(([key, rows]) => [key, rows.length]));
console.log("Catalogue statique généré :", JSON.stringify(counts));
if (!Object.values(catalog).some(rows => rows.length > 0)) {
  throw new Error("Aucune œuvre n'a pu être récupérée ; arrêt du déploiement pour éviter de publier un catalogue vide.");
}
