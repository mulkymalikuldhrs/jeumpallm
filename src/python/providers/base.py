import time, json, hashlib
from typing import Optional, AsyncIterator
from dataclasses import dataclass, field
from .circuit_breaker import CircuitBreaker, FailureKind

@dataclass
class ProviderConfig:
    name: str
    type: str
    base_url: Optional[str] = None
    api_key: Optional[str] = None
    models: list = field(default_factory=list)
    priority: int = 10
    weight: int = 1
    timeout: int = 60
    max_retries: int = 2
    rpm_limit: int = 0
    tpm_limit: int = 0
    extra: dict = field(default_factory=dict)

    @property
    def model_list(self):
        return self.models

    @model_list.setter
    def model_list(self, value):
        self.models = value

class ProviderStatus:
    ONLINE = "online"
    OFFLINE = "offline"
    DEGRADED = "degraded"
    RATE_LIMITED = "rate_limited"
    UNKNOWN = "unknown"

class BaseProvider:
    def __init__(self, config: ProviderConfig):
        self.config = config
        self.name = config.name
        self.status = ProviderStatus.UNKNOWN
        self._healthy = None
        self.latency_ms = 0
        self.total_requests = 0
        self.failed_requests = 0
        self.last_error = None
        self.last_used = 0
        self.cooldown_until = 0
        self.rpm_count = []
        self.tpm_count = []
        self.last_status_code = 0
        self.models_listed = []
        self.provider_category = "unknown"
        self.discovery_source = "config"
        self.last_success_time = 0
        self.consecutive_successes = 0
        self.consecutive_failures = 0
        self.detected_capabilities: list[str] = []
        self._cb = CircuitBreaker(self.name)

    def can_attempt(self) -> bool:
        return self._cb.attempt()

    def record_success(self):
        self._cb.record_success()

    def record_failure(self, kind: str = FailureKind.UNKNOWN):
        self._cb.record_failure(kind)

    @staticmethod
    def _classify_error(status_code: int, error_text: str = "") -> str:
        if status_code == 429 or "rate limit" in error_text.lower() or "too many" in error_text.lower():
            return FailureKind.RATE_LIMIT
        if status_code in (401, 403) or "unauthorized" in error_text.lower() or "forbidden" in error_text.lower():
            return FailureKind.AUTH_FAILURE
        if status_code in (408, 504) or "timeout" in error_text.lower() or "timed out" in error_text.lower():
            return FailureKind.TIMEOUT
        if "quota" in error_text.lower() or "exhausted" in error_text.lower() or "insufficient" in error_text.lower():
            return FailureKind.QUOTA_EXHAUSTED
        if 500 <= status_code < 600:
            return FailureKind.SERVER_ERROR
        if not status_code or "connection" in error_text.lower() or "resolve" in error_text.lower() or "eof" in error_text.lower():
            return FailureKind.NETWORK_ERROR
        return FailureKind.UNKNOWN

    def check_rate_limit(self) -> bool:
        now = time.time()
        self.rpm_count = [t for t in self.rpm_count if now - t < 60]
        self.tpm_count = [t for t in self.tpm_count if now - t < 60]
        if self.config.rpm_limit and len(self.rpm_count) >= self.config.rpm_limit:
            return False
        return True

    async def chat_completion(self, messages: list, model: str = None,
                              stream: bool = False, **kwargs) -> dict | AsyncIterator:
        raise NotImplementedError

    async def check_health(self) -> bool:
        return True

    def to_dict(self):
        return {
            "name": self.name,
            "type": self.config.type,
            "status": self.status,
            "latency_ms": self.latency_ms,
            "models": self.config.model_list,
            "total_requests": self.total_requests,
            "failed_requests": self.failed_requests,
            "last_error": self.last_error,
            "priority": self.config.priority,
            "healthy": self.status == ProviderStatus.ONLINE,
            "category": getattr(self, 'provider_category', 'unknown'),
            "source": getattr(self, 'discovery_source', 'config'),
            "models_listed": getattr(self, 'models_listed', []),
            "capabilities": getattr(self, 'detected_capabilities', []),
            "cooldown_remaining": max(0, int(self.cooldown_until - time.time())) if self.cooldown_until else 0,
            "circuit_breaker": self._cb.get_stats(),
        }
