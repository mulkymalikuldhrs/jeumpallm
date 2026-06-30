// providers/freegpt.js
// FreeGPT Provider — free GPT-4 access via free-gpt-4 API, no key required

import { BaseProvider } from './base.js';
import { PROVIDER_CONFIG } from '../config/providers.js';

export class FreeGPTProvider extends BaseProvider {
  constructor(config = {}) {
    const cfg = { ...PROVIDER_CONFIG.freegpt, ...config };
    super(cfg);
    this.baseUrl = cfg.baseUrl || 'https://free.gpt4.nija.top';
  }

  async chat(messages, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}/api/gpt4`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
        },
        body: JSON.stringify({
          messages: this._formatMessages(messages),
          model: this._mapModel(options.model || 'gpt-4o')
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`FreeGPT API error ${response.status}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || data.content || data.message || '';

      if (options.format === 'anthropic') {
        return this.formatAnthropicResponse(content, options.model || 'gpt-4o');
      }
      if (data.choices) return data; // Already OpenAI format
      return this.formatOpenAIResponse(content, options.model || 'gpt-4o');
    } finally {
      clearTimeout(timeout);
    }
  }

  async chatStream(messages, options = {}) {
    const model = options.model || 'gpt-4o';
    const result = await this.chat(messages, { ...options, format: 'openai' });
    const content = result.choices?.[0]?.message?.content || '';

    async function* stream() {
      const words = content.split(' ');
      for (const word of words) {
        yield {
          id: 'chatcmpl-fgpt-' + Date.now(),
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [{ index: 0, delta: { content: word + ' ' }, finish_reason: null }]
        };
      }
    }
    return stream();
  }

  async checkHealth() {
    try {
      const response = await fetch(this.baseUrl, {
        method: 'HEAD',
        signal: AbortSignal.timeout(10000)
      });
      return response.ok;
    } catch (err) {
      throw new Error(`FreeGPT health check failed: ${err.message}`);
    }
  }

  _mapModel(requestedModel) {
    const mapping = {
      'gpt-4o': 'gpt-4o',
      'gpt-4o-mini': 'gpt-4o-mini',
      'gpt-4': 'gpt-4',
      'gpt-3.5-turbo': 'gpt-3.5-turbo'
    };
    return mapping[requestedModel] || requestedModel;
  }

  _formatMessages(messages) {
    if (!Array.isArray(messages)) return messages;
    return messages.map(m => ({
      role: m.role || 'user',
      content: typeof m.content === 'string' ? m.content : String(m.content || '')
    }));
  }
}
