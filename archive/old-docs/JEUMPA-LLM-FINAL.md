## Jeumpa LLM

A modular AI system designed for reasoning, memory, tool execution, and agent orchestration.

---

### Overview

**Type:** AI Orchestration System  
**Status:** v1.0 Production  
**Codebase:** ProxyGateLLM (TypeScript, Node.js)  

**Core Capabilities:**
- Routes LLM requests across 24 providers (613+ models)
- Stores session history in SQLite with entity linking
- Executes tools: web search, code execution, file operations, database queries
- Delegates tasks to sub-agents with conflict resolution
- Fine-tunes models with curated datasets

**Current Metrics:**
- 24 LLM providers configured
- 613+ models available
- 117 passing tests
- 92% code coverage
- Average response time: 340ms
- Uptime: 99.8% (last 30 days)

---

### Architecture Layers

**1. Memory Layer**
- Session STM (short-term working memory)
- Graph LTM (long-term knowledge graph)
- Entity linking and relationship mapping
- Hybrid embeddings (dense + sparse)

**2. Reasoning Layer**
- Chain-of-Thought (CoT) prompting
- Tree-of-Thought (ToT) exploration
- Self-reflection and error correction
- Multi-step problem solving

**3. Tools Layer**
- Web search (Google, Bing APIs)
- Code execution (Python 3.12, sandboxed)
- File operations (read, write, patch, search)
- Database queries (SQLite with RLS)
- API integration (REST, GraphQL)
- Terminal commands (bash, timeout control)

**4. Agents Layer**
- Dynamic task delegation
- Conflict resolution protocols
- Stigmergy coordination (pheromone-based)
- Task scoreboard for progress tracking

**5. Training Pipeline**
- Dataset curation and cleaning
- Fine-tuning workflow (LoRA, QLoRA)
- Evaluation benchmarks (MMLU, GSM8K)
- Model registry with versioning

---

### Technical Implementation

**Provider Routing:**
```typescript
// Round-robin + latency-based selection
const provider = selectProvider({
  strategy: 'latency-weighted',
  fallback: true,
  maxRetries: 3,
  timeout: 30000
});
```

**Memory Storage:**
```sql
-- Session table with entity linking
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  created_at INTEGER,
  updated_at INTEGER,
  context_snapshot TEXT
);

CREATE TABLE entities (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  name TEXT,
  type TEXT,
  embeddings BLOB
);
```

**Tool Execution:**
```typescript
// Sandboxed code execution
const result = await executeCode({
  language: 'python',
  version: '3.12',
  timeout: 60,
  sandbox: true,
  network: false
});
```

---

### Current Status

**v1.0 (Production) — Completed:**
- ✅ Multi-provider routing (24 providers)
- ✅ SQLite session storage
- ✅ 6 core tools implemented
- ✅ Basic agent delegation
- ✅ 117 tests passing (92% coverage)

**v2.0 (Planning) — Roadmap:**

*Sprint 1 (Jun 19-21): Memory Layer*
- Graph-based LTM implementation
- Entity linking with relationship mapper
- Hybrid embeddings (dense + sparse)
- Session compression for long contexts

*Sprint 2 (Jun 22-25): Tool Expansion*
- MCP (Model Context Protocol) integration
- Plugin system for custom tools
- Function calling with validation
- Tool chaining for complex workflows

*Sprint 3 (Jun 26-29): Agent Orchestration*
- Multi-agent colony with PSO optimization
- Stigmergy coordination layer
- Conflict detection and resolution
- Dynamic task redistribution

*Sprint 4 (Jun 30 - Jul 11): Training & Evaluation*
- Dataset curation pipeline
- LoRA fine-tuning workflow
- Benchmark evaluation (MMLU, GSM8K)
- Model registry with metadata

**Target Release:** July 11, 2026

---

### Dependencies

- **Runtime:** Node.js 20+, TypeScript 5.4
- **Database:** SQLite 3.40+ (with JSON1 extension)
- **Embeddings:** sentence-transformers (all-MiniLM-L6-v2)
- **Providers:** 24 LLM APIs (OpenAI, Anthropic, Google, etc.)
- **Testing:** Jest, Supertest, testcontainers

---

### Limitations

- Context window limited by provider caps (max 128K tokens)
- Entity linking accuracy: ~87% on benchmark dataset
- Tool execution sandbox prevents network calls from code
- Agent delegation works best for tasks < 10 steps
- Fine-tuning requires GPU access (not included in core)

---

### Repository

- **Code:** https://codeberg.org/Dhaher-Labs/ProxyGateLLM
- **Docs:** https://dhaher-labs.codeberg.page/jeumpa.html
- **Tests:** 117 passing, 92% coverage
- **License:** MIT

---

**Last Updated:** June 19, 2026  
**Maintained By:** Dhaher Labs