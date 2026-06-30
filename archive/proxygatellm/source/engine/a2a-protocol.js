/**
 * Jeumpa LLM A2A Protocol v1.0
 * Agent-to-Agent interoperability (Google A2A standard)
 * Enables cross-framework agent communication
 */

/**
 * Agent Card — The agent's identity and capabilities
 */
export class AgentCard {
  constructor(config) {
    this.name = config.name;
    this.description = config.description || '';
    this.url = config.url;
    this.version = config.version || '1.0.0';
    this.capabilities = config.capabilities || {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: false,
    };
    this.skills = config.skills || [];
    this.authentication = config.authentication || { schemes: ['none'] };
    this.defaultInputModes = config.defaultInputModes || ['text'];
    this.defaultOutputModes = config.defaultOutputModes || ['text'];
  }

  toJSON() {
    return {
      name: this.name,
      description: this.description,
      url: this.url,
      version: this.version,
      capabilities: this.capabilities,
      skills: this.skills,
      authentication: this.authentication,
      defaultInputModes: this.defaultInputModes,
      defaultOutputModes: this.defaultOutputModes,
    };
  }

  /**
   * Serve as /.well-known/agent.json
   */
  toWellKnown() {
    return {
      ...this.toJSON(),
      protocolVersion: '0.2.1',
      provider: { organization: 'Jeumpa LLM' },
    };
  }
}

/**
 * A2A Task
 */
export class A2ATask {
  constructor(config) {
    this.id = config.id || crypto.randomUUID();
    this.status = config.status || 'submitted';
    this.history = config.history || [];
    this.metadata = config.metadata || {};
    this.artifacts = config.artifacts || [];
  }

  /**
   * Transition task state
   */
  transition(newState, message = '') {
    const validTransitions = {
      submitted: ['working', 'completed', 'failed'],
      working: ['input-required', 'completed', 'failed', 'canceled'],
      'input-required': ['working', 'canceled'],
      completed: [],
      failed: [],
      canceled: [],
    };

    if (!validTransitions[this.status]?.includes(newState)) {
      throw new Error(`Invalid transition: ${this.status} → ${newState}`);
    }

    this.history.push({
      from: this.status,
      to: newState,
      message,
      timestamp: Date.now(),
    });

    this.status = newState;
    return this;
  }

  toJSON() {
    return {
      id: this.id,
      status: this.status,
      history: this.history,
      metadata: this.metadata,
      artifacts: this.artifacts,
    };
  }
}

/**
 * A2A Message
 */
export class A2AMessage {
  constructor(role, parts = []) {
    this.role = role;
    this.parts = Array.isArray(parts) ? parts : [parts];
    this.metadata = {};
  }

  static user(content) {
    return new A2AMessage('user', [{ type: 'text', text: content }]);
  }

  static agent(content) {
    return new A2AMessage('agent', [{ type: 'text', text: content }]);
  }

  static withFile(content, file) {
    return new A2AMessage('user', [
      { type: 'text', text: content },
      { type: 'file', file: { mimeType: file.mimeType, data: file.data } },
    ]);
  }

  toJSON() {
    return {
      role: this.role,
      parts: this.parts,
      metadata: this.metadata,
    };
  }
}

/**
 * A2A Server — Expose Jeumpa LLM agents as A2A endpoints
 */
export class A2AServer {
  constructor(config = {}) {
    this.agents = new Map();
    this.tasks = new Map();
    this.baseUrl = config.baseUrl || 'http://localhost:3333';
  }

  /**
   * Register an agent for A2A access
   */
  registerAgent(name, handler, cardConfig = {}) {
    const card = new AgentCard({
      name,
      url: `${this.baseUrl}/a2a/${name}`,
      ...cardConfig,
    });

    this.agents.set(name, { handler, card });
    return this;
  }

  /**
   * Handle A2A request
   */
  async handleRequest(agentName, request) {
    const agent = this.agents.get(agentName);
    if (!agent) {
      throw new Error(`Agent not found: ${agentName}`);
    }

    const task = new A2ATask({ id: crypto.randomUUID() });
    this.tasks.set(task.id, task);

    task.transition('working', 'Task received');

    try {
      const message = request.params?.message;
      const result = await agent.handler(message, task);

      if (result.output) {
        task.artifacts.push({
          name: 'response',
          parts: [{ type: 'text', text: result.output }],
        });
      }

      task.transition('completed', 'Task completed');
    } catch (error) {
      task.transition('failed', error.message);
    }

    return task.toJSON();
  }

  /**
   * Get agent card
   */
  getAgentCard(agentName) {
    const agent = this.agents.get(agentName);
    return agent?.card.toWellKnown() || null;
  }

  /**
   * List all agents
   */
  listAgents() {
    return Array.from(this.agents.values()).map(a => a.card.toJSON());
  }

  /**
   * Express middleware for A2A endpoints
   */
  middleware() {
    return async (req, res, next) => {
      // Agent discovery
      if (req.path === '/.well-known/agent.json') {
        return res.json(this.listAgents()[0] || {});
      }

      // List agents
      if (req.path === '/a2a/agents' && req.method === 'GET') {
        return res.json({ agents: this.listAgents() });
      }

      // Agent card
      const cardMatch = req.path.match(/^\/a2a\/([^/]+)\/?$/);
      if (cardMatch && req.method === 'GET') {
        const card = this.getAgentCard(cardMatch[1]);
        if (card) return res.json(card);
        return res.status(404).json({ error: 'Agent not found' });
      }

      // Task submission
      const taskMatch = req.path.match(/^\/a2a\/([^/]+)\/tasks\/?$/);
      if (taskMatch && req.method === 'POST') {
        try {
          const result = await this.handleRequest(taskMatch[1], req.body);
          return res.json(result);
        } catch (error) {
          return res.status(500).json({ error: error.message });
        }
      }

      // Task status
      const taskStatusMatch = req.path.match(/^\/a2a\/tasks\/([^/]+)\/?$/);
      if (taskStatusMatch && req.method === 'GET') {
        const task = this.tasks.get(taskStatusMatch[1]);
        if (task) return res.json(task.toJSON());
        return res.status(404).json({ error: 'Task not found' });
      }

      next();
    };
  }
}

export default A2AServer;