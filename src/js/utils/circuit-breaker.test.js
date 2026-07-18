import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { CircuitBreaker, CircuitBreakerRegistry, FAILURE_KINDS } from './circuit-breaker.js';

describe('CircuitBreaker — initial state', () => {
  const cb = new CircuitBreaker('test');

  it('should start CLOSED', () => {
    assert.equal(cb.isClosed, true);
    assert.equal(cb.isAvailable, true);
  });

  it('should allow attempts initially', () => {
    assert.equal(cb.canAttempt(), true);
    assert.equal(cb.attempt(), true);
  });

  it('should have zero cooldown initially', () => {
    assert.equal(cb.getRemainingCooldown(), 0);
  });
});

describe('CircuitBreaker — failure transitions', () => {
  it('should transition to DEGRADED at 60% threshold', () => {
    const cb = new CircuitBreaker('degrade-test', { failureThreshold: 5 });
    // 3 failures = 60% of 5 = degraded threshold
    cb.recordFailure(FAILURE_KINDS.TRANSIENT);
    cb.recordFailure(FAILURE_KINDS.TRANSIENT);
    cb.recordFailure(FAILURE_KINDS.TRANSIENT);
    assert.equal(cb.isDegraded, true);
    assert.equal(cb.isAvailable, true);
  });

  it('should transition to OPEN at full threshold', () => {
    const cb = new CircuitBreaker('open-test', { failureThreshold: 5 });
    for (let i = 0; i < 5; i++) {
      cb.recordFailure(FAILURE_KINDS.TRANSIENT);
    }
    assert.equal(cb.isOpen, true);
    assert.equal(cb.isAvailable, false);
  });

  it('should not allow attempts when OPEN', () => {
    const cb = new CircuitBreaker('no-attempt-test', { failureThreshold: 3, resetTimeout: 60000 });
    for (let i = 0; i < 3; i++) {
      cb.recordFailure(FAILURE_KINDS.TRANSIENT);
    }
    assert.equal(cb.canAttempt(), false);
    assert.equal(cb.attempt(), false);
  });

  it('should report non-zero cooldown when OPEN', () => {
    const cb = new CircuitBreaker('cooldown-test', { failureThreshold: 2, resetTimeout: 60000 });
    cb.recordFailure(FAILURE_KINDS.TRANSIENT);
    cb.recordFailure(FAILURE_KINDS.TRANSIENT);
    assert.ok(cb.getRemainingCooldown() > 0);
    assert.ok(cb.getRemainingCooldown() <= 60000);
  });
});

describe('CircuitBreaker — HALF_OPEN recovery', () => {
  it('should transition to HALF_OPEN after resetTimeout', () => {
    const cb = new CircuitBreaker('halfopen-test', { failureThreshold: 2, resetTimeout: 1 });
    cb.recordFailure(FAILURE_KINDS.TRANSIENT);
    cb.recordFailure(FAILURE_KINDS.TRANSIENT);
    assert.equal(cb.isOpen, true);
    // Simulate time passing to exceed the 1ms resetTimeout
    cb.openedAt = Date.now() - 5;
    const result = cb.canAttempt();
    assert.equal(result, true);
    assert.equal(cb.isHalfOpen, true);
  });

  it('should recover to CLOSED on success in HALF_OPEN', () => {
    const cb = new CircuitBreaker('recover-test', { failureThreshold: 2, resetTimeout: 1 });
    cb.recordFailure(FAILURE_KINDS.TRANSIENT);
    cb.recordFailure(FAILURE_KINDS.TRANSIENT);
    cb.openedAt = Date.now() - 5;
    cb.canAttempt(); // transitions to HALF_OPEN
    cb.recordSuccess();
    assert.equal(cb.isClosed, true);
    assert.equal(cb.failureCount, 0);
  });

  it('should re-OPEN on failure in HALF_OPEN', () => {
    const cb = new CircuitBreaker('reopen-test', { failureThreshold: 2, resetTimeout: 1 });
    cb.recordFailure(FAILURE_KINDS.TRANSIENT);
    cb.recordFailure(FAILURE_KINDS.TRANSIENT);
    cb.canAttempt(); // transitions to HALF_OPEN
    cb.recordFailure(FAILURE_KINDS.TRANSIENT);
    assert.equal(cb.isOpen, true);
  });
});

describe('CircuitBreaker — kind-specific thresholds', () => {
  it('should OPEN immediately on AUTH_FAILURE', () => {
    const cb = new CircuitBreaker('auth-test', { failureThreshold: 10 });
    cb.recordFailure(FAILURE_KINDS.AUTH_FAILURE);
    assert.equal(cb.isOpen, true);
  });

  it('should OPEN after 2 RATE_LIMIT failures', () => {
    const cb = new CircuitBreaker('ratelimit-test', { failureThreshold: 10 });
    cb.recordFailure(FAILURE_KINDS.RATE_LIMIT);
    assert.equal(cb.isOpen, false);
    cb.recordFailure(FAILURE_KINDS.RATE_LIMIT);
    assert.equal(cb.isOpen, true);
  });

  it('should OPEN immediately on QUOTA_EXHAUSTED', () => {
    const cb = new CircuitBreaker('quota-test', { failureThreshold: 10 });
    cb.recordFailure(FAILURE_KINDS.QUOTA_EXHAUSTED);
    assert.equal(cb.isOpen, true);
  });
});

describe('CircuitBreaker — reset', () => {
  it('should reset to CLOSED state', () => {
    const cb = new CircuitBreaker('reset-test', { failureThreshold: 2 });
    cb.recordFailure(FAILURE_KINDS.TRANSIENT);
    cb.recordFailure(FAILURE_KINDS.TRANSIENT);
    assert.equal(cb.isOpen, true);
    cb.reset();
    assert.equal(cb.isClosed, true);
    assert.equal(cb.failureCount, 0);
  });
});

describe('CircuitBreakerRegistry', () => {
  const registry = new CircuitBreakerRegistry();

  it('should create and return a breaker', () => {
    const cb = registry.getOrCreate('provider-a');
    assert.ok(cb instanceof CircuitBreaker);
    assert.equal(cb.name, 'provider-a');
  });

  it('should return existing breaker on duplicate get', () => {
    const cb1 = registry.getOrCreate('provider-a');
    const cb2 = registry.getOrCreate('provider-a');
    assert.equal(cb1, cb2);
  });

  it('should return undefined for unknown breaker', () => {
    assert.equal(registry.get('unknown'), undefined);
  });

  it('should cleanup old breakers', () => {
    const old = registry.getOrCreate('old-provider');
    old.lastStateChange = Date.now() - 3600000;
    registry.cleanup(60000);
    assert.equal(registry.get('old-provider'), undefined);
  });
});
