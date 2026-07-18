# Jeumpa LLM v6.0.0

<p align="center">
  <strong>最大的免费多LLM中心</strong><br>
  OpenAI/Anthropic兼容的API网关，支持13个提供商的378+模型
</p>

---

## 什么是Jeumpa LLM？

Jeumpa LLM是一个**免费的自托管LLM网关**，提供单一的OpenAI/Anthropic兼容端点，用于访问来自**13个提供商**的**378+AI模型**——最终用户无需API密钥。

可以将其想象为**"AI版的Cloudflare Workers"**——一个反向代理，将多个免费LLM提供商包装成一个统一的API。

### 为什么选择Jeumpa LLM？

| 功能 | Jeumpa LLM | OpenRouter | LiteLLM |
|------|-------------|------------|---------|
| 免费访问（无需API密钥） | ✅ | ❌ | ❌ |
| 自托管 | ✅ | ❌ | ✅ |
| 内置MCP服务器 | ✅ | ❌ | ❌ |
| 内置AI代理 | ✅ | ❌ | ❌ |
| 可用模型 | 378+ | 300+ | 100+ |
| OpenAI兼容 | ✅ | ✅ | ✅ |
| 仪表板 | ✅ | ✅ | ❌ |
| 自定义域名 | ✅ | ✅ | ✅ |

---

## 快速开始

### 1. 克隆并安装

```bash
git clone https://github.com/dhaher-labs/JeumpaLLM.git
cd Jeumpa LLM
npm install
```

### 2. 配置（可选）

```bash
cp .env.example .env
# 根据需要编辑.env（所有选项都是可选的）
```

### 3. 启动

```bash
npm start
# 或
node index.js
```

### 4. 使用

```python
# Python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3333/v1",
    api_key="your-key-here"  # 或留空
)

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "你好！"}]
)
```

```bash
# cURL
curl http://localhost:3333/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "你好！"}]
  }'
```

---

## 功能

### 核心功能

- **378+模型** — 访问GPT-4o、Claude、Gemini、Llama、Mistral等
- **13个提供商** — Pollinations、OpenRouter、Groq、Google AI等
- **OpenAI兼容API** — OpenAI SDK的直接替代品
- **Anthropic兼容API** — 可与Claude SDK一起使用
- **流式传输** — 通过SSE实时流式响应
- **自动路由** — 基于任务类型的智能模型选择
- **故障转移** — 失败时自动切换提供商
- **速率限制** — 内置每IP速率限制
- **MCP服务器** — 模型上下文协议支持
- **AI代理** — 内置代理功能

### 仪表板功能

- **概览** — 实时提供商健康监控
- **提供商** — 详细提供商状态和配置
- **模型** — 完整模型目录，支持过滤
- **游乐场** — 与任何模型交互式聊天
- **比较** — 并排模型比较
- **分析** — 请求跟踪和性能指标
- **API参考** — 完整API文档
- **自定义域名** — 域名设置向导
- **设置** — 网关配置

---

## API参考

### 主要端点

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/v1/chat/completions` | 聊天补全（OpenAI兼容） |
| POST | `/v1/messages` | 消息创建（Anthropic兼容） |
| GET | `/health` | 健康检查 |
| GET | `/status` | 服务器和提供商状态 |
| GET | `/models` | 所有可用模型列表 |
| GET | `/providers` | 提供商详情 |
| GET | `/logs` | 请求日志 |
| POST | `/mcp` | MCP（模型上下文协议） |
| GET | `/dashboard` | Web仪表板 |

---

## 提供商

| 提供商 | 模型 | 状态 |
|--------|------|------|
| Puter.js SDK | 14 | ⚠️ 速率限制 |
| Pollinations AI | 6 | ✅ 健康 |
| OpenRouter Free | 337 | ✅ 健康 |
| Groq | 16 | ✅ 健康 |
| Google AI Studio | 4 | ✅ 健康 |
| G4F/FreeGPT | 3 | ✅ 健康 |
| Blackbox AI | 2 | ✅ 健康 |
| Phind | 1 | ✅ 健康 |

---

## 配置

所有配置通过`.env`中的环境变量：

```bash
# 服务器
PORT=3333
NODE_ENV=production

# CORS
CORS_ORIGIN=*  # 或特定域名

# 速率限制
RATELIMIT_WINDOW_MS=60000
RATELIMIT_MAX_REQUESTS=100

# 日志
LOG_LEVEL=info  # info或debug

# API密钥（可选）
API_KEY=your-secret-key
```

---

## 自定义域名

1. 将Jeumpa LLM部署到您的服务器
2. 将您的域名指向服务器（DNS A记录）
3. 在`.env`中设置`CORS_ORIGIN=https://yourdomain.com`
4. 使用`https://yourdomain.com/v1`作为基础URL

### 示例

```python
# Python
client = OpenAI(base_url="https://api.yourdomain.com/v1")

# Node.js
const client = new OpenAI({ baseURL: "https://api.yourdomain.com/v1" });
```

---

## 许可证

MIT许可证

---

## 支持

- **GitHub Issues**: [github.com/mulkymalikuldhrs/Jeumpa LLM/issues](https://github.com/dhaher-labs/JeumpaLLM/issues)
- **文档**: [API.md](API.md) | [ARCHITECTURE.md](ARCHITECTURE.md)

---

<p align="center">
  由 <a href="https://github.com/mulkymalikuldhrs">Mulky Malikul Dhaher</a> 用 ❤️ 制作
</p>
