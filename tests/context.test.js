import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import initSqlJs from 'sql.js';

let sqlDb;
const { initContextTracker, getOrCreateSession, trackUsage, addMessage, getSession, getContextStatus, listSessions, deleteSession, cleanupExpiredSessions } = await import('./context.js');

describe('Context Tracker — initialization', () => {
  before(async () => {
    const SQL = await initSqlJs();
    sqlDb = new SQL.Database();
    await initContextTracker(sqlDb);
  });

  it('should create context_sessions table', () => {
    const rows = sqlDb.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='context_sessions'");
    assert.ok(rows.length > 0);
  });

  it('should create context_messages table', () => {
    const rows = sqlDb.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='context_messages'");
    assert.ok(rows.length > 0);
  });
});

describe('Context Tracker — session management', () => {
  let sessionId;

  it('should create a new session', () => {
    const session = getOrCreateSession(null, 1, 'deepseek-chat');
    assert.ok(session.id);
    assert.equal(session.model, 'deepseek-chat');
    assert.equal(session.tokens_in, 0);
    sessionId = session.id;
  });

  it('should return existing session for same ID', () => {
    const session = getOrCreateSession(sessionId, 1, 'deepseek-chat');
    assert.equal(session.id, sessionId);
  });

  it('should get session by ID', () => {
    const session = getSession(sessionId);
    assert.ok(session);
    assert.equal(session.id, sessionId);
  });

  it('should return null for nonexistent session', () => {
    assert.equal(getSession('nonexistent'), null);
  });
});

describe('Context Tracker — usage tracking', () => {
  let sessionId;

  before(() => {
    const session = getOrCreateSession(null, 1, 'gpt-4o', 128000);
    sessionId = session.id;
  });

  it('should track token usage', () => {
    trackUsage(sessionId, 100, 50);
    const session = getSession(sessionId);
    assert.equal(session.tokens_in, 100);
    assert.equal(session.tokens_out, 50);
  });

  it('should accumulate token counts', () => {
    trackUsage(sessionId, 200, 100);
    const session = getSession(sessionId);
    assert.equal(session.tokens_in, 300);
    assert.equal(session.tokens_out, 150);
  });

  it('should track messages', () => {
    addMessage(sessionId, 'user', 50, 'gpt-4o');
    addMessage(sessionId, 'assistant', 150, 'gpt-4o');
    const status = getContextStatus(sessionId);
    assert.equal(status.messageCount, 2);
  });
});

describe('Context Tracker — context status', () => {
  let sessionId;

  before(() => {
    const session = getOrCreateSession(null, 1, 'deepseek-chat', 65536);
    sessionId = session.id;
    trackUsage(sessionId, 10000, 5000);
  });

  it('should report used and remaining tokens', () => {
    const status = getContextStatus(sessionId);
    assert.equal(status.used, 15000);
    assert.equal(status.max, 65536);
    assert.equal(status.remaining, 50536);
    assert.equal(status.model, 'deepseek-chat');
  });

  it('should suggest model upgrade when context is low', () => {
    const tightSession = getOrCreateSession(null, 1, 'deepseek-chat', 65536);
    trackUsage(tightSession.id, 60000, 5000);
    const status = getContextStatus(tightSession.id);
    assert.equal(status.remaining < 1000, true);
    assert.ok(status.suggestedModel);
  });

  it('should handle 100% usage', () => {
    const fullSession = getOrCreateSession(null, 1, 'gpt-4o-mini', 100);
    trackUsage(fullSession.id, 100, 0);
    const status = getContextStatus(fullSession.id);
    assert.equal(status.remaining, 0);
    assert.equal(status.percentUsed, 100);
  });
});

describe('Context Tracker — session listing and cleanup', () => {
  it('should list sessions for user', () => {
    const sessions = listSessions(1);
    assert.ok(sessions.length >= 3);
  });

  it('should return empty list for unknown user', () => {
    const sessions = listSessions(999);
    assert.equal(sessions.length, 0);
  });

  it('should delete a session', () => {
    const session = getOrCreateSession(null, 1, 'test');
    const id = session.id;
    deleteSession(id);
    assert.equal(getSession(id), null);
  });

  it('should handle cleanup gracefully', () => {
    cleanupExpiredSessions();
    // should not throw
    assert.ok(true);
  });
});
