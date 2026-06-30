import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TEST_DIR = mkdtempSync(join(tmpdir(), 'jeumpa-db-test-'));
const TEST_DB = join(TEST_DIR, 'test.db');

process.env.JEUMPA_DB_PATH = TEST_DB;
process.env.JEUMPA_DATA_DIR = TEST_DIR;

const {
  waitForDb, createUser, authenticateUser, createApiKey,
  validateApiKey, checkRateLimit, logUsage, getUserUsageStats,
  listApiKeys, revokeApiKey, getAdminStats
} = await import('./db.js');

describe('Database — init', () => {
  it('should wait for database initialization', async () => {
    const result = await waitForDb();
    assert.equal(result, true);
  });
});

describe('Database — users', () => {
  let user;

  it('should create a new user', async () => {
    user = await createUser('testuser', 'test@jeumpa.ai', 'password123');
    assert.ok(user.id > 0);
    assert.equal(user.username, 'testuser');
    assert.equal(user.email, 'test@jeumpa.ai');
  });

  it('should reject duplicate username', async () => {
    await assert.rejects(
      () => createUser('testuser', 'other@jeumpa.ai', 'password123'),
      /Username or email already exists/
    );
  });

  it('should reject duplicate email', async () => {
    await assert.rejects(
      () => createUser('other', 'test@jeumpa.ai', 'password123'),
      /Username or email already exists/
    );
  });

  it('should authenticate with correct password', async () => {
    const result = await authenticateUser('testuser', 'password123');
    assert.ok(result);
    assert.equal(result.username, 'testuser');
    assert.equal(result.role, 'user');
  });

  it('should reject wrong password', async () => {
    const result = await authenticateUser('testuser', 'wrongpassword');
    assert.equal(result, null);
  });

  it('should reject nonexistent user', async () => {
    const result = await authenticateUser('nobody', 'password123');
    assert.equal(result, null);
  });
});

describe('Database — API keys', () => {
  let user;
  let apiKey;

  before(async () => {
    user = await createUser('keytest', 'keytest@jeumpa.ai', 'secret');
  });

  it('should create an API key', async () => {
    apiKey = await createApiKey(user.id, 'test-key', 50);
    assert.ok(apiKey.key);
    assert.ok(apiKey.key.startsWith('jl-'));
    assert.equal(apiKey.key.length > 20, true);
    assert.ok(apiKey.prefix);
  });

  it('should validate a valid API key', async () => {
    const result = await validateApiKey(apiKey.key);
    assert.ok(result);
    assert.equal(String(result.user_id), String(user.id));
    assert.equal(result.user.username, 'keytest');
    assert.equal(result.enabled, 1);
  });

  it('should reject invalid API key', async () => {
    const result = await validateApiKey('jl-invalid-key');
    assert.equal(result, null);
  });

  it('should list all keys for user', async () => {
    const keys = await listApiKeys(user.id);
    assert.ok(keys.length >= 1);
    assert.ok(keys.some(k => k.name === 'test-key'));
  });

  it('should revoke an API key', async () => {
    await revokeApiKey(apiKey.id, user.id);
    const keys = await listApiKeys(user.id);
    const revoked = keys.find(k => k.name === 'test-key');
    assert.ok(revoked);
    assert.equal(revoked.enabled, 0);
  });

  it('should reject revoked API key on validation', async () => {
    const result = await validateApiKey(apiKey.key);
    assert.equal(result, null);
  });
});

describe('Database — rate limiting', () => {
  const keyHash = 'test-hash-123';

  it('should allow first request', async () => {
    const result = await checkRateLimit(keyHash, 5, 60000);
    assert.equal(result.allowed, true);
    assert.equal(result.remaining, 4);
  });

  it('should decrement remaining on each request', async () => {
    for (let i = 0; i < 3; i++) {
      const result = await checkRateLimit(keyHash, 5, 60000);
      assert.equal(result.allowed, true);
    }
    const result = await checkRateLimit(keyHash, 5, 60000);
    assert.equal(result.remaining, 0);
  });

  it('should block when limit exceeded', async () => {
    const result = await checkRateLimit(keyHash, 5, 60000);
    assert.equal(result.allowed, false);
    assert.equal(result.remaining, 0);
  });
});

describe('Database — usage logging', () => {
  let user;
  let key;

  before(async () => {
    user = await createUser('usagelog', 'usage@jeumpa.ai', 'pwd');
    key = await createApiKey(user.id, 'usage-key');
  });

  it('should log usage entry', async () => {
    await logUsage(key.id, user.id, 'openai', 'gpt-4o', 100, 50, 0.002, 500, true, null, '127.0.0.1');
    const stats = await getUserUsageStats(user.id);
    assert.ok(stats.total_requests >= 1);
    assert.equal(stats.total_tokens_in, 100);
    assert.equal(stats.total_tokens_out, 50);
    assert.ok(parseFloat(stats.total_cost) >= 0.002);
  });

  it('should log failed usage entry', async () => {
    await logUsage(key.id, user.id, 'openai', 'gpt-4o', 50, 0, 0, 0, false, 'Rate limit exceeded', '127.0.0.1');
    const stats = await getUserUsageStats(user.id);
    assert.ok(stats.total_requests >= 2);
    assert.ok(stats.failed >= 1);
  });

  it('should return zero stats for unknown user', async () => {
    const stats = await getUserUsageStats(99999);
    assert.equal(stats.total_requests, 0);
  });
});

describe('Database — admin stats', () => {
  it('should return aggregate stats', async () => {
    const stats = await getAdminStats();
    assert.ok(stats.users >= 3);
    assert.ok(stats.activeKeys >= 1);
    assert.ok(stats.totalRequests >= 0);
  });
});

after(() => {
  try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
});
