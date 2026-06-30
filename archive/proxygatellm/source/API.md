# Jeumpa LLM API Reference

Complete API reference for Jeumpa LLM v6.0.0 — The Biggest Free Multi-LLM Hub.

---

## Base URL

```
http://localhost:3333
```

For production with custom domain:
```
https://api.yourdomain.com
```

---

## Authentication

Authentication is **optional**. If `API_KEY` is set in `.env`, include it in requests:

```
Authorization: Bearer your-api-key
```

If no `API_KEY` is configured, all requests are accepted without authentication.

---

## OpenAI-Compatible Endpoints

### POST /v1/chat/completions

Create a chat completion.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| model | string | Yes | Model ID (e.g., "gpt-4o", "claude-sonnet-4") |
| messages | array | Yes | Array of message objects |
| stream | boolean | No | Enable streaming (default: false) |
| temperature | number | No | Sampling temperature (0-2) |
| max_tokens | integer | No | Maximum tokens to generate |
| top_p | number | No | Nucleus sampling parameter |
| frequency_penalty | number | No | Frequency penalty (-2 to 2) |
| presence_penalty | number | No | Presence penalty (-2 to 2) |

**Message Object:**

```json
{
  "role": "system" | "user" | "assistant",
  "content": "Message content"
}
```

**Example Request:**

```bash
curl -X POST http://localhost:3333/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "What is the capital of France?"}
    ],
    "temperature": 0.7,
    "max_tokens": 100
  }'
```

**Example Response:**

```json
{
  "id": "chatcmpl-abc123",
  "object": "chat.completion",
  "created": 1717800000,
  "model": "gpt-4o",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "The capital of France is Paris."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 25,
    "completion_tokens": 8,
    "total_tokens": 33
  }
}
```

### POST /v1/chat/completions (Streaming)

Enable streaming by setting `"stream": true`.

**Example:**

```bash
curl -X POST http://localhost:3333/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Tell me a story"}],
    "stream": true
  }'
```

**Response (SSE):**

```
data: {"id":"chatcmpl-123","choices":[{"delta":{"content":"Once"},"index":0}]}

data: {"id":"chatcmpl-123","choices":[{"delta":{"content":" upon"},"index":0}]}

data: [DONE]
```

---

## Anthropic-Compatible Endpoints

### POST /v1/messages

Create a message (Anthropic API format).

**Request Body:**

```json
{
  "model": "claude-sonnet-4",
  "max_tokens": 1024,
  "messages": [
    {"role": "user", "content": "Hello!"}
  ]
}
```

**Example:**

```bash
curl -X POST http://localhost:3333/v1/messages \
  -H "Content-Type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "claude-sonnet-4",
    "max_tokens": 100,
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

---

## Utility Endpoints

### GET /health

Health check endpoint.

**Response:**

```json
{
  "status": "ok",
  "uptime": 3600.5,
  "timestamp": "2026-06-08T00:00:00.000Z",
  "version: 6.0.0"
}
```

### GET /status

Server and provider status.

**Response:**

```json
{
  "status": "ok",
  "version: 6.0.0",
  "uptime": 3600,
  "providers": {
    "enabled": 8,
    "total": 13,
    "healthy": 6
  },
  "models": {
    "total": 378,
    "available": 350
  }
}
```

### GET /models

List all available models.

**Response:**

```json
{
  "object": "list",
  "data": [
    {
      "id": "gpt-4o",
      "object": "model",
      "created": 1717800000,
      "owned_by": "openai",
      "providers": ["g4f", "puter"]
    },
    {
      "id": "claude-sonnet-4",
      "object": "model",
      "created": 1717800000,
      "owned_by": "anthropic",
      "providers": ["puter"]
    }
  ]
}
```

### GET /providers

List all providers with stats.

**Response:**

```json
{
  "enabled": 8,
  "total": 13,
  "providers": [
    {
      "name": "pollinations",
      "displayName": "Pollinations AI",
      "healthStatus": "healthy",
      "modelCount": 6,
      "priority": 1,
      "stats": {
        "requests": 1234,
        "errors": 5,
        "avgLatency": 1500
      }
    }
  ]
}
```

### GET /logs

Get request logs.

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| limit | integer | 100 | Max logs to return |
| offset | integer | 0 | Pagination offset |

**Response:**

```json
{
  "total": 1234,
  "offset": 0,
  "limit": 100,
  "logs": [
    {
      "timestamp": "2026-06-08T00:00:00.000Z",
      "method": "POST",
      "path": "/v1/chat/completions",
      "model": "gpt-4o",
      "status": 200,
      "latency_ms": 1234,
      "ip": "::1"
    }
  ]
}
```

### POST /mcp

MCP (Model Context Protocol) endpoint.

**Request:**

```json
{
  "jsonrpc": "2.0",
  "method": "tools/list",
  "id": 1
}
```

**Response:**

```json
{
  "jsonrpc": "2.0",
  "result": {
    "tools": [
      {
        "name": "chat",
        "description": "Send a chat completion request",
        "inputSchema": {
          "type": "object",
          "properties": {
            "model": { "type": "string" },
            "message": { "type": "string" }
          }
        }
      }
    ]
  },
  "id": 1
}
```

---

## Error Responses

All errors follow OpenAI-compatible format:

```json
{
  "error": {
    "message": "Invalid model specified",
    "type": "invalid_request_error",
    "param": "model",
    "code": "model_not_found"
  }
}
```

**HTTP Status Codes:**

| Code | Description |
|------|-------------|
| 200 | Success |
| 400 | Bad request (invalid parameters) |
| 401 | Unauthorized (invalid API key) |
| 404 | Not found |
| 429 | Rate limit exceeded |
| 500 | Internal server error |

---

## Rate Limiting

Default: 100 requests per minute per IP.

Configure via environment variables:

```bash
RATELIMIT_WINDOW_MS=60000      # Window in milliseconds
RATELIMIT_MAX_REQUESTS=100     # Max requests per window
```

When rate limited:

```json
{
  "error": "Rate limit exceeded. Try again in 30 seconds.",
  "type": "rate_limit_error"
}
```

---

## Supported Models

### Default Models (auto-selected)

| Task Type | Model |
|-----------|-------|
| Code | claude-opus-4-5-latest |
| Planning | deepseek-chat |
| Reasoning | gpt-4o |
| Fast/Short | gpt-4o-mini |
| Default | deepseek-chat |

### Model Aliases

| Alias | Maps To |
|-------|---------|
| gpt4 | gpt-4o |
| gpt4o | gpt-4o |
| gpt4-mini | gpt-4o-mini |
| claude | claude-opus-4-5-latest |
| claude-sonnet | claude-sonnet-4 |
| deepseek | deepseek-chat |
| gemini | gemini-2.0-flash |
| grok | grok-3 |

---

## Python Examples

### Basic Usage

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3333/v1",
    api_key="your-key"  # optional
)

# Simple completion
response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Hello!"}]
)
print(response.choices[0].message.content)
```

### Streaming

```python
stream = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Tell me a story"}],
    stream=True
)

for chunk in stream:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="")
```

### Using Different Models

```python
# GPT-4o
response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Hello!"}]
)

# Claude
response = client.chat.completions.create(
    model="claude-sonnet-4",
    messages=[{"role": "user", "content": "Hello!"}]
)

# Gemini
response = client.chat.completions.create(
    model="gemini-2.0-flash",
    messages=[{"role": "user", "content": "Hello!"}]
)
```

---

## Node.js Examples

```javascript
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'http://localhost:3333/v1',
  apiKey: 'your-key'  // optional
});

// Simple completion
const response = await client.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Hello!' }]
});

console.log(response.choices[0].message.content);

// Streaming
const stream = await client.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Tell me a story' }],
  stream: true
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content || '');
}
```

---

## Custom Domain Setup

1. Deploy Jeumpa LLM to your server
2. Point your domain to the server (DNS A record)
3. Configure CORS in `.env`:
   ```bash
   CORS_ORIGIN=https://yourdomain.com
   ```
4. Use as base URL:
   ```
   https://yourdomain.com/v1
   ```

### Behind Reverse Proxy (Nginx)

```nginx
server {
    listen 443 ssl;
    server_name api.yourdomain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3333;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```
