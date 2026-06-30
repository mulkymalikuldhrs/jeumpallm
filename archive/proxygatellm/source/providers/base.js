// providers/base.js
// Abstract Base Provider — all LLM providers extend this

export class BaseProvider {
  constructor(config) {
    this.name = config.name;           // e.g. 'pollinations'
    this.displayName = config.displayName || config.name;
    this.priority = config.priority || 3;  // 1=highest (no auth), 2=free key, 3=fragile
    this.enabled = config.enabled !== false;
    this.models = config.models || [];     // [{id, type, description, maxTokens}]
    this.baseUrl = config.baseUrl || '';
    this.timeout = config.timeout || 30000;
    this.retryCount = config.retryCount || 2;
    this.healthStatus = 'unknown';    // 'healthy', 'degraded', 'down', 'unknown'
    this.lastHealthCheck = null;
    this.requestCount = 0;
    this.errorCount = 0;
    this.avgLatency = 0;
    this._totalLatency = 0;
  }

  // Abstract methods — must be implemented by subclasses
  async chat(messages, options = {}) {
    throw new Error(`Provider ${this.name} must implement chat()`);
  }

  async chatStream(messages, options = {}) {
    throw new Error(`Provider ${this.name} must implement chatStream()`);
  }

  async checkHealth() {
    throw new Error(`Provider ${this.name} must implement checkHealth()`);
  }

  async fetchModels() {
    // Override to auto-fetch models from provider API
    return this.models;
  }

  // Common utilities
  supportsModel(modelId) {
    return this.models.some(m => m.id === modelId || m.aliases?.includes(modelId));
  }

  getModel(modelId) {
    return this.models.find(m => m.id === modelId || m.aliases?.includes(modelId));
  }

  recordRequest(latency, success) {
    this.requestCount++;
    if (!success) this.errorCount++;
    this._totalLatency += latency;
    this.avgLatency = this._totalLatency / this.requestCount;
  }

  getStats() {
    return {
      name: this.name,
      displayName: this.displayName,
      priority: this.priority,
      enabled: this.enabled,
      healthStatus: this.healthStatus,
      lastHealthCheck: this.lastHealthCheck,
      requestCount: this.requestCount,
      errorCount: this.errorCount,
      errorRate: this.requestCount > 0 ? (this.errorCount / this.requestCount * 100).toFixed(1) + '%' : '0%',
      avgLatency: Math.round(this.avgLatency),
      modelCount: this.models.length,
      models: this.models.map(m => m.id)
    };
  }

  // Format OpenAI-compatible response
  formatOpenAIResponse(content, model, usage = {}) {
    return {
      id: 'chatcmpl-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: model,
      choices: [{
        index: 0,
        message: { role: 'assistant', content: content },
        finish_reason: 'stop'
      }],
      usage: usage
    };
  }

  // Format Anthropic-compatible response
  formatAnthropicResponse(content, model, usage = {}) {
    return {
      id: 'msg_' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: content }],
      model: model,
      stop_reason: 'end_turn',
      usage: usage || { input_tokens: 0, output_tokens: 0 }
    };
  }
}
