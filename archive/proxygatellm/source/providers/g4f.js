// providers/g4f.js
// G4F/FreeGPT Provider — uses g4f Python library via subprocess

import { BaseProvider } from './base.js';
import { PROVIDER_CONFIG } from '../config/providers.js';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const execFileAsync = promisify(execFile);

export class G4FProvider extends BaseProvider {
  constructor(config = {}) {
    const cfg = { ...PROVIDER_CONFIG.g4f, ...config };
    super(cfg);
    this._pythonAvailable = null;
    this._g4fAvailable = null;
  }

  async _checkDependencies() {
    if (this._g4fAvailable !== null) return this._g4fAvailable;
    try {
      const { stdout } = await execFileAsync('python3', ['-c', 'import g4f; print(g4f.__version__)'], { timeout: 5000 });
      this._g4fAvailable = true;
      console.log(`[G4F] g4f available, version: ${stdout.trim()}`);
    } catch {
      this._g4fAvailable = false;
      console.warn('[G4F] g4f not available — provider disabled');
      this.enabled = false;
    }
    return this._g4fAvailable;
  }

  async chat(messages, options = {}) {
    await this._checkDependencies();
    if (!this._g4fAvailable) throw new Error('G4F not available');

    const model = options.model || 'gpt-4o';
    const script = this._buildScript(messages, model);

    const { stdout, stderr } = await execFileAsync('python3', ['-c', script], {
      timeout: this.timeout,
      maxBuffer: 1024 * 1024 * 10
    });

    if (stderr && !stdout) {
      throw new Error(`G4F error: ${stderr}`);
    }

    const content = stdout.trim();

    if (options.format === 'anthropic') {
      return this.formatAnthropicResponse(content, model);
    }
    return this.formatOpenAIResponse(content, model);
  }

  async chatStream(messages, options = {}) {
    // G4F doesn't easily support streaming via subprocess
    // Fallback to non-streaming
    const result = await this.chat(messages, options);
    async function* singleChunk() {
      yield result;
    }
    return singleChunk();
  }

  _buildScript(messages, model) {
    const msgsJson = JSON.stringify(
      messages.map(m => ({
        role: m.role || 'user',
        content: typeof m.content === 'string' ? m.content : String(m.content || '')
      }))
    );

    return `
import g4f
import json
import sys

messages = json.loads('${msgsJson.replace(/'/g, "\\'")}')
try:
    response = g4f.ChatCompletion.create(
        model="${model}",
        messages=messages,
        stream=False
    )
    print(response if isinstance(response, str) else str(response))
except Exception as e:
    print(str(e), file=sys.stderr)
    sys.exit(1)
`;
  }

  async checkHealth() {
    await this._checkDependencies();
    return this._g4fAvailable;
  }
}
