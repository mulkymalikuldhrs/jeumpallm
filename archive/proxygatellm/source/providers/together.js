// providers/together.js
// Together AI Provider — $25 free credits, 80+ free models, best value free tier

import { BaseProvider } from './base.js';

const PROVIDER_CONFIG_TOGETHER = {
  name: 'together',
  displayName: 'Together AI',
  priority: 1,
  baseUrl: 'https://api.together.xyz/v1',
  timeout: 30000,
  models: [
    { id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', type: 'general', description: 'Llama 3.3 70B — best general', maxTokens: 65536 },
    { id: 'meta-llama/Llama-3.1-405B-Instruct-Turbo', type: 'general', description: 'Llama 3.1 405B — largest open model', maxTokens: 131072 },
    { id: 'meta-llama/Llama-3.2-90B-Vision-Instruct-Turbo', type: 'vision', description: 'Llama 3.2 90B Vision', maxTokens: 65536 },
    { id: 'meta-llama/Llama-4-Scout-17B-16E-Instruct', type: 'fast', description: 'Llama 4 Scout — fast & capable', maxTokens: 65536 },
    { id: 'Qwen/Qwen3-235B-A22B', type: 'reasoning', description: 'Qwen 3 235B MoE — strong reasoning', maxTokens: 262144 },
    { id: 'Qwen/Qwen3-32B', type: 'general', description: 'Qwen 3 32B — balanced', maxTokens: 131072 },
    { id: 'mistralai/Mistral-Small-3.2-24B-Instruct', type: 'fast', description: 'Mistral Small 3.2 24B — fast', maxTokens: 131072 },
    { id: 'mistralai/Mixtral-8x22B-Instruct-v0.1', type: 'general', description: 'Mixtral 8x22B — strong MoE', maxTokens: 65536 },
    { id: 'google/gemma-3-27b-it', type: 'general', description: 'Gemma 3 27B IT — Google open model', maxTokens: 8192 },
    { id: 'google/gemma-4-26b-it', type: 'general', description: 'Gemma 4 26B IT — latest Google model', maxTokens: 16384 },
    { id: 'nvidia/Nemotron-3-Super-120B-A12B', type: 'reasoning', description: 'Nemotron 3 Super 120B — Nvidia reasoning', maxTokens: 131072 },
    { id: 'deepseek-ai/DeepSeek-V3.1-671B', type: 'reasoning', description: 'DeepSeek V3.1 671B — strong reasoning', maxTokens: 65536 },
    { id: 'nvidia/Llama-3.3-Cogito-v1-70B', type: 'general', description: 'Cogito v1 70B — Nvidia trained Llama', maxTokens: 65536 },
    { id: 'nvidia/Llama-3.3-Cogito-v1-8B', type: 'fast', description: 'Cogito v1 8B — fast Nvidia model', maxTokens: 65536 },
    { id: 'Gryphe/MythoMax-L2-13b-L2', type: 'creative', description: 'MythoMax — creative writing', maxTokens: 4096 },
  ]
};

export class TogetherProvider extends BaseProvider {
  constructor(config = {}) {
    const cfg = { ...PROVIDER_CONFIG_TOGETHER, ...config };
    super(cfg);
    this.baseUrl = cfg.baseUrl || 'https://api.together.xyz/v1';
    this.apiKey = process.env.TOGETHER_API_KEY || '';
    if (!this.apiKey) {
      console.warn('[TOGETHER] No TOGETHER_API_KEY set — provider disabled. Get free at together.ai');
      this.enabled = false;
    }
  }

  async chat(messages, options = {}) {
    const model = options.model || 'meta-llama/Llama-3.3-70B-Instruct-Turbo';
    const url = `${this.baseUrl}/chat/completions`;

    const body = {
      model,
      messages: this._formatMessages(messages),
      stream: false,
      max_tokens: options.max_tokens || 4096,
      temperature: options.temperature ?? 0.7,
      top_p: options.top_p ?? 0.9
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
      throw new Error(`Together AI API error ${response.status}: ${text}`);
    }

    const data = await response.json();
    if (options.format === 'anthropic') {
      const content = data.choices?.[0]?.message?.content || '';
      return this.formatAnthropicResponse(content, model, data.usage);
    }
    return data;
  }

  async chatStream(messages, options = {}) {
    const model = options.model || 'meta-llama/Llama-3.3-70B-Instruct-Turbo';
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
      throw new Error(`Together AI stream error: ${response.status}`);
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
      throw new Error(`Together AI health check failed: ${err.message}`);
    }
  }

  async fetchModels() {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) return this.models;
      const data = await response.json();
      if (data?.data) {
        return data.data.map(m => ({
          id: m.id,
          type: this._inferType(m.id, m.description || ''),
          description: m.description || m.id,
          maxTokens: m.max_tokens || 8192
        }));
      }
      return this.models;
    } catch {
      return this.models;
    }
  }

  _inferType(id, desc) {
    const l = (id + ' ' + desc).toLowerCase();
    if (l.includes('vision') || l.includes('multimodal')) return 'vision';
    if (l.includes('coder') || l.includes('code')) return 'code';
    if (l.includes('reason') || l.includes('deepseek') || l.includes('qwen3-235b')) return 'reasoning';
    if (l.includes('8b') || l.includes('scout') || l.includes('small')) return 'fast';
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
