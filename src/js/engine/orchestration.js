/**
 * Jeumpa LLM Agent Orchestration — ACTUALLY WORKS
 * Graph-based execution engine
 */

/**
 * Node Types
 */
export const NodeTypes = {
  LLM: 'llm',
  TOOL: 'tool',
  CONDITION: 'condition',
  PARALLEL: 'parallel',
  AGGREGATOR: 'aggregator',
};

/**
 * Execution State — mutable state container
 */
export class State {
  constructor(initial = {}) {
    this.data = { ...initial };
    this.history = [];
    this.metadata = {
      startTime: Date.now(),
      nodeExecutions: [],
      tokenUsage: { input: 0, output: 0 },
    };
  }

  get(key) {
    return this.data[key];
  }

  set(key, value) {
    this.data[key] = value;
    this.history.push({ key, value, timestamp: Date.now() });
    return this;
  }

  update(partial) {
    Object.assign(this.data, partial);
    return this;
  }

  snapshot() {
    return JSON.parse(JSON.stringify(this.data));
  }
}

/**
 * Agent Graph — ACTUALLY EXECUTES
 */
export class AgentGraph {
  constructor(config = {}) {
    this.name = config.name || 'unnamed-graph';
    this.nodes = new Map();
    this.edges = [];
    this.entryNode = null;
    this.finishNodes = new Set();
    this.maxIterations = config.maxIterations || 100;
    this.baseUrl = config.baseUrl || 'http://localhost:3333';
  }

  /**
   * Add a node
   */
  addNode(id, handler, config = {}) {
    this.nodes.set(id, { id, handler, config });
    return this;
  }

  /**
   * Add an edge
   */
  addEdge(from, to, condition = null) {
    this.edges.push({ from, to, condition });
    return this;
  }

  /**
   * Set entry point
   */
  setEntryPoint(nodeId) {
    this.entryNode = nodeId;
    return this;
  }

  /**
   * Set finish point
   */
  setFinishPoint(nodeId) {
    this.finishNodes.add(nodeId);
    return this;
  }

  /**
   * Compile and validate
   */
  compile() {
    if (!this.entryNode) throw new Error('Entry point not set');
    if (!this.nodes.has(this.entryNode)) throw new Error(`Entry node not found: ${this.entryNode}`);

    for (const edge of this.edges) {
      if (!this.nodes.has(edge.from)) throw new Error(`Edge references unknown node: ${edge.from}`);
      if (!this.nodes.has(edge.to)) throw new Error(`Edge references unknown node: ${edge.to}`);
    }

    return {
      invoke: (state) => this.invoke(state),
      stream: (state) => this.stream(state),
    };
  }

  /**
   * Invoke the graph — ACTUALLY EXECUTES NODES
   */
  async invoke(initialState = {}) {
    const state = new State(initialState);
    let currentNode = this.entryNode;
    let iterations = 0;

    while (currentNode && iterations < this.maxIterations) {
      iterations++;

      const node = this.nodes.get(currentNode);
      if (!node) throw new Error(`Node not found: ${currentNode}`);

      // Execute node handler
      const start = Date.now();
      let output;

      try {
        output = await node.handler(state, {
          ...node.config,
          baseUrl: this.baseUrl,
        });
      } catch (error) {
        output = { error: error.message };
      }

      // Record execution
      state.metadata.nodeExecutions.push({
        nodeId: currentNode,
        duration: Date.now() - start,
        success: !output?.error,
      });

      // Update state with output
      if (output && typeof output === 'object') {
        state.update(output);
      }

      // Check if finished
      if (this.finishNodes.has(currentNode)) {
        break;
      }

      // Find next node
      const edges = this.edges.filter(e => e.from === currentNode);
      let nextNode = null;

      for (const edge of edges) {
        if (!edge.condition || edge.condition(state)) {
          nextNode = edge.to;
          break;
        }
      }

      currentNode = nextNode;
    }

    return state;
  }

  /**
   * Stream execution — yields events
   */
  async *stream(initialState = {}) {
    const state = new State(initialState);
    let currentNode = this.entryNode;
    let iterations = 0;

    while (currentNode && iterations < this.maxIterations) {
      iterations++;

      const node = this.nodes.get(currentNode);
      if (!node) break;

      yield { type: 'node_start', nodeId: currentNode };

      const start = Date.now();
      let output;

      try {
        output = await node.handler(state, {
          ...node.config,
          baseUrl: this.baseUrl,
        });
      } catch (error) {
        output = { error: error.message };
      }

      state.metadata.nodeExecutions.push({
        nodeId: currentNode,
        duration: Date.now() - start,
      });

      if (output && typeof output === 'object') {
        state.update(output);
      }

      yield { type: 'node_complete', nodeId: currentNode, output };

      if (this.finishNodes.has(currentNode)) break;

      const edges = this.edges.filter(e => e.from === currentNode);
      let nextNode = null;

      for (const edge of edges) {
        if (!edge.condition || edge.condition(state)) {
          nextNode = edge.to;
          break;
        }
      }

      currentNode = nextNode;
    }

    yield { type: 'graph_complete', state: state.snapshot() };
  }
}

/**
 * Built-in Handlers — ACTUALLY CALL APIs
 */
export const Handlers = {
  /**
   * LLM Handler — calls Jeumpa LLM API
   */
  llm: (config) => async (state, nodeConfig) => {
    const baseUrl = nodeConfig.baseUrl || 'http://localhost:3333';
    const model = config.model || state.get('model') || 'auto';
    const prompt = typeof config.prompt === 'function'
      ? config.prompt(state)
      : config.prompt || state.get('input') || '';

    const messages = config.messages
      ? config.messages(state)
      : [{ role: 'user', content: prompt }];

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: config.maxTokens || 2048,
        temperature: config.temperature || 0.7,
      }),
    });

    if (!response.ok) {
      throw new Error(`LLM error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    return { output: content, lastOutput: content };
  },

  /**
   * Tool Handler — executes a function
   */
  tool: (fn) => async (state, nodeConfig) => {
    const input = state.get('toolInput') || state.get('input') || state.get('output') || '';
    const result = await fn(input, state, nodeConfig);
    return { toolResult: result };
  },

  /**
   * Condition Handler — branch based on state
   */
  condition: (fn) => async (state) => {
    const result = fn(state);
    return { conditionResult: result };
  },

  /**
   * Parallel Handler — run multiple handlers concurrently
   */
  parallel: (handlers) => async (state, nodeConfig) => {
    const results = await Promise.all(
      handlers.map(handler => handler(state, nodeConfig))
    );
    return { parallelResults: results };
  },

  /**
   * Aggregator Handler — combine results
   */
  aggregator: (strategy = 'concat') => async (state) => {
    const inputs = state.get('parallelResults') || [];
    let result;

    switch (strategy) {
      case 'concat':
        result = inputs.map(i => i?.output || i?.lastOutput || JSON.stringify(i)).join('\n\n');
        break;
      case 'merge':
        result = Object.assign({}, ...inputs.filter(i => typeof i === 'object'));
        break;
      default:
        result = inputs;
    }

    return { aggregated: result, output: result };
  },
};

export default AgentGraph;