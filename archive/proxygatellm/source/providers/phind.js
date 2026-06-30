// providers/phind.js
// Phind Provider — code-focused AI, reverse-engineered API

import { BaseProvider } from './base.js';
import { PROVIDER_CONFIG } from '../config/providers.js';

export class PhindProvider extends BaseProvider {
  constructor(config = {}) {
    const cfg = { ...PROVIDER_CONFIG.phind, ...config };
    super(cfg);
    this.baseUrl = cfg.baseUrl || 'https://www.phind.com';
  }

  async chat(messages, options = {}) {
    const model = options.model || 'Phind-70B';
    const url = `${this.baseUrl}/api/infer/`;

    // Format for Phind's API
    const lastUserMsg = messages.filter(m => m.role === 'user').pop();
    const question = lastUserMsg
      ? (typeof lastUserMsg.content === 'string' ? lastUserMsg.content : String(lastUserMsg.content))
      : '';

    const context = messages
      .filter(m => m.role === 'assistant')
      .map(m => typeof m.content === 'string' ? m.content : String(m.content || ''))
      .join('\n');

    const body = {
      question: question,
      question_context: context,
      web_context: {},
      options: {
        date: new Date().toISOString().split('T')[0],
        language: 'en',
        model: model,
        detailed: true,
        creativeMode: false
      }
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
          'Accept': '*/*',
          'Origin': 'https://www.phind.com',
          'Referer': 'https://www.phind.com/'
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Phind API error ${response.status}: ${text}`);
      }

      // Phind returns SSE-like stream, collect all
      const content = await this._collectResponse(response);

      if (options.format === 'anthropic') {
        return this.formatAnthropicResponse(content, model);
      }
      return this.formatOpenAIResponse(content, model);
    } finally {
      clearTimeout(timeout);
    }
  }

  async _collectResponse(response) {
    const text = await response.text();
    let content = '';
    // Phind returns JSON lines or SSE
    const lines = text.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed.choices?.[0]?.delta?.content) {
          content += parsed.choices[0].delta.content;
        } else if (parsed.content) {
          content += parsed.content;
        } else if (parsed.text) {
          content += parsed.text;
        } else if (typeof parsed === 'string') {
          content += parsed;
        }
      } catch {
        // Might be SSE format
        if (trimmed.startsWith('data: ')) {
          const data = trimmed.slice(6);
          if (data === '[DONE]') break;
          try {
            const parsed = JSON.parse(data);
            if (parsed.choices?.[0]?.delta?.content) content += parsed.choices[0].delta.content;
            else if (parsed.content) content += parsed.content;
          } catch {
            // Plain text data
            content += data;
          }
        } else if (!trimmed.startsWith(':')) {
          content += trimmed + ' ';
        }
      }
    }
    return content.trim();
  }

  async chatStream(messages, options = {}) {
    const result = await this.chat(messages, options);
    async function* singleChunk() {
      yield result;
    }
    return singleChunk();
  }

  async checkHealth() {
    try {
      const response = await fetch(this.baseUrl, {
        method: 'HEAD',
        signal: AbortSignal.timeout(10000)
      });
      return response.ok;
    } catch (err) {
      throw new Error(`Phind health check failed: ${err.message}`);
    }
  }
}
