/**
 * Jeumpa LLM SDK — Agentic AI without backend
 * Just middleware wrapping free LLM providers into one unified API
 *
 * Usage:
 *   import { JeumpaLLM } from 'jeumpallm';
 *   const ai = new JeumpaLLM();
 *   const response = await ai.chat("Hello!");
 */

export class JeumpaLLM {
  constructor(config = {}) {
    this.baseUrl = config.baseUrl || 'http://localhost:3333';
    this.apiKey = config.apiKey || '';
    this.model = config.model || 'auto';
  }

  // ── Chat Completion ────────────────────────────────────────
  async chat(messages, options = {}) {
    const model = options.model || this.model;
    const stream = options.stream || false;

    const headers = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: typeof messages === 'string'
          ? [{ role: 'user', content: messages }]
          : messages,
        stream,
        ...options
      })
    });

    if (!response.ok) {
      throw new Error(`API error ${response.status}: ${await response.text()}`);
    }

    if (stream) return this._handleStream(response, options.onChunk);

    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  }

  // ── Streaming ──────────────────────────────────────────────
  async _handleStream(response, onChunk) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let full = '';
    let buf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const d = line.slice(6);
          if (d === '[DONE]') continue;
          try {
            const chunk = JSON.parse(d).choices?.[0]?.delta?.content || '';
            if (chunk) {
              full += chunk;
              if (onChunk) onChunk(chunk);
            }
          } catch {}
        }
      }
    }

    return full;
  }

  // ── Quick Methods ──────────────────────────────────────────
  async ask(question, model) {
    return this.chat([{ role: 'user', content: question }], { model });
  }

  async system(systemPrompt, userMessage, model) {
    return this.chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ], { model });
  }

  async code(spec, language = 'auto') {
    const lang = language !== 'auto' ? ` in ${language}` : '';
    return this.ask(`Generate${lang} code for: ${spec}\n\nReturn ONLY the code, no explanations.`);
  }

  async review(code) {
    return this.ask(`Review this code for bugs and improvements:\n\n\`\`\`\n${code}\n\`\`\`\n\nProvide specific fixes.`);
  }

  async debug(code, error) {
    return this.ask(`Debug this code:\n\nCode:\n\`\`\`\n${code}\n\`\`\`\n\nError:\n\`\`\`\n${error}\n\`\`\`\n\nFix it.`);
  }

  // ── Provider Info ──────────────────────────────────────────
  async models() {
    const res = await fetch(`${this.baseUrl}/models`);
    const data = await res.json();
    return data.data || [];
  }

  async providers() {
    const res = await fetch(`${this.baseUrl}/providers`);
    return res.json();
  }

  async health() {
    const res = await fetch(`${this.baseUrl}/health`);
    return res.json();
  }
}

export default JeumpaLLM;