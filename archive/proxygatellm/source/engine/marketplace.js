/**
 * Jeumpa LLM Agent Marketplace v1.0
 * Discover, install, share, and monetize agent configurations
 * The "npm for AI agents"
 */

/**
 * Agent Package
 */
export class AgentPackage {
  constructor(config) {
    this.name = config.name;
    this.version = config.version || '1.0.0';
    this.description = config.description;
    this.author = config.author;
    this.license = config.license || 'MIT';
    this.tags = config.tags || [];
    this.category = config.category || 'general';
    this.homepage = config.homepage || '';
    this.repository = config.repository || '';
    this.readme = config.readme || '';
    this.agents = config.agents || [];
    this.tools = config.tools || [];
    this.mcpServers = config.mcpServers || [];
    this.dependencies = config.dependencies || {};
    this.peerDependencies = config.peerDependencies || {};
    this.installCount = config.installCount || 0;
    this.rating = config.rating || 0;
    this.createdAt = config.createdAt || new Date().toISOString();
    this.updatedAt = config.updatedAt || new Date().toISOString();
  }

  /**
   * Convert to JSON
   */
  toJSON() {
    return {
      name: this.name,
      version: this.version,
      description: this.description,
      author: this.author,
      license: this.license,
      tags: this.tags,
      category: this.category,
      homepage: this.homepage,
      repository: this.repository,
      readme: this.readme,
      agents: this.agents,
      tools: this.tools,
      mcpServers: this.mcpServers,
      dependencies: this.dependencies,
      peerDependencies: this.peerDependencies,
      installCount: this.installCount,
      rating: this.rating,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  /**
   * Validate package
   */
  validate() {
    const errors = [];

    if (!this.name) errors.push('name is required');
    if (!this.version) errors.push('version is required');
    if (!this.description) errors.push('description is required');
    if (!this.author) errors.push('author is required');

    // Version format
    if (!/^\d+\.\d+\.\d+/.test(this.version)) {
      errors.push('version must follow semver');
    }

    return { valid: errors.length === 0, errors };
  }
}

/**
 * Agent Marketplace Registry
 */
export class AgentMarketplace {
  constructor(config = {}) {
    this.packages = new Map();
    this.categories = new Map();
    this.searchIndex = new Map();
    this.storage = config.storage || null;
  }

  /**
   * Register a package
   */
  async register(packageData) {
    const pkg = packageData instanceof AgentPackage ? packageData : new AgentPackage(packageData);

    // Validate
    const validation = pkg.validate();
    if (!validation.valid) {
      throw new Error(`Invalid package: ${validation.errors.join(', ')}`);
    }

    // Check for existing
    if (this.packages.has(pkg.name)) {
      const existing = this.packages.get(pkg.name);
      if (existing.version === pkg.version) {
        throw new Error(`Package ${pkg.name}@${pkg.version} already exists`);
      }
    }

    // Store
    this.packages.set(pkg.name, pkg);

    // Index
    this.indexPackage(pkg);

    // Persist
    if (this.storage) {
      await this.storage.save(pkg);
    }

    return pkg;
  }

  /**
   * Get a package
   */
  get(name, version = 'latest') {
    const pkg = this.packages.get(name);
    if (!pkg) return null;

    if (version === 'latest') {
      return pkg;
    }

    // Find specific version
    for (const [key, p] of this.packages) {
      if (key === name && p.version === version) {
        return p;
      }
    }

    return null;
  }

  /**
   * Install a package
   */
  async install(name, options = {}) {
    const pkg = this.get(name, options.version || 'latest');
    if (!pkg) {
      throw new Error(`Package not found: ${name}`);
    }

    // Check dependencies
    for (const [depName, depVersion] of Object.entries(pkg.dependencies)) {
      const dep = this.get(depName, depVersion);
      if (!dep) {
        throw new Error(`Missing dependency: ${depName}@${depVersion}`);
      }
    }

    // Increment install count
    pkg.installCount++;

    // Persist
    if (this.storage) {
      await this.storage.save(pkg);
    }

    return {
      name: pkg.name,
      version: pkg.version,
      installed: true,
      agents: pkg.agents,
      tools: pkg.tools,
    };
  }

  /**
   * Search packages
   */
  search(query, options = {}) {
    const q = query.toLowerCase();
    const limit = options.limit || 20;
    const category = options.category || null;

    let results = [];

    // Search by name, description, tags
    for (const [name, pkg] of this.packages) {
      if (category && pkg.category !== category) continue;

      const match =
        name.toLowerCase().includes(q) ||
        pkg.description.toLowerCase().includes(q) ||
        pkg.tags.some(t => t.toLowerCase().includes(q));

      if (match) {
        results.push({
          name: pkg.name,
          version: pkg.version,
          description: pkg.description,
          author: pkg.author,
          category: pkg.category,
          tags: pkg.tags,
          installCount: pkg.installCount,
          rating: pkg.rating,
        });
      }
    }

    // Sort by install count
    results.sort((a, b) => b.installCount - a.installCount);

    return results.slice(0, limit);
  }

  /**
   * List by category
   */
  listByCategory(category) {
    return Array.from(this.packages.values())
      .filter(p => p.category === category)
      .map(p => ({
        name: p.name,
        version: p.version,
        description: p.description,
        installCount: p.installCount,
      }));
  }

  /**
   * List all categories
   */
  listCategories() {
    const categories = new Map();
    for (const pkg of this.packages.values()) {
      if (!categories.has(pkg.category)) {
        categories.set(pkg.category, 0);
      }
      categories.set(pkg.category, categories.get(pkg.category) + 1);
    }
    return Array.from(categories.entries()).map(([name, count]) => ({ name, count }));
  }

  /**
   * Index package for search
   */
  indexPackage(pkg) {
    // Index by tags
    for (const tag of pkg.tags) {
      if (!this.searchIndex.has(tag)) {
        this.searchIndex.set(tag, new Set());
      }
      this.searchIndex.get(tag).add(pkg.name);
    }

    // Index by category
    if (!this.categories.has(pkg.category)) {
      this.categories.set(pkg.category, new Set());
    }
    this.categories.get(pkg.category).add(pkg.name);
  }

  /**
   * Rate a package
   */
  rate(name, rating) {
    const pkg = this.packages.get(name);
    if (!pkg) throw new Error(`Package not found: ${name}`);

    // Simple average (in production, would store all ratings)
    pkg.rating = (pkg.rating + rating) / 2;

    if (this.storage) {
      this.storage.save(pkg);
    }

    return pkg;
  }

  /**
   * Get popular packages
   */
  getPopular(limit = 10) {
    return Array.from(this.packages.values())
      .sort((a, b) => b.installCount - a.installCount)
      .slice(0, limit)
      .map(p => ({
        name: p.name,
        version: p.version,
        description: p.description,
        installCount: p.installCount,
        rating: p.rating,
      }));
  }

  /**
   * Get featured packages
   */
  getFeatured(limit = 5) {
    return Array.from(this.packages.values())
      .filter(p => p.rating >= 4.0 && p.installCount >= 100)
      .slice(0, limit)
      .map(p => ({
        name: p.name,
        version: p.version,
        description: p.description,
        author: p.author,
        tags: p.tags,
      }));
  }

  /**
   * Express middleware
   */
  middleware() {
    return async (req, res, next) => {
      // Search
      if (req.path === '/marketplace/search' && req.method === 'GET') {
        const { q, category, limit } = req.query;
        const results = this.search(q || '', { category, limit: parseInt(limit) || 20 });
        return res.json({ results });
      }

      // List packages
      if (req.path === '/marketplace/packages' && req.method === 'GET') {
        const { category } = req.query;
        const packages = category ? this.listByCategory(category) : Array.from(this.packages.values()).map(p => ({
          name: p.name,
          version: p.version,
          description: p.description,
          category: p.category,
          installCount: p.installCount,
        }));
        return res.json({ packages });
      }

      // Get package
      const pkgMatch = req.path.match(/^\/marketplace\/packages\/([^/]+)\/?$/);
      if (pkgMatch && req.method === 'GET') {
        const pkg = this.get(pkgMatch[1]);
        if (pkg) return res.json(pkg.toJSON());
        return res.status(404).json({ error: 'Package not found' });
      }

      // Install package
      const installMatch = req.path.match(/^\/marketplace\/packages\/([^/]+)\/install\/?$/);
      if (installMatch && req.method === 'POST') {
        try {
          const result = await this.install(installMatch[1]);
          return res.json(result);
        } catch (error) {
          return res.status(500).json({ error: error.message });
        }
      }

      // Popular packages
      if (req.path === '/marketplace/popular' && req.method === 'GET') {
        return res.json({ packages: this.getPopular() });
      }

      // Featured packages
      if (req.path === '/marketplace/featured' && req.method === 'GET') {
        return res.json({ packages: this.getFeatured() });
      }

      // Categories
      if (req.path === '/marketplace/categories' && req.method === 'GET') {
        return res.json({ categories: this.listCategories() });
      }

      next();
    };
  }
}

/**
 * Built-in Agent Packages
 */
export const BuiltinPackages = {
  codingAssistant: {
    name: 'coding-assistant',
    version: '1.0.0',
    description: 'Full-stack coding assistant with code generation, review, and refactoring',
    author: 'Jeumpa LLM',
    tags: ['coding', 'development', 'code-review'],
    category: 'development',
    agents: [
      {
        name: 'coder',
        model: 'claude-opus-4-5-latest',
        systemPrompt: 'You are an expert programmer. Write clean, efficient code.',
        tools: ['read_file', 'write_file', 'run_command'],
      },
    ],
    installCount: 1500,
    rating: 4.8,
  },
  researchAssistant: {
    name: 'research-assistant',
    version: '1.0.0',
    description: 'Multi-LLM research team with debate and synthesis capabilities',
    author: 'Jeumpa LLM',
    tags: ['research', 'analysis', 'brainstorm'],
    category: 'research',
    agents: [
      {
        name: 'researcher',
        model: 'gpt-4o',
        systemPrompt: 'You are a thorough researcher. Provide detailed, well-sourced analysis.',
        tools: ['web_search', 'read_file'],
      },
    ],
    installCount: 800,
    rating: 4.5,
  },
  dataAnalyst: {
    name: 'data-analyst',
    version: '1.0.0',
    description: 'Data analysis agent with visualization and statistical insights',
    author: 'Jeumpa LLM',
    tags: ['data', 'analytics', 'visualization'],
    category: 'data-science',
    agents: [
      {
        name: 'analyst',
        model: 'deepseek-chat',
        systemPrompt: 'You are a data analyst. Analyze data and provide clear insights.',
        tools: ['run_command', 'write_file'],
      },
    ],
    installCount: 600,
    rating: 4.3,
  },
};

export default AgentMarketplace;