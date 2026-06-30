// providers/cerebras.js
// Cerebras Provider — fastest inference speed, free tier

import { BaseProvider } from './base.js';

const PROVIDER_CONFIG_CEREBRAS = {
  name: 'cerebras',
  displayName: 'Cerebras',
  priority: 2,
  baseUrl: 'https://api.cerebras.ai/v1',
  timeout: 15000,
  models: [
    { id: 'llama-4-scout-17b-16e-instruct', type: 'fast', description: 'Llama 4 Scout on Cerebras — ultra-fast', maxTokens: 8192 },
    { id: 'llama3.1-8b', type: 'fast', description: 'Llama 3.1 8B on Cerebras — fastest', maxTokens: 8192 },
    { id: 'llama3.1-70b', type: 'general', description: 'Llama 3.1 70B on Cerebras', maxTokens: 8192 }
  ]
};

export class CerebrasProvider extends BaseProvider {
  constructor(config = {}) {
    const cfg = { ...PROVIDER_CONFIG_CEREBRAS, ...config };
    super(cfg);
    this.baseUrl = cfg.baseUrl || 'https://api.cerebras.ai/v1';
    this.apiKey = process.env.CEREBRAS_API_KEY || '';
    if (!this.apiKey) {
      console.warn('[CEREBRAS] No CEREBRAS_API_KEY set — provider disabled');
      this.enabled = false;
    }
  }

  async chat(messages, options = {}) {
    const model = options.model || 'llama3.1-8b';
    const url = `${this.baseUrl}/chat/completions`;

    const body = {
      model,
      messages: this._formatMessages(messages),
      stream: false,
      max_tokens: options.max_tokens || 4096
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeout)
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Cerebras API error ${response.status}: ${text}`);
    }

    const data = await response.json();
    if (options.format === 'anthropic') {
      const content = data.choices?.[0]?.message?.content || '';
      return this.formatAnthropicResponse(content, model, data.usage);
    }
    return data;
  }

  async chatStream(messages, options = {}) {
    const model = options.model || 'llama3.1-8b';
    const url = `${this.baseUrl}/chat/completions`;

    const body = {
      model,
      messages: this._formatMessages(messages),
      stream: true
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error(`Cerebras stream error: ${response.status}`);
    }

    return response.body;
  }

  async checkHealth() {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(10000)
      });
      return response.ok;
    } catch (err) {
      throw new Error(`Cerebras health check failed: ${err.message}`);
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
