# Archive — Historical JeumpaLLM & ProxyGateLLM Assets

## Structure

```
archive/
├── proxygatellm/           # Original Node.js predecessor
│   ├── source/             # Full source tree (3.6M)
│   │   ├── engine/         # MCP gateway, A2A, orchestration, marketplace, tools, observability
│   │   ├── providers/      # 22 JS provider implementations
│   │   ├── utils/          # Circuit breaker, cost estimator, provider manager
│   │   ├── config/         # Provider config + model aliases
│   │   ├── dashboard/      # Full PWA dashboard
│   │   ├── agent/          # Agent framework
│   │   ├── routes/         # Auth, RAG, context, graph endpoints
│   │   ├── src/            # DB schema + RAG engine
│   │   └── sdk/            # Client SDK
│   └── git-repo/           # Bare git repo with full 25-commit history
│
├── old-docs/               # Historical JeumpaLLM documentation
│   ├── JEUMPA-LLM-COMPLETE.md     # Complete spec (original vision)
│   ├── JEUMPA-LLM-FINAL.md        # Final v1 spec
│   ├── JEUMPA-LLM-FINAL-V2.md     # Final v2 spec
│   ├── JEUMPA-LLM-DETAIL.html     # Detailed design doc
│   ├── JEUMPA-TOOLS-MODULE.html   # Tools module design
│   └── summary-jeumpa-section.md  # Summary section
│
├── old-services/           # Predecessor service scripts
│   ├── jeumpallm.sh        # Original service manager (Node.js era)
│   ├── model-router.py     # Old Python model router
│   ├── session-bridge.py   # Old session bridge
│   └── tunnel.sh           # Old tunnel script
│
└── old-logs/               # Historical server logs (Node.js + early Python)
    ├── jeumpa-server.log   # Main server log (Node.js v1.0.0)
    └── ...                 # Various Python test logs
```

## History

- **ProxyGateLLM** (Node.js) — Original project, 22 providers, full engine suite
- **JeumpaLLM v1.0** (Node.js) — Rebranded from ProxyGateLLM, archived in git
- **JeumpaLLM v2.0** (Python) — Complete rewrite, 47+ providers, autonomous systems

## Git History

The bare git repo in `proxygatellm/git-repo/` contains 25 commits tracing the full evolution:
- 359ae41 — Complete ProxyGateLLM → JeumpaLLM rebrand + production hardening
- 5b467bd — Premium README with animated banner + CI/CD
- a4cb73b — JEUMPA LLM v1.0 -- PRODUCTION READY
- 34ce7ec — v6.0.1 production hardening

## Key Concepts from ProxyGateLLM Not Yet Ported

| Concept | File | Priority |
|---------|------|----------|
| Circuit Breaker (4-state) | `source/utils/circuit-breaker.js` | High |
| Observability (traces) | `source/engine/observability.js` | Medium |
| A2A Protocol | `source/engine/a2a-protocol.js` | Medium |
| Orchestration (DAG) | `source/engine/orchestration.js` | Medium |
| Agent Marketplace | `source/engine/marketplace.js` | Low |
| Cost Estimator | `source/utils/cost-estimator.js` | Low |
| Multimodal | `source/engine/multimodal.js` | Low |

## Constitution

Dhaher Labs Constitution: `/root/services/Jeumpa-LLM/archive/old-docs/` (referenced in original sdcard)
