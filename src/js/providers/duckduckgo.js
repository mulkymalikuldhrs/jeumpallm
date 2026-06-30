// providers/duckduckgo.js
// DuckDuckGo AI Chat Provider — free, no API key, requires VQD token

import { BaseProvider } from './base.js';
import { PROVIDER_CONFIG } from '../config/providers.js';

export class DuckDuckGoProvider extends BaseProvider {
  constructor(config = {}) {
    const cfg = { ...PROVIDER_CONFIG.duckduckgo, ...config };
    super(cfg);
    this.baseUrl = cfg.baseUrl || 'https://duckduckgo.com';
    this.vqdCache = null;
    this.vqdExpiry = 0;
  }

  async _getVQD() {
    if (this.vqdCache && Date.now() < this.vqdExpiry) {
      return this.vqdCache;
    }

    try {
      const response = await fetch(`${this.baseUrl}/duckchat/v1/status`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept': '*/*',
          'Sec-Ch-Ua': '"Chromium";v="131", "Not_A Brand";v="24"',
          'Sec-Ch-Ua-Mobile': '?0',
          'Sec-Ch-Ua-Platform': '"Linux"',
          'Sec-Fetch-Dest': 'empty',
          'Sec-Fetch-Mode': 'cors',
          'Sec-Fetch-Site': 'same-origin',
          'Referer': 'https://duckduckgo.com/'
        },
        signal: AbortSignal.timeout(10000)
      });

      const vqd = response.headers.get('x-vqd-4') || response.headers.get('x-vqd');
      if (vqd) {
        this.vqdCache = vqd;
        this.vqdExpiry = Date.now() + 300000;
        return vqd;
      }

      const html = await response.text();
      const match = html.match(/vqd\s*[:=]\s*['"]([^'"]+)['"]/);
      if (match) {
        this.vqdCache = match[1];
        this.vqdExpiry = Date.now() + 300000;
        return match[1];
      }

      throw new Error('Could not obtain VQD token');
    } catch (err) {
      throw new Error(`DDG VQD fetch failed: ${err.message}`);
    }
  }

  _mapModel(requestedModel) {
    const mapping = {
      'gpt-4o-mini': 'gpt-4o-mini',
      'claude-3-haiku': 'claude-3-haiku-20240307',
      'claude-haiku': 'claude-3-haiku-20240307',
      'llama-3.1-70b': 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',
      'llama': 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',
      'mixtral-8x7b': 'mistralai/Mixtral-8x7B-Instruct-v0.1',
      'mixtral': 'mistralai/Mixtral-8x7B-Instruct-v0.1'
    };
    return mapping[requestedModel] || 'gpt-4o-mini';
  }

  async chat(messages, options = {}) {
    const model = this._mapModel(options.model || 'gpt-4o-mini');
    const vqd = await this._getVQD();

    const body = { model, messages: this._formatMessages(messages) };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}/duckchat/v1/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept': 'text/event-stream',
          'Sec-Ch-Ua': '"Chromium";v="131", "Not_A Brand";v="24"',
          'Sec-Ch-Ua-Mobile': '?0',
          'Sec-Ch-Ua-Platform': '"Linux"',
          'Sec-Fetch-Dest': 'empty',
          'Sec-Fetch-Mode': 'cors',
          'Sec-Fetch-Site': 'same-origin',
          'Referer': 'https://duckduckgo.com/',
          'x-vqd-4': vqd
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        if (response.status === 401 || response.status === 429) {
          this.vqdCache = null;
          this.vqdExpiry = 0;
        }
        throw new Error(`DDG API error ${response.status}: ${text}`);
      }

      const content = await this._collectSSE(response);

      if (options.format === 'anthropic') {
        return this.formatAnthropicResponse(content, options.model || 'gpt-4o-mini');
      }
      return this.formatOpenAIResponse(content, options.model || 'gpt-4o-mini');
    } finally {
      clearTimeout(timeout);
    }
  }

  async chatStream(messages, options = {}) {
    const model = this._mapModel(options.model || 'gpt-4o-mini');
    const vqd = await this._getVQD();

    const body = { model, messages: this._formatMessages(messages) };

    const response = await fetch(`${this.baseUrl}/duckchat/v1/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
        'Accept': 'text/event-stream',
        'x-vqd-4': vqd,
        'Referer': 'https://duckduckgo.com/'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error(`DDG stream error: ${response.status}`);
    }

    return this._transformSSEStream(response.body, options.model || 'gpt-4o-mini');
  }

  async _collectSSE(response) {
    const text = await response.text();
    let content = '';
    const lines = text.split('\n');
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim();
        if (data === '[DONE]') break;
        try {
          const parsed = JSON.parse(data);
          if (parsed.message) content += parsed.message;
          else if (parsed.choices?.[0]?.delta?.content) content += parsed.choices[0].delta.content;
        } catch {}
      }
    }
    return content;
  }

  async *_transformSSEStream(readableStream, model) {
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
          if (data === '[DONE]') return;
          try {
            const parsed = JSON.parse(data);
            const content = parsed.message || parsed.choices?.[0]?.delta?.content || '';
            if (content) {
              yield {
                id: 'chatcmpl-ddg-' + Date.now(),
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
      // Simple HEAD request to check if DDG is reachable
      const response = await fetch('https://duckduckgo.com/', {
        method: 'HEAD',
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
        },
        signal: AbortSignal.timeout(10000)
      });
      if (response.ok) {
        // DDG is reachable, try VQD as well
        try {
          const vqd = await this._getVQD();
          return !!vqd;
        } catch {
          // DDG reachable but VQD failed — still mark as degraded
          this.healthStatus = 'degraded';
          return true;
        }
      }
      throw new Error(`DDG returned ${response.status}`);
    } catch (err) {
      throw new Error(`DDG health check failed: ${err.message}`);
    }
  }

  _formatMessages(messages) {
    if (!Array.isArray(messages)) return messages;
    return messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : String(m.content || '')
      }));
  }
}
