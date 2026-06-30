// providers/huggingface.js
// HuggingFace Inference Provider — free tier with API key

import { BaseProvider } from './base.js';
import { PROVIDER_CONFIG } from '../config/providers.js';

export class HuggingFaceProvider extends BaseProvider {
  constructor(config = {}) {
    const cfg = { ...PROVIDER_CONFIG.huggingface, ...config };
    super(cfg);
    this.baseUrl = cfg.baseUrl || 'https://api-inference.huggingface.co/models';
    this.apiKey = process.env.HUGGINGFACE_API_KEY || '';
    if (!this.apiKey) {
      console.warn('[HUGGINGFACE] No HUGGINGFACE_API_KEY set — provider disabled');
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
    const model = options.model || 'meta-llama/Llama-3.1-70B-Instruct';
    const url = `${this.baseUrl}/${model}`;

    // HuggingFace uses a different format for chat
    const lastUserMsg = messages.filter(m => m.role === 'user').pop();
    const prompt = lastUserMsg
      ? (typeof lastUserMsg.content === 'string' ? lastUserMsg.content : String(lastUserMsg.content))
      : '';

    const body = {
      inputs: prompt,
      parameters: {
        max_new_tokens: options.max_tokens || 2048,
        temperature: options.temperature || 0.7,
        return_full_text: false
      }
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
        throw new Error(`HuggingFace API error ${response.status}: ${text}`);
      }

      const data = await response.json();
      const content = Array.isArray(data)
        ? data[0]?.generated_text || ''
        : data?.generated_text || JSON.stringify(data);

      if (options.format === 'anthropic') {
        return this.formatAnthropicResponse(content, model);
      }
      return this.formatOpenAIResponse(content, model);
    } finally {
      clearTimeout(timeout);
    }
  }

  async chatStream(messages, options = {}) {
    // HuggingFace doesn't natively support SSE streaming in the same way
    // Fallback to non-streaming
    const result = await this.chat(messages, options);
    // Wrap in a simple async generator
    async function* singleChunk() {
      yield result;
    }
    return singleChunk();
  }

  async checkHealth() {
    try {
      const response = await fetch(`${this.baseUrl}/${this.models[0]?.id || 'meta-llama/Llama-3.1-70B-Instruct'}`, {
        method: 'POST',
        headers: this._getHeaders(),
        body: JSON.stringify({ inputs: 'ping', parameters: { max_new_tokens: 5 } }),
        signal: AbortSignal.timeout(15000)
      });
      return response.ok;
    } catch (err) {
      throw new Error(`HuggingFace health check failed: ${err.message}`);
    }
  }
}
