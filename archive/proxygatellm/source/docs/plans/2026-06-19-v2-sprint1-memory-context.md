# Jeumpa LLM v2 Sprint 1: Memory & Context Implementation Plan

> **Goal:** Build context window tracking and graph memory on top of v1.0.0 foundation
> **Architecture:** New `src/context.js` (session-level token tracking + model auto-switch) + `src/graph.js` (entity extraction + SQLite relations). Wired via Express routes at `/v1/context` and `/v1/graph`.
> **Tech Stack:** Node.js, sql.js, Express 5, crypto (UUIDs)

---

### Task 1: Context Window Tracking (`src/context.js`)

**Files:**
- Create: `src/context.js`
- Test: N/A (tested via integration)

**Context:** Track per-session token usage. When a session approaches its model's context limit, auto-suggest or auto-switch to a model with larger context. Uses existing `estimateTokens` from cost-estimator.js and the session lookup flow.

**Tables (created in `context.js`):**

```sql
CREATE TABLE IF NOT EXISTS context_sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER,
  model TEXT NOT NULL,
  tokens_in INTEGER DEFAULT 0,
  tokens_out INTEGER DEFAULT 0,
  max_context INTEGER DEFAULT 8192,
  expires_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS context_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT REFERENCES context_sessions(id),
  role TEXT NOT NULL,
  token_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
```

**API surface:**
- `initContextTracker(db)` — creates tables
- `getOrCreateSession(sessionId, userId, model, maxContext)` — get or create session
- `trackUsage(sessionId, tokensIn, tokensOut)` — update token counts
- `getSession(sessionId)` — return session with stats
- `getContextStatus(sessionId)` — returns `{ used, max, remaining, percentUsed, suggestedModel }`
- `listSessions(userId)` — list all sessions for user
- `deleteSession(sessionId)` — cleanup

### Task 2: Graph Memory (`src/graph.js`)

**Files:**
- Create: `src/graph.js`
- Test: N/A (tested via integration)

**Tables:**

```sql
CREATE TABLE IF NOT EXISTS graph_entities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT DEFAULT 'concept',
  metadata TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS graph_relations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT REFERENCES graph_entities(id),
  target_id TEXT REFERENCES graph_entities(id),
  relation_type TEXT NOT NULL,
  weight REAL DEFAULT 1.0,
  context TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
```

**API surface:**
- `initGraph(db)` — creates tables
- `addEntity(name, type, metadata)` — create entity
- `addRelation(sourceId, targetId, type, weight, context)` — create relation
- `getEntity(id)` — get entity + its relations
- `searchEntities(query)` — text search
- `getGraphStats()` — count of entities + relations
- `extractEntities(text)` — simple regex-based entity extraction (proper NLP later)
- `clearGraph()` — wipe all

### Task 3: Routes + Integration

**Files:**
- Create: `routes/context.js` — GET/POST /v1/context/sessions, GET/DELETE /v1/context/sessions/:id
- Create: `routes/graph.js` — POST/GET /v1/graph/entities, POST /v1/graph/relations, GET /v1/graph/stats
- Modify: `index.js` — mount context + graph routes

### Task 4: Tests

**Files:**
- Create: `src/context.test.js`
- Create: `src/graph.test.js`

### Task 5: Verify

Run: `npm test`
Expected: all existing 108 tests pass + new tests pass = full green
