import time, asyncio, logging
from typing import Optional
from .base import ProviderStatus
from .circuit_breaker import CircuitState, FailureKind
from .intelligence import ProviderIntelligence

log = logging.getLogger("jeumpa.monitor")

HEALTH_CHECK_INTERVAL = 60
FAST_CHECK_INTERVAL = 15
SLOW_CHECK_INTERVAL = 300
COOLDOWN_DEFAULT = 30
MAX_CONSECUTIVE_FAILURES = 5

class HealthMonitor:
    def __init__(self, router, registry):
        self.router = router
        self.registry = registry
        self.intel = ProviderIntelligence(router, registry)
        self._running = False
        self._health_history: dict[str, list[bool]] = {}
        self._latency_history: dict[str, list[float]] = {}
        self._error_history: dict[str, list[dict]] = {}
        self._current_status: dict[str, str] = {}
        self._check_count = 0

    async def start(self):
        self._running = True
        log.info("HealthMonitor: started")
        try:
            await self._run_checks()
        except asyncio.CancelledError:
            self._running = False

    def stop(self):
        self._running = False

    async def _run_checks(self):
        while self._running:
            self._check_count += 1
            await self._check_all()
            await asyncio.sleep(HEALTH_CHECK_INTERVAL)

    async def _check_all(self):
        tasks = []
        for pname, provider in list(self.router.providers.items()):
            if pname in ("echo", "g4f"):
                continue
            tasks.append(self._check_one(pname, provider))
        if not tasks:
            await asyncio.sleep(1)
            return
        results = await asyncio.gather(*tasks, return_exceptions=True)
        ok = sum(1 for r in results if r is True)
        degraded = sum(1 for r in results if r is False)
        if self._check_count % 5 == 0:
            total = len(tasks)
            log.info(f"HealthMonitor: {ok}/{total} online, {degraded}/{total} degraded")

    async def _check_one(self, pname: str, provider) -> bool:
        cb = getattr(provider, '_cb', None)
        if cb and cb.is_open:
            provider.status = ProviderStatus.OFFLINE
            self._current_status[pname] = "offline"
            return False
        if cb and cb.is_half_open and not cb.attempt():
            provider.status = ProviderStatus.OFFLINE
            self._current_status[pname] = "offline"
            return False

        try:
            t0 = time.time()
            healthy = await provider.check_health()
            lat = int((time.time() - t0) * 1000)
            provider.latency_ms = lat
        except Exception as e:
            healthy = False
            lat = 99999
            provider.last_error = str(e)

        self._record_health(pname, healthy)
        if lat > 0:
            self._record_latency(pname, lat)

        if cb:
            if healthy:
                cb.record_success()
            else:
                error_text = provider.last_error or ""
                status_code = getattr(provider, 'last_status_code', 0)
                kind = provider._classify_error(status_code, error_text) if hasattr(provider, '_classify_error') else FailureKind.UNKNOWN
                cb.record_failure(kind)

        if healthy:
            provider.status = ProviderStatus.ONLINE
            self._current_status[pname] = "online"
            return True
        else:
            self._record_error(pname, {"time": time.time(), "error": provider.last_error, "status": getattr(provider, 'last_status_code', 0)})
            return await self._diagnose_and_handle(pname, provider)

    def _record_health(self, pname: str, healthy: bool):
        if pname not in self._health_history:
            self._health_history[pname] = []
        self._health_history[pname].append(healthy)
        if len(self._health_history[pname]) > 100:
            self._health_history[pname] = self._health_history[pname][-100:]

    def _record_latency(self, pname: str, lat: float):
        if pname not in self._latency_history:
            self._latency_history[pname] = []
        self._latency_history[pname].append(lat)
        if len(self._latency_history[pname]) > 100:
            self._latency_history[pname] = self._latency_history[pname][-100:]

    def _record_error(self, pname: str, err: dict):
        if pname not in self._error_history:
            self._error_history[pname] = []
        self._error_history[pname].append(err)
        if len(self._error_history[pname]) > 50:
            self._error_history[pname] = self._error_history[pname][-50:]

    async def _diagnose_and_handle(self, pname: str, provider) -> bool:
        history = self._health_history.get(pname, [])
        recent = history[-10:] if len(history) >= 10 else history
        failures = sum(1 for h in recent if not h)
        consecutive = 0
        for h in reversed(history[-20:]):
            if not h:
                consecutive += 1
            else:
                break

        errors = self._error_history.get(pname, [])
        diagnosis = await self.intel.analyze_errors_ai(pname, errors)

        action = diagnosis.get("action", "monitor")
        confidence = diagnosis.get("confidence", 0)
        cooldown = diagnosis.get("cooldown", COOLDOWN_DEFAULT)

        if action == "offline" or failures >= MAX_CONSECUTIVE_FAILURES:
            provider.status = ProviderStatus.OFFLINE
            provider.cooldown_until = time.time() + cooldown
            self._current_status[pname] = "offline"
            log.warn(f"  ⛔ {pname}: OFFLINE ({consecutive} consecutive fails, conf={confidence})")
            return False

        elif action == "cooldown" or failures >= 3:
            provider.status = ProviderStatus.RATE_LIMITED
            provider.cooldown_until = time.time() + cooldown
            self._current_status[pname] = "rate_limited"
            log.info(f"  ⏳ {pname}: RATE_LIMITED (cooldown {cooldown}s, conf={confidence})")
            return False

        elif action == "degrade":
            provider.status = ProviderStatus.DEGRADED
            provider.cooldown_until = time.time() + (cooldown // 2)
            self._current_status[pname] = "degraded"
            log.info(f"  ⚠️  {pname}: DEGRADED (latency/errors, conf={confidence})")
            return False

        else:
            provider.status = ProviderStatus.DEGRADED
            self._current_status[pname] = "degraded"
            return False

    def get_provider_health(self, pname: str) -> dict:
        hist = self._health_history.get(pname, [])
        recent = hist[-20:] if hist else []
        provider = self.router.providers.get(pname)
        cb_stats = getattr(provider, '_cb', None).get_stats() if provider and hasattr(provider, '_cb') else None
        return {
            "status": self._current_status.get(pname, "unknown"),
            "health_rate": sum(hist[-50:]) / max(len(hist[-50:]), 1) if hist else 0,
            "total_checks": len(hist),
            "consecutive_failures": sum(1 for h in reversed(hist[-20:]) if not h) if hist else 0,
            "avg_latency": sum(self._latency_history.get(pname, [])[-10:]) / max(len(self._latency_history.get(pname, [])[-10:]), 1) if self._latency_history.get(pname) else 0,
            "recent_errors": self._error_history.get(pname, [])[-5:],
            "circuit_breaker": cb_stats,
        }

    def get_all_health(self) -> dict:
        return {pname: self.get_provider_health(pname) for pname in self.router.providers}

    def get_summary(self) -> dict:
        statuses = {}
        cb_states = {}
        for p in self.router.providers.values():
            s = p.status
            statuses[s] = statuses.get(s, 0) + 1
            cb = getattr(p, '_cb', None)
            if cb:
                cb_states[cb.state] = cb_states.get(cb.state, 0) + 1
        return {
            "check_count": self._check_count,
            "total": len(self.router.providers),
            "by_status": statuses,
            "circuit_breaker_states": cb_states,
            "online_pct": round(statuses.get("online", 0) / max(len(self.router.providers), 1) * 100, 1),
        }

    async def _auto_retry_offline(self):
        while self._running:
            await asyncio.sleep(600)
            for pname, provider in list(self.router.providers.items()):
                if provider.status == ProviderStatus.OFFLINE and provider.cooldown_until < time.time():
                    log.info(f"  🔄 {pname}: attempting retry after cooldown...")
                    try:
                        ok = await provider.check_health()
                        if ok:
                            provider.status = ProviderStatus.ONLINE
                            self._current_status[pname] = "online"
                            log.info(f"  ✅ {pname}: back online!")
                    except: pass

    async def start_with_retry(self):
        asyncio.create_task(self.start())
        asyncio.create_task(self._auto_retry_offline())
