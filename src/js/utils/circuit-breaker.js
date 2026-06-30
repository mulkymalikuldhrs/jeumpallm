// utils/circuit-breaker.js
// Circuit Breaker — 4-state model with adaptive backoff (inspired by OmniRoute)
// CLOSED → DEGRADED → OPEN → HALF_OPEN

const STATES = {
  CLOSED: 'CLOSED',
  DEGRADED: 'DEGRADED', 
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN'
};

const FAILURE_KINDS = {
  RATE_LIMIT: 'rate_limit',
  QUOTA_EXHAUSTED: 'quota_exhausted',
  TRANSIENT: 'transient',
  AUTH_FAILURE: 'auth_failure',
  TIMEOUT: 'timeout',
  SERVER_ERROR: 'server_error',
  NETWORK_ERROR: 'network_error',
  UNKNOWN: 'unknown'
};

export class CircuitBreaker {
  constructor(name, options = {}) {
    this.name = name;
    this.state = STATES.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    this.lastStateChange = Date.now();
    this.openedAt = null;
    
    // Configuration
    this.failureThreshold = options.failureThreshold || 5;
    this.degradedThreshold = Math.floor((options.failureThreshold || 5) * 0.6);
    this.resetTimeout = options.resetTimeout || 30000; // Time before HALF_OPEN probe
    this.halfOpenMaxAttempts = options.halfOpenMaxAttempts || 1;
    this.halfOpenAttempts = 0;
    this.escalationFactor = options.escalationFactor || 2;
    this.maxResetTimeout = options.maxResetTimeout || 300000; // 5 minutes max
    
    // Kind-specific cooldowns
    this.cooldownByKind = {
      [FAILURE_KINDS.RATE_LIMIT]: 60000,
      [FAILURE_KINDS.QUOTA_EXHAUSTED]: 3600000,
      [FAILURE_KINDS.AUTH_FAILURE]: 1800000,
      [FAILURE_KINDS.TRANSIENT]: 10000,
      ...options.cooldownByKind
    };
    
    // Kind-specific failure thresholds
    this.thresholdByKind = {
      [FAILURE_KINDS.RATE_LIMIT]: 2,
      [FAILURE_KINDS.QUOTA_EXHAUSTED]: 1,
      [FAILURE_KINDS.AUTH_FAILURE]: 1,
      ...options.thresholdByKind
    };
    
    // Tracking
    this.kindFailures = new Map();
    this.transitionHistory = [];
    this.maxHistorySize = 20;
  }

  get isOpen() { return this.state === STATES.OPEN; }
  get isDegraded() { return this.state === STATES.DEGRADED; }
  get isClosed() { return this.state === STATES.CLOSED; }
  get isHalfOpen() { return this.state === STATES.HALF_OPEN; }
  get isAvailable() { return this.state === STATES.CLOSED || this.state === STATES.HALF_OPEN || this.state === STATES.DEGRADED; }

  recordSuccess() {
    this.successCount++;
    if (this.state === STATES.HALF_OPEN) {
      this._transition(STATES.CLOSED);
      this.failureCount = 0;
      this.kindFailures.clear();
      this.halfOpenAttempts = 0;
    } else if (this.state === STATES.DEGRADED && this.successCount >= 3) {
      this._transition(STATES.CLOSED);
      this.failureCount = Math.max(0, this.failureCount - 1);
    }
  }

  recordFailure(kind = FAILURE_KINDS.UNKNOWN) {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    // Track kind-specific failures
    const kindCount = (this.kindFailures.get(kind) || 0) + 1;
    this.kindFailures.set(kind, kindCount);
    
    // Check kind-specific threshold
    const kindThreshold = this.thresholdByKind[kind];
    if (kindThreshold && kindCount >= kindThreshold) {
      this._transition(STATES.OPEN);
      this.openedAt = Date.now();
      // Apply kind-specific cooldown as reset timeout
      const kindCooldown = this.cooldownByKind[kind] || this.resetTimeout;
      this.resetTimeout = Math.min(kindCooldown, this.maxResetTimeout);
      return;
    }
    
    // State transitions based on failure count
    if (this.state === STATES.HALF_OPEN) {
      this._transition(STATES.OPEN);
      this.openedAt = Date.now();
      // Escalate reset timeout
      this.resetTimeout = Math.min(this.resetTimeout * this.escalationFactor, this.maxResetTimeout);
      this.halfOpenAttempts = 0;
    } else if (this.state === STATES.CLOSED && this.failureCount >= this.degradedThreshold) {
      this._transition(STATES.DEGRADED);
    } else if (this.failureCount >= this.failureThreshold) {
      this._transition(STATES.OPEN);
      this.openedAt = Date.now();
    }
  }

  canAttempt() {
    if (this.state === STATES.CLOSED || this.state === STATES.DEGRADED) return true;
    if (this.state === STATES.HALF_OPEN) {
      return this.halfOpenAttempts < this.halfOpenMaxAttempts;
    }
    if (this.state === STATES.OPEN) {
      const elapsed = Date.now() - (this.openedAt || 0);
      if (elapsed >= this.resetTimeout) {
        this._transition(STATES.HALF_OPEN);
        this.halfOpenAttempts = 0;
        return true;
      }
      return false;
    }
    return false;
  }

  attempt() {
    if (!this.canAttempt()) return false;
    if (this.state === STATES.HALF_OPEN) this.halfOpenAttempts++;
    return true;
  }

  getRemainingCooldown() {
    if (this.state !== STATES.OPEN) return 0;
    const elapsed = Date.now() - (this.openedAt || 0);
    return Math.max(0, this.resetTimeout - elapsed);
  }

  reset() {
    this.state = STATES.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.kindFailures.clear();
    this.halfOpenAttempts = 0;
    this.openedAt = null;
    this.lastStateChange = Date.now();
  }

  _transition(newState) {
    const oldState = this.state;
    if (oldState === newState) return;
    this.state = newState;
    this.lastStateChange = Date.now();
    this.transitionHistory.push({
      from: oldState,
      to: newState,
      timestamp: Date.now(),
      failureCount: this.failureCount
    });
    if (this.transitionHistory.length > this.maxHistorySize) {
      this.transitionHistory.shift();
    }
  }

  getStats() {
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      lastStateChange: this.lastStateChange,
      remainingCooldown: this.getRemainingCooldown(),
      kindFailures: Object.fromEntries(this.kindFailures),
      transitionHistory: this.transitionHistory.slice(-5)
    };
  }
}

// Circuit Breaker Registry — manages breakers per provider
export class CircuitBreakerRegistry {
  constructor() {
    this.breakers = new Map();
  }

  getOrCreate(name, options = {}) {
    if (!this.breakers.has(name)) {
      this.breakers.set(name, new CircuitBreaker(name, options));
    }
    return this.breakers.get(name);
  }

  get(name) {
    return this.breakers.get(name);
  }

  // Cleanup idle CLOSED breakers every 5 minutes
  cleanup(maxAgeMs = 300000) {
    const now = Date.now();
    for (const [name, breaker] of this.breakers) {
      if (breaker.state === STATES.CLOSED && (now - breaker.lastStateChange) > maxAgeMs) {
        this.breakers.delete(name);
      }
    }
  }

  getStats() {
    const stats = {};
    for (const [name, breaker] of this.breakers) {
      stats[name] = breaker.getStats();
    }
    return stats;
  }
}

export { STATES, FAILURE_KINDS };
export default CircuitBreaker;
