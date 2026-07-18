// providers/cohere.js
// Cohere Provider — Command models, strong multilingual, free tier

import { BaseProvider } from './base.js';

const PROVIDER_CONFIG_COHERE = {
  name: 'cohere',
  displayName: 'Cohere',
  priority: 2,
  baseUrl: 'https://api.cohere.ai/v2',
  timeout: 30000,
  models: [
    { id: 'command-a-03-2025', type: 'general', description: 'Command A — most capable Cohere model', maxTokens: 16384 },
    { id: 'command-r-08-2024', type: 'general', description: 'Command R — balanced performance', maxTokens: 16384 },
    { id: 'command-r-plus-08-2024', type: 'general', description: 'Command R+ — enhanced reasoning', maxTokens: 16384 }
  ]
};

export class CohereProvider extends BaseProvider {
  constructor(config = {}) {
    const cfg = { ...PROVIDER_CONFIG_COHERE, ...config };
    super(cfg);
    this.baseUrl = cfg.baseUrl || 'https://api.cohere.ai/v2';
    this.apiKey = process.env.COHERE_API_KEY || '';
    if (!this.apiKey) {
      console.warn('[COHERE] No COHERE_API_KEY set — provider disabled');
      this.enabled = false;
    }
  }

  async chat(messages, options = {}) {
    const model = options.model || 'command-a-03-2025';
    const url = `${this.baseUrl}/chat`;

    const body = {
      model,
      messages: this._formatMessages(messages),
      stream: false,
      max_tokens: options.max_tokens || 4096
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
      throw new Error(`Cohere API error ${response.status}: ${text}`);
    }

    const data = await response.json();
    const content = data.message?.content?.[0]?.text || data.message?.content || '';

    if (options.format === 'anthropic') {
      return this.formatAnthropicResponse(content, model, data.usage);
    }
    return this.formatOpenAIResponse(content, model, data.usage);
  }

  async chatStream(messages, options = {}) {
    const model = options.model || 'command-a-03-2025';
    const url = `${this.baseUrl}/chat`;

    const body = {
      model,
      messages: this._formatMessages(messages),
      stream: true
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
      throw new Error(`Cohere stream error: ${response.status}`);
    }

    return this._transformStream(response.body, model);
  }

  async *_transformStream(readableStream, model) {
    const reader = readableStream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (!data || data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            const content = parsed.delta?.message?.content?.text || parsed.content || '';
            if (content) {
              yield {
                id: 'chatcmpl-cohere-' + Date.now(),
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model,
                choices: [{ index: 0, delta: { content }, finish_reason: null }]
              };
            }
          } catch {}
        }
      }
    }
  }

  async checkHealth() {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(10000)
      });
      return response.ok;
    } catch (err) {
      throw new Error(`Cohere health check failed: ${err.message}`);
    }
  }

  _formatMessages(messages) {
    if (!Array.isArray(messages)) return messages;
    return messages.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : m.role,
      content: typeof m.content === 'string' ? m.content : String(m.content || '')
    }));
  }
}
