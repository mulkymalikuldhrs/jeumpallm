// providers/deepai.js
// DeepAI Provider — free chat mode, no API key required for basic use

import { BaseProvider } from './base.js';
import { PROVIDER_CONFIG } from '../config/providers.js';

export class DeepAIProvider extends BaseProvider {
  constructor(config = {}) {
    const cfg = { ...PROVIDER_CONFIG.deepai, ...config };
    super(cfg);
    this.baseUrl = cfg.baseUrl || 'https://api.deepai.org';
  }

  async chat(messages, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeout);

    try {
      const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
      const content = lastUserMsg?.content || messages[messages.length - 1]?.content || '';
      const text = typeof content === 'string' ? content : JSON.stringify(content);

      const response = await fetch(`${this.baseUrl}/chat_response`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
        },
        body: `chat_style=default&chat=${encodeURIComponent(text)}`,
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`DeepAI API error ${response.status}`);
      }

      const data = await response.json();
      const output = data.output || data.message || data.text || '';
      
      if (options.format === 'anthropic') {
        return this.formatAnthropicResponse(output, options.model || 'deepai-chat');
      }
      return this.formatOpenAIResponse(output, options.model || 'deepai-chat');
    } finally {
      clearTimeout(timeout);
    }
  }

  async chatStream(messages, options = {}) {
    const model = options.model || 'deepai-chat';
    // DeepAI doesn't support native streaming — simulate it
    const result = await this.chat(messages, { ...options, format: 'openai' });
    const content = result.choices?.[0]?.message?.content || '';
    
    async function* stream() {
      const words = content.split(' ');
      for (const word of words) {
        yield {
          id: 'chatcmpl-deepai-' + Date.now(),
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
      throw new Error(`DeepAI health check failed: ${err.message}`);
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
