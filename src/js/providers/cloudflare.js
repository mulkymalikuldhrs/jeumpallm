// providers/cloudflare.js
// Cloudflare Workers AI Provider — edge inference, 40+ models

import { BaseProvider } from './base.js';

const PROVIDER_CONFIG_CF = {
  name: 'cloudflare',
  displayName: 'Cloudflare Workers AI',
  priority: 2,
  baseUrl: 'https://api.cloudflare.com/client/v4/accounts',
  timeout: 30000,
  models: [
    { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', type: 'general', description: 'Llama 3.3 70B on Cloudflare', maxTokens: 8192 },
    { id: '@cf/qwen/qwen3-32b', type: 'general', description: 'Qwen 3 32B on Cloudflare', maxTokens: 8192 },
    { id: '@cf/google/gemma-3-27b-it', type: 'general', description: 'Gemma 3 27B on Cloudflare', maxTokens: 8192 },
    { id: '@cf/mistralai/mistral-small-3.1-24b-instruct', type: 'fast', description: 'Mistral Small 3.1 on Cloudflare', maxTokens: 8192 }
  ]
};

export class CloudflareProvider extends BaseProvider {
  constructor(config = {}) {
    const cfg = { ...PROVIDER_CONFIG_CF, ...config };
    super(cfg);
    this.accountId = process.env.CLOUDFLARE_ACCOUNT_ID || '';
    this.apiToken = process.env.CLOUDFLARE_API_TOKEN || '';
    if (!this.accountId || !this.apiToken) {
      console.warn('[CLOUDFLARE] CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN not set — provider disabled');
      this.enabled = false;
    }
  }

  async chat(messages, options = {}) {
    const model = options.model || '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
    const url = `${this.baseUrl}/${this.accountId}/ai/run/${model}`;

    const body = {
      messages: this._formatMessages(messages),
      max_tokens: options.max_tokens || 4096
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiToken}`
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeout)
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Cloudflare AI error ${response.status}: ${text}`);
    }

    const data = await response.json();
    const content = data.result?.response || data.result?.content || '';

    if (options.format === 'anthropic') {
      return this.formatAnthropicResponse(content, model);
    }
    return this.formatOpenAIResponse(content, model);
  }

  async chatStream(messages, options = {}) {
    // Cloudflare streaming uses SSE
    const model = options.model || '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
    const url = `${this.baseUrl}/${this.accountId}/ai/run/${model}`;

    const body = {
      messages: this._formatMessages(messages),
      stream: true
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiToken}`
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error(`Cloudflare stream error: ${response.status}`);
    }

    return this._transformStream(response.body, model);
  }

  async *_transformStream(readableStream, model) {
    const reader = readableStream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (!data || data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            const content = parsed.response || parsed.content || '';
            if (content) {
              yield {
                id: 'chatcmpl-cf-' + Date.now(),
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model,
                choices: [{ index: 0, delta: { content }, finish_reason: null }]
              };
            }
          } catch {}
        }
      }
    }
  }

  async checkHealth() {
    try {
      // Simple health check — just verify API credentials
      const response = await fetch(`${this.baseUrl}/${this.accountId}/ai/models/search`, {
        headers: { 'Authorization': `Bearer ${this.apiToken}` },
        signal: AbortSignal.timeout(10000)
      });
      return response.ok;
    } catch (err) {
      throw new Error(`Cloudflare health check failed: ${err.message}`);
    }
  }

  _formatMessages(messages) {
    if (!Array.isArray(messages)) return messages;
    return messages.map(m => ({
      role: m.role || 'user',
      content: typeof m.content === 'string' ? m.content : String(m.content || '')
    }));
  }
}
