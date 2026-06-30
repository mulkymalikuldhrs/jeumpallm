// routes/auth.js
// Jeumpa LLM — User & API Key Management Routes

import { Router } from 'express';
import {
  createUser, authenticateUser, createApiKey,
  listApiKeys, revokeApiKey, getUserUsageStats,
  getAdminStats
} from '../src/db.js';

export const authRouter = Router();

authRouter.post('/users', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'username, email, and password required', type: 'invalid_request' });
    }
    if (username.length < 3 || username.length > 32) {
      return res.status(400).json({ error: 'username must be 3-32 characters', type: 'invalid_request' });
    }
    if (!email.includes('@') || email.length > 128) {
      return res.status(400).json({ error: 'invalid email', type: 'invalid_request' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'password must be at least 8 characters', type: 'invalid_request' });
    }
    const user = await createUser(username, email, password);
    res.status(201).json({ id: user.id, username: user.username, email: user.email });
  } catch (err) {
    if (err.message?.includes('already exists')) {
      return res.status(409).json({ error: err.message, type: 'conflict' });
    }
    console.error('[AUTH] Create user error:', err.message);
    res.status(500).json({ error: 'Failed to create user', type: 'internal_error' });
  }
});

authRouter.post('/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'username and password required', type: 'invalid_request' });
    }
    const user = await authenticateUser(username, password);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials', type: 'authentication_error' });
    }
    res.json({ id: user.id, username: user.username, email: user.email, role: user.role });
  } catch (err) {
    console.error('[AUTH] Login error:', err.message);
    res.status(500).json({ error: 'Login failed', type: 'internal_error' });
  }
});

authRouter.post('/keys', async (req, res) => {
  try {
    if (!req._authenticated) {
      return res.status(401).json({ error: 'Authentication required to create API keys', type: 'authentication_error' });
    }
    const { name, rate_limit_max } = req.body;
    const result = await createApiKey(req._userId, name || 'default', rate_limit_max || 100);
    res.status(201).json({
      key: result.key,
      prefix: result.prefix,
      message: 'Save this key — it will not be shown again'
    });
  } catch (err) {
    console.error('[AUTH] Create key error:', err.message);
    res.status(500).json({ error: 'Failed to create API key', type: 'internal_error' });
  }
});

authRouter.get('/keys', async (req, res) => {
  try {
    if (!req._authenticated) {
      return res.status(401).json({ error: 'Authentication required', type: 'authentication_error' });
    }
    const keys = await listApiKeys(req._userId);
    res.json({ keys });
  } catch (err) {
    console.error('[AUTH] List keys error:', err.message);
    res.status(500).json({ error: 'Failed to list keys', type: 'internal_error' });
  }
});

authRouter.delete('/keys/:id', async (req, res) => {
  try {
    if (!req._authenticated) {
      return res.status(401).json({ error: 'Authentication required', type: 'authentication_error' });
    }
    await revokeApiKey(parseInt(req.params.id), req._userId);
    res.json({ message: 'Key revoked' });
  } catch (err) {
    console.error('[AUTH] Revoke key error:', err.message);
    res.status(500).json({ error: 'Failed to revoke key', type: 'internal_error' });
  }
});

authRouter.get('/usage', async (req, res) => {
  try {
    if (!req._authenticated) {
      return res.status(401).json({ error: 'Authentication required', type: 'authentication_error' });
    }
    const stats = await getUserUsageStats(req._userId);
    res.json(stats);
  } catch (err) {
    console.error('[AUTH] Usage stats error:', err.message);
    res.status(500).json({ error: 'Failed to get usage stats', type: 'internal_error' });
  }
});

authRouter.get('/admin/stats', async (req, res) => {
  try {
    if (!req._authenticated || req._user?.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required', type: 'authorization_error' });
    }
    const stats = await getAdminStats();
    res.json(stats);
  } catch (err) {
    console.error('[AUTH] Admin stats error:', err.message);
    res.status(500).json({ error: 'Failed to get admin stats', type: 'internal_error' });
  }
});

export default authRouter;
