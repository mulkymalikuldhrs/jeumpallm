/**
 * Jeumpa LLM — Router Test Suite
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pickModel } from '../router.js';

describe('Router — pickModel() comprehensive', () => {
  it('returns claude-opus-4-5-latest for code-related queries', () => {
    const codeKeywords = ['code', 'implement', 'function', 'class', 'api', 'debug', 'bug', 'fix', 'refactor', 'sql', 'database', 'frontend', 'backend', 'deploy', 'config', 'docker', 'kubernetes', 'terraform', 'write a', 'create a', 'build', 'develop'];
    for (const keyword of codeKeywords) {
      const result = pickModel([{ role: 'user', content: `Help me ${keyword} something` }]);
      assert.equal(result, 'claude-opus-4-5-latest', `Expected claude-opus-4-5-latest for keyword: ${keyword}`);
    }
  });

  it('returns deepseek-chat for planning queries', () => {
    const planKeywords = ['plan', 'design', 'strategy', 'analyze', 'compare', 'decision', 'recommend', 'overview', 'roadmap', 'diagram', 'flow', 'system design', 'high level'];
    for (const keyword of planKeywords) {
      const result = pickModel([{ role: 'user', content: `Help me ${keyword} something` }]);
      assert.equal(result, 'deepseek-chat', `Expected deepseek-chat for keyword: ${keyword}`);
    }
  });

  it('returns gpt-4o for reasoning queries', () => {
    const reasonKeywords = ['reason', 'solve', 'explain', 'how does', 'why is', 'what is', 'step by step', 'proof', 'calculate', 'derive', 'think about'];
    for (const keyword of reasonKeywords) {
      const result = pickModel([{ role: 'user', content: `Can you ${keyword} this` }]);
      assert.equal(result, 'gpt-4o', `Expected gpt-4o for keyword: ${keyword}`);
    }
  });

  it('handles edge cases gracefully', () => {
    // Undefined messages
    assert.doesNotThrow(() => pickModel([{ role: 'user', content: undefined }]));
    // Missing content
    assert.doesNotThrow(() => pickModel([{ role: 'user' }]));
  });
});
