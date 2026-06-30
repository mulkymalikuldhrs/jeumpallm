# JeumpaLLM — Unified Merge Workspace

**AI Gateway + Platform — 47+ LLM Providers, 18+ engine modules, PWA dashboard + Sakana Fugu ensemble. Deploy frontend anywhere — Vercel, GitHub Pages, or file://**

> "AI untuk Semua, Khususnya Aceh" — Dhaher Labs

Unified repository merging **Python v2.0** (active, aiohttp :3456) and **Node.js v1.0** (reference, Express :3333). All v1 engine features ported to Python.

## Quick Start

```bash
./start.sh start        # Python server on :3456
./start.sh stop         # Stop

# PWA dashboard: open app/index.html or deploy to Vercel:
cd app && npx vercel --prod
# Then go to Settings → Server → enter your backend URL
```

## Structure

| Path | Contents | Status |
|------|----------|--------|
| `src/python/` | Python v2.0 engine — **35 modules** | Active |
| `app/` | PWA dashboard (vanilla JS, 13 pages) | Active |
| `src/js/` | Node.js v1.0 reference code | Reference |
| `config/` | config.yaml, providers.js | Active |
| `docs/` | Python v2.0 docs + architecture | Updated |
| `docs/ref-nodejs/` | Node.js v1.0 docs | Reference |
| `scripts/` | Service scripts | Active |
| `archive/` | Historical assets | Archived |

## Ported Features (v1 → v2)

| Feature | Module | Status |
|---------|--------|--------|
| Circuit Breaker | `circuit_breaker.py` | Done |
| Cost Estimation | `cost_estimator.py` | Done |
| RAG Engine | `rag.py` | Done |
| A2A Protocol | `a2a_protocol.py` | Done |
| Agent Marketplace | `marketplace.py` | Done |
| Graph Orchestration | `orchestration.py` | Done |
| Graph Knowledge Base | `graph_kb.py` | Done |
| Multi-Modal Content | `multimodal.py` | Done |
| Observability/Tracing | `observability.py` | Done |
| Anthropic API Compat | `anthropic_compat.py` | Done |
| OpenAI Function Calling | `tool_framework.py` | Done |
| Agent with Tools | `func_calling_agent.py` | Done |
| Model Sync | `model_sync.py` | Done |
| Provider Manager | `provider_manager.py` | Done |
| Request Logger | `request_logger.py` | Done |
| Smart Content Routing | `providers/intelligence.py` | Done |
| Fugu Multi-Model Ensemble | `fugu_mode.py` | Done |
| Santri Program | `santri.py` | Done |
| Donation System | `donate.py` | Done |
| Dashboard PWA | `app/` | Done |

## Access Model

| Tier | Limit | How |
|------|-------|-----|
| **Anonymous** | 10 total requests | No login |
| **Free** | 100/day | Login via `/auth/login` |
| **Santri** | 1.000/day (1 tahun) | Verifikasi santri Aceh → `app/#santri` |
| **Donor** | Token-based (30-90 hari) | Donasi → token → `app/#donasi` |

### Santri Aceh Gratis
Santri/santriwati wilayah Aceh dapat akses gratis 1 tahun:
1. Login, buka halaman **Santri** di dashboard
2. Isi data diri + pesantren
3. Jawab pertanyaan verifikasi
4. Verifikasi otomatis jika nama pesantren cocok

### Donasi
- Minimum donasi: tidak ditentukan
- Token: 10 token per IDR (configurable via `JEUMAPPA_TOKENS_PER_UNIT`)
- Masa aktif: **30-90 hari** per donasi, makin besar donasi makin panjang
- Stacking: donasi kedua menambah masa aktif dari expiry sebelumnya, bukan dari hari ini
- Token balance tinggi → masa aktif otomatis diperpanjang
- Bank: BSI (Bank Syariah Indonesia)

See `docs/ARCHITECTURE.md` for full system map and `docs/CHANGELOG.md` for version history.

## License

MIT — Dhaher Labs
*JeumpaLLM — Dhaher Labs ecosystem. AGI → ASI.*
