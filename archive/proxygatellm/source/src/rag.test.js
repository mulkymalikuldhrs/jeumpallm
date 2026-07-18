import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import initSqlJs from 'sql.js';

const TEST_DIR = mkdtempSync(join(tmpdir(), 'jeumpa-rag-test-'));
const TEST_DB = join(TEST_DIR, 'test-rag.db');

let sqlDb;

const { initRag, ingestDocument, queryRag, listDocuments, deleteDocument, clearDocuments } = await import('./rag.js');

describe('RAG — initialization', () => {
  before(async () => {
    const SQL = await initSqlJs();
    sqlDb = new SQL.Database();
  });

  it('should initialize RAG tables', async () => {
    await initRag(sqlDb);
    const rows = sqlDb.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='rag_documents'");
    assert.ok(rows.length > 0);
  });
});

describe('RAG — document ingestion', () => {
  it('should ingest a document and return chunk IDs', async () => {
    const result = await ingestDocument(
      'Test Doc',
      'This is a test document about artificial intelligence and machine learning. It discusses neural networks and deep learning algorithms.',
      'test-source'
    );
    assert.ok(result.ids.length >= 1);
    assert.ok(result.totalChunks >= 1);
  });

  it('should ingest a long document split into chunks', async () => {
    const words = Array.from({ length: 2500 }, (_, i) => `word${i}`).join(' ');
    const result = await ingestDocument('Long Doc', words, 'test-source');
    assert.ok(result.totalChunks >= 2);
    assert.equal(result.ids.length, result.totalChunks);
  });

  it('should handle empty content gracefully', async () => {
    const result = await ingestDocument('Empty Doc', '', 'test');
    assert.ok(result.ids.length >= 1);
  });
});

describe('RAG — query', () => {
  before(async () => {
    await clearDocuments();
    await ingestDocument('AI', 'Artificial intelligence and machine learning are transforming technology. Neural networks and deep learning are key components.', 'knowledge');
    await ingestDocument('Cars', 'Automobiles and vehicles run on engines. Electric cars use batteries instead of gasoline. Self-driving cars use AI.', 'knowledge');
    await ingestDocument('Cooking', 'Recipes and cooking techniques vary by culture. Baking requires precise measurements while cooking allows creativity.', 'knowledge');
  });

  it('should find AI-related documents', async () => {
    const result = await queryRag('machine learning', 3, 0.01);
    assert.ok(result.results.length >= 1);
    assert.ok(result.results.some(r => r.title === 'AI'));
  });

  it('should find car-related documents', async () => {
    const result = await queryRag('electric vehicles', 3, 0.01);
    assert.ok(result.results.length >= 1);
    assert.ok(result.results.some(r => r.title === 'Cars'));
  });

  it('should return empty results for unrelated query', async () => {
    const result = await queryRag('zzzzzzzzz', 3, 0.9);
    assert.equal(result.results.length, 0);
  });

  it('should respect topK parameter', async () => {
    const result = await queryRag('technology', 1, 0.01);
    assert.ok(result.results.length <= 1);
  });

  it('should return query string in result', async () => {
    const result = await queryRag('test query', 1, 0.01);
    assert.equal(result.query, 'test query');
  });
});

describe('RAG — document management', () => {
  before(async () => {
    await clearDocuments();
  });

  it('should list documents', async () => {
    await ingestDocument('Doc1', 'Content one', 'src1');
    await ingestDocument('Doc2', 'Content two', 'src2');
    const docs = await listDocuments();
    assert.ok(docs.length >= 2);
  });

  it('should delete a document', async () => {
    const docs = await listDocuments();
    if (docs.length > 0) {
      await deleteDocument(docs[0].id);
      const remaining = await listDocuments();
      assert.ok(remaining.length < docs.length);
    }
  });

  it('should clear all documents', async () => {
    await clearDocuments();
    const docs = await listDocuments();
    assert.equal(docs.length, 0);
  });
});

after(() => {
  if (sqlDb) sqlDb.close();
  try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
});
