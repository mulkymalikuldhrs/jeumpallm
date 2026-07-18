"""Circuit Breaker — 4-state resilience pattern with failure classification."""

import time
import enum
import logging
from typing import Dict, Optional, List, Callable, Any
from dataclasses import dataclass, field
from collections import deque

logger = logging.getLogger(__name__)


class CircuitState(enum.Enum):
    CLOSED = 'closed'
    DEGRADED = 'degraded'
    OPEN = 'open'
    HALF_OPEN = 'half_open'


class FailureKind(enum.Enum):
    RATE_LIMIT = 'rate_limit'
    QUOTA = 'quota'
    AUTH = 'auth'
    TRANSIENT = 'transient'
    TIMEOUT = 'timeout'
    SERVER_ERROR = 'server_error'
    NETWORK = 'network'
    UNKNOWN = 'unknown'


FAILURE_THRESHOLDS = {
    FailureKind.QUOTA: 1,
    FailureKind.AUTH: 1,
    FailureKind.RATE_LIMIT: 2,
    FailureKind.TRANSIENT: 5,
    FailureKind.TIMEOUT: 3,
    FailureKind.SERVER_ERROR: 3,
    FailureKind.NETWORK: 3,
    FailureKind.UNKNOWN: 3,
}


class CircuitBreaker:
    """Tracks health of one service with state transitions."""

    def __init__(self, name: str, reset_timeout: float = 30.0,
                 half_open_max_requests: int = 3,
                 failure_window: int = 60,
                 success_threshold: int = 5,
                 escalation_factor: float = 2.0):
        self.name = name
        self.state = CircuitState.CLOSED
        self.reset_timeout = reset_timeout
        self.half_open_max_requests = half_open_max_requests
        self.failure_window = failure_window
        self.success_threshold = success_threshold
        self.escalation_factor = escalation_factor

        self._failure_counts: Dict[FailureKind, int] = {}
        self._consecutive_failures = 0
        self._consecutive_successes = 0
        self._last_failure_time = 0.0
        self._last_state_change = time.time()
        self._half_open_requests = 0
        self._transition_history: List[Dict] = []
        self._last_failure_kind: Optional[FailureKind] = None

    def _classify_failure(self, error: Exception) -> FailureKind:
        msg = str(error).lower()
        if 'rate' in msg and 'limit' in msg:
            return FailureKind.RATE_LIMIT
        if any(w in msg for w in ['quota', 'exhausted', 'insufficient_quota']):
            return FailureKind.QUOTA
        if any(w in msg for w in ['auth', 'unauthorized', 'forbidden', 'apikey', 'token']):
            return FailureKind.AUTH
        if any(w in msg for w in ['timeout', 'timed out']):
            return FailureKind.TIMEOUT
        if any(w in msg for w in ['network', 'econnrefused', 'econnreset', 'enotfound']):
            return FailureKind.NETWORK
        if any(w in msg for w in ['5', 'server error', 'internal']):
            return FailureKind.SERVER_ERROR
        if any(w in msg for w in ['temporary', 'transient', 'retry']):
            return FailureKind.TRANSIENT
        return FailureKind.UNKNOWN

    def _should_open(self, kind: FailureKind) -> bool:
        threshold = FAILURE_THRESHOLDS.get(kind, FAILURE_THRESHOLDS[FailureKind.UNKNOWN])
        count = self._failure_counts.get(kind, 0)
        return count >= threshold

    def _transition_to(self, new_state: CircuitState):
        old_state = self.state
        self.state = new_state
        self._last_state_change = time.time()
        self._transition_history.append({
            'from': old_state.value,
            'to': new_state.value,
            'time': time.time(),
            'reason': f'{self._last_failure_kind.value if self._last_failure_kind else "unknown"}'
        })
        if len(self._transition_history) > 20:
            self._transition_history.pop(0)
        logger.info(f'CircuitBreaker [{self.name}]: {old_state.value} -> {new_state.value}')

    def record_failure(self, error: Exception):
        kind = self._classify_failure(error)
        self._last_failure_kind = kind
        self._consecutive_failures += 1
        self._consecutive_successes = 0
        self._last_failure_time = time.time()

        self._failure_counts[kind] = self._failure_counts.get(kind, 0) + 1

        if self.state == CircuitState.CLOSED:
            if self._should_open(kind):
                self._transition_to(CircuitState.OPEN)
            elif self._consecutive_failures >= 3:
                self._transition_to(CircuitState.DEGRADED)
        elif self.state == CircuitState.HALF_OPEN:
            self._transition_to(CircuitState.OPEN)

    def record_success(self):
        self._consecutive_successes += 1
        self._consecutive_failures = 0

        if self.state == CircuitState.DEGRADED and self._consecutive_successes >= self.success_threshold:
            self._transition_to(CircuitState.CLOSED)
            self._failure_counts.clear()
        elif self.state == CircuitState.HALF_OPEN:
            self._half_open_requests += 1
            if self._half_open_requests >= self.half_open_max_requests:
                self._transition_to(CircuitState.CLOSED)
                self._failure_counts.clear()
                self._half_open_requests = 0

    def allow_request(self) -> bool:
        now = time.time()

        if self.state == CircuitState.CLOSED:
            return True
        elif self.state == CircuitState.DEGRADED:
            return True
        elif self.state == CircuitState.OPEN:
            elapsed = now - self._last_state_change
            if elapsed >= self.reset_timeout:
                self.reset_timeout *= self.escalation_factor
                self._transition_to(CircuitState.HALF_OPEN)
                self._half_open_requests = 0
                return True
            return False
        elif self.state == CircuitState.HALF_OPEN:
            return self._half_open_requests < self.half_open_max_requests

        return True

    def get_state(self) -> Dict:
        return {
            'name': self.name,
            'state': self.state.value,
            'reset_timeout': self.reset_timeout,
            'consecutive_failures': self._consecutive_failures,
            'consecutive_successes': self._consecutive_successes,
            'failure_counts': {k.value: v for k, v in self._failure_counts.items()},
            'last_failure': self._last_failure_time,
            'last_failure_kind': self._last_failure_kind.value if self._last_failure_kind else None,
            'last_state_change': self._last_state_change,
        }

    def get_transition_history(self) -> List[Dict]:
        return self._transition_history


class CircuitBreakerRegistry:
    """Manages all circuit breakers."""

    def __init__(self, idle_timeout: float = 3600.0):
        self._breakers: Dict[str, CircuitBreaker] = {}
        self.idle_timeout = idle_timeout

    def get(self, name: str) -> CircuitBreaker:
        if name not in self._breakers:
            self._breakers[name] = CircuitBreaker(name)
        return self._breakers[name]

    def record_failure(self, name: str, error: Exception):
        self.get(name).record_failure(error)

    def record_success(self, name: str):
        self.get(name).record_success()

    def allow_request(self, name: str) -> bool:
        return self.get(name).allow_request()

    def get_all_states(self) -> Dict[str, Dict]:
        return {name: cb.get_state() for name, cb in self._breakers.items()}

    def get_all_histories(self) -> Dict[str, List[Dict]]:
        return {name: cb.get_transition_history() for name, cb in self._breakers.items()}

    def cleanup_idle(self):
        now = time.time()
        idle_names = []
        for name, cb in self._breakers.items():
            if now - cb._last_state_change > self.idle_timeout and cb.state == CircuitState.CLOSED:
                idle_names.append(name)
        for name in idle_names:
            del self._breakers[name]


_registry: Optional[CircuitBreakerRegistry] = None


def get_registry() -> CircuitBreakerRegistry:
    global _registry
    if _registry is None:
        _registry = CircuitBreakerRegistry()
    return _registry


def with_circuit_breaker(name: str):
    """Decorator: wrap async function with circuit breaker."""
    def decorator(func: Callable):
        async def wrapper(*args, **kwargs):
            registry = get_registry()
            if not registry.allow_request(name):
                raise Exception(f'Circuit breaker [{name}] is OPEN — request blocked')
            try:
                result = await func(*args, **kwargs)
                registry.record_success(name)
                return result
            except Exception as e:
                registry.record_failure(name, e)
                raise
        return wrapper
    return decorator
