import httpx, json, time
from typing import AsyncIterator
from .base import BaseProvider, ProviderConfig, ProviderStatus

GEMINI_MODELS = ["gemini-2.0-flash", "gemini-2.5-pro", "gemini-1.5-pro", "gemini-1.5-flash"]

class GeminiProvider(BaseProvider):
    def __init__(self, config: ProviderConfig):
        super().__init__(config)
        self.client = httpx.AsyncClient(timeout=config.timeout, follow_redirects=True)
        self.api_key = config.api_key
        self.config.model_list = config.model_list or GEMINI_MODELS

    def _gemini_to_openai(self, messages: list) -> list:
        contents = []
        system = None
        for m in messages:
            if m["role"] == "system":
                system = m["content"]
                continue
            role = "model" if m["role"] == "assistant" else "user"
            parts = [{"text": m["content"]}]
            contents.append({"role": role, "parts": parts})
        result = {"contents": contents}
        if system:
            result["systemInstruction"] = {"parts": [{"text": system}]}
        return result

    def _openai_to_gemini(self, response: dict) -> dict:
        try:
            c = response["candidates"][0]
            text = c.get("content", {}).get("parts", [{}])[0].get("text", "")
            return {
                "id": "chatcmpl-" + str(time.time()),
                "object": "chat.completion",
                "created": int(time.time()),
                "model": self.name,
                "choices": [{
                    "index": 0,
                    "message": {"role": "assistant", "content": text},
                    "finish_reason": "stop"
                }],
                "usage": {
                    "prompt_tokens": response.get("usageMetadata", {}).get("promptTokenCount", 0),
                    "completion_tokens": response.get("usageMetadata", {}).get("candidatesTokenCount", 0),
                    "total_tokens": response.get("usageMetadata", {}).get("totalTokenCount", 0),
                }
            }
        except:
            return {"error": "parse_failed", "raw": response}

    async def chat_completion(self, messages: list, model: str = None,
                              stream: bool = False, **kwargs) -> dict | AsyncIterator:
        if not self.can_attempt():
            return {"error": "circuit_breaker_open", "status": 503}
        model = model or "gemini-2.0-flash"
        gemini_data = self._gemini_to_openai(messages)
        if stream:
            gemini_data["stream"] = False
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={self.api_key}"
        t0 = time.time()
        try:
            r = await self.client.post(url, json=gemini_data, headers={"Content-Type": "application/json"})
            self.latency_ms = int((time.time() - t0) * 1000)
            self.total_requests += 1
            if r.status_code == 429 or r.status_code == 403:
                self.status = ProviderStatus.RATE_LIMITED if r.status_code == 429 else ProviderStatus.DEGRADED
                self.record_failure(self._classify_error(r.status_code))
                return {"error": f"gemini_error:{r.status_code}", "status": r.status_code}
            r.raise_for_status()
            self.status = ProviderStatus.ONLINE
            self.record_success()
            return self._openai_to_gemini(r.json())
        except Exception as e:
            self.failed_requests += 1
            self.last_error = str(e)
            self.status = ProviderStatus.DEGRADED
            self.record_failure(self._classify_error(0, str(e)))
            return {"error": str(e), "status": 502}

    async def check_health(self) -> bool:
        try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models?key={self.api_key}"
            r = await self.client.get(url, timeout=5)
            if r.status_code < 400:
                self.status = ProviderStatus.ONLINE
                return True
        except:
            pass
        self.status = ProviderStatus.OFFLINE
        return False
