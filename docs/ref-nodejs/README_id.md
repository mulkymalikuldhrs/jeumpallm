# Jeumpa LLM v6.0.0

<p align="center">
  <strong>Hub Multi-LLM Gratis Terbesar</strong><br>
  API gateway kompatibel OpenAI/Anthropic dengan 378+ model dari 13 provider
</p>

---

## Apa itu Jeumpa LLM?

Jeumpa LLM adalah **gateway LLM gratis yang di-host sendiri** yang menyediakan satu endpoint kompatibel OpenAI/Anthropic untuk mengakses **378+ model AI** dari **13 provider** — tanpa API key untuk pengguna akhir.

Bayangkan ini sebagai **"Cloudflare Workers untuk AI"** — reverse proxy yang membungkus beberapa provider LLM gratis menjadi satu API terpadu.

### Mengapa Jeumpa LLM?

| Fitur | Jeumpa LLM | OpenRouter | LiteLLM |
|-------|-------------|------------|---------|
| Akses gratis (tanpa API key) | ✅ | ❌ | ❌ |
| Self-hosted | ✅ | ❌ | ✅ |
| MCP Server built-in | ✅ | ❌ | ❌ |
| AI Agent built-in | ✅ | ❌ | ❌ |
| Model tersedia | 378+ | 300+ | 100+ |
| Kompatibel OpenAI | ✅ | ✅ | ✅ |
| Dashboard | ✅ | ✅ | ❌ |
| Domain kustom | ✅ | ✅ | ✅ |

---

## Mulai Cepat

### 1. Clone & Install

```bash
git clone https://github.com/dhaher-labs/JeumpaLLM.git
cd Jeumpa LLM
npm install
```

### 2. Konfigurasi (opsional)

```bash
cp .env.example .env
# Edit .env sesuai kebutuhan (semua opsional)
```

### 3. Jalankan

```bash
npm start
# atau
node index.js
```

### 4. Gunakan

```python
# Python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3333/v1",
    api_key="your-key-here"  # atau kosongkan
)

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Halo!"}]
)
```

```bash
# cURL
curl http://localhost:3333/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Halo!"}]
  }'
```

---

## Fitur

### Fitur Inti

- **378+ Model** — Akses GPT-4o, Claude, Gemini, Llama, Mistral, dan lainnya
- **13 Provider** — Pollinations, OpenRouter, Groq, Google AI, dan lainnya
- **API Kompatibel OpenAI** — Pengganti langsung untuk OpenAI SDK
- **API Kompatibel Anthropic** — Bisa digunakan dengan Claude SDK
- **Streaming** — Response streaming real-time via SSE
- **Auto-Routing** — Pemilihan model cerdas berdasarkan tipe tugas
- **Failover** — Pergantian provider otomatis saat gagal
- **Rate Limiting** — Rate limiting built-in per-IP
- **MCP Server** — Dukungan Model Context Protocol
- **AI Agent** — Kemampuan agent built-in

### Fitur Dashboard

- **Overview** — Monitoring kesehatan provider real-time
- **Providers** — Status detail provider dan konfigurasi
- **Models** — Katalog model lengkap dengan filter
- **Playground** — Chat interaktif dengan model apapun
- **Compare** — Perbandingan model side-by-side
- **Analytics** — Pelacakan request dan metrik performa
- **API Reference** — Dokumentasi API lengkap
- **Custom Domain** — Wizard setup domain
- **Settings** — Konfigurasi gateway

---

## API Reference

### Endpoint Utama

| Method | Path | Deskripsi |
|--------|------|-----------|
| POST | `/v1/chat/completions` | Chat completion (OpenAI-compatible) |
| POST | `/v1/messages` | Message creation (Anthropic-compatible) |
| GET | `/health` | Health check |
| GET | `/status` | Status server dan provider |
| GET | `/models` | Daftar semua model |
| GET | `/providers` | Detail provider |
| GET | `/logs` | Log request |
| POST | `/mcp` | MCP (Model Context Protocol) |
| GET | `/dashboard` | Dashboard web |

### Contoh Request

```bash
curl -X POST http://localhost:3333/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [
      {"role": "system", "content": "Kamu adalah asisten yang membantu."},
      {"role": "user", "content": "Apa ibu kota Indonesia?"}
    ],
    "temperature": 0.7,
    "max_tokens": 100
  }'
```

---

## Provider

| Provider | Model | Status |
|----------|-------|--------|
| Puter.js SDK | 14 | ⚠️ Rate limited |
| Pollinations AI | 6 | ✅ Healthy |
| OpenRouter Free | 337 | ✅ Healthy |
| Groq | 16 | ✅ Healthy |
| Google AI Studio | 4 | ✅ Healthy |
| G4F/FreeGPT | 3 | ✅ Healthy |
| Blackbox AI | 2 | ✅ Healthy |
| Phind | 1 | ✅ Healthy |

---

## Konfigurasi

Semua konfigurasi via environment variable di `.env`:

```bash
# Server
PORT=3333
NODE_ENV=production

# CORS
CORS_ORIGIN=*  # atau domain spesifik

# Rate Limiting
RATELIMIT_WINDOW_MS=60000
RATELIMIT_MAX_REQUESTS=100

# Logging
LOG_LEVEL=info  # info atau debug

# API Key (opsional)
API_KEY=your-secret-key
```

---

## Domain Kustom

1. Deploy Jeumpa LLM ke server Anda
2. Arahkan domain ke server (DNS A record)
3. Set `CORS_ORIGIN=https://domainanda.com` di `.env`
4. Gunakan `https://domainanda.com/v1` sebagai base URL

### Contoh

```python
# Python
client = OpenAI(base_url="https://api.domainanda.com/v1")

# Node.js
const client = new OpenAI({ baseURL: "https://api.domainanda.com/v1" });
```

---

## Lisensi

MIT License

---

## Dukungan

- **GitHub Issues**: [github.com/mulkymalikuldhrs/Jeumpa LLM/issues](https://github.com/dhaher-labs/JeumpaLLM/issues)
- **Dokumentasi**: [API.md](API.md) | [ARCHITECTURE.md](ARCHITECTURE.md)

---

<p align="center">
  Dibuat dengan ❤️ oleh <a href="https://github.com/mulkymalikuldhrs">Mulky Malikul Dhaher</a>
</p>
