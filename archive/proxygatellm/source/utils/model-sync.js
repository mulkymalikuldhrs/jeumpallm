// utils/model-sync.js
// Model Sync Service — auto-fetches latest models from providers

export class ModelSyncService {
  constructor(registry) {
    this.registry = registry;
    this.syncInterval = null;
    this.syncIntervalMs = parseInt(process.env.MODEL_SYNC_INTERVAL_MS || '3600000', 10); // 1 hour default
    this.lastSync = null;
    this.syncHistory = [];
  }

  async start() {
    // Initial sync
    await this.syncModels();
    // Periodic sync
    this.syncInterval = setInterval(() => {
      this.syncModels().catch(err =>
        console.error('[MODEL-SYNC] Sync error:', err.message)
      );
    }, this.syncIntervalMs);
    console.log(`[MODEL-SYNC] Started, syncing every ${this.syncIntervalMs / 1000}s`);
  }

  stop() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  async syncModels() {
    const providers = this.registry.getEnabledProviders();
    console.log(`[MODEL-SYNC] Syncing models from ${providers.length} providers...`);
    
    const results = [];
    for (const provider of providers) {
      try {
        const before = provider.models.length;
        const newModels = await Promise.race([
          provider.fetchModels(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Model fetch timeout')), 15000)
          )
        ]);
        if (Array.isArray(newModels) && newModels.length > 0) {
          provider.models = newModels;
        }
        const after = provider.models.length;
        const added = after - before;
        results.push({ provider: provider.name, before, after, added });
        console.log(`[MODEL-SYNC] ${provider.displayName}: ${before} → ${after} models${added > 0 ? ` (+${added} new)` : ''}`);
      } catch (err) {
        results.push({ provider: provider.name, error: err.message });
        console.warn(`[MODEL-SYNC] ${provider.displayName} sync failed: ${err.message}`);
      }
    }

    this.lastSync = new Date().toISOString();
    this.syncHistory.push({ timestamp: this.lastSync, results });
    // Keep last 10 sync records
    if (this.syncHistory.length > 10) {
      this.syncHistory = this.syncHistory.slice(-10);
    }

    return results;
  }

  getStats() {
    return {
      lastSync: this.lastSync,
      syncIntervalMs: this.syncIntervalMs,
      historyCount: this.syncHistory.length,
      lastResults: this.syncHistory[this.syncHistory.length - 1] || null
    };
  }
}
