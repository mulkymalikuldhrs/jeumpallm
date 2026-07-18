import os, time, asyncio, logging
from typing import Optional
from .providers.circuit_breaker import CircuitBreakerRegistry, FailureKind, CircuitState
from .providers.base import ProviderStatus

log = logging.getLogger("jeumpa.provider_mgr")

HEALTH_CHECK_TIMEOUT = 10
FRAGILE_CHECK_INTERVAL = 300

FRAGILE_PROVIDERS = {"g4f", "blackbox", "phind"}

class ProviderManager:
    def __init__(self, registry, model_sync=None, circuit_breaker_registry=None):
        self.registry = registry
        self.model_sync = model_sync
        self.circuit_breakers = circuit_breaker_registry or CircuitBreakerRegistry()
        self.round_robin_index = {}
        self._health_task: Optional[asyncio.Task] = None
        self._fragile_task: Optional[asyncio.Task] = None
        self._cleanup_task: Optional[asyncio.Task] = None
        self._running = False
        self._request_count = 0
        self._total_cost = 0.0
        self.health_check_interval = int(os.environ.get("HEALTH_CHECK_INTERVAL_MS", "60000")) / 1000
        self.fragile_check_interval = int(os.environ.get("FRAGILE_CHECK_INTERVAL_MS", "300000")) / 1000

    async def start(self):
        await self.check_all_providers()
        self._running = True
        self._health_task = asyncio.create_task(self._health_loop())
        self._fragile_task = asyncio.create_task(self._fragile_health_loop())
        self._cleanup_task = asyncio.create_task(self._cleanup_loop())
        log.info(f"ProviderManager started: {len(self.registry.providers)} providers, health check every {self.health_check_interval}s")

    def stop(self):
        self._running = False
        for t in [self._health_task, self._fragile_task, self._cleanup_task]:
            if t and not t.done():
                t.cancel()
        log.info("ProviderManager stopped")

    async def _health_loop(self):
        while self._running:
            await asyncio.sleep(self.health_check_interval)
            if not self._running:
                break
            try:
                await self.check_all_providers()
            except Exception as e:
                log.warn(f"Health check cycle error: {e}")

    async def _fragile_health_loop(self):
        while self._running:
            await asyncio.sleep(self.fragile_check_interval)
            if not self._running:
                break
            try:
                for name in FRAGILE_PROVIDERS:
                    provider = self.registry.providers.get(name)
                    if not provider:
                        continue
                    breaker = self.circuit_breakers.get_or_create(name)
                    if breaker.is_open:
                        continue
                    try:
                        ok = await provider.check_health()
                        if ok:
                            provider.status = ProviderStatus.ONLINE
                            breaker.record_success()
                        else:
                            provider.status = ProviderStatus.DEGRADED if provider.status == ProviderStatus.ONLINE else ProviderStatus.OFFLINE
                            breaker.record_failure(FailureKind.NETWORK_ERROR)
                    except Exception:
                        provider.status = ProviderStatus.DEGRADED if provider.status == ProviderStatus.ONLINE else ProviderStatus.OFFLINE
                        breaker.record_failure(FailureKind.NETWORK_ERROR)
            except Exception as e:
                log.warn(f"Fragile health check error: {e}")

    async def _cleanup_loop(self):
        while self._running:
            await asyncio.sleep(300)
            self.circuit_breakers.cleanup()

    async def check_provider_health(self, name: str) -> dict:
        provider = self.registry.providers.get(name)
        if not provider:
            return {"name": name, "status": "unknown", "error": "not_registered"}

        breaker = self.circuit_breakers.get_or_create(name)
        if breaker.is_open:
            return {"name": name, "status": "circuit_open", "skipped": True, "circuit_state": breaker.state}

        t0 = time.time()
        try:
            ok = await asyncio.wait_for(provider.check_health(), timeout=HEALTH_CHECK_TIMEOUT)
            latency = int((time.time() - t0) * 1000)
            if ok:
                provider.status = ProviderStatus.ONLINE
                provider.last_success_time = time.time()
                provider.consecutive_successes += 1
                provider.consecutive_failures = 0
                breaker.record_success()
                return {"name": name, "status": "healthy", "latency_ms": latency}
            else:
                provider.consecutive_successes = 0
                provider.consecutive_failures += 1
                provider.status = ProviderStatus.DEGRADED if provider.status == ProviderStatus.ONLINE else ProviderStatus.OFFLINE
                breaker.record_failure(FailureKind.UNKNOWN)
                return {"name": name, "status": "degraded", "latency_ms": latency, "error": "health_check_failed"}
        except asyncio.TimeoutError:
            provider.consecutive_failures += 1
            provider.status = ProviderStatus.DEGRADED if provider.status == ProviderStatus.ONLINE else ProviderStatus.OFFLINE
            breaker.record_failure(FailureKind.TIMEOUT)
            return {"name": name, "status": "timeout", "error": "health_check_timeout"}
        except Exception as e:
            err_msg = str(e)
            provider.consecutive_failures += 1
            provider.status = ProviderStatus.DEGRADED if provider.status == ProviderStatus.ONLINE else ProviderStatus.OFFLINE
            kind = self._classify_error(0, err_msg)
            breaker.record_failure(kind)
            return {"name": name, "status": "error", "error": err_msg}

    async def check_all_providers(self) -> list[dict]:
        names = list(self.registry.providers.keys())
        results = await asyncio.gather(
            *[self.check_provider_health(n) for n in names],
            return_exceptions=True
        )
        healthy = sum(1 for r in results if isinstance(r, dict) and r.get("status") == "healthy")
        log.info(f"Health check: {healthy}/{len(names)} providers healthy")
        return [r for r in results if isinstance(r, dict)]

    def _classify_error(self, status_code: int, error_text: str) -> str:
        msg = error_text.lower()
        if status_code == 429 or "rate limit" in msg or "too many" in msg:
            return FailureKind.RATE_LIMIT
        if status_code in (401, 403) or "unauthorized" in msg or "invalid api key" in msg or "auth" in msg:
            return FailureKind.AUTH_FAILURE
        if status_code == 402 or "quota" in msg or "credit" in msg or "billing" in msg:
            return FailureKind.QUOTA_EXHAUSTED
        if "timeout" in msg or "timed out" in msg:
            return FailureKind.TIMEOUT
        if 500 <= status_code < 600:
            return FailureKind.SERVER_ERROR
        if "network" in msg or "econnrefused" in msg or "connection" in msg or "resolve" in msg:
            return FailureKind.NETWORK_ERROR
        return FailureKind.UNKNOWN

    def get_provider_ranking(self, sort_by="latency") -> list[dict]:
        rankings = []
        for name, provider in self.registry.providers.items():
            breaker = self.circuit_breakers.get_or_create(name)
            rankings.append({
                "name": name,
                "status": provider.status,
                "latency_ms": provider.latency_ms,
                "priority": provider.config.priority,
                "healthy": provider.status == ProviderStatus.ONLINE,
                "circuit_state": breaker.state,
                "total_requests": provider.total_requests,
                "failed_requests": provider.failed_requests,
                "success_rate": (provider.total_requests - provider.failed_requests) / max(provider.total_requests, 1),
            })
        if sort_by == "latency":
            rankings.sort(key=lambda r: (r["healthy"] is False, r.get("latency_ms", 99999)))
        elif sort_by == "priority":
            rankings.sort(key=lambda r: (r["healthy"] is False, r["priority"]))
        elif sort_by == "success_rate":
            rankings.sort(key=lambda r: (r["healthy"] is False, -r["success_rate"]))
        return rankings

    def get_healthy_providers(self, min_health=0.5) -> list:
        healthy = []
        for provider in self.registry.providers.values():
            if provider.status == ProviderStatus.OFFLINE:
                continue
            total = provider.total_requests or 1
            success_rate = (total - provider.failed_requests) / total
            if success_rate >= min_health:
                healthy.append(provider)
        return healthy

    def get_providers_by_capability(self, capability: str) -> list:
        results = []
        for provider in self.registry.providers.values():
            caps = getattr(provider, "detected_capabilities", []) or []
            if capability in caps:
                results.append(provider)
        return results

    def get_fallback_chain(self, preferred_providers: list[str]) -> list:
        scored = []
        for name in preferred_providers:
            provider = self.registry.providers.get(name)
            if not provider:
                continue
            breaker = self.circuit_breakers.get_or_create(name)
            status_weight = {"online": 4, "degraded": 3, "rate_limited": 1, "offline": 0, "unknown": 2}
            health_score = status_weight.get(provider.status, 0)
            if breaker.is_open:
                health_score = 0
            elif breaker.is_degraded:
                health_score = min(health_score, 2)
            success_rate = (provider.total_requests - provider.failed_requests) / max(provider.total_requests, 1)
            scored.append((health_score * success_rate, provider.config.priority, name))
        scored.sort(key=lambda x: (-x[0], x[1]))
        return [self.registry.providers.get(name) for _, _, name in scored if self.registry.providers.get(name)]

    def get_route(self, model_id: str, messages: list = None, options: dict = None) -> Optional[object]:
        providers = []
        for provider in self.registry.providers.values():
            model_list = provider.config.model_list or []
            if "*" in model_list or model_id in model_list:
                providers.append(provider)

        if not providers:
            return None

        available = [p for p in providers if self.circuit_breakers.get_or_create(p.name).can_attempt()]
        if not available:
            degraded = [p for p in providers if self.circuit_breakers.get_or_create(p.name).is_degraded]
            if degraded:
                return self._round_robin(model_id, degraded)
            return providers[0]

        sorted_providers = sorted(available, key=lambda p: (
            {"healthy": 0, "unknown": 1, "degraded": 2, "down": 3}.get(p.status, 2),
            p.config.priority,
            p.latency_ms,
        ))

        top_priority = sorted_providers[0].config.priority
        top_healthy = [p for p in sorted_providers if p.config.priority == top_priority and p.status == "healthy" or p.status == ProviderStatus.ONLINE]

        if len(top_healthy) > 1:
            return self._round_robin(model_id, top_healthy)

        return sorted_providers[0]

    def _round_robin(self, model_id: str, providers: list) -> object:
        idx = self.round_robin_index.get(model_id, 0)
        selected = providers[idx % len(providers)]
        self.round_robin_index[model_id] = idx + 1
        return selected

    async def chat_with_failover(self, model_id: str, messages: list, options: dict = None) -> dict:
        options = options or {}
        providers = []
        for provider in self.registry.providers.values():
            model_list = provider.config.model_list or []
            if "*" in model_list or model_id in model_list:
                providers.append(provider)

        if not providers:
            raise ValueError(f"No provider available for model: {model_id}")

        sorted_providers = sorted(providers, key=lambda p: (
            0 if self.circuit_breakers.get_or_create(p.name).is_available else 1,
            {"healthy": 0, "unknown": 1, "degraded": 2, "down": 3}.get(p.status, 2),
            p.config.priority,
        ))

        last_error = None
        for provider in sorted_providers:
            breaker = self.circuit_breakers.get_or_create(provider.name)
            if not breaker.attempt():
                log.debug(f"{provider.name} circuit breaker blocked (state: {breaker.state})")
                continue

            t0 = time.time()
            try:
                result = await provider.chat_completion(messages, model=model_id, **options)
                latency = int((time.time() - t0) * 1000)
                provider.status = ProviderStatus.ONLINE
                provider.latency_ms = latency
                provider.total_requests += 1
                provider.record_success()
                breaker.record_success()
                self._request_count += 1
                return {"result": result, "provider": provider.name, "latency_ms": latency, "circuit_state": breaker.state}
            except Exception as e:
                latency = int((time.time() - t0) * 1000)
                provider.total_requests += 1
                provider.failed_requests += 1
                kind = self._classify_error(getattr(e, "status_code", 0), str(e))
                breaker.record_failure(kind)
                if provider.status == ProviderStatus.ONLINE:
                    provider.status = ProviderStatus.DEGRADED
                elif provider.status == ProviderStatus.DEGRADED:
                    provider.status = ProviderStatus.OFFLINE
                last_error = e
                log.debug(f"{provider.name} failed for {model_id} ({kind}): {e}")

        raise last_error or RuntimeError(f"All providers failed for model: {model_id}")

    def get_stats(self) -> dict:
        return {
            "total_requests": self._request_count,
            "total_cost": self._total_cost,
            "health_check_interval": self.health_check_interval,
            "circuit_breakers": self.circuit_breakers.get_stats(),
            "providers": {n: p.to_dict() for n, p in self.registry.providers.items()},
        }
