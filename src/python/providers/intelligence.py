import json, re, time, logging
from typing import Optional

log = logging.getLogger("jeumpa.intelligence")

MODEL_CAPABILITY_PATTERNS = {
    "coding": ["coder", "code", "deepseek", "qwen3-coder", "llama-3.3-70b", "gpt-4o", "claude-3.5-sonnet", "claude-3-opus"],
    "reasoning": ["reasoner", "reason", "deepseek-r1", "deepseek-reasoner", "o1", "o3", "sonar-reasoning"],
    "vision": ["vision", "vl", "gemini-2.0-flash", "gemini-2.5", "gpt-4o", "qwen2.5-vl", "llava"],
    "fast": ["fast", "mini", "flash", "small", "tiny", "8b", "7b", "3b", "270m", "nano"],
    "chat": ["chat", "instruct", "turbo", "general"],
    "creative": ["creative", "jamba", "command", "grok", "yi"],
    "embedding": ["embed", "jina-embedding", "text-embedding"],
    "long_context": ["128k", "1m", "1.5m", "2m", "32k", "qwen3-32b", "qwen3.5"],
}

PROVIDER_TYPE_HEURISTICS = {
    "openai.com": "openai",
    "api.deepseek.com": "deepseek",
    "api.groq.com": "groq",
    "api.cerebras.ai": "cerebras",
    "models.inference.ai.azure.com": "github",
    "openrouter.ai": "openrouter",
    "api.together.xyz": "together",
    "api.fireworks.ai": "fireworks",
    "api.mistral.ai": "mistral",
    "api.perplexity.ai": "perplexity",
    "api.sambanova.ai": "sambanova",
    "integrate.api.nvidia.com": "nvidia",
    "api.hyperbolic.xyz": "hyperbolic",
    "api-inference.huggingface.co": "huggingface",
    "api.cohere.ai": "cohere",
    "api.siliconflow.cn": "siliconflow",
    "open.bigmodel.cn": "zhipu",
    "api.cloudflare.com": "cloudflare",
    "api.llm7.io": "llm7",
    "api.kilo.ai": "kilocode",
    "api.ai21.com": "ai21",
    "api.x.ai": "xai",
    "api.studio.nebius.ai": "nebius",
    "dashscope.aliyuncs.com": "alibaba",
    "api-inference.modelscope.cn": "modelscope",
    "api.deepinfra.com": "deepinfra",
    "api.lingyiwanwu.com": "01ai",
    "api.jina.ai": "jina",
    "text.pollinations.ai": "pollinations",
    "keylessai.thryx.workers.dev": "keylessai",
    "api.airforce": "api_airforce",
    "oai.endpoints.kepler.ai.cloud.ovh.net": "ovhcloud_anon",
    "generativelanguage.googleapis.com": "gemini",
}

class ProviderIntelligence:
    def __init__(self, router=None, registry=None):
        self.router = router
        self.registry = registry
        self._cache = {}
        self._model_capabilities = {}
        self._provider_insights = {}

    def classify_provider_type(self, base_url: str) -> str:
        for domain, ptype in PROVIDER_TYPE_HEURISTICS.items():
            if domain in base_url:
                return ptype
        if "/v1" in base_url or "/chat" in base_url:
            return "openai_compat"
        if "googleapis" in base_url or "gemini" in base_url:
            return "gemini"
        return "openai_compat"

    def classify_model_capabilities(self, model_name: str) -> list[str]:
        if model_name in self._model_capabilities:
            return self._model_capabilities[model_name]
        m = model_name.lower()
        caps = set()
        for cap, patterns in MODEL_CAPABILITY_PATTERNS.items():
            for pat in patterns:
                if pat in m:
                    caps.add(cap)
                    break
        if not caps:
            caps.add("chat")
        result = sorted(caps)
        self._model_capabilities[model_name] = result
        return result

    def suggest_model_for_task(self, task: str, available_models: list[str]) -> Optional[str]:
        task_lower = task.lower()
        candidates = []
        for model in available_models:
            caps = self.classify_model_capabilities(model)
            score = 0
            preferred = MODEL_CAPABILITY_PATTERNS.get(task_lower, [])
            for cap in caps:
                if cap == task_lower:
                    score += 3
                if cap in preferred:
                    score += 2
            if "fast" in caps and task_lower in ("fast", "chat"):
                score += 1
            candidates.append((score, model))
        candidates.sort(key=lambda x: -x[0])
        return candidates[0][1] if candidates else None

    def analyze_endpoint_metadata(self, name: str, base_url: str, probe_result: dict) -> dict:
        insights = {
            "name": name,
            "base_url": base_url,
            "type": self.classify_provider_type(base_url),
            "models": [],
            "capabilities": set(),
            "estimated_context": 4096,
            "supports_streaming": True,
            "estimated_rpm": 60,
            "reliability_score": 50,
            "suggested_priority": 10,
        }
        if probe_result.get("models"):
            model_list = probe_result["models"]
            insights["models"] = model_list
            all_caps = set()
            for m in model_list:
                for c in self.classify_model_capabilities(m):
                    all_caps.add(c)
            insights["capabilities"] = all_caps
            has_smart = any(k in str(model_list).lower() for k in ["gpt-4", "claude-3", "deepseek-r1", "gemini-2.5", "qwen3-397b"])
            has_fast = any(k in str(model_list).lower() for k in ["mini", "flash", "fast", "small", "8b"])
            if has_smart:
                insights["suggested_priority"] = 5
                insights["estimated_rpm"] = 30
            elif has_fast:
                insights["suggested_priority"] = 3
                insights["estimated_rpm"] = 120
            else:
                insights["suggested_priority"] = 7

        if probe_result.get("latency_ms", 0) > 0:
            lat = probe_result["latency_ms"]
            if lat < 500:
                insights["estimated_rpm"] = max(insights["estimated_rpm"], 120)
                insights["reliability_score"] = 90
                insights["suggested_priority"] = min(insights["suggested_priority"], 3)
            elif lat < 2000:
                insights["reliability_score"] = 70
            elif lat < 5000:
                insights["reliability_score"] = 40
                insights["suggested_priority"] = max(insights["suggested_priority"], 8)
            else:
                insights["reliability_score"] = 20
                insights["suggested_priority"] = 12

        if probe_result.get("error"):
            insights["reliability_score"] = 10
            insights["suggested_priority"] = 15

        self._provider_insights[name] = insights
        return insights

    async def analyze_errors_ai(self, provider_name: str, error_history: list[dict]) -> dict:
        if len(error_history) < 3:
            return {"pattern": "insufficient_data", "action": "monitor", "confidence": 0.3}
        recent = error_history[-10:]
        errors_429 = sum(1 for e in recent if "429" in str(e.get("error", "")))
        errors_5xx = sum(1 for e in recent if e.get("error", "") and "5" in str(e.get("status", ""))[0])
        errors_timeout = sum(1 for e in recent if "timeout" in str(e.get("error", "")).lower())
        consecutive = 0
        for e in reversed(recent):
            if e.get("error"):
                consecutive += 1
            else:
                break
        if consecutive >= 5:
            return {"pattern": "down", "action": "offline", "cooldown": 300, "confidence": 0.9}
        if errors_429 >= 3:
            return {"pattern": "rate_limited", "action": "cooldown", "cooldown": 60, "confidence": 0.8}
        if errors_timeout >= 3:
            return {"pattern": "slow", "action": "degrade", "cooldown": 120, "confidence": 0.7}
        if errors_5xx >= 3:
            return {"pattern": "unstable", "action": "monitor", "cooldown": 30, "confidence": 0.6}
        if errors_429 > 0 and errors_5xx == 0:
            return {"pattern": "throttled", "action": "reduce_priority", "confidence": 0.5}
        return {"pattern": "healthy", "action": "none", "confidence": 0.4}

    async def suggest_fallback_chain(self, primary_model: str, available_providers: list) -> list:
        suggestions = []
        primary_provider = primary_model.split("/")[0] if "/" in primary_model else None
        for p in available_providers:
            if p.name == primary_provider:
                continue
            if p.status == "offline" or p.status == "rate_limited":
                continue
            if "*" in p.config.model_list or any(m in p.config.model_list for m in [primary_model.split("/")[-1], "*"]):
                suggestions.append((p.config.priority, p.name))
        suggestions.sort()
        return [s[1] for s in suggestions[:5]]

    def get_provider_category(self, provider_name: str, config: dict) -> str:
        base_url = config.get("base_url", "")
        api_key = config.get("api_key", "")
        models = config.get("models", [])
        if not api_key:
            return "anonymous"
        if any(k in provider_name for k in ["openai", "anthropic", "google"]):
            return "premium"
        if any(k in provider_name for k in ["deepseek", "groq", "mistral", "cohere"]):
            return "standard"
        if any(k in provider_name for k in ["free", "anon", "noauth", "airforce", "keyless"]):
            return "anonymous"
        return "community"

    def estimate_context_window(self, model_name: str) -> int:
        m = model_name.lower()
        if any(k in m for k in ["1m", "1.5m", "10m"]):
            return 1000000
        if "128k" in m or "qwen3.5-397b" in m:
            return 128000
        if "32k" in m or "qwen3-32b" in m:
            return 32000
        if "16k" in m:
            return 16000
        if any(k in m for k in ["gpt-4", "claude", "sonnet", "opus"]):
            return 8192
        if any(k in m for k in ["gpt-3.5", "deepseek", "llama", "mistral", "qwen"]):
            return 4096
        return 4096

    def detect_rate_limit_pattern(self, error_response: dict) -> Optional[dict]:
        body = str(error_response.get("body", ""))
        status = error_response.get("status", 0)
        if status == 429:
            retry = None
            if "retry-after" in error_response.get("headers", {}):
                retry = error_response["headers"]["retry-after"]
            for token in ["retry_after", "retry-after", "Retry-After"]:
                if token in error_response.get("headers", {}):
                    retry = error_response["headers"][token]
                    break
            if "minute" in body:
                return {"type": "rpm", "suggested_limit": 10, "retry_after": 60}
            if "day" in body or "daily" in body:
                return {"type": "daily", "suggested_limit": 100, "retry_after": 3600}
            if "second" in body:
                return {"type": "tps", "suggested_limit": 1, "retry_after": 1}
            return {"type": "unknown", "suggested_limit": 5, "retry_after": int(retry) if retry else 30}
        return None

    def suggest_model_for_content(self, messages: list) -> dict:
        text = " ".join(m.get("content", "") or "" for m in messages).lower().strip()
        if not text:
            return {"model": "deepseek-chat", "type": "general", "confidence": 0.5}

        if re.search(r"code|implement|function|class|api|debug|bug|fix|refactor|sql|database|frontend|backend|deploy|config|docker|kubernetes|terraform|write a|create a|build|develop|script|program|compile|syntax|variable|loop|array|object|module|package|npm|pip|git|commit", text):
            return {"model": "claude-sonnet-4-20250514", "type": "code", "confidence": 0.9}

        if re.search(r"plan|design|rencana|rencanakan|strategy|analyze|compare|decision|recommend|struktur|periksa|overview|roadmap|alur|diagram|flow|system design|high level|architect|evaluate|assess", text):
            return {"model": "deepseek-chat", "type": "planning", "confidence": 0.8}

        if re.search(r"reason|solve|explain|how does|why is|what is|step by step|proof|calculate|derive|think about|math|equation|formula|theorem|logic|prove", text):
            return {"model": "gpt-4o", "type": "reasoning", "confidence": 0.85}

        if re.search(r"creative|write|story|poem|essay|narrative|blog|content|describe|imagine", text):
            return {"model": "deepseek-chat", "type": "creative", "confidence": 0.7}

        if "?" in text or len(text) < 100:
            return {"model": "gpt-4o-mini", "type": "fast", "confidence": 0.75}

        return {"model": "deepseek-chat", "type": "general", "confidence": 0.6}
