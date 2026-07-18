# Provider Tutorials & Integration Guide

<div align="center">

[![Z.ai](https://img.shields.io/badge/Z.ai-SDK-FF6B35?style=for-the-badge)](https://www.npmjs.com/package/z-ai-web-dev-sdk)
[![Qwen](https://img.shields.io/badge/Qwen-2.5-615FFF?style=for-the-badge)](https://qwenlm.github.io/)
[![Puter.js](https://img.shields.io/badge/Puter.js-2.2.5-8B5CF6?style=for-the-badge)](https://docs.puter.com/)

**Complete guide for integrating and using all Jeumpa LLM providers**

</div>

---

<!-- ===================================================================== -->
<!-- ENGLISH -->
<!-- ===================================================================== -->

## 🇬🇧 English

### Table of Contents

- [Overview](#overview)
- [Z.ai Provider](#zai-provider)
- [Qwen Provider](#qwen-provider)
- [Puter.js Provider](#puterjs-provider)
- [Auto-Routing System](#auto-routing-system)
- [Hybrid Execution](#hybrid-execution)
- [Comparison Table](#comparison-table)
- [Troubleshooting](#troubleshooting)

---

### Overview

Jeumpa LLM supports three AI providers, each specialized for different task types. The gateway automatically routes your requests to the best provider based on your query content, or you can directly specify which provider to use.

```
┌──────────────────────────────────────────────────────────┐
│                    Jeumpa LLM                     │
│                                                          │
│  ┌─────────┐   ┌─────────┐   ┌─────────┐              │
│  │  Z.ai   │   │  Qwen   │   │ Puter   │              │
│  │Reasoning│   │  Code   │   │18+ Model│              │
│  └─────────┘   └─────────┘   └─────────┘              │
│       ▲             ▲             ▲                     │
│       │             │             │                     │
│  ┌────┴─────────────┴─────────────┴────┐              │
│  │          Task Router Engine          │              │
│  │  code→Qwen | reasoning→Z.ai | ...  │              │
│  └──────────────────┬──────────────────┘              │
│                     │                                   │
│              ┌──────┴──────┐                           │
│              │  Classifier  │                           │
│              └──────┬──────┘                           │
│                     │                                   │
│              ┌──────┴──────┐                           │
│              │    User     │                           │
│              └─────────────┘                           │
└──────────────────────────────────────────────────────────┘
```

---

### Z.ai Provider

**Specialization:** Reasoning, general intelligence, creative tasks, complex analysis

The Z.ai provider uses the `z-ai-web-dev-sdk` npm package for advanced AI reasoning capabilities. It excels at complex logical reasoning, mathematical proofs, step-by-step analysis, and creative generation tasks.

#### Installation

The Z.ai SDK is included as a dependency when you install Jeumpa LLM:

```bash
npm install z-ai-web-dev-sdk
```

#### Configuration

Z.ai works out of the box — no API key required! The SDK initializes automatically on first use.

```env
# .env — No special configuration needed for Z.ai
# The SDK handles authentication internally
GATEWAY_PORT=3333
```

#### Using Z.ai Directly

**Via the Gateway (Recommended):**

```bash
# Direct Z.ai route
curl -X POST http://localhost:3333/zai/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "system", "content": "You are a helpful reasoning assistant."},
      {"role": "user", "content": "Explain why the sky is blue using step-by-step physics"}
    ],
    "stream": false
  }'
```

**With Streaming:**

```bash
# Streaming Z.ai response
curl -X POST http://localhost:3333/zai/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "Prove that the square root of 2 is irrational"}
    ],
    "stream": true
  }'
```

**Via Auto-Routing:**

```bash
# The classifier detects "reasoning" keywords and routes to Z.ai automatically
curl -X POST http://localhost:3333/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "Analyze the logical implications of this argument step by step"}
    ]
  }'
```

#### Using Z.ai SDK Directly in Code

```javascript
import ZAI from 'z-ai-web-dev-sdk';

async function useZaiDirectly() {
  // Initialize the SDK
  const zai = await ZAI.create();

  // Non-streaming chat
  const response = await zai.chat.completions.create({
    messages: [
      {
        role: 'system',
        content: 'You are a reasoning expert.'
      },
      {
        role: 'user',
        content: 'Solve this logic puzzle step by step...'
      }
    ],
  });

  console.log(response.choices[0].message.content);

  // Streaming chat
  const stream = await zai.chat.completions.create({
    messages: [
      { role: 'user', content: 'Explain quantum entanglement' }
    ],
    stream: true,
  });

  for await (const chunk of stream) {
    // Process streaming tokens
    process.stdout.write(String.fromCharCode(...Object.values(chunk)));
  }
}
```

#### Z.ai Best Practices

| Task Type | Example Prompt | Why Z.ai? |
|-----------|---------------|-----------|
| Logical reasoning | "Prove that..." | Step-by-step chain of thought |
| Mathematical analysis | "Calculate the..." | Numerical accuracy |
| Complex explanations | "Explain why..." | Deep understanding |
| Creative writing | "Write a story about..." | Creative fluency |
| Philosophical questions | "What is the nature of..." | Nuanced reasoning |

---

### Qwen Provider

**Specialization:** Code generation, structured output, technical tasks, database queries

The Qwen provider uses the Qwen 2.5 Coder 32B model accessed via the Puter.js SDK. It is the best choice for writing, debugging, and refactoring code, as well as generating structured data like JSON, YAML, and database schemas.

#### Configuration

Qwen requires a Puter.js authentication token:

```env
# .env
PUTER_AUTH_TOKEN=your_puter_token_here
```

Get your free Puter token at: [https://puter.com/#/account](https://puter.com/#/account)

#### Using Qwen Directly

**Via the Gateway:**

```bash
# Direct Qwen route
curl -X POST http://localhost:3333/qwen/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "system", "content": "You are an expert coder."},
      {"role": "user", "content": "Write a Node.js Express REST API with CRUD operations for a todo app"}
    ],
    "stream": false
  }'
```

**With Streaming:**

```bash
# Streaming Qwen response
curl -X POST http://localhost:3333/qwen/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "Refactor this Python function to be more efficient"}
    ],
    "stream": true
  }'
```

**Specifying Model:**

```bash
# Use specific Qwen model
curl -X POST http://localhost:3333/qwen/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "Write a SQL query to find top 10 customers"}
    ],
    "model": "qwen-2.5-coder-32b-instruct"
  }'
```

**Via Auto-Routing:**

```bash
# The classifier detects "code" keywords and routes to Qwen automatically
curl -X POST http://localhost:3333/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "Implement a binary search tree in TypeScript with insert, delete, and search methods"}
    ]
  }'
```

#### Qwen Best Practices

| Task Type | Example Prompt | Why Qwen? |
|-----------|---------------|-----------|
| Code generation | "Write a function that..." | Optimized for code syntax |
| Debugging | "Fix this error in my code..." | Error pattern recognition |
| Refactoring | "Optimize this function..." | Code structure understanding |
| Database queries | "Write a SQL query..." | Query optimization |
| Structured output | "Generate JSON schema for..." | Format compliance |
| API design | "Create REST API endpoints..." | Technical specification |

---

### Puter.js Provider

**Specialization:** Multi-model access — 18+ models including GPT-4o, Claude, DeepSeek, Gemini, Grok, Mistral, and more

The Puter.js provider gives you access to a wide range of premium AI models for free through the Puter cloud platform. It acts as a universal fallback and supports models from OpenAI, Anthropic, Google, xAI, Mistral, and others.

#### Configuration

```env
# .env
PUTER_AUTH_TOKEN=your_puter_token_here
```

#### Available Models

| Model | Provider | Type | Best For |
|-------|----------|------|----------|
| `gpt-5-nano` | OpenAI | Fast | Quick tasks, simple queries |
| `gpt-5-chat` | OpenAI | General | Latest OpenAI model |
| `gpt-4o` | OpenAI | General | Complex reasoning, code |
| `gpt-4o-mini` | OpenAI | Fast | Quick tasks |
| `claude-opus-4-5-latest` | Anthropic | Reasoning | Deep analysis, architecture |
| `claude-sonnet-4` | Anthropic | Balanced | Code + analysis |
| `claude-haiku-4-5` | Anthropic | Fast | Quick responses |
| `deepseek-reasoner` | DeepSeek | Reasoning | Step-by-step reasoning chain |
| `deepseek-chat` | DeepSeek | Code/Chat | Code generation & chat |
| `gemini-2.0-flash` | Google | Fast | Balanced performance |
| `grok-3` | xAI | General | xAI flagship model |
| `grok-3-fast` | xAI | Fast | Quick responses |
| `grok-2-vision` | xAI | Vision | Image understanding |
| `mistral-large-2512` | Mistral | General | Mistral best model |
| `codestral-2508` | Mistral | Code | Code generation |
| `qwen-2.5-coder-32b-instruct` | Qwen | Code | Dedicated coding |

#### Using Puter.js Models

**Via OpenAI-Compatible Endpoint:**

```bash
# Use GPT-4o via OpenAI format
curl -X POST http://localhost:3333/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [
      {"role": "user", "content": "Explain machine learning in simple terms"}
    ]
  }'
```

**Via Anthropic-Compatible Endpoint:**

```bash
# Use Claude via Anthropic format
curl -X POST http://localhost:3333/v1/messages \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-opus-4-5-latest",
    "system": "You are a helpful assistant.",
    "messages": [
      {"role": "user", "content": "Analyze this code architecture"}
    ]
  }'
```

**Via Auto-Routing:**

```bash
# Specify model in /chat endpoint
curl -X POST http://localhost:3333/chat \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-reasoner",
    "messages": [
      {"role": "user", "content": "Solve this math proof step by step"}
    ]
  }'
```

---

### Auto-Routing System

The auto-routing system automatically classifies your query and selects the optimal provider and model. You do not need to specify which provider to use — just send your request to `/chat` and the gateway handles the rest.

#### Classification Categories

| Category | Keywords (Examples) | Primary Provider | Fallback Provider |
|----------|---------------------|------------------|-------------------|
| **code** | code, implement, debug, refactor, function, api, sql, database | Qwen | Z.ai |
| **reasoning** | reason, solve, explain, how does, why is, prove, analyze | Z.ai | Puter/DeepSeek |
| **infra** | system, infrastructure, config, server, kubernetes, terraform | Qwen + Z.ai (hybrid) | — |
| **multimodal** | image, vision, draw, design, creative, screenshot | Z.ai | Puter/GPT-4o |
| **structured** | json, yaml, schema, table, format, organize, csv | Qwen | Z.ai |
| **general** | (default/fallback) | Z.ai | Puter/GPT-4o |

#### How Classification Works

1. **Keyword Matching**: The classifier scans your message for task-specific keywords with weighted scoring
2. **Structural Pattern Detection**: Code blocks (```...```), JSON/YAML mentions, and step markers boost specific categories
3. **Role-Aware Weighting**: System messages and the latest user message carry more weight
4. **Confidence Scoring**: If confidence is below 15%, the query defaults to "general"

#### Routing Decision Endpoint

You can preview the routing decision without executing the query:

```bash
curl -X POST http://localhost:3333/route \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "Build a REST API with Express and MongoDB"}
    ]
  }'
```

Response:
```json
{
  "routing": {
    "provider": "qwen",
    "model": "qwen-2.5-coder-32b-instruct",
    "fallback": {
      "provider": "zai",
      "model": "zai-default"
    },
    "classification": {
      "type": "code",
      "confidence": 0.85,
      "keywords": ["build", "api", "express"]
    },
    "hybrid": false
  },
  "timestamp": "2026-05-25T12:00:00.000Z"
}
```

---

### Hybrid Execution

For infrastructure tasks, Jeumpa LLM uses a hybrid execution model:

```
Step 1: Qwen generates technical base answer
           ↓
Step 2: Z.ai reviews and refines the answer
           ↓
Step 3: Gateway normalizes and returns combined response
```

This ensures infrastructure queries get both technical accuracy (from Qwen) and deep reasoning validation (from Z.ai).

**Example:**

```bash
# Infra query automatically triggers hybrid mode
curl -X POST http://localhost:3333/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "Design a Kubernetes deployment strategy for a microservices architecture with auto-scaling"}
    ]
  }'
```

The response will have `"hybrid": true` and `"provider": "qwen+zai"` indicating both providers were used.

---

### Comparison Table

| Feature | Z.ai | Qwen | Puter.js |
|---------|------|------|----------|
| **API Key Required** | No | Yes (Puter token) | Yes (Puter token) |
| **Best For** | Reasoning, analysis | Code, structured data | Multi-model access |
| **Models** | 1 (default) | 2 (coder + fallback) | 18+ models |
| **Streaming** | Yes (SSE) | Yes (SSE) | Yes (SSE) |
| **Fallback** | Puter/DeepSeek | Z.ai | N/A |
| **Cost** | Free | Free (via Puter) | Free |
| **Latency** | Medium | Low | Varies by model |
| **Context Window** | Large | Large | Model-dependent |

---

### Troubleshooting

#### Z.ai Issues

**Problem:** `Z.ai SDK initialisation failed`
**Solution:** Ensure you have internet connectivity. The SDK requires network access to initialize.

**Problem:** Streaming returns garbled characters
**Solution:** The Z.ai SDK returns character codes. The gateway's streaming engine handles this automatically. If you see raw character codes, ensure you're using the `/zai/chat` or `/chat` endpoints, not calling the SDK directly.

#### Qwen Issues

**Problem:** `PUTER_AUTH_TOKEN environment variable is required`
**Solution:** Add your Puter token to the `.env` file:
```env
PUTER_AUTH_TOKEN=your_token_here
```

**Problem:** `Qwen provider error (all models exhausted)`
**Solution:** The primary Qwen model may be temporarily unavailable. The gateway automatically falls back to DeepSeek. If both fail, check your Puter token and internet connectivity.

#### Puter.js Issues

**Problem:** `Puter provider error`
**Solution:** Verify your PUTER_AUTH_TOKEN is valid. Get a fresh token from [https://puter.com/#/account](https://puter.com/#/account).

**Problem:** Model not available
**Solution:** Check the model list at `GET /models` to see which models are currently supported.

---

<!-- ===================================================================== -->
<!-- BAHASA INDONESIA -->
<!-- ===================================================================== -->

## 🇮🇩 Bahasa Indonesia

### Daftar Isi

- [Ringkasan](#ringkasan-id)
- [Provider Z.ai](#provider-zai)
- [Provider Qwen](#provider-qwen-id)
- [Provider Puter.js](#provider-puterjs-id)
- [Sistem Auto-Routing](#sistem-auto-routing)
- [Eksekusi Hybrid](#eksekusi-hybrid)
- [Tabel Perbandingan](#tabel-perbandingan)

---

### Ringkasan {#ringkasan-id}

Jeumpa LLM mendukung tiga provider AI, masing-masing berspesialisasi untuk tugas yang berbeda. Gateway secara otomatis merutekan permintaan Anda ke provider terbaik berdasarkan konten kueri, atau Anda dapat langsung menentukan provider mana yang ingin digunakan.

### Provider Z.ai {#provider-zai-id}

**Spesialisasi:** Penalaran, kecerdasan umum, tugas kreatif, analisis kompleks

Provider Z.ai menggunakan paket npm `z-ai-web-dev-sdk` untuk kemampuan penalaran AI tingkat lanjut. Tidak perlu kunci API — SDK menginisialisasi secara otomatis.

**Cara Penggunaan:**
```bash
# Langsung ke Z.ai
curl -X POST http://localhost:3333/zai/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Jelaskan mengapa langit berwarna biru"}]}'

# Auto-routing (otomatis ke Z.ai untuk tugas penalaran)
curl -X POST http://localhost:3333/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Buktikan langkah demi langkah"}]}'
```

### Provider Qwen {#provider-qwen-id}

**Spesialisasi:** Generasi kode, output terstruktur, tugas teknis, query database

Provider Qwen menggunakan model Qwen 2.5 Coder 32B melalui SDK Puter.js. Memerlukan token Puter.

**Cara Penggunaan:**
```bash
# Langsung ke Qwen
curl -X POST http://localhost:3333/qwen/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Tulis REST API Node.js"}]}'

# Auto-routing (otomatis ke Qwen untuk tugas kode)
curl -X POST http://localhost:3333/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Debug kode Python ini"}]}'
```

### Provider Puter.js {#provider-puterjs-id}

**Spesialisasi:** Akses multi-model — 18+ model termasuk GPT-4o, Claude, DeepSeek, dan lainnya

**Cara Penggunaan:**
```bash
# Gunakan model tertentu
curl -X POST http://localhost:3333/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o","messages":[{"role":"user","content":"Halo!"}]}'
```

### Sistem Auto-Routing

| Kategori | Provider Utama | Provider Fallback |
|----------|---------------|-------------------|
| kode | Qwen | Z.ai |
| penalaran | Z.ai | Puter/DeepSeek |
| infrastruktur | Qwen + Z.ai (hybrid) | — |
| multimodal | Z.ai | Puter/GPT-4o |
| terstruktur | Qwen | Z.ai |
| umum | Z.ai | Puter/GPT-4o |

---

<!-- ===================================================================== -->
<!-- 中文 -->
<!-- ===================================================================== -->

## 🇨🇳 中文

### 目录

- [概述](#概述-cn)
- [Z.ai 提供商](#zai-提供商)
- [Qwen 提供商](#qwen-提供商)
- [Puter.js 提供商](#puterjs-提供商)
- [自动路由系统](#自动路由系统)
- [混合执行](#混合执行)

---

### 概述 {#概述-cn}

Jeumpa LLM 网关支持三个 AI 提供商，每个专门用于不同的任务类型。网关会根据查询内容自动将您的请求路由到最佳提供商，您也可以直接指定要使用的提供商。

### Z.ai 提供商

**专长：** 推理、通用智能、创意任务、复杂分析

Z.ai 提供商使用 `z-ai-web-dev-sdk` npm 包。无需 API 密钥，SDK 会自动初始化。

**使用方法：**
```bash
# 直接使用 Z.ai
curl -X POST http://localhost:3333/zai/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"逐步解释量子纠缠"}]}'
```

### Qwen 提供商

**专长：** 代码生成、结构化输出、技术任务、数据库查询

Qwen 提供商使用 Qwen 2.5 Coder 32B 模型。需要 Puter 令牌。

**使用方法：**
```bash
# 直接使用 Qwen
curl -X POST http://localhost:3333/qwen/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"用 TypeScript 写一个二叉搜索树"}]}'
```

### Puter.js 提供商

**专长：** 多模型访问 — 18+ 模型包括 GPT-4o、Claude、DeepSeek 等

**使用方法：**
```bash
# 指定模型
curl -X POST http://localhost:3333/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o","messages":[{"role":"user","content":"你好！"}]}'
```

### 自动路由系统

| 类别 | 主要提供商 | 备用提供商 |
|------|-----------|-----------|
| 代码 | Qwen | Z.ai |
| 推理 | Z.ai | Puter/DeepSeek |
| 基础设施 | Qwen + Z.ai（混合） | — |
| 多模态 | Z.ai | Puter/GPT-4o |
| 结构化 | Qwen | Z.ai |
| 通用 | Z.ai | Puter/GPT-4o |

---

<div align="center">

**📚 For more details, see [API.md](API.md) and [TUTORIAL.md](TUTORIAL.md)**

</div>

---

> **Contact:** Mulky Malikul Dhaher — [mulkymalikuldhaher@email.com](mailto:mulkymalikuldhaher@email.com)
>
> **Disclaimer:** This project is for Education Purpose only. Risiko apapun tidak kita tanggung. (We are not responsible for any risks or damages.)
