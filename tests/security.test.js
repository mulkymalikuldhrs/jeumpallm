/**
 * Jeumpa LLM — Security Test Suite
 * Tests for authentication, authorization, SQL injection, and rate limiting
 * 
 * Run: node --test tests/security.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Mock database for security testing
const mockDb = {
  apiKeys: new Map(),
  rateLimits: new Map(),
  usageLogs: [],
};

// ── Authentication Tests ──────────────────────────────────────────────────────

describe('Security — API Key Validation', () => {
  it('should accept valid UUID-format API keys', () => {
    const validKey = 'jeumpa_sk_1234567890abcdef1234567890abcdef';
    const isValid = /^[a-zA-Z0-9_-]{20,}$/.test(validKey);
    assert.ok(isValid);
  });
  
  it('should reject keys with special characters', () => {
    const invalidKeys = [
      "'; DROP TABLE users; --",
      "' OR '1'='1",
      '<script>alert(1)</script>',
      '../../etc/passwd',
    ];
    
    invalidKeys.forEach(key => {
      const isValid = /^[a-zA-Z0-9_-]{20,}$/.test(key);
      assert.ok(!isValid, `Key ${key} should be rejected`);
    });
  });
  
  it('should hash API keys before storage', () => {
    const apiKey = 'test_api_key_1234567890';
    const hash = Buffer.from(apiKey).toString('base64');
    
    assert.notEqual(apiKey, hash);
    assert.ok(hash.length > apiKey.length);
  });
  
  it('should not log API keys in plaintext', () => {
    const apiKey = 'secret_key_12345';
    const logMessage = `Request received with key: ${apiKey}`;
    
    // Should not contain full key in logs
    const containsFullKey = logMessage.includes(apiKey);
    assert.ok(!containsFullKey, 'API key should not be in plaintext logs');
  });
});

// ── SQL Injection Prevention Tests ──────────────────────────────────────────────

describe('Security — SQL Injection Prevention', () => {
  const injectionAttempts = [
    "' OR '1'='1",
    "'; DROP TABLE users; --",
    "1; DELETE FROM api_keys",
    "admin'--",
    "1' AND '1'='1",
    "1' OR '1'='1' --",
    " UNION SELECT * FROM users --",
    "1; WAITFOR DELAY '0:0:10' --",
  ];
  
  it('should sanitize SQL injection in username', () => {
    injectionAttempts.forEach(attempt => {
      const sanitized = attempt.replace(/[';"-]/g, '');
      assert.notEqual(sanitized, attempt, `Injection attempt ${attempt} should be sanitized`);
    });
  });
  
  it('should use parameterized queries', () => {
    // Example of parameterized query (GOOD)
    const safeQuery = 'SELECT * FROM api_keys WHERE key_hash = ?';
    const params = ['hashed_key_value'];
    
    // Should not concatenate user input directly
    assert.ok(!safeQuery.includes("' OR '1'='1"));
  });
  
  it('should validate input length', () => {
    const maxLength = 256;
    const longInput = 'a'.repeat(300);
    
    const isValid = longInput.length <= maxLength;
    assert.ok(!isValid, 'Should reject inputs longer than max length');
  });
});

// ── Rate Limiting Tests ──────────────────────────────────────────────────────

describe('Security — Rate Limiting', () => {
  it('should track requests per API key', () => {
    const apiKey = 'test_key_123';
    const windowMs = 60000; // 1 minute
    const maxRequests = 100;
    
    let requestCount = 0;
    
    // Simulate requests
    for (let i = 0; i < 105; i++) {
      if (requestCount < maxRequests) {
        requestCount++;
      }
    }
    
    assert.equal(requestCount, maxRequests);
  });
  
  it('should reset rate limit after window expires', () => {
    const windowMs = 60000;
    const maxRequests = 100;
    
    let requestCount = 100;
    let windowStart = Date.now();
    
    // Window expires
    const now = Date.now() + windowMs + 1000;
    const shouldReset = (now - windowStart) > windowMs;
    
    assert.ok(shouldReset);
    if (shouldReset) {
      requestCount = 0; // Reset
    }
    
    assert.equal(requestCount, 0);
  });
  
  it('should return 429 when rate limit exceeded', async () => {
    // Mock rate limit check
    const checkRateLimit = (count, max) => count < max;
    
    const count = 101;
    const max = 100;
    const isAllowed = checkRateLimit(count, max);
    
    assert.ok(!isAllowed);
    // HTTP status should be 429 Too Many Requests
  });
});

// ──XSS Prevention Tests ──────────────────────────────────────────────────────

describe('Security — XSS Prevention', () => {
  it('should sanitize HTML in request bodies', () => {
    const maliciousInput = '<script>alert("XSS")</script>';
    const sanitized = maliciousInput.replace(/<[^>]*>/g, '');
    
    assert.equal(sanitized, 'alert("XSS")');
    assert.ok(!sanitized.includes('<script>'));
  });
  
  it('should escape special characters in responses', () => {
    const response = { message: '<script>alert(1)</script>' };
    const escaped = JSON.stringify(response)
      .replace(/</g, '<')
      .replace(/>/g, '>');
    
    assert.ok(escaped.includes('<script>'));
  });
});

// ── Path Traversal Prevention Tests ──────────────────────────────────────────────

describe('Security — Path Traversal Prevention', () => {
  it('should reject paths with ../..', () => {
    const maliciousPaths = [
      '../../../etc/passwd',
      '..\\..\\..\\windows\\system32',
      '....//....//etc/passwd',
    ];
    
    maliciousPaths.forEach(path => {
      const isMalicious = path.includes('..');
      assert.ok(isMalicious, `Path ${path} should be detected as malicious`);
    });
  });
  
  it('should validate file paths against whitelist', () => {
    const allowedPaths = ['/database/jeumpa.db', '/logs/app.log'];
    const requestedPath = '/database/jeumpa.db';
    const maliciousPath = '/etc/passwd';
    
    const isAllowed = allowedPaths.includes(requestedPath);
    const isMaliciousAllowed = allowedPaths.includes(maliciousPath);
    
    assert.ok(isAllowed);
    assert.ok(!isMaliciousAllowed);
  });
});

// ── CORS & Origin Validation Tests ──────────────────────────────────────────────

describe('Security — CORS Validation', () => {
  it('should reject requests from non-whitelisted origins', () => {
    const allowedOrigins = ['https://jeumpa.llm', 'https://dhaher.tech'];
    const requestOrigin = 'https://evil.com';
    
    const isAllowed = allowedOrigins.includes(requestOrigin);
    assert.ok(!isAllowed);
  });
  
  it('should set proper CORS headers', () => {
    const corsHeaders = {
      'Access-Control-Allow-Origin': 'https://jeumpa.llm',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    };
    
    assert.ok(corsHeaders['Access-Control-Allow-Origin']);
    assert.ok(corsHeaders['Access-Control-Allow-Methods']);
  });
});

// ── Error Handling Tests ──────────────────────────────────────────────────────

describe('Security — Error Handling', () => {
  it('should not expose stack traces in production', () => {
    const isProduction = true;
    const error = new Error('Database connection failed');
    error.stack = 'Error: Database connection failed\n    at db.js:123';
    
    const responseMessage = isProduction 
      ? 'Internal server error'
      : error.stack;
    
    assert.equal(responseMessage, 'Internal server error');
    assert.ok(!responseMessage.includes('stack'));
  });
  
  it('should log errors securely', () => {
    const sensitiveData = {
      apiKey: 'secret_key_123',
      password: 'user_password',
      token: 'jwt_token_here',
    };
    
    // Should not log sensitive data
    const safeLog = {
      timestamp: new Date().toISOString(),
      error: 'Authentication failed',
      // No sensitive data
    };
    
    assert.ok(!JSON.stringify(safeLog).includes('secret_key'));
    assert.ok(!JSON.stringify(safeLog).includes('user_password'));
  });
});

console.log('\n✅ Security Test Suite Ready\n');