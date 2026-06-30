// providers/groq.js
// Groq Provider — ultra-fast inference, free tier with API key

import { BaseProvider } from './base.js';
import { PROVIDER_CONFIG } from '../config/providers.js';

export class GroqProvider extends BaseProvider {
  constructor(config = {}) {
    const cfg = { ...PROVIDER_CONFIG.groq, ...config };
    super(cfg);
    this.baseUrl = cfg.baseUrl || 'https://api.groq.com/openai/v1';
    this.apiKey = process.env.GROQ_API_KEY || '';
    if (!this.apiKey) {
      console.warn('[GROQ] No GROQ_API_KEY set — provider disabled');
      this.enabled = false;
    }
  }

  _getHeaders() {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`
    };
  }

  async chat(messages, options = {}) {
    const model = options.model || 'llama-3.3-70b-versatile';
    const url = `${this.baseUrl}/chat/completions`;

    const body = {
      model,
      messages: this._formatMessages(messages),
      stream: false,
      max_tokens: options.max_tokens || 4096
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: this._getHeaders(),
        body: JSON.stringify(body),
        signal: controller.signal
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Groq API error ${response.status}: ${text}`);
      }

      const data = await response.json();

      if (options.format === 'anthropic') {
        const content = data.choices?.[0]?.message?.content || '';
        return this.formatAnthropicResponse(content, model, data.usage);
      }
      return data;
    } finally {
      clearTimeout(timeout);
    }
  }

  async chatStream(messages, options = {}) {
    const model = options.model || 'llama-3.3-70b-versatile';
    const url = `${this.baseUrl}/chat/completions`;

    const body = {
      model,
      messages: this._formatMessages(messages),
      stream: true
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: this._getHeaders(),
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error(`Groq stream error: ${response.status}`);
    }

    return response.body;
  }

  async checkHealth() {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: this._getHeaders(),
        signal: AbortSignal.timeout(10000)
      });
      return response.ok;
    } catch (err) {
      throw new Error(`Groq health check failed: ${err.message}`);
    }
  }

  async fetchModels() {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: this._getHeaders(),
        signal: AbortSignal.timeout(10000)
      });
      if (!response.ok) return this.models;
      const data = await response.json();
      if (!data?.data) return this.models;

      const models = data.data.map(m => ({
        id: m.id,
        type: 'general',
        description: `${m.id} on Groq — ultra-fast`,
        maxTokens: 8192
      }));
      return models.length > 0 ? models : this.models;
    } catch {
      return this.models;
    }
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
