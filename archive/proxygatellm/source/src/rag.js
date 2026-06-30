import initSqlJs from 'sql.js';
import { randomUUID } from 'crypto';

class SimpleEmbeddingService {
  constructor() {
    this.dimension = 512;
  }

  _tokenize(text) {
    return (text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 1 && w.length < 50);
  }

  async generateEmbedding(text) {
    const tokens = this._tokenize(text);
    const freq = {};
    for (const t of tokens) freq[t] = (freq[t] || 0) + 1;
    return freq;
  }

  cosineSimilarity(vecA, vecB) {
    let dot = 0, magA = 0, magB = 0;
    for (const k in vecA) { const v = vecA[k]; magA += v * v; if (vecB[k] !== undefined) dot += v * vecB[k]; }
    for (const k in vecB) magB += vecB[k] * vecB[k];
    const denom = Math.sqrt(magA) * Math.sqrt(magB);
    return denom === 0 ? 0 : dot / denom;
  }
}

class RAGService {
  constructor(externalDb = null) {
    this.db = externalDb;
    this.ownsDb = externalDb === null;
    this.embeddingService = new SimpleEmbeddingService();
    this.ready = false;
  }

  async initialize() {
    if (this.ready) return;
    if (this.ownsDb) {
      const SQL = await initSqlJs();
      this.db = new SQL.Database();
    }
    this.db.run(`
      CREATE TABLE IF NOT EXISTS rag_documents (
        id TEXT PRIMARY KEY,
        title TEXT,
        content TEXT NOT NULL,
        source TEXT,
        embedding TEXT,
        chunk_index INTEGER DEFAULT 0,
        token_count INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
    try { this.db.run('CREATE INDEX IF NOT EXISTS idx_rag_source ON rag_documents(source)'); } catch {}
    this.ready = true;
  }

  _prepare(sql, params = []) {
    const stmt = this.db.prepare(sql);
    if (!stmt) return null;
    if (sql.trim().toUpperCase().startsWith('SELECT') || sql.trim().toUpperCase().startsWith('WITH')) {
      stmt.bind(params);
      const results = [];
      while (stmt.step()) results.push(stmt.getAsObject());
      stmt.free();
      return results;
    }
    stmt.run(params);
    stmt.free();
    return { changes: this.db.getRowsModified() };
  }

  async addText(title, content, source = null, chunkSize = 500) {
    const words = content.split(/\s+/);
    const chunks = [];
    for (let i = 0; i < words.length; i += chunkSize) {
      chunks.push(words.slice(i, i + chunkSize).join(' '));
    }
    const ids = [];
    for (let i = 0; i < chunks.length; i++) {
      const id = randomUUID();
      const embedding = await this.embeddingService.generateEmbedding(chunks[i]);
      this._prepare(
        'INSERT INTO rag_documents (id, title, content, source, embedding, chunk_index, token_count) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id, title, chunks[i], source, JSON.stringify(embedding), i, chunks[i].split(/\s+/).length]
      );
      ids.push(id);
    }
    return { ids, totalChunks: chunks.length };
  }

  async search(query, limit = 5, minScore = 0.1) {
    const queryEmbedding = await this.embeddingService.generateEmbedding(query);
    const rows = this._prepare('SELECT id, title, content, source, chunk_index, token_count, embedding, created_at FROM rag_documents ORDER BY token_count');
    if (!rows?.length) return { query, results: [] };

    const scored = [];
    for (const row of rows) {
      if (!row.embedding) continue;
      const docEmbedding = JSON.parse(row.embedding);
      const score = this.embeddingService.cosineSimilarity(queryEmbedding, docEmbedding);
      if (score >= minScore) {
        scored.push({ id: row.id, title: row.title, content: row.content, source: row.source, chunkIndex: row.chunk_index, score });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    return { query, results: scored.slice(0, limit) };
  }

  listDocuments() {
    return this._prepare(
      'SELECT id, title, source, COUNT(*) as chunks FROM rag_documents GROUP BY title, source ORDER BY created_at DESC'
    ) || [];
  }

  deleteDocument(id) {
    this._prepare('DELETE FROM rag_documents WHERE id = ?', [id]);
  }

  clearAll() {
    this._prepare('DELETE FROM rag_documents');
  }

  getStats() {
    const row = this._prepare('SELECT COUNT(*) as count FROM rag_documents');
    return { totalDocuments: row?.[0]?.count || 0, dimension: this.embeddingService.dimension };
  }

  isReady() { return this.ready; }
}

let instance = null;

export async function initRag(externalDb = null) {
  if (!instance) {
    instance = new RAGService(externalDb);
    await instance.initialize();
  }
  return instance;
}

export function getRagInstance() { return instance; }

export async function ingestDocument(title, content, source = null, chunkSize = 500) {
  if (!instance) throw new Error('RAG not initialized — call initRag() first');
  return instance.addText(title, content, source, chunkSize);
}

export async function queryRag(query, topK = 5, minScore = 0.1) {
  if (!instance) throw new Error('RAG not initialized — call initRag() first');
  return instance.search(query, topK, minScore);
}

export async function listDocuments() {
  if (!instance) throw new Error('RAG not initialized');
  return instance.listDocuments();
}

export async function deleteDocument(id) {
  if (!instance) throw new Error('RAG not initialized');
  return instance.deleteDocument(id);
}

export async function clearDocuments() {
  if (!instance) throw new Error('RAG not initialized');
  return instance.clearAll();
}

export function isRagReady() { return instance?.isReady() || false; }

export default { RAGService, SimpleEmbeddingService };
