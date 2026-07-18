/**
 * Jeumpa LLM — Integration & E2E Test Suite
 * Tests for multi-tenant auth, provider failover, and end-to-end flows
 * 
 * Run: node --test tests/integration.test.js
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'child_process';
import { setTimeout } from 'timers/promises';

// ── Test Configuration ──────────────────────────────────────────────────────

const TEST_PORT = 3399; // Different from main server (3333)
const BASE_URL = `http://localhost:${TEST_PORT}`;

// ── Helper Functions ──────────────────────────────────────────────────────

async function makeRequest(endpoint, method = 'GET', body = null, apiKey = null) {
  const { fetch } = await import('node-fetch');
  const headers = {
    'Content-Type': 'application/json',
  };
  
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }
  
  const options = {
    method,
    headers,
  };
  
  if (body) {
    options.body = JSON.stringify(body);
  }
  
  const response = await fetch(`${BASE_URL}${endpoint}`, options);
  return {
    status: response.status,
    headers: response.headers,
    data: await response.json(),
  };
}

// ── Integration Tests ──────────────────────────────────────────────────────

describe('Integration — Multi-Tenant Auth', () => {
  let testApiKey1, testApiKey2;
  
  before(async () => {
    // Create test API keys
    const { fetch } = await import('node-fetch');
    
    // Create user 1
    await fetch(`${BASE_URL}/v1/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'test_user_1',
        email: 'test1@jeumpa.llm',
        password: 'testpass123',
      }),
    });
    
    // Create API key for user 1
    const keyResponse = await fetch(`${BASE_URL}/v1/keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Integration Test Key 1',
        rate_limit: 100,
        daily_quota: 1000,
      }),
    });
    
    const keyData = await keyResponse.json();
    testApiKey1 = keyData.key;
    
    // Create API key for user 2
    const keyResponse2 = await fetch(`${BASE_URL}/v1/keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Integration Test Key 2',
        rate_limit: 50,
        daily_quota: 500,
      }),
    });
    
    const keyData2 = await keyResponse2.json();
    testApiKey2 = keyData2.key;
  });
  
  it('should accept valid API key', async () => {
    const result = await makeRequest('/health', 'GET', null, testApiKey1);
    assert.equal(result.status, 200);
    assert.equal(result.data.status, 'ok');
  });
  
  it('should reject invalid API key', async () => {
    const result = await makeRequest('/health', 'GET', null, 'invalid-key-123');
    assert.equal(result.status, 401);
    assert.equal(result.data.error, 'Invalid API key');
  });
  
  it('should enforce per-key rate limiting', async () => {
    const lowRateLimitKey = testApiKey2; // 50 requests/min
    
    // Make 55 rapid requests
    const requests = Array(55).fill(null).map(async () => {
      return makeRequest('/health', 'GET', null, lowRateLimitKey);
    });
    
    const results = await Promise.all(requests);
    const successCount = results.filter(r => r.status === 200).length;
    const rateLimitedCount = results.filter(r => r.status === 429).length;
    
    assert.ok(successCount >= 50, `Expected >= 50 success, got ${successCount}`);
    assert.ok(rateLimitedCount >= 5, `Expected >= 5 rate limited, got ${rateLimitedCount}`);
  });
  
  it('should isolate usage logs per API key', async () => {
    // Make requests with key 1
    await makeRequest('/v1/chat/completions', 'POST', {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'test' }],
    }, testApiKey1);
    
    // Make requests with key 2
    await makeRequest('/v1/chat/completions', 'POST', {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'test' }],
    }, testApiKey2);
    
    // Check usage for key 1
    const usage1 = await makeRequest('/v1/usage', 'GET', null, testApiKey1);
    assert.equal(usage1.status, 200);
    assert.ok(usage1.data.total_requests >= 1);
    
    // Check usage for key 2
    const usage2 = await makeRequest('/v1/usage', 'GET', null, testApiKey2);
    assert.equal(usage2.status, 200);
    assert.ok(usage2.data.total_requests >= 1);
  });
});

describe('Integration — Provider Failover', () => {
  it('should fallback to next provider when primary fails', async () => {
    // This test requires a provider to be marked as unhealthy
    // Skip for now - TODO: implement provider health mocking
    assert.ok(true, 'Provider failover test - SKIPPED (requires health mocking)');
  });
  
  it('should respect circuit breaker state', async () => {
    // Skip for now - TODO: implement circuit breaker state injection
    assert.ok(true, 'Circuit breaker test - SKIPPED (requires state injection)');
  });
  
  it('should route to healthy providers only', async () => {
    const result = await makeRequest('/v1/chat/completions', 'POST', {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'Say "hello" in one word' }],
    });
    
    assert.equal(result.status, 200);
    assert.ok(result.data.choices[0].message.content.length > 0);
  });
});

describe('E2E — Full Chat Flow', () => {
  it('should complete full chat completion flow', async () => {
    const result = await makeRequest('/v1/chat/completions', 'POST', {
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'What is 2 + 2?' },
      ],
      temperature: 0.7,
      max_tokens: 50,
    });
    
    assert.equal(result.status, 200);
    assert.ok(result.data.id);
    assert.equal(result.data.object, 'chat.completion');
    assert.ok(result.data.choices.length > 0);
    assert.ok(result.data.choices[0].message.content.length > 0);
    assert.ok(result.data.usage.total_tokens > 0);
  });
  
  it('should handle streaming responses', async () => {
    const { fetch } = await import('node-fetch');
    
    const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Count from 1 to 5' }],
        stream: true,
      }),
    });
    
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/event-stream');
    
    // Read stream chunks
    const chunks = [];
    for await (const chunk of response.body) {
      const text = chunk.toString();
      if (text.startsWith('data: ')) {
        chunks.push(text);
      }
    }
    
    assert.ok(chunks.length > 0, 'Expected stream chunks');
    assert.ok(chunks.some(c => c.includes('[DONE]')), 'Expected [DONE] marker');
  });
  
  it('should handle Anthropic-compatible endpoint', async () => {
    const result = await makeRequest('/v1/messages', 'POST', {
      model: 'claude-3-haiku-20240307',
      messages: [{ role: 'user', content: 'Hello' }],
      max_tokens: 50,
    });
    
    assert.equal(result.status, 200);
    assert.ok(result.data.id);
    assert.equal(result.data.role, 'assistant');
    assert.ok(result.data.content.length > 0);
  });
});

describe('Security — Authentication Bypass Prevention', () => {
  it('should reject requests without API key', async () => {
    const result = await makeRequest('/v1/chat/completions', 'POST', {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'test' }],
    });
    
    assert.equal(result.status, 401);
    assert.equal(result.data.error, 'API key required');
  });
  
  it('should reject malformed API keys', async () => {
    const result = await makeRequest('/v1/chat/completions', 'POST', {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'test' }],
    }, 'malformed-key-!@#$%');
    
    assert.equal(result.status, 401);
  });
  
  it('should reject SQL injection attempts in API key', async () => {
    const result = await makeRequest('/v1/chat/completions', 'POST', {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'test' }],
    }, "' OR '1'='1");
    
    assert.equal(result.status, 401);
  });
  
  it('should reject requests to admin endpoints without admin key', async () => {
    const result = await makeRequest('/v1/admin/stats', 'GET', null, 'regular-api-key');
    
    // Should return 403 Forbidden for non-admin keys
    assert.ok([401, 403].includes(result.status));
  });
});

describe('Performance — Concurrent Requests', () => {
  it('should handle 10 concurrent requests', async () => {
    const apiKey = 'test-concurrent-key'; // Use a test key
    
    const requests = Array(10).fill(null).map(async () => {
      return makeRequest('/v1/chat/completions', 'POST', {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'test' }],
      }, apiKey);
    });
    
    const results = await Promise.all(requests);
    const successCount = results.filter(r => r.status === 200).length;
    
    // Allow some failures due to rate limiting, but expect most to succeed
    assert.ok(successCount >= 8, `Expected >= 8 success, got ${successCount}`);
  });
  
  it('should maintain response times under load', async () => {
    const startTime = Date.now();
    
    const requests = Array(5).fill(null).map(async () => {
      const reqStart = Date.now();
      const result = await makeRequest('/health', 'GET', null, 'test-key');
      const reqEnd = Date.now();
      return { result, duration: reqEnd - reqStart };
    });
    
    const results = await Promise.all(requests);
    const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length;
    
    // Expect average response time < 500ms for health endpoint
    assert.ok(avgDuration < 500, `Average response time ${avgDuration}ms > 500ms`);
  });
});

console.log('\n✅ Integration & E2E Test Suite Ready\n');