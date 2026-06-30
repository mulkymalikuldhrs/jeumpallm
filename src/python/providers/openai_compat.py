import httpx, json, time, random
from typing import AsyncIterator
from .base import BaseProvider, ProviderConfig, ProviderStatus

USER_AGENTS = [
    "Mozilla/5.0 (Linux; Android 14; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.6422.147 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.179 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.6422.113 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 13; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.113 Mobile Safari/537.36",
    "Mozilla/5.0 (iPhone14,6; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.6422.141 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.6422.141 Safari/537.36",
]

class OpenAICompatibleProvider(BaseProvider):
    def __init__(self, config: ProviderConfig):
        super().__init__(config)
        self.client = httpx.AsyncClient(timeout=config.timeout, follow_redirects=True)

    def _headers(self):
        h = {"Content-Type": "application/json"}
        if self.config.api_key:
            h["Authorization"] = f"Bearer {self.config.api_key}"
        h["User-Agent"] = random.choice(USER_AGENTS)
        return h

    async def _request(self, data: dict, stream: bool = False):
        if not self.can_attempt():
            return {"error": "circuit_breaker_open", "status": 503}
        headers = self._headers()
        url = f"{self.config.base_url.rstrip('/')}/chat/completions"
        t0 = time.time()
        try:
            if stream:
                return self._stream_request(url, headers, data)
            r = await self.client.post(url, json=data, headers=headers)
            self.latency_ms = int((time.time() - t0) * 1000)
            self.total_requests += 1
            if r.status_code == 429:
                self.status = ProviderStatus.RATE_LIMITED
                self.record_failure(self._classify_error(429))
                return {"error": "rate_limited", "status": 429}
            if r.status_code >= 500:
                self.failed_requests += 1
                kind = self._classify_error(r.status_code)
                self.record_failure(kind)
                return {"error": f"provider_error:{r.status_code}", "status": r.status_code}
            r.raise_for_status()
            self.status = ProviderStatus.ONLINE
            self.record_success()
            return r.json()
        except httpx.TimeoutException:
            self.failed_requests += 1
            self.last_error = "timeout"
            self.status = ProviderStatus.DEGRADED
            self.record_failure(self._classify_error(504, "timeout"))
            return {"error": "timeout", "status": 504}
        except Exception as e:
            self.failed_requests += 1
            self.last_error = str(e)
            self.status = ProviderStatus.DEGRADED
            kind = self._classify_error(0, str(e))
            self.record_failure(kind)
            return {"error": str(e), "status": 502}

    async def _stream_request(self, url: str, headers: dict, data: dict):
        data["stream"] = True
        try:
            async with self.client.stream("POST", url, json=data, headers=headers) as r:
                async for line in r.aiter_lines():
                    if line.startswith("data: "):
                        yield line[6:]
                        if line[6:].strip() == "[DONE]":
                            break
        except GeneratorExit:
            pass
        except RuntimeError:
            pass

    async def chat_completion(self, messages: list, model: str = None, stream: bool = False, **kwargs) -> dict:
        model = model or (self.config.model_list[0] if self.config.model_list else None)
        data = {"model": model, "messages": messages, **kwargs}
        if stream:
            return await self._request(data, stream=True)
        return await self._request(data)

    async def check_health(self) -> bool:
        try:
            model = self.config.model_list[0] if self.config.model_list else "test"
            t0 = time.time()
            result = await self._request({"model": model, "messages": [{"role": "user", "content": "hi"}], "max_tokens": 1})
            self.latency_ms = int((time.time() - t0) * 1000)
            if isinstance(result, dict) and "error" not in result:
                self.status = ProviderStatus.ONLINE
                self.consecutive_successes += 1
                self.consecutive_failures = 0
                self.last_success_time = time.time()
                return True
            if isinstance(result, dict) and result.get("error") == "rate_limited":
                self.status = ProviderStatus.RATE_LIMITED
                self.consecutive_successes += 1
                return True
            self.consecutive_failures += 1
            self.consecutive_successes = 0
            self.last_status_code = result.get("status", 0) if isinstance(result, dict) else 0
            return False
        except Exception as e:
            self.status = ProviderStatus.OFFLINE
            self.last_error = str(e)
            self.consecutive_failures += 1
            self.consecutive_successes = 0
            return False

    async def list_models(self) -> list[str]:
        base = self.config.base_url.rstrip("/")
        models_url = f"{base}/models"
        try:
            r = await self.client.get(models_url,
                headers={"Authorization": f"Bearer {self.config.api_key}"} if self.config.api_key else {}
            )
            if r.status_code == 200:
                data = r.json()
                raw = data.get("data", data)
                if isinstance(raw, list):
                    models = []
                    for m in raw:
                        mid = m.get("id", "") if isinstance(m, dict) else (m if isinstance(m, str) else "")
                        if mid:
                            models.append(mid)
                    self.models_listed = models
                    return models
        except: pass
        return []
