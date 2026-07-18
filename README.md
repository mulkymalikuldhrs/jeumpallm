> **DHAHER LABS — REALIZATION MANDATE**
> This is a REAL production system in the DHAHER LABS autonomous ecosystem.
> Not a simulation. Not a toy. Not a placeholder.
> Every component serves the autonomous organism.

# Jeumpa LLM

Free LLM Provider Gateway — round-robin routing across 30+ free providers, latency optimization, and a native **Bahasa Aceh** local-language module (detection, translation, glossary enrichment).

## Repository Layout (IMPORTANT)

This repository has **two git layers**:

| Layer | Path | Role |
|-------|------|------|
| Meta repo (this dir) | `.` | Top-level docs, mandate, CI. Tracks only root-level files. |
| **Canonical code repo** | `jeumpallm/` | The real JeumpaLLM v2.6 service (Python + JS). It is its own git repo nested here. |

> The working code lives in `jeumpallm/`. Open that directory to build, run, or contribute.
> `jeumpallm/` is NOT a git submodule — it is a standalone repo with its own history and remotes.

## Status
- **Type:** Backend gateway service (aiohttp, `:3456`)
- **Ecosystem:** DHAHER LABS
- **Code version:** v2.6 (Triangle mode, SO_REUSEPORT failover, auto-path clean, config auto-merge)
- **Status:** 🟡 Active — TIM consolidating meta + code layers, Aceh module hardened

## What JeumpaLLM actually is
JeumpaLLM is a **provider gateway**, not a trained weights model. It routes prompts to 30+ free LLM providers (Pollinations, DeepAI, Groq, etc.) with circuit-breakers and latency-based round-robin. The "local Aceh/Indonesia" capability is implemented as a **language module** (`jeumpallm/src/python/aceh.py`): it detects Bahasa Aceh, translates via free endpoints, and enriches prompts with a glossary so downstream providers answer correctly.

## Quick Start (real code)
```bash
cd jeumpallm
./jeumpa help                 # CLI help
./jeumpa models list          # List all providers (config + discovered)
./jeumpa server start         # Start server on :3456
./start.sh triangle           # Start 2 instances (zero-downtime, SO_REUSEPORT)
python -m pytest tests/test_aceh.py   # run Aceh module tests
```

## Remotes
| Platform | Role | URL |
|----------|------|-----|
| GitHub | primary push target | https://github.com/mulkymalikuldhaher/jeumpallm |
| GitLab | mirror | https://gitlab.com/mulkymalikuldhr/jeumpallm |
| Codeberg | canonical mirror (code repo origin) | https://codeberg.org/Dhaher-Labs/jeumpallm |

---

## 🌐 Dhaher Labs Ecosystem

Part of the [Dhaher Labs](https://dhaher-labs.codeberg.page) ecosystem — 30+ repos for autonomous AI life.

| Resource | Link |
|----------|------|
| Ecosystem Home | https://dhaher-labs.codeberg.page |
| GitHub Org | https://github.com/dhaher-labs |
| GitLab Profile | https://gitlab.com/mulkymalikuldhr |
| Codeberg Org | https://codeberg.org/Dhaher-Labs |
