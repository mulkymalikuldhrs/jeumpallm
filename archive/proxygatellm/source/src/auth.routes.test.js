import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import http from 'http';
import express from 'express';

const TEST_DIR = mkdtempSync(join(tmpdir(), 'jeumpa-auth-test-'));
const TEST_DB = join(TEST_DIR, 'test-auth.db');

process.env.JEUMPA_DB_PATH = TEST_DB;
process.env.JEUMPA_DATA_DIR = TEST_DIR;
process.env.DISABLE_AUTO_AUTH = 'true';

const { waitForDb, createUser } = await import('./db.js');
const { authRouter } = await import('../routes/auth.js');

const app = express();
app.use(express.json());

// Admin middleware for tests
app.use('/v1', (req, _res, next) => {
  if (req.headers['x-test-auth']) {
    req._authenticated = true;
    req._userId = parseInt(req.headers['x-test-user'] || '0');
    req._user = { role: req.headers['x-test-role'] || 'user' };
  }
  next();
});

app.use('/v1', authRouter);

let server;
let baseUrl;

function fetch(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      headers: { 'content-type': 'application/json', ...headers }
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, body: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

before(async () => {
  await waitForDb();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address();
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

after(() => {
  if (server) server.close();
  try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
});

describe('Auth Routes — POST /v1/users', () => {
  it('should register a new user (201)', async () => {
    const res = await fetch('POST', '/v1/users', {
      username: 'alice', email: 'alice@test.ai', password: 'password123'
    });
    assert.equal(res.status, 201);
    assert.ok(res.body.id > 0);
    assert.equal(res.body.username, 'alice');
    assert.equal(res.body.email, 'alice@test.ai');
  });

  it('should reject duplicate user (409)', async () => {
    const res = await fetch('POST', '/v1/users', {
      username: 'alice', email: 'alice2@test.ai', password: 'password123'
    });
    assert.equal(res.status, 409);
  });

  it('should reject missing fields (400)', async () => {
    const res = await fetch('POST', '/v1/users', { username: 'bob' });
    assert.equal(res.status, 400);
  });

  it('should reject short password (400)', async () => {
    const res = await fetch('POST', '/v1/users', {
      username: 'bob', email: 'bob@test.ai', password: 'short'
    });
    assert.equal(res.status, 400);
  });

  it('should reject short username (400)', async () => {
    const res = await fetch('POST', '/v1/users', {
      username: 'ab', email: 'bob@test.ai', password: 'password123'
    });
    assert.equal(res.status, 400);
  });
});

describe('Auth Routes — POST /v1/auth/login', () => {
  it('should login with valid credentials (200)', async () => {
    const res = await fetch('POST', '/v1/auth/login', {
      username: 'alice', password: 'password123'
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.username, 'alice');
  });

  it('should reject wrong password (401)', async () => {
    const res = await fetch('POST', '/v1/auth/login', {
      username: 'alice', password: 'wrongpass'
    });
    assert.equal(res.status, 401);
  });

  it('should reject missing credentials (400)', async () => {
    const res = await fetch('POST', '/v1/auth/login', { username: 'alice' });
    assert.equal(res.status, 400);
  });
});

describe('Auth Routes — key management', () => {
  let aliceId;
  let apiKey;

  before(async () => {
    // Create a second user for key management tests
    await createUser('keymgr', 'keymgr@test.ai', 'password123');
  });

  it('POST /v1/keys should require auth (401)', async () => {
    const res = await fetch('POST', '/v1/keys', { name: 'test-key' });
    assert.equal(res.status, 401);
  });

  it('POST /v1/keys should create key when authenticated (201)', async () => {
    // Login first to get user id
    const loginRes = await fetch('POST', '/v1/auth/login', {
      username: 'keymgr', password: 'password123'
    });
    aliceId = loginRes.body.id;

    const res = await fetch('POST', '/v1/keys', { name: 'my-key' }, {
      'x-test-auth': 'true',
      'x-test-user': String(aliceId)
    });
    assert.equal(res.status, 201);
    assert.ok(res.body.key);
    assert.ok(res.body.key.startsWith('jl-'));
    assert.ok(res.body.prefix);
    apiKey = res.body.key;
  });

  it('GET /v1/keys should require auth (401)', async () => {
    const res = await fetch('GET', '/v1/keys');
    assert.equal(res.status, 401);
  });

  it('GET /v1/keys should list keys (200)', async () => {
    const res = await fetch('GET', '/v1/keys', null, {
      'x-test-auth': 'true',
      'x-test-user': String(aliceId)
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.keys.length >= 1);
    assert.ok(res.body.keys.some(k => k.name === 'my-key'));
  });

  it('DELETE /v1/keys/:id should require auth (401)', async () => {
    const res = await fetch('DELETE', '/v1/keys/1');
    assert.equal(res.status, 401);
  });

  it('DELETE /v1/keys/:id should revoke key (200)', async () => {
    // Get the key ID from listing
    const listRes = await fetch('GET', '/v1/keys', null, {
      'x-test-auth': 'true',
      'x-test-user': String(aliceId)
    });
    const keyId = listRes.body.keys.find(k => k.name === 'my-key')?.id;
    assert.ok(keyId);

    const res = await fetch('DELETE', `/v1/keys/${keyId}`, null, {
      'x-test-auth': 'true',
      'x-test-user': String(aliceId)
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.message, 'Key revoked');
  });
});

describe('Auth Routes — GET /v1/usage', () => {
  it('should require auth (401)', async () => {
    const res = await fetch('GET', '/v1/usage');
    assert.equal(res.status, 401);
  });

  it('should return usage stats (200)', async () => {
    const loginRes = await fetch('POST', '/v1/auth/login', {
      username: 'alice', password: 'password123'
    });
    const res = await fetch('GET', '/v1/usage', null, {
      'x-test-auth': 'true',
      'x-test-user': String(loginRes.body.id)
    });
    assert.equal(res.status, 200);
    // Should have stats fields even if zero
    assert.ok('total_requests' in res.body);
    assert.ok('total_cost' in res.body);
  });
});

describe('Auth Routes — GET /v1/admin/stats', () => {
  let adminId;

  before(async () => {
    // Promote user to admin for test
    const { waitForDb } = await import('./db.js');
    await waitForDb();
    const loginRes = await fetch('POST', '/v1/auth/login', {
      username: 'alice', password: 'password123'
    });
    adminId = loginRes.body.id;
  });

  it('should reject non-admin (403)', async () => {
    const res = await fetch('GET', '/v1/admin/stats', null, {
      'x-test-auth': 'true',
      'x-test-user': String(adminId),
      'x-test-role': 'user'
    });
    assert.equal(res.status, 403);
  });

  it('should return admin stats for admin role (200)', async () => {
    const res = await fetch('GET', '/v1/admin/stats', null, {
      'x-test-auth': 'true',
      'x-test-user': String(adminId),
      'x-test-role': 'admin'
    });
    assert.equal(res.status, 200);
    assert.ok('users' in res.body);
    assert.ok('activeKeys' in res.body);
    assert.ok('totalRequests' in res.body);
    assert.ok('totalCost' in res.body);
  });
});
