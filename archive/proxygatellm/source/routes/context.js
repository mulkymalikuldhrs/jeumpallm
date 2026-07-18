import { Router } from 'express';
import { getOrCreateSession, trackUsage, addMessage, getSession, getContextStatus, listSessions, deleteSession } from '../src/context.js';

export const contextRouter = Router();

contextRouter.post('/sessions', (req, res) => {
  try {
    const { session_id, model, max_context } = req.body;
    const userId = req._userId || null;
    const session = getOrCreateSession(session_id, userId, model || 'deepseek-chat', max_context);
    res.status(201).json(session);
  } catch (err) {
    res.status(500).json({ error: err.message, type: 'internal_error' });
  }
});

contextRouter.get('/sessions', (req, res) => {
  try {
    const userId = req._userId || null;
    const sessions = listSessions(userId);
    res.json({ sessions });
  } catch (err) {
    res.status(500).json({ error: err.message, type: 'internal_error' });
  }
});

contextRouter.get('/sessions/:id', (req, res) => {
  try {
    const status = getContextStatus(req.params.id);
    if (!status) return res.status(404).json({ error: 'Session not found', type: 'not_found' });
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message, type: 'internal_error' });
  }
});

contextRouter.get('/sessions/:id/status', (req, res) => {
  try {
    const status = getContextStatus(req.params.id);
    if (!status) return res.status(404).json({ error: 'Session not found', type: 'not_found' });
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message, type: 'internal_error' });
  }
});

contextRouter.post('/sessions/:id/track', (req, res) => {
  try {
    const { tokens_in, tokens_out, role, token_count } = req.body;
    trackUsage(req.params.id, tokens_in || 0, tokens_out || 0);
    if (role && token_count) addMessage(req.params.id, role, token_count);
    res.json(getContextStatus(req.params.id));
  } catch (err) {
    res.status(500).json({ error: err.message, type: 'internal_error' });
  }
});

contextRouter.delete('/sessions/:id', (req, res) => {
  try {
    deleteSession(req.params.id);
    res.json({ message: 'Session deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message, type: 'internal_error' });
  }
});
