# Jeumpa LLM

**A modular AI system for reasoning, memory, tool execution, and agent orchestration**

---

## Overview

**Type:** AI Orchestration System  
**Status:** v1.0 Production  
**Codebase:** ProxyGateLLM (TypeScript, Node.js)  
**Repository:** https://codeberg.org/Dhaher-Labs/ProxyGateLLM  
**Documentation:** https://dhaher-labs.codeberg.page/pages/systems/jeumpa-llm.html  

---

## Core Capabilities

Jeumpa LLM provides:

- **LLM Routing:** Routes requests across 24 providers (613+ models) with intelligent fallback
- **Memory:** Session history stored in SQLite with entity linking and relationship mapping
- **Tools:** Executes 6 core tools (web search, code execution, file ops, database queries, API calls, terminal commands)
- **Agents:** Delegates tasks to sub-agents with conflict resolution and stigmergy coordination
- **Training:** Fine-tuning workflow with dataset curation and benchmark evaluation

---

## Current Metrics

| Metric | Value |
|--------|-------|
| LLM Providers | 24 |
| Available Models | 613+ |
| Passing Tests | 117 |
| Code Coverage | 92% |
| Avg Response Time | 340ms |
| Uptime (30d) | 99.8% |

---

## Architecture Layers

### 1. Memory Layer

**Purpose:** Short-term and long-term memory with entity linking

**Components:**
- **Session STM:** Working memory for active conversations (stored in SQLite)
- **Graph LTM:** Long-term knowledge graph with entities and relationships
- **Entity Linking:** Auto-discovers and links entities across sessions
- **Hybrid Embeddings:** Dense (sentence-transformers) + sparse (BM25) for retrieval

**Implementation:**
```typescript
interface Session {
  id: string;
  messages: Message[];
  entities: Entity[];
  createdAt: number;
  compressed: boolean;
}

interface Entity {
  id: string;
  name: string;
  type: 'person' | 'project' | 'concept' | 'file' | 'code';
  relationships: Relationship[];
  embeddings: {
    dense: number[];
    sparse: Record<string, number>;
  };
}
```

**Status:** ✅ Production (v1.0)  
**v2.0 Enhancement:** Graph LTM with full entity linking (Sprint 1, Jun 19-21)

---

### 2. Reasoning Layer

**Purpose:** Multi-step problem solving with self-reflection

**Components:**
- **Chain-of-Thought (CoT):** Step-by-step reasoning with intermediate conclusions
- **Tree-of-Thought (ToT):** Explores multiple reasoning paths, selects best
- **Self-Reflection:** Error detection and correction loops
- **Multi-Step Solving:** Breaks complex problems into sequential sub-tasks

**Implementation:**
```typescript
interface ReasoningStep {
  thought: string;
  confidence: number;  // 0.0 - 1.0
  alternatives?: string[];
  selectedAlternative?: number;
}

async function chainOfThought(prompt: string): Promise<string> {
  const steps: ReasoningStep[] = [];
  let currentThought = prompt;
  
  while (!isComplete(currentThought)) {
    const step = await generateStep(currentThought);
    steps.push(step);
    currentThought = step.thought;
    
    if (step.confidence < 0.7 && step.alternatives) {
      // Trigger Tree-of-Thought exploration
      const best = await exploreAlternatives(step.alternatives);
      currentThought = best;
    }
  }
  
  return synthesize(steps);
}
```

**Status:** ✅ Production (basic CoT)  
**v2.0 Enhancement:** Full ToT + self-reflection (Sprint 1, Jun 19-21)

---

### 3. Tools Layer

**Purpose:** Execute external actions with validation and safety

**Core Tools (6):**

| Tool | Function | Example |
|------|----------|---------|
| **Web Search** | Google/Bing API, snippet extraction | `web_search("LLM routing", limit=5)` |
| **Code Execution** | Python 3.12 sandboxed, timeout control | `execute_code("print(hello)")` |
| **File Operations** | Read, write, patch, search files | `read_file("config.json")` |
| **Database Query** | SQLite with parameterized queries | `db_query("SELECT * FROM sessions")` |
| **API Integration** | REST/GraphQL with auth headers | `api_call("https://api.example.com")` |
| **Terminal Commands** | Bash with workdir, timeout, streaming | `terminal("npm install")` |

**Implementation:**
```typescript
interface Tool {
  name: string;
  description: string;
  parameters: Record<string, ToolParameter>;
  returns: ToolReturn;
  validate: (params: any) => ValidationResult;
  execute: (params: any) => Promise<any>;
}

const tools: Tool[] = [
  webSearchTool,
  codeExecutionTool,
  fileOperationsTool,
  databaseQueryTool,
  apiIntegrationTool,
  terminalCommandsTool
];
```

**Safety Features:**
- Parameter validation before execution
- Timeout control (default 180s, max 600s)
- Sandboxed code execution (no network access)
- Rate limiting per tool
- Error handling with retry logic

**Status:** ✅ Production (6 tools implemented)  
**v2.0 Enhancement:** MCP integration, plugin system, tool chaining (Sprint 2, Jun 22-25)

---

### 4. Agents Layer

**Purpose:** Delegate complex tasks to specialized sub-agents

**Components:**
- **Dynamic Delegation:** Spawns sub-agents with isolated context (max 8 concurrent)
- **Conflict Resolution:** Detects and resolves resource, action, goal conflicts
- **Stigmergy Coordination:** Pheromone-based signaling for emergent coordination
- **Task Scoreboard:** Real-time progress tracking with status updates

**Implementation:**
```typescript
interface DelegationConfig {
  maxConcurrent: number;      // Default: 8
  timeout: number;            // Default: 300s
  retryAttempts: number;      // Default: 3
  spawnDepth: number;         // Default: 1 (no nested delegation)
}

async function delegateTask(config: DelegationConfig): Promise<DelegationResult> {
  const subAgents = await spawnAgents(config.maxConcurrent);
  
  for (const agent of subAgents) {
    const result = await agent.execute(config.task);
    scoreboard.update(agent.id, { progress: 100, status: 'completed' });
  }
  
  return aggregateResults(subAgents.map(a => a.result));
}
```

**Conflict Resolution Strategies:**
- **Priority-based:** Higher-priority task wins
- **Voting:** Agents vote on best action (majority wins)
- **Arbitration:** Orchestrator makes final decision (fallback)

**Stigmergy Mechanism:**
- Agents deposit pheromone trails when starting tasks
- Trail strength decays over time (simulates evaporation)
- Other agents detect strongest trails and follow (positive feedback)
- Prevents duplicate work (agents avoid weak/old trails)

**Status:** ✅ Production (basic delegation)  
**v2.0 Enhancement:** Full conflict resolution + stigmergy (Sprint 3, Jun 26-29)

---

### 5. Training Pipeline

**Purpose:** Fine-tune models with curated datasets and benchmark evaluation

**Components:**
- **Dataset Curation:** Collect, clean, and validate training data
- **Fine-Tuning:** LoRA and QLoRA workflows with gradient checkpointing
- **Evaluation:** Benchmark testing (MMLU, GSM8K, custom datasets)
- **Model Registry:** Versioned model storage with metadata

**Implementation:**
```typescript
interface TrainingConfig {
  model: string;
  dataset: DatasetConfig;
  method: 'LoRA' | 'QLoRA' | 'full';
  loraRank: number;         // Default: 8
  epochs: number;           // Default: 3
  batchSize: number;        // Default: 4
  learningRate: number;     // Default: 2e-4
}

async function fineTune(config: TrainingConfig): Promise<Model> {
  const dataset = await loadDataset(config.dataset);
  const model = await loadBaseModel(config.model);
  
  if (config.method === 'LoRA') {
    applyLoRA(model, config.loraRank);
  }
  
  const trainer = new Trainer(model, dataset, config);
  await trainer.train();
  
  const evaluation = await evaluate(model, config.benchmarks);
  
  return registry.save(model, {
    config,
    metrics: evaluation,
    timestamp: Date.now()
  });
}
```

**Benchmarks:**
- MMLU (57 subjects, high school to professional level)
- GSM8K (grade school math word problems)
- Custom domain-specific tests

**Status:** 📋 Planned (Sprint 4, Jun 30 - Jul 11)

---

## Status

```
v1 (ProxyGateLLM migration)
```

**Completed (v1.0):**
- ✅ Multi-provider routing (24 providers, 613+ models)
- ✅ SQLite session storage with basic entity tracking
- ✅ 6 core tools implemented and tested
- ✅ Basic agent delegation (single-level, no nesting)
- ✅ 117 tests passing (92% code coverage)
- ✅ Production deployment with 99.8% uptime

**In Progress (v2.0):**
- 🔄 Memory Layer: Graph LTM with full entity linking (Sprint 1, Jun 19-21)
- 📋 Tools Layer: MCP integration, plugin system (Sprint 2, Jun 22-25)
- 📋 Agents Layer: Conflict resolution + stigmergy (Sprint 3, Jun 26-29)
- 📋 Training Pipeline: Fine-tuning + benchmarks (Sprint 4, Jun 30 - Jul 11)

---

## Roadmap

### Sprint 1: Memory Layer (Jun 19-21)
- [ ] Graph-based LTM implementation
- [ ] Entity linking with relationship mapper
- [ ] Hybrid embeddings (dense + sparse)
- [ ] Session compression for long contexts

### Sprint 2: Tool Expansion (Jun 22-25)
- [ ] MCP (Model Context Protocol) integration
- [ ] Plugin system for custom tools
- [ ] Function calling with validation
- [ ] Tool chaining for complex workflows

### Sprint 3: Agent Orchestration (Jun 26-29)
- [ ] Multi-agent colony with PSO optimization
- [ ] Stigmergy coordination layer
- [ ] Conflict detection engine (resource, action, goal)
- [ ] Dynamic task redistribution

### Sprint 4: Training Pipeline (Jun 30 - Jul 11)
- [ ] Dataset curation pipeline
- [ ] LoRA fine-tuning workflow
- [ ] Benchmark evaluation (MMLU, GSM8K)
- [ ] Model registry with metadata

**Target Release:** July 11, 2026

---

## Dependencies

| Dependency | Version | Purpose |
|------------|---------|---------|
| Node.js | 20+ | Runtime |
| TypeScript | 5.4 | Type safety |
| SQLite | 3.40+ | Session storage, knowledge graph |
| sentence-transformers | latest | Hybrid embeddings |
| 24 LLM APIs | various | Provider routing |
| Jest | 29+ | Testing framework |
| Supertest | 6+ | API testing |
| testcontainers | 10+ | Isolated test environments |

---

## Limitations

**Acknowledged Constraints:**

1. **Context Window:** Limited by provider caps (max 128K tokens per request)
2. **Entity Linking Accuracy:** ~87% on benchmark dataset (ongoing improvement)
3. **Tool Execution Sandbox:** Prevents network calls from code execution (security feature)
4. **Agent Delegation Depth:** Works best for tasks < 10 steps (nested delegation disabled)
5. **Fine-Tuning Requirements:** Needs GPU access (not included in core package)
6. **Stigmergy Overhead:** Pheromone tracking adds ~5ms per delegation (v2.0)

---

## Repository

- **Code:** https://codeberg.org/Dhaher-Labs/ProxyGateLLM
- **Documentation:** https://dhaher-labs.codeberg.page/pages/systems/jeumpa-llm.html
- **Tests:** 117 passing, 92% coverage
- **License:** MIT
- **Maintained By:** Dhaher Labs
- **Last Updated:** June 19, 2026

---

## Note

```
not a frontier model
focus: efficiency + utility + deployment
```

**Design Principles:**
- Optimizes existing models, doesn't build new ones
- Focuses on practical deployment over research
- Prioritizes reliability and speed over novelty
- Built for production use, not benchmarks
- Engineering-based, factual, calm confidence

---

**Status:** ✅ Production Ready  
**Next Milestone:** v2.0 (July 11, 2026)  
**Priority:** Critical

**"A modular AI system designed for real-world deployment."**