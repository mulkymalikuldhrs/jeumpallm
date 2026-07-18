import time, json, logging
from typing import Optional, AsyncIterator
from .base import BaseProvider, ProviderConfig, ProviderStatus

log = logging.getLogger("jeumpa.g4f")

G4F_MODELS = ["gpt-4o", "gpt-4o-mini", "gpt-4", "gpt-3.5-turbo",
              "claude-3.5-sonnet", "claude-3-opus",
              "gemini-2.0-flash", "gemini-2.5-pro",
              "deepseek-r1", "deepseek-chat",
              "llama-3.3-70b", "llama-3.1-8b",
              "mixtral-8x7b", "qwen-2.5-72b",
              "dbrx-instruct", "command-r-plus",
              "mistral-large", "codestral"]

try:
    import g4f
    G4F_AVAILABLE = True
except ImportError:
    G4F_AVAILABLE = False

class G4FProvider(BaseProvider):
    def __init__(self, config: ProviderConfig):
        super().__init__(config)
        self.status = ProviderStatus.UNKNOWN

    async def chat_completion(self, messages: list, model: str = None,
                              stream: bool = False, **kwargs) -> dict | AsyncIterator:
        if not G4F_AVAILABLE:
            return {"error": "g4f not installed", "status": 501}
        model = model or "gpt-4o-mini"
        try:
            provider = self._select_provider(model)
            t0 = time.time()
            loop = asyncio.get_event_loop()
            response = await loop.run_in_executor(
                None, lambda: g4f.ChatCompletion.create(
                    model=model,
                    messages=messages,
                    provider=provider,
                    stream=False
                )
            )
            self.latency_ms = int((time.time() - t0) * 1000)
            self.total_requests += 1
            self.status = ProviderStatus.ONLINE
            return self._to_openai(response, model)
        except Exception as e:
            self.failed_requests += 1
            self.status = ProviderStatus.DEGRADED
            return {"error": f"g4f:{str(e)}", "status": 502}

    def _select_provider(self, model: str):
        if "claude" in model:
            return getattr(g4f.Provider, "Bing", None)
        if "gemini" in model:
            return getattr(g4f.Provider, "Gemini", None)
        if "gpt" in model:
            return getattr(g4f.Provider, "Blackbox", None) or getattr(g4f.Provider, "ChatgptFree", None)
        return None

    def _to_openai(self, response, model):
        return {
            "id": f"g4f-{int(time.time())}",
            "object": "chat.completion",
            "created": int(time.time()),
            "model": model,
            "choices": [{
                "index": 0,
                "message": {"role": "assistant", "content": str(response)},
                "finish_reason": "stop"
            }],
            "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
        }

    async def check_health(self):
        self.status = ProviderStatus.ONLINE if G4F_AVAILABLE else ProviderStatus.UNKNOWN
        return G4F_AVAILABLE
