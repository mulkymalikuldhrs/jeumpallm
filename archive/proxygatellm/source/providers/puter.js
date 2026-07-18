// providers/puter.js
// Puter.js SDK Provider — requires PUTER_AUTH_TOKEN for authentication

import { BaseProvider } from './base.js';
import { PROVIDER_CONFIG } from '../config/providers.js';

const authToken = process.env.PUTER_AUTH_TOKEN || process.env.puterAuthToken;

export class PuterProvider extends BaseProvider {
  constructor(config = {}) {
    const cfg = { ...PROVIDER_CONFIG.puter, ...config };
    super(cfg);
    this.puter = null;

    // Disable synchronously if no auth token
    if (!authToken) {
      this.enabled = false;
      console.warn('[PUTER] No PUTER_AUTH_TOKEN set — provider disabled. Set PUTER_AUTH_TOKEN in .env to enable.');
      return;
    }

    this._initPuter();
  }

  async _initPuter() {
    try {
      const { init } = await import('@heyputer/puter.js/src/init.cjs');
      this.puter = init(authToken);
      this.enabled = true;
      console.log('[PUTER] Initialized with auth token');
    } catch (err) {
      console.warn(`[PUTER] Init failed: ${err.message}`);
      this.enabled = false;
      this.puter = null;
    }
  }

  async _ensureReady() {
    // Wait for async init if needed
    if (!this.puter && authToken) {
      await this._initPuter();
    }
    if (!this.puter) {
      throw new Error('Puter SDK not initialized — set PUTER_AUTH_TOKEN');
    }
  }

  async chat(messages, options = {}) {
    await this._ensureReady();
    const model = options.model || 'deepseek-chat';

    const formattedMsgs = this._formatMessages(messages);

    const response = await this.puter.ai.chat(formattedMsgs, {
      model: model,
      stream: false
    });

    // Handle error responses
    if (response?.error) {
      throw new Error(`Puter API error: ${response.message || response.error}`);
    }

    let content = '';
    if (typeof response === 'string') {
      content = response;
    } else if (response?.message?.content) {
      content = typeof response.message.content === 'string'
        ? response.message.content
        : response.message.content.map(c => c.text || '').join('');
    } else if (response?.choices?.[0]?.message?.content) {
      content = response.choices[0].message.content;
    } else if (response?.text) {
      content = response.text;
    } else if (response && typeof response === 'object') {
      content = response.toString?.() || JSON.stringify(response);
    }

    if (!content || content === '[object Object]') {
      throw new Error(`Puter returned empty/unparseable response for model ${model}`);
    }

    if (options.format === 'anthropic') {
      return this.formatAnthropicResponse(content, model, response?.usage);
    }
    return this.formatOpenAIResponse(content, model, response?.usage);
  }

  async chatStream(messages, options = {}) {
    await this._ensureReady();
    const model = options.model || 'deepseek-chat';
    const formattedMsgs = this._formatMessages(messages);

    const stream = await this.puter.ai.chat(formattedMsgs, {
      model: model,
      stream: true
    });

    return this._wrapPuterStream(stream, model);
  }

  async *_wrapPuterStream(stream, model) {
    try {
      if (stream && typeof stream[Symbol.asyncIterator] === 'function') {
        for await (const chunk of stream) {
          const content = typeof chunk === 'string' ? chunk
            : chunk?.text || chunk?.message?.content || chunk?.choices?.[0]?.delta?.content || '';
          if (content) {
            yield {
              id: 'chatcmpl-puter-' + Date.now(),
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model,
              choices: [{ index: 0, delta: { content }, finish_reason: null }]
            };
          }
        }
      }
    } catch (err) {
      if (err.message && !err.message.includes('aborted')) {
        console.warn(`[PUTER] Stream error: ${err.message}`);
      }
    }
  }

  async checkHealth() {
    if (!this.enabled || !this.puter) {
      throw new Error('Puter not initialized');
    }
    try {
      const response = await this.puter.ai.chat('ping', {
        model: 'gpt-4o-mini',
        stream: false
      });
      if (response?.error) {
        throw new Error(`Puter health: ${response.message || response.error}`);
      }
      return !!response;
    } catch (err) {
      throw new Error(`Puter health check failed: ${err.message}`);
    }
  }

  _formatMessages(messages) {
    if (!Array.isArray(messages)) {
      if (typeof messages === 'string') return messages;
      return String(messages || '');
    }
    return messages.map(m => ({
      role: m.role || 'user',
      content: typeof m.content === 'string' ? m.content :
               Array.isArray(m.content) ? m.content.map(c => c.text || c).join('\n') : String(m.content || '')
    }));
  }
}
