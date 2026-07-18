// utils/cost-estimator.js
// Cost Estimator — pre-flight cost estimation for LLM requests

// Pricing per 1M tokens (USD) — approximate as of 2025
const MODEL_PRICING = {
  // OpenAI
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-5-chat': { input: 5.00, output: 15.00 },
  'o1': { input: 15.00, output: 60.00 },
  'o1-mini': { input: 3.00, output: 12.00 },
  'o3-mini': { input: 1.10, output: 4.40 },
  
  // Anthropic
  'claude-opus-4-5-latest': { input: 15.00, output: 75.00 },
  'claude-sonnet-4': { input: 3.00, output: 15.00 },
  'claude-haiku-4-5': { input: 0.80, output: 4.00 },
  'claude-3-5-sonnet': { input: 3.00, output: 15.00 },
  'claude-3-haiku': { input: 0.25, output: 1.25 },
  
  // Google
  'gemini-2.0-flash': { input: 0.10, output: 0.40 },
  'gemini-2.5-flash-preview-05-20': { input: 0.15, output: 0.60 },
  'gemini-2.5-pro-preview-05-06': { input: 1.25, output: 10.00 },
  
  // DeepSeek
  'deepseek-chat': { input: 0.27, output: 1.10 },
  'deepseek-r1': { input: 0.55, output: 2.19 },
  'deepseek-reasoner': { input: 0.55, output: 2.19 },
  
  // xAI
  'grok-3': { input: 3.00, output: 15.00 },
  'grok-3-fast': { input: 0.50, output: 3.00 },
  
  // Llama models (typically cheaper hosting)
  'llama-3.3-70b-versatile': { input: 0.20, output: 0.80 },
  'llama-3.1-8b-instant': { input: 0.02, output: 0.08 },
  'meta-llama/Llama-3.3-70B-Instruct': { input: 0.20, output: 0.80 },
  
  // Mistral
  'mistral-large-2512': { input: 2.00, output: 6.00 },
  'codestral-2508': { input: 0.30, output: 0.90 },
  'mixtral-8x7b-32768': { input: 0.24, output: 0.24 },
  
  // Qwen
  'qwen-2.5-coder-32b-instruct': { input: 0.10, output: 0.40 },
  'Qwen/Qwen2.5-Coder-32B-Instruct': { input: 0.10, output: 0.40 },
  
  // Others
  'groq-default': { input: 0.05, output: 0.10 },
  'cerebras-default': { input: 0.05, output: 0.10 },
  'cohere-default': { input: 1.00, output: 2.00 }
};

// Free providers — zero cost
const FREE_PROVIDERS = new Set([
  'pollinations', 'duckduckgo', 'llm7', 'deepai', 'freegpt', 
  'apiairforce', 'venice', 'g4f', 'blackbox', 'phind'
]);

/**
 * Estimate token count from text (rough approximation)
 * ~4 characters per token for English, ~2 for CJK
 */
export function estimateTokens(text) {
  if (!text || typeof text !== 'string') return 0;
  // Check for CJK characters
  const cjkChars = (text.match(/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/g) || []).length;
  const otherChars = text.length - cjkChars;
  return Math.ceil(cjkChars / 2 + otherChars / 4);
}

/**
 * Estimate input tokens from messages array
 */
export function estimateInputTokens(messages) {
  if (!Array.isArray(messages)) return 0;
  let total = 0;
  for (const msg of messages) {
    const content = typeof msg.content === 'string' ? msg.content :
                    Array.isArray(msg.content) ? msg.content.map(c => c.text || c).join(' ') : '';
    total += estimateTokens(content) + 4; // +4 for role/formatting overhead
  }
  return total;
}

/**
 * Estimate cost for a request
 */
export function estimateCost(model, inputTokens, outputTokens = 0) {
  // Default output tokens estimate if not specified
  if (!outputTokens) outputTokens = Math.min(inputTokens, 4096);
  
  let pricing = MODEL_PRICING[model];
  
  // Try fuzzy matching
  if (!pricing) {
    const lower = model.toLowerCase();
    for (const [key, val] of Object.entries(MODEL_PRICING)) {
      if (lower.includes(key.toLowerCase()) || key.toLowerCase().includes(lower)) {
        pricing = val;
        break;
      }
    }
  }
  
  // Default pricing if model not found
  if (!pricing) {
    pricing = { input: 0.50, output: 2.00 };
  }
  
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  
  return {
    model,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    inputCost: inputCost,
    outputCost: outputCost,
    totalCost: inputCost + outputCost,
    currency: 'USD',
    isFree: FREE_PROVIDERS.has(model) || false,
    pricing: pricing
  };
}

/**
 * Format cost for display
 */
export function formatCost(costObj) {
  if (costObj.isFree) return '$0.00 (FREE)';
  if (costObj.totalCost < 0.001) return `<$0.001`;
  return `$${costObj.totalCost.toFixed(4)}`;
}

export { MODEL_PRICING, FREE_PROVIDERS };
export default { estimateTokens, estimateInputTokens, estimateCost, formatCost };
