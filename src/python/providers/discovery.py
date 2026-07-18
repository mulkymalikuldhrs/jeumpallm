import os, json, asyncio, logging, re, time
from typing import Optional
from .base import ProviderConfig, ProviderStatus
from .openai_compat import OpenAICompatibleProvider
from .intelligence import ProviderIntelligence

log = logging.getLogger("jeumpa.discovery")

TEST_PROMPT = {"model": "openai", "messages": [{"role": "user", "content": "hi"}], "max_tokens": 4}

class ProviderDiscovery:
    def __init__(self, registry):
        self.registry = registry
        self.discovered: dict = {}
        self.noauth_endpoints: dict = {}
        self._config = {}
        self.intel = ProviderIntelligence()
        self._probe_history: dict = {}

    def _get_sources(self):
        cfg = self.registry._config or {}
        return cfg.get("discovery", {}).get("sources", [])

    def _get_noauth_candidates(self):
        cfg = self.registry._config or {}
        return cfg.get("discovery", {}).get("noauth_candidates", {})

    async def scan_github_sources(self):
        discovered = {}
        sources = self._get_sources()
        if not sources:
            return discovered
        try:
            import httpx
            async with httpx.AsyncClient(timeout=15) as client:
                for url in sources:
                    try:
                        r = await client.get(url)
                        if r.status_code == 200:
                            text = r.text
                            parsed = self._parse_source(url, text)
                            discovered.update(parsed)
                            if parsed:
                                log.info(f"Discovered {len(parsed)} from {url.split('/')[-1]}")
                    except:
                        continue
        except ImportError:
            log.warn("httpx not available for discovery")
        self.discovered = discovered
        return discovered

    def _parse_source(self, url: str, text: str) -> dict:
        results = {}
        if url.endswith(".json"):
            try:
                data = json.loads(text)
                items = data if isinstance(data, list) else data.get("providers", data.get("data", []))
                for item in items:
                    name = item.get("name", "").lower().replace(" ", "_")
                    base = item.get("base_url", "").rstrip("/")
                    if base and name:
                        models = item.get("models", [])
                        results[name] = {"base_url": base, "type": "openai_compat",
                                         "models": models or ["*"], "noauth": True}
            except:
                pass
        else:
            urls = re.findall(r'https?://[^\s\'\"\)\]>]+', text)
            for bu in urls:
                bu = bu.rstrip("/,.;")
                if not any(k in bu for k in ["openai", "v1/chat", "/v1", "api.", "chat.completions"]):
                    continue
                parts = bu.replace("https://", "").replace("http://", "").split(".")
                name = parts[0] if parts else "unknown"
                name = re.sub(r'^(api-|api\.|www\.)', '', name)
                if name and name not in results:
                    results[name] = {"base_url": bu, "type": "openai_compat", "models": ["*"]}
        return results

    async def probe_endpoint(self, name: str, base_url: str) -> tuple[bool, str, str]:
        import httpx
        paths = ["/chat/completions", "/v1/chat/completions", "/openai/v1/chat/completions"]
        best_url = ""
        best_path = ""
        t0 = time.time()
        for path in paths:
            url = f"{base_url.rstrip('/')}{path}"
            try:
                async with httpx.AsyncClient(timeout=10) as client:
                    r = await client.post(url, json=TEST_PROMPT, headers={"Content-Type": "application/json"})
                    if r.status_code in (200, 201):
                        try:
                            data = r.json()
                            if isinstance(data, dict) and "choices" in data:
                                lat = int((time.time() - t0) * 1000)
                                self._store_probe(name, True, lat, path)
                                return True, path, url
                        except:
                            pass
                    if r.status_code == 429:
                        lat = int((time.time() - t0) * 1000)
                        self._store_probe(name, True, lat, path, "rate_limited")
                        return True, path, url
            except:
                continue
        self._store_probe(name, False, 0, "", "unreachable")
        return False, "", ""

    def _store_probe(self, name: str, ok: bool, lat: int, path: str, error: str = ""):
        if name not in self._probe_history:
            self._probe_history[name] = []
        self._probe_history[name].append({
            "time": time.time(), "ok": ok, "latency_ms": lat,
            "path": path, "error": error,
        })
        if len(self._probe_history[name]) > 50:
            self._probe_history[name] = self._probe_history[name][-50:]

    async def refresh_keylessai_models(self) -> list:
        try:
            import httpx
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get("https://keylessai.thryx.workers.dev/v1/models")
                if r.status_code == 200:
                    data = r.json()
                    models = [m["id"] for m in data.get("data", []) if m.get("id")]
                    log.info(f"Refreshed keylessai models: {len(models)} total")
                    return models
        except Exception as e:
            log.warn(f"KeylessAI model refresh failed: {e}")
        return []

    async def discover_noauth_endpoints(self) -> dict:
        working = {}
        candidates = dict(self._get_noauth_candidates())
        if not candidates:
            return working
        log.info(f"Probing {len(candidates)} no-auth endpoints...")
        for name, info in candidates.items():
            ok, path, found_url = await self.probe_endpoint(name, info["url"])
            if ok:
                models = list(info.get("models", []))
                if name == "keylessai":
                    keyless_models = await self.refresh_keylessai_models()
                    if keyless_models:
                        models = keyless_models
                base_url = found_url.rstrip("/")
                for suf in ["/chat/completions", "/v1/chat/completions"]:
                    if base_url.endswith(suf):
                        base_url = base_url[:-len(suf)]
                        break
                if not base_url:
                    base_url = info["url"]
                working[name] = {**info, "base_url": base_url, "models": models or ["*"]}
                log.info(f"  OK {name} via {path} ({len(models)} models)")
            else:
                log.info(f"  SKIP {name}")
        self.noauth_endpoints = working
        return working

    def integrate_noauth(self, router, endpoints: dict):
        for name, info in endpoints.items():
            if name in self.registry.providers:
                if info.get("models"):
                    log.info(f"  Updating {name}: {len(info['models'])} models")
                    router.update_models(name, info["models"])
                continue
            models = info.get("models", ["*"])
            base_url = info["base_url"].rstrip("/")
            insights = self.intel.analyze_endpoint_metadata(name, base_url, {"models": models, "latency_ms": info.get("latency_ms", 0)})
            priority = insights.get("suggested_priority", info.get("priority", 5))
            cfg = ProviderConfig(name=name, type="openai_compat",
                                 base_url=base_url,
                                 api_key="", models=models,
                                 priority=priority)
            prov = OpenAICompatibleProvider(cfg)
            prov.status = ProviderStatus.ONLINE
            prov.provider_category = self.intel.get_provider_category(name, {"base_url": base_url, "api_key": "", "models": models})
            prov.discovery_source = "noauth_discovery"
            prov.models_listed = [m for m in models if m != "*"]
            prov.detected_capabilities = list(insights.get("capabilities", set()))
            router.register(prov)
            self.registry.providers[name] = prov
            log.info(f"  Added: {name} ({len(models)} models, priority {priority})")

    def integrate_discovered(self, router):
        imported = 0
        for name, info in self.discovered.items():
            if name in self.registry.providers:
                continue
            base_url = info["base_url"].rstrip("/")
            for suf in ["/v1/chat/completions", "/chat/completions", "/openai/v1/chat/completions"]:
                if base_url.endswith(suf):
                    base_url = base_url[:-len(suf)]
                    break
            models = info.get("models", ["*"])
            insights = self.intel.analyze_endpoint_metadata(name, base_url, {"models": models})
            priority = insights.get("suggested_priority", 10)
            cfg = ProviderConfig(name=name, type=info.get("type", "openai_compat"),
                                 base_url=base_url, api_key="",
                                 models=models, priority=priority)
            prov = OpenAICompatibleProvider(cfg)
            prov.provider_category = self.intel.get_provider_category(name, {"base_url": base_url, "api_key": "", "models": models})
            prov.discovery_source = "github_discovery"
            prov.detected_capabilities = list(insights.get("capabilities", set()) if insights else [])
            router.register(prov)
            self.registry.providers[name] = prov
            imported += 1
        if imported:
            log.info(f"Integrated {imported} auto-discovered providers")
        return imported

    def get_discovery_stats(self) -> dict:
        return {
            "discovered_count": len(self.discovered),
            "noauth_count": len(self.noauth_endpoints),
            "probe_history": {n: h[-5:] for n, h in self._probe_history.items()},
        }
