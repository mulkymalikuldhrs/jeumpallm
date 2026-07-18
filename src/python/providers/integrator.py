import time, logging, re
from typing import Optional
from .base import ProviderConfig, ProviderStatus
from .openai_compat import OpenAICompatibleProvider
from .intelligence import ProviderIntelligence

log = logging.getLogger("jeumpa.integrator")

class AutoIntegrator:
    def __init__(self, registry, router):
        self.registry = registry
        self.router = router
        self.intel = ProviderIntelligence(router, registry)
        self._integrated_count = 0
        self._auto_aliases: dict[str, str] = {}
        self._model_tasks: dict[str, str] = {}

    def integrate(self, probed_results: dict[str, dict]) -> int:
        integrated = 0
        for name, result in probed_results.items():
            if not result.get("working"):
                continue
            if name in self.registry.providers:
                self._update_existing(name, result)
                continue
            try:
                self._register_new(name, result)
                integrated += 1
            except Exception as e:
                log.warn(f"  Failed to integrate {name}: {e}")
        if integrated:
            self._update_task_routes()
            self._create_auto_aliases()
            log.info(f"AutoIntegrator: integrated {integrated} new providers (+{len(self._auto_aliases)} aliases)")
        self._integrated_count += integrated
        return integrated

    def _register_new(self, name: str, result: dict):
        base_url = result["endpoint_url"].rstrip("/")
        for suf in ["/chat/completions", "/v1/chat/completions", "/openai/v1/chat/completions"]:
            if base_url.endswith(suf):
                base_url = base_url[:-len(suf)]
                break
        models = result.get("models", [])
        insights = result.get("insights", {})
        category = self.intel.get_provider_category(name, {"base_url": base_url, "api_key": "", "models": models})
        priority = insights.get("suggested_priority", 10)
        cfg = ProviderConfig(
            name=name,
            type="openai_compat",
            base_url=base_url,
            api_key="",
            models=models if models else ["*"],
            priority=priority,
        )
        provider = OpenAICompatibleProvider(cfg)
        provider._is_autodiscovered = True
        provider.latency_ms = result.get("latency_ms", 0)
        if result.get("rate_limited"):
            provider.status = ProviderStatus.RATE_LIMITED
        else:
            provider.status = ProviderStatus.ONLINE
        self.router.register(provider)
        self.registry.providers[name] = provider

        if models:
            for model in models[:3]:
                alias_name = f"auto_{name}_{model.split('/')[-1].lower()}"
                alias_name = re.sub(r'[^a-z0-9_-]', '_', alias_name)[:40]
                self._auto_aliases[alias_name] = f"{name}/{model}"
        log.info(f"  ➕ {name} ({category}, priority {priority}, {len(models)} models, {result.get('latency_ms', 0)}ms)")

    def _update_existing(self, name: str, result: dict):
        provider = self.registry.providers.get(name)
        if not provider:
            return
        new_models = result.get("models", [])
        if new_models:
            old_count = len(provider.config.model_list)
            new_count = len(new_models)
            if new_count > old_count:
                old_set = set(provider.config.model_list)
                added = [m for m in new_models if m not in old_set and m != "*"]
                if added:
                    provider.config.model_list = new_models
                    for m in added:
                        self.router.model_map.setdefault(m, []).append(name)
                    log.info(f"  🔄 {name}: +{len(added)} new models (now {new_count})")
        if result.get("latency_ms", 0) > 0:
            provider.latency_ms = result.get("latency_ms", provider.latency_ms)
        if not result.get("rate_limited") and provider.status == ProviderStatus.RATE_LIMITED:
            provider.status = ProviderStatus.ONLINE
            provider.cooldown_until = 0
            log.info(f"  🔄 {name}: restored to ONLINE")

    def _update_task_routes(self):
        import yaml
        from pathlib import Path

        config_path = Path(__file__).parent.parent / "config.yaml"
        if not config_path.exists():
            return

        try:
            with open(config_path) as f:
                cfg = yaml.safe_load(f) or {}
            tasks = cfg.get("tasks", {})
            updated = False

            for task_name, task_cfg in tasks.items():
                current_model = task_cfg.get("model", "")
                if not current_model or current_model == "auto":
                    suggested = self.intel.suggest_model_for_task(
                        task_name,
                        [f"{p}/{m}" for p, pv in self.registry.providers.items()
                         for m in (pv.config.model_list if pv.config.model_list != ["*"] else [])]
                    )
                    if suggested:
                        task_cfg["model"] = suggested
                        updated = True

                current_fallbacks = task_cfg.get("fallback", [])
                if current_fallbacks and current_fallbacks[-1] == "echo":
                    new_fallbacks = self.intel.suggest_fallback_chain(
                        task_cfg.get("model", ""),
                        list(self.router.providers.values())
                    )
                    if new_fallbacks:
                        task_cfg["fallback"] = new_fallbacks + ["echo"]
                        updated = True

            if updated:
                with open(config_path, "w") as f:
                    yaml.dump(cfg, f, default_flow_style=False)
                log.info(f"  📝 Updated task routes with new providers")
        except Exception as e:
            log.warn(f"  Task route update failed: {e}")

    def _create_auto_aliases(self):
        count = 0
        for alias, target in self._auto_aliases.items():
            if alias not in self.router.aliases:
                self.router.add_alias(alias, target)
                count += 1
        if count:
            log.info(f"  🏷️  Created {count} auto-aliases")

    def auto_enable_features(self, provider_name: str) -> dict:
        provider = self.registry.providers.get(provider_name)
        if not provider:
            return {"error": "not_found"}
        features = {
            "streaming": True,
            "vision": False,
            "reasoning": False,
            "coding": False,
            "long_context": False,
            "function_calling": False,
        }
        models = provider.config.model_list
        models_str = str(models).lower()
        if any(k in models_str for k in ["vision", "vl", "gemini-2", "gpt-4o"]):
            features["vision"] = True
        if any(k in models_str for k in ["reason", "deepseek-r1", "o1", "o3"]):
            features["reasoning"] = True
        if any(k in models_str for k in ["coder", "code", "deepseek"]):
            features["coding"] = True
        if any(k in models_str for k in ["128k", "32k", "1m", "qwen3-32b", "qwen3.5"]):
            features["long_context"] = True
        return features

    def get_integration_stats(self) -> dict:
        by_category = {}
        for name, provider in self.registry.providers.items():
            cat = self.intel.get_provider_category(name, {"base_url": provider.config.base_url or "", "api_key": provider.config.api_key or "", "models": provider.config.model_list})
            by_category[cat] = by_category.get(cat, 0) + 1
        return {
            "total_integrated": self._integrated_count,
            "autodiscovered": len([p for p in self.registry.providers if p not in ("echo", "g4f")]),
            "by_category": by_category,
            "auto_aliases": len(self._auto_aliases),
        }
