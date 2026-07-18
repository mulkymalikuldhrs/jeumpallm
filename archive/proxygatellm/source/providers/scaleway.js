// providers/scaleway.js
// Scaleway Generative APIs — EU-hosted, 1M free tokens + 60 min audio, GDPR compliant

import { BaseProvider } from './base.js';

const PROVIDER_CONFIG_SCALEWAY = {
  name: 'scaleway',
  displayName: 'Scaleway Gen APIs',
  priority: 1,
  baseUrl: 'https://api.scaleway.ai/v1',
  timeout: 30000,
  models: [
    { id: 'qwen3.6-35b-a3b', type: 'general', description: 'Qwen 3.6 35B — MoE, good efficiency', maxTokens: 32768 },
    { id: 'gemma-4-26b-a4b-it', type: 'general', description: 'Gemma 4 26B — latest Google', maxTokens: 16384 },
    { id: 'mistral-medium-3.5-128b', type: 'reasoning', description: 'Mistral Medium 3.5 128B — strong', maxTokens: 131072 },
    { id: 'mistral-small-3.2-24b', type: 'fast', description: 'Mistral Small 3.2 24B — fast', maxTokens: 131072 },
    { id: 'devstral-2-123b', type: 'code', description: 'Devstral 2 123B — code specialist', maxTokens: 65536 },
    { id: 'qwen3-coder-30b-a3b', type: 'code', description: 'Qwen 3 Coder 30B — code expert', maxTokens: 32768 },
    { id: 'qwen3-vl-235b', type: 'vision', description: 'Qwen 3 VL 235B — multimodal', maxTokens: 65536 },
    { id: 'minimax-m2.5', type: 'reasoning', description: 'MiniMax M2.5 — reasoning model', maxTokens: 1048576 }
  ]
};

export class ScalewayProvider extends BaseProvider {
  constructor(config = {}) {
    const cfg = { ...PROVIDER_CONFIG_SCALEWAY, ...config };
    super(cfg);
    this.baseUrl = cfg.baseUrl || 'https://api.scaleway.ai/v1';
    this.apiKey = process.env.SCALEWAY_API_KEY || '';
    if (!this.apiKey) {
      console.warn('[SCALEWAY] No SCALEWAY_API_KEY set — provider disabled. Sign up at console.scaleway.com');
      this.enabled = false;
    }
  }

  async chat(messages, options = {}) {
    const model = options.model || 'mistral-small-3.2-24b';
    const url = `${this.baseUrl}/v1/chat/completions`;

    const body = {
      model,
      messages: this._formatMessages(messages),
      stream: false,
      max_tokens: options.max_tokens || 4096,
      temperature: options.temperature ?? 0.7
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
      throw new Error(`Scaleway API error ${response.status}: ${text}`);
    }

    const data = await response.json();
    if (options.format === 'anthropic') {
      const content = data.choices?.[0]?.message?.content || '';
      return this.formatAnthropicResponse(content, model, data.usage);
    }
    return data;
  }

  async chatStream(messages, options = {}) {
    const model = options.model || 'mistral-small-3.2-24b';
    const url = `${this.baseUrl}/v1/chat/completions`;

    const body = {
      model,
      messages: this._formatMessages(messages),
      stream: true,
      temperature: options.temperature ?? 0.7
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
      throw new Error(`Scaleway stream error: ${response.status}`);
    }

    return response.body;
  }

  async checkHealth() {
    try {
      const response = await fetch(`${this.baseUrl}/v1/models`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(10000)
      });
      return response.ok;
    } catch (err) {
      throw new Error(`Scaleway health check failed: ${err.message}`);
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
