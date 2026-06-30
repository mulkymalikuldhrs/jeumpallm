// agent/index.js
// Jeumpa LLM Agentic AI — No backend, pure frontend middleware
// Works like Puter.js / z.ai — coding agent without infrastructure

const JEUMPALLM_BASE = process.env.JEUMPALLM_URL || 'http://localhost:3333';

/**
 * Jeumpa LLM Agent — Agentic AI without backend
 * Just middleware wrapping free LLM providers into one unified API
 */
export class JeumpaLLMAgent {
  constructor(config = {}) {
    this.baseUrl = config.baseUrl || JEUMPALLM_BASE;
    this.model = config.model || 'auto';
    this.history = [];
    this.systemPrompt = config.systemPrompt || `You are Jeumpa LLM Agent — a powerful coding assistant. You can:
- Read, write, edit files
- Run terminal commands
- Execute git operations
- Generate and review code
- Debug and fix issues
- Create full-stack applications
You have access to the Jeumpa LLM multi-LLM gateway with 378+ models.
Always be helpful, accurate, and thorough.`;
    this.maxHistory = config.maxHistory || 100;
    this.tools = [];
    this.workspace = config.workspace || process.cwd();
  }

  // ── Core Chat ──────────────────────────────────────────────
  async chat(userMessage, options = {}) {
    this.history.push({ role: 'user', content: userMessage });

    const messages = [
      { role: 'system', content: this.systemPrompt },
      ...this.history.slice(-this.maxHistory)
    ];

    const model = options.model || this.model;
    const stream = options.stream ?? false;

    try {
      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, stream, max_tokens: 4096 })
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`API error ${response.status}: ${error}`);
      }

      if (stream) {
        return this._handleStream(response, options.onChunk);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      this.history.push({ role: 'assistant', content });
      return content;
    } catch (err) {
      throw new Error(`Chat failed: ${err.message}`);
    }
  }

  // ── Streaming ──────────────────────────────────────────────
  async _handleStream(response, onChunk) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;
          try {
            const json = JSON.parse(data);
            const chunk = json.choices?.[0]?.delta?.content || '';
            if (chunk) {
              fullContent += chunk;
              if (onChunk) onChunk(chunk);
            }
          } catch {}
        }
      }
    }

    this.history.push({ role: 'assistant', content: fullContent });
    return fullContent;
  }

  // ── Agentic: File Operations ───────────────────────────────
  async readFile(path) {
    return this.chat(`Read the file at ${path} and return its full content. If it doesn't exist, say so.`, { model: 'deepseek-chat' });
  }

  async writeFile(path, content) {
    return this.chat(`Write the following content to ${path}:\n\n\`\`\`\n${content}\n\`\`\`\n\nConfirm when done.`, { model: 'claude-opus-4-5-latest' });
  }

  async editFile(path, oldString, newString) {
    return this.chat(`Edit ${path}: replace "${oldString}" with "${newString}". Confirm the edit.`, { model: 'claude-opus-4-5-latest' });
  }

  async listFiles(path = '.', pattern = '*') {
    return this.chat(`List all files in ${path}${pattern !== '*' ? ` matching ${pattern}` : ''}. Show file names and sizes.`, { model: 'deepseek-chat' });
  }

  // ── Agentic: Terminal Commands ─────────────────────────────
  async runCommand(command) {
    return this.chat(`Execute this terminal command and return the output:\n\n\`\`\`bash\n${command}\n\`\`\`\n\nIf there are errors, explain them.`, { model: 'gpt-4o-mini' });
  }

  async gitStatus() {
    return this.runCommand('git status');
  }

  async gitCommit(message) {
    return this.runCommand(`git add -A && git commit -m "${message}"`);
  }

  async gitPush() {
    return this.runCommand('git push origin main');
  }

  // ── Agentic: Code Generation ───────────────────────────────
  async generateCode(spec, language = 'auto') {
    const lang = language !== 'auto' ? ` in ${language}` : '';
    const code = await this.chat(
      `Generate${lang} code for: ${spec}\n\nProvide ONLY the code, no explanations.`,
      { model: 'claude-opus-4-5-latest' }
    );
    return code;
  }

  async reviewCode(code) {
    return this.chat(
      `Review this code for bugs, security issues, and improvements:\n\n\`\`\`\n${code}\n\`\`\`\n\nProvide specific fixes.`,
      { model: 'deepseek-chat' }
    );
  }

  async refactorCode(code) {
    return this.chat(
      `Refactor this code for better readability, performance, and maintainability:\n\n\`\`\`\n${code}\n\`\`\``,
      { model: 'claude-opus-4-5-latest' }
    );
  }

  // ── Agentic: Multi-Step Reasoning ──────────────────────────
  async reason(task, steps = 3) {
    const steps_result = [];

    for (let i = 0; i < steps; i++) {
      const prompt = i === 0
        ? `Task: ${task}\n\nStep ${i + 1}/${steps}: What should we analyze first?`
        : `Previous analysis:\n${steps_result.join('\n')}\n\nStep ${i + 1}/${steps}: Continue analysis.`;

      const result = await this.chat(prompt, { model: 'deepseek-chat' });
      steps_result.push(`Step ${i + 1}: ${result}`);
    }

    const synthesis = await this.chat(
      `Based on this analysis:\n${steps_result.join('\n')}\n\nFinal answer for: ${task}`,
      { model: 'claude-opus-4-5-latest' }
    );

    return { steps: steps_result, answer: synthesis };
  }

  // ── Agentic: Project Building ──────────────────────────────
  async createProject(name, type = 'fullstack') {
    const specs = {
      fullstack: `Create a full-stack project "${name}" with:
- Frontend: React + Vite
- Backend: Express.js
- Database: SQLite
- Auth: JWT
- README.md with setup instructions`,
      api: `Create a REST API project "${name}" with:
- Express.js + TypeScript
- SQLite database
- CRUD endpoints
- Input validation
- Error handling`,
      cli: `Create a CLI tool "${name}" with:
- Node.js + Commander.js
- Multiple subcommands
- Config file support
- Help text`,
      website: `Create a static website "${name}" with:
- HTML + CSS + JavaScript
- Responsive design
- Dark mode
- Contact form`
    };

    return this.chat(specs[type] || specs.fullstack, { model: 'claude-opus-4-5-latest' });
  }

  async debugCode(code, error) {
    return this.chat(
      `Debug this code that throws an error:\n\nCode:\n\`\`\`\n${code}\n\`\`\`\n\nError:\n\`\`\`\n${error}\n\`\`\`\n\nFind the root cause and provide a fix.`,
      { model: 'deepseek-chat' }
    );
  }

  // ── Utilities ──────────────────────────────────────────────
  clear() {
    this.history = [];
  }

  async listModels() {
    const res = await fetch(`${this.baseUrl}/models`);
    const data = await res.json();
    return data.data || [];
  }

  async status() {
    const res = await fetch(`${this.baseUrl}/status`);
    return res.json();
  }

  getHistory() {
    return this.history;
  }
}

// ── CLI Mode ─────────────────────────────────────────────────
if (typeof process !== 'undefined' && process.argv[1]?.includes('agent')) {
  import('readline').then(({ createInterface }) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const agent = new JeumpaLLMAgent();

    console.log('\n🤖 Jeumpa LLM Agentic AI');
    console.log('Commands: quit, clear, models, status, history\n');

    const ask = () => {
      rl.question('You: ', async (input) => {
        const q = input.trim();
        if (!q) return ask();
        if (q.toLowerCase() === 'quit' || q.toLowerCase() === 'exit') {
          console.log('\nGoodbye!\n');
          return rl.close();
        }
        if (q.toLowerCase() === 'clear') {
          agent.clear();
          console.log('History cleared.\n');
          return ask();
        }
        if (q.toLowerCase() === 'models') {
          const models = await agent.listModels();
          console.log(`\n${models.length} models available:`);
          models.forEach(m => console.log(`  - ${m.id}`));
          console.log();
          return ask();
        }
        if (q.toLowerCase() === 'status') {
          const s = await agent.status();
          console.log(`\nVersion: ${s.version}`);
          console.log(`Providers: ${s.providers?.enabled}/${s.providers?.total}`);
          console.log(`Models: ${s.models?.total}\n`);
          return ask();
        }
        if (q.toLowerCase() === 'history') {
          console.log(`\n${agent.getHistory().length} messages in history\n`);
          return ask();
        }

        try {
          process.stdout.write('Agent: ');
          const response = await agent.chat(q, {
            stream: true,
            onChunk: (chunk) => process.stdout.write(chunk)
          });
          console.log('\n');
        } catch (err) {
          console.error(`\nError: ${err.message}\n`);
        }

        ask();
      });
    };

    ask();
  });
}

export default JeumpaLLMAgent;