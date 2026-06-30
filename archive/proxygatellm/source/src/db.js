// src/db.js
// Jeumpa LLM — SQLite Database Layer (sql.js)
// Users, API keys, usage logs, rate limiting, sessions

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import initSqlJs from 'sql.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = process.env.JEUMPA_DATA_DIR || join(__dirname, '..', 'data');
const DB_PATH = process.env.JEUMPA_DB_PATH || join(DATA_DIR, 'jeumpa.db');

let db = null;
let sqlDb = null;
let ready = false;
const initPromise = _init();

async function _init() {
  if (ready) return;
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

  const SQL = await initSqlJs();
  if (existsSync(DB_PATH)) {
    const buffer = readFileSync(DB_PATH);
    sqlDb = new SQL.Database(buffer);
  } else {
    sqlDb = new SQL.Database();
  }
  sqlDb.run('PRAGMA journal_mode=MEMORY');
  sqlDb.run('PRAGMA foreign_keys=ON');
  migrate();
  ready = true;
}

function persist() {
  try {
    const data = sqlDb.export();
    const buffer = Buffer.from(data);
    writeFileSync(DB_PATH, buffer);
  } catch (err) {
    console.error('[DB] Failed to persist:', err.message);
  }
}

function migrate() {
  sqlDb.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      credits REAL DEFAULT 0.0,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      key_prefix TEXT NOT NULL,
      key_hash TEXT UNIQUE NOT NULL,
      name TEXT DEFAULT 'default',
      rate_limit_max INTEGER DEFAULT 100,
      rate_limit_window_ms INTEGER DEFAULT 60000,
      daily_quota INTEGER DEFAULT 10000,
      ip_whitelist TEXT,
      enabled INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      last_used_at TEXT
    );

    CREATE TABLE IF NOT EXISTS usage_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      api_key_id INTEGER,
      user_id INTEGER,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      tokens_in INTEGER DEFAULT 0,
      tokens_out INTEGER DEFAULT 0,
      cost_usd REAL DEFAULT 0.0,
      latency_ms INTEGER DEFAULT 0,
      success INTEGER DEFAULT 1,
      error_msg TEXT,
      ip_address TEXT,
      timestamp TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS rate_limits (
      key_hash TEXT NOT NULL,
      window_start INTEGER NOT NULL,
      count INTEGER DEFAULT 0,
      PRIMARY KEY (key_hash, window_start)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER,
      data TEXT,
      expires_at INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_usage_logs_key ON usage_logs(api_key_id)',
    'CREATE INDEX IF NOT EXISTS idx_usage_logs_user ON usage_logs(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_usage_logs_timestamp ON usage_logs(timestamp)',
    'CREATE INDEX IF NOT EXISTS idx_rate_limits_key ON rate_limits(key_hash, window_start)',
    'CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)',
  ];
  for (const idx of indexes) sqlDb.run(idx);
  persist();
}

function q(sql, params = []) {
  const stmt = sqlDb.prepare(sql);
  if (!stmt) return null;
  try {
    if (sql.trim().toUpperCase().startsWith('SELECT') || sql.trim().toUpperCase().startsWith('WITH')) {
      stmt.bind(params);
      const results = [];
      while (stmt.step()) results.push(stmt.getAsObject());
      return results;
    }
    stmt.run(params);
    const rows = sqlDb.exec("SELECT last_insert_rowid() as id");
    const changes = sqlDb.getRowsModified();
    stmt.free();
    return { changes, lastInsertRowid: rows?.[0]?.values?.[0]?.[0] || null };
  } finally {
    try { stmt.free(); } catch {}
  }
}

function qOne(sql, params = []) {
  const results = q(sql, params);
  return results?.[0] || null;
}

export async function waitForDb() {
  await initPromise;
  return true;
}

export function getDb() {
  if (!ready) throw new Error('Database not initialized — call await waitForDb() first');
  return sqlDb;
}

export async function createUser(username, email, password) {
  await initPromise;
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  const passwordHash = hash + ':' + salt;
  try {
    const result = q('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)', [username, email, passwordHash]);
    persist();
    return { id: result.lastInsertRowid, username, email };
  } catch (err) {
    if (err.message?.includes('UNIQUE')) throw new Error('Username or email already exists');
    throw err;
  }
}

export async function authenticateUser(username, password) {
  await initPromise;
  const user = qOne('SELECT * FROM users WHERE username = ? AND is_active = 1', [username]);
  if (!user) return null;
  const [hash, salt] = user.password_hash.split(':');
  const derivedKey = scryptSync(password, salt, 64).toString('hex');
  if (derivedKey === hash) return { id: user.id, username: user.username, email: user.email, role: user.role };
  return null;
}

function hashApiKey(key) {
  return createHash('sha256').update(key).digest('hex');
}

function generateApiKey() {
  const key = 'jl-' + randomBytes(24).toString('base64url');
  return { key, prefix: key.slice(0, 8) + '...' };
}

export async function createApiKey(userId, name = 'default', rateLimitMax = 100) {
  await initPromise;
  const { key, prefix } = generateApiKey();
  const keyHash = hashApiKey(key);
  const result = q(
    'INSERT INTO api_keys (user_id, key_prefix, key_hash, name, rate_limit_max) VALUES (?, ?, ?, ?, ?)',
    [userId, prefix, keyHash, name, rateLimitMax]
  );
  persist();
  return { key, prefix, id: result.lastInsertRowid };
}

export async function validateApiKey(key) {
  await initPromise;
  const keyHash = hashApiKey(key);
  const apiKey = qOne(
    'SELECT * FROM api_keys WHERE key_hash = ? AND enabled = 1',
    [keyHash]
  );
  if (!apiKey) return null;
  const user = qOne(
    'SELECT id, username, email, role, credits FROM users WHERE id = ? AND is_active = 1',
    [apiKey.user_id]
  );
  if (!user) return null;
  q('UPDATE api_keys SET last_used_at = datetime("now") WHERE id = ?', [apiKey.id]);
  persist();
  return { ...apiKey, user };
}

export async function checkRateLimit(keyHash, max, windowMs) {
  await initPromise;
  const now = Date.now();
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const row = qOne(
    'SELECT count FROM rate_limits WHERE key_hash = ? AND window_start = ?',
    [keyHash, windowStart]
  );
  const count = row ? row.count : 0;
  if (count >= max) {
    return { allowed: false, remaining: 0, resetTime: windowStart + windowMs };
  }
  if (count === 0) {
    q('INSERT OR IGNORE INTO rate_limits (key_hash, window_start, count) VALUES (?, ?, ?)', [keyHash, windowStart, 1]);
  } else {
    q('UPDATE rate_limits SET count = count + 1 WHERE key_hash = ? AND window_start = ?', [keyHash, windowStart]);
  }
  persist();
  return { allowed: true, remaining: max - count - 1, resetTime: windowStart + windowMs };
}

export async function logUsage(apiKeyId, userId, provider, model, tokensIn, tokensOut, costUsd, latencyMs, success, errorMsg, ipAddress) {
  await initPromise;
  q(
    'INSERT INTO usage_logs (api_key_id, user_id, provider, model, tokens_in, tokens_out, cost_usd, latency_ms, success, error_msg, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [apiKeyId, userId, provider, model, tokensIn || 0, tokensOut || 0, costUsd || 0, latencyMs || 0, success ? 1 : 0, errorMsg, ipAddress]
  );
  persist();
}

export async function getUserUsageStats(userId) {
  await initPromise;
  return qOne(
    `SELECT 
       COUNT(*) as total_requests,
       SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful,
       SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failed,
       COALESCE(SUM(tokens_in), 0) as total_tokens_in,
       COALESCE(SUM(tokens_out), 0) as total_tokens_out,
       COALESCE(SUM(cost_usd), 0) as total_cost,
       COALESCE(AVG(latency_ms), 0) as avg_latency
     FROM usage_logs WHERE user_id = ?`,
    [userId]
  );
}

export async function listApiKeys(userId) {
  await initPromise;
  return q(
    'SELECT id, key_prefix, name, rate_limit_max, daily_quota, enabled, last_used_at, created_at FROM api_keys WHERE user_id = ?',
    [userId]
  );
}

export async function revokeApiKey(keyId, userId) {
  await initPromise;
  q('UPDATE api_keys SET enabled = 0 WHERE id = ? AND user_id = ?', [keyId, userId]);
  persist();
}

export async function cleanupExpiredSessions() {
  await initPromise;
  q("DELETE FROM sessions WHERE expires_at < strftime('%s', 'now') * 1000");
  persist();
}

export async function cleanupOldRateLimits() {
  await initPromise;
  const hourAgo = Date.now() - 3600000;
  q('DELETE FROM rate_limits WHERE window_start < ?', [hourAgo]);
  persist();
}

export async function cleanupOldLogs(retentionDays = 90) {
  await initPromise;
  q("DELETE FROM usage_logs WHERE timestamp < datetime('now', '-' || ? || ' days')", [retentionDays]);
  persist();
}

export async function getAdminStats() {
  await initPromise;
  return {
    users: qOne('SELECT COUNT(*) as count FROM users').count,
    activeKeys: qOne('SELECT COUNT(*) as count FROM api_keys WHERE enabled = 1').count,
    totalRequests: qOne('SELECT COUNT(*) as count FROM usage_logs').count,
    totalCost: qOne('SELECT COALESCE(SUM(cost_usd), 0) as total FROM usage_logs').total,
  };
}

export { DB_PATH, DATA_DIR };
export default {
  waitForDb, getDb, createUser, authenticateUser, createApiKey,
  validateApiKey, checkRateLimit, logUsage, getUserUsageStats,
  listApiKeys, revokeApiKey, cleanupExpiredSessions,
  cleanupOldRateLimits, cleanupOldLogs, getAdminStats
};
