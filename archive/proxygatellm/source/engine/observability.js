/**
 * Jeumpa LLM Observability System v1.0
 * Distributed tracing, cost tracking, and analytics
 * Inspired by LangSmith + OpenTelemetry
 */

/**
 * Trace Span
 */
export class Span {
  constructor(config) {
    this.id = config.id || crypto.randomUUID();
    this.parentId = config.parentId || null;
    this.name = config.name;
    this.type = config.type || 'default';
    this.startTime = Date.now();
    this.endTime = null;
    this.status = 'running';
    this.attributes = config.attributes || {};
    this.events = [];
    this.tokenUsage = { input: 0, output: 0 };
    this.cost = 0;
  }

  /**
   * Add an event
   */
  addEvent(name, attributes = {}) {
    this.events.push({
      name,
      timestamp: Date.now(),
      attributes,
    });
    return this;
  }

  /**
   * Set attribute
   */
  setAttribute(key, value) {
    this.attributes[key] = value;
    return this;
  }

  /**
   * Record token usage
   */
  recordTokens(input, output) {
    this.tokenUsage.input += input;
    this.tokenUsage.output += output;
    this.cost += this.calculateCost(input, output);
    return this;
  }

  /**
   * Calculate cost based on model pricing
   */
  calculateCost(inputTokens, outputTokens) {
    const model = this.attributes.model || 'unknown';

    // Pricing per 1M tokens (USD)
    const pricing = {
      'gpt-4o': { input: 2.5, output: 10 },
      'gpt-4o-mini': { input: 0.15, output: 0.6 },
      'claude-opus-4-5-latest': { input: 15, output: 75 },
      'claude-sonnet-4': { input: 3, output: 15 },
      'deepseek-chat': { input: 0.14, output: 0.28 },
      'grok-3': { input: 3, output: 15 },
    };

    const rates = pricing[model] || { input: 0.5, output: 1.5 };
    return (inputTokens * rates.input + outputTokens * rates.output) / 1_000_000;
  }

  /**
   * End the span
   */
  end(status = 'ok') {
    this.endTime = Date.now();
    this.status = status;
    return this;
  }

  /**
   * Get duration
   */
  get duration() {
    return (this.endTime || Date.now()) - this.startTime;
  }

  toJSON() {
    return {
      id: this.id,
      parentId: this.parentId,
      name: this.name,
      type: this.type,
      startTime: this.startTime,
      endTime: this.endTime,
      duration: this.duration,
      status: this.status,
      attributes: this.attributes,
      events: this.events,
      tokenUsage: this.tokenUsage,
      cost: this.cost,
    };
  }
}

/**
 * Trace — Collection of spans
 */
export class Trace {
  constructor(config = {}) {
    this.id = config.id || crypto.randomUUID();
    this.name = config.name || 'unnamed-trace';
    this.spans = [];
    this.startTime = Date.now();
    this.endTime = null;
    this.metadata = config.metadata || {};
  }

  /**
   * Create a child span
   */
  startSpan(config) {
    const parentSpan = this.spans.length > 0 ? this.spans[this.spans.length - 1] : null;
    const span = new Span({
      ...config,
      parentId: parentSpan?.id || null,
    });
    this.spans.push(span);
    return span;
  }

  /**
   * End the trace
   */
  end() {
    this.endTime = Date.now();
    // End all running spans
    for (const span of this.spans) {
      if (span.status === 'running') {
        span.end();
      }
    }
    return this;
  }

  /**
   * Get total duration
   */
  get duration() {
    return (this.endTime || Date.now()) - this.startTime;
  }

  /**
   * Get total token usage
   */
  get totalTokens() {
    return this.spans.reduce(
      (acc, span) => ({
        input: acc.input + span.tokenUsage.input,
        output: acc.output + span.tokenUsage.output,
      }),
      { input: 0, output: 0 }
    );
  }

  /**
   * Get total cost
   */
  get totalCost() {
    return this.spans.reduce((sum, span) => sum + span.cost, 0);
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      startTime: this.startTime,
      endTime: this.endTime,
      duration: this.duration,
      metadata: this.metadata,
      spans: this.spans.map(s => s.toJSON()),
      totalTokens: this.totalTokens,
      totalCost: this.totalCost,
    };
  }
}

/**
 * Tracer — Manages traces
 */
export class Tracer {
  constructor(config = {}) {
    this.traces = new Map();
    this.maxTraces = config.maxTraces || 1000;
    this.exporters = config.exporters || [];
    this.onTraceComplete = config.onTraceComplete || null;
  }

  /**
   * Start a new trace
   */
  startTrace(name, metadata = {}) {
    const trace = new Trace({ name, metadata });
    this.traces.set(trace.id, trace);

    // Cleanup old traces
    if (this.traces.size > this.maxTraces) {
      const oldest = Array.from(this.traces.keys())[0];
      this.traces.delete(oldest);
    }

    return trace;
  }

  /**
   * End a trace
   */
  endTrace(traceId) {
    const trace = this.traces.get(traceId);
    if (trace) {
      trace.end();
      this.export(trace);
      if (this.onTraceComplete) {
        this.onTraceComplete(trace);
      }
    }
    return trace;
  }

  /**
   * Export trace to all exporters
   */
  async export(trace) {
    for (const exporter of this.exporters) {
      try {
        await exporter.export(trace);
      } catch (error) {
        console.error('Export failed:', error);
      }
    }
  }

  /**
   * Get analytics summary
   */
  getAnalytics() {
    const allTraces = Array.from(this.traces.values());

    const totalCost = allTraces.reduce((sum, t) => sum + t.totalCost, 0);
    const totalTokens = allTraces.reduce(
      (acc, t) => ({
        input: acc.input + t.totalTokens.input,
        output: acc.output + t.totalTokens.output,
      }),
      { input: 0, output: 0 }
    );

    const avgDuration = allTraces.length > 0
      ? allTraces.reduce((sum, t) => sum + t.duration, 0) / allTraces.length
      : 0;

    return {
      totalTraces: allTraces.length,
      totalCost: totalCost,
      totalTokens,
      avgDuration,
      recentTraces: allTraces.slice(-10).map(t => ({
        name: t.name,
        duration: t.duration,
        cost: t.totalCost,
      })),
    };
  }

  /**
   * Create JSONL exporter
   */
  static jsonlExporter(filePath) {
    return {
      export: async (trace) => {
        const fs = await import('fs/promises');
        const line = JSON.stringify(trace.toJSON()) + '\n';
        await fs.appendFile(filePath, line);
      },
    };
  }

  /**
   * Create console exporter
   */
  static consoleExporter() {
    return {
      export: async (trace) => {
        console.log(`[Trace] ${trace.name}: ${trace.duration}ms, $${trace.totalCost.toFixed(4)}`);
      },
    };
  }
}

export default Tracer;