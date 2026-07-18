import { randomUUID } from 'crypto';

let db = null;
let ready = false;

const MODEL_CONTEXT_LIMITS = {
  'gpt-4o': 128000, 'gpt-4o-mini': 128000, 'gpt-5-chat': 131072,
  'o1': 200000, 'o1-mini': 131072, 'o3-mini': 200000,
  'claude-opus-4-5-latest': 200000, 'claude-sonnet-4': 200000,
  'claude-haiku-4-5': 200000, 'claude-3-5-sonnet': 200000, 'claude-3-haiku': 200000,
  'gemini-2.0-flash': 1048576, 'gemini-2.5-flash-preview-05-20': 1048576,
  'gemini-2.5-pro-preview-05-06': 1048576,
  'deepseek-chat': 65536, 'deepseek-r1': 65536, 'deepseek-reasoner': 65536,
  'grok-3': 131072, 'grok-3-fast': 131072,
  'llama-3.3-70b-versatile': 131072, 'llama-3.1-8b-instant': 131072,
};

const MODEL_UPGRADE_PATH = [
  { minContext: 0, suggestion: null },
  { minContext: 32000, suggestion: 'gpt-4o-mini' },
  { minContext: 64000, suggestion: 'deepseek-chat' },
  { minContext: 128000, suggestion: 'gpt-4o' },
  { minContext: 200000, suggestion: 'claude-sonnet-4' },
  { minContext: 500000, suggestion: 'gemini-2.5-flash-preview-05-20' },
];

function q(sql, params = []) {
  const stmt = db.prepare(sql);
  if (!stmt) return null;
  if (sql.trim().toUpperCase().startsWith('SELECT') || sql.trim().toUpperCase().startsWith('WITH')) {
    stmt.bind(params); const results = [];
    while (stmt.step()) results.push(stmt.getAsObject());
    stmt.free(); return results;
  }
  stmt.run(params); stmt.free();
  return { changes: db.getRowsModified() };
}

export async function initContextTracker(sqlDb) {
  db = sqlDb;
  q(`CREATE TABLE IF NOT EXISTS context_sessions (
    id TEXT PRIMARY KEY, user_id INTEGER, model TEXT NOT NULL,
    tokens_in INTEGER DEFAULT 0, tokens_out INTEGER DEFAULT 0,
    max_context INTEGER DEFAULT 8192, message_count INTEGER DEFAULT 0,
    expires_at TEXT, created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);
  q(`CREATE TABLE IF NOT EXISTS context_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT REFERENCES context_sessions(id),
    role TEXT NOT NULL, token_count INTEGER DEFAULT 0,
    model TEXT, created_at TEXT DEFAULT (datetime('now'))
  )`);
  ready = true;
}

export function isContextReady() { return ready; }

export function getOrCreateSession(sessionId, userId, model, maxContext) {
  if (!ready) throw new Error('Context tracker not initialized');
  const maxCtx = maxContext || MODEL_CONTEXT_LIMITS[model] || 8192;
  let session = q('SELECT * FROM context_sessions WHERE id = ?', [sessionId])?.[0];
  if (!session) {
    const id = sessionId || randomUUID();
    q('INSERT INTO context_sessions (id, user_id, model, max_context) VALUES (?, ?, ?, ?)',
      [id, userId || 0, model || 'deepseek-chat', maxCtx]);
    session = q('SELECT * FROM context_sessions WHERE id = ?', [id])?.[0];
  }
  return session;
}

export function trackUsage(sessionId, tokensIn, tokensOut) {
  if (!ready) throw new Error('Context tracker not initialized');
  q('UPDATE context_sessions SET tokens_in = tokens_in + ?, tokens_out = tokens_out + ?, message_count = message_count + 1, updated_at = datetime("now") WHERE id = ?',
    [tokensIn || 0, tokensOut || 0, sessionId]);
}

export function addMessage(sessionId, role, tokenCount, model) {
  if (!ready) throw new Error('Context tracker not initialized');
  q('INSERT INTO context_messages (session_id, role, token_count, model) VALUES (?, ?, ?, ?)',
    [sessionId, role, tokenCount || 0, model || null]);
}

export function getSession(sessionId) {
  if (!ready) throw new Error('Context tracker not initialized');
  return q('SELECT * FROM context_sessions WHERE id = ?', [sessionId])?.[0] || null;
}

export function getContextStatus(sessionId) {
  if (!ready) throw new Error('Context tracker not initialized');
  const session = getSession(sessionId);
  if (!session) return null;
  const used = (session.tokens_in || 0) + (session.tokens_out || 0);
  const max = session.max_context;
  const remaining = Math.max(0, max - used);
  const percentUsed = max > 0 ? Math.round((used / max) * 100) : 0;

  let suggestedModel = null;
  for (let i = MODEL_UPGRADE_PATH.length - 1; i >= 0; i--) {
    if (remaining <= MODEL_UPGRADE_PATH[i].minContext) {
      suggestedModel = MODEL_UPGRADE_PATH[i].suggestion;
      if (suggestedModel !== session.model) break;
      suggestedModel = null;
    }
  }

  return { sessionId, model: session.model, used, max, remaining, percentUsed, suggestedModel, messageCount: session.message_count };
}

export function listSessions(userId) {
  if (!ready) throw new Error('Context tracker not initialized');
  return q('SELECT id, model, tokens_in, tokens_out, max_context, message_count, updated_at, created_at FROM context_sessions WHERE user_id = ? ORDER BY updated_at DESC', [userId]) || [];
}

export function deleteSession(sessionId) {
  if (!ready) throw new Error('Context tracker not initialized');
  q('DELETE FROM context_messages WHERE session_id = ?', [sessionId]);
  q('DELETE FROM context_sessions WHERE id = ?', [sessionId]);
}

export function cleanupExpiredSessions() {
  if (!ready) return;
  const expired = q("SELECT id FROM context_sessions WHERE expires_at < datetime('now')");
  if (expired) for (const s of expired) deleteSession(s.id);
}
