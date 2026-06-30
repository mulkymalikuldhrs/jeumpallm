// router.js
// Jeumpa LLM — Smart Multi-Provider Router
// Routes requests to best available provider with round-robin and failover

import { MODEL_ALIASES } from './config/providers.js';

/**
 * Resolve model aliases to canonical model IDs
 * @param {string} rawModel
 * @returns {string}
 */
export function resolveModel(rawModel) {
  if (!rawModel || rawModel === 'auto' || rawModel === 'Auto') return null;
  // Check aliases first
  const lower = rawModel.toLowerCase().trim();
  if (MODEL_ALIASES[lower]) return MODEL_ALIASES[lower];
  return rawModel;
}

/**
 * Smart auto-routing based on message content
 * Returns recommended model ID based on task type
 * @param {Array} messages
 * @returns {string}
 */
export function pickModel(messages) {
  const text = messages.map(m => m.content || '').join(' ').toLowerCase();

  if (!text || text.trim() === '') {
    return 'deepseek-chat';
  }

  // BUILDING — Code, Architecture, Implementation
  if (/code|implement|function|class|api|debug|bug|fix|refactor|sql|database|frontend|backend|deploy|config|docker|kubernetes|terraform|write a|create a|build|develop|script|program|compile|syntax|variable|loop|array|object|module|package|npm|pip|git|commit/i.test(text)) {
    return 'claude-opus-4-5-latest';
  }

  // PLANNING — Architecture, Design, Analysis
  if (/plan|design|rencana|rencanakan|strategy|analyze|compare|decision|recommend|struktur|periksa|overview|roadmap|alur|diagram|flow|system design|high level|architect|evaluate|assess/i.test(text)) {
    return 'deepseek-chat';
  }

  // REASONING — Complex problem solving, math, logic
  if (/reason|solve|explain|how does|why is|what is|step by step|proof|calculate|derive|think about|math|equation|formula|theorem|logic|prove/i.test(text)) {
    return 'gpt-4o';
  }

  // FAST — Quick tasks, simple questions
  if (text.includes('?') || text.length < 100) {
    return 'gpt-4o-mini';
  }

  // DEFAULT — balanced for most tasks
  return 'deepseek-chat';
}

/**
 * Get task type from messages for routing hints
 * @param {Array} messages
 * @returns {string}
 */
export function getTaskType(messages) {
  const text = messages.map(m => m.content || '').join(' ').toLowerCase();

  if (/code|implement|function|class|debug|fix|refactor|deploy|build|develop/i.test(text)) return 'code';
  if (/plan|design|strategy|analyze|roadmap|architect/i.test(text)) return 'planning';
  if (/reason|solve|explain|calculate|prove/i.test(text)) return 'reasoning';
  if (text.length < 100 || text.includes('?')) return 'fast';
  return 'general';
}
