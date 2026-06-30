import { Router } from 'express';
import { initRag, ingestDocument, queryRag, listDocuments, deleteDocument, clearDocuments, isRagReady } from '../src/rag.js';

export const ragRouter = Router();

ragRouter.post('/ingest', async (req, res) => {
  try {
    const { title, content, source } = req.body;
    if (!title || !content) {
      return res.status(400).json({ error: 'title and content required', type: 'invalid_request' });
    }
    const result = await ingestDocument(title, content, source || null);
    res.status(201).json(result);
  } catch (err) {
    console.error('[RAG] Ingest error:', err.message);
    res.status(500).json({ error: 'Failed to ingest document', type: 'internal_error' });
  }
});

ragRouter.post('/query', async (req, res) => {
  try {
    const { query, top_k, min_score } = req.body;
    if (!query) {
      return res.status(400).json({ error: 'query required', type: 'invalid_request' });
    }
    const result = await queryRag(query, top_k || 5, min_score || 0.05);
    res.json(result);
  } catch (err) {
    console.error('[RAG] Query error:', err.message);
    res.status(500).json({ error: 'Query failed', type: 'internal_error' });
  }
});

ragRouter.get('/documents', async (_req, res) => {
  try {
    const docs = await listDocuments();
    res.json({ documents: docs });
  } catch (err) {
    console.error('[RAG] List error:', err.message);
    res.status(500).json({ error: 'Failed to list documents', type: 'internal_error' });
  }
});

ragRouter.delete('/documents/:id', async (req, res) => {
  try {
    await deleteDocument(req.params.id);
    res.json({ message: 'Document deleted' });
  } catch (err) {
    console.error('[RAG] Delete error:', err.message);
    res.status(500).json({ error: 'Failed to delete document', type: 'internal_error' });
  }
});

ragRouter.post('/clear', async (_req, res) => {
  try {
    await clearDocuments();
    res.json({ message: 'All documents cleared' });
  } catch (err) {
    console.error('[RAG] Clear error:', err.message);
    res.status(500).json({ error: 'Failed to clear documents', type: 'internal_error' });
  }
});

ragRouter.get('/health', (_req, res) => {
  res.json({ ready: isRagReady(), totalChunks: 0 });
});
