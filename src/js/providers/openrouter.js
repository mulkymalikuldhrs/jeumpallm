// providers/openrouter.js
// OpenRouter Free Provider — free models, no API key needed for free tier

import { BaseProvider } from './base.js';
import { PROVIDER_CONFIG } from '../config/providers.js';

const ALIAS_MAP = {
  'gpt-4o': 'openai/gpt-4o',
  'gpt-4o-mini': 'openai/gpt-4o-mini',
  'gpt-4o-mini-2024-07-18': 'openai/gpt-4o-mini-2024-07-18',
  'claude-3-haiku': 'anthropic/claude-3-haiku',
  'claude-3-sonnet': 'anthropic/claude-3-sonnet',
  'claude-3-opus': 'anthropic/claude-3-opus',
  'gemini-2.0-flash': 'google/gemini-2.0-flash-001',
  'gemini-pro': 'google/gemini-pro',
  'llama-3.1-70b': 'meta-llama/llama-3.1-70b-instruct:free',
  'llama-3.1-8b': 'meta-llama/llama-3.1-8b-instruct:free',
  'mistral-large': 'mistralai/mistral-large-2407',
  'deepseek-chat': 'deepseek/deepseek-chat',
  'deepseek-r1': 'deepseek/deepseek-r1',
  'qwen-2.5-coder': 'qwen/qwen-2.5-coder-32b-instruct',
  'codestral': 'mistralai/codestral-2405',
};

export class OpenRouterProvider extends BaseProvider {
  constructor(config = {}) {
    const cfg = { ...PROVIDER_CONFIG.openrouter, ...config };
    super(cfg);
    this.baseUrl = cfg.baseUrl || 'https://openrouter.ai/api/v1';
  }

  _getHeaders() {
    const headers = {
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/dhaher-labs/JeumpaLLM',
      'X-Title': 'Jeumpa LLM'
    };
    if (process.env.OPENROUTER_API_KEY) {
      headers['Authorization'] = `Bearer ${process.env.OPENROUTER_API_KEY}`;
    }
    return headers;
  }

  async chat(messages, options = {}) {
    const model = options.model || this.models[0]?.id || 'meta-llama/llama-3.1-8b-instruct:free';
    const url = `${this.baseUrl}/chat/completions`;

    const body = {
      model,
      messages: this._formatMessages(messages),
      stream: false
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
        throw new Error(`OpenRouter API error ${response.status}: ${text}`);
      }

      const data = await response.json();

      if (options.format === 'anthropic') {
        const content = data.choices?.[0]?.message?.content || '';
        return this.formatAnthropicResponse(content, model, data.usage);
      }
      return data; // OpenRouter returns OpenAI format already
    } finally {
      clearTimeout(timeout);
    }
  }

  async chatStream(messages, options = {}) {
    const model = options.model || this.models[0]?.id || 'meta-llama/llama-3.1-8b-instruct:free';
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
      throw new Error(`OpenRouter stream error: ${response.status}`);
    }

    return response.body;
  }

  async checkHealth() {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: { 'HTTP-Referer': 'https://github.com/dhaher-labs/JeumpaLLM' },
        signal: AbortSignal.timeout(10000)
      });
      return response.ok;
    } catch (err) {
      throw new Error(`OpenRouter health check failed: ${err.message}`);
    }
  }

  async fetchModels() {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: this._getHeaders(),
        signal: AbortSignal.timeout(15000)
      });

      if (!response.ok) return this.models;

      const data = await response.json();
      if (!data?.data) return this.models;

      const freeModels = data.data
        .filter(m => m.pricing?.prompt === '0' || m.pricing?.prompt?.startsWith('0.0'))
        .map(m => {
          // Add common aliases for better routing
          const aliases = [];
          for (const [alias, orId] of Object.entries(ALIAS_MAP)) {
            if (m.id === orId) aliases.push(alias);
          }
          return {
            id: m.id,
            type: m.architecture?.modality === 'chat' ? 'general' : 'other',
            description: `${m.name || m.id} (free) — ${(m.context_length || 0).toLocaleString()} ctx`,
            maxTokens: m.context_length || 4096,
            contextLength: m.context_length,
            aliases: aliases.length > 0 ? aliases : undefined
          };
        });

      console.log(`[OPENROUTER] Found ${freeModels.length} free models`);
      return freeModels.length > 0 ? freeModels : this.models;
    } catch (err) {
      console.warn(`[OPENROUTER] Model fetch failed: ${err.message}`);
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
