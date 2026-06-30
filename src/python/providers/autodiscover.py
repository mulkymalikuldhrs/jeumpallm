import os, json, re, time, asyncio, logging, urllib.parse
from typing import Optional
from .base import ProviderConfig, ProviderStatus
from .openai_compat import OpenAICompatibleProvider
from .intelligence import ProviderIntelligence

log = logging.getLogger("jeumpa.autodiscover")

TEST_PROMPT = {"model": "test", "messages": [{"role": "user", "content": "hi"}], "max_tokens": 4}
PROBE_TIMEOUT = 15

AUTODISCOVER_SOURCES = [
    "https://raw.githubusercontent.com/cheahjs/free-llm-api-resources/main/data.json",
    "https://raw.githubusercontent.com/open-free-llm-api/awesome-free-llm-apis/main/README.md",
    "https://raw.githubusercontent.com/bradAGI/awesome-free-inference/main/README.md",
    "https://raw.githubusercontent.com/nejib1/Free-LLM/main/README.md",
    "https://raw.githubusercontent.com/lordbasilaiassistant-sudo/keylessai/main/README.md",
    "https://raw.githubusercontent.com/OEvortex/llm4free/main/README.md",
    "https://raw.githubusercontent.com/zhuima/awesome-free-llm-api/main/README.md",
    "https://raw.githubusercontent.com/nicepkg/awesome-free-api/main/README.md",
    "https://huggingface.co/api/models?pipeline_tag=text-generation&sort=downloads&limit=50",
]

HF_INFERENCE_ENDPOINTS = [
    "https://api-inference.huggingface.co/models/{model}/v1/chat/completions",
    "https://api-inference.huggingface.co/v1/chat/completions",
]

KNOWN_FREE_ENDPOINTS = [
    {"name": "pollinations", "url": "https://text.pollinations.ai/openai/v1", "known": True},
    {"name": "keylessai", "url": "https://keylessai.thryx.workers.dev/v1", "known": True},
    {"name": "ovhcloud_anon", "url": "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1", "known": True},
    {"name": "api_airforce", "url": "https://api.airforce/v1", "known": True},
    {"name": "g4f_noauth", "url": "https://g4f.uno/v1", "known": False},
    {"name": "freeai", "url": "https://freeai.one/v1", "known": False},
    {"name": "chatglm_free", "url": "https://chatglm-free-api.vercel.app/v1", "known": False},
    {"name": "deepseek_free", "url": "https://deepseek-free-api.vercel.app/v1", "known": False},
    {"name": "gpt_free", "url": "https://gpt-free-api.vercel.app/v1", "known": False},
    {"name": "qwen_free", "url": "https://qwen-free-api.vercel.app/v1", "known": False},
    {"name": "kimi_free", "url": "https://kimi-free-api.vercel.app/v1", "known": False},
    {"name": "spark_free", "url": "https://spark-free-api.vercel.app/v1", "known": False},
    {"name": "emily_free", "url": "https://emily.free.one/v1", "known": False},
    {"name": "nova_free", "url": "https://nova-ai-free.vercel.app/v1", "known": False},
    {"name": "oracle_free", "url": "https://generativeai.oracle.com/v1", "known": False},
    {"name": "replicate_free", "url": "https://api.replicate.com/v1", "known": False},
    {"name": "lepton_free", "url": "https://lepton.ai/api/v1", "known": False},
]

class AutoDiscover:
    def __init__(self, registry, router):
        self.registry = registry
        self.router = router
        self.intel = ProviderIntelligence(router, registry)
        self.discovered_providers: dict = {}
        self.discovered_models: dict = {}
        self.probe_history: dict = {}
        self._scan_count = 0
        self._last_scan_time = 0

    async def scan_all_sources(self) -> dict:
        self._scan_count += 1
        self._last_scan_time = time.time()
        all_discovered = {}

        tasks = [
            self.scan_github_sources(),
            self.scan_known_endpoints(),
            self.scan_huggingface_models(),
            self.scan_community_sources(),
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        for result in results:
            if isinstance(result, dict):
                for k, v in result.items():
                    if k not in all_discovered:
                        all_discovered[k] = v

        self.discovered_providers = all_discovered
        log.info(f"Scan #{self._scan_count}: discovered {len(all_discovered)} new candidates")
        return all_discovered

    async def scan_github_sources(self) -> dict:
        discovered = {}
        try:
            import httpx
            async with httpx.AsyncClient(timeout=20) as client:
                for url in AUTODISCOVER_SOURCES:
                    try:
                        r = await client.get(url, headers={"User-Agent": "JeumpaLLM/1.0"})
                        if r.status_code == 200:
                            parsed = self._parse_source(url, r.text)
                            for k, v in parsed.items():
                                if k not in discovered:
                                    discovered[k] = v
                            if parsed:
                                log.info(f"  GitHub source '{url.split('/')[-1]}': +{len(parsed)}")
                    except Exception as e:
                        continue
        except ImportError:
            log.warn("httpx not available for autodiscovery")
        return discovered

    def _parse_source(self, url: str, text: str) -> dict:
        results = {}
        if url.endswith(".json"):
            try:
                data = json.loads(text)
                items = data if isinstance(data, list) else data.get("providers", data.get("data", []))
                for item in items:
                    name = item.get("name", "").lower().replace(" ", "_").replace("/", "_")
                    base = item.get("base_url", "").rstrip("/")
                    if not base:
                        base = item.get("url", "").rstrip("/")
                    if base and name:
                        models = item.get("models", [])
                        if isinstance(models, str):
                            models = [models]
                        results[name] = {
                            "base_url": base,
                            "type": "openai_compat",
                            "models": models,
                            "api_key": item.get("api_key", ""),
                            "needs_key": bool(item.get("api_key")),
                            "source": url,
                        }
            except:
                pass
        else:
            urls = re.findall(r'https?://[^\s\'\"\)\]>]+', text)
            for bu in urls:
                bu = bu.rstrip("/,.;")
                if not any(k in bu for k in ["openai", "v1/chat", "/v1", "api.", "chat.completions", "inference", "/models/"]):
                    continue
                if any(block in bu for block in ["github.com", "gitlab.com", "youtube.com", "twitter.com", "readthedocs", "swagger", ".herokuapp.com", "vercel.app/docs"]):
                    continue
                if any(k in bu for k in ["bible-api", "thecatapi", "thedogapi", "charityapi", "holidayapi", "markerapi", "blocklottos", "exchangeratesapi", "blynkapi", "screenshotapi", "amazonscraperapi", "calapi", "gita-api", "wordcloudapi", "urlhaus-api", "ghibliapi", "mangapi", "animenewsnetwork", "theaxolotlapi", "docs.apiary", "circleci.com/docs", "huobiapi.github"]):
                    continue
                parts = bu.replace("https://", "").replace("http://", "").split(".")
                name = parts[0] if parts else "unknown"
                name = re.sub(r'^(api-|api\.|www\.)', '', name)
                if name and name not in results and len(name) > 2:
                    results[name] = {
                        "base_url": bu,
                        "type": "openai_compat",
                        "models": [],
                        "source": url,
                    }
        return results

    async def scan_known_endpoints(self) -> dict:
        discovered = {}
        for ep in KNOWN_FREE_ENDPOINTS:
            name = ep["name"]
            if name in self.registry.providers:
                continue
            discovered[name] = {
                "base_url": ep["url"],
                "type": "openai_compat",
                "models": [],
                "known": True,
                "source": "builtin_list",
            }
        return discovered

    async def scan_huggingface_models(self) -> dict:
        discovered = {}
        try:
            import httpx
            async with httpx.AsyncClient(timeout=20) as client:
                r = await client.get(
                    "https://huggingface.co/api/models",
                    params={"pipeline_tag": "text-generation", "sort": "downloads", "direction": -1, "limit": 30},
                )
                if r.status_code == 200:
                    models = r.json()
                    for model in models:
                        mid = model.get("id", "")
                        if not mid:
                            continue
                        if any(block in mid.lower() for block in ["toxic", "nsfw", "uncensored"]):
                            continue
                        downloads = model.get("downloads", 0)
                        if downloads < 1000:
                            continue
                        name = f"hf_{mid.split('/')[-1].lower()}"
                        name = re.sub(r'[^a-z0-9_]', '_', name)[:40]
                        if name not in discovered:
                            discovered[name] = {
                                "base_url": f"https://api-inference.huggingface.co/models/{mid}",
                                "type": "openai_compat",
                                "models": [mid],
                                "hf_model": mid,
                                "source": "huggingface",
                                "downloads": downloads,
                            }
        except: pass
        return discovered

    async def scan_community_sources(self) -> dict:
        discovered = {}
        community_urls = [
            "https://raw.githubusercontent.com/nicepkg/awesome-free-api/main/README.md",
        ]
        try:
            import httpx
            async with httpx.AsyncClient(timeout=15) as client:
                for url in community_urls:
                    try:
                        r = await client.get(url)
                        if r.status_code == 200:
                            parsed = self._parse_source(url, r.text)
                            discovered.update(parsed)
                    except: pass
        except: pass
        return discovered

    async def probe_endpoint(self, name: str, base_url: str, api_key: str = "") -> dict:
        result = {"name": name, "base_url": base_url, "working": False, "models": [], "latency_ms": 0}
        import httpx
        test_paths = [
            "/v1/chat/completions",
            "/chat/completions",
            "/openai/v1/chat/completions",
        ]
        found_url = ""
        found_path = ""
        for path in test_paths:
            url = f"{base_url.rstrip('/')}{path}"
            t0 = time.time()
            try:
                headers = {"Content-Type": "application/json", "User-Agent": "JeumpaLLM/1.0"}
                if api_key:
                    headers["Authorization"] = f"Bearer {api_key}"
                async with httpx.AsyncClient(timeout=PROBE_TIMEOUT) as client:
                    r = await client.post(url, json=TEST_PROMPT, headers=headers)
                    lat = int((time.time() - t0) * 1000)
                    result["latency_ms"] = lat
                    if r.status_code in (200, 201):
                        try:
                            data = r.json()
                            if isinstance(data, dict) and "choices" in data:
                                result["working"] = True
                                found_url = url
                                found_path = path
                                break
                        except: pass
                    elif r.status_code == 429:
                        result["working"] = True
                        result["rate_limited"] = True
                        found_url = url
                        found_path = path
                        break
                    elif r.status_code == 401:
                        result["needs_auth"] = True
                    elif r.status_code == 404:
                        continue
            except asyncio.TimeoutError:
                continue
            except Exception as e:
                result.setdefault("errors", []).append(str(e))
                continue

        if found_url:
            result["working"] = True
            result["path"] = found_path
            result["endpoint_url"] = found_url
            models = await self.list_models(name, found_url, api_key)
            if models:
                result["models"] = models
            try:
                result["insights"] = self.intel.analyze_endpoint_metadata(name, base_url, result)
            except: pass

        self._store_probe(name, result)
        return result

    async def list_models(self, name: str, endpoint_url: str, api_key: str = "") -> list:
        base = endpoint_url.rstrip("/")
        for suf in ["/chat/completions", "/v1/chat/completions"]:
            if base.endswith(suf):
                base = base[:-len(suf)]
                break
        models_url = f"{base}/models" if "/v1" in base else f"{base}/v1/models"
        try:
            import httpx
            headers = {"User-Agent": "JeumpaLLM/1.0"}
            if api_key:
                headers["Authorization"] = f"Bearer {api_key}"
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get(models_url, headers=headers)
                if r.status_code == 200:
                    data = r.json()
                    raw = data.get("data", data)
                    if isinstance(raw, list):
                        models = []
                        for m in raw:
                            if isinstance(m, dict):
                                mid = m.get("id", m.get("model", ""))
                            elif isinstance(m, str):
                                mid = m
                            else:
                                continue
                            if mid and mid not in models:
                                models.append(mid)
                        if models:
                            log.info(f"  {name}: listed {len(models)} models from /models")
                            return models
                        return []
                    if isinstance(raw, dict):
                        return [k for k in raw.keys() if k != "object"]
                    return []
        except: pass

        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get(f"{base}/models", headers=headers)
                if r.status_code == 200:
                    data = r.json()
                    raw = data.get("data", data)
                    if isinstance(raw, list):
                        models = [m.get("id", "") if isinstance(m, dict) else m for m in raw if (isinstance(m, dict) and m.get("id")) or isinstance(m, str)]
                        models = [m for m in models if m]
                        if models:
                            log.info(f"  {name}: listed {len(models)} models from /models (alt)")
                            return models
        except: pass
        return []

    def _store_probe(self, name: str, result: dict):
        if name not in self.probe_history:
            self.probe_history[name] = []
        self.probe_history[name].append({
            "time": time.time(),
            "working": result.get("working", False),
            "latency_ms": result.get("latency_ms", 0),
            "models": result.get("models", []),
            "error": result.get("error"),
        })
        if len(self.probe_history[name]) > 50:
            self.probe_history[name] = self.probe_history[name][-50:]

    async def probe_all_candidates(self, candidates: dict, max_concurrent: int = 10) -> dict:
        working = {}
        semaphore = asyncio.Semaphore(max_concurrent)

        async def _probe_one(name, info):
            async with semaphore:
                result = await self.probe_endpoint(name, info["base_url"], info.get("api_key", ""))
                if result.get("working"):
                    return name, result
                return None

        tasks = [_probe_one(n, i) for n, i in candidates.items()]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        for r in results:
            if isinstance(r, tuple) and r[0]:
                name, result = r
                working[name] = result
                log.info(f"  ✅ {name} — {result.get('latency_ms', 0)}ms, {len(result.get('models', []))} models")

        log.info(f"Probe complete: {len(working)}/{len(candidates)} working")
        return working

    async def continuous_discovery(self, interval: int = 1800):
        while True:
            await asyncio.sleep(interval)
            log.info("AutoDiscovery: periodic scan starting...")
            try:
                candidates = await self.scan_all_sources()
                if candidates:
                    working = await self.probe_all_candidates(candidates)
                    if working:
                        from .integrator import AutoIntegrator
                        integrator = AutoIntegrator(self.registry, self.router)
                        integrated = integrator.integrate(working)
                        if integrated:
                            log.info(f"AutoDiscovery: integrated {integrated} new providers")
            except Exception as e:
                log.warn(f"AutoDiscovery cycle error: {e}")

    def get_stats(self) -> dict:
        return {
            "scan_count": self._scan_count,
            "last_scan": self._last_scan_time,
            "probed_total": len(self.probe_history),
            "probed_working": sum(1 for h in self.probe_history.values() if h and h[-1].get("working")),
            "discovered_candidates": len(self.discovered_providers),
            "discovered_models": sum(len(v.get("models", [])) for v in self.discovered_models.values()),
        }

    def get_probe_history(self, name: str = None, limit: int = 10) -> dict:
        if name:
            return {name: self.probe_history.get(name, [])[-limit:]}
        return {n: h[-limit:] for n, h in self.probe_history.items()}
