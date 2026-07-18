/**
 * Jeumpa LLM — RAG Service Tests
 * Tests for vector storage, retrieval, and similarity search
 * 
 * Run: node --test tests/rag.test.js
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { RAGService, SimpleEmbeddingService } from '../src/rag.js';

// ── Embedding Service Tests ──────────────────────────────────────────────────────

describe('RAG — SimpleEmbeddingService', () => {
  let embeddingService;
  
  before(() => {
    embeddingService = new SimpleEmbeddingService();
  });
  
  it('should generate embeddings of correct dimension', async () => {
    const text = 'Hello world';
    const embedding = await embeddingService.generateEmbedding(text);
    
    assert.equal(embedding.length, 384);
    assert.ok(embedding.every(v => v >= -1 && v <= 1), 'Values should be in [-1, 1] range');
  });
  
  it('should generate consistent embeddings for same text', async () => {
    const text = 'Testing consistency';
    const embedding1 = await embeddingService.generateEmbedding(text);
    const embedding2 = await embeddingService.generateEmbedding(text);
    
    assert.deepEqual(embedding1, embedding2);
  });
  
  it('should generate different embeddings for different texts', async () => {
    const embedding1 = await embeddingService.generateEmbedding('Hello');
    const embedding2 = await embeddingService.generateEmbedding('Goodbye');
    
    assert.notDeepEqual(embedding1, embedding2);
  });
  
  it('should calculate cosine similarity correctly', () => {
    const vec1 = [1, 0, 0];
    const vec2 = [1, 0, 0];
    const vec3 = [0, 1, 0];
    
    const sim1 = embeddingService.cosineSimilarity(vec1, vec2);
    const sim2 = embeddingService.cosineSimilarity(vec1, vec3);
    
    assert.equal(sim1, 1); // Same direction
    assert.equal(sim2, 0); // Perpendicular
  });
  
  it('should handle zero vectors in similarity calculation', () => {
    const vec1 = [0, 0, 0];
    const vec2 = [1, 0, 0];
    
    const sim = embeddingService.cosineSimilarity(vec1, vec2);
    assert.equal(sim, 0); // Should return 0, not NaN
  });
});

// ── RAG Service Tests ──────────────────────────────────────────────────────

describe('RAG — RAGService', () => {
  let ragService;
  
  before(async () => {
    ragService = await RAGService.getInstance();
    
    // Clear any existing data
    await ragService.db.run('DELETE FROM embeddings');
  });
  
  it('should initialize with correct table schema', async () => {
    const tableInfo = await ragService.db.all('PRAGMA table_info(embeddings)');
    const columns = tableInfo.map(col => col.name);
    
    assert.ok(columns.includes('id'));
    assert.ok(columns.includes('text'));
    assert.ok(columns.includes('embedding'));
    assert.ok(columns.includes('context_id'));
    assert.ok(columns.includes('metadata'));
    assert.ok(columns.includes('created_at'));
  });
  
  it('should add memory successfully', async () => {
    const result = await ragService.addMemory(
      'Python is a programming language',
      'context_1',
      { type: 'definition', topic: 'python' }
    );
    
    assert.ok(result.success);
    assert.equal(result.text, 'Python is a programming language');
    assert.equal(result.contextId, 'context_1');
  });
  
  it('should retrieve memories by similarity', async () => {
    // Add multiple memories
    await ragService.addMemory('JavaScript is used for web development', 'context_2');
    await ragService.addMemory('Python is great for data science', 'context_3');
    await ragService.addMemory('Machine learning uses algorithms', 'context_4');
    
    const results = await ragService.retrieve('data science programming', 2);
    
    assert.ok(results.length >= 2);
    assert.ok(results[0].similarity >= results[1].similarity); // Sorted by similarity
  });
  
  it('should include metadata in retrieval results', async () => {
    const results = await ragService.retrieve('Python', 5);
    
    const pythonResults = results.filter(r => 
      r.text.toLowerCase().includes('python')
    );
    
    assert.ok(pythonResults.length > 0);
    assert.ok(pythonResults[0].metadata);
  });
  
  it('should delete memory by ID', async () => {
    const result = await ragService.addMemory('Temporary memory', 'temp_context');
    const memoryId = result.id;
    
    const deleteResult = await ragService.deleteMemory(memoryId);
    assert.ok(deleteResult.success);
    
    // Verify deletion
    const rows = await ragService.db.all(
      'SELECT * FROM embeddings WHERE id = ?',
      [memoryId]
    );
    assert.equal(rows.length, 0);
  });
  
  it('should clear all memories for a context', async () => {
    // Add memories to a specific context
    await ragService.addMemory('Memory A', 'clear_test_context');
    await ragService.addMemory('Memory B', 'clear_test_context');
    
    // Clear context
    const result = await ragService.clearContext('clear_test_context');
    assert.ok(result.success);
    
    // Verify all cleared
    const rows = await ragService.db.all(
      'SELECT * FROM embeddings WHERE context_id = ?',
      ['clear_test_context']
    );
    assert.equal(rows.length, 0);
  });
  
  it('should return correct stats', async () => {
    const stats = await ragService.getStats();
    
    assert.ok(stats.totalMemories >= 0);
    assert.equal(stats.dimension, 384);
  });
  
  it('should handle empty query gracefully', async () => {
    const results = await ragService.retrieve('', 5);
    
    // Should return empty array or all results with low similarity
    assert.ok(Array.isArray(results));
  });
  
  it('should respect limit parameter', async () => {
    const results1 = await ragService.retrieve('test', 3);
    const results2 = await ragService.retrieve('test', 10);
    
    assert.ok(results1.length <= 3);
    assert.ok(results2.length <= 10);
    assert.ok(results2.length >= results1.length);
  });
});

// ── Integration Tests ──────────────────────────────────────────────────────

describe('RAG — Integration Flow', () => {
  it('should complete full RAG flow', async () => {
    const rag = await RAGService.getInstance();
    
    // Add memories
    await rag.addMemory('Users can authenticate via API keys', 'auth_docs');
    await rag.addMemory('Rate limiting prevents abuse', 'auth_docs');
    await rag.addMemory('Multi-tenant architecture isolates users', 'architecture');
    
    // Retrieve relevant context
    const query = 'How does authentication work?';
    const results = await rag.retrieve(query, 3);
    
    assert.ok(results.length > 0);
    assert.ok(results[0].text.toLowerCase().includes('auth') || 
              results[0].text.toLowerCase().includes('api'));
    
    // Verify similarity scores are meaningful
    assert.ok(results[0].similarity > 0);
    assert.ok(results[0].similarity <= 1);
  });
});

console.log('\n✅ RAG Service Test Suite Ready\n');