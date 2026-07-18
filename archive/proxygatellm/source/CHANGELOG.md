# Changelog

All notable changes to Jeumpa LLM (formerly ProxyGateLLM) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-06-19

### Added — TRANSFORMATION: ProxyGateLLM → Jeumpa LLM
- **Rebrand** — Jeumpa LLM is now Jeumpa LLM v1.0.0, an AI Operating Layer
- **SQLite Database Layer** — `src/db.js` with 6 tables (users, api_keys, usage_logs, rate_limits, sessions) using sql.js (pure JS SQLite, works everywhere)
- **Multi-Tenant Authentication** — `middleware.js` rewrite: SQLite-backed API key lookup, per-key persistent rate limiting with sliding windows, usage logging after every response
- **User Management** — `routes/auth.js` with 7 endpoints: user registration, login, API key CRUD, usage statistics, admin dashboard
- **RAG Engine** — `src/rag.js` + `routes/rag.js`: TF-IDF cosine similarity, chunked document ingestion, query with scoring, document CRUD
- **Provider Health Monitoring** — Fragile provider (G4F, Blackbox, Phind) health check loop every 5 minutes, `X-Provider-Stability: unstable` header in responses
- **Security** — npm audit: 18 vulnerabilities fixed → 0. Env var override for test database paths
- **Testing** — 108 tests, 0 failures across 8 test suites: db, auth routes, middleware, router, circuit breaker, cost estimator, RAG
- **Session Management** — SQLite session table with automatic cleanup
- **Version Info Endpoint** — `GET /v1` returns API metadata and endpoint listing

## [6.0.0] - 2026-06-10

### Added — MAJOR UPGRADE (OmniRoute-Inspired)
- **Circuit Breaker** — 4-state model (CLOSED → DEGRADED → OPEN → HALF_OPEN) with failure-kind-aware thresholds, adaptive backoff, and per-provider state tracking. Inspired by OmniRoute's 3-layer resilience system.
- **Cost Estimation** — Pre-flight cost estimation for 30+ models with pricing data, free provider detection, CJK-aware token estimation, and formatted cost display.
- **5 New Free Providers** (no API key, no signup):
  - **LLM7.io** — OpenAI-compatible API, 30+ models, streaming, zero friction
  - **DeepAI** — Free chat mode, no login required
  - **FreeGPT** — Free GPT-4/GPT-4o access
  - **Api.airforce** — 55+ free models, OpenAI-compatible
  - **Venice.ai** — Privacy-focused AI, Llama/DeepSeek/Qwen/Gemma
- **Provider Categories** — FREE_NOAUTH, FREE_KEY, BYOAPI, WEB_COOKIE classification system
- **New API Endpoints**:
  - `GET /providers/free` — List free providers only
  - `GET /circuit-breakers` — Circuit breaker status for all providers
  - `POST /v1/cost-estimate` — Pre-flight cost estimation
- **Enhanced Provider Manager** — Circuit breaker integration, error classification (rate_limit, quota_exhausted, auth_failure, timeout, server_error, network_error), cost-aware routing
- **Routing Strategies Configuration** — Priority, round-robin, least-latency, random, cost-optimized
- **Attribution** — OmniRoute-inspired circuit breaker and provider categorization patterns

### Changed
- **Version bump** — 5.1.0 → 6.0.0
- **Provider count** — 17 → 22 providers
- **Free providers** — Now 10 truly free (no API key) providers
- **Model count** — 430+ → 473+ models (with free model sync)
- **Dashboard** — Updated to v6.0 branding
- **Provider Manager** — Now uses circuit breaker for failover decisions
- **Request flow** — Added cost estimation metadata to all responses

### Fixed
- **6 missing providers** in config — Together, SambaNova, Scaleway, Inference.net now properly configured
- **Version mismatch** — All version references now consistent at 6.0.0
- **Streaming timeout** — Circuit breaker prevents indefinite hangs on failed providers
- **Error classification** — Errors properly categorized for intelligent retry decisions

---

## [5.1.0] - 2026-06-09

### Added
- **4 New Providers** — 13 → 17 total providers!
  - **Together AI** — $25 free credits, 80+ free models, fastest ChatGPT alternative
  - **SambaNova Cloud** — $5 free credits, DeepSeek-V3.1, Llama-4 Maverick, MiniMax M2.7
  - **Scaleway Gen APIs** — EU-hosted, 1M free tokens, Mistral Medium 3.5, Gemma 4
  - **Inference.net** — $10 free credits, DeepSeek R1, specialized models like Schematron
- **Model aliases** — new shortcuts: `qwen`, `deepseek-v3`, `deepseek-r1`, `nemotron`, `gemma4`, `together-llama`, `samba-deepseek`, `samba-minimax`
- **Auto-fetch models** — Together, SambaNova, and Inference.net support dynamic model listing

### Changed
- **Version bump** — 5.0.0 → 5.1.0
- **Provider count** — Updated all docs from 13 to 17 providers
- **Model count** — Now supporting 430+ models across all providers

## [5.0.0] - 2026-06-08

### Added
- **Model Comparison Tool** — Send same prompt to multiple models, compare side-by-side
- **Usage Analytics Dashboard** — Request tracking, latency metrics, model distribution charts
- **Custom Domain Setup Wizard** — Interactive domain configuration with code examples
- **Request Logging** — In-memory request log with `/logs` endpoint
- **New Dashboard Pages** — Compare, Analytics, Custom Domain pages added

### Changed
- **Version bump** — 4.0.0 → 5.0.0
- **CORS default** — Set to `*` for broader compatibility
- **Logging level** — Configurable via `LOG_LEVEL` env var (info/debug)

### Fixed
- **Groq model IDs** — Updated from decommissioned `llama-3.1-70b-versatile` to `llama-3.3-70b-versatile`
- **Model alias** — `llama` alias now maps to `llama-3.3-70b-versatile`

### Removed
- **jsdom dependency** — Removed unnecessary 20K+ line DOM parser (was only used by DuckDuckGo provider)

### Security
- Added request logging for audit trail
- CORS configuration now documented
- Rate limiting per-IP maintained

---

## [4.0.0] - 2026-06-07

### Added
- Multi-provider system with auto-failover
- Provider health monitoring
- MCP (Model Context Protocol) server
- AI Agent built-in
- Smart auto-routing (code, planning, reasoning, fast)
- PWA dashboard with dark/light theme
- Streaming support (SSE)
- Anthropic-compatible API
- 13 providers, 378+ models

### Changed
- Complete rewrite from v3.x
- New provider architecture
- Dashboard rebuilt as single-page app

---

## [3.0.0] - 2026-06-06

### Added
- Initial multi-provider support
- Basic dashboard
- OpenAI-compatible API

### Changed
- Migrated from jsputer-proxy to Jeumpa LLM

---

## [2.0.0] - 2026-06-05

### Added
- Proxy server functionality
- Basic model routing

---

## [1.0.0] - 2026-06-04

### Added
- Initial release
- Basic proxy functionality
