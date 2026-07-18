// providers/inference.js
// Inference.net Provider — $10 free credits, diverse model catalog, specialized models

import { BaseProvider } from './base.js';

const PROVIDER_CONFIG_INFERENCE = {
  name: 'inference',
  displayName: 'Inference.net',
  priority: 1,
  baseUrl: 'https://api.inference.net/v1',
  timeout: 30000,
  models: [
    { id: 'deepseek-v3', type: 'reasoning', description: 'DeepSeek V3 — strong reasoning', maxTokens: 65536 },
    { id: 'deepseek-v3-0324', type: 'reasoning', description: 'DeepSeek V3-0324 — updated', maxTokens: 65536 },
    { id: 'deepseek-r1', type: 'reasoning', description: 'DeepSeek R1 — reasoning specialist', maxTokens: 65536 },
    { id: 'deepseek-r1-0528', type: 'reasoning', description: 'DeepSeek R1-0528 — latest R1', maxTokens: 65536 },
    { id: 'meta-llama-3.3-70b', type: 'general', description: 'Llama 3.3 70B — general purpose', maxTokens: 65536 },
    { id: 'meta-llama-3.1-70b', type: 'general', description: 'Llama 3.1 70B — reliable general', maxTokens: 65536 },
    { id: 'meta-llama-3.2-1b', type: 'fast', description: 'Llama 3.2 1B — ultra fast', maxTokens: 8192 },
    { id: 'meta-llama-3.2-3b', type: 'fast', description: 'Llama 3.2 3B — fast', maxTokens: 8192 },
    { id: 'mistral-nemo-12b', type: 'fast', description: 'Mistral Nemo 12B — fast Mistral', maxTokens: 32768 },
    { id: 'google-gemma-3-27b', type: 'general', description: 'Gemma 3 27B — Google open model', maxTokens: 8192 },
    { id: 'qwen-2.5-72b', type: 'general', description: 'Qwen 2.5 72B — Alibaba model', maxTokens: 32768 },
    { id: 'qwq-32b', type: 'reasoning', description: 'QwQ 32B — Qwen reasoning model', maxTokens: 65536 },
    { id: 'qwen3-30b', type: 'general', description: 'Qwen 3 30B — latest Qwen', maxTokens: 65536 },
    { id: 'gpt-oss-120b', type: 'general', description: 'GPT-OSS 120B — open LLM', maxTokens: 65536 },
    { id: 'schematron', type: 'specialized', description: 'Schematron — HTML→JSON extraction', maxTokens: 8192 }
  ]
};

export class InferenceProvider extends BaseProvider {
  constructor(config = {}) {
    const cfg = { ...PROVIDER_CONFIG_INFERENCE, ...config };
    super(cfg);
    this.baseUrl = cfg.baseUrl || 'https://api.inference.net/v1';
    this.apiKey = process.env.INFERENCE_API_KEY || '';
    if (!this.apiKey) {
      console.warn('[INFERENCE] No INFERENCE_API_KEY set — provider disabled. Get $10 free at inference.net');
      this.enabled = false;
    }
  }

  async chat(messages, options = {}) {
    const model = options.model || 'meta-llama-3.3-70b';
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
      throw new Error(`Inference.net API error ${response.status}: ${text}`);
    }

    const data = await response.json();
    if (options.format === 'anthropic') {
      const content = data.choices?.[0]?.message?.content || '';
      return this.formatAnthropicResponse(content, model, data.usage);
    }
    return data;
  }

  async chatStream(messages, options = {}) {
    const model = options.model || 'meta-llama-3.3-70b';
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
      throw new Error(`Inference.net stream error: ${response.status}`);
    }

    return response.body;
  }

  async checkHealth() {
    try {
      // Models endpoint works without auth for listing
      const response = await fetch(`${this.baseUrl}/models`, {
        signal: AbortSignal.timeout(10000)
      });
      return response.ok;
    } catch (err) {
      throw new Error(`Inference.net health check failed: ${err.message}`);
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
          description: m.id,
          maxTokens: 65536
        }));
      }
      return this.models;
    } catch {
      return this.models;
    }
  }

  _inferType(id) {
    const l = id.toLowerCase();
    if (l.includes('deepseek') || l.includes('r1') || l.includes('qwq')) return 'reasoning';
    if (l.includes('coder') || l.includes('code')) return 'code';
    if (l.includes('1b') || l.includes('3b') || l.includes('nemo')) return 'fast';
    if (l.includes('schematron') || l.includes('tagger')) return 'specialized';
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
