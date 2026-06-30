# Getting Started Tutorial

<div align="center">

[![Quick Start](https://img.shields.io/badge/Quick_Start-5_Minutes-2E9EF7?style=for-the-badge)](https://github.com/dhaher-labs/JeumpaLLM)
[![Node.js](https://img.shields.io/badge/Node.js-22.x-339933?style=for-the-badge&logo=node.js)](https://nodejs.org/)

**Step-by-step guide to get Jeumpa LLM running**

</div>

---

## 🇬🇧 English

### Prerequisites

- **Node.js 18+** (recommended: 22.x)
- **npm** (comes with Node.js)
- **Git**
- **Puter account** (optional, for Puter.js provider) — [Sign up free](https://puter.com/)

### Step 1: Clone & Install

```bash
# Clone the repository
git clone https://github.com/dhaher-labs/JeumpaLLM.git
cd Jeumpa LLM

# Install dependencies
npm install
```

### Step 2: Configure Environment

```bash
# Copy the example environment file
cp .env.example .env

# Edit .env with your settings
```

Your `.env` file should look like this:

```env
# ── Puter.js Authentication ──────────────────────────────
# Get your free token at: https://puter.com/#/account
# Required for: Qwen provider, Puter.js provider (18+ models)
# Not required for: Z.ai provider
PUTER_AUTH_TOKEN=your_puter_token_here

# ── Server Configuration ─────────────────────────────────
PORT=3333
NODE_ENV=development

# ── Logging ──────────────────────────────────────────────
LOG_LEVEL=info
```

### Step 3: Start the Server

```bash
# Production mode
npm start

# Development mode (auto-restart on file changes)
npm run dev
```

You should see:

```
╔══════════════════════════════════════════════════════════╗
║       JeumpaLLM v1.0.0 — Multi-LLM Gateway            ║
╠══════════════════════════════════════════════════════════╣
║  Server: http://localhost:3333                           ║
║  ...                                                     ║
╚══════════════════════════════════════════════════════════╝
```

### Step 4: Test the Gateway

**Quick health check:**
```bash
curl http://localhost:3333/health
```

**Test auto-routed chat:**
```bash
curl -X POST http://localhost:3333/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "Hello, how are you?"}
    ]
  }'
```

**Test code generation (auto-routes to Qwen):**
```bash
curl -X POST http://localhost:3333/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "Write a Python function to calculate fibonacci numbers"}
    ]
  }'
```

**Test reasoning (auto-routes to Z.ai):**
```bash
curl -X POST http://localhost:3333/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "Explain step by step why the sky is blue"}
    ]
  }'
```

### Step 5: Use Specific Providers

**Direct Z.ai (no token required):**
```bash
curl -X POST http://localhost:3333/zai/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "Analyze this problem logically"}
    ]
  }'
```

**Direct Qwen (requires Puter token):**
```bash
curl -X POST http://localhost:3333/qwen/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "Write a REST API in Express.js"}
    ]
  }'
```

### Step 6: Use Streaming

Add `"stream": true` to any request for real-time token delivery:

```bash
curl -X POST http://localhost:3333/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "Tell me a long story"}
    ],
    "stream": true
  }'
```

### Step 7: Check Routing Decisions

See where your query would be routed without executing it:

```bash
curl -X POST http://localhost:3333/route \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "Debug this JavaScript function"}
    ]
  }'
```

### Step 8: Use OpenAI-Compatible Format

Jeumpa LLM is a drop-in replacement for OpenAI API:

```javascript
// Works with any OpenAI SDK — just change the baseURL
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'http://localhost:3333/v1',
  apiKey: 'not-needed',  // Jeumpa LLM doesn't require API keys
});

const response = await client.chat.completions.create({
  model: 'auto',  // or specify: gpt-4o, deepseek-chat, etc.
  messages: [
    { role: 'user', content: 'Hello from OpenAI SDK!' }
  ],
});

console.log(response.choices[0].message.content);
```

### Step 9: Use Anthropic-Compatible Format

```javascript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  baseURL: 'http://localhost:3333/v1',
  apiKey: 'not-needed',
});

const response = await client.messages.create({
  model: 'claude-opus-4-5-latest',
  max_tokens: 1024,
  messages: [
    { role: 'user', content: 'Hello from Anthropic SDK!' }
  ],
});

console.log(response.content[0].text);
```

### Step 10: Docker Deployment

```bash
# Build and run with Docker
docker build -t Jeumpa LLM .
docker run -p 3333:3333 --env-file .env Jeumpa LLM
```

---

## 🇮🇩 Bahasa Indonesia

### Prasyarat

- **Node.js 18+** (disarankan: 22.x)
- **npm** (terinstal bersama Node.js)
- **Git**
- **Akun Puter** (opsional, untuk provider Puter.js) — [Daftar gratis](https://puter.com/)

### Langkah 1: Clone & Install

```bash
git clone https://github.com/dhaher-labs/JeumpaLLM.git
cd Jeumpa LLM
npm install
```

### Langkah 2: Konfigurasi Lingkungan

```bash
cp .env.example .env
# Edit .env dengan token Puter Anda (opsional untuk Z.ai)
```

### Langkah 3: Mulai Server

```bash
npm start     # Mode produksi
npm run dev   # Mode pengembangan (auto-restart)
```

### Langkah 4: Uji Gateway

```bash
# Cek kesehatan
curl http://localhost:3333/health

# Chat auto-routing
curl -X POST http://localhost:3333/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Halo, apa kabar?"}]}'
```

### Langkah 5: Gunakan Provider Tertentu

```bash
# Z.ai langsung (tanpa token)
curl -X POST http://localhost:3333/zai/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Analisis masalah ini"}]}'

# Qwen langsung (butuh token Puter)
curl -X POST http://localhost:3333/qwen/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Tulis REST API Express.js"}]}'
```

### Langkah 6: Gunakan Streaming

```bash
curl -X POST http://localhost:3333/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Ceritakan cerita panjang"}],"stream":true}'
```

---

## 🇨🇳 中文

### 先决条件

- **Node.js 18+**（推荐：22.x）
- **npm**（随 Node.js 安装）
- **Git**
- **Puter 账户**（可选，用于 Puter.js 提供商）— [免费注册](https://puter.com/)

### 步骤 1：克隆与安装

```bash
git clone https://github.com/dhaher-labs/JeumpaLLM.git
cd Jeumpa LLM
npm install
```

### 步骤 2：配置环境

```bash
cp .env.example .env
# 编辑 .env 文件填入您的 Puter 令牌（Z.ai 不需要）
```

### 步骤 3：启动服务器

```bash
npm start     # 生产模式
npm run dev   # 开发模式（自动重启）
```

### 步骤 4：测试网关

```bash
# 健康检查
curl http://localhost:3333/health

# 自动路由聊天
curl -X POST http://localhost:3333/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"你好！"}]}'
```

### 步骤 5：使用特定提供商

```bash
# 直接使用 Z.ai（无需令牌）
curl -X POST http://localhost:3333/zai/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"逐步分析这个问题"}]}'

# 直接使用 Qwen（需要 Puter 令牌）
curl -X POST http://localhost:3333/qwen/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"用 Express.js 写一个 REST API"}]}'
```

---

<div align="center">

**Next: [PROVIDERS.md](PROVIDERS.md) — Detailed provider tutorials**

</div>

---

> **Contact:** Mulky Malikul Dhaher — [mulkymalikuldhaher@email.com](mailto:mulkymalikuldhaher@email.com)
>
> **Disclaimer:** This project is for Education Purpose only. Risiko apapun tidak kita tanggung. (We are not responsible for any risks or damages.)
