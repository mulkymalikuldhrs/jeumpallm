# Jeumpa LLM — System Architecture

<div align="center">

[![Architecture](https://img.shields.io/badge/Architecture-5_Layer-0EA5E9?style=for-the-badge)]()
[![Version](https://img.shields.io/badge/Version-4.0.0-blue?style=for-the-badge)](https://github.com/dhaher-labs/JeumpaLLM)

**Comprehensive architecture documentation for Jeumpa LLM v6.0.0**

</div>

---

## Table of Contents

- [Overview](#overview)
- [5-Layer Architecture](#5-layer-architecture)
- [Data Flow](#data-flow)
- [Provider Adapter Pattern](#provider-adapter-pattern)
- [Health Check System](#health-check-system)
- [Failover Strategy](#failover-strategy)
- [Round-Robin Algorithm](#round-robin-algorithm)
- [Model Resolution Pipeline](#model-resolution-pipeline)
- [Configuration System](#configuration-system)
- [Project Structure](#project-structure)
- [Deployment](#deployment)

---

## Overview

Jeumpa LLM is a multi-provider LLM proxy that aggregates 9 free AI providers into a single, unified API. It exposes OpenAI-compatible and Anthropic-compatible endpoints, automatically routes requests to the best available provider, and handles failover transparently.

### Design Principles

| Principle | Implementation |
|-----------|---------------|
| **Zero-config core** | 5 of 9 providers work without API keys |
| **Transparent failover** | Requests automatically retry on next provider |
| **API compatibility** | Drop-in replacement for OpenAI and Anthropic SDKs |
| **Streaming-first** | SSE streaming with async iterators and ReadableStreams |
| **Health-aware routing** | Unhealthy providers are deprioritized automatically |
| **Extensible** | Add new providers by extending `BaseProvider` |

### System Diagram

```
                            ┌─────────────────────────┐
                            │     Client / SDK         │
                            │  (OpenAI / Anthropic)    │
                            └───────────┬─────────────┘
                                        │  HTTP
                                        ▼
┌───────────────────────────────────────────────────────────────────────┐
│                       Jeumpa LLM v6.0.0                      │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │ Layer 1: API Gateway (Express 5.x)                             │ │
│  │   /v1/chat/completions  /v1/messages  /chat  /health  /models  │ │
│  └──────────────────────────┬──────────────────────────────────────┘ │
│                              │                                        │
│  ┌──────────────────────────▼──────────────────────────────────────┐ │
│  │ Layer 2: Request Router                                         │ │
│  │   resolveModel()  pickModel()  getTaskType()                    │ │
│  └──────────────────────────┬──────────────────────────────────────┘ │
│                              │                                        │
│  ┌──────────────────────────▼──────────────────────────────────────┐ │
│  │ Layer 3: Provider Manager                                       │ │
│  │   route()  chatWithFailover()  chatStreamWithFailover()         │ │
│  │   round-robin  health tracking  latency scoring                 │ │
│  └──────────────────────────┬──────────────────────────────────────┘ │
│                              │                                        │
│  ┌──────────────────────────▼──────────────────────────────────────┐ │
│  │ Layer 4: Provider Adapters (9 providers)                        │ │
│  │   Puter  Pollinations  DuckDuckGo  OpenRouter  Groq            │ │
│  │   HuggingFace  G4F  Blackbox  Phind                             │ │
│  └──────────────────────────┬──────────────────────────────────────┘ │
│                              │                                        │
│  ┌──────────────────────────▼──────────────────────────────────────┐ │
│  │ Layer 5: Model Sync Service                                     │ │
│  │   Auto-fetch  Caching  Periodic refresh                         │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              │               │               │
              ▼               ▼               ▼
    ┌─────────────┐  ┌──────────────┐  ┌──────────────┐
    │  Puter API  │  │ Pollinations │  │  DuckDuckGo  │
    │  OpenRouter │  │    Groq      │  │ HuggingFace  │
    │  G4F/Py     │  │  Blackbox    │  │    Phind     │
    └─────────────┘  └──────────────┘  └──────────────┘
```

---

## 5-Layer Architecture

### Layer 1: API Gateway

**File:** `index.js`
**Framework:** Express 5.x

The API Gateway handles all inbound HTTP traffic, request validation, response formatting, and CORS.

#### Responsibilities

| Responsibility | Implementation |
|---------------|---------------|
| HTTP routing | Express route definitions |
| Request parsing | `express.json()` with 10MB limit |
| Input validation | `validateChatRequest`, `validateMessagesRequest` middleware |
| Message sanitization | `sanitizeMessages()` strips null bytes |
| Rate limiting | Per-IP sliding window (`rateLimiter` middleware) |
| API key auth | Optional `API_KEY_AUTH` middleware |
| CORS | Configurable `Access-Control-Allow-Origin` |
| Response formatting | OpenAI and Anthropic response shapes |
| SSE streaming | `sendSSE()`, `sendSSEDone()` helpers |
| Error handling | Centralized error handler + `safeErrorResponse()` |

#### Endpoint → Layer Mapping

```
POST /v1/chat/completions  →  Layer 2 (resolveModel)  →  Layer 3 (chatWithFailover)
POST /v1/messages          →  Layer 2 (resolveModel)  →  Layer 3 (chatWithFailover)
POST /chat                 →  Layer 2 (pickModel)     →  Layer 3 (chatWithFailover)
GET  /health               →  Direct response
GET  /status               →  Layer 3 + Layer 5 stats
GET  /models               →  Provider Registry (getAllModels)
GET  /providers            →  Provider Registry (getStats)
GET  /providers/:name/health → Layer 4 (checkHealth)
```

#### Request Processing Pipeline

```
Request → CORS → Rate Limit → API Key Auth → Body Parse → Validate → Sanitize → Route → Respond
```

---

### Layer 2: Request Router

**File:** `router.js`

The Request Router resolves model names and performs intelligent auto-routing based on message content.

#### Functions

| Function | Purpose |
|----------|---------|
| `resolveModel(rawModel)` | Resolves model aliases to canonical IDs; returns `null` for `"auto"` |
| `pickModel(messages)` | Auto-selects model based on task type detection |
| `getTaskType(messages)` | Classifies message content into task categories |

#### Model Resolution Flow

```
Input: rawModel
  │
  ├─ null / undefined / "auto"  →  returns null (triggers pickModel)
  │
  ├─ Known alias (e.g., "gpt4")  →  looks up MODEL_ALIASES → returns canonical ID
  │
  └─ Unknown string  →  returns as-is (passed to provider matching)
```

#### Auto-Routing Decision Tree

```
pickModel(messages)
  │
  ├─ Empty content  →  "deepseek-chat"
  │
  ├─ BUILDING keywords detected?
  │   (code, implement, function, debug, fix, refactor, sql, api, deploy, docker, ...)
  │   └─ YES  →  "claude-opus-4-5-latest"
  │
  ├─ PLANNING keywords detected?
  │   (plan, design, strategy, analyze, compare, roadmap, architect, ...)
  │   └─ YES  →  "deepseek-chat"
  │
  ├─ REASONING keywords detected?
  │   (reason, solve, explain, how does, why is, step by step, calculate, ...)
  │   └─ YES  →  "gpt-4o"
  │
  ├─ Short query or question?
  │   (text.length < 100 OR contains "?")
  │   └─ YES  →  "gpt-4o-mini"
  │
  └─ DEFAULT  →  "deepseek-chat"
```

#### Task Type Classification

| Task Type | Keywords | Auto-Selected Model |
|-----------|----------|-------------------|
| `code` | code, implement, function, class, debug, fix, refactor, deploy, build | `claude-opus-4-5-latest` |
| `planning` | plan, design, strategy, analyze, roadmap, architect | `deepseek-chat` |
| `reasoning` | reason, solve, explain, calculate, prove | `gpt-4o` |
| `fast` | Short text (<100 chars) or contains `?` | `gpt-4o-mini` |
| `general` | Default fallback | `deepseek-chat` |

---

### Layer 3: Provider Manager

**File:** `utils/provider-manager.js`

The Provider Manager is the brain of the routing system. It selects providers, manages health states, implements round-robin load balancing, and handles failover.

#### Core Methods

| Method | Purpose |
|--------|---------|
| `start()` | Runs initial health checks, starts periodic health check interval |
| `stop()` | Clears health check interval |
| `route(modelId, messages)` | Find best provider for a model |
| `chatWithFailover(modelId, messages)` | Execute chat with automatic retry on failure |
| `chatStreamWithFailover(modelId, messages)` | Execute streaming chat with retry |
| `runHealthChecks()` | Check health of all enabled providers |
| `_roundRobin(modelId, providers)` | Round-robin selection among providers |

#### Provider Selection Algorithm

```
route(modelId, messages)
  │
  ├─ Get all providers that support this model
  │
  ├─ Filter out "down" providers
  │
  ├─ Sort by:
  │   1. Health status: healthy > unknown > degraded > down
  │   2. Provider priority: P1 > P2 > P3
  │   3. Average latency: lower is better
  │
  ├─ If multiple top-priority healthy providers:
  │   └─ Round-robin among them
  │
  ├─ If all healthy providers filtered out:
  │   └─ Try round-robin on degraded providers
  │
  └─ Last resort:
      └─ Return first provider regardless of health
```

#### Health Check Flow

```
runHealthChecks()
  │
  ├─ For each enabled provider (parallel):
  │   │
  │   ├─ Race: provider.checkHealth() vs 10s timeout
  │   │
  │   ├─ Success → status = "healthy", record latency
  │   │
  │   └─ Failure → status degrades:
  │       healthy → degraded
  │       degraded → down
  │       unknown → stays unknown
  │
  └─ Log: "Health check: 7/9 providers healthy"
```

#### Failover Execution

```
chatWithFailover(modelId, messages)
  │
  ├─ Get all providers for this model
  │
  ├─ Sort: healthy first, then by priority
  │
  ├─ For each provider (in order):
  │   │
  │   ├─ Try: provider.chat(messages, {model})
  │   │   ├─ Success → record latency, mark healthy, return result
  │   │   └─ Failure → record error, degrade health, try next
  │   │       healthy → degraded
  │   │       degraded → down
  │   │
  │   └─ Continue to next provider
  │
  └─ All failed → throw lastError
```

---

### Layer 4: Provider Adapters

**File:** `providers/`

Nine provider adapters, all extending the `BaseProvider` abstract class. Each adapter implements the provider-specific communication protocol.

#### BaseProvider Abstract Class

**File:** `providers/base.js`

```javascript
class BaseProvider {
  // Core properties
  name, displayName, priority, enabled, models, baseUrl, timeout
  healthStatus, lastHealthCheck, requestCount, errorCount, avgLatency

  // Abstract methods (must be implemented)
  async chat(messages, options = {})        // Non-streaming chat
  async chatStream(messages, options = {})  // Streaming chat
  async checkHealth()                       // Health check

  // Optional override
  async fetchModels()                       // Auto-fetch models from API

  // Provided utilities
  supportsModel(modelId)                    // Check if model is supported
  getModel(modelId)                         // Get model config
  recordRequest(latency, success)           // Track metrics
  getStats()                                // Return provider statistics
  formatOpenAIResponse(content, model)      // Format as OpenAI response
  formatAnthropicResponse(content, model)   // Format as Anthropic response
}
```

#### Provider Registry

**File:** `providers/index.js`

The `ProviderRegistry` is a singleton that manages all provider instances:

| Method | Purpose |
|--------|---------|
| `init()` | Instantiate all providers, check `DISABLE_*` env vars |
| `getProvider(name)` | Get a specific provider by name |
| `getEnabledProviders()` | Get all enabled providers |
| `getProvidersByPriority()` | Get enabled providers sorted by priority |
| `getProvidersForModel(modelId)` | Get providers that support a model |
| `getAllModels()` | Get deduplicated model list with provider mapping |
| `getStats()` | Aggregate statistics |

#### Adapter Overview

| Provider | Class | Priority | Auth Required | Streaming | Protocol |
|----------|-------|----------|--------------|-----------|----------|
| Puter.js | `PuterProvider` | P1 | Optional | Native SDK | SDK (`puter.ai.chat`) |
| Pollinations | `PollinationsProvider` | P1 | None | SSE via fetch | HTTP POST |
| DuckDuckGo | `DuckDuckGoProvider` | P1 | None | SSE (VQD token) | HTTP POST + VQD |
| OpenRouter | `OpenRouterProvider` | P1 | Optional | SSE via fetch | OpenAI API |
| Groq | `GroqProvider` | P2 | Required | SSE via fetch | OpenAI API |
| HuggingFace | `HuggingFaceProvider` | P2 | Required | Simulated* | HF Inference API |
| G4F | `G4FProvider` | P2 | None | Simulated* | Python subprocess |
| Blackbox | `BlackboxProvider` | P3 | None | Custom stream | HTTP POST |
| Phind | `PhindProvider` | P3 | None | Simulated* | HTTP POST |

*Simulated streaming = non-streaming request wrapped in an async generator that yields a single chunk.

---

### Layer 5: Model Sync Service

**File:** `utils/model-sync.js`

The Model Sync Service automatically fetches and updates model lists from providers that expose a models API (e.g., OpenRouter, Pollinations, Groq).

#### How It Works

```
ModelSyncService
  │
  ├─ start()
  │   ├─ Initial sync: syncModels()
  │   └─ Set interval (default: 1 hour)
  │
  ├─ syncModels()
  │   │
  │   ├─ For each enabled provider:
  │   │   ├─ Race: provider.fetchModels() vs 15s timeout
  │   │   ├─ If new models returned → update provider.models
  │   │   └─ Log: "OpenRouter: 0 → 45 models (+45 new)"
  │   │
  │   └─ Record sync history (last 10 syncs)
  │
  ├─ getStats()
  │   └─ Returns lastSync, interval, history
  │
  └─ stop()
      └─ Clear interval
```

#### Providers with Auto-Fetch

| Provider | fetchModels() | Source |
|----------|--------------|--------|
| OpenRouter | Yes | `GET https://openrouter.ai/api/v1/models` (free models only) |
| Pollinations | Yes | `GET https://text.pollinations.ai/models` |
| Groq | Yes | `GET https://api.groq.com/openai/v1/models` |
| Others | No (returns static config) | `config/providers.js` |

---

## Data Flow

### Non-Streaming Chat Request

```
Client
  │
  │  POST /v1/chat/completions
  │  {model: "gpt-4o", messages: [...]}
  │
  ▼
API Gateway (index.js)
  │
  ├─ validateChatRequest() ──── 400 if invalid
  ├─ sanitizeMessages() ─────── strip null bytes
  │
  ├─ resolveModel("gpt-4o") ─── "gpt-4o" (no alias)
  │
  ▼
Provider Manager (provider-manager.js)
  │
  ├─ getProvidersForModel("gpt-4o")
  │   → [PuterProvider (P1, healthy), G4FProvider (P2, healthy)]
  │
  ├─ Sort by health + priority + latency
  │   → [PuterProvider, G4FProvider]
  │
  ├─ Try PuterProvider.chat(messages, {model: "gpt-4o"})
  │   ├─ Success → {result, provider: "puter", latency: 2340}
  │   └─ Failure → degrade to "degraded", try next
  │
  ▼
API Gateway (index.js)
  │
  ├─ Format as OpenAI response:
  │   {id, object: "chat.completion", model, choices, usage, _meta}
  │
  ▼
Client ← JSON response
```

### Streaming Chat Request

```
Client
  │
  │  POST /v1/chat/completions
  │  {model: "gpt-4o", messages: [...], stream: true}
  │
  ▼
API Gateway (index.js)
  │
  ├─ Set SSE headers (Content-Type, Cache-Control, Connection)
  │
  ▼
Provider Manager (provider-manager.js)
  │
  ├─ chatStreamWithFailover("gpt-4o", messages)
  │   → PuterProvider.chatStream() → AsyncIterable
  │
  ▼
API Gateway (index.js) — Stream Loop
  │
  ├─ For await each chunk from providerStream:
  │   │
  │   ├─ If AsyncIterable (Puter, DuckDuckGo, Blackbox generators):
  │   │   └─ sendSSE(res, chunk)  →  "data: {json}\n\n"
  │   │
  │   ├─ If ReadableStream (Pollinations, OpenRouter, Groq fetch bodies):
  │   │   ├─ Read chunks via getReader()
  │   │   ├─ Parse SSE lines from buffer
  │   │   ├─ Extract content from delta
  │   │   └─ sendSSE(res, wrappedChunk)  →  "data: {json}\n\n"
  │   │
  │   └─ Continue until stream ends
  │
  ├─ sendSSEDone(res)  →  "data: [DONE]\n\n"
  └─ res.end()

Client ← SSE stream
```

### Anthropic-Compatible Request

```
Client
  │
  │  POST /v1/messages
  │  {model: "claude-opus-4-5-latest", system: "...", messages: [...]}
  │
  ▼
API Gateway (index.js)
  │
  ├─ validateMessagesRequest() ──── 400 if invalid
  │
  ├─ Merge system + messages into unified array
  │
  ├─ resolveModel("claude-opus-4-5-latest") → "claude-opus-4-5-latest"
  │
  ▼
Provider Manager → Provider.chat(messages, {format: "anthropic"})
  │
  ▼
API Gateway
  │
  ├─ If result.type === "message" → pass through (native Anthropic format)
  ├─ Otherwise → format as Anthropic response:
  │   {id: "msg_...", type: "message", role: "assistant",
  │    content: [{type: "text", text: "..."}], model, stop_reason, usage, _meta}
  │
  ▼
Client ← Anthropic-format JSON
```

### Streaming Anthropic Request

Same flow as OpenAI streaming, but chunks are reformatted:

```
OpenAI chunk:
  {choices: [{delta: {content: "Hello"}}]}

  ↓ Converted to ↓

Anthropic SSE event:
  event: content_block_delta
  data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}
```

Stream termination:
```
event: message_stop
data: {"type":"message_stop"}
```

---

## Provider Adapter Pattern

All providers follow the same interface defined by `BaseProvider`. This enables polymorphic routing — the Provider Manager can call any provider without knowing its implementation details.

### Class Hierarchy

```
BaseProvider (abstract)
  │
  ├─ PuterProvider         ─── Puter.js SDK (puter.ai.chat)
  ├─ PollinationsProvider  ─── HTTP POST + SSE streaming
  ├─ DuckDuckGoProvider    ─── HTTP POST + VQD token + SSE
  ├─ OpenRouterProvider    ─── OpenAI API compatible
  ├─ GroqProvider          ─── OpenAI API compatible
  ├─ HuggingFaceProvider   ─── HF Inference API (single-turn)
  ├─ G4FProvider           ─── Python subprocess (g4f library)
  ├─ BlackboxProvider      ─── HTTP POST + custom response format
  └─ PhindProvider         ─── HTTP POST + SSE/JSON-line response
```

### Adapter Implementation Patterns

#### Pattern 1: SDK-Based (Puter)

```javascript
class PuterProvider extends BaseProvider {
  async chat(messages, options) {
    const response = await this.puter.ai.chat(messages, {model, stream: false});
    return this.formatOpenAIResponse(content, model);
  }

  async chatStream(messages, options) {
    return await this.puter.ai.chat(messages, {model, stream: true});
    // Returns AsyncIterable directly from SDK
  }
}
```

#### Pattern 2: OpenAI-Compatible HTTP (OpenRouter, Groq)

```javascript
class OpenRouterProvider extends BaseProvider {
  async chat(messages, options) {
    const response = await fetch(`${baseUrl}/chat/completions`, { ... });
    const data = await response.json();
    return data; // Already in OpenAI format
  }

  async chatStream(messages, options) {
    const response = await fetch(`${baseUrl}/chat/completions`, { stream: true });
    return response.body; // Returns ReadableStream
  }
}
```

#### Pattern 3: Custom HTTP + SSE Transform (DuckDuckGo, Blackbox)

```javascript
class DuckDuckGoProvider extends BaseProvider {
  async chat(messages, options) {
    // Custom protocol with VQD token
    const vqd = await this._getVQD();
    const response = await fetch(`${baseUrl}/duckchat/v1/chat`, { headers: {'x-vqd-4': vqd} });
    const content = await this._collectSSE(response);
    return this.formatOpenAIResponse(content, model);
  }

  async *chatStream(messages, options) {
    // Async generator that transforms provider SSE into OpenAI chunks
    const reader = response.body.getReader();
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      yield {object: "chat.completion.chunk", choices: [{delta: {content}}]};
    }
  }
}
```

#### Pattern 4: Subprocess (G4F)

```javascript
class G4FProvider extends BaseProvider {
  async chat(messages, options) {
    const script = this._buildScript(messages, model);
    const {stdout} = await execFileAsync('python3', ['-c', script]);
    return this.formatOpenAIResponse(stdout, model);
  }

  async chatStream(messages, options) {
    // No native streaming — wrap non-streaming result
    const result = await this.chat(messages, options);
    async function* singleChunk() { yield result; }
    return singleChunk();
  }
}
```

### Streaming Abstraction

The gateway handles two streaming return types:

| Return Type | Providers | Handling |
|-------------|-----------|----------|
| `AsyncIterable` | Puter, DuckDuckGo, Blackbox, Phind, HuggingFace, G4F | `for await (const chunk of stream)` |
| `ReadableStream` | Pollinations, OpenRouter, Groq | `reader = stream.getReader()` + line parsing |

The API Gateway normalizes both types into consistent OpenAI SSE format.

---

## Health Check System

### Health States

| State | Description | Routing Behavior |
|-------|-------------|-----------------|
| `healthy` | Provider responds correctly | Normal priority |
| `unknown` | Not yet checked or just started | Treated as degraded |
| `degraded` | Recent failure(s) | Deprioritized, still used as fallback |
| `down` | Multiple consecutive failures | Excluded from routing (last resort only) |

### Health Check Methods by Provider

| Provider | Method | What It Checks |
|----------|--------|---------------|
| Puter.js | `puter.ai.chat('ping', {model: 'gpt-4o-mini'})` | SDK responds to chat |
| Pollinations | `POST /` with ping message | API responds with 200 |
| DuckDuckGo | `_getVQD()` token fetch | VQD token obtainable |
| OpenRouter | `GET /models` | API reachable |
| Groq | `GET /models` with auth | API key valid + reachable |
| HuggingFace | `POST /models/{model}` with "ping" | API key valid + model available |
| G4F | Check Python + g4f availability | Dependencies installed |
| Blackbox | `POST /api/chat` with minimal request | API responds with 200 |
| Phind | `HEAD /` on base URL | Site reachable |

### Health Degradation

Health status degrades progressively on failures:

```
healthy  ──(1 failure)──►  degraded  ──(2nd failure)──►  down
```

And recovers on success:

```
down  ──(success)──►  healthy
degraded  ──(success)──►  healthy
```

### Periodic Health Checks

- **Interval:** Configurable via `HEALTH_CHECK_INTERVAL_MS` (default: 60 seconds)
- **Timeout:** 10 seconds per provider check
- **Parallelism:** All providers checked in parallel via `Promise.allSettled`
- **Logging:** `"Health check: 7/9 providers healthy"`

---

## Failover Strategy

### Failover Flow

```
Request arrives for model "gpt-4o"
  │
  ├─ Providers: [Puter(P1, healthy), G4F(P2, healthy)]
  │
  ├─ Try 1: Puter.chat()
  │   ├─ Success → return result
  │   └─ Error → Puter.healthStatus = "degraded"
  │              log: "puter failed for gpt-4o: timeout, trying next..."
  │
  ├─ Try 2: G4F.chat()
  │   ├─ Success → return result
  │   └─ Error → G4F.healthStatus degrades
  │              log: "g4f failed for gpt-4o: error, trying next..."
  │
  └─ All failed → throw "All providers failed for model: gpt-4o"
```

### Streaming Failover

For streaming requests, failover works at the **connection establishment** phase only:

```
chatStreamWithFailover(modelId, messages)
  │
  ├─ Try provider.chatStream() — if connection fails, try next
  │
  └─ Once stream is established, errors are sent as SSE events
      (cannot failover mid-stream)
```

### Provider Priority Tiers

| Priority | Providers | Rationale |
|----------|-----------|-----------|
| **P1** (highest) | Puter, Pollinations, DuckDuckGo, OpenRouter | Free, no API key required, reliable |
| **P2** | Groq, HuggingFace, G4F | Requires API key or Python dependency |
| **P3** (lowest) | Blackbox, Phind | Reverse-engineered APIs, less stable |

---

## Round-Robin Algorithm

When multiple providers at the same priority level support the same model and are healthy, the round-robin algorithm distributes requests evenly.

### Implementation

```javascript
_roundRobin(modelId, providers) {
  const key = modelId;
  const current = this.roundRobinIndex.get(key) || 0;
  const next = current % providers.length;
  this.roundRobinIndex.set(key, next + 1);
  return providers[next];
}
```

### Example

For model `gpt-4o-mini` supported by Puter (P1), Pollinations (P1), and DuckDuckGo (P1):

| Request | Round-Robin Index | Selected Provider |
|---------|-------------------|-------------------|
| 1st | 0 % 3 = 0 | Puter |
| 2nd | 1 % 3 = 1 | Pollinations |
| 3rd | 2 % 3 = 2 | DuckDuckGo |
| 4th | 3 % 3 = 0 | Puter |
| 5th | 4 % 3 = 1 | Pollinations |

The round-robin state is maintained per model ID in a `Map`, ensuring fair distribution across models independently.

---

## Model Resolution Pipeline

The complete pipeline from user request to provider selection:

```
User Request: model = "gpt4"
  │
  ▼
Step 1: Alias Resolution (resolveModel)
  "gpt4" → MODEL_ALIASES["gpt4"] → "gpt-4o"
  │
  ▼
Step 2: Provider Matching (getProvidersForModel)
  "gpt-4o" → [PuterProvider, G4FProvider]
  │
  ▼
Step 3: Health Filtering
  Filter out "down" providers
  │
  ▼
Step 4: Priority Sorting
  Sort by: health > priority > latency
  [Puter(P1, healthy), G4F(P2, healthy)]
  │
  ▼
Step 5: Round-Robin (if multiple P1 healthy providers)
  Select next provider in rotation
  │
  ▼
Step 6: Execute with Failover
  Try selected provider → fallback to next on failure
```

---

## Configuration System

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3333` | Server listening port |
| `CORS_ORIGIN` | `*` | Allowed CORS origin(s) |
| `API_KEY` | — | Optional API key for authentication |
| `NODE_ENV` | `development` | Environment mode (sanitizes errors in production) |
| `RATELIMIT_WINDOW_MS` | `60000` | Rate limit window in milliseconds |
| `RATELIMIT_MAX_REQUESTS` | `100` | Max requests per window per IP |
| `HEALTH_CHECK_INTERVAL_MS` | `60000` | Provider health check interval |
| `MODEL_SYNC_INTERVAL_MS` | `3600000` | Model sync interval (1 hour) |
| `PUTER_AUTH_TOKEN` | — | Puter.js authentication token (optional) |
| `GROQ_API_KEY` | — | Groq API key (required for Groq) |
| `HUGGINGFACE_API_KEY` | — | HuggingFace API key (required for HF) |
| `OPENROUTER_API_KEY` | — | OpenRouter API key (optional, enables paid models) |

### Provider Disable Flags

Each provider can be individually disabled:

| Variable | Effect |
|----------|--------|
| `DISABLE_PUTER=true` | Disable Puter.js provider |
| `DISABLE_POLLINATIONS=true` | Disable Pollinations provider |
| `DISABLE_DUCKDUCKGO=true` | Disable DuckDuckGo provider |
| `DISABLE_OPENROUTER=true` | Disable OpenRouter provider |
| `DISABLE_GROQ=true` | Disable Groq provider |
| `DISABLE_HUGGINGFACE=true` | Disable HuggingFace provider |
| `DISABLE_G4F=true` | Disable G4F provider |
| `DISABLE_BLACKBOX=true` | Disable Blackbox provider |
| `DISABLE_PHIND=true` | Disable Phind provider |

### Example `.env`

```env
PORT=3333
NODE_ENV=production
API_KEY=my-secret-gateway-key

# Provider keys (optional)
PUTER_AUTH_TOKEN=puter_token_here
GROQ_API_KEY=gsk_abc123...
HUGGINGFACE_API_KEY=hf_xyz789...
OPENROUTER_API_KEY=sk-or-...

# Rate limiting
RATELIMIT_WINDOW_MS=60000
RATELIMIT_MAX_REQUESTS=100

# Health & sync
HEALTH_CHECK_INTERVAL_MS=60000
MODEL_SYNC_INTERVAL_MS=3600000

# Disable unstable providers
DISABLE_BLACKBOX=true
DISABLE_PHIND=true

# CORS
CORS_ORIGIN=https://myapp.example.com
```

---

## Project Structure

```
Jeumpa LLM/
├── index.js                    # Layer 1: Express server, endpoints
├── router.js                   # Layer 2: Model resolution, auto-routing
├── middleware.js                # Rate limiting, validation, auth
├── globals.js                  # Browser API polyfills for Node.js
│
├── config/
│   └── providers.js            # Provider config, model definitions, aliases
│
├── providers/
│   ├── base.js                 # BaseProvider abstract class
│   ├── index.js                # ProviderRegistry singleton
│   ├── puter.js                # Puter.js SDK adapter
│   ├── pollinations.js         # Pollinations AI adapter
│   ├── duckduckgo.js           # DuckDuckGo AI adapter
│   ├── openrouter.js           # OpenRouter adapter
│   ├── groq.js                 # Groq adapter
│   ├── huggingface.js          # HuggingFace adapter
│   ├── g4f.js                  # G4F/FreeGPT adapter
│   ├── blackbox.js             # Blackbox AI adapter
│   └── phind.js                # Phind adapter
│
├── utils/
│   ├── provider-manager.js     # Layer 3: Routing, failover, health
│   └── model-sync.js           # Layer 5: Model auto-fetch service
│
├── dashboard/
│   ├── index.html              # PWA dashboard
│   └── manifest.json           # PWA manifest
│
├── agent/
│   └── index.js                # AI agent module
│
├── polyfills.js                # Additional polyfills
├── preload.js                  # Module preload
├── client.js                   # Puter.js client wrapper
├── cli.mjs                     # CLI interface
│
├── package.json                # Dependencies & scripts
├── .env                        # Environment configuration
├── setup.sh                    # Installation script
├── start.sh                    # Startup script
└── puter-proxy.service         # systemd service file
```

---

## Deployment

### Development

```bash
npm install
npm run dev     # node --watch index.js (auto-restart on changes)
```

### Production

```bash
npm install
npm start       # node index.js
```

### Systemd (Linux)

```bash
sudo cp puter-proxy.service /etc/systemd/system/
sudo systemctl enable puter-proxy
sudo systemctl start puter-proxy

# View logs
sudo journalctl -u puter-proxy -f

# Restart
sudo systemctl restart puter-proxy
```

### Process Management

The gateway handles graceful shutdown:

```
SIGTERM / SIGINT
  │
  ├─ Stop Provider Manager (clear health check interval)
  ├─ Stop Model Sync Service (clear sync interval)
  └─ process.exit(0)
```

---

<div align="center">

**Next: [API.md](API.md) | [MODELS.md](MODELS.md) | [PROVIDERS.md](PROVIDERS.md)**

</div>
