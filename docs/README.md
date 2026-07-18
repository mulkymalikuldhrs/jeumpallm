# JeumpaLLM v2.0 — Python Engine

**AI Gateway + SaaS Platform — 47+ LLM Providers, Multi-Model Routing, MCP SSE, Santri Program, RAG, Circuit Breaker, A2A, Observability**

> "AI untuk Semua, Khususnya Aceh" — Dhaher Labs

Unified LLM gateway aggregating 47+ providers under a single API, with autonomous provider discovery, AI-powered health monitoring, 4-tier access control, MCP compatibility, and all engine features ported from Node.js v1.0 — running on Android (Termux).

## Quick Start

```bash
./start.sh start        # Start server on :3456
./start.sh stop         # Stop + backup
./start.sh status       # Health + resources + tunnel
./start.sh logs         # Tail logs
./start.sh backup       # Manual backup
```

## Access Model

| Tier | Limit | How |
|------|-------|-----|
| **Anonymous** | 10 total requests | No login |
| **Free** | 100/day | Login via `/auth/login` |
| **Santri** | Unlimited (1 tahun) | Verifikasi santri Aceh |
| **Donor** | Token-based (1 bulan) | Donasi berapa pun |

### Santri Aceh Gratis
Santri/santriwati wilayah Aceh dapat akses gratis 1 tahun:
1. `POST /santri/register` — daftar dengan data pesantren + orang tua
2. `POST /santri/verify` — jawab pertanyaan verifikasi
3. Verifikasi otomatis jika nama pesantren cocok

### Donasi
- Minimum donasi: tidak ditentukan
- Token: 10 token per IDR (configurable)
- Valid: 30 hari
- Contoh: IDR 25.000 → 250.000 token

## Authentication

| Method | Header | Example |
|--------|--------|---------|
| **Email:Password** | `x-api-key: email:password` | Langsung, tanpa setup |
| JWT Bearer | `Authorization: Bearer <token>` | Dari `/auth/login` |
| API Key (sk-jmpp-* / jl-*) | `x-api-key: <key>` | Legacy + new |

```bash
# Langsung pakai email:password
curl -H "x-api-key: user@email.com:password123" \
  http://localhost:3456/v1/chat/completions \
  -d '{"messages":[{"role":"user","content":"Halo"}],"model":"auto"}'
```

## API Endpoints

### Chat
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/chat/completions` | POST | Chat (model, task, stream, strategy) |
| `/v1/streaming` | POST | SSE streaming |
| `/v1/completion` | POST | Text completion |
| `/v1/messages` | POST | Anthropic-compatible chat |

### Models & Providers
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/models` | GET | All models + aliases |
| `/v1/providers` | GET | Provider details |
| `/v1/health` | GET | Server health + stats |
| `/v1/status` | GET | Provider status |
| `/v1/refresh` | POST | Trigger auto-discovery |
| `/v1/cost-estimate` | POST | Estimate cost for model + tokens |

### RAG
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/rag/ingest` | POST | Ingest text into RAG |
| `/v1/rag/query` | POST | Search RAG documents |
| `/v1/rag/documents` | GET | List documents |
| `/v1/rag/documents/{id}` | DELETE | Delete document |

### Knowledge Graph
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/graph/entities` | GET/POST | List/create entities |
| `/v1/graph/entities/{id}` | GET/PATCH/DELETE | Entity CRUD |
| `/v1/graph/relations` | POST | Create relation |
| `/v1/graph/extract` | POST | Extract entities from text |
| `/v1/graph/search` | GET | Search graph |

### Agent & Tools
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/agent/code` | POST | Coding agent |
| `/v1/agent/chat` | POST | Agent with tool execution |
| `/v1/agent/tools` | POST | List available tools |
| `/v1/tools` | GET | List all tools |
| `/v1/tools/execute` | POST | Execute a tool |

### Workflows (Orchestration)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/workflows` | GET/POST | List/create workflows |
| `/v1/workflows/{id}` | GET | Get workflow |
| `/v1/workflows/{id}/execute` | POST | Execute workflow |
| `/v1/workflows/executions/{id}` | GET | Execution status |

### A2A Protocol
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/.well-known/agent.json` | GET | Agent card |
| `/a2a/agents` | GET | List agents |
| `/a2a/{name}/tasks` | POST | Create task |
| `/a2a/tasks/{id}` | GET | Task status |

### Marketplace
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/marketplace/search` | GET | Search packages |
| `/marketplace/popular` | GET | Popular packages |
| `/marketplace/featured` | GET | Featured packages |
| `/marketplace/categories` | GET | Categories |
| `/marketplace/packages` | GET/POST | Package CRUD |
| `/marketplace/packages/{id}` | GET | Package detail |
| `/marketplace/packages/{id}/rate` | POST | Rate package |

### Memory
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/conversations` | GET/POST | Conversation CRUD |
| `/v1/conversations/{id}` | GET/DELETE | Single conversation |
| `/v1/memory/search` | GET | Vector search |
| `/v1/memory/shared` | GET/POST | Shared memory |
| `/v1/memory/shared/search` | GET | Search shared memory |

### Auth
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/auth/register` | POST | Create account |
| `/auth/login` | POST | Login (JWT) |
| `/auth/refresh` | POST | Refresh JWT |
| `/auth/me` | GET/PUT | Profile + custom instructions |
| `/auth/api-keys` | GET/POST | API key management |
| `/auth/api-keys/{id}` | DELETE | Delete API key |

### MCP
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/mcp` | POST | MCP JSON-RPC |
| `/mcp/sse` | GET | MCP over SSE (Claude Desktop) |

### Observability
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/analytics/overview` | GET | Dashboard stats |
| `/v1/analytics/provider-ranking` | GET | Provider health ranking |
| `/v1/analytics/model-popularity` | GET | Model usage stats |
| `/v1/tracing/spans` | GET | Recent trace spans |
| `/v1/tracing/trace/{id}` | GET | Full trace details |
| `/v1/tracing/stats` | GET | Tracing statistics |
| `/v1/logs` | GET | Request logs (paginated) |
| `/circuit-breakers` | GET | Circuit breaker states |

### Monitoring
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/paths` | GET | Auto-detected paths |
| `/v1/tunnel` | GET | Tunnel info |
| `/v1/discovery` | GET | Auto-discovery status |
| `/v1/discovery/probe` | POST | Trigger probe |
| `/v1/discovery/integrate` | POST | Integrate provider |

### Donation & Santri
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/donate/methods` | GET | Available payment methods (Dana/OVO/GoPay/QRIS/BSI/etc) |
| `/donate/tiers` | GET | Donation tiers |
| `/donate/create` | POST | Create donation with selected payment method |
| `/donate/confirm` | POST | Confirm payment via payment_ref |
| `/donate/webhook` | POST | Auto-detect payment (Tripay/Midtrans/Xendit callback) |
| `/donate/status` | GET | Check balance & history |
| `/santri/register` | POST | Register santri |
| `/santri/verify` | POST | Verify santri |
| `/santri/status` | GET | Verification status |

### Acehnese (Bahasa Aceh)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/aceh/detect` | POST | Detect Aceh language → confidence score |
| `/v1/aceh/lookup?word=` | GET | Dictionary lookup (Google Translate + kata.web.id) |
| `/v1/aceh/translate` | POST | Translate Aceh ↔ Indonesia/English |
| `/v1/aceh/enrich` | POST | Full pipeline: detect → lookup → injectable glossary |
| `/v1/aceh/glossary` | GET | Module info, word list, source status |

### Billing
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/billing/create-checkout` | POST | Stripe checkout |
| `/billing/success` | GET | Payment success |
| `/billing/webhook` | POST | Stripe webhook |
| `/billing/portal` | POST | Customer portal |
| `/billing/subscription` | GET | Subscription status |

## Features

| Layer | Capabilities |
|-------|-------------|
| **Gateway** | 47+ API providers + 12 auto-discovered + 17 no-auth |
| **Routing** | Round-robin, priority, latency, random, fallback, content-based smart routing |
| **Task Router** | 10 profiles (code, chat, reasoning, creative, etc.) |
| **Auto Discovery** | GitHub + HuggingFace + known endpoints scan, auto-integration |
| **AI Monitor** | AI-powered health diagnosis every 60s, circuit breaker integration |
| **Circuit Breaker** | 4-state (CLOSED→DEGRADED→OPEN→HALF_OPEN), 8 failure kinds, exponential backoff |
| **RAG** | Document ingestion, chunking, embedding, cosine similarity search |
| **Knowledge Graph** | Entity-relation extraction, search, auto-discovery from text |
| **Agent** | Tool-using agent with OpenAI function calling format |
| **Orchestration** | Graph-based workflow engine (LLM/tool/condition/parallel/aggregator nodes) |
| **A2A Protocol** | Google A2A standard, agent card, task state machine |
| **Marketplace** | Agent package registry, search, install, ratings |
| **Multi-Modal** | ContentBlock system for text/image/audio/code |
| **Observability** | Distributed tracing, span analytics, performance stats |
| **Cost Estimation** | 50+ model pricing table, CJK-aware token estimation |
| **Anthropic Compat** | Full `/v1/messages` endpoint with format conversion |
| **Chat UI** | SPA — streaming, markdown, syntax highlighting |
| **PWA Dashboard** | 10 pages — Overview, Providers, Models, Playground, API, MCP, Compare, Analytics, Settings, Logs — dark/light theme |
| **Auth** | JWT + email:password API key + sessions + per-key rate limiting + IP whitelist + key expiry |
| **Sandbox** | Isolated Python/sh/JS execution with resource limits |
| **MCP SSE** | Compatible with Claude Desktop, Cursor |
| **Memory** | Conversation persistence, Jina AI vectors, shared memory |
| **Donasi** | Token-based access, no minimum |
| **Santri** | 1 tahun gratis santri Aceh |
| **Acehnese** | Auto-detect + translate via Google Translate API (free) + kata.web.id — 0 dataset |
| **Custom Instructions** | Personal system prompt per user |
| **Auto Paths** | Pure auto path — sentinel `.jeumpa_root`, env, home, Android storage scan (7 mount points), tmp fallback |
| **Auto Tunnel** | Auto-detects Cloudflare, ngrok, localtunnel, local IP |
| **Rate Limiting** | 4 tiers (anon/free/santri/donor) + per-key limits |
| **Backup** | Daily DB + config rotation |

## MCP Integration

```json
{
  "mcpServers": {
    "jeumpa": {
      "type": "sse",
      "url": "http://127.0.0.1:3456/mcp/sse"
    }
  }
}
```

## Routing Strategies

Send `strategy` field in chat request body:
- `round_robin` (default) — evenly distributes
- `priority` — highest priority healthy provider
- `random` — random selection
- `latency` — lowest latency
- `fallback` — chain through fallbacks
- `content_based` — smart routing by message content analysis

## Task Profiles

```bash
curl -X POST http://localhost:3456/v1/chat/completions \
  -H "x-api-key: email:password" \
  -d '{"messages":[{"role":"user","content":"Buatkan fungsi sorting"}],"task":"coding"}'
```

Available tasks: `chat`, `coding`, `reasoning`, `creative`, `fast`, `vision`, `long_task`, `brainstorming`, `balanced`, `default`

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `JEUMAPPA_HOME` | auto | Service root |
| `JEUMAPPA_DATA` | auto | Data directory |
| `JEUMAPPA_JWT_SECRET` | auto | JWT signing |
| `PORT` | 3456 | Server port |
| *(35+ provider API keys)* | | See `.env.example` |

## Providers

### Built-in (35+ with API keys configured)
| Category | Providers |
|----------|-----------|
| **Free No-Auth** | Pollinations, DuckDuckGo, LLM7, DeepAI, FreeGPT, ApiAirforce, Venice, G4F, Blackbox, Phind |
| **Free Key** | OpenRouter, Google AI Studio |
| **BYO API** | Groq, Cerebras, Cloudflare, Cohere, HuggingFace, Together, SambaNova, Scaleway |
| **Premium** | OpenAI, Anthropic, Google, xAI, DeepSeek, Mistral |

### Auto-Discovered (continuously scanned)
Scans 10 GitHub repos + HuggingFace + 17 known free endpoints every 1800s.

## Model Aliases

```bash
gpt4 → gpt-4o
claude → claude-opus-4-5-latest
gemini → gemini-2.0-flash
deepseek → deepseek-chat
llama → llama-3.3-70b-versatile
# See /v1/models for full list
```

## Files

```
src/python/
├── jeumpa.py              # Main server (aiohttp, :3456)
├── router.py              # Routing (5 strategies) + all endpoint handlers + Aceh middleware
├── auth.py                # JWT + email:password + API key auth
├── rate_limit.py          # 4-tier rate limiter
├── models.py              # SQLAlchemy ORM (15 tables)
├── task_router.py         # Task-based routing (10 profiles)
├── memory.py              # Conversation + shared memory
├── aceh.py                # Acehnese language: detect, lookup, translate, enrich
├── sandbox.py             # Code sandbox
├── rag.py                 # RAG engine (document ingestion + search)
├── circuit_breaker.py     # 4-state circuit breaker
├── cost_estimator.py      # Model pricing + token estimation
├── request_logger.py      # In-memory request log (2000 entries)
├── a2a_protocol.py        # Google A2A Protocol
├── marketplace.py         # Agent package marketplace
├── orchestration.py       # Graph-based workflow engine
├── orchestration_agent.py # Workflow agent manager
├── graph_kb.py            # Knowledge graph (SQLite)
├── multimodal.py          # Multi-modal content blocks
├── observability.py       # Distributed tracing
├── analytics.py           # Analytics dashboard
├── anthropic_compat.py    # Anthropic API format conversion
├── tool_framework.py      # OpenAI function calling framework
├── func_calling_agent.py  # Agent with function calling
├── model_sync.py          # Model sync manager
├── provider_manager.py    # Provider health + ranking
├── mcp.py                 # MCP JSON-RPC
├── mcp_sse.py             # MCP over SSE
├── donate.py              # Donation system
├── santri.py              # Santri program
├── billing.py             # Stripe billing
├── jeumpa_paths.py        # Auto path detection
├── jeumpa_tunnel.py       # Auto tunnel detection
├── DEWAN-AGEN-100.md      # Council of 100 Agents
└── providers/             # 12 modules: registry, base, openai_compat, gemini, etc.

app/
├── index.html             # PWA dashboard shell
├── style.css              # Dark/light theme
├── app.js                 # SPA (10 pages)
├── api.js                 # API fetch layer
├── sw.js                  # Service Worker
└── manifest.json          # PWA manifest
```

## Architecture

```
                     ┌──────────────────────────────────┐
                     │          Client / PWA             │
                     │     (app/ — 10-page dashboard)    │
                     └──────────────┬───────────────────┘
                                    │ HTTP / SSE
                     ┌──────────────▼───────────────────┐
                     │     jeumpa.py (aiohttp :3456)     │
                     │                                   │
                     │  ┌─ rate_limit → auth → router ─┐ │
                     │  │  Provider System              │ │
                     │  │  Circuit Breaker  Registry    │ │
                     │  │  Model Sync      Monitor      │ │
                     │  │  Intelligence    Ranking      │ │
                     │  └──────────────────────────────┘ │
                     │                                   │
                     │  Agent  Orchestration  RAG  Graph │
                     │  A2A   Marketplace    MCP  Tracing│
                     └───────────────────────────────────┘
```

See `ARCHITECTURE.md` for complete system map.

## Project Status

**Current:** v2.1 — All v1 features ported. Production running with 47+ providers, 85+ models, 10 task profiles, 70+ API endpoints, 34 Python modules, 15 autonomous systems.

## License

MIT — Dhaher Labs
*JeumpaLLM — Dhaher Labs ecosystem. AGI → ASI.*
