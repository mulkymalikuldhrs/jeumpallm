# Jeumpa LLM — Complete Model Guide

<div align="center">

[![Models](https://img.shields.io/badge/Models-30+-10B981?style=for-the-badge)]()
[![Providers](https://img.shields.io/badge/Providers-9-8B5CF6?style=for-the-badge)]()
[![Free](https://img.shields.io/badge/Cost-FREE-success?style=for-the-badge)]()

**Complete model catalog, routing logic, and usage guide for Jeumpa LLM v6.0.0**

</div>

---

## Table of Contents

- [Model Catalog by Provider](#model-catalog-by-provider)
- [All Models Combined](#all-models-combined)
- [Model Aliases](#model-aliases)
- [Auto-Routing Logic](#auto-routing-logic)
- [NOT Working Models](#not-working-models)
- [Usage Examples](#usage-examples)
- [Model Selection Guide](#model-selection-guide)

---

## Model Catalog by Provider

### Puter.js (Priority 1)

Puter.js provides access to 14+ premium models through the Puter cloud platform. No API key required for basic usage; optional `PUTER_AUTH_TOKEN` increases rate limits.

| Model ID | Type | Description | Max Tokens |
|----------|------|-------------|------------|
| `deepseek-chat` | reasoning | DeepSeek Chat — general purpose, planning | 8,192 |
| `gpt-5-chat` | general | OpenAI GPT-5 Chat | 8,192 |
| `gpt-4o` | general | OpenAI GPT-4o — complex reasoning | 8,192 |
| `gpt-4o-mini` | fast | OpenAI GPT-4o Mini — quick tasks | 8,192 |
| `gemini-2.0-flash` | fast | Google Gemini 2.0 Flash | 8,192 |
| `gemini-2.0-flash-lite` | fast | Google Gemini 2.0 Flash Lite | 8,192 |
| `claude-opus-4-5-latest` | code/analysis | Claude Opus 4.5 — best for code | 8,192 |
| `claude-sonnet-4` | balanced | Claude Sonnet 4 — code + analysis | 8,192 |
| `claude-haiku-4-5` | fast | Claude Haiku 4.5 — quick | 8,192 |
| `grok-3` | general | xAI Grok 3 | 8,192 |
| `grok-3-fast` | fast | xAI Grok 3 Fast | 8,192 |
| `grok-2-vision` | vision | xAI Grok 2 Vision | 8,192 |
| `mistral-large-2512` | general | Mistral Large | 8,192 |
| `mistral-small-2506` | fast | Mistral Small | 8,192 |
| `mistral-medium-2508` | balanced | Mistral Medium | 8,192 |
| `codestral-2508` | code | Codestral — code generation | 8,192 |
| `devstral-medium-2507` | code | Devstral Medium — developer assistant | 8,192 |
| `qwen-2.5-coder-32b-instruct` | code | Qwen 2.5 Coder 32B | 8,192 |

---

### Pollinations AI (Priority 1)

Free, no API key required. OpenAI-compatible endpoint with SSE streaming.

| Model ID | Aliases | Type | Description | Max Tokens |
|----------|---------|------|-------------|------------|
| `openai` | `gpt-4o-mini` | general | GPT-4o Mini via Pollinations | 4,096 |
| `mistral` | `mistral-large` | general | Mistral via Pollinations | 4,096 |
| `llama` | `llama-3.1-70b` | general | Llama 3.1 via Pollinations | 4,096 |
| `deepseek-r1` | `deepseek-reasoner` | reasoning | DeepSeek R1 via Pollinations | 4,096 |
| `qwen` | `qwen-coder` | general | Qwen 2.5 Coder via Pollinations | 4,096 |

> **Note:** Pollinations uses its own model IDs internally (e.g., `openai` instead of `gpt-4o-mini`). The gateway's `_mapModel()` function automatically translates standard model names to Pollinations IDs.

---

### DuckDuckGo AI Chat (Priority 1)

Free, no API key required. Uses VQD token authentication.

| Model ID | Aliases | Type | Description | Max Tokens |
|----------|---------|------|-------------|------------|
| `gpt-4o-mini` | — | fast | GPT-4o Mini via DDG | 4,096 |
| `claude-3-haiku` | `claude-haiku` | fast | Claude 3 Haiku via DDG | 4,096 |
| `llama-3.1-70b` | `llama` | general | Llama 3.1 70B via DDG | 4,096 |
| `mixtral-8x7b` | `mixtral` | general | Mixtral 8x7B via DDG | 4,096 |

> **Note:** DuckDuckGo internally maps to specific model versions (e.g., `claude-3-haiku` → `claude-3-haiku-20240307`, `llama-3.1-70b` → `meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo`).

---

### OpenRouter Free (Priority 1)

Models are auto-synced from the OpenRouter API. Free models are filtered automatically. Optional `OPENROUTER_API_KEY` enables paid models.

| Model ID | Type | Description | Context Length |
|----------|------|-------------|----------------|
| *(Auto-synced)* | varies | Free models from OpenRouter | varies |

> **Note:** The model list is dynamic and refreshed every hour. Check `GET /models` for the current list. Typically 30–60 free models are available including Llama, Mistral, Qwen, and others.

---

### Groq (Priority 2)

Ultra-fast inference. Requires `GROQ_API_KEY` environment variable. Provider is disabled if no key is set.

| Model ID | Type | Description | Max Tokens |
|----------|------|-------------|------------|
| `llama-3.3-70b-versatile` | general | Llama 3.3 70B on Groq | 8,192 |
| `llama-3.1-8b-instant` | fast | Llama 3.1 8B Instant on Groq | 8,192 |
| `mixtral-8x7b-32768` | general | Mixtral 8x7B on Groq | 32,768 |
| `gemma2-9b-it` | fast | Gemma 2 9B on Groq | 8,192 |

> **Note:** Groq is the fastest provider for supported models due to LPU inference hardware. Excellent for real-time applications.

---

### HuggingFace Inference (Priority 2)

Free tier with `HUGGINGFACE_API_KEY`. Uses the HuggingFace Inference API. Provider is disabled if no key is set.

| Model ID | Type | Description | Max Tokens |
|----------|------|-------------|------------|
| `meta-llama/Llama-3.1-70B-Instruct` | general | Llama 3.1 70B on HF | 4,096 |
| `mistralai/Mixtral-8x7B-Instruct-v0.1` | general | Mixtral 8x7B on HF | 4,096 |
| `Qwen/Qwen2.5-Coder-32B-Instruct` | code | Qwen 2.5 Coder on HF | 4,096 |

> **Note:** HuggingFace uses a single-turn format (only the last user message is sent). Streaming is simulated (full response delivered as one chunk).

---

### G4F / FreeGPT (Priority 2)

Uses the `g4f` Python library via subprocess. Requires Python 3 and `pip install g4f`. Provider is disabled if Python/g4f is not available.

| Model ID | Aliases | Type | Description | Max Tokens |
|----------|---------|------|-------------|------------|
| `gpt-4o` | `gpt4o-g4f` | general | GPT-4o via G4F | 4,096 |
| `gpt-4o-mini` | — | fast | GPT-4o Mini via G4F | 4,096 |
| `claude-3-5-sonnet` | — | balanced | Claude 3.5 Sonnet via G4F | 4,096 |

> **Note:** Streaming is simulated. Each request spawns a Python subprocess, so latency is higher than HTTP-based providers.

---

### Blackbox AI (Priority 3)

Free, no API key required. Reverse-engineered API.

| Model ID | Type | Description | Max Tokens |
|----------|------|-------------|------------|
| `blackboxai` | general | Blackbox AI | 4,096 |
| `blackboxai-pro` | general | Blackbox AI Pro | 4,096 |

> **Note:** Response content may contain special prefixes (`$@$v=undefined-rv1$@$`) that are automatically cleaned up. Streaming returns content as a single chunk.

---

### Phind (Priority 3)

Free, no API key required. Code-focused AI. Reverse-engineered API.

| Model ID | Aliases | Type | Description | Max Tokens |
|----------|---------|------|-------------|------------|
| `Phind-70B` | `phind-70b` | code | Phind 70B — code specialist | 4,096 |

> **Note:** Phind uses a custom format with `question` and `question_context` fields. Only the last user message is used as the primary question. Streaming is simulated.

---

## All Models Combined

Complete deduplicated model list across all providers:

### Premium Models (via Puter.js)

| Model | Type | Best For | Providers |
|-------|------|----------|-----------|
| `claude-opus-4-5-latest` | code/analysis | Complex code, deep analysis, architecture | puter |
| `claude-sonnet-4` | balanced | Code + analysis, balanced tasks | puter |
| `claude-haiku-4-5` | fast | Quick responses, simple tasks | puter |
| `gpt-5-chat` | general | Latest OpenAI model, general tasks | puter |
| `gpt-4o` | general | Complex reasoning, explanations | puter |
| `gpt-4o-mini` | fast | Quick tasks, simple queries | puter, pollinations, duckduckgo, g4f |
| `deepseek-chat` | reasoning | Planning, general purpose, balanced | puter |
| `gemini-2.0-flash` | fast | Balanced speed and quality | puter |
| `gemini-2.0-flash-lite` | fast | Ultra-fast responses | puter |
| `grok-3` | general | General tasks, creative | puter |
| `grok-3-fast` | fast | Quick Grok responses | puter |
| `grok-2-vision` | vision | Image understanding | puter |
| `mistral-large-2512` | general | Mistral's best model | puter |
| `codestral-2508` | code | Code generation | puter |
| `qwen-2.5-coder-32b-instruct` | code | Dedicated coding model | puter, huggingface |

### Open-Source Models

| Model | Type | Best For | Providers |
|-------|------|----------|-----------|
| `llama-3.3-70b-versatile` | general | General tasks, versatile | groq |
| `llama-3.1-70b` | general | General tasks | duckduckgo, pollinations |
| `llama-3.1-8b-instant` | fast | Quick tasks | groq |
| `mixtral-8x7b-32768` | general | Long context (32K) | groq, duckduckgo |
| `gemma2-9b-it` | fast | Quick tasks | groq |
| `deepseek-r1` | reasoning | Step-by-step reasoning chain | pollinations |
| `Phind-70B` | code | Code specialist | phind |
| `blackboxai` | general | General AI chat | blackbox |
| `blackboxai-pro` | general | Enhanced AI chat | blackbox |
| `claude-3-5-sonnet` | balanced | Balanced code and analysis | g4f |
| `claude-3-haiku` | fast | Quick responses | duckduckgo |

---

## Model Aliases

The gateway automatically resolves common aliases to canonical model IDs. Use any alias in the `model` field — it will be mapped transparently.

| Alias | Canonical Model ID |
|-------|-------------------|
| `gpt4` | `gpt-4o` |
| `gpt4o` | `gpt-4o` |
| `gpt4-mini` | `gpt-4o-mini` |
| `gpt4o-mini` | `gpt-4o-mini` |
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

### Usage

```bash
# These are all equivalent:
curl -X POST http://localhost:3333/v1/chat/completions \
  -d '{"model":"gpt4","messages":[...]}'

curl -X POST http://localhost:3333/v1/chat/completions \
  -d '{"model":"gpt4o","messages":[...]}'

curl -X POST http://localhost:3333/v1/chat/completions \
  -d '{"model":"gpt-4o","messages":[...]}'
```

---

## Auto-Routing Logic

When `model` is omitted or set to `"auto"`, the gateway automatically selects the best model based on message content analysis.

### Decision Tree

```
pickModel(messages)
  │
  ├─ Empty content
  │   └── deepseek-chat
  │
  ├─ BUILDING category (code, implementation)
  │   Keywords: code, implement, function, class, api, debug, bug, fix,
  │             refactor, sql, database, frontend, backend, deploy, config,
  │             docker, kubernetes, terraform, write a, create a, build,
  │             develop, script, program, compile, syntax, variable, loop,
  │             array, object, module, package, npm, pip, git, commit
  │   └── claude-opus-4-5-latest
  │
  ├─ PLANNING category (design, architecture)
  │   Keywords: plan, design, rencana, strategy, analyze, compare, decision,
  │             recommend, overview, roadmap, diagram, flow, system design,
  │             high level, architect, evaluate, assess
  │   └── deepseek-chat
  │
  ├─ REASONING category (problem solving, math)
  │   Keywords: reason, solve, explain, how does, why is, what is,
  │             step by step, proof, calculate, derive, think about,
  │             math, equation, formula, theorem, logic, prove
  │   └── gpt-4o
  │
  ├─ FAST category (quick questions)
  │   Condition: text.length < 100 OR text contains "?"
  │   └── gpt-4o-mini
  │
  └── DEFAULT
      └── deepseek-chat
```

### Auto-Routing Examples

| Query | Detected Category | Selected Model |
|-------|------------------|----------------|
| "Debug my Python Flask app" | BUILDING | `claude-opus-4-5-latest` |
| "Write a REST API with Express" | BUILDING | `claude-opus-4-5-latest` |
| "Fix this SQL query" | BUILDING | `claude-opus-4-5-latest` |
| "Design a system architecture" | PLANNING | `deepseek-chat` |
| "Create a roadmap for our project" | PLANNING | `deepseek-chat` |
| "Solve: 3x + 7 = 22" | REASONING | `gpt-4o` |
| "Explain why the sky is blue" | REASONING | `gpt-4o` |
| "What is the capital of France?" | FAST | `gpt-4o-mini` |
| "Hi" | FAST | `gpt-4o-mini` |
| "Tell me about machine learning" | DEFAULT | `deepseek-chat` |

### Task Type Detection

The `getTaskType()` function returns a task type string that can be used for routing hints:

| Task Type | Detection |
|-----------|-----------|
| `code` | Code-related keywords (implement, function, debug, deploy, build) |
| `planning` | Planning keywords (plan, design, strategy, architect) |
| `reasoning` | Reasoning keywords (reason, solve, explain, calculate, prove) |
| `fast` | Short text (<100 chars) or contains `?` |
| `general` | Default fallback |

---

## NOT Working Models

The following models are known to NOT work through any provider. Do not use them:

| Model | Issue |
|-------|-------|
| `deepseek-reasoner` | Not available through Puter.js; aliased but unreachable |
| `gpt-5-nano` | Does not exist in Puter.js |
| `o1` / `o3` / `o3-mini` | Not available through any provider |
| `gemini-2.5-pro` | Not available through any provider |
| `gemini-2.5-flash` | Not available through any provider |
| `claude-3-5-sonnet` | Available via G4F only (unstable); not via Puter |
| `claude-sonnet-4-5-latest` | Does not exist in Puter.js |
| `claude-haiku-3-5-2025` | Does not exist in Puter.js |
| `grok-2` | Not available through Puter.js |
| `auto` | Not a model ID — use omit `model` field or set to `"auto"` for routing |

> **Tip:** If a model you request is not supported by any enabled provider, you will receive: `{"error": "No provider available for model: <model>"}`

---

## Usage Examples

### OpenAI-Compatible Endpoint

```bash
# Specific model
curl -X POST http://localhost:3333/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [
      {"role": "system", "content": "You are a coding assistant."},
      {"role": "user", "content": "Write a Python function to calculate fibonacci"}
    ]
  }'

# Auto-routed (no model specified)
curl -X POST http://localhost:3333/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "Debug my Node.js app"}
    ]
  }'

# Using model alias
curl -X POST http://localhost:3333/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude",
    "messages": [
      {"role": "user", "content": "Analyze this architecture"}
    ]
  }'

# Streaming
curl -X POST http://localhost:3333/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-chat",
    "messages": [{"role": "user", "content": "Explain quantum computing"}],
    "stream": true
  }'
```

### Anthropic-Compatible Endpoint

```bash
# Claude via Anthropic format
curl -X POST http://localhost:3333/v1/messages \
  -H "Content-Type: application/json" \
  -H "Anthropic-Api-Version: 2023-06-01" \
  -d '{
    "model": "claude-opus-4-5-latest",
    "system": "You are a helpful assistant.",
    "messages": [
      {"role": "user", "content": "Explain machine learning in simple terms"}
    ],
    "max_tokens": 1024
  }'

# Using prompt shorthand
curl -X POST http://localhost:3333/v1/messages \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-haiku-4-5",
    "prompt": "What is the capital of Japan?"
  }'

# Streaming with Anthropic format
curl -X POST http://localhost:3333/v1/messages \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4",
    "messages": [{"role": "user", "content": "Write a TypeScript interface"}],
    "stream": true
  }'
```

### Native Auto-Routed Endpoint

```bash
# Auto-routing based on content
curl -X POST http://localhost:3333/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "Build a REST API with Express.js and MongoDB"}
    ]
  }'

# Override auto-routing with specific model
curl -X POST http://localhost:3333/chat \
  -H "Content-Type: application/json" \
  -d '{
    "model": "grok-3",
    "messages": [
      {"role": "user", "content": "What do you think about AI?"}
    ]
  }'
```

### Using OpenAI SDK (Python)

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3333/v1",
    api_key="not-needed"
)

# Specific model
response = client.chat.completions.create(
    model="claude-opus-4-5-latest",
    messages=[{"role": "user", "content": "Hello!"}]
)

# Auto-routed
response = client.chat.completions.create(
    model="auto",
    messages=[{"role": "user", "content": "Debug my code"}]
)

# Streaming
stream = client.chat.completions.create(
    model="deepseek-chat",
    messages=[{"role": "user", "content": "Explain recursion"}],
    stream=True
)
for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="")
```

### Using Anthropic SDK (Python)

```python
from anthropic import Anthropic

client = Anthropic(
    base_url="http://localhost:3333/v1",
    api_key="not-needed"
)

response = client.messages.create(
    model="claude-opus-4-5-latest",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello!"}]
)
print(response.content[0].text)
```

### Using with OpenCode

Edit your `opencode.json`:

```json
{
  "provider": {
    "Jeumpa LLM": {
      "models": {
        "deepseek-chat": {},
        "gpt-4o": {},
        "gpt-4o-mini": {},
        "claude-opus-4-5-latest": {},
        "claude-sonnet-4": {},
        "claude-haiku-4-5": {},
        "gemini-2.0-flash": {},
        "grok-3": {},
        "codestral-2508": {},
        "qwen-2.5-coder-32b-instruct": {}
      },
      "options": {
        "baseURL": "http://localhost:3333/v1"
      }
    }
  }
}
```

### Using with Continue (VS Code Extension)

```json
{
  "models": [
    {
      "title": "Jeumpa LLM Auto",
      "provider": "openai",
      "model": "auto",
      "apiBase": "http://localhost:3333/v1"
    },
    {
      "title": "GPT-4o",
      "provider": "openai",
      "model": "gpt-4o",
      "apiBase": "http://localhost:3333/v1"
    },
    {
      "title": "Claude Opus",
      "provider": "openai",
      "model": "claude-opus-4-5-latest",
      "apiBase": "http://localhost:3333/v1"
    }
  ]
}
```

---

## Model Selection Guide

### By Task Type

| Task | Recommended Model | Why |
|------|------------------|-----|
| Code generation | `claude-opus-4-5-latest` | Best code understanding and generation |
| Code review | `claude-sonnet-4` | Balanced speed and code analysis |
| Quick coding tasks | `codestral-2508` or `qwen-2.5-coder-32b-instruct` | Fast, code-specialized |
| Planning & design | `deepseek-chat` | Strong at structured planning |
| Complex reasoning | `gpt-4o` | Best at logical reasoning |
| Math & proofs | `gpt-4o` | Step-by-step problem solving |
| Quick questions | `gpt-4o-mini` | Fast and efficient |
| Creative writing | `grok-3` or `gpt-4o` | Creative fluency |
| Long context tasks | `mixtral-8x7b-32768` (via Groq) | 32K context window |
| Vision tasks | `grok-2-vision` | Image understanding |
| Real-time apps | Groq models (`llama-3.3-70b-versatile`) | Ultra-fast inference |

### By Priority

If you don't specify a model and use auto-routing:

| Scenario | What Happens |
|----------|-------------|
| Coding request | Auto-routes to `claude-opus-4-5-latest` via Puter |
| Planning request | Auto-routes to `deepseek-chat` via Puter |
| Reasoning request | Auto-routes to `gpt-4o` via Puter |
| Quick question | Auto-routes to `gpt-4o-mini` via Puter/Pollinations/DDG |
| Anything else | Auto-routes to `deepseek-chat` via Puter |

### Failover Path

For models available on multiple providers, the failover path is:

| Model | Primary (P1) | Fallback (P2) | Last Resort (P3) |
|-------|-------------|---------------|-------------------|
| `gpt-4o-mini` | Puter | Pollinations, DuckDuckGo | G4F |
| `gpt-4o` | Puter | — | G4F |
| `claude-3-5-sonnet` | G4F | — | — |
| `llama-3.1-70b` | DuckDuckGo, Pollinations | — | — |
| `mixtral-8x7b` | DuckDuckGo | Groq | — |
| `qwen-2.5-coder-32b-instruct` | Puter | HuggingFace | — |

---

<div align="center">

**Next: [API.md](API.md) | [ARCHITECTURE.md](ARCHITECTURE.md) | [PROVIDERS.md](PROVIDERS.md)**

</div>
