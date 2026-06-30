// providers/venice.js
// Venice.ai Provider — free privacy-focused AI, no login required

import { BaseProvider } from './base.js';
import { PROVIDER_CONFIG } from '../config/providers.js';

export class VeniceProvider extends BaseProvider {
  constructor(config = {}) {
    const cfg = { ...PROVIDER_CONFIG.venice, ...config };
    super(cfg);
    this.baseUrl = cfg.baseUrl || 'https://api.venice.ai/api/v1';
  }

  async chat(messages, options = {}) {
    const model = this._mapModel(options.model || 'llama-3.3-70b');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: this._formatMessages(messages),
          stream: false,
          venice_parameters: { include_venice_system_prompt: false }
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Venice API error ${response.status}: ${text}`);
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
    const model = this._mapModel(options.model || 'llama-3.3-70b');
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: this._formatMessages(messages),
        stream: true,
        venice_parameters: { include_venice_system_prompt: false }
      })
    });

    if (!response.ok) {
      throw new Error(`Venice stream error: ${response.status}`);
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
      throw new Error(`Venice health check failed: ${err.message}`);
    }
  }

  _mapModel(requestedModel) {
    const mapping = {
      'llama-3.3-70b': 'llama-3.3-70b',
      'deepseek-r1': 'deepseek-r1-671b',
      'qwen-2.5-coder': 'qwen2.5-coder-32b',
      'gemma-3-27b': 'gemma-3-27b-it'
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
