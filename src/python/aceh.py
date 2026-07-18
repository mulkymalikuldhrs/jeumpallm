import asyncio, json, logging, re
from aiohttp import web

log = logging.getLogger("jeumpa.aceh")

GOOGLE_TRANSLATE_URL = "https://translate.googleapis.com/translate_a/single"

COMMON_ACEH_WORDS = frozenset({
    "lon", "lôn", "lòhn", "ulôn", "gata", "droë", "droeneuh", "droe",
    "geu", "ka", "nyoe", "nyan", "teungoh", "peu", "peue", "hana",
    "h'an", "sinoe", "sana", "gop", "gopnyan", "kamo", "kamoe",
    "keu", "bak", "si", "nyang", "meu", "aneuk", "gampong",
    "ureueng", "uroe", "seu", "jeut", "jeuet", "teubiet", "teuka",
    "jak", "beujak", "lagèe", "lage", "saban", "haba", "khaba",
    "galak", "beuna", "beu", "na", "tem", "teum", "bôh", "boh",
    "peugah", "peunoh", "geutanyoe", "awak", "awaknyan", "awaklon",
    "pajan", "pat", "sarée", "bumoe", "seu", "tanyo",
    "jih", "geuh", "nyan", "nyoe", "nibak", "siblah",
    "neu", "neupeu", "neupeugah", "neupeut", "keubit", "kheun",
    "peugot", "peutrôh", "peutrôn", "meuah", "meusyoe",
    "bateu", "teume", "taleu", "jareueng", "bareu", "keureuna",
    "sabab", "meunyoe", "meunyo", "kadang", "sangkut", "dalam",
    "leupah", "le", "trôh", "trôn", "teuka", "teungoh",
    "seulamat", "seulamat", "seunang", "susoh", "susah",
    "seukeue", "seukeu", "reuse", "reu", "neu", "hay",
    # expanded common Aceh lexicon (TIM pass)
    "ta", "kamu", "geutanyan", "peugah", "that", "tak", "peuët", "lheëh",
    "wateë", "tibeë", "teungoh", "röt", "keu", "ngön", "dan", "ta",
    "peuë", "peudöng", "peugöt", "bak", "peu", "padum", "peurumpök",
})

def detect_aceh(text: str) -> float:
    if not text or not isinstance(text, str):
        return 0.0
    words = re.findall(r"[a-zA-Zàáâãäåèéêëìíîïòóôõöùúûüñç\-']+", text.lower())
    if not words:
        return 0.0
    match_count = sum(1 for w in words if w in COMMON_ACEH_WORDS or w.endswith("nyan") or w.endswith("nyoe"))
    return round(match_count / len(words), 4)

async def gt_translate(text: str, src: str = "ace", dst: str = "id") -> dict:
    import urllib.request
    try:
        url = f"{GOOGLE_TRANSLATE_URL}?client=gtx&sl={src}&tl={dst}&dt=t&q={urllib.request.quote(text)}"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        if data and data[0]:
            translation = data[0][0][0]
            original = data[0][0][1]
            return {"text": text, "translation": translation, "original": original, "source": "google_translate", "success": True}
        return {"text": text, "error": "empty_response", "source": "google_translate", "success": False}
    except Exception as e:
        return {"text": text, "error": str(e), "source": "google_translate", "success": False}

async def scrape_kata_webid(word: str) -> dict:
    import urllib.request
    from html import unescape
    try:
        url = f"https://kata.web.id/kamus/aceh-indonesia/arti-kata/{urllib.request.quote(word.lower())}"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            html_content = resp.read().decode("utf-8")
        title_match = re.search(r"<h1[^>]*>(.*?)</h1>", html_content, re.DOTALL)
        title = unescape(title_match.group(1)).strip() if title_match else word
        between = re.search(r"<h1[^>]*>(.*?)</h1>(.*?)Kata\s+terkait", html_content, re.DOTALL | re.IGNORECASE)
        if between:
            definition = re.sub(r"<[^>]+>", " ", between.group(2))
            definition = re.sub(r"&bull;|&#8226;", ",", definition)
            definition = re.sub(r"\s+", " ", unescape(definition)).strip().strip(",").strip()
            definition = re.sub(r"^" + re.escape(word) + r"\s*", "", definition, flags=re.IGNORECASE).strip()
        else:
            definition = ""
        if definition and not definition.startswith("Variations") and not definition.startswith("Kata"):
            return {"word": word, "title": title, "definition": definition, "source": "kata.web.id", "success": True}
        return {"word": word, "title": title, "definition": "", "source": "kata.web.id", "success": False}
    except Exception as e:
        return {"word": word, "error": str(e), "source": "kata.web.id", "success": False}

async def lookup_word(word: str) -> dict:
    trans, dict_entry = await asyncio.gather(
        gt_translate(word, src="ace", dst="id"),
        scrape_kata_webid(word),
        return_exceptions=True,
    )
    result = {"word": word, "source": "none", "success": False}
    if isinstance(trans, dict) and trans.get("success"):
        result["definition"] = trans["translation"]
        result["source"] = "google_translate"
        result["success"] = True
    if isinstance(dict_entry, dict) and dict_entry.get("success"):
        result["dictionary"] = dict_entry["definition"]
        if "definition" not in result:
            result["definition"] = dict_entry["definition"]
            result["source"] = dict_entry["source"]
            result["success"] = True
    if not result.get("success"):
        result["error"] = "all_sources_failed"
    return result

async def translate_text(text: str, src: str = "ace", dst: str = "id") -> dict:
    return await gt_translate(text, src=src, dst=dst)

async def enrich_prompt(messages: list) -> dict:
    all_text = " ".join(m.get("content", "") for m in messages if isinstance(m.get("content"), str))
    confidence = detect_aceh(all_text)
    if confidence < 0.15:
        return {"detected": False, "confidence": confidence, "glossary": None}
    unique_words = set(re.findall(r"[a-zA-Zà-ü]+", all_text.lower()))
    aceh_words = [w for w in unique_words if len(w) > 2 and (w in COMMON_ACEH_WORDS or w.endswith("nyan") or w.endswith("nyoe"))]
    glossary = []
    batch = []
    for i, w in enumerate(aceh_words[:15]):
        batch.append(lookup_word(w))
        if len(batch) >= 5 or i == len(aceh_words[:15]) - 1:
            results = await asyncio.gather(*batch, return_exceptions=True)
            for r in results:
                if isinstance(r, dict) and r.get("success"):
                    glossary.append({"word": r.get("word", "?"), "definition": r.get("definition", r.get("translation", "?"))})
            batch = []
    enrich_lines = []
    for g in glossary[:10]:
        line = f"- {g['word']}: {g['definition']}"
        if g.get("dictionary"):
            line += f" (kamus: {g['dictionary']})"
        enrich_lines.append(line)
    return {
        "detected": True,
        "confidence": confidence,
        "aceh_words_found": aceh_words[:15],
        "glossary": glossary,
        "enrichment": (
            "Bahasa Aceh terdeteksi dalam pesan pengguna. "
            "Berikut glosarium kata-kata Aceh yang ditemukan:\n" +
            "\n".join(enrich_lines) +
            "\nGunakan konteks ini untuk membantu menerjemahkan dan merespons dengan benar."
        )
    }

async def handle_aceh_detect(request):
    try:
        body = await request.json()
    except:
        return web.json_response({"error": "invalid_json"}, status=400)
    text = body.get("text", "")
    if not text:
        return web.json_response({"error": "text_required"}, status=400)
    confidence = detect_aceh(text)
    words = re.findall(r"[a-zA-Zà-ü\-']+", text.lower())
    aceh_matches = [w for w in words if w in COMMON_ACEH_WORDS or w.endswith("nyan") or w.endswith("nyoe")]
    return web.json_response({
        "text": text,
        "detected": confidence >= 0.15,
        "confidence": confidence,
        "matches_found": len(aceh_matches),
        "aceh_words": aceh_matches[:20],
    })

async def handle_aceh_lookup(request):
    word = request.query.get("word", "")
    if not word:
        return web.json_response({"error": "word_required"}, status=400)
    result = await lookup_word(word)
    status = 200 if result.get("success") else 404
    return web.json_response(result, status=status)

async def handle_aceh_translate(request):
    try:
        body = await request.json()
    except:
        return web.json_response({"error": "invalid_json"}, status=400)
    text = body.get("text", "")
    src = body.get("source", "ace")
    dst = body.get("target", "id")
    if not text:
        return web.json_response({"error": "text_required"}, status=400)
    result = await translate_text(text, src=src, dst=dst)
    status = 200 if result.get("success") else 502
    return web.json_response(result, status=status)

async def handle_aceh_enrich(request):
    try:
        body = await request.json()
    except:
        return web.json_response({"error": "invalid_json"}, status=400)
    messages = body.get("messages", [])
    if not messages:
        return web.json_response({"error": "messages_required"}, status=400)
    result = await enrich_prompt(messages)
    return web.json_response(result)

async def handle_aceh_glossary(request):
    return web.json_response({
        "language": "Aceh (Bahasa Aceh)",
        "code": "ace",
        "total_words": len(COMMON_ACEH_WORDS),
        "sources": [
            {"name": "Google Translate API", "url": GOOGLE_TRANSLATE_URL, "status": "free_no_key"},
            {"name": "kata.web.id", "url": "https://kata.web.id/kamus/aceh-indonesia/", "status": "scraping"},
        ],
        "endpoints": {
            "detect": "POST /v1/aceh/detect",
            "lookup": "GET /v1/aceh/lookup?word=",
            "translate": "POST /v1/aceh/translate",
            "enrich": "POST /v1/aceh/enrich",
            "glossary": "GET /v1/aceh/glossary",
        },
    })

def setup_aceh_routes(app):
    prefix = "/v1/aceh"
    app.router.add_post(f"{prefix}/detect", handle_aceh_detect)
    app.router.add_get(f"{prefix}/lookup", handle_aceh_lookup)
    app.router.add_post(f"{prefix}/translate", handle_aceh_translate)
    app.router.add_post(f"{prefix}/enrich", handle_aceh_enrich)
    app.router.add_get(f"{prefix}/glossary", handle_aceh_glossary)
    log.info("Aceh module routes registered")
