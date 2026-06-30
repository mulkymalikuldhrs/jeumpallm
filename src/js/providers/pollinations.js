// providers/pollinations.js
// Pollinations AI Provider — free, no API key, OpenAI-compatible endpoint

import { BaseProvider } from './base.js';
import { PROVIDER_CONFIG } from '../config/providers.js';

export class PollinationsProvider extends BaseProvider {
  constructor(config = {}) {
    const cfg = { ...PROVIDER_CONFIG.pollinations, ...config };
    super(cfg);
    this.baseUrl = cfg.baseUrl || 'https://text.pollinations.ai';
  }

  async chat(messages, options = {}) {
    const model = this._mapModel(options.model || 'openai');
    const url = `${this.baseUrl}/`;

    const body = {
      messages: this._formatMessages(messages),
      model: model,
      seed: Math.floor(Math.random() * 10000),
      jsonMode: false
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
        // Try to parse error for better message
        try {
          const errData = JSON.parse(text);
          if (response.status === 429) {
            throw new Error(`Pollinations rate limited: ${errData.error || text}`);
          }
          throw new Error(`Pollinations API error ${response.status}: ${errData.error || text}`);
        } catch (parseErr) {
          if (parseErr.message.startsWith('Pollinations')) throw parseErr;
          throw new Error(`Pollinations API error ${response.status}: ${text}`);
        }
      }

      const content = await response.text();
      
      // Pollinations may return JSON error even with 200 status
      if (content.startsWith('{')) {
        try {
          const possibleError = JSON.parse(content);
          if (possibleError.error) {
            throw new Error(`Pollinations error: ${possibleError.error || possibleError.message || content}`);
          }
          // If it's valid JSON with content, use it
          if (possibleError.choices?.[0]?.message?.content) {
            if (options.format === 'anthropic') {
              return this.formatAnthropicResponse(possibleError.choices[0].message.content, options.model || model);
            }
            return possibleError; // Already in OpenAI format
          }
        } catch (parseErr) {
          if (parseErr.message.startsWith('Pollinations')) throw parseErr;
          // Not JSON, use as plain text
        }
      }

      if (options.format === 'anthropic') {
        return this.formatAnthropicResponse(content, options.model || model);
      }
      return this.formatOpenAIResponse(content, options.model || model);
    } finally {
      clearTimeout(timeout);
    }
  }

  async chatStream(messages, options = {}) {
    const model = this._mapModel(options.model || 'openai');
    const url = `${this.baseUrl}/openai/chat/completions`;

    const body = {
      messages: this._formatMessages(messages),
      model: model,
      stream: true
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error(`Pollinations stream error: ${response.status}`);
    }

    return response.body;
  }

  async checkHealth() {
    try {
      const response = await fetch(`${this.baseUrl}/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'ping' }],
          model: 'openai',
          seed: 1
        }),
        signal: AbortSignal.timeout(10000)
      });
      return response.ok;
    } catch (err) {
      throw new Error(`Pollinations health check failed: ${err.message}`);
    }
  }

  async fetchModels() {
    try {
      const response = await fetch('https://text.pollinations.ai/models', {
        signal: AbortSignal.timeout(10000)
      });
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data) && data.length > 0) {
          const fetchedModels = data.map(m => ({
            id: typeof m === 'string' ? m : m.id || m.name,
            type: 'general',
            description: typeof m === 'string' ? `${m} via Pollinations` : (m.description || `${m.id || m.name} via Pollinations`),
            maxTokens: 4096
          }));
          // Merge with configured models — keep configured ones that aren't in fetched list
          const fetchedIds = new Set(fetchedModels.map(m => m.id));
          const configuredExtras = this.models.filter(m => !fetchedIds.has(m.id) && !fetchedIds.has(this._mapModel(m.id)));
          // Don't overwrite if fetched has fewer models than configured (API might be incomplete)
          if (fetchedModels.length >= this.models.length) {
            return [...configuredExtras, ...fetchedModels];
          }
          // Keep configured models as the base, add new ones from fetch
          const configuredIds = new Set(this.models.map(m => m.id));
          const newFromFetch = fetchedModels.filter(m => !configuredIds.has(m.id));
          return [...this.models, ...newFromFetch];
        }
      }
    } catch {}
    return this.models;
  }

  _mapModel(requestedModel) {
    const mapping = {
      'gpt-4o-mini': 'openai',
      'gpt-4o': 'openai',
      'mistral-large': 'mistral',
      'mistral': 'mistral',
      'llama-3.1-70b': 'llama',
      'llama': 'llama',
      'deepseek-reasoner': 'deepseek-r1',
      'deepseek-r1': 'deepseek-r1',
      'qwen-coder': 'qwen',
      'qwen': 'qwen'
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
