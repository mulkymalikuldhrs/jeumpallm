const API = {
  baseURL: '/v1',
  apiKey: localStorage.getItem('api_key') || '',

  init() {
    this.apiKey = localStorage.getItem('api_key') || ''
    const saved = localStorage.getItem('server_url')
    if (saved) {
      this.baseURL = saved
    } else if (window.location.protocol.startsWith('http')) {
      this.baseURL = window.location.origin + '/v1'
    }
  },

  setServerURL(url) {
    this.baseURL = url
    localStorage.setItem('server_url', url)
  },

  getServerURL() { return this.baseURL },

  setApiKey(key) {
    this.apiKey = key
    if (key) localStorage.setItem('api_key', key)
    else localStorage.removeItem('api_key')
  },

  getApiKey() { return this.apiKey },

  hasAuth() { return !!this.apiKey && this.apiKey.includes(':') },

  headers() {
    const h = { 'Content-Type': 'application/json' }
    if (this.apiKey) h['x-api-key'] = this.apiKey
    return h
  },

  async _fetch(method, path, body) {
    const url = path.startsWith('http') ? path : `${this.baseURL}${path}`
    const opts = { method, headers: this.headers() }
    if (body !== undefined) opts.body = JSON.stringify(body)
    let res
    try {
      res = await fetch(url, opts)
    } catch (err) {
      throw new Error(`Network error: ${err.message}`)
    }
    if (!res.ok) {
      let msg
      try {
        const errBody = await res.json()
        msg = errBody.error || errBody.message || errBody.detail || JSON.stringify(errBody)
      } catch {
        msg = res.statusText || `HTTP ${res.status}`
      }
      throw new Error(msg)
    }
    if (res.status === 204) return null
    return res.json()
  },

  async get(path) { return this._fetch('GET', path) },
  async post(path, body) { return this._fetch('POST', path, body) },
  async put(path, body) { return this._fetch('PUT', path, body) },
  async del(path) { return this._fetch('DELETE', path) },

  async streamChat(body, onChunk, onDone, onError) {
    try {
      const res = await fetch(`${this.baseURL}/streaming`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        let msg
        try { const e = await res.json(); msg = e.error || e.message || JSON.stringify(e) }
        catch { msg = res.statusText }
        throw new Error(msg)
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || !trimmed.startsWith('data:')) continue
          const data = trimmed.slice(5).trim()
          if (data === '[DONE]') { if (onDone) onDone(); return }
          try {
            const parsed = JSON.parse(data)
            const text = parsed.choices?.[0]?.delta?.content || parsed.choices?.[0]?.text || parsed.content || ''
            if (text && onChunk) onChunk(text)
          } catch {}
        }
      }
      if (onDone) onDone()
    } catch (err) {
      if (onError) onError(err)
      else throw err
    }
  },

  login(email, password) {
    const key = `${email}:${password}`
    this.setApiKey(key)
    return Promise.resolve({ status: 'ok', method: 'x-api-key' })
  },

  logout() { this.setApiKey('') },

  async register(email, password) { return this.post('/auth/register', { email, password }) },

  getMe() {
    if (!this.hasAuth()) return Promise.reject(new Error('not_authenticated'))
    return Promise.resolve({ email: this.apiKey.split(':')[0], method: 'x-api-key' })
  },

  async listModels() { return this.get('/models') },
  async listProviders() { return this.get('/providers') },
  async getProviderHealth(name) { return this.get(`/health?provider=${name}`) },
  async getHealth() { return this.get('/health') },
  async chat(body) { return this.post('/chat/completions', body) },
  async mcpTools() {
    return this.post('/mcp', { jsonrpc: '2.0', method: 'tools/list', id: 1 })
  },
  async ragIngest(text, metadata) { return this.post('/rag/ingest', { text, metadata }) },
  async ragQuery(query, limit) { return this.post('/rag/query', { query, limit }) },
  async ragDocuments() { return this.get('/rag/documents') },
  async ragDelete(id) { return this.del(`/rag/documents/${id}`) },
  async listConversations() { return this.get('/conversations') },
  async getConversation(id) { return this.get(`/conversations/${id}`) },
  async deleteConversation(id) { return this.del(`/conversations/${id}`) },
  async listTasks() { return this.get('/tasks') },
  async runTask(name, input) { return this.post('/agent/chat', { task: name, input }) },
  async discoveryStatus() { return this.get('/discovery/status') },
  async refreshProviders() { return this.post('/refresh') },
  async getSubscription() { return this.get('/billing/subscription') },
  async getUsage() { return this.get('/usage') },
  async circuitBreakerStatus() { return this.get('/circuit-breakers') },
  async costEstimate(model, tokens) { return this.post('/cost-estimate', { model, tokens }) },
  async getLogs(page, limit) { return this.get(`/logs?page=${page}&limit=${limit}`) },
  // ── Analytics ──
  async analyticsOverview(hours) { return this.get(`/analytics/overview${hours ? '?hours='+hours : ''}`) },
  async providerRanking() { return this.get('/analytics/provider-ranking') },
  async modelPopularity() { return this.get('/analytics/model-popularity') },
  // ── Tracing ──
  async tracingSpans(limit, type) {
    let q = `?limit=${limit||50}`
    if (type) q += `&type=${type}`
    return this.get(`/tracing/spans${q}`)
  },
  async tracingTrace(traceId) { return this.get(`/tracing/trace/${traceId}`) },
  async tracingStats(hours) { return this.get(`/tracing/stats${hours ? '?hours='+hours : ''}`) },
  // ── Tools ──
  async listTools() { return this.get('/tools') },
  async executeTool(name, args) { return this.post('/tools/execute', { name, arguments: args }) },
  async agentChat(body) { return this.post('/agent/chat', body) },
  // ── Workflows ──
  async listWorkflows() { return this.get('/workflows') },
  async createWorkflow(body) { return this.post('/workflows', body) },
  async getWorkflow(id) { return this.get(`/workflows/${id}`) },
  async executeWorkflow(id, input) { return this.post(`/workflows/${id}/execute`, { input }) },
  async workflowExecutionStatus(id) { return this.get(`/workflows/executions/${id}`) },
  // ── Marketplace ──
  async getPackage(id) { return this.get(`/marketplace/packages/${id}`) },
  async registerPackage(body) { return this.post('/marketplace/packages', body) },
  async ratePackage(id, rating) { return this.post(`/marketplace/packages/${id}/rate`, { rating }) },
  // ── Santri ──
  async santriRegister(data) { return this.post('/santri/register', data) },
  async santriVerify(answers) { return this.post('/santri/verify', { answers }) },
  async santriStatus() { return this.get('/santri/status') },
  // ── Donasi ──
  async donationMethods() { return this.get('/donate/methods') },
  async donationTiers() { return this.get('/donate/tiers') },
  async donationCreate(amount, currency, paymentMethod) { return this.post('/donate/create', { amount, currency, payment_method: paymentMethod }) },
  async donationConfirm(paymentRef) { return this.post('/donate/confirm', { payment_ref: paymentRef }) },
  async donationStatus() { return this.get('/donate/status') },
  // ── Fugu ──
  async fuguAsk(body) { return this.post('/fugu/ask', body) },
  async fuguStatus() { return this.get('/fugu/status') },
  async fuguConfig(body) { return this.post('/fugu/config', body) },
  // ── Agent ──
  async agentCode(task, language, context) { return this.post('/v1/agent/code', { task, language, context }) },
  async agentChat(messages, model) { return this.post('/v1/agent/chat', { messages, model }) },
  async agentTools() { return this.get('/v1/agent/tools') },
  async agentSubscribe() { return this.get('/v1/agent/subscribe') },
  async agentTelegram(botToken, webhookUrl) { return this.post('/v1/agent/telegram', { bot_token: botToken, webhook_url: webhookUrl }) },
  // ── A2A ──
  async registerAgent(body) { return this.post('/a2a/agents', body) },
  async createAgentTask(name, input) { return this.post(`/a2a/${name}/tasks`, { input }) },
  async getAgentTask(id) { return this.get(`/a2a/tasks/${id}`) },
}

window.API = API
