// providers/sambanova.js
// SambaNova Cloud Provider — $5 free credits, DeepSeek-V3.1, Llama-4, fast SN40L hardware

import { BaseProvider } from './base.js';

const PROVIDER_CONFIG_SAMBANOVA = {
  name: 'sambanova',
  displayName: 'SambaNova Cloud',
  priority: 1,
  baseUrl: 'https://api.sambanova.ai/v1',
  timeout: 30000,
  models: [
    { id: 'DeepSeek-V3.1-671B', type: 'reasoning', description: 'DeepSeek V3.1 671B — MoE reasoning', maxTokens: 131072 },
    { id: 'DeepSeek-V3.2-671B', type: 'reasoning', description: 'DeepSeek V3.2 671B — latest DeepSeek', maxTokens: 32768 },
    { id: 'Meta-Llama-3.3-70B-Instruct', type: 'general', description: 'Llama 3.3 70B — general purpose', maxTokens: 131072 },
    { id: 'Llama-4-Maverick-17B-16E', type: 'fast', description: 'Llama 4 Maverick — fast MoE', maxTokens: 65536 },
    { id: 'MiniMax-M2.7', type: 'reasoning', description: 'MiniMax M2.7 — strong reasoning', maxTokens: 196608 },
    { id: 'google-gemma-3-12b-it', type: 'fast', description: 'Gemma 3 12B — fast Google model', maxTokens: 8192 },
    { id: 'google-gemma-4-31b-it', type: 'general', description: 'Gemma 4 31B — latest Google model', maxTokens: 16384 },
    { id: 'gpt-oss-120b', type: 'general', description: 'GPT-OSS 120B — open source LLM', maxTokens: 131072 }
  ]
};

export class SambaNovaProvider extends BaseProvider {
  constructor(config = {}) {
    const cfg = { ...PROVIDER_CONFIG_SAMBANOVA, ...config };
    super(cfg);
    this.baseUrl = cfg.baseUrl || 'https://api.sambanova.ai/v1';
    this.apiKey = process.env.SAMBANOVA_API_KEY || process.env.SAMBANOVA_KEY || '';
    if (!this.apiKey) {
      console.warn('[SAMBANOVA] No SAMBANOVA_API_KEY set — provider disabled. Get $5 free at cloud.sambanova.ai');
      this.enabled = false;
    }
  }

  async chat(messages, options = {}) {
    const model = options.model || 'Meta-Llama-3.3-70B-Instruct';
    const url = `${this.baseUrl}/chat/completions`;

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
      throw new Error(`SambaNova API error ${response.status}: ${text}`);
    }

    const data = await response.json();
    if (options.format === 'anthropic') {
      const content = data.choices?.[0]?.message?.content || '';
      return this.formatAnthropicResponse(content, model, data.usage);
    }
    return data;
  }

  async chatStream(messages, options = {}) {
    const model = options.model || 'Meta-Llama-3.3-70B-Instruct';
    const url = `${this.baseUrl}/chat/completions`;

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
      throw new Error(`SambaNova stream error: ${response.status}`);
    }

    return response.body;
  }

  async checkHealth() {
    try {
      // SambaNova models endpoint works without auth for listing
      const response = await fetch(`${this.baseUrl}/models`, {
        signal: AbortSignal.timeout(10000)
      });
      return response.ok;
    } catch (err) {
      throw new Error(`SambaNova health check failed: ${err.message}`);
    }
  }

  async fetchModels() {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        signal: AbortSignal.timeout(10000)
      });
      if (!response.ok) return this.models;
      const data = await response.json();
      if (data?.data) {
        return data.data.map(m => ({
          id: m.id,
          type: this._inferType(m.id),
          description: `${m.id} on SambaNova`,
          maxTokens: 131072
        }));
      }
      return this.models;
    } catch {
      return this.models;
    }
  }

  _inferType(id) {
    const l = id.toLowerCase();
    if (l.includes('deepseek')) return 'reasoning';
    if (l.includes('minimax') || l.includes('m2.7')) return 'reasoning';
    if (l.includes('maverick') || l.includes('scout') || l.includes('12b') || l.includes('small')) return 'fast';
    return 'general';
  }

  _formatMessages(messages) {
    if (!Array.isArray(messages)) return messages;
    return messages.map(m => ({
      role: m.role || 'user',
      content: typeof m.content === 'string' ? m.content : String(m.content || '')
    }));
  }
}
