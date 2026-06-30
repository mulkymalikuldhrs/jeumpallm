import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { estimateTokens, estimateInputTokens, estimateCost, formatCost, MODEL_PRICING } from './cost-estimator.js';

describe('CostEstimator — token estimation', () => {
  it('should estimate tokens for short text', () => {
    const tokens = estimateTokens('Hello world');
    assert.ok(tokens > 0);
    assert.ok(tokens < 10);
  });

  it('should estimate more tokens for longer text', () => {
    const short = estimateTokens('Hello world');
    const long = estimateTokens('Hello world '.repeat(100));
    assert.ok(long > short);
  });

  it('should estimate input tokens from messages', () => {
    const messages = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hello' }
    ];
    const tokens = estimateInputTokens(messages);
    assert.ok(tokens > 0);
  });

  it('should handle array content messages', () => {
    const messages = [
      { role: 'user', content: [{ type: 'text', text: 'Hello' }] }
    ];
    const tokens = estimateInputTokens(messages);
    assert.ok(tokens > 0);
  });

  it('should handle empty messages', () => {
    assert.equal(estimateInputTokens([]), 0);
  });
});

describe('CostEstimator — cost calculation', () => {
  it('should calculate cost for known model', () => {
    const cost = estimateCost('gpt-4o', 1000, 500);
    assert.equal(cost.model, 'gpt-4o');
    assert.equal(cost.inputTokens, 1000);
    assert.equal(cost.outputTokens, 500);
    // gpt-4o: $2.50/1M input, $10/1M output
    assert.equal(cost.inputCost, 0.0025);
    assert.equal(cost.outputCost, 0.005);
    assert.equal(cost.totalCost, 0.0075);
    assert.equal(cost.currency, 'USD');
  });

  it('should default output tokens to input tokens', () => {
    const cost = estimateCost('gpt-4o', 1000);
    assert.equal(cost.outputTokens, 1000);
  });

  it('should cap default output at 4096', () => {
    const cost = estimateCost('gpt-4o', 50000);
    assert.equal(cost.outputTokens, 4096);
  });

  it('should use default pricing for unknown model', () => {
    const cost = estimateCost('unknown-model-v1', 1000);
    assert.equal(cost.pricing.input, 0.50);
    assert.equal(cost.pricing.output, 2.00);
  });

  it('should identify free models', () => {
    const cost = estimateCost('gpt-4o-mini', 1000);
    assert.equal(cost.isFree, false);
  });

  it('should handle known models with exact match', () => {
    for (const model of Object.keys(MODEL_PRICING)) {
      const cost = estimateCost(model, 100);
      assert.equal(cost.model, model);
      assert.ok(cost.totalCost > 0);
    }
  });
});

describe('CostEstimator — formatCost', () => {
  it('should format free cost', () => {
    assert.equal(formatCost({ isFree: true, totalCost: 0.0 }), '$0.00 (FREE)');
  });

  it('should format micro-costs', () => {
    assert.equal(formatCost({ isFree: false, totalCost: 0.0001 }), '<$0.001');
  });

  it('should format normal costs', () => {
    assert.equal(formatCost({ isFree: false, totalCost: 0.01234 }), '$0.0123');
  });
});
