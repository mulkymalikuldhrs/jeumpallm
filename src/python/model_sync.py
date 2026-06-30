import os, time, asyncio, logging
from dataclasses import dataclass, field
from typing import Optional

log = logging.getLogger("jeumpa.model_sync")

@dataclass
class ModelInfo:
    id: str
    name: str
    provider: str
    capabilities: list[str] = field(default_factory=list)
    context_length: int = 8192
    pricing: dict = field(default_factory=dict)
    speed_tier: str = "standard"
    is_free: bool = False
    is_available: bool = True
    last_checked: float = 0.0

@dataclass
class SyncRecord:
    timestamp: float
    status: str
    models_added: int = 0
    models_removed: int = 0
    models_updated: int = 0
    errors: list = field(default_factory=list)

PROVIDER_ENDPOINTS = {
    "groq": {
        "url": "https://api.groq.com/openai/v1/models",
        "auth": "Bearer",
    },
    "openai": {
        "url": "https://api.openai.com/v1/models",
        "auth": "Bearer",
    },
    "anthropic": {
        "url": "https://api.anthropic.com/v1/models",
        "auth": "Bearer",
    },
    "google": {
        "url": "https://generativelanguage.googleapis.com/v1/models",
        "auth": "Bearer",
    },
    "deepseek": {
        "url": "https://api.deepseek.com/v1/models",
        "auth": "Bearer",
    },
    "mistral": {
        "url": "https://api.mistral.ai/v1/models",
        "auth": "Bearer",
    },
    "cohere": {
        "url": "https://api.cohere.ai/v1/models",
        "auth": "Bearer",
    },
    "together": {
        "url": "https://api.together.xyz/v1/models",
        "auth": "Bearer",
    },
    "perplexity": {
        "url": "https://api.perplexity.ai/v1/models",
        "auth": "Bearer",
    },
    "xai": {
        "url": "https://api.x.ai/v1/models",
        "auth": "Bearer",
    },
}

KNOWN_MODELS = [
    ModelInfo(id="gpt-4o", name="GPT-4o", provider="openai", capabilities=["chat", "vision", "json"], context_length=128000, pricing={"input": 2.50, "output": 10.00, "per": "1M_tokens"}, speed_tier="fast", is_free=False),
    ModelInfo(id="gpt-4o-mini", name="GPT-4o Mini", provider="openai", capabilities=["chat", "vision", "json"], context_length=128000, pricing={"input": 0.15, "output": 0.60, "per": "1M_tokens"}, speed_tier="fast", is_free=False),
    ModelInfo(id="gpt-4-turbo", name="GPT-4 Turbo", provider="openai", capabilities=["chat", "vision", "json"], context_length=128000, pricing={"input": 10.00, "output": 30.00, "per": "1M_tokens"}, speed_tier="fast", is_free=False),
    ModelInfo(id="gpt-4", name="GPT-4", provider="openai", capabilities=["chat"], context_length=8192, pricing={"input": 30.00, "output": 60.00, "per": "1M_tokens"}, speed_tier="standard", is_free=False),
    ModelInfo(id="gpt-3.5-turbo", name="GPT-3.5 Turbo", provider="openai", capabilities=["chat"], context_length=16385, pricing={"input": 0.50, "output": 1.50, "per": "1M_tokens"}, speed_tier="fast", is_free=False),
    ModelInfo(id="o1", name="o1", provider="openai", capabilities=["chat", "reasoning"], context_length=200000, pricing={"input": 15.00, "output": 60.00, "per": "1M_tokens"}, speed_tier="standard", is_free=False),
    ModelInfo(id="o1-mini", name="o1 Mini", provider="openai", capabilities=["chat", "reasoning"], context_length=128000, pricing={"input": 1.10, "output": 4.40, "per": "1M_tokens"}, speed_tier="standard", is_free=False),
    ModelInfo(id="o3-mini", name="o3 Mini", provider="openai", capabilities=["chat", "reasoning"], context_length=200000, pricing={"input": 1.10, "output": 4.40, "per": "1M_tokens"}, speed_tier="fast", is_free=False),
    ModelInfo(id="claude-3-5-sonnet-20241022", name="Claude 3.5 Sonnet", provider="anthropic", capabilities=["chat", "vision", "code"], context_length=200000, pricing={"input": 3.00, "output": 15.00, "per": "1M_tokens"}, speed_tier="fast", is_free=False),
    ModelInfo(id="claude-3-5-haiku-20241022", name="Claude 3.5 Haiku", provider="anthropic", capabilities=["chat", "vision"], context_length=200000, pricing={"input": 0.80, "output": 4.00, "per": "1M_tokens"}, speed_tier="fast", is_free=False),
    ModelInfo(id="claude-3-opus-20240229", name="Claude 3 Opus", provider="anthropic", capabilities=["chat", "vision"], context_length=200000, pricing={"input": 15.00, "output": 75.00, "per": "1M_tokens"}, speed_tier="standard", is_free=False),
    ModelInfo(id="claude-3-sonnet-20240229", name="Claude 3 Sonnet", provider="anthropic", capabilities=["chat", "vision"], context_length=200000, pricing={"input": 3.00, "output": 15.00, "per": "1M_tokens"}, speed_tier="standard", is_free=False),
    ModelInfo(id="claude-3-haiku-20240307", name="Claude 3 Haiku", provider="anthropic", capabilities=["chat", "vision"], context_length=200000, pricing={"input": 0.25, "output": 1.25, "per": "1M_tokens"}, speed_tier="fast", is_free=False),
    ModelInfo(id="gemini-1.5-pro", name="Gemini 1.5 Pro", provider="google", capabilities=["chat", "vision", "code", "audio"], context_length=2000000, pricing={"input": 1.25, "output": 5.00, "per": "1M_tokens"}, speed_tier="fast", is_free=False),
    ModelInfo(id="gemini-1.5-flash", name="Gemini 1.5 Flash", provider="google", capabilities=["chat", "vision", "audio"], context_length=1000000, pricing={"input": 0.075, "output": 0.30, "per": "1M_tokens"}, speed_tier="fast", is_free=False),
    ModelInfo(id="gemini-2.0-flash", name="Gemini 2.0 Flash", provider="google", capabilities=["chat", "vision", "audio"], context_length=1000000, pricing={"input": 0.10, "output": 0.40, "per": "1M_tokens"}, speed_tier="fast", is_free=True),
    ModelInfo(id="gemini-2.0-flash-lite-preview-02-05", name="Gemini 2.0 Flash Lite", provider="google", capabilities=["chat"], context_length=1000000, pricing={"input": 0.075, "output": 0.30, "per": "1M_tokens"}, speed_tier="fast", is_free=True),
    ModelInfo(id="llama-3.3-70b-versatile", name="Llama 3.3 70B", provider="groq", capabilities=["chat", "code"], context_length=128000, pricing={"input": 0.59, "output": 0.79, "per": "1M_tokens"}, speed_tier="fast", is_free=True),
    ModelInfo(id="llama-3.1-8b-instant", name="Llama 3.1 8B Instant", provider="groq", capabilities=["chat"], context_length=128000, pricing={"input": 0.05, "output": 0.08, "per": "1M_tokens"}, speed_tier="fast", is_free=True),
    ModelInfo(id="mixtral-8x7b-32768", name="Mixtral 8x7B", provider="groq", capabilities=["chat"], context_length=32768, pricing={"input": 0.24, "output": 0.24, "per": "1M_tokens"}, speed_tier="fast", is_free=True),
    ModelInfo(id="deepseek-chat", name="DeepSeek V3", provider="deepseek", capabilities=["chat", "code"], context_length=65536, pricing={"input": 0.27, "output": 1.10, "per": "1M_tokens"}, speed_tier="fast", is_free=False),
    ModelInfo(id="deepseek-reasoner", name="DeepSeek R1", provider="deepseek", capabilities=["chat", "reasoning", "code"], context_length=65536, pricing={"input": 0.55, "output": 2.19, "per": "1M_tokens"}, speed_tier="standard", is_free=False),
    ModelInfo(id="mistral-large-latest", name="Mistral Large", provider="mistral", capabilities=["chat", "code"], context_length=128000, pricing={"input": 2.00, "output": 6.00, "per": "1M_tokens"}, speed_tier="fast", is_free=False),
    ModelInfo(id="mistral-small-latest", name="Mistral Small", provider="mistral", capabilities=["chat"], context_length=32000, pricing={"input": 0.20, "output": 0.60, "per": "1M_tokens"}, speed_tier="fast", is_free=False),
    ModelInfo(id="codestral-latest", name="Codestral", provider="mistral", capabilities=["code"], context_length=32000, pricing={"input": 1.00, "output": 3.00, "per": "1M_tokens"}, speed_tier="fast", is_free=False),
    ModelInfo(id="command-r-plus-08-2024", name="Command R+", provider="cohere", capabilities=["chat", "code", "rag"], context_length=128000, pricing={"input": 2.50, "output": 10.00, "per": "1M_tokens"}, speed_tier="standard", is_free=False),
    ModelInfo(id="command-r-08-2024", name="Command R", provider="cohere", capabilities=["chat", "rag"], context_length=128000, pricing={"input": 0.15, "output": 0.60, "per": "1M_tokens"}, speed_tier="standard", is_free=False),
    ModelInfo(id="togethercomputer/llama-3.3-70b-chat", name="Llama 3.3 70B Chat", provider="together", capabilities=["chat", "code"], context_length=128000, pricing={"input": 0.59, "output": 0.79, "per": "1M_tokens"}, speed_tier="fast", is_free=False),
    ModelInfo(id="togethercomputer/llama-3.1-405b-chat", name="Llama 3.1 405B Chat", provider="together", capabilities=["chat", "code"], context_length=128000, pricing={"input": 2.75, "output": 2.75, "per": "1M_tokens"}, speed_tier="standard", is_free=False),
    ModelInfo(id="sonar-pro", name="Sonar Pro", provider="perplexity", capabilities=["chat", "search"], context_length=200000, pricing={"input": 1.00, "output": 1.00, "per": "1M_tokens"}, speed_tier="fast", is_free=False),
    ModelInfo(id="sonar", name="Sonar", provider="perplexity", capabilities=["chat", "search"], context_length=127000, pricing={"input": 0.80, "output": 0.80, "per": "1M_tokens"}, speed_tier="fast", is_free=False),
    ModelInfo(id="grok-2", name="Grok 2", provider="xai", capabilities=["chat"], context_length=131072, pricing={"input": 2.00, "output": 10.00, "per": "1M_tokens"}, speed_tier="standard", is_free=False),
    ModelInfo(id="grok-2-mini", name="Grok 2 Mini", provider="xai", capabilities=["chat"], context_length=131072, pricing={"input": 0.30, "output": 1.50, "per": "1M_tokens"}, speed_tier="fast", is_free=False),
    ModelInfo(id="qwen-2.5-72b-chat", name="Qwen 2.5 72B Chat", provider="openai", capabilities=["chat", "code"], context_length=128000, pricing={"input": 0.90, "output": 0.90, "per": "1M_tokens"}, speed_tier="fast", is_free=True),
    ModelInfo(id="llama-3.2-3b-chat", name="Llama 3.2 3B Chat", provider="openai", capabilities=["chat"], context_length=128000, pricing={"input": 0.06, "output": 0.06, "per": "1M_tokens"}, speed_tier="fast", is_free=True),
    ModelInfo(id="llama-3.2-1b-chat", name="Llama 3.2 1B Chat", provider="openai", capabilities=["chat"], context_length=128000, pricing={"input": 0.04, "output": 0.04, "per": "1M_tokens"}, speed_tier="fast", is_free=True),
    ModelInfo(id="llama-3.2-11b-vision", name="Llama 3.2 11B Vision", provider="openai", capabilities=["chat", "vision"], context_length=128000, pricing={"input": 0.18, "output": 0.18, "per": "1M_tokens"}, speed_tier="fast", is_free=True),
    ModelInfo(id="llama-3.2-90b-vision", name="Llama 3.2 90B Vision", provider="openai", capabilities=["chat", "vision"], context_length=128000, pricing={"input": 0.90, "output": 0.90, "per": "1M_tokens"}, speed_tier="standard", is_free=True),
    ModelInfo(id="qwen-2.5-coder-32b", name="Qwen 2.5 Coder 32B", provider="openai", capabilities=["code"], context_length=128000, pricing={"input": 0.90, "output": 0.90, "per": "1M_tokens"}, speed_tier="fast", is_free=True),
    ModelInfo(id="phi-3.5-mini-4k", name="Phi 3.5 Mini", provider="openai", capabilities=["chat"], context_length=4096, pricing={"input": 0.20, "output": 0.20, "per": "1M_tokens"}, speed_tier="fast", is_free=True),
    ModelInfo(id="nvidia/llama-3.1-nemotron-70b", name="Nemotron 70B", provider="openai", capabilities=["chat"], context_length=128000, pricing={"input": 0.50, "output": 0.50, "per": "1M_tokens"}, speed_tier="standard", is_free=True),
]

class ModelSyncManager:
    def __init__(self, interval_seconds=3600):
        self.interval_seconds = interval_seconds
        self.models: dict[str, ModelInfo] = {}
        self.sync_history: list[SyncRecord] = []
        self._sync_task: Optional[asyncio.Task] = None
        self._running = False
        self._lock = asyncio.Lock()
        self._env_keys: dict[str, str] = {}

        for m in KNOWN_MODELS:
            self.models[m.id] = m

    def _load_env_keys(self):
        keys = {}
        try:
            from jeumpa_paths import load_env_file
            keys = load_env_file()
        except ImportError:
            pass
        for env_path in [os.path.expanduser("~/.env")]:
            if os.path.exists(env_path):
                with open(env_path) as f:
                    for line in f:
                        line = line.strip()
                        if "=" in line and not line.startswith("#"):
                            k, v = line.split("=", 1)
                            keys[k.strip()] = v.strip().strip("'").strip('"')
        for k, v in os.environ.items():
            keys[k] = v
        self._env_keys = keys
        return keys

    def _get_api_key(self, provider_name: str) -> str:
        if not self._env_keys:
            self._load_env_keys()
        env_var = f"{provider_name.upper()}_API_KEY"
        if env_var in self._env_keys:
            return self._env_keys[env_var]
        upper = {"groq": "GROQ_API_KEY", "openai": "OPENAI_API_KEY", "anthropic": "ANTHROPIC_API_KEY", "google": "GOOGLE_API_KEY"}
        fallback = upper.get(provider_name)
        if fallback and fallback in self._env_keys:
            return self._env_keys[fallback]
        return ""

    async def sync_all_providers(self) -> SyncRecord:
        t0 = time.time()
        errors = []
        models_added = 0
        models_removed = 0
        models_updated = 0

        before_ids = set(self.models.keys())

        results = await asyncio.gather(
            *[self.sync_provider(name) for name in PROVIDER_ENDPOINTS],
            return_exceptions=True
        )

        for provider_name, result in zip(PROVIDER_ENDPOINTS.keys(), results):
            if isinstance(result, Exception):
                errors.append(f"{provider_name}: {result}")
                continue
            if isinstance(result, list):
                for model in result:
                    existing = self.models.get(model.id)
                    if existing:
                        if existing.last_checked < model.last_checked:
                            self.models[model.id] = model
                            models_updated += 1
                    else:
                        self.models[model.id] = model
                        models_added += 1

        after_ids = set(self.models.keys())
        models_removed = len(before_ids - after_ids)

        record = SyncRecord(
            timestamp=t0,
            status="success" if not errors else "partial",
            models_added=models_added,
            models_removed=models_removed,
            models_updated=models_updated,
            errors=errors,
        )
        self.sync_history.append(record)
        if len(self.sync_history) > 10:
            self.sync_history = self.sync_history[-10:]

        log.info(f"Model sync: +{models_added} ~{models_updated} -{models_removed} | {len(errors)} errors")
        return record

    async def sync_provider(self, provider_name: str) -> list[ModelInfo]:
        endpoint = PROVIDER_ENDPOINTS.get(provider_name)
        if not endpoint:
            return []

        api_key = self._get_api_key(provider_name)
        if not api_key:
            log.debug(f"No API key for {provider_name}, skipping sync")
            return []

        try:
            import httpx
            headers = {
                "Authorization": f"{endpoint['auth']} {api_key}",
                "User-Agent": "JeumpaLLM/1.0",
            }
            async with httpx.AsyncClient(timeout=15) as client:
                r = await client.get(endpoint["url"], headers=headers)

            if r.status_code != 200:
                log.debug(f"{provider_name} models endpoint returned {r.status_code}")
                return []

            data = r.json()
            raw_models = data.get("data", data.get("models", []))
            if not isinstance(raw_models, list):
                raw_models = [raw_models]

            now = time.time()
            models = []
            for m in raw_models:
                if isinstance(m, str):
                    mid = m
                elif isinstance(m, dict):
                    mid = m.get("id", m.get("name", ""))
                else:
                    continue
                if not mid:
                    continue
                models.append(ModelInfo(
                    id=mid,
                    name=mid.split("/")[-1] if "/" in mid else mid,
                    provider=provider_name,
                    last_checked=now,
                ))

            log.info(f"{provider_name}: synced {len(models)} models")
            return models

        except Exception as e:
            log.warn(f"{provider_name} sync failed: {e}")
            return []

    def get_all_models(self) -> list[ModelInfo]:
        return list(self.models.values())

    def get_models_by_provider(self, provider: str) -> list[ModelInfo]:
        return [m for m in self.models.values() if m.provider == provider]

    def get_models_by_capability(self, capability: str) -> list[ModelInfo]:
        return [m for m in self.models.values() if capability in m.capabilities]

    def get_available_models(self) -> list[ModelInfo]:
        return [m for m in self.models.values() if m.is_available]

    def get_sync_history(self, limit=10) -> list[SyncRecord]:
        return self.sync_history[-limit:]

    def search_models(self, query: str) -> list[ModelInfo]:
        q = query.lower()
        return [m for m in self.models.values()
                if q in m.id.lower() or q in m.name.lower() or q in m.provider.lower()]

    def add_model(self, model: ModelInfo) -> ModelInfo:
        self.models[model.id] = model
        return model

    def update_model(self, model_id: str, updates: dict) -> Optional[ModelInfo]:
        model = self.models.get(model_id)
        if not model:
            return None
        for k, v in updates.items():
            if hasattr(model, k):
                setattr(model, k, v)
        return model

    def remove_model(self, model_id: str) -> bool:
        if model_id in self.models:
            del self.models[model_id]
            return True
        return False

    def start_periodic_sync(self):
        if self._running:
            return
        self._running = True
        self._sync_task = asyncio.create_task(self._periodic_sync_loop())
        log.info(f"Periodic model sync started (every {self.interval_seconds}s)")

    def stop_periodic_sync(self):
        self._running = False
        if self._sync_task and not self._sync_task.done():
            self._sync_task.cancel()
            self._sync_task = None
        log.info("Periodic model sync stopped")

    async def _periodic_sync_loop(self):
        while self._running:
            await asyncio.sleep(self.interval_seconds)
            if not self._running:
                break
            try:
                async with self._lock:
                    await self.sync_all_providers()
            except Exception as e:
                log.warn(f"Periodic sync error: {e}")

    def get_model_db_stats(self) -> dict:
        return {
            "total_models": len(self.models),
            "providers": len(set(m.provider for m in self.models.values())),
            "free_models": sum(1 for m in self.models.values() if m.is_free),
            "last_sync": self.sync_history[-1].timestamp if self.sync_history else 0,
        }
