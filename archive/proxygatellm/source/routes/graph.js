import { Router } from 'express';
import { addEntity, addRelation, getEntity, searchEntities, getEntityRelations, extractEntities, ingestAndLink, getGraphStats, clearGraph } from '../src/graph.js';

export const graphRouter = Router();

graphRouter.post('/entities', (req, res) => {
  try {
    const { name, type, metadata } = req.body;
    if (!name) return res.status(400).json({ error: 'name required', type: 'invalid_request' });
    const entity = addEntity(name, type || 'concept', metadata || null);
    res.status(201).json(entity);
  } catch (err) {
    res.status(500).json({ error: err.message, type: 'internal_error' });
  }
});

graphRouter.get('/entities', (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.status(400).json({ error: 'query param q required', type: 'invalid_request' });
    const results = searchEntities(q);
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message, type: 'internal_error' });
  }
});

graphRouter.get('/entities/:id', (req, res) => {
  try {
    const entity = getEntity(req.params.id);
    if (!entity) return res.status(404).json({ error: 'Entity not found', type: 'not_found' });
    res.json(entity);
  } catch (err) {
    res.status(500).json({ error: err.message, type: 'internal_error' });
  }
});

graphRouter.get('/entities/:id/relations', (req, res) => {
  try {
    const relations = getEntityRelations(req.params.id);
    res.json({ relations });
  } catch (err) {
    res.status(500).json({ error: err.message, type: 'internal_error' });
  }
});

graphRouter.post('/relations', (req, res) => {
  try {
    const { source_id, target_id, relation_type, weight, context } = req.body;
    if (!source_id || !target_id || !relation_type) {
      return res.status(400).json({ error: 'source_id, target_id, relation_type required', type: 'invalid_request' });
    }
    const relation = addRelation(source_id, target_id, relation_type, weight || 1.0, context || null);
    res.status(201).json(relation);
  } catch (err) {
    res.status(500).json({ error: err.message, type: 'internal_error' });
  }
});

graphRouter.post('/extract', (req, res) => {
  try {
    const { text, source } = req.body;
    if (!text) return res.status(400).json({ error: 'text required', type: 'invalid_request' });
    const result = ingestAndLink(text, source || null);
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message, type: 'internal_error' });
  }
});

graphRouter.get('/stats', (_req, res) => {
  try {
    res.json(getGraphStats());
  } catch (err) {
    res.status(500).json({ error: err.message, type: 'internal_error' });
  }
});

graphRouter.post('/clear', (_req, res) => {
  try {
    clearGraph();
    res.json({ message: 'Graph cleared' });
  } catch (err) {
    res.status(500).json({ error: err.message, type: 'internal_error' });
  }
});
