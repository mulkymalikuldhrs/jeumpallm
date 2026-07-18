// providers/apiairforce.js
// Api.airforce Provider — free OpenAI-compatible API, 55+ free models, no signup

import { BaseProvider } from './base.js';
import { PROVIDER_CONFIG } from '../config/providers.js';

export class ApiAirforceProvider extends BaseProvider {
  constructor(config = {}) {
    const cfg = { ...PROVIDER_CONFIG.apiairforce, ...config };
    super(cfg);
    this.baseUrl = cfg.baseUrl || 'https://api.airforce/v1';
  }

  async chat(messages, options = {}) {
    const model = this._mapModel(options.model || 'gpt-4o-mini');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: this._formatMessages(messages),
          stream: false
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`ApiAirforce error ${response.status}: ${text}`);
      }

      const data = await response.json();
      if (options.format === 'anthropic') {
        const content = data.choices?.[0]?.message?.content || '';
        return this.formatAnthropicResponse(content, model);
      }
      return data;
    } finally {
      clearTimeout(timeout);
    }
  }

  async chatStream(messages, options = {}) {
    const model = this._mapModel(options.model || 'gpt-4o-mini');
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: this._formatMessages(messages),
        stream: true
      })
    });

    if (!response.ok) {
      throw new Error(`ApiAirforce stream error: ${response.status}`);
    }
    return response.body;
  }

  async checkHealth() {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        signal: AbortSignal.timeout(10000)
      });
      return response.ok;
    } catch (err) {
      throw new Error(`ApiAirforce health check failed: ${err.message}`);
    }
  }

  async fetchModels() {
    try {
      const response = await fetch(`${this.baseUrl}/models`, { signal: AbortSignal.timeout(10000) });
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data.data)) {
          return data.data.map(m => ({
            id: m.id,
            type: 'general',
            description: `${m.id} via ApiAirforce`,
            maxTokens: 4096
          }));
        }
      }
    } catch {}
    return this.models;
  }

  _mapModel(requestedModel) {
    const mapping = {
      'gpt-4o-mini': 'gpt-4o-mini',
      'gpt-4o': 'gpt-4o',
      'claude-3.5-sonnet': 'claude-3-5-sonnet',
      'deepseek-chat': 'deepseek-chat',
      'deepseek-r1': 'deepseek-reasoner',
      'llama-3.3-70b': 'meta-llama/Llama-3.3-70B-Instruct-Turbo'
    };
    return mapping[requestedModel] || requestedModel;
  }

  _formatMessages(messages) {
    if (!Array.isArray(messages)) return messages;
    return messages.map(m => ({
      role: m.role || 'user',
      content: typeof m.content === 'string' ? m.content :
               Array.isArray(m.content) ? m.content.map(c => c.text || c).join('\n') : String(m.content || '')
    }));
  }
}
