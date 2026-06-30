# Product Requirements Document

## Jeumpa LLM v6.0.0 — The Biggest Free Multi-LLM Hub

**Author:** Mulky Malikul Dhaher  
**Version:** 4.0.0  
**Status:** Active Development  
**License:** MIT  
**Repository:** [github.com/mulkymalikuldhrs/Jeumpa LLM](https://github.com/dhaher-labs/JeumpaLLM)

---

## Table of Contents

1. [Product Vision](#1-product-vision)
2. [Target Users](#2-target-users)
3. [Core Requirements](#3-core-requirements)
4. [Provider Requirements](#4-provider-requirements)
5. [API Specification](#5-api-specification)
6. [Non-Functional Requirements](#6-non-functional-requirements)
7. [Success Metrics](#7-success-metrics)
8. [Future Roadmap](#8-future-roadmap)
9. [Integration with Memorix/Pentaract](#9-integration-with-memorixpentaract)

---

## 1. Product Vision

### 1.1 Mission Statement

Jeumpa LLM aims to be the world's largest free multi-LLM hub, providing centralized access to 30+ AI models through 9+ providers, surpassing OpenRouter in free model availability. The gateway serves as an OpenAI/Anthropic-compatible API that can be used anywhere without a backend, making AI accessible to everyone — from students and hobbyists to professional developers and enterprises.

### 1.2 Vision Statement

> **Democratize AI access by providing a single, free, production-ready gateway that unifies 30+ AI models from 9+ providers under one API — no API keys required for core providers.**

### 1.3 Problem Statement

| Problem | Impact |
|---------|--------|
| AI API costs are prohibitive for individuals and small teams | Developers spend $100-500+/month on LLM APIs |
| Each provider has a different API format | Integration code is fragmented and hard to maintain |
| Free tiers are scattered across different platforms | Users must manage multiple accounts and credentials |
| No single gateway offers free multi-model access | Users are locked into single-provider ecosystems |
| Switching providers requires code changes | Vendor lock-in slows innovation and experimentation |

### 1.4 Solution

Jeumpa LLM provides:

- **One API endpoint** compatible with both OpenAI and Anthropic SDKs
- **9+ providers** aggregated into a single gateway with automatic failover
- **Zero cost** for core providers (Puter.js, Pollinations, DuckDuckGo, G4F, Blackbox, Phind)
- **Smart routing** that automatically selects the best model for each query
- **Round-robin load balancing** across providers for the same model
- **Automatic failover** when providers go down
- **30+ models** including GPT-4o, Claude Opus 4.5, DeepSeek, Gemini, Grok, Mistral, Llama, Qwen, and more

---

## 2. Target Users

### 2.1 Primary Personas

| Persona | Description | Key Needs |
|---------|-------------|-----------|
| **Solo Developer** | Building prototypes and side projects without budget | Free LLM access, easy setup, OpenAI-compatible API |
| **AI Enthusiast** | Experimenting with multiple models for personal learning | Multi-model access, streaming, auto-routing |
| **Student / Researcher** | Academic work with limited funding | Free access, reliable uptime, multiple model types |
| **Open-Source Maintainer** | Adding AI features to OSS projects | No API cost, stable API, SDK compatibility |
| **Memorix/Pentaract Developer** | Building memory-augmented AI systems | Multi-LLM backbone, agent system, tool use |

### 2.2 Secondary Personas

| Persona | Description | Key Needs |
|---------|-------------|-----------|
| **MCP/API Developer** | Building MCP tools that need LLM inference | Free inference, compatible API, streaming |
| **SaaS/I-SaaS Builder** | Creating AI-powered SaaS products | Scalable gateway, rate limiting, API key auth |
| **DevOps Engineer** | Deploying AI infrastructure | Health checks, monitoring, Docker support |
| **Educator** | Teaching AI/ML concepts | Free models, dashboard, playground |

### 2.3 User Scale Targets

| Metric | Phase 1 (v4.0) | Phase 2 | Phase 3 |
|--------|----------------|---------|---------|
| Concurrent users | 100 | 1,000 | 10,000+ |
| Daily requests | 10,000 | 100,000 | 1,000,000+ |
| Registered developers | 50 | 500 | 5,000+ |

---

## 3. Core Requirements

### 3.1 Functional Requirements

#### FR-01: Multi-Provider Support (9+ Providers)

The gateway must support at least 9 AI providers, each implemented as a pluggable provider module extending `BaseProvider`:

| # | Provider | Auth Required | Priority | Models |
|---|----------|---------------|----------|--------|
| 1 | Puter.js SDK | Optional (Puter token) | 1 | 14+ models |
| 2 | Pollinations AI | None | 1 | 5 models |
| 3 | DuckDuckGo AI Chat | None | 1 | 4 models |
| 4 | OpenRouter Free | Optional (API key) | 1 | Auto-fetched |
| 5 | Groq | Required (API key) | 2 | 4 models |
| 6 | HuggingFace Inference | Required (API key) | 2 | 3 models |
| 7 | G4F/FreeGPT | None | 2 | 3 models |
| 8 | Blackbox AI | None | 3 | 2 models |
| 9 | Phind | None | 3 | 1 model |

**Priority system:**
- Priority 1: No auth or optional auth — always tried first
- Priority 2: Requires free API key — tried when priority 1 providers fail
- Priority 3: Fragile/unstable — tried as last resort

#### FR-02: No API Key Required for Core Providers

The gateway must work out-of-the-box without any API keys. At minimum, the following providers must function without authentication:

- Puter.js SDK (basic usage)
- Pollinations AI
- DuckDuckGo AI Chat
- G4F/FreeGPT
- Blackbox AI
- Phind

Users may optionally provide API keys for enhanced access (Puter token, Groq key, HuggingFace key, OpenRouter key).

#### FR-03: OpenAI-Compatible API

The gateway must expose `POST /v1/chat/completions` that is a drop-in replacement for the OpenAI Chat Completions API, supporting:

- `messages` array (system, user, assistant, tool roles)
- `model` parameter with alias resolution
- `stream` parameter for SSE streaming
- `temperature` parameter (0-2)
- `max_tokens` parameter
- `top_p` parameter
- Response format matching OpenAI's `chat.completion` object
- Streaming format matching OpenAI's `chat.completion.chunk` objects
- Works with the official `openai` npm package by changing `baseURL`

#### FR-04: Anthropic-Compatible API

The gateway must expose `POST /v1/messages` that is a drop-in replacement for the Anthropic Messages API, supporting:

- `messages` array and/or `prompt` string
- `system` prompt parameter
- `model` parameter
- `max_tokens` parameter
- `stream` parameter for SSE streaming
- Response format matching Anthropic's `message` object
- Streaming format using `content_block_delta` events
- Works with the official `@anthropic-ai/sdk` npm package by changing `baseURL`

#### FR-05: Streaming Support (SSE)

All providers must support Server-Sent Events (SSE) streaming:

- OpenAI format: `data: {"object":"chat.completion.chunk","choices":[{"delta":{"content":"..."}}]}`
- Anthropic format: `event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"..."}}`
- Proper `data: [DONE]` termination
- Support for both async iterators and ReadableStream
- Backpressure handling and connection cleanup on client disconnect

#### FR-06: Round-Robin Routing

When multiple providers support the same model, the gateway must distribute requests using round-robin:

- Per-model round-robin state tracking
- Only round-robin among equally-prioritized healthy providers
- Automatic fallback to higher-priority providers
- Round-robin state is in-memory and resets on restart

#### FR-07: Automatic Failover

When a provider fails, the gateway must automatically try the next available provider:

- Failover is attempted for both streaming and non-streaming requests
- Providers are sorted by health status (healthy > unknown > degraded > down), then by priority, then by average latency
- Failed provider health status is degraded on first failure, down on consecutive failures
- All providers failing returns an error to the client
- Failed provider status recovers to `degraded` on next successful health check

#### FR-08: Health Checking

The gateway must periodically check the health of all enabled providers:

- Default interval: 60 seconds (configurable via `HEALTH_CHECK_INTERVAL_MS`)
- Each health check has a 10-second timeout
- Health states: `healthy`, `degraded`, `down`, `unknown`
- Health status is exposed via `GET /status` and `GET /providers/:name/health`
- Health checks run in parallel using `Promise.allSettled`

#### FR-09: Model Auto-Sync

The gateway must periodically fetch the latest model list from providers:

- Default interval: 1 hour (configurable via `MODEL_SYNC_INTERVAL_MS`)
- Each sync has a 15-second timeout per provider
- Sync history is retained (last 10 records)
- New models are automatically available without restart
- Sync stats are exposed via `GET /status`

#### FR-10: PWA Dashboard

The gateway must include a Progressive Web App dashboard accessible at `GET /dashboard`:

- **Overview page**: Active providers, available models, uptime, version
- **Providers page**: Detailed status, metrics, health checks per provider
- **Models page**: Searchable model grid with type badges and provider info
- **Playground page**: Chat playground with model selector, format toggle, streaming toggle
- **API Reference page**: Endpoint documentation and code examples
- **Mobile-responsive**: Collapsible sidebar, responsive grid
- **PWA manifest**: Installable as a native-like app
- **Dark theme**: Professional dark design inspired by Vercel/Railway/Linear
- **Real-time**: Auto-refreshing data from gateway endpoints

#### FR-11: AI Agent

The gateway must include a built-in AI agent (`agent/index.js`) that:

- Can be used from both browser and Node.js environments
- Supports multi-turn conversation with history management
- Supports both OpenAI and Anthropic API formats
- Provides specialized methods: `reason()` for multi-step reasoning, `generateCode()` for code generation with review
- Has a CLI mode for interactive terminal chat
- Can list available models and check gateway status
- Supports streaming responses with `onChunk` callback

#### FR-12: Rate Limiting

The gateway must enforce per-IP rate limiting:

- Default: 100 requests per minute per IP
- Configurable via `RATELIMIT_WINDOW_MS` and `RATELIMIT_MAX_REQUESTS`
- Rate limit headers on every response: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`
- 429 response with `retry_after_ms` when rate limit is exceeded
- In-memory rate limit store with automatic cleanup of expired entries (every 5 minutes)

#### FR-13: CORS Support

The gateway must support Cross-Origin Resource Sharing:

- Configurable `CORS_ORIGIN` environment variable
- If `CORS_ORIGIN` is set, only that origin is allowed
- If `CORS_ORIGIN` is empty, all origins are allowed (`*`)
- Allowed methods: GET, POST, OPTIONS, DELETE
- Allowed headers: Content-Type, Authorization, X-API-Key, Anthropic-Api-Version
- Max-Age: 86400 (24 hours)

#### FR-14: API Key Authentication (Optional)

The gateway must support optional API key authentication:

- When `API_KEY` env var is set, all requests require authentication
- Authentication via `X-API-Key` header or `Authorization: Bearer <key>` header
- When `API_KEY` is not set, no authentication is required (default)
- 401 response for invalid or missing API key

#### FR-15: Model Aliases

The gateway must support model name aliases for convenience:

- Short names map to canonical model IDs (e.g., `gpt4` → `gpt-4o`, `claude` → `claude-opus-4-5-latest`)
- Case-insensitive alias resolution
- Aliases are defined in `config/providers.js` (`MODEL_ALIASES` map)
- Aliases work across all endpoints

#### FR-16: Auto-Routing

The gateway must intelligently route requests based on query content:

- `BUILDING` (code, implement, debug, refactor, sql, deploy, docker...) → `claude-opus-4-5-latest`
- `PLANNING` (plan, design, strategy, architecture, analyze, compare...) → `deepseek-chat`
- `REASONING` (reason, solve, explain, how does, why is, proof, calculate...) → `gpt-4o`
- `FAST` (simple question, <100 chars) → `gpt-4o-mini`
- `DEFAULT` → `deepseek-chat`
- Triggered when `model` is `auto` or not specified
- Routing decision endpoint: `POST /route` (returns decision without execution)

#### FR-17: Professional Documentation

The gateway must include comprehensive, professional documentation:

- **README.md**: Trilingual (English, Bahasa Indonesia, Chinese) with features, quick start, API reference
- **API.md**: Complete API reference with examples
- **ARCHITECTURE.md**: System architecture documentation
- **PROVIDERS.md**: Provider tutorials and integration guides
- **MODELS.md**: Model guide with testing status
- **PRD.md**: This Product Requirements Document
- **CHANGELOG.md**: Version history following Keep a Changelog format
- **CONTRIBUTING.md**: Contribution guidelines
- **SECURITY.md**: Security policy

#### FR-18: Input Validation

The gateway must validate all incoming requests:

- Request body must be a JSON object
- `messages` must be a non-empty array (max 128 messages)
- Each message must have a valid `role` (system, user, assistant, tool)
- Message content must be a string or array (max 50,000 chars per message)
- `model` must be a string (max 256 chars)
- `max_tokens` must be a positive number
- `system` prompt must be a string (max 50,000 chars)
- Null bytes are stripped from message content (sanitization)

#### FR-19: Provider Disable Control

Individual providers can be disabled via environment variables:

- `DISABLE_<PROVIDER_NAME>=true` or `DISABLE_<PROVIDER_NAME>=1`
- Example: `DISABLE_BLACKBOX=true` disables the Blackbox provider
- Disabled providers are not included in routing or health checks

#### FR-20: Graceful Shutdown

The gateway must handle graceful shutdown:

- `SIGTERM` and `SIGINT` signals are caught
- Provider manager health check interval is cleared
- Model sync service interval is cleared
- Process exits cleanly with code 0

---

## 4. Provider Requirements

### 4.1 Puter.js SDK Provider

| Requirement | Description |
|-------------|-------------|
| **ID** | `puter` |
| **Auth** | Optional `PUTER_AUTH_TOKEN` |
| **Priority** | 1 |
| **Models** | 14+ models including GPT-4o, GPT-5, Claude Opus 4.5, DeepSeek, Gemini, Grok, Mistral, Qwen |
| **Streaming** | Yes (via Puter.js SDK) |
| **Timeout** | 60 seconds |
| **Special** | Primary provider for premium models; requires jsdom polyfill for server-side Puter.js SDK |

**Models list:**

| Model ID | Type | Description |
|----------|------|-------------|
| `deepseek-chat` | reasoning | DeepSeek Chat — general purpose, planning |
| `gpt-5-chat` | general | OpenAI GPT-5 Chat |
| `gpt-4o` | general | OpenAI GPT-4o — complex reasoning |
| `gpt-4o-mini` | fast | OpenAI GPT-4o Mini — quick tasks |
| `gemini-2.0-flash` | fast | Google Gemini 2.0 Flash |
| `claude-opus-4-5-latest` | code/analysis | Claude Opus 4.5 — best for code |
| `claude-sonnet-4` | balanced | Claude Sonnet 4 — code + analysis |
| `claude-haiku-4-5` | fast | Claude Haiku 4.5 — quick |
| `grok-3` | general | xAI Grok 3 |
| `grok-3-fast` | fast | xAI Grok 3 Fast |
| `grok-2-vision` | vision | xAI Grok 2 Vision |
| `mistral-large-2512` | general | Mistral Large |
| `codestral-2508` | code | Codestral — code gen |
| `qwen-2.5-coder-32b-instruct` | code | Qwen 2.5 Coder 32B |

### 4.2 Pollinations AI Provider

| Requirement | Description |
|-------------|-------------|
| **ID** | `pollinations` |
| **Auth** | None |
| **Priority** | 1 |
| **Base URL** | `https://text.pollinations.ai` |
| **Timeout** | 30 seconds |
| **Special** | Completely free, no auth, supports DeepSeek R1 |

**Models list:**

| Model ID | Type | Aliases |
|----------|------|---------|
| `openai` | general | `gpt-4o-mini` |
| `mistral` | general | `mistral-large` |
| `llama` | general | `llama-3.1-70b` |
| `deepseek-r1` | reasoning | `deepseek-reasoner` |
| `qwen` | general | `qwen-coder` |

### 4.3 DuckDuckGo AI Chat Provider

| Requirement | Description |
|-------------|-------------|
| **ID** | `duckduckgo` |
| **Auth** | None |
| **Priority** | 1 |
| **Base URL** | `https://duckduckgo.com` |
| **Timeout** | 30 seconds |
| **Special** | Free, requires session/VQD token management |

**Models list:**

| Model ID | Type | Aliases |
|----------|------|---------|
| `gpt-4o-mini` | fast | — |
| `claude-3-haiku` | fast | `claude-haiku` |
| `llama-3.1-70b` | general | `llama` |
| `mixtral-8x7b` | general | `mixtral` |

### 4.4 OpenRouter Free Provider

| Requirement | Description |
|-------------|-------------|
| **ID** | `openrouter` |
| **Auth** | Optional `OPENROUTER_API_KEY` |
| **Priority** | 1 |
| **Base URL** | `https://openrouter.ai/api/v1` |
| **Timeout** | 30 seconds |
| **Special** | Model list auto-fetched from OpenRouter API; provides access to all free models on OpenRouter |

### 4.5 Groq Provider

| Requirement | Description |
|-------------|-------------|
| **ID** | `groq` |
| **Auth** | Required `GROQ_API_KEY` |
| **Priority** | 2 |
| **Base URL** | `https://api.groq.com/openai/v1` |
| **Timeout** | 30 seconds |
| **Special** | Ultra-low latency inference; OpenAI-compatible response format |

**Models list:**

| Model ID | Type |
|----------|------|
| `llama-3.3-70b-versatile` | general |
| `llama-3.1-8b-instant` | fast |
| `mixtral-8x7b-32768` | general |
| `gemma2-9b-it` | fast |

### 4.6 HuggingFace Inference Provider

| Requirement | Description |
|-------------|-------------|
| **ID** | `huggingface` |
| **Auth** | Required `HUGGINGFACE_API_KEY` |
| **Priority** | 2 |
| **Base URL** | `https://api-inference.huggingface.co/models` |
| **Timeout** | 60 seconds |
| **Special** | Access to open-source models on HuggingFace Hub |

**Models list:**

| Model ID | Type |
|----------|------|
| `meta-llama/Llama-3.1-70B-Instruct` | general |
| `mistralai/Mixtral-8x7B-Instruct-v0.1` | general |
| `Qwen/Qwen2.5-Coder-32B-Instruct` | code |

### 4.7 G4F/FreeGPT Provider

| Requirement | Description |
|-------------|-------------|
| **ID** | `g4f` |
| **Auth** | None |
| **Priority** | 2 |
| **Timeout** | 45 seconds |
| **Special** | Access to GPT-4o and Claude via free G4F services; may be unstable |

**Models list:**

| Model ID | Type | Aliases |
|----------|------|---------|
| `gpt-4o` | general | `gpt4o-g4f` |
| `gpt-4o-mini` | fast | — |
| `claude-3-5-sonnet` | balanced | — |

### 4.8 Blackbox AI Provider

| Requirement | Description |
|-------------|-------------|
| **ID** | `blackbox` |
| **Auth** | None |
| **Priority** | 3 |
| **Base URL** | `https://www.blackbox.ai` |
| **Timeout** | 30 seconds |
| **Special** | Free AI coding assistant; may have rate limits |

**Models list:**

| Model ID | Type |
|----------|------|
| `blackboxai` | general |
| `blackboxai-pro` | general |

### 4.9 Phind Provider

| Requirement | Description |
|-------------|-------------|
| **ID** | `phind` |
| **Auth** | None |
| **Priority** | 3 |
| **Base URL** | `https://www.phind.com` |
| **Timeout** | 30 seconds |
| **Special** | Code-specialized model; useful as a fallback code provider |

**Models list:**

| Model ID | Type | Aliases |
|----------|------|---------|
| `Phind-70B` | code | `phind-70b` |

---

## 5. API Specification

The complete API specification is documented in [API.md](API.md). Below is a summary of all endpoints:

### 5.1 Chat Endpoints

| Method | Endpoint | Protocol | Description |
|--------|----------|----------|-------------|
| `POST` | `/chat` | Native | Unified auto-routed chat |
| `POST` | `/v1/chat/completions` | OpenAI | OpenAI-compatible chat completions |
| `POST` | `/v1/messages` | Anthropic | Anthropic-compatible messages |

### 5.2 Status Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Gateway health check |
| `GET` | `/status` | Server + provider status |
| `GET` | `/models` | List all available models |
| `GET` | `/providers` | Provider details and stats |
| `GET` | `/providers/:name/health` | Individual provider health check |

### 5.3 Utility Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/route` | Routing decision (debug, no execution) |
| `GET` | `/dashboard` | PWA web dashboard |

### 5.4 SDK Compatibility

- **OpenAI SDK**: Set `baseURL: 'http://localhost:3333/v1'` and `apiKey: 'not-needed'`
- **Anthropic SDK**: Set `baseURL: 'http://localhost:3333/v1'` and `apiKey: 'not-needed'`

---

## 6. Non-Functional Requirements

### 6.1 Performance

| Requirement | Target |
|-------------|--------|
| First token latency (P50) | < 500ms |
| First token latency (P99) | < 2s |
| Throughput | 100+ concurrent requests |
| Memory usage (idle) | < 100MB |
| Memory usage (under load) | < 500MB |
| Body payload support | 10MB |
| Startup time | < 5 seconds |

### 6.2 Reliability

| Requirement | Target |
|-------------|--------|
| Uptime (single instance) | 99.5% |
| Automatic failover | < 2 seconds |
| Health check interval | 60 seconds |
| Provider recovery | Automatic on next successful health check |
| Graceful shutdown | SIGTERM/SIGINT handled |
| Error recovery | Per-request; no global crash on provider failure |

### 6.3 Security

| Requirement | Implementation |
|-------------|----------------|
| Rate limiting | Per-IP, configurable window and max requests |
| API key auth | Optional; via env var `API_KEY` |
| CORS | Configurable origin; no wildcard by default |
| Input validation | Role checking, length limits, count limits |
| Message sanitization | Null byte stripping, non-standard field removal |
| Payload size limit | 10MB max |
| Header hardening | `X-Powered-By` removed |
| Error masking | Internal details hidden in production mode |
| No credential storage | API keys only in env vars, never logged |

### 6.4 Scalability

| Requirement | Implementation |
|-------------|----------------|
| Horizontal scaling | Stateless design; can run behind load balancer |
| Provider addition | Pluggable `BaseProvider` architecture |
| Model addition | Auto-sync from provider APIs |
| Configuration | Environment variables for all tunables |
| Priority system | Multi-tier provider priority for optimal routing |

### 6.5 Observability

| Requirement | Implementation |
|-------------|----------------|
| Health endpoints | `/health`, `/status`, `/providers/:name/health` |
| Structured logging | Prefixed console logs (`[Jeumpa LLM]`, `[PROVIDER]`, `[PROVIDER-MGR]`, `[MODEL-SYNC]`) |
| Request tracking | Latency tracking per provider |
| Error tracking | Error rate calculation per provider |
| Dashboard | Real-time PWA dashboard with live metrics |

### 6.6 Compatibility

| Requirement | Target |
|-------------|--------|
| Node.js | >= 18.0.0 (22.x recommended) |
| OpenAI SDK | v4.x |
| Anthropic SDK | v0.71+ |
| Express | v5.x |
| Browsers | Modern evergreen browsers (for dashboard and agent) |
| Operating systems | Linux, macOS, Windows |

---

## 7. Success Metrics

### 7.1 Quantitative Metrics

| Metric | Current (v4.0) | Phase 2 Target | Phase 3 Target |
|--------|----------------|----------------|----------------|
| Number of providers | 9 | 15+ | 25+ |
| Number of models | 30+ | 60+ | 100+ |
| Free models (no API key) | 20+ | 40+ | 60+ |
| Uptime | 99% | 99.5% | 99.9% |
| Median first-token latency | < 1s | < 500ms | < 300ms |
| API response time (non-streaming) | < 5s | < 3s | < 2s |
| GitHub stars | 100+ | 1,000+ | 5,000+ |
| Monthly active users | 50 | 500 | 5,000 |
| Community contributors | 5 | 20 | 50+ |

### 7.2 Qualitative Metrics

- **Developer satisfaction**: Easy setup (< 5 minutes to first working request)
- **API compatibility**: 100% OpenAI SDK and Anthropic SDK compatibility
- **Documentation completeness**: All endpoints documented with examples
- **Error clarity**: All error responses include actionable messages
- **Dashboard usability**: All features accessible without reading docs

### 7.3 Competitive Comparison

| Feature | Jeumpa LLM v4.0 | OpenRouter | LiteLLM | LibreChat |
|---------|-------------|------------|---------|-----------|
| Free models (no key) | 20+ | 5 | 0 | 5 |
| Providers | 9+ | 50+ | 100+ | 10+ |
| No backend needed | Yes | No | No | No |
| OpenAI compatible | Yes | Yes | Yes | Yes |
| Anthropic compatible | Yes | Yes | Yes | Partial |
| Auto-routing | Yes | Yes | Yes | No |
| Round-robin failover | Yes | No | Yes | No |
| PWA dashboard | Yes | Yes | No | Yes |
| AI Agent built-in | Yes | No | No | No |

---

## 8. Future Roadmap

### Phase 2: Enhanced Gateway (v6.0)

| Feature | Description | Priority |
|---------|-------------|----------|
| More providers | Together AI, Fireworks, Cerebras, Perplexity, Cohere, AI21 | High |
| Response caching | Redis-backed response caching for identical queries | High |
| MCP support | Model Context Protocol server implementation | High |
| Token counting | Accurate token counting for usage tracking | Medium |
| Usage analytics | Request logging and analytics dashboard | Medium |
| Webhook support | Provider status change notifications | Medium |
| Docker image | Official Docker Hub image | High |
| Kubernetes Helm chart | Production Kubernetes deployment | Medium |
| WebSocket support | WebSocket-based streaming alternative | Low |
| Embedding endpoints | `/v1/embeddings` support | Medium |
| Image generation | `/v1/images/generations` support | Medium |
| Audio/STT | Speech-to-text endpoints | Low |

### Phase 3: SaaS/I-SaaS Platform (v6.0)

| Feature | Description | Priority |
|---------|-------------|----------|
| Multi-tenant support | API key-based tenant isolation | High |
| Billing system | Usage-based billing with Stripe | High |
| Team management | Team accounts, RBAC, shared keys | High |
| Custom model routing | User-defined routing rules | Medium |
| Fine-tuning endpoints | Fine-tuned model hosting | Medium |
| Function calling | Structured tool use and function calling | High |
| Streaming proxy | Cloudflare Workers edge proxy | Medium |
| SDK libraries | Python, Go, Rust client libraries | Medium |
| Plugin system | Third-party provider plugins | Low |
| SLA guarantees | 99.9% uptime SLA for paid tiers | High |
| Enterprise SSO | SAML/OIDC authentication | Medium |
| Audit logging | Complete request/response audit trail | Medium |

---

## 9. Integration with Memorix/Pentaract

### 9.1 Overview

**Memorix** is a memory-augmented AI system and **Pentaract** is its underlying architecture, both developed by the same team as Jeumpa LLM. Jeumpa LLM serves as the LLM backbone for the entire Memorix ecosystem, providing the multi-model inference layer that powers memory retrieval, agent reasoning, and task execution.

### 9.2 Jeumpa LLM as Memorix's LLM Backbone

```
┌─────────────────────────────────────────────────────────────┐
│                      Memorix / Pentaract                     │
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │  Memory   │  │  Agent   │  │  Planner │  │ Executor │   │
│  │  System   │  │  System  │  │          │  │          │   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘   │
│       │              │              │              │          │
│       └──────────────┴──────────────┴──────────────┘         │
│                           │                                   │
│                    ┌──────┴──────┐                           │
│                    │  Jeumpa LLM │                           │
│                    │   Gateway   │                           │
│                    └──────┬──────┘                           │
│                           │                                   │
│       ┌───────────┬───────┼────────┬───────────┐            │
│       ▼           ▼       ▼        ▼           ▼            │
│  ┌─────────┐ ┌────────┐ ┌─────┐ ┌────────┐ ┌──────┐      │
│  │ Puter   │ │Pollin. │ │ DDG │ │ Groq   │ │ G4F  │      │
│  │  SDK    │ │  AI    │ │ AI  │ │        │ │      │      │
│  └─────────┘ └────────┘ └─────┘ └────────┘ └──────┘      │
└─────────────────────────────────────────────────────────────┘
```

### 9.3 How Memorix Uses Jeumpa LLM

| Memorix Component | Jeumpa LLM Feature Used | Purpose |
|-------------------|---------------------|---------|
| **Memory System** | Auto-routing + Puter.js | Memory encoding, retrieval, and summarization using the best available model |
| **Agent System** | Multi-provider failover | Reliable agent execution even when individual providers fail |
| **Planner** | DeepSeek via Puter.js | Task decomposition and planning using reasoning-optimized models |
| **Executor** | Claude Opus / Qwen Coder | Code generation and execution using code-optimized models |
| **Context Manager** | Round-robin routing | Load-balanced context processing across multiple providers |
| **Tool System** | Model aliases + auto-routing | Simplified model selection for tool-specific tasks |

### 9.4 Jeumpa LLM Agent as Memorix's Agent Runtime

The Jeumpa LLM Agent (`agent/index.js`) is designed to serve as the base agent runtime for Memorix:

- **Multi-step reasoning**: The `reason()` method breaks complex tasks into steps, routing each to the optimal model
- **Code generation with review**: The `generateCode()` method generates code with Claude Opus and reviews with DeepSeek
- **Conversation history**: Built-in history management for multi-turn agent conversations
- **Model flexibility**: Each step can target a different model based on the task type

### 9.5 Future Integration Points

| Feature | Jeumpa LLM Role | Memorix Role |
|---------|-------------|-------------|
| **MCP Server** | Jeumpa LLM exposes MCP-compliant tool endpoints | Memorix agents discover and use tools via MCP |
| **Memory-Augmented Inference** | Jeumpa LLM routes to models with memory context | Memorix provides memory context in system prompts |
| **Multi-Agent Orchestration** | Jeumpa LLM provides the inference layer | Memorix orchestrates multiple agents with different model specializations |
| **Persistent Conversations** | Jeumpa LLM provides stateless inference | Memorix manages conversation persistence and context windows |
| **Custom Fine-Tuned Models** | Jeumpa LLM hosts fine-tuned model endpoints | Memorix uses specialized models for domain-specific tasks |

### 9.6 Shared Design Principles

Jeumpa LLM and Memorix share the following design principles:

1. **Free first**: Core functionality works without payment
2. **No backend required**: Can run entirely in the browser/locally
3. **Privacy by default**: All data stays local unless explicitly shared
4. **Multi-model**: Never locked into a single provider
5. **Open source**: MIT licensed, community-driven development
6. **Education focus**: Built for learning and research purposes

---

## Appendix A: Environment Variables Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3333` | Server port |
| `NODE_ENV` | `development` | Environment mode (production hides error details) |
| `PUTER_AUTH_TOKEN` | — | Puter.js authentication token (optional) |
| `GROQ_API_KEY` | — | Groq API key (required for Groq provider) |
| `HUGGINGFACE_API_KEY` | — | HuggingFace API key (required for HF provider) |
| `OPENROUTER_API_KEY` | — | OpenRouter API key (optional, enables free models) |
| `API_KEY` | — | Gateway API key (if set, required for all requests) |
| `CORS_ORIGIN` | `*` | Allowed CORS origin (empty = allow all) |
| `RATELIMIT_WINDOW_MS` | `60000` | Rate limit window in milliseconds |
| `RATELIMIT_MAX_REQUESTS` | `100` | Max requests per window per IP |
| `HEALTH_CHECK_INTERVAL_MS` | `60000` | Health check interval in milliseconds |
| `MODEL_SYNC_INTERVAL_MS` | `3600000` | Model sync interval in milliseconds |
| `LOG_LEVEL` | `info` | Logging level |
| `DISABLE_<PROVIDER>` | — | Set to `true` or `1` to disable a provider |

---

## Appendix B: Model Alias Reference

| Alias | Resolves To |
|-------|-------------|
| `gpt4` | `gpt-4o` |
| `gpt4o` | `gpt-4o` |
| `gpt4-mini` | `gpt-4o-mini` |
| `claude` | `claude-opus-4-5-latest` |
| `claude-opus` | `claude-opus-4-5-latest` |
| `claude-sonnet` | `claude-sonnet-4` |
| `claude-haiku` | `claude-haiku-4-5` |
| `deepseek` | `deepseek-chat` |
| `deepseek-r1` | `deepseek-reasoner` |
| `gemini` | `gemini-2.0-flash` |
| `gemini-flash` | `gemini-2.0-flash` |
| `grok` | `grok-3` |
| `llama` | `llama-3.1-70b` |
| `mixtral` | `mixtral-8x7b-32768` |
| `qwen-coder` | `qwen-2.5-coder-32b-instruct` |
| `codestral` | `codestral-2508` |
| `mistral` | `mistral-large-2512` |

---

> **Contact:** Mulky Malikul Dhaher — [mulkymalikuldhaher@email.com](mailto:mulkymalikuldhaher@email.com)  
> **Disclaimer:** This project is for Education Purpose only. The authors and contributors assume no responsibility or liability for any damages, losses, or risks arising from the use of this software.
