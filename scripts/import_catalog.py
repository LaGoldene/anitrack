import json
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "catalog.json"
USER_AGENT = "AniTrackCatalog/1.0 (GitHub Actions; static catalog refresh)"
PAGES = 2
LIMIT = 24
TYPES = ("anime", "manga", "manhwa", "webtoon")
SORTS = ("popular", "new")


def request_json(url, attempts=4):
    last_error = None
    for attempt in range(attempts):
        try:
            request = urllib.request.Request(
                url,
                headers={"Accept": "application/json", "User-Agent": USER_AGENT},
            )
            with urllib.request.urlopen(request, timeout=25) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            last_error = exc
            retryable = exc.code == 429 or exc.code in (500, 502, 503, 504)
            if not retryable or attempt == attempts - 1:
                raise
            retry_after = exc.headers.get("Retry-After") if exc.headers else None
            try:
                delay = float(retry_after) if retry_after else 2 + attempt * 2
            except (TypeError, ValueError):
                delay = 2 + attempt * 2
            time.sleep(min(20, max(1, delay)))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            last_error = exc
            if attempt == attempts - 1:
                raise
            time.sleep(2 + attempt * 2)
    raise RuntimeError(f"API indisponible : {last_error}")


def catalog_url(kind, sort_mode, page):
    base = "anime" if kind == "anime" else "manga"
    order = "start_date" if sort_mode == "new" else "members"
    params = {"limit": LIMIT, "page": page, "sfw": "true", "order_by": order, "sort": "desc"}
    if kind in ("manhwa", "webtoon"):
        params["type"] = "manhwa"
    return "https://api.jikan.moe/v4/" + base + "?" + urllib.parse.urlencode(params)


def map_item(item, kind):
    published = item.get("published") or {}
    images = item.get("images") or {}
    jpg = images.get("jpg") or {}
    genres = item.get("genres") or []
    return {
        "id": f"jikan-{kind}-{item.get('mal_id')}",
        "externalId": item.get("mal_id"),
        "title": item.get("title_english") or item.get("title") or item.get("title_japanese") or "Sans titre",
        "type": {"anime": "Anime", "manga": "Manga", "manhwa": "Manhwa", "webtoon": "Webtoon"}[kind],
        "total": item.get("episodes") if kind == "anime" else item.get("chapters"),
        "progress": 0,
        "status": "À commencer",
        "cover": jpg.get("large_image_url") or jpg.get("image_url") or "",
        "year": item.get("year") or ((published.get("from") or "")[:4]),
        "synopsis": item.get("synopsis") or "",
        "score": item.get("score"),
        "genres": [genre.get("name") for genre in genres if genre.get("name")],
        "source": "Jikan",
    }


def load_previous():
    try:
        previous = json.loads(OUTPUT.read_text(encoding="utf-8"))
        catalog = previous.get("catalog", {}) if isinstance(previous, dict) else {}
        return catalog if isinstance(catalog, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def main():
    previous = load_previous()
    result = {}
    failures = []
    for kind in TYPES:
        for sort_mode in SORTS:
            key = f"{kind}:{sort_mode}"
            collected = []
            for page in range(1, PAGES + 1):
                try:
                    payload = request_json(catalog_url(kind, sort_mode, page))
                    rows = payload.get("data") or []
                    collected.extend(map_item(item, kind) for item in rows)
                    print(f"{key} page {page}: {len(rows)} œuvres")
                    if len(rows) < LIMIT:
                        break
                except Exception as exc:
                    print(f"ERREUR {key} page {page}: {exc}")
                    failures.append(key)
                    break
                time.sleep(1.25)
            unique = {str(item["externalId"]): item for item in collected if item.get("externalId")}
            if unique:
                # On garde le catalogue précédent si une requête partielle a échoué.
                if key in failures and len(unique) < LIMIT and previous.get(key):
                    result[key] = previous[key]
                else:
                    result[key] = list(unique.values())
            elif previous.get(key):
                result[key] = previous[key]
            else:
                result[key] = []
    successful = sum(bool(result.get(f"{kind}:{sort_mode}")) for kind in TYPES for sort_mode in SORTS)
    if successful == 0:
        raise RuntimeError("Toutes les catégories sont vides ; le fichier existant est conservé.")
    document = {
        "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "count": sum(len(value) for value in result.values()),
        "catalog": result,
    }
    temp = OUTPUT.with_suffix(".json.tmp")
    temp.write_text(json.dumps(document, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    temp.replace(OUTPUT)
    print(f"Catalogue statique généré : {document['count']} entrées réparties dans {successful} listes.")


if __name__ == "__main__":
    main()
