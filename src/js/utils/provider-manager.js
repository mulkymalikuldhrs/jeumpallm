// utils/provider-manager.js
// Provider Manager — Round-robin routing, failover, health checks, circuit breaker
// v6.0.0 — OmniRoute-inspired circuit breaker + cost-aware routing

import { CircuitBreakerRegistry, FAILURE_KINDS } from './circuit-breaker.js';
import { estimateCost, estimateInputTokens } from './cost-estimator.js';
import { FREE_PROVIDERS } from '../config/providers.js';

export class ProviderManager {
  constructor(registry) {
    this.registry = registry;
    this.roundRobinIndex = new Map();
    this.circuitBreakers = new CircuitBreakerRegistry();
    this.healthCheckInterval = null;
    this.fragileCheckInterval = null;
    this.healthCheckIntervalMs = parseInt(process.env.HEALTH_CHECK_INTERVAL_MS || '60000', 10);
    this.fragileCheckIntervalMs = parseInt(process.env.FRAGILE_CHECK_INTERVAL_MS || '300000', 10);
    this.fragileProviders = ['g4f', 'blackbox', 'phind'];
    this._requestCount = 0;
    this._totalCost = 0;
  }

  async start() {
    await this.runHealthChecks();
    this.healthCheckInterval = setInterval(() => {
      this.runHealthChecks().catch(err => 
        console.error('[PROVIDER-MGR] Health check error:', err.message)
      );
    }, this.healthCheckIntervalMs);

    // Fragile providers get their own health check interval
    this._startFragileHealthChecks();

    // Cleanup idle circuit breakers every 5 minutes
    setInterval(() => this.circuitBreakers.cleanup(), 300000);

    console.log(`[PROVIDER-MGR] Started with ${this.registry.getEnabledProviders().length} providers, health check every ${this.healthCheckIntervalMs}ms`);
  }

  stop() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    if (this.fragileCheckInterval) {
      clearInterval(this.fragileCheckInterval);
      this.fragileCheckInterval = null;
    }
  }

  _startFragileHealthChecks() {
    this.fragileCheckInterval = setInterval(() => {
      this.fragileProviders.forEach(name => {
        const provider = this.registry.getProvider(name);
        if (!provider?.enabled) return;
        const breaker = this.circuitBreakers.getOrCreate(provider.name);
        if (breaker.isOpen) return;
        provider.checkHealth()
          .then(() => {
            provider.healthStatus = 'healthy';
            breaker.recordSuccess();
          })
          .catch(() => {
            provider.healthStatus = provider.healthStatus === 'healthy' ? 'degraded' : 'down';
            breaker.recordFailure(FAILURE_KINDS.NETWORK_ERROR);
          });
      });
    }, this.fragileCheckIntervalMs);
  }

  async runHealthChecks() {
    const providers = this.registry.getEnabledProviders();
    const results = await Promise.allSettled(
      providers.map(async (provider) => {
        const breaker = this.circuitBreakers.getOrCreate(provider.name);
        if (breaker.isOpen) {
          // Skip health check if circuit is open
          return { name: provider.name, status: 'circuit_open', skipped: true };
        }
        try {
          const start = Date.now();
          await Promise.race([
            provider.checkHealth(),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Health check timeout')), 10000)
            )
          ]);
          const latency = Date.now() - start;
          provider.healthStatus = 'healthy';
          provider.lastHealthCheck = new Date().toISOString();
          provider.recordRequest(latency, true);
          breaker.recordSuccess();
          return { name: provider.name, status: 'healthy', latency };
        } catch (err) {
          provider.healthStatus = provider.healthStatus === 'healthy' ? 'degraded' : 'down';
          provider.lastHealthCheck = new Date().toISOString();
          provider.recordRequest(0, false);
          breaker.recordFailure(FAILURE_KINDS.NETWORK_ERROR);
          return { name: provider.name, status: provider.healthStatus, error: err.message };
        }
      })
    );
    
    const healthy = results.filter(r => r.status === 'fulfilled' && r.value?.status === 'healthy').length;
    const total = results.length;
    console.log(`[PROVIDER-MGR] Health check: ${healthy}/${total} providers healthy`);
    return results;
  }

  // Classify error into failure kind for circuit breaker
  _classifyError(error) {
    const msg = (error.message || '').toLowerCase();
    const status = error.status || error.statusCode || 0;

    if (status === 429 || msg.includes('rate limit') || msg.includes('too many requests')) {
      return FAILURE_KINDS.RATE_LIMIT;
    }
    if (status === 401 || status === 403 || msg.includes('unauthorized') || msg.includes('invalid api key') || msg.includes('auth')) {
      return FAILURE_KINDS.AUTH_FAILURE;
    }
    if (status === 402 || msg.includes('quota') || msg.includes('credits') || msg.includes('billing')) {
      return FAILURE_KINDS.QUOTA_EXHAUSTED;
    }
    if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('abort')) {
      return FAILURE_KINDS.TIMEOUT;
    }
    if (status >= 500) {
      return FAILURE_KINDS.SERVER_ERROR;
    }
    if (msg.includes('network') || msg.includes('econnrefused') || msg.includes('fetch failed')) {
      return FAILURE_KINDS.NETWORK_ERROR;
    }
    return FAILURE_KINDS.UNKNOWN;
  }

  // Main routing method — find best provider for a model
  async route(modelId, messages, options = {}) {
    const providers = this.registry.getProvidersForModel(modelId);
    
    if (providers.length === 0) {
      throw new Error(`No provider available for model: ${modelId}`);
    }

    // Filter out providers with open circuits
    const available = providers.filter(p => {
      const breaker = this.circuitBreakers.getOrCreate(p.name);
      return breaker.canAttempt();
    });

    if (available.length === 0) {
      // All circuits open — try round-robin on degraded ones
      const degradedCircuits = providers.filter(p => {
        const breaker = this.circuitBreakers.getOrCreate(p.name);
        return breaker.isDegraded;
      });
      if (degradedCircuits.length > 0) {
        return this._roundRobin(modelId, degradedCircuits);
      }
      // Last resort
      return providers[0];
    }

    // Sort: healthy first, then by priority, then by latency
    const sorted = available
      .sort((a, b) => {
        const healthOrder = { healthy: 0, unknown: 1, degraded: 2, down: 3 };
        const ha = healthOrder[a.healthStatus] ?? 2;
        const hb = healthOrder[b.healthStatus] ?? 2;
        if (ha !== hb) return ha - hb;
        if (a.priority !== b.priority) return a.priority - b.priority;
        return a.avgLatency - b.avgLatency;
      });

    // Use round-robin among equally-prioritized healthy providers
    const topPriority = sorted[0].priority;
    const topProviders = sorted.filter(p => p.priority === topPriority && p.healthStatus === 'healthy');
    
    if (topProviders.length > 1) {
      return this._roundRobin(modelId, topProviders);
    }
    
    return sorted[0];
  }

  _roundRobin(modelId, providers) {
    const key = modelId;
    const current = this.roundRobinIndex.get(key) || 0;
    const next = current % providers.length;
    this.roundRobinIndex.set(key, next + 1);
    return providers[next];
  }

  // Execute chat with automatic failover + circuit breaker
  async chatWithFailover(modelId, messages, options = {}) {
    const providers = this.registry.getProvidersForModel(modelId);
    
    if (providers.length === 0) {
      throw new Error(`No provider available for model: ${modelId}`);
    }

    // Pre-flight cost estimation
    const inputTokens = estimateInputTokens(messages);
    const costEstimate = estimateCost(modelId, inputTokens);

    // Sort providers by reliability + circuit breaker state
    const sorted = [...providers]
      .filter(p => p.enabled)
      .sort((a, b) => {
        // Prefer providers with closed circuits
        const breakerA = this.circuitBreakers.getOrCreate(a.name);
        const breakerB = this.circuitBreakers.getOrCreate(b.name);
        const availA = breakerA.isAvailable ? 0 : 1;
        const availB = breakerB.isAvailable ? 0 : 1;
        if (availA !== availB) return availA - availB;

        const healthOrder = { healthy: 0, unknown: 1, degraded: 2, down: 3 };
        return (healthOrder[a.healthStatus] ?? 2) - (healthOrder[b.healthStatus] ?? 2) 
               || a.priority - b.priority;
      });

    let lastError;
    for (const provider of sorted) {
      const breaker = this.circuitBreakers.getOrCreate(provider.name);
      if (!breaker.attempt()) {
        console.warn(`[PROVIDER-MGR] ${provider.name} circuit breaker blocked (state: ${breaker.state})`);
        continue;
      }

      const startTime = Date.now();
      try {
        const result = await provider.chat(messages, { ...options, model: modelId });
        const latency = Date.now() - startTime;
        provider.recordRequest(latency, true);
        provider.healthStatus = 'healthy';
        breaker.recordSuccess();
        this._requestCount++;
        this._totalCost += costEstimate.isFree ? 0 : costEstimate.totalCost;

        return { 
          result, 
          provider: provider.name, 
          latency,
          costEstimate,
          circuitBreaker: breaker.state
        };
      } catch (err) {
        const latency = Date.now() - startTime;
        provider.recordRequest(latency, false);
        
        const failureKind = this._classifyError(err);
        breaker.recordFailure(failureKind);
        
        if (provider.healthStatus === 'healthy') {
          provider.healthStatus = 'degraded';
        } else if (provider.healthStatus === 'degraded') {
          provider.healthStatus = 'down';
        }
        lastError = err;
        console.warn(`[PROVIDER-MGR] ${provider.name} failed for ${modelId} (${failureKind}): ${err.message}, trying next...`);
      }
    }

    throw lastError || new Error(`All providers failed for model: ${modelId}`);
  }

  // Execute streaming chat with automatic failover + circuit breaker
  async chatStreamWithFailover(modelId, messages, options = {}) {
    const providers = this.registry.getProvidersForModel(modelId);
    
    if (providers.length === 0) {
      throw new Error(`No provider available for model: ${modelId}`);
    }

    const sorted = [...providers]
      .filter(p => p.enabled)
      .sort((a, b) => {
        const breakerA = this.circuitBreakers.getOrCreate(a.name);
        const breakerB = this.circuitBreakers.getOrCreate(b.name);
        const availA = breakerA.isAvailable ? 0 : 1;
        const availB = breakerB.isAvailable ? 0 : 1;
        if (availA !== availB) return availA - availB;

        const healthOrder = { healthy: 0, unknown: 1, degraded: 2, down: 3 };
        return (healthOrder[a.healthStatus] ?? 2) - (healthOrder[b.healthStatus] ?? 2)
               || a.priority - b.priority;
      });

    let lastError;
    for (const provider of sorted) {
      const breaker = this.circuitBreakers.getOrCreate(provider.name);
      if (!breaker.attempt()) {
        console.warn(`[PROVIDER-MGR] ${provider.name} circuit breaker blocked for streaming (state: ${breaker.state})`);
        continue;
      }

      try {
        const stream = await provider.chatStream(messages, { ...options, model: modelId });
        breaker.recordSuccess();
        return { stream, provider: provider.name, circuitBreaker: breaker.state };
      } catch (err) {
        const failureKind = this._classifyError(err);
        breaker.recordFailure(failureKind);
        lastError = err;
        console.warn(`[PROVIDER-MGR] ${provider.name} stream failed for ${modelId} (${failureKind}): ${err.message}, trying next...`);
      }
    }

    throw lastError || new Error(`All providers failed for streaming model: ${modelId}`);
  }

  getStats() {
    return {
      totalRequests: this._requestCount,
      totalEstimatedCost: this._totalCost,
      roundRobinState: Object.fromEntries(this.roundRobinIndex),
      healthCheckIntervalMs: this.healthCheckIntervalMs,
      circuitBreakers: this.circuitBreakers.getStats(),
      providers: this.registry.getStats()
    };
  }
}
