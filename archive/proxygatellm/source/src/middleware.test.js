/**
 * Jeumpa LLM — Test Suite
 * Basic tests for middleware, router, and endpoint validation
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Router Tests ──────────────────────────────────────────────────────

import { pickModel } from '../router.js';

describe('Router — pickModel()', () => {
  it('should return deepseek-chat for empty messages', () => {
    const result = pickModel([{ role: 'user', content: '' }]);
    assert.equal(result, 'deepseek-chat');
  });

  it('should route code-related queries to claude-opus-4-5-latest', () => {
    const result = pickModel([{ role: 'user', content: 'Write a function to sort an array' }]);
    assert.equal(result, 'claude-opus-4-5-latest');
  });

  it('should route planning queries to deepseek-chat', () => {
    const result = pickModel([{ role: 'user', content: 'Plan the architecture for a microservices system' }]);
    assert.equal(result, 'deepseek-chat');
  });

  it('should route reasoning queries to gpt-4o', () => {
    const result = pickModel([{ role: 'user', content: 'Explain how neural networks work step by step' }]);
    assert.equal(result, 'gpt-4o');
  });

  it('should route short queries to gpt-4o-mini', () => {
    const result = pickModel([{ role: 'user', content: 'Hi' }]);
    assert.equal(result, 'gpt-4o-mini');
  });

  it('should route question queries to gpt-4o-mini', () => {
    const result = pickModel([{ role: 'user', content: 'What time is it?' }]);
    assert.equal(result, 'gpt-4o-mini');
  });

  it('should default to deepseek-chat for general content', () => {
    const result = pickModel([{ role: 'user', content: 'Tell me a long story about adventures in space and time and magic and dragons and heroes and kingdoms and epic battles' }]);
    assert.equal(result, 'deepseek-chat');
  });

  it('should handle multiple messages', () => {
    const result = pickModel([
      { role: 'system', content: 'You are helpful' },
      { role: 'user', content: 'Debug my code' }
    ]);
    assert.equal(result, 'claude-opus-4-5-latest');
  });

  it('should handle Indonesian language planning queries', () => {
    const result = pickModel([{ role: 'user', content: 'Buat rencana untuk project baru' }]);
    assert.equal(result, 'deepseek-chat');
  });
});

// ── Middleware Tests ──────────────────────────────────────────────────

import {
  validateChatRequest,
  validateMessagesRequest,
  sanitizeMessages
} from '../middleware.js';

function mockReqRes(body = {}) {
  const req = { body, headers: {}, ip: '127.0.0.1', connection: { remoteAddress: '127.0.0.1' } };
  let statusCode = 200;
  let responseBody = null;
  const headers = {};
  const res = {
    status: (code) => { statusCode = code; return res; },
    json: (data) => { responseBody = data; return res; },
    setHeader: (k, v) => { headers[k] = v; },
    headersSent: false
  };
  let nextCalled = false;
  const next = () => { nextCalled = true; };
  return { req, res, next, getStatus: () => statusCode, getBody: () => responseBody, getNextCalled: () => nextCalled };
}

describe('Middleware — validateChatRequest()', () => {
  it('should reject non-object body', () => {
    const { req, res, next, getStatus } = mockReqRes(null);
    validateChatRequest(req, res, next);
    assert.equal(getStatus(), 400);
  });

  it('should reject empty messages array', () => {
    const { req, res, next, getStatus, getNextCalled } = mockReqRes({ messages: [] });
    validateChatRequest(req, res, next);
    assert.equal(getStatus(), 400);
    assert.equal(getNextCalled(), false);
  });

  it('should reject missing messages', () => {
    const { req, res, next, getStatus } = mockReqRes({});
    validateChatRequest(req, res, next);
    assert.equal(getStatus(), 400);
  });

  it('should reject invalid role', () => {
    const { req, res, next, getStatus } = mockReqRes({
      messages: [{ role: 'invalid', content: 'hi' }]
    });
    validateChatRequest(req, res, next);
    assert.equal(getStatus(), 400);
  });

  it('should accept valid chat request', () => {
    const { req, res, next, getNextCalled } = mockReqRes({
      messages: [{ role: 'user', content: 'Hello' }],
      model: 'gpt-5-nano'
    });
    validateChatRequest(req, res, next);
    assert.equal(getNextCalled(), true);
  });

  it('should reject model name too long', () => {
    const { req, res, next, getStatus } = mockReqRes({
      messages: [{ role: 'user', content: 'Hello' }],
      model: 'a'.repeat(300)
    });
    validateChatRequest(req, res, next);
    assert.equal(getStatus(), 400);
  });

  it('should reject too many messages', () => {
    const messages = Array.from({ length: 200 }, (_, i) => ({ role: 'user', content: `msg ${i}` }));
    const { req, res, next, getStatus } = mockReqRes({ messages });
    validateChatRequest(req, res, next);
    assert.equal(getStatus(), 400);
  });
});

describe('Middleware — validateMessagesRequest()', () => {
  it('should reject non-string system prompt', () => {
    const { req, res, next, getStatus } = mockReqRes({
      messages: [{ role: 'user', content: 'hi' }],
      system: 123
    });
    validateMessagesRequest(req, res, next);
    assert.equal(getStatus(), 400);
  });

  it('should reject invalid max_tokens', () => {
    const { req, res, next, getStatus } = mockReqRes({
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: -1
    });
    validateMessagesRequest(req, res, next);
    assert.equal(getStatus(), 400);
  });

  it('should accept valid messages request', () => {
    const { req, res, next, getNextCalled } = mockReqRes({
      messages: [{ role: 'user', content: 'Hello' }],
      model: 'claude-opus-4-5-latest',
      max_tokens: 4096
    });
    validateMessagesRequest(req, res, next);
    assert.equal(getNextCalled(), true);
  });
});

describe('Middleware — sanitizeMessages()', () => {
  it('should return empty array for non-array input', () => {
    assert.deepEqual(sanitizeMessages(null), []);
  });

  it('should strip null bytes from content', () => {
    const result = sanitizeMessages([{ role: 'user', content: 'hello\0world' }]);
    assert.equal(result[0].content, 'helloworld');
  });

  it('should preserve valid messages', () => {
    const messages = [{ role: 'user', content: 'Hello' }];
    const result = sanitizeMessages(messages);
    assert.equal(result[0].content, 'Hello');
    assert.equal(result[0].role, 'user');
  });
});
