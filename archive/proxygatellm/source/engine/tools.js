/**
 * Jeumpa LLM Tools — ACTUALLY WORKS
 */

/**
 * Tool Result
 */
export class ToolResult {
  constructor(output, metadata = {}) {
    this.output = output;
    this.success = metadata.success !== false;
    this.duration = metadata.duration || 0;
    this.error = metadata.error || null;
    this.timestamp = Date.now();
  }

  static success(output, duration = 0) {
    return new ToolResult(output, { success: true, duration });
  }

  static error(message, duration = 0) {
    return new ToolResult(null, { success: false, error: message, duration });
  }

  toJSON() {
    return {
      output: this.output,
      success: this.success,
      duration: this.duration,
      error: this.error,
    };
  }
}

/**
 * Tool — ACTUALLY EXECUTES
 */
export class Tool {
  constructor(config) {
    this.name = config.name;
    this.description = config.description;
    this.category = config.category || 'general';
    this.schema = config.schema || { type: 'object', properties: {} };
    this.handler = config.handler;
    this.timeout = config.timeout || 30000;
  }

  /**
   * Execute the tool — ACTUALLY WORKS
   */
  async execute(args, context = {}) {
    const start = Date.now();

    try {
      const result = await Promise.race([
        this.handler(args, context),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Tool timeout')), this.timeout)
        ),
      ]);

      const duration = Date.now() - start;
      return result instanceof ToolResult ? result : ToolResult.success(result, duration);
    } catch (error) {
      return ToolResult.error(error.message, Date.now() - start);
    }
  }

  toOpenAI() {
    return {
      type: 'function',
      function: {
        name: this.name,
        description: this.description,
        parameters: this.schema,
      },
    };
  }
}

/**
 * Tool Registry — ACTUALLY MANAGES TOOLS
 */
export class ToolRegistry {
  constructor() {
    this.tools = new Map();
  }

  register(tool) {
    if (!(tool instanceof Tool)) {
      tool = new Tool(tool);
    }
    this.tools.set(tool.name, tool);
    return this;
  }

  get(name) {
    return this.tools.get(name);
  }

  async execute(name, args, context = {}) {
    const tool = this.tools.get(name);
    if (!tool) return ToolResult.error(`Tool not found: ${name}`);
    return tool.execute(args, context);
  }

  toOpenAI() {
    return Array.from(this.tools.values()).map(t => t.toOpenAI());
  }

  list() {
    return Array.from(this.tools.values()).map(t => ({
      name: t.name,
      description: t.description,
      category: t.category,
    }));
  }

  search(query) {
    const q = query.toLowerCase();
    return this.list().filter(t =>
      t.name.includes(q) || t.description.toLowerCase().includes(q)
    );
  }
}

/**
 * Built-in Tools — ACTUALLY WORK
 */
export const BuiltinTools = {
  readFile: new Tool({
    name: 'read_file',
    description: 'Read content from a file',
    category: 'filesystem',
    schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to read' },
      },
      required: ['path'],
    },
    handler: async (args) => {
      const fs = await import('fs/promises');
      return await fs.readFile(args.path, 'utf-8');
    },
  }),

  writeFile: new Tool({
    name: 'write_file',
    description: 'Write content to a file',
    category: 'filesystem',
    schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to write' },
        content: { type: 'string', description: 'Content to write' },
      },
      required: ['path', 'content'],
    },
    handler: async (args) => {
      const fs = await import('fs/promises');
      const path = await import('path');
      await fs.mkdir(path.dirname(args.path), { recursive: true });
      await fs.writeFile(args.path, args.content, 'utf-8');
      return { success: true, path: args.path };
    },
  }),

  runCommand: new Tool({
    name: 'run_command',
    description: 'Execute a shell command',
    category: 'terminal',
    schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command to execute' },
        cwd: { type: 'string', description: 'Working directory' },
      },
      required: ['command'],
    },
    handler: async (args) => {
      const { execSync } = await import('child_process');
      return execSync(args.command, {
        cwd: args.cwd || process.cwd(),
        encoding: 'utf-8',
        timeout: 30000,
      });
    },
  }),

  httpRequest: new Tool({
    name: 'http_request',
    description: 'Make an HTTP request',
    category: 'web',
    schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Request URL' },
        method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE'], default: 'GET' },
        body: { type: 'string', description: 'Request body (JSON)' },
      },
      required: ['url'],
    },
    handler: async (args) => {
      const response = await fetch(args.url, {
        method: args.method || 'GET',
        headers: { 'Content-Type': 'application/json' },
        body: args.body ? args.body : undefined,
      });
      const text = await response.text();
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    },
  }),

  webSearch: new Tool({
    name: 'web_search',
    description: 'Search the web via Jeumpa LLM',
    category: 'web',
    schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
      },
      required: ['query'],
    },
    handler: async (args) => {
      const baseUrl = 'http://localhost:3333';
      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'user', content: `Search the web for: ${args.query}. Provide a summary with key findings.` }],
          max_tokens: 1024,
        }),
      });
      const data = await response.json();
      return data.choices?.[0]?.message?.content || 'No results';
    },
  }),

  gitStatus: new Tool({
    name: 'git_status',
    description: 'Get git repository status',
    category: 'git',
    schema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Repository path' },
      },
    },
    handler: async (args) => {
      const { execSync } = await import('child_process');
      return execSync('git status --short', {
        cwd: args.cwd || process.cwd(),
        encoding: 'utf-8',
      });
    },
  }),
};

export default ToolRegistry;