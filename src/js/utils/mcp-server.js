// utils/mcp-server.js
// MCP (Model Context Protocol) Server for Jeumpa LLM
// Exposes LLM gateway capabilities as MCP tools and resources

import { providerRegistry } from '../providers/index.js';
import { ProviderManager } from './provider-manager.js';

export class MCPServer {
  constructor(providerManager) {
    this.manager = providerManager;
    this.name = 'Jeumpa LLM';
    this.version = '4.0.0';
  }

  // MCP Tools
  getTools() {
    return [
      {
        name: 'list_models',
        description: 'List all available LLM models across all providers',
        inputSchema: {
          type: 'object',
          properties: {
            provider: { type: 'string', description: 'Filter by provider name' },
            type: { type: 'string', description: 'Filter by model type (fast, general, code, reasoning)' }
          }
        }
      },
      {
        name: 'chat_completion',
        description: 'Execute a chat completion using the best available provider',
        inputSchema: {
          type: 'object',
          properties: {
            messages: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  role: { type: 'string', enum: ['system', 'user', 'assistant'] },
                  content: { type: 'string' }
                },
                required: ['role', 'content']
              },
              description: 'Chat messages'
            },
            model: { type: 'string', description: 'Model ID (or "auto" for smart routing)' },
            stream: { type: 'boolean', description: 'Enable streaming', default: false }
          },
          required: ['messages']
        }
      },
      {
        name: 'get_provider_health',
        description: 'Check health status of a specific provider or all providers',
        inputSchema: {
          type: 'object',
          properties: {
            provider: { type: 'string', description: 'Provider name (omit for all)' }
          }
        }
      },
      {
        name: 'get_routing_stats',
        description: 'Get routing statistics and provider metrics',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      }
    ];
  }

  // MCP Resources
  getResources() {
    return [
      {
        uri: 'jeumpallm://models',
        name: 'Available Models',
        description: 'Complete list of all available LLM models',
        mimeType: 'application/json'
      },
      {
        uri: 'jeumpallm://providers',
        name: 'Provider Status',
        description: 'Real-time provider health and metrics',
        mimeType: 'application/json'
      },
      {
        uri: 'jeumpallm://config',
        name: 'Gateway Configuration',
        description: 'Current gateway configuration',
        mimeType: 'application/json'
      }
    ];
  }

  // Handle MCP tool calls
  async handleToolCall(name, args) {
    switch (name) {
      case 'list_models': {
        const models = providerRegistry.getAllModels();
        let filtered = models;
        if (args.provider) {
          filtered = filtered.filter(m => m.providers?.includes(args.provider));
        }
        if (args.type) {
          filtered = filtered.filter(m => m.type === args.type);
        }
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(filtered.map(m => ({
              id: m.id,
              type: m.type,
              description: m.description,
              providers: m.providers
            })), null, 2)
          }]
        };
      }

      case 'chat_completion': {
        try {
          const { messages, model = 'auto', stream = false } = args;
          const { result, provider, latency } = await this.manager.chatWithFailover(model, messages, { stream });
          let content = '';
          if (result?.choices?.[0]?.message?.content) {
            content = result.choices[0].message.content;
          } else if (typeof result === 'string') {
            content = result;
          } else {
            content = JSON.stringify(result);
          }
          return {
            content: [{ type: 'text', text: content }],
            _meta: { provider, model, latency_ms: latency }
          };
        } catch (err) {
          return {
            content: [{ type: 'text', text: `Error: ${err.message}` }],
            isError: true
          };
        }
      }

      case 'get_provider_health': {
        if (args.provider) {
          const provider = providerRegistry.getProvider(args.provider);
          if (!provider) {
            return { content: [{ type: 'text', text: `Provider "${args.provider}" not found` }] };
          }
          try {
            await provider.checkHealth();
          } catch {}
          return {
            content: [{ type: 'text', text: JSON.stringify(provider.getStats(), null, 2) }]
          };
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(providerRegistry.getStats(), null, 2) }]
        };
      }

      case 'get_routing_stats': {
        return {
          content: [{ type: 'text', text: JSON.stringify(this.manager.getStats(), null, 2) }]
        };
      }

      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true
        };
    }
  }

  // Handle MCP resource reads
  async handleResourceRead(uri) {
    switch (uri) {
      case 'jeumpallm://models':
        return {
          contents: [{
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(providerRegistry.getAllModels(), null, 2)
          }]
        };
      case 'jeumpallm://providers':
        return {
          contents: [{
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(providerRegistry.getStats(), null, 2)
          }]
        };
      case 'jeumpallm://config':
        return {
          contents: [{
            uri,
            mimeType: 'application/json',
            text: JSON.stringify({
              version: this.version,
              providers: providerRegistry.getEnabledProviders().map(p => p.name),
              healthCheckIntervalMs: this.manager.healthCheckIntervalMs
            }, null, 2)
          }]
        };
      default:
        throw new Error(`Unknown resource: ${uri}`);
    }
  }

  // Handle JSON-RPC 2.0 request (MCP protocol)
  async handleRequest(request) {
    const { method, params, id } = request;

    try {
      let result;

      switch (method) {
        case 'initialize':
          result = {
            protocolVersion: '2025-03-26',
            capabilities: {
              tools: { listChanged: false },
              resources: { subscribe: false, listChanged: false }
            },
            serverInfo: {
              name: this.name,
              version: this.version
            }
          };
          break;

        case 'tools/list':
          result = { tools: this.getTools() };
          break;

        case 'tools/call':
          result = await this.handleToolCall(params.name, params.arguments || {});
          break;

        case 'resources/list':
          result = { resources: this.getResources() };
          break;

        case 'resources/read':
          result = await this.handleResourceRead(params.uri);
          break;

        case 'ping':
          result = {};
          break;

        default:
          return {
            jsonrpc: '2.0',
            error: { code: -32601, message: `Method not found: ${method}` },
            id
          };
      }

      return { jsonrpc: '2.0', result, id };

    } catch (err) {
      return {
        jsonrpc: '2.0',
        error: { code: -32603, message: err.message },
        id
      };
    }
  }
}

export default MCPServer;
