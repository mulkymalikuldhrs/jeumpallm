// providers/blackbox.js
// Blackbox AI Provider — free web chatbot, reverse-engineered API

import { BaseProvider } from './base.js';
import { PROVIDER_CONFIG } from '../config/providers.js';

export class BlackboxProvider extends BaseProvider {
  constructor(config = {}) {
    const cfg = { ...PROVIDER_CONFIG.blackbox, ...config };
    super(cfg);
    this.baseUrl = cfg.baseUrl || 'https://www.blackbox.ai';
  }

  async chat(messages, options = {}) {
    const model = options.model || 'blackboxai';
    const url = `${this.baseUrl}/api/chat`;

    const formattedMessages = this._formatMessages(messages);

    const body = {
      messages: formattedMessages,
      agentMode: {},
      trendingAgentMode: {},
      isMicMode: false,
      maxTokens: options.max_tokens || 4096,
      isChromeExt: false,
      githubToken: null,
      clickedAnswer2: false,
      clickedAnswer3: false,
      clickedForceWebSearch: false,
      visitFromDelta: false,
      mobileClient: false,
      userSelectedModel: model,
      validated: '00f37b34-a166-4efb-bce5-1312d87f2f94',
      imageGenerationMode: false,
      webSearchMode: false
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
          'Origin': 'https://www.blackbox.ai',
          'Referer': 'https://www.blackbox.ai/'
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Blackbox API error ${response.status}: ${text}`);
      }

      let content = await response.text();

      // Blackbox may return with special prefixes, clean up
      content = content
        .replace(/^\$@\$v=undefined-rv1\$@\$/, '')
        .replace(/\$@\$v=undefined-rv1\$@\$$/, '')
        .trim();

      if (options.format === 'anthropic') {
        return this.formatAnthropicResponse(content, model);
      }
      return this.formatOpenAIResponse(content, model);
    } finally {
      clearTimeout(timeout);
    }
  }

  async chatStream(messages, options = {}) {
    const model = options.model || 'blackboxai';
    const url = `${this.baseUrl}/api/chat`;

    const body = {
      messages: this._formatMessages(messages),
      agentMode: {},
      trendingAgentMode: {},
      isMicMode: false,
      maxTokens: 4096,
      isChromeExt: false,
      userSelectedModel: model,
      validated: '00f37b34-a166-4efb-bce5-1312d87f2f94',
      webSearchMode: false
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
        'Origin': 'https://www.blackbox.ai',
        'Referer': 'https://www.blackbox.ai/'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error(`Blackbox stream error: ${response.status}`);
    }

    // Blackbox returns plain text, wrap in SSE-like format
    return this._wrapStream(response.body, model);
  }

  async *_wrapStream(readableStream, model) {
    const reader = readableStream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      // Emit chunks as they come
      if (buffer.length > 0) {
        const content = buffer.replace(/\$@\$v=undefined-rv1\$@\$/g, '');
        buffer = '';
        if (content) {
          yield {
            id: 'chatcmpl-bb-' + Date.now(),
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [{ index: 0, delta: { content }, finish_reason: null }]
          };
        }
      }
    }
  }

  async checkHealth() {
    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
        },
        body: JSON.stringify({
          messages: [{ id: 'test', role: 'user', content: 'ping' }],
          agentMode: {},
          trendingAgentMode: {},
          isMicMode: false,
          maxTokens: 5,
          userSelectedModel: 'blackboxai',
          validated: '00f37b34-a166-4efb-bce5-1312d87f2f94'
        }),
        signal: AbortSignal.timeout(10000)
      });
      return response.ok;
    } catch (err) {
      throw new Error(`Blackbox health check failed: ${err.message}`);
    }
  }

  _formatMessages(messages) {
    if (!Array.isArray(messages)) return messages;
    return messages.map((m, i) => ({
      id: `msg-${i}`,
      role: m.role || 'user',
      content: typeof m.content === 'string' ? m.content : String(m.content || '')
    }));
  }
}
