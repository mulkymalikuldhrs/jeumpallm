// providers/google-ai.js
// Google AI Studio Provider — free tier with Gemini models

import { BaseProvider } from './base.js';

const PROVIDER_CONFIG_GOOGLE = {
  name: 'google-ai',
  displayName: 'Google AI Studio',
  priority: 1,
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  timeout: 30000,
  models: [
    { id: 'gemini-2.0-flash', type: 'fast', description: 'Gemini 2.0 Flash — fast, capable', maxTokens: 1048576 },
    { id: 'gemini-2.5-flash-preview-05-20', type: 'fast', description: 'Gemini 2.5 Flash Preview — latest fast model', maxTokens: 1048576 },
    { id: 'gemini-2.5-pro-preview-05-06', type: 'general', description: 'Gemini 2.5 Pro Preview — most capable', maxTokens: 1048576 },
    { id: 'gemma-3-27b-it', type: 'general', description: 'Gemma 3 27B IT — open model', maxTokens: 8192 }
  ]
};

export class GoogleAIProvider extends BaseProvider {
  constructor(config = {}) {
    const cfg = { ...PROVIDER_CONFIG_GOOGLE, ...config };
    super(cfg);
    this.baseUrl = cfg.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
    this.apiKey = process.env.GOOGLE_AI_API_KEY || '';
    if (!this.apiKey) {
      console.warn('[GOOGLE-AI] No GOOGLE_AI_API_KEY set — provider disabled');
      this.enabled = false;
    }
  }

  async chat(messages, options = {}) {
    const model = options.model || 'gemini-2.0-flash';
    const url = `${this.baseUrl}/models/${model}:generateContent?key=${this.apiKey}`;

    const contents = this._formatMessages(messages);
    const body = {
      contents,
      generationConfig: {
        maxOutputTokens: options.max_tokens || 8192,
        temperature: options.temperature || 0.7
      }
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Google AI error ${response.status}: ${text}`);
      }

      const data = await response.json();
      const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

      if (options.format === 'anthropic') {
        return this.formatAnthropicResponse(content, model);
      }
      return this.formatOpenAIResponse(content, model);
    } finally {
      clearTimeout(timeout);
    }
  }

  async chatStream(messages, options = {}) {
    const model = options.model || 'gemini-2.0-flash';
    const url = `${this.baseUrl}/models/${model}:streamGenerateContent?alt=sse&key=${this.apiKey}`;

    const contents = this._formatMessages(messages);
    const body = {
      contents,
      generationConfig: {
        maxOutputTokens: options.max_tokens || 8192,
        temperature: options.temperature || 0.7
      }
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error(`Google AI stream error: ${response.status}`);
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
          if (!data) continue;
          try {
            const parsed = JSON.parse(data);
            const content = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
            if (content) {
              yield {
                id: 'chatcmpl-google-' + Date.now(),
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
      const response = await fetch(`${this.baseUrl}/models?key=${this.apiKey}`, {
        signal: AbortSignal.timeout(10000)
      });
      return response.ok;
    } catch (err) {
      throw new Error(`Google AI health check failed: ${err.message}`);
    }
  }

  _formatMessages(messages) {
    if (!Array.isArray(messages)) return [];
    return messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: typeof m.content === 'string' ? m.content : String(m.content || '') }]
    }));
  }
}
