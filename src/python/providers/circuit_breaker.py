import time

class CircuitState:
    CLOSED = "CLOSED"
    DEGRADED = "DEGRADED"
    OPEN = "OPEN"
    HALF_OPEN = "HALF_OPEN"

class FailureKind:
    RATE_LIMIT = "rate_limit"
    QUOTA_EXHAUSTED = "quota_exhausted"
    TRANSIENT = "transient"
    AUTH_FAILURE = "auth_failure"
    TIMEOUT = "timeout"
    SERVER_ERROR = "server_error"
    NETWORK_ERROR = "network_error"
    UNKNOWN = "unknown"

class CircuitBreaker:
    def __init__(self, name, options=None):
        opts = options or {}
        self.name = name
        self.state = CircuitState.CLOSED
        self.failure_count = 0
        self.success_count = 0
        self.last_failure_time = None
        self.last_state_change = time.time()
        self.opened_at = None

        self.failure_threshold = opts.get("failure_threshold", 5)
        self.degraded_threshold = max(1, int(self.failure_threshold * 0.6))
        self.reset_timeout = opts.get("reset_timeout", 30)
        self.half_open_max_attempts = opts.get("half_open_max_attempts", 1)
        self.half_open_attempts = 0
        self.escalation_factor = opts.get("escalation_factor", 2)
        self.max_reset_timeout = opts.get("max_reset_timeout", 300)

        kind_defaults = {
            FailureKind.RATE_LIMIT: 60,
            FailureKind.QUOTA_EXHAUSTED: 3600,
            FailureKind.AUTH_FAILURE: 1800,
            FailureKind.TRANSIENT: 10,
        }
        kind_defaults.update(opts.get("cooldown_by_kind") or {})
        self.cooldown_by_kind = kind_defaults

        threshold_defaults = {
            FailureKind.RATE_LIMIT: 2,
            FailureKind.QUOTA_EXHAUSTED: 1,
            FailureKind.AUTH_FAILURE: 1,
        }
        threshold_defaults.update(opts.get("threshold_by_kind") or {})
        self.threshold_by_kind = threshold_defaults

        self.kind_failures = {}
        self.transition_history = []
        self.max_history_size = 20

    @property
    def is_open(self):
        return self.state == CircuitState.OPEN

    @property
    def is_degraded(self):
        return self.state == CircuitState.DEGRADED

    @property
    def is_closed(self):
        return self.state == CircuitState.CLOSED

    @property
    def is_half_open(self):
        return self.state == CircuitState.HALF_OPEN

    @property
    def is_available(self):
        return self.state in (CircuitState.CLOSED, CircuitState.HALF_OPEN, CircuitState.DEGRADED)

    def record_success(self):
        self.success_count += 1
        if self.state == CircuitState.HALF_OPEN:
            self._transition(CircuitState.CLOSED)
            self.failure_count = 0
            self.kind_failures.clear()
            self.half_open_attempts = 0
        elif self.state == CircuitState.DEGRADED and self.success_count >= 3:
            self._transition(CircuitState.CLOSED)
            self.failure_count = max(0, self.failure_count - 1)

    def record_failure(self, kind=FailureKind.UNKNOWN):
        self.failure_count += 1
        self.last_failure_time = time.time()

        kind_count = self.kind_failures.get(kind, 0) + 1
        self.kind_failures[kind] = kind_count

        kind_threshold = self.threshold_by_kind.get(kind)
        if kind_threshold and kind_count >= kind_threshold:
            self._transition(CircuitState.OPEN)
            self.opened_at = time.time()
            kind_cooldown = self.cooldown_by_kind.get(kind, self.reset_timeout)
            self.reset_timeout = min(kind_cooldown, self.max_reset_timeout)
            return

        if self.state == CircuitState.HALF_OPEN:
            self._transition(CircuitState.OPEN)
            self.opened_at = time.time()
            self.reset_timeout = min(self.reset_timeout * self.escalation_factor, self.max_reset_timeout)
            self.half_open_attempts = 0
        elif self.state == CircuitState.CLOSED and self.failure_count >= self.degraded_threshold:
            self._transition(CircuitState.DEGRADED)
        elif self.failure_count >= self.failure_threshold:
            self._transition(CircuitState.OPEN)
            self.opened_at = time.time()

    def attempt(self):
        if self.state in (CircuitState.CLOSED, CircuitState.DEGRADED):
            return True
        if self.state == CircuitState.HALF_OPEN:
            if self.half_open_attempts < self.half_open_max_attempts:
                self.half_open_attempts += 1
                return True
            return False
        if self.state == CircuitState.OPEN:
            elapsed = time.time() - (self.opened_at or 0)
            if elapsed >= self.reset_timeout:
                self._transition(CircuitState.HALF_OPEN)
                self.half_open_attempts = 0
                return True
            return False
        return False

    def get_remaining_cooldown(self):
        if self.state != CircuitState.OPEN:
            return 0
        elapsed = time.time() - (self.opened_at or 0)
        return max(0, self.reset_timeout - elapsed)

    def reset(self):
        self.state = CircuitState.CLOSED
        self.failure_count = 0
        self.success_count = 0
        self.kind_failures.clear()
        self.half_open_attempts = 0
        self.opened_at = None
        self.last_state_change = time.time()

    def _transition(self, new_state):
        old_state = self.state
        if old_state == new_state:
            return
        self.state = new_state
        self.last_state_change = time.time()
        self.transition_history.append({
            "from": old_state,
            "to": new_state,
            "timestamp": time.time(),
            "failure_count": self.failure_count,
        })
        if len(self.transition_history) > self.max_history_size:
            self.transition_history.pop(0)

    def get_stats(self):
        return {
            "name": self.name,
            "state": self.state,
            "failure_count": self.failure_count,
            "success_count": self.success_count,
            "last_failure_time": self.last_failure_time,
            "last_state_change": self.last_state_change,
            "remaining_cooldown": self.get_remaining_cooldown(),
            "kind_failures": dict(self.kind_failures),
            "transition_history": self.transition_history[-5:],
        }

class CircuitBreakerRegistry:
    def __init__(self):
        self.breakers = {}

    def get_or_create(self, name, options=None):
        if name not in self.breakers:
            self.breakers[name] = CircuitBreaker(name, options)
        return self.breakers[name]

    def get(self, name):
        return self.breakers.get(name)

    def cleanup(self, max_age=300):
        now = time.time()
        to_delete = [n for n, b in self.breakers.items()
                     if b.state == CircuitState.CLOSED and (now - b.last_state_change) > max_age]
        for name in to_delete:
            del self.breakers[name]

    def get_stats(self):
        return {n: b.get_stats() for n, b in self.breakers.items()}
