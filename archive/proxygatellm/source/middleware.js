// middleware.js
// Jeumpa LLM — Multi-tenant auth, persistent rate limiting, input validation

import { validateApiKey, checkRateLimit, waitForDb, logUsage } from './src/db.js';

// ── Persistent Rate Limiter (SQLite-backed) ─────────────────────────────

const DEFAULT_RATE_LIMIT_MAX = parseInt(process.env.RATELIMIT_MAX_REQUESTS || '100', 10);
const DEFAULT_RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATELIMIT_WINDOW_MS || '60000', 10);
const FALLBACK_RATE_LIMIT_MAX = 20; // Per-IP fallback when no API key

/**
 * Rate limiting middleware — per API key or per IP fallback
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export async function rateLimiter(req, res, next) {
  try {
    await waitForDb();
    const keyHash = req._keyHash || req.ip || 'unknown';
    const max = req._apiKey?.rate_limit_max || FALLBACK_RATE_LIMIT_MAX;
    const windowMs = req._apiKey?.rate_limit_window_ms || DEFAULT_RATE_LIMIT_WINDOW_MS;

    const result = await checkRateLimit(keyHash, max, windowMs);

    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(result.remaining));
    res.setHeader('X-RateLimit-Reset', String(result.resetTime));

    if (!result.allowed) {
      return res.status(429).json({
        error: 'Rate limit exceeded',
        type: 'rate_limit_error',
        retry_after_ms: result.resetTime - Date.now()
      });
    }

    next();
  } catch (err) {
    console.error('[RATE-LIMIT] Error:', err.message);
    next(); // Fail open if DB is down
  }
}

// ── Multi-Tenant API Key Authentication ─────────────────────────────────

/**
 * API key authentication — validates against SQLite
 * Supports X-API-Key header and Authorization: Bearer
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export async function API_KEY_AUTH(req, res, next) {
  try {
    await waitForDb();

    const providedKey =
      req.headers['x-api-key'] ||
      (req.headers['authorization']?.startsWith('Bearer ') ? req.headers['authorization'].slice(7) : null);

    // If no key provided, still allow but with IP-based rate limiting
    if (!providedKey) {
      req._authenticated = false;
      req._userId = null;
      req._apiKeyId = null;
      req._keyHash = req.ip || 'unknown';
      return next();
    }

    const apiKey = await validateApiKey(providedKey);
    if (!apiKey) {
      return res.status(401).json({
        error: 'Invalid or revoked API key',
        type: 'authentication_error'
      });
    }

    req._authenticated = true;
    req._userId = apiKey.user_id;
    req._apiKeyId = apiKey.id;
    req._apiKey = apiKey;
    req._keyHash = apiKey.key_hash;
    req._user = apiKey.user;

    res.setHeader('X-Key-Prefix', apiKey.key_prefix);
    next();
  } catch (err) {
    console.error('[AUTH] Error:', err.message);
    next(); // Fail open if DB is down
  }
}

/**
 * Log API usage after response is sent
 */
export function usageLogger(req, res, next) {
  const start = Date.now();
  const originalJson = res.json.bind(res);

  res.json = function(data) {
    const latencyMs = Date.now() - start;
    const success = res.statusCode < 500;

    logUsage(
      req._apiKeyId,
      req._userId,
      data?._meta?.provider || 'unknown',
      req.body?.model || 'auto',
      data?.usage?.prompt_tokens || data?.usage?.input_tokens || 0,
      data?.usage?.completion_tokens || data?.usage?.output_tokens || 0,
      data?._meta?.estimated_cost ? parseFloat(data._meta.estimated_cost.replace(/[^0-9.]/g, '')) : 0,
      latencyMs,
      success,
      success ? null : (data?.error || null),
      req.ip || 'unknown'
    ).catch(() => {});

    return originalJson(data);
  };

  next();
}

// ── Input Validation ──────────────────────────────────────────────────

const MAX_MESSAGE_LENGTH = 50000;
const MAX_MESSAGES_COUNT = 128;
const ALLOWED_ROLES = new Set(['system', 'user', 'assistant', 'tool']);

/**
 * Validates chat completion request body
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function validateChatRequest(req, res, next) {
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ error: 'Request body must be a JSON object', type: 'invalid_request' });
  }

  const { messages, model } = req.body;

  if (model !== undefined && typeof model !== 'string') {
    return res.status(400).json({ error: 'model must be a string', type: 'invalid_request' });
  }

  if (model !== undefined && model.length > 256) {
    return res.status(400).json({ error: 'model name too long (max 256 chars)', type: 'invalid_request' });
  }

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages must be a non-empty array', type: 'invalid_request' });
  }

  if (messages.length === 0) {
    return res.status(400).json({ error: 'messages array must not be empty', type: 'invalid_request' });
  }

  if (messages.length > MAX_MESSAGES_COUNT) {
    return res.status(400).json({ error: `Too many messages (max ${MAX_MESSAGES_COUNT})`, type: 'invalid_request' });
  }

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg || typeof msg !== 'object') {
      return res.status(400).json({ error: `messages[${i}] must be an object`, type: 'invalid_request' });
    }
    if (!ALLOWED_ROLES.has(msg.role)) {
      return res.status(400).json({ error: `messages[${i}].role must be one of: ${[...ALLOWED_ROLES].join(', ')}`, type: 'invalid_request' });
    }
    if (msg.content !== undefined && typeof msg.content !== 'string' && !Array.isArray(msg.content)) {
      return res.status(400).json({ error: `messages[${i}].content must be a string or array`, type: 'invalid_request' });
    }
    if (typeof msg.content === 'string' && msg.content.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({ error: `messages[${i}].content too long (max ${MAX_MESSAGE_LENGTH} chars)`, type: 'invalid_request' });
    }
  }

  next();
}

/**
 * Validates Anthropic messages request body
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function validateMessagesRequest(req, res, next) {
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ error: 'Request body must be a JSON object', type: 'invalid_request' });
  }

  const { messages, model, system, prompt, max_tokens } = req.body;

  if (model !== undefined && typeof model !== 'string') {
    return res.status(400).json({ error: 'model must be a string', type: 'invalid_request' });
  }

  if (model !== undefined && model.length > 256) {
    return res.status(400).json({ error: 'model name too long (max 256 chars)', type: 'invalid_request' });
  }

  if (system !== undefined && typeof system !== 'string') {
    return res.status(400).json({ error: 'system must be a string', type: 'invalid_request' });
  }

  if (system !== undefined && system.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({ error: 'system prompt too long', type: 'invalid_request' });
  }

  if (prompt !== undefined && typeof prompt !== 'string') {
    return res.status(400).json({ error: 'prompt must be a string', type: 'invalid_request' });
  }

  if (max_tokens !== undefined && (typeof max_tokens !== 'number' || max_tokens < 1)) {
    return res.status(400).json({ error: 'max_tokens must be a positive number', type: 'invalid_request' });
  }

  if (messages !== undefined) {
    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages must be an array', type: 'invalid_request' });
    }
    if (messages.length > MAX_MESSAGES_COUNT) {
      return res.status(400).json({ error: `Too many messages (max ${MAX_MESSAGES_COUNT})`, type: 'invalid_request' });
    }
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (!msg || typeof msg !== 'object') {
        return res.status(400).json({ error: `messages[${i}] must be an object`, type: 'invalid_request' });
      }
      if (!ALLOWED_ROLES.has(msg.role)) {
        return res.status(400).json({ error: `messages[${i}].role is invalid`, type: 'invalid_request' });
      }
    }
  }

  next();
}

/**
 * Sanitizes messages by removing potentially dangerous content
 * @param {Array<{role: string, content?: string|Array}>} messages
 * @returns {Array<{role: string, content?: string|Array}>}
 */
export function sanitizeMessages(messages) {
  if (!Array.isArray(messages)) return [];

  return messages.map(msg => {
    if (!msg || typeof msg !== 'object') return msg;

    const sanitized = { ...msg };

    if (typeof sanitized.content === 'string') {
      sanitized.content = sanitized.content.replace(/\0/g, '');
    }

    return sanitized;
  }).filter(Boolean);
}
