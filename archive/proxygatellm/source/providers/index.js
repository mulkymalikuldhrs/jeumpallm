// providers/index.js
// Provider Registry — auto-discovers and registers all 22 providers

import { PollinationsProvider } from './pollinations.js';
import { DuckDuckGoProvider } from './duckduckgo.js';
import { OpenRouterProvider } from './openrouter.js';
import { PuterProvider } from './puter.js';
import { GroqProvider } from './groq.js';
import { HuggingFaceProvider } from './huggingface.js';
import { G4FProvider } from './g4f.js';
import { BlackboxProvider } from './blackbox.js';
import { PhindProvider } from './phind.js';
import { GoogleAIProvider } from './google-ai.js';
import { CerebrasProvider } from './cerebras.js';
import { CloudflareProvider } from './cloudflare.js';
import { CohereProvider } from './cohere.js';
import { TogetherProvider } from './together.js';
import { SambaNovaProvider } from './sambanova.js';
import { ScalewayProvider } from './scaleway.js';
import { InferenceProvider } from './inference.js';
import { LLM7Provider } from './llm7.js';
import { DeepAIProvider } from './deepai.js';
import { VeniceProvider } from './venice.js';
import { FreeGPTProvider } from './freegpt.js';
import { ApiAirforceProvider } from './apiairforce.js';

const providerClasses = [
  // Tier 1: Free — No API Key Required
  PuterProvider,
  PollinationsProvider,
  DuckDuckGoProvider,
  LLM7Provider,
  DeepAIProvider,
  FreeGPTProvider,
  ApiAirforceProvider,
  VeniceProvider,
  OpenRouterProvider,
  GoogleAIProvider,
  // Tier 2: Free API Key
  GroqProvider,
  CerebrasProvider,
  CloudflareProvider,
  CohereProvider,
  HuggingFaceProvider,
  // Tier 2: BYOAPI
  TogetherProvider,
  SambaNovaProvider,
  ScalewayProvider,
  InferenceProvider,
  // Tier 3: Fragile / Reverse-Engineered
  G4FProvider,
  BlackboxProvider,
  PhindProvider
];

class ProviderRegistry {
  constructor() {
    this.providers = new Map();
    this._initialized = false;
  }

  async init(config = {}) {
    let registered = 0;
    let failed = 0;
    
    for (const ProviderClass of providerClasses) {
      try {
        const instance = new ProviderClass(config);
        // Check if provider should be disabled
        const envDisabled = process.env[`DISABLE_${instance.name.toUpperCase()}`];
        if (envDisabled === 'true' || envDisabled === '1') {
          instance.enabled = false;
          console.log(`[PROVIDER] ${instance.displayName} disabled by env`);
        }
        this.providers.set(instance.name, instance);
        registered++;
        console.log(`[PROVIDER] ${instance.displayName} registered (${instance.models.length} models, priority ${instance.priority})`);
      } catch (err) {
        failed++;
        console.warn(`[PROVIDER] Failed to register ${ProviderClass.name}:`, err.message);
      }
    }
    this._initialized = true;
    console.log(`[PROVIDER] Registry initialized: ${registered} registered, ${failed} failed`);
    return this;
  }

  getProvider(name) {
    return this.providers.get(name);
  }

  getEnabledProviders() {
    return [...this.providers.values()].filter(p => p.enabled);
  }

  getProvidersByPriority() {
    return this.getEnabledProviders().sort((a, b) => a.priority - b.priority);
  }

  getProvidersForModel(modelId) {
    return this.getEnabledProviders().filter(p => p.supportsModel(modelId));
  }

  getFreeProviders() {
    return this.getEnabledProviders().filter(p => 
      p.priority === 1 || ['pollinations', 'duckduckgo', 'llm7', 'deepai', 'freegpt', 'apiairforce', 'venice', 'g4f', 'blackbox', 'phind'].includes(p.name)
    );
  }

  getAllModels() {
    const models = [];
    const seen = new Set();
    for (const provider of this.getEnabledProviders()) {
      for (const model of provider.models) {
        const key = model.id;
        if (!seen.has(key)) {
          seen.add(key);
          models.push({
            ...model,
            providers: [provider.name],
            providerPriority: provider.priority
          });
        } else {
          const existing = models.find(m => m.id === key);
          if (existing) {
            existing.providers.push(provider.name);
            if (provider.priority < existing.providerPriority) {
              existing.providerPriority = provider.priority;
              existing.primaryProvider = provider.name;
            }
          }
        }
      }
    }
    return models;
  }

  getStats() {
    return {
      total: this.providers.size,
      enabled: this.getEnabledProviders().length,
      freeProviders: this.getFreeProviders().length,
      totalModels: this.getAllModels().length,
      providers: [...this.providers.values()].map(p => p.getStats())
    };
  }
}

// Singleton
export const providerRegistry = new ProviderRegistry();
export default providerRegistry;
