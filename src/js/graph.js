import { randomUUID } from 'crypto';

let db = null;
let ready = false;

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

const ENTITY_PATTERNS = [
  { type: 'person', regex: /\b[A-Z][a-z]+ [A-Z][a-z]+\b/g },
  { type: 'organization', regex: /\b[A-Z][a-z]+(?: (?:Inc|Corp|LLC|Ltd|AI|Labs?|Technologies|Systems|Research|Group|Foundation))\b/g },
  { type: 'technology', regex: /\b(?:JavaScript|Python|TypeScript|React|Node\.?js|SQLite|PostgreSQL|Redis|Docker|Kubernetes|AWS|GCP|Azure|Linux|TensorFlow|PyTorch|LLM|API|REST|GraphQL|SQL)\b/g },
  { type: 'concept', regex: /\b(?:AI|machine learning|deep learning|neural network|blockchain|quantum|encryption|authentication|authorization|microservices|serverless|edge computing|IoT|DevOps|CI\/CD)\b/gi },
];

export async function initGraph(sqlDb) {
  db = sqlDb;
  q(`CREATE TABLE IF NOT EXISTS graph_entities (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT DEFAULT 'concept',
    metadata TEXT, source TEXT, created_at TEXT DEFAULT (datetime('now'))
  )`);
  q(`CREATE TABLE IF NOT EXISTS graph_relations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, source_id TEXT REFERENCES graph_entities(id),
    target_id TEXT REFERENCES graph_entities(id), relation_type TEXT NOT NULL,
    weight REAL DEFAULT 1.0, context TEXT, created_at TEXT DEFAULT (datetime('now'))
  )`);
  q('CREATE INDEX IF NOT EXISTS idx_graph_relations_source ON graph_relations(source_id)');
  q('CREATE INDEX IF NOT EXISTS idx_graph_relations_target ON graph_relations(target_id)');
  q('CREATE INDEX IF NOT EXISTS idx_graph_entities_name ON graph_entities(name)');
  ready = true;
}

export function isGraphReady() { return ready; }

export function addEntity(name, type = 'concept', metadata = null, source = null) {
  if (!ready) throw new Error('Graph not initialized');
  const existing = q('SELECT id FROM graph_entities WHERE name = ? AND type = ?', [name, type])?.[0];
  if (existing) return { id: existing.id, existing: true };
  const id = randomUUID();
  q('INSERT INTO graph_entities (id, name, type, metadata, source) VALUES (?, ?, ?, ?, ?)',
    [id, name, type, metadata ? JSON.stringify(metadata) : null, source]);
  return { id, existing: false };
}

export function addRelation(sourceId, targetId, relationType, weight = 1.0, context = null) {
  if (!ready) throw new Error('Graph not initialized');
  const existing = q(
    'SELECT id FROM graph_relations WHERE source_id = ? AND target_id = ? AND relation_type = ?',
    [sourceId, targetId, relationType]
  )?.[0];
  if (existing) {
    q('UPDATE graph_relations SET weight = weight + ?, context = COALESCE(?, context) WHERE id = ?',
      [weight, context, existing.id]);
    return { id: existing.id, updated: true };
  }
  q('INSERT INTO graph_relations (source_id, target_id, relation_type, weight, context) VALUES (?, ?, ?, ?, ?)',
    [sourceId, targetId, relationType, weight, context]);
  return { id: null, updated: false };
}

export function getEntity(id) {
  if (!ready) throw new Error('Graph not initialized');
  const entity = q('SELECT * FROM graph_entities WHERE id = ?', [id])?.[0];
  if (!entity) return null;
  if (entity.metadata) try { entity.metadata = JSON.parse(entity.metadata); } catch {}
  entity.relations = q(
    `SELECT r.*, e_s.name as source_name, e_t.name as target_name, e_s.type as source_type, e_t.type as target_type
     FROM graph_relations r
     LEFT JOIN graph_entities e_s ON r.source_id = e_s.id
     LEFT JOIN graph_entities e_t ON r.target_id = e_t.id
     WHERE r.source_id = ? OR r.target_id = ?`, [id, id]
  ) || [];
  return entity;
}

export function searchEntities(query) {
  if (!ready) throw new Error('Graph not initialized');
  return q("SELECT id, name, type, source, created_at FROM graph_entities WHERE name LIKE ? ORDER BY created_at DESC LIMIT 20",
    [`%${query}%`]) || [];
}

export function getEntityRelations(entityId) {
  if (!ready) throw new Error('Graph not initialized');
  return q(
    `SELECT r.*, e_s.name as source_name, e_t.name as target_name
     FROM graph_relations r
     LEFT JOIN graph_entities e_s ON r.source_id = e_s.id
     LEFT JOIN graph_entities e_t ON r.target_id = e_t.id
     WHERE r.source_id = ? OR r.target_id = ? ORDER BY r.weight DESC`, [entityId, entityId]
  ) || [];
}

export function extractEntities(text) {
  if (!ready) throw new Error('Graph not initialized');
  const entities = [];
  const seen = new Set();
  for (const { type, regex } of ENTITY_PATTERNS) {
    const matches = text.matchAll(regex);
    for (const match of matches) {
      const name = match[0].trim();
      if (!seen.has(name.toLowerCase())) {
        seen.add(name.toLowerCase());
        entities.push({ name, type });
      }
    }
  }
  return entities;
}

export function ingestAndLink(text, source = null) {
  if (!ready) throw new Error('Graph not initialized');
  const extracted = extractEntities(text);
  const created = [];
  for (let i = 0; i < extracted.length; i++) {
    const entity = addEntity(extracted[i].name, extracted[i].type, null, source);
    created.push({ ...entity, type: extracted[i].type, name: extracted[i].name });
    if (i > 0) {
      addRelation(created[i - 1].id, entity.id, 'co_occurs', 1.0, source);
    }
  }
  return { entities: created, count: created.length };
}

export function getGraphStats() {
  if (!ready) throw new Error('Graph not initialized');
  return {
    entities: q('SELECT COUNT(*) as count FROM graph_entities')?.[0]?.count || 0,
    relations: q('SELECT COUNT(*) as count FROM graph_relations')?.[0]?.count || 0,
    types: q('SELECT type, COUNT(*) as count FROM graph_entities GROUP BY type ORDER BY count DESC') || [],
  };
}

export function clearGraph() {
  if (!ready) throw new Error('Graph not initialized');
  q('DELETE FROM graph_relations');
  q('DELETE FROM graph_entities');
}
