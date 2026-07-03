# jeumpallm — Canonical Repo

**v2.6** — Triangle mode, SO_REUSEPORT failover, auto-path clean, config auto-merge.

## Remotes
| Platform | URL |
|----------|-----|
| GitLab (origin) | https://gitlab.com/mulkymalikuldhr/jeumpallm |
| GitHub | https://github.com/mulkymalikuldhaher/jeumpallm |
| Codeberg | https://codeberg.org/Dhaher-Labs/jeumpallm |

## Key Architecture (Python v2.6)
- **Entrypoint:** `jeumpa` — CLI (shebang di root) & `python3 -m cli` dari `src/python/`
- **Server:** `src/python/jeumpa.py` — aiohttp on `:3456` (supports `JEUMAPPA_REUSE_PORT=1` for multi-instance)
- **Config:** `config.yaml` — providers auto-merged by discovery; interval 60s
- **Service:** `start.sh` — `./start.sh {start|stop|status|logs|backup|triangle}`
- **Triangle Mode:** `start.sh triangle` — 2 instances on same port (SO_REUSEPORT), kernel load-balanced, zero-downtime if one crashes. Fallback via `start2.py`
- **Auto-path:** All paths via `src/python/jeumpa_paths.py` — `get_data_root()`, `get_home()`, etc. No hardcoded `/sdcard` paths anywhere in active code
- **Auth:** `x-api-key: email:password` (no JWT)
- **Env:** `JEUMAPPA_*` (`.env.example`)
- **PWA:** `app/` — vanilla JS, file:// compatible, 20 pages
- **CLI:** `jeumpa chat|models list|models search|providers list|providers probe|server|voice|help`
- **Aceh module:** 5 endpoints, Google Translate free + kata.web.id
- **Agent:** sandboxed command allowlist (30 safe commands + temp dir)
- **Discovery:** every 60s, 5+ sources, auto-probe → auto-integrate → auto-save to `discovered_providers.json` + merge to `config.yaml`. Dead providers auto-pruned after 5+ consecutive failures

## History
```
ProxyGateLLM (Node.js) → archive/proxygatellm/
JeumpaLLM v1.0 (Node.js) → docs/ref-nodejs/ (reference only)
JeumpaLLM v2.0-2.5 (Python) → current
```

## Quick Start
```bash
./jeumpa help                 # CLI help
./jeumpa models list           # List all providers (config + discovered)
./jeumpa server start          # Start server on :3456
./start.sh triangle            # Start 2 instances (zero-downtime)
./start.sh status              # Health + tunnel + instances
python3 -m cli chat            # Interactive chat (dari src/python/)
```

## Code Stats
- 54 Python modules, ~13K lines
- Providers: configured + auto-discovered (merged to config.yaml)
- 31 base routes + ~50 more on startup
- 3 bugs squashed: command injection, PEP 585, WorkflowRegistry create_graph

## REALIZATION MANDATE

This repository is part of the **DHAHER LABS** autonomous ecosystem.
It is a REAL production system — not a simulation, not a toy, not a placeholder.

See the [Autonomous-Organism Manifesto](https://dhaherlabsos.vercel.app/manifesto) for the full declaration.
See [System Status](https://dhaherlabsos.vercel.app/status) for live health checks.

---

