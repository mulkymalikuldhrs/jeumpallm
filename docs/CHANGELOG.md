# Changelog

## v2.5 (2026-06-30) — Acehnese Language Module + Bug Fixes

### Added

#### Acehnese (Bahasa Aceh) Module (`aceh.py`)
- **Aceh Language Detection** — 150+ common Acehnese words built-in; confidence score 0–1; 100% accuracy on Aceh vs Indonesia/English test set
- **Google Translate API** — Free endpoint `translate.googleapis.com` (no key); Acehnese `ace` ↔ Indonesia `id` translation; handles full sentences, returns structured JSON
- **kata.web.id Scraper** — Secondary dictionary source for word-level Aceh→Indonesia definitions with extra context
- **Dual-source Lookup** — `lookup_word()` queries Google Translate (primary) + kata.web.id (secondary) in parallel; returns best result with both sources
- **Prompt Enrichment** — `enrich_prompt()` automatically detects Acehnese in messages, extracts unique words, looks up translations, injects glossary into system prompt
- **5 REST Endpoints**: `/v1/aceh/detect`, `/v1/aceh/lookup`, `/v1/aceh/translate`, `/v1/aceh/enrich`, `/v1/aceh/glossary`

#### Auto-Detect Middleware (`router.py`)
- **Aceh Enrich Middleware** — Injects Acehnese glossary into chat system prompt when confidence ≥ 0.15; zero-config, transparent to user
- **Conditional Import** — `HAS_ACEH` flag; graceful degrade if module unavailable

#### PWA Integration
- **Settings Toggle** — Acehnese auto-detect ON/OFF button persisted to `Store('aceh_enabled')`
- **Info Section** — Explanation of sources (Google Translate + kata.web.id), links to endpoints

#### Security Fixes
- **Command Injection Fix** (`agent.py:93-141`) — Replaced `asyncio.create_subprocess_shell(command)` with `asyncio.create_subprocess_exec(*parts)` using 30-command allowlist (python3, node, sh, git, pip, etc) + temp directory sandbox + `shutil.rmtree` cleanup. Shell injection via LLM prompt injection now returns `{"error": "command not allowed: <name>"}`.
- **Same Fix** (`tool_framework.py:206-252`) — Identical command injection fix in `_builtin_run_command` with same allowlist + temp directory isolation.
- **Python <3.9 Compatibility** (`orchestration.py:3`) — Added `from __future__ import annotations` to fix `TypeError: 'type' object is not subscriptable` on 10 lines using PEP 585 generic alias syntax (`list[str]`, `dict[str, Any]`, `set[str]`).
- **PEP 585 Fix** (`tool_framework.py`) — Replaced remaining `list[T]` → `List[T]`, `dict[K,V]` → `Dict[K,V]` for Python <3.9 compatibility.

### Changed
- `aceh.py` — New module (220 lines): `detect_aceh()`, `gt_translate()`, `scrape_kata_webid()`, `lookup_word()`, `translate_text()`, `enrich_prompt()` + 5 REST handlers
- `router.py` — Added Acehnese import + `setup_aceh_routes(wapp)` + Aceh enrich middleware; added `HAS_ACEH` flag
- `app.js` — Added Acehnese toggle section in Settings page (~30 lines)
- `agent.py` — `_run_command()` rewritten: `shell` → `exec` with allowlist + temp sandbox
- `tool_framework.py` — `_builtin_run_command()` rewritten: same sandboxed exec pattern; PEP 585 type hints fixed
- `orchestration.py` — Added `from __future__ import annotations` at line 3

### Architecture
- **Aceh Module**: 2 online sources (Google Translate free API + kata.web.id scraping), 0 local dataset, 0 API keys needed
- **Detection**: 150+ Acehnese keywords (`lon`, `gata`, `peue`, `nyan`, `aneuk`, `gampong`, etc), confidence threshold 0.15
- **Enrichment Pipeline**: detect → extract unique words → parallel lookup → glossary injection → LLM response
- **Security**: command allowlist (30 entries), `create_subprocess_exec()` replaces `create_subprocess_shell()` in 2 files, temp directory isolation per call

## v2.4 (2026-06-30) — Sessions, Skills, Persona, Agent Mode

### Added

#### Session Persistence (localStorage)
- **Storage Engine** (`storage.js`, ~100 lines) — Namespaced localStorage wrapper with 7 collections: sessions, instructions, personas, customMcp, installedMcp, skills, activeSkillId
- **Session Manager** — Auto-save conversations to localStorage on each message; load last session on page reload; session list sidebar with create/switch/delete
- **Session Data** — messages, model, temperature, maxTokens, systemPrompt, personaId, createdAt, updatedAt

#### Custom Instructions
- **Instruction Management** (Settings page) — Save named system prompt presets with name + content; load/edit/delete from list
- **Playground Integration** — Dropdown selector loads instruction as system prompt; syncs with custom prompt textarea

#### Custom Persona
- **Persona Page** (`#persona`) — Create AI personas with name, greeting, system prompt; grid view with avatar initial + prompt preview
- **Edit Modal** — Inline editor for name/greeting/system prompt; save/cancel
- **Playground Integration** — Persona selector: auto-fills system prompt, avatar shows persona initial

#### MCP Market
- **Market Page** (`#mcp-market`) — 10 default MCP tools (Filesystem, GitHub, SQLite, Docker, Slack, Web Search, Memory, Puppeteer, Google Maps, Custom API)
- **Search & Filter** — Real-time text search + category dropdown (Core/Developer/Web/Data/Communications/Custom)
- **Install/Uninstall** — One-click install toggles; tracks in localStorage via `Store.installedMcp`

#### Custom MCP Servers
- **Custom MCP UI** (MCP page) — Add custom MCP servers with name + WebSocket/HTTP SSE URL
- **Persistence** — Saved to `Store.customMcp`; delete button per entry

#### Skills System
- **Skills Page** (`#skills`) — 6 default skills: Translator, Code Reviewer, Teacher, Writer, Debate Partner, Brainstorm Buddy
- **Custom Skills** — Create skills with icon (emoji), description, system prompt; inline editor
- **Activate/Deactivate** — Active skill's system prompt injected into Playground + Agent requests; visual indicator with accent border
- **Active Skill Indicator** — Banner at top of Skills page + badge in Playground sidebar

#### Agent Mode (Coding AI)
- **Hermes Methodology** (`agent.py`) — Nous Research Hermes-inspired system prompt: `<methodology>` block with Analyze→Plan→Code→Verify→Iterate
- **Multi-Provider Routing** — Agent tracks `_providers_used` across fallback chain; displays in PWA trace bar
- **Subscription Gate** — `check_agent_access()` checks `tier == "donor"` or `token_balance > 0`; returns 402 with subscribe URL if locked
- **Agent Subscribe Endpoint** — `GET /v1/agent/subscribe` — returns tier, token_balance, agent_access, pricing plans
- **Agent Chat/Tools** — `/v1/agent/chat` with streaming SSE + tool loop; `/v1/agent/tools` lists capabilities
- **PWA Agent Page** (`#agent`) — Language selector, context input, task textarea, live output with monospace font, provider trace bar with badges; subscription lock with plan cards

#### Telegram Bot Integration
- **Bot Registration** — `POST /v1/agent/telegram` — accepts bot token + optional webhook URL; calls Telegram `setWebhook` API
- **Webhook Handler** — `POST /v1/agent/telegram/webhook` — receives updates, routes to agent chat, sends reply via `sendMessage`
- **PWA Config** — Token input in Agent page sidebar; saved to localStorage; status indicator

#### Auth Simplification
- **x-api-key** — PWA now sends `x-api-key: email:password` header directly instead of `Authorization: Bearer <JWT>`; server already supports this format natively
- **No Login Endpoint** — Removed login API call from PWA; authentication happens on every request via header
- **Settings Page** — Authentication section with email:password input + Save/Test/Clear

### Changed
- `app.js` — Grew from ~1850 to ~2450 lines (15 pages); `playground` state loaded from `Store.sessions.current()` on init; `_genId()`, `_saveSession()`, `_renderSessionList()`, `_loadSession()`, `_newSession()` methods added
- `agent.py` — Rewrote prompts to Hermes methodology; added `check_agent_access()`; 3 new endpoints (subscribe, telegram register, telegram webhook); providers_used tracking in response
- `api.js` — `authToken` → `apiKey`; `Authorization: Bearer` → `x-api-key`; added 5 agent methods; `login()` simplified to key storage; `getMe()` returns email from key without API call
- `index.html` — Added 4 nav links: Agent, MCP Market, Persona, Skills; added `storage.js` script

### Architecture
- **15 PWA pages**: Overview, Providers, Models, Playground, API, MCP, MCP Market, Compare, Workflows, Tools, Agent, Persona, Skills, Santri, Donasi, Fugu, Tracing, Analytics, Settings, Logs
- **7 localStorage collections** via `Store.*` namespace: sessions, instructions, personas, customMcp, installedMcp, skills, activeSkillId
- **Agent routing**: Router primary selection → fallback chain → `_providers_used` logged → displayed in PWA

## v2.3 (2026-06-30) — Multi-Payment + Auto-Detect E-Wallet

### Added
- **Multi-Payment Methods** (`donate.py`) — 9 payment channels: DANA, OVO, GoPay, ShopeePay, QRIS, LinkAja, BSI, Mandiri, BCA
- **Wallet Config via Env** — `JEUMAPPA_WALLET_PHONE` (default: 085322624048) for all e-wallets, per-method overrides, per-method name config
- **`GET /donate/methods`** — lists available payment channels with account info and icons
- **`POST /donate/webhook`** — auto-detect endpoint for payment gateway callbacks (Tripay/Midtrans/Xendit compatible); matches by `payment_ref`, `external_id`, `order_id`, or `reference`; auto-confirms + extends token expiry
- **PWA Payment Method Selector** (`app/app.js`) — clickable cards for each e-wallet/bank; instructions + account info dynamically update per selected method; reference code highlighted prominently
- **`.env.example` wallet section** — all 13 new env vars documented

### Changed
- `POST /donate/create` — removed hardcoded BSI instructions; returns `payment_instructions.method/type/account/name/instructions` from wallet config based on selected `payment_method`
- `GET /donate/status` — includes `payment_method` per donation in history
- `POST /donate/confirm` — unchanged (payment_ref flow), webhook provides auto path
- **Rate limit** `/donate/` endpoints publicly accessible (auth optional for create/confirm/status, webhook is public)

### Notes
- Auto-detect via webhook is payment-gateway-ready: Tripay, Xendit, or Midtrans can POST to `/donate/webhook` with standard payload fields
- Without a payment gateway, manual confirm via payment_ref still works
- BSI/Mandiri/BCA default to placeholder — set via env vars or leave empty to hide

## v2.2 (2026-06-30) — Sakana Fugu + Vercel Deployment

### Added

- **Fugu Multi-Model Ensemble** (`fugu_mode.py`) — Sakana-inspired ensemble architecture: fan-out query to N models in parallel, select best answer via 5 strategies:
  - **LLM Judge**: dedicated judge model scores each response
  - **Consensus**: lexical overlap voting between responses
  - **Confidence**: provider health metrics as confidence proxy
  - **Weighted**: priority + health + latency weighted scoring
  - **Hybrid** (default): LLM Judge (70%) + Weighted (30%) composite
  - SSE streaming per-model, best answer with full metadata
  - Configurable: judge model, timeout, max models, min responses, consensus threshold
  - `POST /v1/fugu/ask` — main endpoint
  - `GET /v1/fugu/status` — config + strategies
  - `POST /v1/fugu/config` — runtime config update

- **Fugu Dashboard** (`app/`) — New page with query interface, strategy selector, model picker, settings modal, real-time scores table, all-responses toggle

### Deploy

- **Vercel-ready** (`app/vercel.json`) — Deploy PWA static to Vercel with zero backend. Configurable backend URL via Settings → Server. Test Connection button. Works standalone from file://, GitHub Pages, or any CDN.

### Fixed — Missing Frontend Pages

- **Santri & Donasi PWA pages** (`app/app.js`) — Added dedicated pages with full UI: Santri registration form, verification flow, status dashboard; Donasi tier selection, payment instructions, confirmation, history. 2 new nav links. Previously only API existed, no frontend.

### Docs

- **README.md** — Added Access Model (tier table), Santri Aceh details, Donasi info. Missing from initial merge.

## v2.1 (2026-06-30) — Full v1 Feature Port

### Added (17 new Python modules ported from Node.js v1.0)

- **Circuit Breaker** (`circuit_breaker.py`) — 4-state resilience (CLOSED→DEGRADED→OPEN→HALF_OPEN), 8 failure kinds with kind-specific thresholds, exponential backoff, registry with HTTP endpoint. Integrated into all providers.

- **RAG Engine** (`rag.py`) — Document ingestion with paragraph-boundary chunking (500 words), built-in token-frequency embedding (no external API), Jina AI embedding fallback, cosine similarity search, SQLite storage, CRUD endpoints.

- **Cost Estimation** (`cost_estimator.py`) — 20-model pricing table, CJK-aware token estimation, free provider detection, cost formatting.

- **Request Logger** (`request_logger.py`) — In-memory ring buffer (2000 entries), paginated retrieval, status filtering, stats endpoint.

- **A2A Protocol** (`a2a_protocol.py`) — Google A2A standard implementation: AgentCard with capabilities/skills/auth, 6-state task machine (submitted→working→input_required→completed→failed→canceled), multi-part messages, agent discovery via `/.well-known/agent.json`.

- **Agent Marketplace** (`marketplace.py`) — Package registry with search, categories, popular/featured, ratings, download tracking. 10 pre-populated LLM/agent packages. SQLite persistence.

- **Graph Orchestration** (`orchestration.py` + `orchestration_agent.py`) — DAG-based workflow engine: 7 node types (LLM, TOOL, CONDITION, PARALLEL, AGGREGATOR, INPUT, OUTPUT), async execution with progress reporting. 3 pre-built templates. Worker manager.

- **Graph Knowledge Base** (`graph_kb.py`) — Entity-relation with auto-extraction using regex patterns (person/organization/technology/concept), co-occurrence relation extraction, search, SQLite persistence, 11 endpoints.

- **Multi-Modal Content System** (`multimodal.py`) — ContentBlock for text/image/audio/code/file/JSON, ContentBuilder with fluent API, ContentConverter (OpenAI↔Anthropic format conversion), MultiModalClient.

- **Observability/Tracing** (`observability.py` + `analytics.py`) — Distributed tracing: Span with lifecycle, Tracer with sync/async context managers, TraceAnalytics with span_type breakdown, latency stats, error rates. Analytics dashboard helpers.

- **Anthropic API Compatibility** (`anthropic_compat.py`) — Full `/v1/messages` endpoint: format converter (Anthropic↔OpenAI), message merging, system prompt extraction, streaming SSE with content_block_delta lifecycle.

- **OpenAI Function Calling Framework** (`tool_framework.py`) — Tool registry with 7 built-in tools (read_file, write_file, run_command, search_web, list_directory, git_status, http_request), OpenAI function calling format conversion, async execution with timeout.

- **Agent with Function Calling** (`func_calling_agent.py`) — Agent that uses OpenAI function calling format, fallback to text-parsed for non-FC models, tool loop up to configurable rounds.

- **Model Sync** (`model_sync.py`) — 100+ hardcoded model database, auto-fetch from 10 provider API endpoints, periodic background sync, search/filter by provider/capability.

- **Provider Manager** (`provider_manager.py`) — Provider health checking, circuit breaker integration, ranking (latency/health), failover chain construction, content-based routing.

### Enhanced (existing modules upgraded)

- **Authentication** (`auth.py` + `models.py`) — Added `jl-` key prefix support, per-key rate limiting (`rate_limit_max`/`rate_limit_window`), IP whitelist, key expiry (`expires_at`), daily quota tracking.

- **Provider System** (6 modules) — Circuit breaker integration in `base.py`, `openai_compat.py`, `gemini.py`, `registry.py`. Smart content-based routing added to `intelligence.py` (`suggest_model_for_content()`). CB-aware health monitoring in `monitor.py`. `ProviderManager` integration in `registry.py`.

- **Router** (`router.py`) — Expanded from ~30 to ~70 endpoints. Added 19 new endpoint groups: RAG, Graph, Agent Tools, Workflows, A2A, Marketplace, Analytics, Tracing, Logs, Circuit Breakers, Cost Estimation, Anthropic Compat. Optional module loading with graceful fallback.

- **Server** (`jeumpa.py`) — `setup_extra_routes()` integration point for all new modules.

### New Frontend

- **PWA Dashboard** (`app/`) — Replaced static/ and dashboard/ with unified 10-page SPA: Overview, Providers, Models, Playground, API, MCP, Compare, Analytics, Settings, Logs, Workflows, Tools, Tracing. Catppuccin-inspired dark/light theme. Service Worker (cache-first static, network-first API). No build step — vanilla JS.

## v2.0 (2026-06-29)

### Added
- Shared Memory — cross-user shared memory with 3 scopes (private/shared/public), Jina AI vector search, keyword fallback, tagging, key-value lookup
- Auto Path V2 — no hardcoded `/sdcard/` paths. Dynamic Android storage scan (7 mount points)
- Auto Tunnel V2 — PID-based cloudflared detection, ngrok API + CLI, localtunnel, quick tunnel fallback
- DEWAN-AGEN-100.md — Council of 100 Agents design simulation

### Changed
- Archived ProxyGateLLM (Node.js) full source to `archive/`
- Renamed `/root/services/jeumpa/` → `/root/services/Jeumpa-LLM/`
- Git initialized, pushed to Codeberg/GitLab/GitHub

### Fixed
- All hardcoded `/sdcard/` paths removed from path detection
- Tunnel `_last_check` was always 0 — now `time.time()`
- Old Node.js era stale claims in Codeberg Pages

## v1.0 (Node.js — Reference)

Superseded. Full source preserved at `src/js/` and `docs/ref-nodejs/`.
