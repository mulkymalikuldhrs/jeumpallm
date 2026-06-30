/**
 * Jeumpa LLM MCP Gateway v1.0
 * Aggregates multiple MCP servers into one unified endpoint
 * The "USB-C for AI" — one gateway, all tools
 */

/**
 * MCP Server Registry
 */
export class MCPRegistry {
  constructor() {
    this.servers = new Map();
    this.tools = new Map();
    this.resources = new Map();
    this.prompts = new Map();
  }

  /**
   * Register an MCP server
   */
  registerServer(name, config) {
    this.servers.set(name, {
      name,
      url: config.url,
      transport: config.transport || 'stdio',
      capabilities: config.capabilities || [],
      status: 'disconnected',
      tools: [],
      resources: [],
      lastHealthCheck: null,
    });
    return this;
  }

  /**
   * Connect to all servers
   */
  async connectAll() {
    const results = [];
    for (const [name, server] of this.servers) {
      try {
        await this.connectServer(name);
        results.push({ name, status: 'connected' });
      } catch (error) {
        results.push({ name, status: 'error', error: error.message });
      }
    }
    return results;
  }

  /**
   * Connect to a specific server
   */
  async connectServer(name) {
    const server = this.servers.get(name);
    if (!server) throw new Error(`Server not found: ${name}`);

    // In real implementation, this would establish MCP connection
    server.status = 'connected';
    server.lastHealthCheck = Date.now();

    // Discover tools
    server.tools = await this.discoverTools(name);
    for (const tool of server.tools) {
      this.tools.set(`${name}:${tool.name}`, { ...tool, server: name });
    }

    // Discover resources
    server.resources = await this.discoverResources(name);
    for (const resource of server.resources) {
      this.resources.set(`${name}:${resource.uri}`, { ...resource, server: name });
    }

    return server;
  }

  /**
   * Discover tools from a server
   */
  async discoverTools(serverName) {
    // Mock tools for demonstration
    return [
      { name: 'read_file', description: 'Read a file', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } },
      { name: 'write_file', description: 'Write a file', inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } } } },
      { name: 'list_directory', description: 'List directory contents', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } },
    ];
  }

  /**
   * Discover resources from a server
   */
  async discoverResources(serverName) {
    return [
      { uri: 'file:///', name: 'Filesystem', description: 'Access local files' },
      { uri: 'git://', name: 'Git', description: 'Git operations' },
    ];
  }

  /**
   * Get all available tools
   */
  getAllTools() {
    return Array.from(this.tools.values());
  }

  /**
   * Get tools for OpenAI function calling format
   */
  getToolsForOpenAI() {
    return this.getAllTools().map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));
  }

  /**
   * Execute a tool
   */
  async executeTool(toolName, args) {
    const tool = this.tools.get(toolName);
    if (!tool) throw new Error(`Tool not found: ${toolName}`);

    const server = this.servers.get(tool.server);
    if (!server || server.status !== 'connected') {
      throw new Error(`Server not connected: ${tool.server}`);
    }

    // In real implementation, this would call the MCP server
    return { result: `Executed ${toolName} with args: ${JSON.stringify(args)}` };
  }

  /**
   * Get server status
   */
  getStatus() {
    const servers = Array.from(this.servers.values()).map(s => ({
      name: s.name,
      status: s.status,
      tools: s.tools.length,
      resources: s.resources.length,
      lastHealthCheck: s.lastHealthCheck,
    }));

    return {
      totalServers: servers.length,
      connected: servers.filter(s => s.status === 'connected').length,
      totalTools: this.tools.size,
      totalResources: this.resources.size,
      servers,
    };
  }
}

/**
 * MCP Gateway — Unified MCP Endpoint
 */
export class MCPGateway {
  constructor(config = {}) {
    this.registry = config.registry || new MCPRegistry();
    this.baseUrl = config.baseUrl || 'http://localhost:3333';
    this.auth = config.auth || null;
  }

  /**
   * Initialize gateway with servers
   */
  async initialize(servers = []) {
    for (const server of servers) {
      this.registry.registerServer(server.name, server);
    }

    const results = await this.registry.connectAll();
    console.log(`MCP Gateway: ${results.filter(r => r.status === 'connected').length}/${results.length} servers connected`);

    return this;
  }

  /**
   * Handle MCP tool call from external client
   */
  async handleToolCall(toolName, args) {
    return this.registry.executeTool(toolName, args);
  }

  /**
   * Get gateway info (for MCP server endpoint)
   */
  getInfo() {
    return {
      name: 'Jeumpa LLM MCP Gateway',
      version: '1.0.0',
      description: 'Unified MCP gateway aggregating multiple MCP servers',
      tools: this.registry.getAllTools().length,
      resources: this.registry.resources.size,
      servers: this.registry.getStatus(),
    };
  }

  /**
   * Express middleware for MCP endpoint
   */
  middleware() {
    return async (req, res, next) => {
      if (req.path === '/mcp/info') {
        return res.json(this.getInfo());
      }

      if (req.path === '/mcp/tools') {
        return res.json({ tools: this.registry.getToolsForOpenAI() });
      }

      if (req.path === '/mcp/execute' && req.method === 'POST') {
        const { tool, args } = req.body;
        try {
          const result = await this.handleToolCall(tool, args);
          return res.json(result);
        } catch (error) {
          return res.status(500).json({ error: error.message });
        }
      }

      if (req.path === '/mcp/servers') {
        return res.json(this.registry.getStatus());
      }

      next();
    };
  }
}

export default MCPGateway;