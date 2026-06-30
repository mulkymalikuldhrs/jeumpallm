import os, sys, glob, importlib, inspect, hashlib, time
from typing import Optional
from .base import BaseProvider, ProviderConfig, ProviderStatus
from .openai_compat import OpenAICompatibleProvider
from .gemini import GeminiProvider
from .echo import EchoProvider
from .g4f_provider import G4FProvider

ENVVAR_MAP = {}

def _discover_env_key(pname: str, provider_cfg: dict) -> str:
    ek = provider_cfg.get("env_key", "")
    if ek:
        return ek
    return f"{pname.upper()}_API_KEY"

class ProviderRegistry:
    def __init__(self, config_path: str = None, model_sync=None, provider_manager=None):
        self.config_path = config_path
        self.providers: dict[str, BaseProvider] = {}
        self._config = {}
        self.model_sync = model_sync
        self.provider_manager = provider_manager

    def set_model_sync(self, model_sync):
        self.model_sync = model_sync

    def set_provider_manager(self, provider_manager):
        self.provider_manager = provider_manager

    def load_config(self):
        cfg = {}
        if self.config_path and os.path.exists(self.config_path):
            with open(self.config_path) as f:
                import yaml
                cfg = yaml.safe_load(f) or {}
        self._config = cfg
        return cfg

    def _load_env_keys(self) -> dict:
        keys = {}
        try:
            from jeumpa_paths import load_env_file
            keys = load_env_file()
        except ImportError:
            pass
        for env_path in [os.path.expanduser("~/.env"), "/sdcard/dhaherlabs/.env"]:
            if os.path.exists(env_path):
                with open(env_path) as f:
                    for line in f:
                        line = line.strip()
                        if "=" in line and not line.startswith("#"):
                            k, v = line.split("=", 1)
                            keys[k.strip()] = v.strip().strip("'").strip('"')
        for k, v in os.environ.items():
            keys[k] = v
        return keys

    def build(self, router=None):
        cfg = self._config or self.load_config()
        env_keys = self._load_env_keys()
        built = {}

        provider_types = cfg.get("provider_types", {})
        known_types = {"openai_compat": OpenAICompatibleProvider}
        for pname, pdef in provider_types.items():
            known_types[pname] = {
                "gemini": GeminiProvider,
                "openai_compat": OpenAICompatibleProvider,
            }.get(pdef.get("type", "openai_compat"), OpenAICompatibleProvider)

        for pname, pinfo in cfg.get("providers", {}).items():
            env_var = _discover_env_key(pname, pinfo)
            key = env_keys.get(env_var, "")

            base_url = pinfo["base_url"]
            extra = pinfo.get("extra", {})
            if extra.get("needs_account_id"):
                account_id = env_keys.get("CLOUDFLARE_ACCOUNT_ID", "")
                base_url = base_url.replace("{account_id}", account_id)

            priority = pinfo.get("priority", 5)
            models = pinfo.get("models", ["*"])
            provider_type = pinfo.get("type", "openai_compat")

            pc = ProviderConfig(name=pname, type=provider_type, base_url=base_url,
                                api_key=key, models=models, priority=priority)
            prov_cls = known_types.get(provider_type, OpenAICompatibleProvider)
            if callable(prov_cls):
                built[pname] = prov_cls(pc)
            else:
                built[pname] = OpenAICompatibleProvider(pc)

        for pname, pinfo in cfg.get("noauth_providers", {}).items():
            priority = pinfo.get("priority", 5)
            models = pinfo.get("models", ["*"])
            pc = ProviderConfig(name=pname, type="openai_compat",
                                base_url=pinfo["base_url"], api_key="",
                                models=models, priority=priority)
            built[pname] = OpenAICompatibleProvider(pc)

        if cfg.get("custom"):
            for cname, cinfo in cfg["custom"].items():
                pc = ProviderConfig(name=cname, type=cinfo.get("type", "openai_compat"),
                                    base_url=cinfo["base_url"], api_key=cinfo.get("api_key", ""),
                                    models=cinfo.get("models", []),
                                    priority=cinfo.get("priority", 10))
                built[cname] = OpenAICompatibleProvider(pc)

        echo_cfg = ProviderConfig(name="echo", type="echo", models=["echo"], priority=0)
        built["echo"] = EchoProvider(echo_cfg)

        g4f_cfg = ProviderConfig(name="g4f", type="g4f", models=["*"], priority=10)
        built["g4f"] = G4FProvider(g4f_cfg)

        if router:
            for p in built.values():
                router.register(p)
            for alias, target in cfg.get("models", {}).get("aliases", {}).items():
                router.add_alias(alias, target)

        self.providers = built

        if self.model_sync and self.model_sync.models:
            self._annotate_from_model_sync()

        return built

    def _annotate_from_model_sync(self):
        for pname, provider in self.providers.items():
            models = self.model_sync.get_models_by_provider(pname)
            if models:
                listed = [m.id for m in models]
                provider.models_listed = listed
                capped = [m for m in models if "vision" in m.capabilities]
                if capped:
                    provider.detected_capabilities = list(set(provider.detected_capabilities + ["vision"]))

    def get_available_providers(self, include_degraded: bool = True) -> list:
        available = []
        degraded = []
        for p in self.providers.values():
            if not p.can_attempt():
                continue
            if p.status == ProviderStatus.OFFLINE and p.failed_requests > 3:
                continue
            if p.cooldown_until >= time.time():
                continue
            if p.status in (ProviderStatus.DEGRADED, ProviderStatus.RATE_LIMITED):
                if include_degraded:
                    degraded.append(p)
            else:
                available.append(p)
        return available + degraded

    def get_ranked_providers(self, sort_by="latency") -> list[dict]:
        if self.provider_manager:
            return self.provider_manager.get_provider_ranking(sort_by=sort_by)
        return [p.to_dict() for p in self.providers.values()]

    def get_healthy_providers(self, min_health=0.5) -> list:
        if self.provider_manager:
            return self.provider_manager.get_healthy_providers(min_health=min_health)
        return [p for p in self.providers.values() if p.status == ProviderStatus.ONLINE]

    def get_fallback_chain(self, preferred: list[str]) -> list:
        if self.provider_manager:
            return self.provider_manager.get_fallback_chain(preferred)
        return [self.providers.get(n) for n in preferred if n in self.providers]

    def get_sync_stats(self) -> dict:
        stats = {"providers": len(self.providers)}
        if self.model_sync:
            stats["model_sync"] = self.model_sync.get_model_db_stats()
        if self.provider_manager:
            pm_stats = self.provider_manager.get_stats()
            stats["health"] = {"total_requests": pm_stats["total_requests"], "circuit_breakers": len(pm_stats["circuit_breakers"])}
        return stats
