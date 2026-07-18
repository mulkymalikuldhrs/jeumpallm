// index.js
// Jeumpa LLM — AI Operating Layer (formerly ProxyGateLLM v6.0.0)
// OpenAI/Anthropic-compatible API with 22 providers, circuit breaker,
// cost estimation, smart routing, streaming, MCP, multi-tenant auth,
// persistent rate limiting, usage tracking, and PWA dashboard

import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import express from 'express';
import { providerRegistry } from './providers/index.js';
import { ProviderManager } from './utils/provider-manager.js';
import { MCPServer } from './utils/mcp-server.js';
import { ModelSyncService } from './utils/model-sync.js';
import { resolveModel, pickModel, getTaskType } from './router.js';
import { rateLimiter, usageLogger, validateChatRequest, validateMessagesRequest, sanitizeMessages, API_KEY_AUTH } from './middleware.js';
import { estimateCost, estimateInputTokens, formatCost } from './utils/cost-estimator.js';
import { FREE_PROVIDERS } from './config/providers.js';
import { waitForDb, getDb, cleanupOldRateLimits, cleanupExpiredSessions, getAdminStats } from './src/db.js';
import { authRouter } from './routes/auth.js';
import { initRag } from './src/rag.js';
import { ragRouter } from './routes/rag.js';
import { initContextTracker } from './src/context.js';
import { contextRouter } from './routes/context.js';
import { initGraph } from './src/graph.js';
import { graphRouter } from './routes/graph.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: join(__dirname, '.env') });

const PORT = parseInt(process.env.PORT || '3333', 10);
const CORS_ORIGIN = process.env.CORS_ORIGIN || '';
const VERSION = '1.0.0';

// ── Initialize Systems ────────────────────────────────────────────────────

const registry = providerRegistry;
const manager = new ProviderManager(registry);
const syncService = new ModelSyncService(registry);
const mcpServer = new MCPServer(manager);

async function initProviders() {
  try {
    await registry.init();
    await manager.start();
    await syncService.start();
    const enabledCount = registry.getEnabledProviders().length;
    const freeCount = registry.getFreeProviders().length;
    const modelCount = registry.getAllModels().length;
    console.log(`[Jeumpa LLM] Multi-provider system initialized: ${enabledCount} providers active (${freeCount} free), ${modelCount} models available`);
  } catch (err) {
    console.error(`[Jeumpa LLM] Provider init error: ${err.message}`);
  }
}

async function initDB() {
  try {
    await waitForDb();
    console.log('[Jeumpa LLM] Database initialized');
    // Initialize RAG subsystem
    try {
      initRag(getDb());
      console.log('[Jeumpa LLM] RAG engine ready');
    } catch (e) {
      console.error('[Jeumpa LLM] RAG init error:', e.message);
    }
    // Initialize context tracker
    try {
      initContextTracker(getDb());
      console.log('[Jeumpa LLM] Context tracker ready');
    } catch (e) {
      console.error('[Jeumpa LLM] Context tracker init error:', e.message);
    }
    // Initialize graph memory
    try {
      initGraph(getDb());
      console.log('[Jeumpa LLM] Graph memory ready');
    } catch (e) {
      console.error('[Jeumpa LLM] Graph memory init error:', e.message);
    }
    // Cleanup tasks every hour
    setInterval(async () => {
      try {
        await cleanupOldRateLimits();
        await cleanupExpiredSessions();
      } catch (e) { /* silent */ }
    }, 3600000);
  } catch (err) {
    console.error(`[Jeumpa LLM] Database init error: ${err.message}`);
  }
}

// ── Express App ───────────────────────────────────────────────────────────

const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// CORS
app.use((req, res, next) => {
  if (CORS_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key, Anthropic-Api-Version');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  res.removeHeader('X-Powered-By');
  next();
});

// ── Request Logging ───────────────────────────────────────────────────────
const requestLog = [];
const MAX_LOG_SIZE = 2000;

function logRequest(req, res, next) {
  const start = Date.now();
  const originalJson = res.json.bind(res);
  
  res.json = function(data) {
    const latency = Date.now() - start;
    const logEntry = {
      timestamp: new Date().toISOString(),
      method: req.method,
      path: req.path,
      model: req.body?.model || 'auto',
      status: res.statusCode,
      latency_ms: latency,
      ip: req.ip || req.connection?.remoteAddress || 'unknown'
    };
    
    requestLog.unshift(logEntry);
    if (requestLog.length > MAX_LOG_SIZE) requestLog.pop();
    
    if (process.env.LOG_LEVEL === 'debug') {
      console.log(`[REQ] ${logEntry.method} ${logEntry.path} → ${logEntry.status} (${logEntry.latency_ms}ms) model=${logEntry.model}`);
    }
    
    return originalJson(data);
  };
  
  next();
}

app.use(logRequest);

// Rate limiting on all API routes (SQLite-backed, per-key)
app.use('/v1', rateLimiter);
app.use('/chat', rateLimiter);

// Multi-tenant API key auth (SQLite lookup)
app.use(API_KEY_AUTH);

// Usage logging (logged after response)
app.use(usageLogger);

// Auth routes (user management, API key management)
app.use('/v1', authRouter);

// Mount RAG routes
app.use('/v1/rag', ragRouter);

// Context window tracking
app.use('/v1/context', contextRouter);

// Graph memory
app.use('/v1/graph', graphRouter);

// Jeumpa LLM API root — version info
app.get('/v1', (_req, res) => {
  res.json({
    name: 'Jeumpa LLM',
    version: VERSION,
    description: 'AI Operating Layer — multi-LLM gateway with 22 providers, multi-tenant auth, RAG engine',
    docs: '/api/v1/docs',
    health: '/health',
    models: '/models',
    providers: '/providers',
    endpoints: {
      chat: 'POST /v1/chat/completions',
      messages: 'POST /v1/messages',
      users: 'POST /v1/users',
      login: 'POST /v1/auth/login',
      keys: 'GET/POST /v1/keys',
      usage: 'GET /v1/usage',
      admin: 'GET /v1/admin/stats',
      rag: {
        ingest: 'POST /v1/rag/ingest',
        query: 'POST /v1/rag/query',
        documents: 'GET /v1/rag/documents',
        clear: 'POST /v1/rag/clear'
      },
      context: {
        sessions: 'GET/POST /v1/context/sessions',
        status: 'GET /v1/context/sessions/:id/status',
        track: 'POST /v1/context/sessions/:id/track'
      },
      graph: {
        entities: 'GET/POST /v1/graph/entities',
        relations: 'POST /v1/graph/relations',
        extract: 'POST /v1/graph/extract',
        stats: 'GET /v1/graph/stats',
        clear: 'POST /v1/graph/clear'
      }
    }
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────

function extractContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(c => (typeof c === 'object' && c !== null && 'text' in c) ? c.text : String(c)).join('');
  return '';
}

function safeErrorResponse(error, type = 'internal_error') {
  if (process.env.NODE_ENV === 'production') return { error: 'Internal server error', type };
  return { error: error.message || 'An unexpected error occurred', type };
}

const FRAGILE_PROVIDERS = new Set(['g4f', 'blackbox', 'phind']);

// SSE helper for streaming
function sendSSE(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function sendSSEDone(res) {
  res.write('data: [DONE]\n\n');
}

// ── OpenAI-Compatible Endpoint ────────────────────────────────────────────

app.post('/v1/chat/completions', validateChatRequest, async (req, res) => {
  try {
    const { messages, model: rawModel, stream } = req.body;
    const model = resolveModel(rawModel) || pickModel(messages);

    const sanitizedMessages = sanitizeMessages(messages);

    if (stream) {
      // Streaming response
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');

      try {
        const { stream: providerStream, provider: providerName } = await manager.chatStreamWithFailover(model, sanitizedMessages);

        // Handle different stream types
        if (providerStream && typeof providerStream[Symbol.asyncIterator] === 'function') {
          // Async iterator (our generators)
          for await (const chunk of providerStream) {
            if (res.writableEnded) break;
            sendSSE(res, chunk);
          }
        } else if (providerStream && typeof providerStream.getReader === 'function') {
          // ReadableStream (fetch Response.body)
          const reader = providerStream.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (res.writableEnded) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || trimmed.startsWith(':')) continue;
              if (trimmed.startsWith('data: ')) {
                const data = trimmed.slice(6);
                if (data === '[DONE]') continue;
                try {
                  const parsed = JSON.parse(data);
                  // Ensure correct format
                  if (parsed.object === 'chat.completion.chunk') {
                    sendSSE(res, parsed);
                  } else if (parsed.choices?.[0]?.delta?.content) {
                    sendSSE(res, parsed);
                  } else {
                    // Wrap in OpenAI format
                    const content = parsed.choices?.[0]?.delta?.content || parsed.message || parsed.content || '';
                    if (content) {
                      sendSSE(res, {
                        id: 'chatcmpl-' + Date.now(),
                        object: 'chat.completion.chunk',
                        created: Math.floor(Date.now() / 1000),
                        model,
                        choices: [{ index: 0, delta: { content }, finish_reason: null }]
                      });
                    }
                  }
                } catch {
                  // Plain text chunk
                  if (data) {
                    sendSSE(res, {
                      id: 'chatcmpl-' + Date.now(),
                      object: 'chat.completion.chunk',
                      created: Math.floor(Date.now() / 1000),
                      model,
                      choices: [{ index: 0, delta: { content: data }, finish_reason: null }]
                    });
                  }
                }
              }
            }
          }
        }

        sendSSEDone(res);
        res.end();
      } catch (streamErr) {
        console.error('[ERROR] Stream failed:', streamErr.message);
        if (!res.writableEnded) {
          sendSSE(res, { error: streamErr.message, type: 'stream_error' });
          sendSSEDone(res);
          res.end();
        }
      }
      return;
    }

    // Non-streaming response
    const { result, provider: usedProvider, latency, costEstimate } = await manager.chatWithFailover(model, sanitizedMessages);

    // Set stability header for fragile providers
    if (FRAGILE_PROVIDERS.has(usedProvider)) {
      res.setHeader('X-Provider-Stability', 'unstable');
    }

    // If result is already in OpenAI format (from OpenRouter/Groq), pass through
    if (result?.object === 'chat.completion' && result?.choices) {
      // Add cost metadata
      result._meta = { 
        provider: usedProvider, 
        latency_ms: latency,
        estimated_cost: costEstimate ? formatCost(costEstimate) : undefined
      };
      res.json(result);
      return;
    }

    // Extract content from various response formats
    const contentText = extractContent(result?.message?.content || result?.choices?.[0]?.message?.content || result);

    res.json({
      id: 'chatcmpl-' + Date.now(),
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{
        index: 0,
        message: { role: 'assistant', content: contentText },
        finish_reason: 'stop'
      }],
      usage: result?.usage || {},
      _meta: { 
        provider: usedProvider, 
        latency_ms: latency,
        estimated_cost: costEstimate ? formatCost(costEstimate) : undefined,
        is_free: costEstimate?.isFree || false
      }
    });

  } catch (error) {
    console.error('[ERROR] /v1/chat/completions:', error.message);
    res.status(500).json(safeErrorResponse(error, 'internal_error'));
  }
});

// ── Anthropic-Compatible Endpoint ─────────────────────────────────────────

app.post('/v1/messages', validateMessagesRequest, async (req, res) => {
  try {
    const { messages, model: rawModel, max_tokens, stream, system, prompt } = req.body;

    const model = resolveModel(rawModel) || 'claude-opus-4-5-latest';

    const allMessages = [];
    if (system && typeof system === 'string') allMessages.push({ role: 'system', content: system });
    if (messages && Array.isArray(messages)) allMessages.push(...messages);
    else if (prompt && typeof prompt === 'string') allMessages.push({ role: 'user', content: prompt });

    if (allMessages.length === 0) {
      return res.status(400).json({ error: 'No messages or prompt provided', type: 'invalid_request' });
    }

    const sanitizedMessages = sanitizeMessages(allMessages);

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      try {
        const { stream: providerStream, provider: providerName } = await manager.chatStreamWithFailover(model, sanitizedMessages);

        if (providerStream && typeof providerStream[Symbol.asyncIterator] === 'function') {
          for await (const chunk of providerStream) {
            if (res.writableEnded) break;
            // Convert OpenAI format to Anthropic SSE format
            const content = chunk.choices?.[0]?.delta?.content || '';
            if (content) {
              res.write(`event: content_block_delta\ndata: ${JSON.stringify({
                type: 'content_block_delta',
                index: 0,
                delta: { type: 'text_delta', text: content }
              })}\n\n`);
            }
          }
        } else if (providerStream && typeof providerStream.getReader === 'function') {
          const reader = providerStream.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (res.writableEnded) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || trimmed.startsWith(':')) continue;
              if (trimmed.startsWith('data: ')) {
                const data = trimmed.slice(6);
                if (data === '[DONE]') continue;
                try {
                  const parsed = JSON.parse(data);
                  const content = parsed.choices?.[0]?.delta?.content || parsed.message || '';
                  if (content) {
                    res.write(`event: content_block_delta\ndata: ${JSON.stringify({
                      type: 'content_block_delta',
                      index: 0,
                      delta: { type: 'text_delta', text: content }
                    })}\n\n`);
                  }
                } catch {}
              }
            }
          }
        }

        res.write('event: message_stop\ndata: {"type":"message_stop"}\n\n');
        res.end();
      } catch (streamErr) {
        if (!res.writableEnded) {
          res.write(`event: error\ndata: ${JSON.stringify({ type: 'error', error: streamErr.message })}\n\n`);
          res.end();
        }
      }
      return;
    }

    // Non-streaming
    const { result, provider: usedProvider, latency, costEstimate } = await manager.chatWithFailover(model, sanitizedMessages, { format: 'anthropic' });

    if (result?.type === 'message' && result?.content) {
      res.json(result);
      return;
    }

    const contentText = extractContent(result?.message?.content || result?.choices?.[0]?.message?.content || result);

    res.json({
      id: 'msg_' + Date.now(),
      type: 'message',
      role: 'assistant',
      content: contentText ? [{ type: 'text', text: contentText }] : [],
      model,
      stop_reason: 'end_turn',
      usage: result?.usage || { input_tokens: 0, output_tokens: 0 },
      _meta: { provider: usedProvider, latency_ms: latency, estimated_cost: costEstimate ? formatCost(costEstimate) : undefined }
    });

  } catch (error) {
    console.error('[ERROR] /v1/messages:', error.message);
    res.status(500).json(safeErrorResponse(error, 'error'));
  }
});

// ── Native Auto-Routed Endpoint ───────────────────────────────────────────

app.post('/chat', validateChatRequest, async (req, res) => {
  try {
    const { messages, model: rawModel, stream } = req.body;
    const model = resolveModel(rawModel) || pickModel(messages);
    const sanitizedMessages = sanitizeMessages(messages);

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      try {
        const { stream: providerStream } = await manager.chatStreamWithFailover(model, sanitizedMessages);
        
        if (providerStream && typeof providerStream[Symbol.asyncIterator] === 'function') {
          for await (const chunk of providerStream) {
            if (res.writableEnded) break;
            sendSSE(res, chunk);
          }
        } else if (providerStream && typeof providerStream.getReader === 'function') {
          const reader = providerStream.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (res.writableEnded) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || trimmed.startsWith(':')) continue;
              if (trimmed.startsWith('data: ')) {
                const data = trimmed.slice(6);
                if (data === '[DONE]') continue;
                try {
                  const parsed = JSON.parse(data);
                  if (parsed.object === 'chat.completion.chunk') {
                    sendSSE(res, parsed);
                  } else {
                    const content = parsed.choices?.[0]?.delta?.content || '';
                    if (content) {
                      sendSSE(res, {
                        id: 'chatcmpl-' + Date.now(),
                        object: 'chat.completion.chunk',
                        created: Math.floor(Date.now() / 1000),
                        model,
                        choices: [{ index: 0, delta: { content }, finish_reason: null }]
                      });
                    }
                  }
                } catch {
                  if (data) {
                    sendSSE(res, {
                      id: 'chatcmpl-' + Date.now(),
                      object: 'chat.completion.chunk',
                      created: Math.floor(Date.now() / 1000),
                      model,
                      choices: [{ index: 0, delta: { content: data }, finish_reason: null }]
                    });
                  }
                }
              }
            }
          }
        }
        sendSSEDone(res);
        res.end();
      } catch (err) {
        if (!res.writableEnded) res.end();
      }
      return;
    }

    const { result, provider: usedProvider, latency, costEstimate } = await manager.chatWithFailover(model, sanitizedMessages);
    res.json({ ...result, _meta: { provider: usedProvider, model, latency_ms: latency, estimated_cost: costEstimate ? formatCost(costEstimate) : undefined } });

  } catch (error) {
    console.error('[ERROR] /chat:', error.message);
    res.status(500).json(safeErrorResponse(error, 'internal_error'));
  }
});

// ── Health & Status Endpoints ─────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    version: VERSION
  });
});

app.get('/status', (req, res) => {
  res.json({
    status: 'running',
    port: PORT,
    version: VERSION,
    uptime: process.uptime(),
    env: process.env.NODE_ENV || 'development',
    providers: registry.getStats(),
    providerManager: manager.getStats(),
    modelSync: syncService.getStats(),
    rate_limiting: true,
    cors_enabled: true,
    api_key_auth: !!process.env.API_KEY,
    circuit_breakers: manager.circuitBreakers.getStats()
  });
});

app.get('/models', (req, res) => {
  const allModels = registry.getAllModels();
  res.json({
    object: 'list',
    data: allModels.map(m => ({
      id: m.id,
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: m.providers?.join(', ') || 'unknown',
      type: m.type,
      description: m.description,
      providers: m.providers,
      maxTokens: m.maxTokens
    }))
  });
});

app.get('/providers', (req, res) => {
  res.json(registry.getStats());
});

app.get('/providers/free', (req, res) => {
  const freeProviders = registry.getFreeProviders();
  res.json({
    total: freeProviders.length,
    providers: freeProviders.map(p => p.getStats())
  });
});

app.get('/providers/:name/health', async (req, res) => {
  const provider = registry.getProvider(req.params.name);
  if (!provider) return res.status(404).json({ error: 'Provider not found' });
  try {
    await provider.checkHealth();
    const breaker = manager.circuitBreakers.getOrCreate(provider.name);
    res.json({ 
      name: provider.name, 
      health: provider.healthStatus, 
      lastCheck: provider.lastHealthCheck,
      circuitBreaker: breaker.getStats()
    });
  } catch (err) {
    res.json({ name: provider.name, health: provider.healthStatus, error: err.message, lastCheck: provider.lastHealthCheck });
  }
});

// ── Cost Estimation Endpoint ──────────────────────────────────────────────

app.post('/v1/cost-estimate', (req, res) => {
  try {
    const { messages, model: rawModel } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages array required' });
    }
    const model = resolveModel(rawModel) || pickModel(messages);
    const inputTokens = estimateInputTokens(messages);
    const costEstimate = estimateCost(model, inputTokens);
    res.json({
      model,
      ...costEstimate,
      formatted_cost: formatCost(costEstimate)
    });
  } catch (error) {
    res.status(500).json(safeErrorResponse(error, 'cost_estimation_error'));
  }
});

// ── Circuit Breaker Status Endpoint ───────────────────────────────────────

app.get('/circuit-breakers', (req, res) => {
  res.json(manager.circuitBreakers.getStats());
});

// ── MCP (Model Context Protocol) Endpoint ─────────────────────────────────

app.post('/mcp', async (req, res) => {
  try {
    const request = req.body;

    // Validate JSON-RPC 2.0 structure
    if (!request || request.jsonrpc !== '2.0' || !request.method) {
      return res.json({
        jsonrpc: '2.0',
        error: { code: -32600, message: 'Invalid Request — expected JSON-RPC 2.0' },
        id: request?.id || null
      });
    }

    const response = await mcpServer.handleRequest(request);
    res.json(response);
  } catch (err) {
    console.error('[ERROR] /mcp:', err.message);
    res.json({
      jsonrpc: '2.0',
      error: { code: -32603, message: 'Internal error' },
      id: null
    });
  }
});

// ── Dashboard (serve static files) ───────────────────────────────────────

import { existsSync } from 'fs';
const dashboardPath = join(__dirname, 'dashboard');
if (existsSync(dashboardPath)) {
  app.use('/dashboard', express.static(dashboardPath));
}

// ── Request Logs Endpoint ────────────────────────────────────────────────

app.get('/logs', (req, res) => {
  const limit = parseInt(req.query.limit || '100', 10);
  const offset = parseInt(req.query.offset || '0', 10);
  res.json({
    total: requestLog.length,
    offset,
    limit,
    logs: requestLog.slice(offset, offset + limit)
  });
});

// ── 404 Handler ───────────────────────────────────────────────────────────

app.use((req, res) => {
  res.status(404).json({ error: 'Not found', type: 'not_found' });
});

// ── Global Error Handler ──────────────────────────────────────────────────

app.use((err, req, res, _next) => {
  console.error('[FATAL]', err.message);
  if (res.headersSent) return;
  res.status(500).json(safeErrorResponse(err, 'internal_error'));
});

// ── Start Server ──────────────────────────────────────────────────────────

async function start() {
  await initDB();
  await initProviders();

  app.listen(PORT, () => {
    const enabledCount = registry.getEnabledProviders().length;
    const freeCount = registry.getFreeProviders().length;
    const modelCount = registry.getAllModels().length;
    console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║  Jeumpa LLM v${VERSION} — AI Operating Layer (f.k.a. ProxyGateLLM)  ║
╠══════════════════════════════════════════════════════════════════════╣
║  Running on http://localhost:${PORT}                                    ║
╠══════════════════════════════════════════════════════════════════════╣
║  POST /chat                 - Chat (auto-routing)                    ║
║  POST /v1/chat/completions  - OpenAI-compatible API                  ║
║  POST /v1/messages          - Anthropic-compatible API               ║
║  POST /v1/cost-estimate     - Pre-flight cost estimation             ║
║  POST /v1/users             - Register user                          ║
║  POST /v1/keys              - Create API key                         ║
║  GET  /v1/keys              - List API keys                          ║
║  GET  /health               - Health check                           ║
║  GET  /status               - Server + provider status               ║
║  GET  /models               - List all available models              ║
║  GET  /providers            - Provider details & stats               ║
║  GET  /providers/free       - Free providers only                    ║
║  GET  /circuit-breakers     - Circuit breaker status                 ║
║  POST /mcp                  - MCP (Model Context Protocol)           ║
║  GET  /dashboard            - Web dashboard                          ║
╠══════════════════════════════════════════════════════════════════════╣
║  Providers: ${enabledCount} active (${freeCount} free)  |  Models: ${modelCount} available      ║
║  Multi-Tenant: ON | Rate Limit: Persistent | Usage Tracking: ON     ║
║  Circuit Breaker: ON  |  Cost Estimation: ON  |  Streaming: ON      ║
╚══════════════════════════════════════════════════════════════════════╝
`);
  });
}

start().catch(err => {
  console.error('[FATAL] Failed to start:', err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Jeumpa LLM] Shutting down...');
  manager.stop();
  syncService.stop();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[Jeumpa LLM] Interrupted, shutting down...');
  manager.stop();
  syncService.stop();
  process.exit(0);
});

export { registry, manager, syncService };
