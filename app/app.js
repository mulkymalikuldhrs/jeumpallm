const App = {
  currentPage: 'overview',
  theme: localStorage.getItem('theme') || 'dark',
  playground: (() => {
    const curId = Store.sessions.current()
    if (curId) {
      const s = Store.sessions.get(curId)
      if (s) return { ...s, _loaded: true }
    }
    return { id: '', messages: [], model: '', temperature: 0.7, maxTokens: 4096, systemPrompt: '', personaId: null, _loaded: false }
  })(),

  init() {
    API.init()
    this.setTheme(this.theme)
    this.bindEvents()
    this.render()
  },

  bindEvents() {
    window.addEventListener('hashchange', () => this.render())
    document.addEventListener('click', (e) => {
      const sidebar = document.getElementById('sidebar')
      const overlay = document.getElementById('overlay')
      if (e.target.closest('#hamburger')) {
        sidebar.classList.toggle('open')
        overlay.style.display = sidebar.classList.contains('open') ? 'block' : 'none'
      }
      if (e.target.closest('#overlay')) {
        sidebar.classList.remove('open')
        overlay.style.display = 'none'
      }
      if (e.target.closest('#theme-toggle')) {
        this.theme = this.theme === 'dark' ? 'light' : 'dark'
        this.setTheme(this.theme)
      }
      const navLink = e.target.closest('#nav a')
      if (navLink) {
        document.querySelectorAll('#nav a').forEach(a => a.classList.remove('active'))
        navLink.classList.add('active')
      }
    })
  },

  render() {
    const hash = location.hash.replace('#', '') || 'overview'
    this.currentPage = hash
    this.updateActiveNav()
    this.updatePageTitle()
    const map = {
      overview: 'renderOverview', providers: 'renderProviders',
      models: 'renderModels', playground: 'renderPlayground',
      api: 'renderAPI', mcp: 'renderMCP', 'mcp-market': 'renderMcpMarket',
      agent: 'renderAgent',
      compare: 'renderCompare',
      analytics: 'renderAnalytics', settings: 'renderSettings', logs: 'renderLogs',
      santri: 'renderSantri', donasi: 'renderDonasi', fugu: 'renderFugu',
      workflows: 'renderWorkflows', tools: 'renderTools', tracing: 'renderTracing',
      persona: 'renderPersona', skills: 'renderSkills',
    }
    if (map[hash]) this[map[hash]]()
    else this.renderOverview()
  },

  updateActiveNav() {
    document.querySelectorAll('#nav a').forEach(a =>
      a.classList.toggle('active', a.dataset.page === this.currentPage))
  },

  updatePageTitle() {
    const t = { overview: 'Overview', providers: 'Providers', models: 'Models',
      playground: 'Playground', api: 'API Reference', mcp: 'MCP',
      compare: 'Compare', analytics: 'Analytics', settings: 'Settings', logs: 'Logs',
      santri: 'Santri', donasi: 'Donasi', fugu: 'Fugu',
      workflows: 'Workflows', tools: 'Tools', tracing: 'Tracing' }
    document.getElementById('page-title').textContent = t[this.currentPage] || 'Overview'
  },

  setContent(html) {
    const el = document.getElementById('content')
    el.innerHTML = html
    el.className = 'page'
  },

  showToast(message, type = 'info') {
    const icons = { success: '✓', error: '✗', warning: '⚠', info: 'ℹ' }
    const toast = document.createElement('div')
    toast.className = `toast ${type}`
    toast.innerHTML = `<span>${icons[type] || ''}</span><span>${this.escapeHtml(message)}</span><button class="toast-close">×</button>`
    toast.querySelector('.toast-close').onclick = () => toast.remove()
    document.getElementById('toast-container').appendChild(toast)
    setTimeout(() => { if (toast.parentNode) toast.remove() }, 4000)
  },

  setLoading(show) {
    let el = document.getElementById('loading-overlay')
    if (show) {
      if (!el) {
        el = document.createElement('div')
        el.id = 'loading-overlay'
        el.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.3);z-index:9998;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(2px)'
        el.innerHTML = '<div class="spinner spinner-lg"></div>'
        document.body.appendChild(el)
      }
      el.style.display = 'flex'
    } else if (el) el.style.display = 'none'
  },

  toggleSidebar() {
    const s = document.getElementById('sidebar')
    s.classList.toggle('open')
    document.getElementById('overlay').style.display = s.classList.contains('open') ? 'block' : 'none'
  },

  setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
    const btn = document.getElementById('theme-toggle')
    if (btn) btn.textContent = theme === 'dark' ? '🌙' : '☀️'
  },

  formatNumber(n) {
    if (n === undefined || n === null) return '0'
    if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B'
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k'
    return String(n)
  },

  formatDate(ts) {
    if (!ts) return ''
    const d = new Date(ts)
    const diff = Date.now() - d
    if (diff < 60000) return 'just now'
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago'
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago'
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  },

  statusDot(status) {
    const s = (status || '').toLowerCase()
    if (s === 'online' || s === 'healthy' || s === 'active' || s === 'up') return '<span class="status-dot online">Online</span>'
    if (s === 'offline' || s === 'unhealthy' || s === 'error' || s === 'down') return '<span class="status-dot offline">Offline</span>'
    if (s === 'degraded' || s === 'slow' || s === 'warning') return '<span class="status-dot degraded">Degraded</span>'
    return `<span class="status-dot">${this.escapeHtml(status || 'Unknown')}</span>`
  },

  formatDuration(ms) {
    if (ms === undefined || ms === null) return '-'
    if (ms < 1000) return Math.round(ms) + 'ms'
    if (ms < 60000) return (ms / 1000).toFixed(1) + 's'
    return Math.floor(ms / 60000) + 'm ' + Math.floor((ms % 60000) / 1000) + 's'
  },

  escapeHtml(str) {
    if (!str) return ''
    const d = document.createElement('div')
    d.textContent = str
    return d.innerHTML
  },

  /* ─── OVERVIEW ─────────────────────────────────── */

  async renderOverview() {
    this.setContent(`
      <div class="grid-4" id="stat-cards">
        ${'<div class="stat-card"><div class="skeleton skeleton-card"></div></div>'.repeat(4)}
      </div>
      <div class="page-section">
        <h2 class="page-section-title">Provider Health</h2>
        <div class="card" id="provider-health"><div class="skeleton skeleton-text"></div></div>
      </div>
      <div class="page-section">
        <h2 class="page-section-title">Recent Activity</h2>
        <div class="card" id="recent-activity"><div class="skeleton skeleton-text"></div></div>
      </div>
    `)
    try {
      const [healthRes, providersRes, modelsRes, usageRes] = await Promise.allSettled([
        API.getHealth(), API.listProviders(), API.listModels(), API.getUsage()
      ])
      const providers = Array.isArray(providersRes.value) ? providersRes.value : (providersRes.value?.providers || [])
      const modelsRaw = modelsRes.value
      const models = Array.isArray(modelsRaw) ? modelsRaw : (modelsRaw?.models || [])
      const health = healthRes.value || {}
      const usage = usageRes.value || {}
      const pHealth = health.providers || {}
      const totalProviders = providers.length || Object.keys(pHealth).length || 0
      const onlineProviders = providers.filter(p => /online|healthy|up/i.test(p.status || p.healthy)).length
        || Object.values(pHealth).filter(v => /healthy|online/i.test(typeof v === 'string' ? v : v.status || '')).length
      const totalRequests = usage.total_requests || usage.total || usage.total_queries || 0
      document.getElementById('stat-cards').innerHTML = `
        <div class="stat-card">
          <div class="stat-card-icon accent"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg></div>
          <div class="stat-card-label">Total Providers</div>
          <div class="stat-card-value">${totalProviders}</div>
          <div class="stat-card-desc">Connected gateways</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-icon success"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></div>
          <div class="stat-card-label">Online Providers</div>
          <div class="stat-card-value">${onlineProviders}</div>
          <div class="stat-card-desc">${totalProviders - onlineProviders} offline</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-icon info"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><box x="3" y="3" width="18" height="18"/><path d="M3 9h18"/></svg></div>
          <div class="stat-card-label">Models Available</div>
          <div class="stat-card-value">${this.formatNumber(models.length)}</div>
          <div class="stat-card-desc">Across all providers</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-icon info"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><path d="M7 16l4-8 4 4 4-6"/></svg></div>
          <div class="stat-card-label">Total Requests</div>
          <div class="stat-card-value">${this.formatNumber(totalRequests)}</div>
          <div class="stat-card-desc">Lifetime</div>
        </div>`
      const names = Object.keys(pHealth).length ? Object.keys(pHealth) : providers.map(p => p.name || p.id).filter(Boolean)
      const healthEl = document.getElementById('provider-health')
      if (names.length) {
        healthEl.innerHTML = `<div class="grid-2">${names.slice(0, 12).map(name => {
          const v = pHealth[name]
          const status = typeof v === 'string' ? v : v?.status || 'unknown'
          return `<div class="card" style="padding:12px 16px"><div style="display:flex;align-items:center;justify-content:space-between"><span style="font-weight:500;color:var(--text-primary)">${this.escapeHtml(name)}</span>${this.statusDot(status)}</div></div>`
        }).join('')}</div>`
      } else {
        healthEl.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🏥</div><div class="empty-state-title">No providers</div></div>'
      }
      document.getElementById('recent-activity').innerHTML = '<div class="empty-state"><div class="empty-state-icon">📋</div><div class="empty-state-title">No recent activity</div><div class="empty-state-desc">Activity appears here once you make requests</div></div>'
    } catch (err) {
      const isDefault = API.getServerURL() === '/v1'
      document.getElementById('stat-cards').innerHTML = ''
      document.getElementById('provider-health').innerHTML = `
        <div class="empty-state" style="padding:32px">
          <div class="empty-state-icon" style="font-size:48px">⚡</div>
          <div class="empty-state-title">${isDefault ? 'Welcome to JeumpaLLM' : 'Cannot Connect'}</div>
          <div class="empty-state-desc">${isDefault ? 'Point this dashboard to your JeumpaLLM server to get started.' : err.message}</div>
          <a class="btn btn-primary" href="#settings" style="margin-top:16px">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            Configur Server
          </a>
        </div>`
      document.getElementById('recent-activity').innerHTML = ''
    }
  },

  /* ─── PROVIDERS ────────────────────────────────── */

  async renderProviders() {
    this.setContent(`
      <div class="page-header">
        <div><h1>Providers</h1><p>Manage and monitor LLM providers</p></div>
        <div class="page-header-actions" style="gap:8px">
          <input type="text" class="input" id="provider-search" placeholder="Search providers..." style="width:220px">
          <button class="btn btn-secondary" id="refresh-providers"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> Refresh</button>
        </div>
      </div>
      <div class="card" style="padding:0;overflow:hidden">
        <table class="data-table" id="providers-table">
          <thead><tr><th>Name</th><th>Status</th><th>Models</th><th>Health</th><th>Actions</th></tr></thead>
          <tbody id="providers-tbody"><tr><td colspan="5" style="text-align:center;padding:32px"><div class="spinner"></div></td></tr></tbody>
        </table>
      </div>
    `)
    const load = async () => {
      const tbody = document.getElementById('providers-tbody')
      try {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:32px"><div class="spinner"></div></td></tr>'
        const [providersRes, healthRes] = await Promise.allSettled([API.listProviders(), API.getHealth()])
        const providers = Array.isArray(providersRes.value) ? providersRes.value : (providersRes.value?.providers || [])
        const pHealth = (healthRes.value?.providers) || {}
        let rows = providers.map(p => ({
          name: p.name || p.id || 'Unknown',
          status: p.status || (p.healthy === true ? 'online' : p.healthy === false ? 'offline' : null)
            || (typeof pHealth[p.name || p.id] === 'string' ? pHealth[p.name || p.id] : pHealth[p.name || p.id]?.status)
            || (pHealth[p.name || p.id] ? 'healthy' : 'unknown'),
          models: p.models ? (Array.isArray(p.models) ? p.models.length : typeof p.models === 'number' ? p.models : 0) : 0,
          uptime: p.uptime ?? p.health_score ?? (pHealth[p.name || p.id]?.uptime ?? null)
        }))
        this._allProviders = rows
        const q = (document.getElementById('provider-search').value || '').toLowerCase()
        if (q) rows = rows.filter(r => r.name.toLowerCase().includes(q))
        if (!rows.length) {
          tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:48px;color:var(--text-muted)">No providers found</td></tr>'
          return
        }
        tbody.innerHTML = rows.map(p => `<tr>
          <td style="font-weight:500;color:var(--text-primary)">${this.escapeHtml(p.name)}</td>
          <td>${this.statusDot(p.status)}</td>
          <td>${p.models}</td>
          <td>${p.uptime !== null ? `<span class="badge badge-${p.uptime > 95 ? 'success' : p.uptime > 80 ? 'warning' : 'danger'}">${p.uptime}%</span>` : '<span class="badge badge-default">N/A</span>'}</td>
          <td><button class="btn btn-sm btn-ghost" data-action="ping" data-provider="${this.escapeHtml(p.name)}">Ping</button></td>
        </tr>`).join('')
      } catch (err) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--danger)">Error: ${this.escapeHtml(err.message)}</td></tr>`
      }
    }
    document.getElementById('provider-search').addEventListener('input', load)
    document.getElementById('refresh-providers').addEventListener('click', load)
    document.getElementById('providers-tbody').addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action="ping"]')
      if (!btn) return
      btn.disabled = true; btn.textContent = '...'
      try {
        const res = await API.getProviderHealth(encodeURIComponent(btn.dataset.provider))
        this.showToast(`${btn.dataset.provider}: ${res.status || 'OK'}`, /healthy|online/i.test(res.status || '') ? 'success' : 'warning')
      } catch (err) { this.showToast(`Ping failed: ${err.message}`, 'error') }
      btn.disabled = false; btn.textContent = 'Ping'
    })
    load()
  },

  /* ─── MODELS ───────────────────────────────────── */

  async renderModels() {
    this.setContent(`
      <div class="page-header">
        <div><h1>Models</h1><p>Browse available models across providers</p></div>
        <div class="page-header-actions" style="gap:8px">
          <input type="text" class="input" id="model-search" placeholder="Search models..." style="width:200px">
          <select class="select" id="model-filter" style="width:150px">
            <option value="all">All</option>
            <option value="fast">Fast</option>
            <option value="reasoning">Reasoning</option>
            <option value="code">Code</option>
            <option value="vision">Vision</option>
            <option value="creative">Creative</option>
          </select>
        </div>
      </div>
      <div id="models-container"><div style="text-align:center;padding:48px"><div class="spinner spinner-lg"></div></div></div>
    `)
    const load = async () => {
      const container = document.getElementById('models-container')
      try {
        const res = await API.listModels()
        const models = Array.isArray(res) ? res : (res?.models || [])
        const q = (document.getElementById('model-search').value || '').toLowerCase()
        const filter = document.getElementById('model-filter').value
        let filtered = models.filter(m => {
          const name = (m.name || m.id || '').toLowerCase()
          if (q && !name.includes(q)) return false
          if (filter === 'all') return true
          const tags = [].concat(m.tags || m.capabilities || []).map(t => String(t).toLowerCase())
          if (filter === 'fast') return /fast|turbo|gpt-4o-mini|claude-haiku|gemini-flash/i.test(name) || tags.some(t => /fast|speed/i.test(t))
          if (filter === 'reasoning') return /reasoning|think|o1|o3|deepseek-r1|claude-sonnet/i.test(name) || tags.some(t => /reason|think/i.test(t))
          if (filter === 'code') return /code|coder|deepseek-coder|stable-code/i.test(name) || tags.some(t => /code|program/i.test(t))
          if (filter === 'vision') return /vision|multimodal|image|gemini-pro-vision|claude-3-opus|gpt-4o/i.test(name) || tags.some(t => /vision|image|multimodal/i.test(t))
          if (filter === 'creative') return /creative|titan|jamba|command|claude-3-haiku/i.test(name) || tags.some(t => /creative|write|story/i.test(t))
          return true
        })
        const grouped = {}
        filtered.forEach(m => {
          const prov = m.provider || m.provider_name || 'unknown'
          if (!grouped[prov]) grouped[prov] = []
          grouped[prov].push(m)
        })
        const keys = Object.keys(grouped)
        if (!keys.length) {
          container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📦</div><div class="empty-state-title">No models found</div><div class="empty-state-desc">Try adjusting your search or filter</div></div>'
          return
        }
        container.innerHTML = keys.map(prov => `
          <div class="page-section">
            <h2 class="page-section-title" style="text-transform:capitalize">${this.escapeHtml(prov)}</h2>
            <div class="grid-2" style="grid-template-columns:repeat(auto-fill,minmax(320px,1fr))">${grouped[prov].map(m => {
              const name = m.name || m.id || 'Unknown'
              const tags = [].concat(m.tags || m.capabilities || [])
              return `<div class="card">
                <div class="card-header"><span class="card-title">${this.escapeHtml(name)}</span>${m.speed ? `<span class="badge badge-${m.speed > 80 ? 'success' : m.speed > 50 ? 'warning' : 'danger'}">${m.speed}ms</span>` : ''}</div>
                <div class="card-body" style="display:flex;flex-wrap:wrap;gap:4px">${tags.slice(0, 6).map(t => `<span class="badge badge-accent">${this.escapeHtml(t)}</span>`).join('')}${tags.length > 6 ? `<span class="badge badge-default">+${tags.length - 6}</span>` : ''}</div>
              </div>`
            }).join('')}</div>
          </div>`).join('')
      } catch (err) {
        container.innerHTML = `<div class="alert alert-danger">Error: ${this.escapeHtml(err.message)}</div>`
      }
    }
    document.getElementById('model-search').addEventListener('input', load)
    document.getElementById('model-filter').addEventListener('change', load)
    load()
  },

  /* ─── PLAYGROUND ───────────────────────────────── */

  _genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6) },

  _saveSession() {
    if (!this.playground.id) return
    const s = {
      id: this.playground.id,
      messages: this.playground.messages,
      model: this.playground.model,
      temperature: this.playground.temperature,
      maxTokens: this.playground.maxTokens,
      systemPrompt: this.playground.systemPrompt,
      personaId: this.playground.personaId,
    }
    const firstMsg = this.playground.messages.find(m => m.role === 'user')
    s.title = firstMsg ? firstMsg.content.slice(0, 50) : 'New chat'
    s.createdAt = this.playground._createdAt || Date.now()
    Store.sessions.save(s)
  },

  _renderSessionList() {
    const el = document.getElementById('session-list')
    if (!el) return
    const sessions = Store.sessions.list()
    const curId = Store.sessions.current()
    el.innerHTML = sessions.length ? sessions.map(s => `
      <div class="session-item${s.id === curId ? ' active' : ''}" data-sid="${s.id}" style="padding:8px 12px;cursor:pointer;border-radius:var(--radius);font-size:13px;display:flex;align-items:center;gap:6px;${s.id === curId ? 'background:var(--accent-muted);color:var(--accent)' : 'color:var(--text-secondary)'}">
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${this.escapeHtml(s.title || 'Chat')}</span>
        <button class="btn btn-ghost btn-sm del-session" data-sid="${s.id}" style="padding:2px 6px;font-size:12px;opacity:0.5">✕</button>
      </div>`).join('') : '<div style="padding:12px;font-size:12px;color:var(--text-muted);text-align:center">No sessions yet</div>'
    el.querySelectorAll('.session-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.del-session')) return
        this._loadSession(item.dataset.sid)
      })
    })
    el.querySelectorAll('.del-session').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        Store.sessions.delete(btn.dataset.sid)
        if (Store.sessions.current() === btn.dataset.sid) {
          Store.sessions.setCurrent(null)
          this.playground = { id: '', messages: [], model: '', temperature: 0.7, maxTokens: 4096, systemPrompt: '', personaId: null, _loaded: false }
          this.render()
        } else {
          this._renderSessionList()
        }
      })
    })
  },

  _loadSession(id) {
    const s = Store.sessions.get(id)
    if (!s) return
    this.playground = {
      id: s.id, messages: s.messages || [], model: s.model || '',
      temperature: s.temperature || 0.7, maxTokens: s.maxTokens || 4096,
      systemPrompt: s.systemPrompt || '', personaId: s.personaId || null,
      _loaded: true, _createdAt: s.createdAt || Date.now(),
    }
    Store.sessions.setCurrent(id)
    this.render()
  },

  _newSession() {
    const id = this._genId()
    this.playground = {
      id, messages: [], model: this.playground.model || '', temperature: 0.7,
      maxTokens: 4096, systemPrompt: '', personaId: null, _loaded: true, _createdAt: Date.now(),
    }
    Store.sessions.setCurrent(id)
    this._saveSession()
    this.render()
  },

  async renderPlayground() {
    const sessions = Store.sessions.list()
    const curId = Store.sessions.current()
    const persona = this.playground.personaId ? Store.personas.list().find(p => p.id === this.playground.personaId) : null
    const instructions = Store.instructions.list()
    const activeSkill = Store.activeSkillId.get()
    const skill = activeSkill ? Store.skills.list().find(s => s.id === activeSkill) : null

    this.setContent(`
      <div style="display:flex;gap:12px;height:calc(100vh - 120px)">
        <div class="card" style="width:200px;flex-shrink:0;display:flex;flex-direction:column;margin-bottom:0;overflow:hidden">
          <div style="padding:10px 12px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:4px">
            <span style="font-size:13px;font-weight:600;color:var(--text-primary);flex:1">Sessions</span>
            <button class="btn btn-ghost btn-sm" id="new-session" style="padding:2px 8px;font-size:18px;line-height:1">+</button>
          </div>
          <div id="session-list" style="flex:1;overflow-y:auto;padding:8px"></div>
        </div>
        <div class="card" style="flex:1;display:flex;flex-direction:column;margin-bottom:0;overflow:hidden">
          <div id="playground-messages" style="flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px;min-height:0">
            ${this.playground.messages.length ? this.playground.messages.map(m =>
              `<div style="display:flex;gap:10px;${m.role === 'user' ? 'flex-direction:row-reverse' : ''}">
                <div class="avatar ${m.role === 'user' ? '' : 'avatar-sm'}" style="${m.role === 'user' ? '' : 'background:var(--accent-muted);color:var(--accent)'}">${m.role === 'user' ? 'U' : persona ? persona.name[0] : 'A'}</div>
                <div style="max-width:80%;padding:10px 14px;border-radius:var(--radius-md);${m.role === 'user' ? 'background:var(--accent);color:#fff' : 'background:var(--bg-tertiary);color:var(--text-primary)'}">${this.escapeHtml(m.content)}</div>
              </div>`
            ).join('') : '<div class="empty-state" style="padding:32px"><div class="empty-state-icon">💬</div><div class="empty-state-title">Start a conversation</div><div class="empty-state-desc">Select a model and send a message to begin</div></div>'}
          </div>
          <div style="border-top:1px solid var(--border);padding:12px 16px;display:flex;gap:8px;align-items:flex-end">
            <textarea id="playground-input" class="input" rows="2" placeholder="Type your message..." style="resize:none;flex:1;min-height:42px;max-height:120px"></textarea>
            <button class="btn btn-primary" id="playground-send" style="height:42px;flex-shrink:0"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Send</button>
          </div>
        </div>
        <div class="card" style="width:260px;flex-shrink:0;display:flex;flex-direction:column;gap:12px;margin-bottom:0;overflow-y:auto">
          <div>
            <label style="font-size:12px;font-weight:500;color:var(--text-secondary);display:block;margin-bottom:4px">Model</label>
            <select class="select" id="playground-model" style="font-size:13px"><option value="">Select model...</option></select>
          </div>
          <div>
            <label style="font-size:12px;font-weight:500;color:var(--text-secondary);display:block;margin-bottom:4px">Temp: <span id="temp-value">${this.playground.temperature}</span></label>
            <input type="range" id="playground-temp" min="0" max="2" step="0.1" value="${this.playground.temperature}" style="width:100%">
          </div>
          <div>
            <label style="font-size:12px;font-weight:500;color:var(--text-secondary);display:block;margin-bottom:4px">Max Tokens</label>
            <input type="number" class="input" id="playground-maxtokens" value="${this.playground.maxTokens}" min="1" max="128000" style="width:100%;font-size:13px">
          </div>
          <div>
            <label style="font-size:12px;font-weight:500;color:var(--text-secondary);display:block;margin-bottom:4px">Instruction</label>
            <select class="select" id="playground-instruction" style="font-size:13px"><option value="">None</option>${instructions.map(i => `<option value="${i.id}"${this.playground.systemPrompt === i.prompt ? ' selected' : ''}>${this.escapeHtml(i.name)}</option>`).join('')}</select>
          </div>
          <div>
            <label style="font-size:12px;font-weight:500;color:var(--text-secondary);display:block;margin-bottom:4px">Persona ${persona ? '— ' + this.escapeHtml(persona.name) : ''}</label>
            <select class="select" id="playground-persona" style="font-size:13px"><option value="">None</option>${Store.personas.list().map(p => `<option value="${p.id}"${this.playground.personaId === p.id ? ' selected' : ''}>${this.escapeHtml(p.name)}</option>`).join('')}</select>
          </div>
          <div>
            <button class="btn btn-ghost" id="toggle-system-prompt" style="width:100%;justify-content:space-between;padding:6px 10px;font-size:12px">
              Custom Prompt <span id="sys-prompt-arrow">${this.playground.systemPrompt ? '▾' : '▸'}</span>
            </button>
            <textarea class="input" id="playground-system" rows="3" style="margin-top:6px;${this.playground.systemPrompt ? 'display:block' : 'display:none'};resize:vertical;font-size:12px" placeholder="Custom system prompt...">${this.escapeHtml(this.playground.systemPrompt)}</textarea>
          </div>
          ${skill ? `<div style="font-size:11px;color:var(--accent);background:var(--accent-muted);padding:6px 10px;border-radius:var(--radius)">⚡ Skill: ${this.escapeHtml(skill.name)}</div>` : ''}
          <div style="margin-top:auto;display:flex;flex-direction:column;gap:4px">
            <button class="btn btn-secondary btn-sm" id="playground-clear">Clear</button>
          </div>
        </div>
      </div>
    `)

    this._renderSessionList()
    document.getElementById('new-session').addEventListener('click', () => this._newSession())

    const modelSelect = document.getElementById('playground-model')
    const messagesEl = document.getElementById('playground-messages')
    const inputEl = document.getElementById('playground-input')
    const sendBtn = document.getElementById('playground-send')
    const tempSlider = document.getElementById('playground-temp')
    const tempVal = document.getElementById('temp-value')
    const maxtokens = document.getElementById('playground-maxtokens')
    const instSelect = document.getElementById('playground-instruction')
    const personaSelect = document.getElementById('playground-persona')
    const sysToggle = document.getElementById('toggle-system-prompt')
    const sysTextarea = document.getElementById('playground-system')
    const sysArrow = document.getElementById('sys-prompt-arrow')
    const clearBtn = document.getElementById('playground-clear')

    API.listModels().then(res => {
      const models = Array.isArray(res) ? res : (res?.models || [])
      modelSelect.innerHTML = '<option value="">Select model...</option>' +
        models.map(m => `<option value="${this.escapeHtml(m.name || m.id)}">${this.escapeHtml(m.name || m.id)}${m.provider ? ' (' + this.escapeHtml(m.provider) + ')' : ''}</option>`).join('')
      if (this.playground.model) modelSelect.value = this.playground.model
    }).catch(() => {})

    tempSlider.addEventListener('input', () => { tempVal.textContent = tempSlider.value })
    sysToggle.addEventListener('click', () => {
      const shown = sysTextarea.style.display !== 'none'
      sysTextarea.style.display = shown ? 'none' : 'block'
      sysArrow.textContent = shown ? '▸' : '▾'
    })
    instSelect.addEventListener('change', () => {
      const inst = instructions.find(i => i.id === instSelect.value)
      sysTextarea.value = inst ? inst.prompt : ''
      this.playground.systemPrompt = sysTextarea.value
      sysTextarea.style.display = inst ? 'block' : 'none'
      sysArrow.textContent = inst ? '▾' : '▸'
    })
    personaSelect.addEventListener('change', () => {
      this.playground.personaId = personaSelect.value || null
      const p = personaSelect.value ? Store.personas.list().find(x => x.id === personaSelect.value) : null
      if (p) {
        sysTextarea.value = p.systemPrompt
        this.playground.systemPrompt = p.systemPrompt
        sysTextarea.style.display = 'block'
        sysArrow.textContent = '▾'
      }
      if (this.playground.id) this._saveSession()
    })

    if (this.playground.messages.length) {
      messagesEl.scrollTop = messagesEl.scrollHeight
    }

    const sendMessage = async () => {
      const text = inputEl.value.trim()
      if (!text || !modelSelect.value) {
        if (!modelSelect.value) this.showToast('Please select a model', 'warning')
        return
      }
      if (!this.playground.id) this._newSession()
      this.playground.model = modelSelect.value
      this.playground.temperature = parseFloat(tempSlider.value)
      this.playground.maxTokens = parseInt(maxtokens.value) || 4096
      this.playground.systemPrompt = sysTextarea.value
      inputEl.value = ''
      messagesEl.querySelector('.empty-state')?.remove()

      const userMsg = { role: 'user', content: text }
      this.playground.messages.push(userMsg)
      const msgDiv = document.createElement('div')
      msgDiv.style.cssText = 'display:flex;gap:10px;flex-direction:row-reverse'
      msgDiv.innerHTML = `<div class="avatar">U</div><div style="max-width:80%;padding:10px 14px;border-radius:var(--radius-md);background:var(--accent);color:#fff">${this.escapeHtml(text)}</div>`
      messagesEl.appendChild(msgDiv)
      messagesEl.scrollTop = messagesEl.scrollHeight

      const assistantDiv = document.createElement('div')
      assistantDiv.style.cssText = 'display:flex;gap:10px'
      const p = this.playground.personaId ? Store.personas.list().find(x => x.id === this.playground.personaId) : null
      assistantDiv.innerHTML = `<div class="avatar avatar-sm" style="background:var(--accent-muted);color:var(--accent)">${p ? p.name[0] : 'A'}</div><div style="max-width:80%;padding:10px 14px;border-radius:var(--radius-md);background:var(--bg-tertiary);color:var(--text-primary);white-space:pre-wrap" id="streaming-response"></div>`
      messagesEl.appendChild(assistantDiv)
      messagesEl.scrollTop = messagesEl.scrollHeight
      sendBtn.disabled = true
      sendBtn.textContent = '...'

      let fullResponse = ''
      const responseEl = document.getElementById('streaming-response')
      try {
        const body = {
          model: this.playground.model,
          messages: this.playground.messages.map(m => ({ role: m.role, content: m.content })),
          temperature: this.playground.temperature,
          max_tokens: this.playground.maxTokens,
          stream: true,
        }
        if (this.playground.systemPrompt) body.messages.unshift({ role: 'system', content: this.playground.systemPrompt })
        if (skill && skill.systemPrompt) body.messages.unshift({ role: 'system', content: skill.systemPrompt })

        let timedOut = false
        const timeoutId = setTimeout(() => {
          if (!timedOut) { timedOut = true; this.showToast('Request timed out', 'error'); sendBtn.disabled = false; sendBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Send' }
        }, 120000)

        await API.streamChat(body,
          (chunk) => {
            if (timedOut) return
            fullResponse += chunk
            responseEl.textContent = fullResponse
            messagesEl.scrollTop = messagesEl.scrollHeight
          },
          () => {
            clearTimeout(timeoutId); timedOut = true
            this.playground.messages.push({ role: 'assistant', content: fullResponse })
            this._saveSession()
            this._renderSessionList()
            sendBtn.disabled = false
            sendBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Send'
          },
          (err) => {
            clearTimeout(timeoutId); timedOut = true
            this.showToast('Stream error: ' + err.message, 'error')
            responseEl.textContent = 'Error: ' + err.message
            sendBtn.disabled = false
            sendBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Send'
          }
        )
      } catch (err) {
        responseEl.textContent = 'Error: ' + err.message
        this.showToast('Request failed: ' + err.message, 'error')
        sendBtn.disabled = false
        sendBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Send'
      }
    }

    sendBtn.addEventListener('click', sendMessage)
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendMessage() }
    })
    clearBtn.addEventListener('click', () => {
      this.playground.messages = []
      messagesEl.innerHTML = '<div class="empty-state" style="padding:32px"><div class="empty-state-icon">💬</div><div class="empty-state-title">Start a conversation</div><div class="empty-state-desc">Select a model and send a message to begin</div></div>'
      if (this.playground.id) { this._saveSession(); this._renderSessionList() }
    })
  },

  /* ─── API REFERENCE ─────────────────────────────── */

  renderAPI() {
    const sections = [
      { id: 'chat', title: 'Chat Completion', endpoint: 'POST /v1/chat/completions', desc: 'Send a chat message and get a response.',
        curl: `curl -X POST http://localhost:3456/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Hello!"}],
    "temperature": 0.7,
    "max_tokens": 1024
  }'`,
        fetch: `await fetch('/v1/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer YOUR_KEY' },
  body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'Hello!' }] })
})`,
        response: `{
  "id": "chatcmpl-xxx",
  "object": "chat.completion",
  "created": 1700000000,
  "model": "gpt-4o",
  "choices": [{
    "index": 0,
    "message": {
      "role": "assistant",
      "content": "Hello! How can I help you today?"
    },
    "finish_reason": "stop"
  }],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 15,
    "total_tokens": 25
  }
}` },
      { id: 'models', title: 'List Models', endpoint: 'GET /v1/models', desc: 'Retrieve all available models.',
        curl: `curl http://localhost:3456/v1/models \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
        fetch: `await fetch('/v1/models', {
  headers: { 'Authorization': 'Bearer YOUR_KEY' }
})`,
        response: `{
  "models": [
    { "id": "gpt-4o", "name": "GPT-4o", "provider": "openai", "capabilities": ["chat","vision"] }
  ]
}` },
      { id: 'providers', title: 'List Providers', endpoint: 'GET /v1/providers', desc: 'Get all configured providers.',
        curl: `curl http://localhost:3456/v1/providers \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
        fetch: `await fetch('/v1/providers', {
  headers: { 'Authorization': 'Bearer YOUR_KEY' }
})`,
        response: `{
  "providers": [
    { "id": "openai", "name": "OpenAI", "status": "online", "models": ["gpt-4o"] }
  ]
}` },
      { id: 'health', title: 'Health Check', endpoint: 'GET /v1/health', desc: 'Check system and provider health.',
        curl: `curl http://localhost:3456/v1/health`,
        fetch: `await fetch('/v1/health')`,
        response: `{
  "status": "healthy",
  "providers": { "openai": "online", "anthropic": "degraded" },
  "uptime": 3600,
  "version": "2.0.0"
}` },
      { id: 'stream', title: 'Streaming', endpoint: 'POST /v1/streaming', desc: 'Stream chat completions via SSE.',
        curl: `curl -X POST http://localhost:3456/v1/streaming \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Tell me a story"}],
    "stream": true
  }'`,
        fetch: `const res = await fetch('/v1/streaming', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer YOUR_KEY' },
  body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'Hi' }], stream: true })
})
const reader = res.body.getReader()
const decoder = new TextDecoder()
while (true) {
  const { done, value } = await reader.read()
  if (done) break
  // process SSE chunks
}`,
        response: `data: {"choices":[{"delta":{"content":"Hello"}}]}
data: {"choices":[{"delta":{"content":" world"}}]}
data: [DONE]` },
      { id: 'auth', title: 'Authentication', endpoint: 'POST /v1/auth/login', desc: 'Authenticate and get a token.',
        curl: `curl -X POST http://localhost:3456/v1/auth/login \\
  -H "Content-Type: application/json" \\
  -d '{"email": "user@example.com", "password": "your_password"}'`,
        fetch: `await fetch('/v1/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'user@example.com', password: 'your_password' })
})`,
        response: `{
  "token": "eyJhbGciOiJIUzI1NiIs..."
}` }
    ]
    this.setContent(`
      <div class="page-header">
        <div><h1>API Reference</h1><p>All endpoints accept JSON and return JSON. Base URL: <code>http://localhost:3456/v1</code></p></div>
      </div>
      <div class="tabs" id="api-tabs">${sections.map((s, i) => `<button class="tab ${i === 0 ? 'active' : ''}" data-tab="${s.id}">${s.title}</button>`).join('')}</div>
      ${sections.map((s, i) => `<div class="tab-content ${i === 0 ? 'active' : ''}" id="tab-${s.id}">
        <div class="page-section">
          <div class="card">
            <div class="card-header"><span class="card-title">${s.endpoint}</span></div>
            <div class="card-body">
              <p style="margin-bottom:16px">${s.desc}</p>
              <div style="margin-bottom:12px"><strong style="font-size:13px;color:var(--text-secondary)">curl</strong></div>
              <pre>${s.curl}</pre>
              <div style="margin:16px 0 12px"><strong style="font-size:13px;color:var(--text-secondary)">fetch</strong></div>
              <pre>${s.fetch}</pre>
              <div style="margin:16px 0 12px"><strong style="font-size:13px;color:var(--text-secondary)">Response</strong></div>
              <pre>${s.response}</pre>
            </div>
          </div>
        </div>
      </div>`).join('')}
    `)
    document.getElementById('api-tabs').addEventListener('click', (e) => {
      const tab = e.target.closest('.tab')
      if (!tab) return
      document.querySelectorAll('#api-tabs .tab').forEach(t => t.classList.remove('active'))
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'))
      tab.classList.add('active')
      document.getElementById('tab-' + tab.dataset.tab).classList.add('active')
    })
  },

  /* ─── MCP ──────────────────────────────────────── */

  async renderMCP() {
    this.setContent(`
      <div class="page-header">
        <div><h1>MCP</h1><p>Model Context Protocol — tools and resources</p></div>
      </div>
      <div class="grid-2" id="mcp-cards" style="grid-template-columns:1fr 1fr;margin-bottom:24px">
        <div class="card"><div class="skeleton skeleton-card"></div></div>
        <div class="card"><div class="skeleton skeleton-card"></div></div>
      </div>
      <div class="page-section">
        <h2 class="page-section-title">Available Tools</h2>
        <div class="card" id="mcp-tools"><div class="skeleton skeleton-text"></div></div>
      </div>
      <div class="page-section">
        <h2 class="page-section-title">Custom MCP Servers</h2>
        <div class="card">
          <div class="card-body">
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
              <input type="text" class="input" id="custom-mcp-name" placeholder="Server name" style="flex:1;min-width:120px;font-size:13px">
              <input type="url" class="input" id="custom-mcp-url" placeholder="ws:// or https://..." style="flex:2;min-width:200px;font-size:13px">
              <button class="btn btn-primary btn-sm" id="custom-mcp-add">Add</button>
            </div>
            <div id="custom-mcp-list"></div>
            <div style="margin-top:8px;font-size:12px;color:var(--text-muted)">Add your own MCP servers. Supports WebSocket (ws://) and HTTP SSE (https://) endpoints.</div>
          </div>
        </div>
      </div>
    `)
    try {
      const [status, tools] = await Promise.allSettled([
        API.circuitBreakerStatus ? API.circuitBreakerStatus() : Promise.resolve({}),
        API.mcpTools()
      ])
      const cb = status.value || {}
      const mcpRes = tools.value || {}
      const mcpTools = mcpRes.tools || mcpRes.result?.tools || []
      document.getElementById('mcp-cards').innerHTML = `
        <div class="stat-card">
          <div class="stat-card-icon accent"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg></div>
          <div class="stat-card-label">SSE Endpoint</div>
          <div class="stat-card-value" style="font-size:14px;font-weight:400"><code>/v1/mcp</code></div>
          <div class="stat-card-desc">JSON-RPC over SSE</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-icon success">🔧</div>
          <div class="stat-card-label">Tools Available</div>
          <div class="stat-card-value">${mcpTools.length}</div>
          <div class="stat-card-desc">Registered MCP tools</div>
        </div>`
      const toolsEl = document.getElementById('mcp-tools')
      if (mcpTools.length) {
        toolsEl.innerHTML = `<div class="grid-2" style="grid-template-columns:repeat(auto-fill,minmax(300px,1fr))">${mcpTools.map(t => `
          <div class="card">
            <div class="card-header"><span class="card-title">${this.escapeHtml(t.name || t.method)}</span>${t.input_schema ? `<span class="badge badge-info">${Object.keys(t.input_schema.properties || {}).length} params</span>` : ''}</div>
            <div class="card-body" style="font-size:13px">${this.escapeHtml(t.description || 'No description')}</div>
          </div>`).join('')}</div>`
      } else {
        toolsEl.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🔧</div><div class="empty-state-title">No MCP tools available</div></div>'
      }
    } catch (err) {
      document.getElementById('mcp-cards').innerHTML = `<div class="alert alert-danger">${this.escapeHtml(err.message)}</div>`
    }

    const renderCustomMcp = () => {
      const el = document.getElementById('custom-mcp-list')
      if (!el) return
      const list = Store.customMcp.list()
      el.innerHTML = list.length ? list.map(m => `
        <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--bg-secondary);border-radius:var(--radius);margin-bottom:6px">
          <div style="flex:1"><strong style="font-size:13px;color:var(--text-primary)">${this.escapeHtml(m.name)}</strong><br><code style="font-size:11px;color:var(--text-muted)">${this.escapeHtml(m.url)}</code></div>
          <button class="btn btn-ghost btn-sm custom-mcp-del" data-id="${m.id}" style="padding:2px 8px;font-size:11px;color:var(--danger)">✕</button>
        </div>`).join('') : '<div style="font-size:12px;color:var(--text-muted)">No custom MCP servers</div>'
      el.querySelectorAll('.custom-mcp-del').forEach(btn => btn.addEventListener('click', () => {
        Store.customMcp.delete(btn.dataset.id); renderCustomMcp()
      }))
    }
    document.getElementById('custom-mcp-add')?.addEventListener('click', () => {
      const name = document.getElementById('custom-mcp-name').value.trim()
      const url = document.getElementById('custom-mcp-url').value.trim()
      if (!name || !url) { this.showToast('Name and URL required', 'warning'); return }
      Store.customMcp.save({ id: this._genId(), name, url, tools: [], createdAt: Date.now() })
      document.getElementById('custom-mcp-name').value = ''
      document.getElementById('custom-mcp-url').value = ''
      renderCustomMcp()
      this.showToast('Custom MCP added', 'success')
    })
    renderCustomMcp()
  },

  /* ─── COMPARE ──────────────────────────────────── */

  async renderCompare() {
    this.setContent(`
      <div class="page-header">
        <div><h1>Compare</h1><p>Compare side-by-side model capabilities</p></div>
      </div>
      <div class="card" style="margin-bottom:24px">
        <div class="card-header"><span class="card-title">Select Models</span></div>
        <div class="card-body">
          <div class="grid-4" id="compare-selectors">
            ${[1,2,3,4].map(i => `<div><label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Model ${i}</label><select class="select" id="compare-model-${i}"><option value="">-- Select --</option></select></div>`).join('')}
          </div>
          <button class="btn btn-primary" id="compare-run" style="margin-top:16px">Compare</button>
        </div>
      </div>
      <div id="compare-results"></div>
    `)
    try {
      const res = await API.listModels()
      const models = Array.isArray(res) ? res : (res?.models || [])
      const opts = '<option value="">-- Select --</option>' + models.map(m => `<option value="${this.escapeHtml(m.name || m.id)}">${this.escapeHtml(m.name || m.id)}${m.provider ? ' (' + this.escapeHtml(m.provider) + ')' : ''}</option>`).join('')
      for (let i = 1; i <= 4; i++) document.getElementById(`compare-model-${i}`).innerHTML = opts

      document.getElementById('compare-run').addEventListener('click', async () => {
        const selected = []
        for (let i = 1; i <= 4; i++) {
          const v = document.getElementById(`compare-model-${i}`).value
          if (v) selected.push(v)
        }
        if (selected.length < 2) { this.showToast('Select at least 2 models', 'warning'); return }
        const resultsEl = document.getElementById('compare-results')
        const details = selected.map(id => {
          const m = models.find(mm => (mm.name || mm.id) === id)
          const tags = [].concat(m?.tags || m?.capabilities || [])
          return { id, provider: m?.provider || '?', tags, speed: m?.speed, pricing: m?.pricing || m?.cost }
        })
        resultsEl.innerHTML = `
          <div class="card" style="padding:0;overflow:hidden">
            <table class="data-table">
              <thead><tr><th style="width:140px">Feature</th>${selected.map(s => `<th>${this.escapeHtml(s)}</th>`).join('')}</tr></thead>
              <tbody>
                <tr><td style="font-weight:500;color:var(--text-primary)">Provider</td>${details.map(d => `<td>${this.escapeHtml(d.provider)}</td>`).join('')}</tr>
                <tr><td style="font-weight:500;color:var(--text-primary)">Capabilities</td>${details.map(d => `<td>${d.tags.slice(0, 5).map(t => `<span class="badge badge-accent" style="margin:2px">${this.escapeHtml(t)}</span>`).join(' ')}${d.tags.length > 5 ? `<span class="badge badge-default">+${d.tags.length - 5}</span>` : ''}</td>`).join('')}</tr>
                <tr><td style="font-weight:500;color:var(--text-primary)">Speed</td>${details.map(d => `<td>${d.speed ? `<span class="badge badge-${d.speed > 80 ? 'success' : d.speed > 50 ? 'warning' : 'danger'}">${d.speed}ms</span>` : '<span class="badge badge-default">N/A</span>'}</td>`).join('')}</tr>
                <tr><td style="font-weight:500;color:var(--text-primary)">Pricing</td>${details.map(d => `<td>${d.pricing ? this.escapeHtml(typeof d.pricing === 'object' ? JSON.stringify(d.pricing) : d.pricing) : '<span class="badge badge-default">N/A</span>'}</td>`).join('')}</tr>
              </tbody>
            </table>
          </div>`
      })
    } catch (err) {
      this.showToast('Failed to load models: ' + err.message, 'error')
    }
  },

  /* ─── SANTRI ────────────────────────────────────── */

  async renderSantri() {
    let status = { registered: false, tier: 'guest' }
    try { status = await API.santriStatus() } catch {}

    this.setContent(`
      <div class="page-header">
        <div><h1>Santri</h1><p>Program akses gratis JeumpaLLM untuk santri/santriwati Aceh selama 1 tahun</p></div>
      </div>
      <div class="card" style="margin-bottom:24px;border-left:3px solid var(--accent)">
        <div class="card-body">
          <div style="font-size:14px;line-height:1.6">
            <strong>Santri Aceh Gratis</strong><br>
            Santri/santriwati wilayah Aceh dapat akses gratis JeumpaLLM selama 1 tahun penuh.<br><br>
            <strong>Syarat:</strong>
            <ul style="margin:8px 0 0 16px">
              <li>Berdomisili di Aceh</li>
              <li>Santri aktif di pesantren Aceh</li>
              <li>Memiliki email orang tua/wali</li>
            </ul>
          </div>
        </div>
      </div>
      <div id="santri-status-area"></div>
    `)

    const area = document.getElementById('santri-status-area')
    if (!status.registered) {
      area.innerHTML = `
        <div class="card" style="margin-bottom:16px">
          <div class="card-header"><span class="card-title">Daftar Santri</span></div>
          <div class="card-body" style="display:flex;flex-direction:column;gap:10px">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
              <input type="text" class="input" id="s-nama" placeholder="Nama Lengkap">
              <input type="text" class="input" id="s-pesantren" placeholder="Nama Pesantren">
            </div>
            <input type="text" class="input" id="s-alamat" placeholder="Alamat Pesantren">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
              <input type="text" class="input" id="s-provinsi" value="Aceh" placeholder="Provinsi">
              <input type="text" class="input" id="s-pimpinan" placeholder="Nama Pimpinan Pesantren">
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
              <input type="text" class="input" id="s-ortu" placeholder="Nama Orang Tua">
              <input type="email" class="input" id="s-email-ortu" placeholder="Email Orang Tua">
            </div>
            <input type="tel" class="input" id="s-telp-ortu" placeholder="No. HP Orang Tua">
            <button class="btn btn-primary" id="santri-daftar">Daftar</button>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><span class="card-title">Status Anda</span></div>
          <div class="card-body">
            <p style="font-size:14px;color:var(--text-muted)">Tier: <strong>${this.escapeHtml(status.tier || 'guest')}</strong> | Token: <strong>${status.token_balance || 0}</strong></p>
          </div>
        </div>`
      document.getElementById('santri-daftar').addEventListener('click', async () => {
        const data = {
          full_name: document.getElementById('s-nama').value.trim(),
          pesantren_name: document.getElementById('s-pesantren').value.trim(),
          pesantren_address: document.getElementById('s-alamat').value.trim(),
          province: document.getElementById('s-provinsi').value.trim(),
          leader_name: document.getElementById('s-pimpinan').value.trim(),
          parent_name: document.getElementById('s-ortu').value.trim(),
          parent_email: document.getElementById('s-email-ortu').value.trim(),
          parent_phone: document.getElementById('s-telp-ortu').value.trim(),
        }
        if (!data.full_name || !data.pesantren_name) { this.showToast('Nama dan pesantren wajib diisi', 'warning'); return }
        try {
          const res = await API.santriRegister(data)
          this.showToast('Pendaftaran berhasil! Jawab pertanyaan verifikasi.', 'success')
          if (res.questions) {
            const qHtml = res.questions.map((q, i) =>
              `<div style="margin-bottom:8px"><label style="font-size:13px;color:var(--text-secondary);display:block;margin-bottom:4px">${this.escapeHtml(q)}</label><input type="text" class="input" id="s-jawab-${i}" placeholder="Jawaban..." style="width:100%"></div>`
            ).join('')
            area.innerHTML = `
              <div class="card">
                <div class="card-header"><span class="card-title">Verifikasi Santri</span></div>
                <div class="card-body">
                  ${qHtml}
                  <button class="btn btn-primary" id="santri-verif">Verifikasi</button>
                </div>
              </div>`
            document.getElementById('santri-verif').addEventListener('click', async () => {
              const answers = res.questions.map((_, i) => document.getElementById(`s-jawab-${i}`).value)
              try {
                const v = await API.santriVerify(answers)
                this.showToast('✓ Santri terverifikasi! Akses 1 tahun.', 'success')
                this.renderSantri()
              } catch (err) { this.showToast('Verifikasi gagal: ' + err.message, 'error') }
            })
          }
        } catch (err) { this.showToast('Gagal: ' + err.message, 'error') }
      })
    } else if (status.verification_status === 'pending') {
      const q = ['Apa nama pesantren Anda?', 'Di kecamatan mana pesantren Anda berada?', 'Siapa nama pimpinan pesantren Anda?', 'Berapa lama Anda sudah belajar di pesantren? (dalam bulan)']
      area.innerHTML = `
        <div class="card">
          <div class="card-header"><span class="card-title">Verifikasi Santri</span></div>
          <div class="card-body">
            <p style="font-size:14px;color:var(--text-muted);margin-bottom:12px">Anda sudah terdaftar. Jawab pertanyaan verifikasi:</p>
            ${q.map((q, i) => `<div style="margin-bottom:8px"><label style="font-size:13px;color:var(--text-secondary);display:block;margin-bottom:4px">${this.escapeHtml(q)}</label><input type="text" class="input" id="sv-${i}" placeholder="Jawaban..." style="width:100%"></div>`).join('')}
            <button class="btn btn-primary" id="santri-verif-2">Verifikasi</button>
          </div>
        </div>`
      document.getElementById('santri-verif-2').addEventListener('click', async () => {
        const answers = q.map((_, i) => document.getElementById(`sv-${i}`).value)
        try {
          const v = await API.santriVerify(answers)
          this.showToast('✓ Terverifikasi!', 'success')
          this.renderSantri()
        } catch (err) { this.showToast('Gagal: ' + err.message, 'error') }
      })
    } else if (status.verification_status === 'verified') {
      area.innerHTML = `
        <div class="card" style="border-left:3px solid var(--success)">
          <div class="card-header"><span class="card-title">✓ Santri Terverifikasi</span></div>
          <div class="card-body">
            <div class="grid-3">
              <div class="stat-card"><div class="stat-card-label">Nama</div><div class="stat-card-value" style="font-size:16px">${this.escapeHtml(status.full_name)}</div></div>
              <div class="stat-card"><div class="stat-card-label">Pesantren</div><div class="stat-card-value" style="font-size:16px">${this.escapeHtml(status.pesantren_name)}</div></div>
              <div class="stat-card"><div class="stat-card-label">Berlaku Sampai</div><div class="stat-card-value" style="font-size:16px">${status.expires_at ? new Date(status.expires_at).toLocaleDateString() : '-'}</div></div>
            </div>
            <p style="margin-top:16px;font-size:14px;color:var(--text-muted)">Tier: <strong>${this.escapeHtml(status.tier)}</strong> | Token: <strong>${status.token_balance || 0}</strong></p>
          </div>
        </div>`
    }
  },

  /* ─── DONASI ────────────────────────────────────── */

  async renderDonasi() {
    let methods = { methods: [] }
    let tiers = { tiers: [], tokens_per_unit: 10, valid_days: 30 }
    let status = { donations: [], token_balance: 0, tier: 'guest' }
    try {
      const [m, t, s] = await Promise.allSettled([API.donationMethods(), API.donationTiers(), API.donationStatus()])
      if (m.value) methods = m.value
      if (t.value) tiers = t.value
      if (s.value) status = s.value
    } catch {}

    const expiryInfo = status.tier_expires_at ? `Expiry: ${new Date(status.tier_expires_at).toLocaleDateString()}` : `Aktifasi 30-90 hari per donasi`
    const pmIcons = { dana: '💳', ovo: '📱', gopay: '🟢', shopeepay: '🛒', qris: '📷', bsi: '🏦', mandiri: '🏛', bca: '🏛', linkaja: '🔗' }
    const selectedMethod = methods.methods.length ? methods.methods[0].key : 'dana'

    this.setContent(`
      <div class="page-header">
        <div><h1>Donasi</h1><p>Dukung JeumpaLLM — token akses, makin besar donasi makin panjang masa aktif</p></div>
      </div>
      <div class="grid-3" style="margin-bottom:24px">
        <div class="stat-card"><div class="stat-card-label">Balance Token</div><div class="stat-card-value">${status.token_balance || 0}</div></div>
        <div class="stat-card"><div class="stat-card-label">Tier</div><div class="stat-card-value" style="text-transform:capitalize">${this.escapeHtml(status.tier || 'guest')}</div></div>
        <div class="stat-card"><div class="stat-card-label">${this.escapeHtml(expiryInfo)}</div></div>
      </div>
      <div class="card" style="margin-bottom:24px">
        <div class="card-header"><span class="card-title">Metode Pembayaran</span></div>
        <div class="card-body">
          <div style="display:flex;gap:8px;flex-wrap:wrap">${methods.methods.map(m => `
            <div class="card pm-option" data-pm="${this.escapeHtml(m.key)}" style="cursor:pointer;text-align:center;padding:12px 16px;margin:0;min-width:100px;flex:1;border-color:${m.key === selectedMethod ? 'var(--accent)' : 'var(--border)'}">
              <div style="font-size:22px;margin-bottom:4px">${pmIcons[m.key] || '💳'}</div>
              <div style="font-size:13px;font-weight:600;color:var(--text-primary)">${this.escapeHtml(m.label)}</div>
            </div>`).join('')}</div>
          <input type="hidden" id="donasi-pm" value="${selectedMethod}">
        </div>
      </div>
      <div class="card" style="margin-bottom:24px">
        <div class="card-header"><span class="card-title">Pilih nominal donasi</span></div>
        <div class="card-body">
          <p style="font-size:13px;color:var(--text-muted);margin-bottom:12px">${this.escapeHtml(tiers.note || 'Token per IDR: ' + tiers.tokens_per_unit + ' | Masa aktif 30-90 hari')}</p>
          <div class="grid-3" style="grid-template-columns:repeat(auto-fill,minmax(180px,1fr))">${tiers.tiers.map(t => `
            <div class="card" style="cursor:pointer;text-align:center;padding:16px;margin:0" data-amount="${t.amount}">
              <div style="font-size:20px;font-weight:700;color:var(--accent)">IDR ${t.amount.toLocaleString()}</div>
              <div style="font-size:13px;color:var(--text-muted);margin:4px 0">${this.escapeHtml(t.label)}</div>
              <div style="font-size:12px;color:var(--text-secondary)">${t.tokens} token · ${t.valid_days || 30} hari</div>
            </div>`).join('')}</div>
          <div style="margin-top:16px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <span style="font-size:13px;color:var(--text-secondary)">Atau jumlah kustom (IDR):</span>
            <input type="number" class="input" id="donasi-custom" min="0" placeholder="50000" style="width:160px">
            <button class="btn btn-primary" id="donasi-lanjut">Lanjut</button>
          </div>
        </div>
      </div>
      <div id="donasi-flow" style="display:none"></div>
      <div class="page-section">
        <h2 class="page-section-title">Riwayat Donasi</h2>
        <div class="card" style="padding:0;overflow:hidden">
          ${status.donations && status.donations.length ? `
            <table class="data-table">
              <thead><tr><th>Ref</th><th>Metode</th><th>Amount</th><th>Token</th><th>Status</th><th>Tanggal</th></tr></thead>
              <tbody>${status.donations.map(d => `
                <tr>
                  <td style="font-family:monospace;font-size:12px">${this.escapeHtml(d.payment_ref || d.id)}</td>
                  <td style="font-size:12px">${this.escapeHtml(d.payment_method || '-')}</td>
                  <td>IDR ${(d.amount || 0).toLocaleString()}</td>
                  <td>${d.token_amount || 0}</td>
                  <td><span class="badge badge-${d.status === 'confirmed' ? 'success' : d.status === 'pending' ? 'warning' : 'default'}">${this.escapeHtml(d.status)}</span></td>
                  <td>${d.created_at ? new Date(d.created_at).toLocaleDateString() : '-'}</td>
                </tr>`).join('')}</tbody>
            </table>` : '<div style="padding:32px;text-align:center;color:var(--text-muted)">Belum ada donasi</div>'}
        </div>
      </div>
    `)

    document.querySelectorAll('.pm-option').forEach(el => {
      el.addEventListener('click', () => {
        document.querySelectorAll('.pm-option').forEach(e => e.style.borderColor = 'var(--border)')
        el.style.borderColor = 'var(--accent)'
        document.getElementById('donasi-pm').value = el.dataset.pm
      })
    })

    document.querySelectorAll('[data-amount]').forEach(el => {
      el.addEventListener('click', () => {
        document.querySelectorAll('[data-amount]').forEach(e => e.style.borderColor = '')
        el.style.borderColor = 'var(--accent)'
        document.getElementById('donasi-custom').value = el.dataset.amount
      })
    })

    document.getElementById('donasi-lanjut').addEventListener('click', async () => {
      const amount = parseInt(document.getElementById('donasi-custom').value)
      if (!amount || amount <= 0) { this.showToast('Masukkan nominal donasi', 'warning'); return }
      const pm = document.getElementById('donasi-pm').value
      const flowEl = document.getElementById('donasi-flow')
      flowEl.style.display = 'block'
      flowEl.innerHTML = '<div style="text-align:center;padding:24px"><div class="spinner"></div></div>'
      try {
        const res = await API.donationCreate(amount, 'IDR', pm)
        const pmData = res.payment_instructions || {}
        flowEl.innerHTML = `
          <div class="card" style="border-left:3px solid var(--accent)">
            <div class="card-header"><span class="card-title">Instruksi Pembayaran — ${this.escapeHtml(pmData.method || pm)}</span></div>
            <div class="card-body">
              <p style="font-size:14px;margin-bottom:12px">Kirim pembayaran ke:</p>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
                <div class="stat-card" style="padding:16px"><div class="stat-card-label">Tujuan</div><div class="stat-card-value" style="font-size:16px">${this.escapeHtml(pmData.account || '-')}</div></div>
                <div class="stat-card" style="padding:16px"><div class="stat-card-label">Atas Nama</div><div class="stat-card-value" style="font-size:16px">${this.escapeHtml(pmData.name || '-')}</div></div>
              </div>
              <div style="background:var(--bg-secondary);padding:12px;border-radius:var(--radius);margin-bottom:12px;font-size:13px;color:var(--text-secondary)">${this.escapeHtml(pmData.instructions || '')}</div>
              <div class="stat-card" style="padding:12px;margin-bottom:12px;border-left:3px solid var(--warning);background:var(--bg-secondary)">
                <div class="stat-card-label" style="margin-bottom:4px">Kode Referensi (cantumkan saat transfer)</div>
                <div style="font-size:18px;font-weight:700;font-family:var(--font-mono);color:var(--accent);letter-spacing:2px">${this.escapeHtml(res.payment_ref)}</div>
              </div>
              <p style="font-size:13px;color:var(--text-muted);margin-bottom:12px">Setelah transfer, masukkan kode referensi untuk konfirmasi otomatis:</p>
              <div style="display:flex;gap:8px">
                <input type="text" class="input" id="donasi-confirm-ref" placeholder="${this.escapeHtml(res.payment_ref)}" style="flex:1">
                <button class="btn btn-primary" id="donasi-confirm-btn">Konfirmasi</button>
              </div>
              <div id="donasi-confirm-result" style="margin-top:10px"></div>
            </div>
          </div>`
        document.getElementById('donasi-confirm-btn').addEventListener('click', async () => {
          const ref = document.getElementById('donasi-confirm-ref').value.trim() || res.payment_ref
          const resultEl = document.getElementById('donasi-confirm-result')
          try {
            const c = await API.donationConfirm(ref)
            resultEl.innerHTML = `<div class="alert alert-success">✓ Donasi dikonfirmasi! +${c.token_amount} token. Masa aktif: +${c.extension_days || 30} hari. Total balance: ${c.total_balance}. Expiry: ${c.expires_at ? new Date(c.expires_at).toLocaleDateString() : '-'}</div>`
            this.showToast(`Donasi confirmed! +${c.token_amount} token`, 'success')
          } catch (err) { resultEl.innerHTML = `<div class="alert alert-danger">${this.escapeHtml(err.message)}</div>` }
        })
      } catch (err) {
        flowEl.innerHTML = `<div class="alert alert-danger">${this.escapeHtml(err.message)}</div>`
      }
    })
  },

  /* ─── FUGU ──────────────────────────────────────── */

  async renderFugu() {
    const models = await API.listModels().catch(() => ({ models: [] }))
    const modelList = Array.isArray(models) ? models : (models?.models || [])
    const modelOpts = modelList.map(m => `<option value="${this.escapeHtml(m.name || m.id)}">${this.escapeHtml(m.name || m.id)}</option>`).join('')

    this.setContent(`
      <div class="page-header">
        <div><h1>Fugu</h1><p>Sakana-style multi-model ensemble — ask all models, get the best answer</p></div>
        <div class="page-header-actions" style="gap:8px">
          <button class="btn btn-secondary" id="fugu-config-btn"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> Settings</button>
        </div>
      </div>
      <div class="grid-3" id="fugu-cards" style="margin-bottom:24px">
        <div class="stat-card"><div class="stat-card-label">Strategy</div><div class="stat-card-value" id="fugu-strategy-val">hybrid</div></div>
        <div class="stat-card"><div class="stat-card-label">Models Queried</div><div class="stat-card-value" id="fugu-models-val">-</div></div>
        <div class="stat-card"><div class="stat-card-label">Last Latency</div><div class="stat-card-value" id="fugu-latency-val">-</div></div>
      </div>
      <div class="card" style="margin-bottom:24px">
        <div class="card-header"><span class="card-title">Fugu Query</span></div>
        <div class="card-body">
          <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
            <select class="select" id="fugu-strategy" style="width:160px">
              <option value="hybrid">Hybrid (recommended)</option>
              <option value="llm_judge">LLM Judge</option>
              <option value="consensus">Consensus</option>
              <option value="confidence">Confidence</option>
              <option value="weighted">Weighted</option>
            </select>
            <input type="number" class="input" id="fugu-timeout" value="60" placeholder="Timeout" style="width:100px" title="Per-model timeout (s)">
            <label style="display:flex;align-items:center;gap:4px;font-size:13px;color:var(--text-secondary)">
              <input type="checkbox" id="fugu-return-all"> Show all responses
            </label>
          </div>
          <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Models to query (comma-separated, leave empty for auto-select)</label>
          <input type="text" class="input" id="fugu-models" placeholder="gpt-4o, claude-3-5-sonnet, gemini-2.0-flash, deepseek-chat" style="width:100%;margin-bottom:12px">
          <textarea class="input" id="fugu-input" rows="4" placeholder="Enter your query for all models..." style="width:100%;margin-bottom:10px;resize:vertical"></textarea>
          <button class="btn btn-primary" id="fugu-ask-btn"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg> Ask Fugu</button>
        </div>
      </div>
      <div id="fugu-results"></div>
      <div id="fugu-config-modal" style="display:none"></div>
    `)

    // Load status
    const loadStatus = async () => {
      try {
        const s = await API.fuguStatus()
        const cfg = s.config || {}
        document.getElementById('fugu-strategy-val').textContent = cfg.strategy || 'hybrid'
        if (cfg.strategy) document.getElementById('fugu-strategy').value = cfg.strategy
        document.getElementById('fugu-models-val').textContent = cfg.max_models || '-'
      } catch {}
    }
    loadStatus()

    document.getElementById('fugu-ask-btn').addEventListener('click', async () => {
      const input = document.getElementById('fugu-input').value.trim()
      if (!input) { this.showToast('Enter a query first', 'warning'); return }

      const resultsEl = document.getElementById('fugu-results')
      resultsEl.innerHTML = '<div style="text-align:center;padding:48px"><div class="spinner spinner-lg"></div><p style="margin-top:12px;color:var(--text-muted)">Querying all models in parallel...</p></div>'
      const askBtn = document.getElementById('fugu-ask-btn')
      askBtn.disabled = true; askBtn.textContent = '...'

      try {
        const modelsInput = document.getElementById('fugu-models').value.trim()
        const body = {
          messages: [{ role: 'user', content: input }],
          strategy: document.getElementById('fugu-strategy').value,
          timeout: parseInt(document.getElementById('fugu-timeout').value) || 60,
          return_all: document.getElementById('fugu-return-all').checked,
        }
        if (modelsInput) {
          body.models = modelsInput.split(',').map(m => m.trim()).filter(Boolean)
        }

        const res = await API.fuguAsk(body)

        document.getElementById('fugu-models-val').textContent = res.models_queried || '0'
        document.getElementById('fugu-latency-val').textContent = this.formatDuration(res.elapsed_ms)

        const bestContent = res.choices?.[0]?.message?.content || ''
        const scores = res.scores || {}
        const allRes = res.all_responses || {}

        let html = `
          <div class="card" style="margin-bottom:16px;border-left:3px solid var(--accent)">
            <div class="card-header">
              <span class="card-title">Best Answer</span>
              <span class="badge badge-success">${this.escapeHtml(res.best_model || '')} (${res.best_score || 0})</span>
            </div>
            <div class="card-body">
              <div style="white-space:pre-wrap;font-size:14px;line-height:1.6">${this.escapeHtml(bestContent)}</div>
              <div style="margin-top:12px;font-size:12px;color:var(--text-muted)">
                Strategy: ${res.strategy} | ${res.models_responded}/${res.models_queried} models responded | ${this.formatDuration(res.elapsed_ms)}
              </div>
            </div>
          </div>
          <div class="card" style="padding:0;overflow:hidden">
            <table class="data-table">
              <thead><tr><th>Model</th><th>Score</th><th>Preview</th></tr></thead>
              <tbody>${Object.entries(scores).sort((a, b) => b[1] - a[1]).map(([model, score]) => {
                const content = allRes[model]?.content || ''
                const preview = content.slice(0, 120) + (content.length > 120 ? '...' : '')
                return `<tr>
                  <td style="font-weight:500;color:var(--text-primary)">${this.escapeHtml(model)}</td>
                  <td><span class="badge badge-${score > 0.7 ? 'success' : score > 0.4 ? 'warning' : 'danger'}">${(score * 100).toFixed(0)}%</span></td>
                  <td style="font-size:13px;color:var(--text-muted);max-width:400px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${this.escapeHtml(preview)}</td>
                </tr>`
              }).join('')}</tbody>
            </table>
          </div>
          <div style="margin-top:12px;font-size:12px;color:var(--text-muted);text-align:right">
            Total tokens (all models): ${res.usage?.total_tokens || 0} | Prompt: ${res.usage?.prompt_tokens || 0} | Completion: ${res.usage?.completion_tokens || 0}
        `

        if (!document.getElementById('fugu-return-all').checked) {
          const toggleBtn = document.createElement('button')
          html += `</div>`
        } else {
          html += `</div>`
        }

        resultsEl.innerHTML = html
      } catch (err) {
        resultsEl.innerHTML = `<div class="alert alert-danger">${this.escapeHtml(err.message)}</div>`
      }
      askBtn.disabled = false; askBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg> Ask Fugu'
    })

    // Config modal
    document.getElementById('fugu-config-btn').addEventListener('click', async () => {
      let cfg = { strategy: 'hybrid', judge_model: 'auto', timeout: 60, min_responses: 2, max_models: 5, consensus_threshold: 0.6 }
      try {
        const s = await API.fuguStatus()
        cfg = s.config || cfg
      } catch {}
      const modalEl = document.getElementById('fugu-config-modal')
      modalEl.style.display = 'block'
      modalEl.innerHTML = `
        <div class="card" style="max-width:500px;margin:0 auto;position:relative">
          <div class="card-header"><span class="card-title">Fugu Settings</span><button class="btn btn-sm btn-ghost" id="fugu-modal-close">✕</button></div>
          <div class="card-body" style="display:flex;flex-direction:column;gap:12px">
            <div><label style="font-size:12px;font-weight:500;color:var(--text-secondary);display:block;margin-bottom:4px">Strategy</label>
              <select class="select" id="cfg-strategy" style="width:100%">
                <option value="hybrid" ${cfg.strategy === 'hybrid' ? 'selected' : ''}>Hybrid (LLM Judge + Weighted)</option>
                <option value="llm_judge" ${cfg.strategy === 'llm_judge' ? 'selected' : ''}>LLM Judge</option>
                <option value="consensus" ${cfg.strategy === 'consensus' ? 'selected' : ''}>Consensus</option>
                <option value="confidence" ${cfg.strategy === 'confidence' ? 'selected' : ''}>Confidence</option>
                <option value="weighted" ${cfg.strategy === 'weighted' ? 'selected' : ''}>Weighted</option>
              </select>
            </div>
            <div><label style="font-size:12px;font-weight:500;color:var(--text-secondary);display:block;margin-bottom:4px">Judge Model</label>
              <select class="select" id="cfg-judge" style="width:100%"><option value="auto">Auto (best available)</option>${modelOpts}</select>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div><label style="font-size:12px;font-weight:500;color:var(--text-secondary);display:block;margin-bottom:4px">Timeout (s)</label>
                <input type="number" class="input" id="cfg-timeout" value="${cfg.timeout || 60}" style="width:100%"></div>
              <div><label style="font-size:12px;font-weight:500;color:var(--text-secondary);display:block;margin-bottom:4px">Max Models</label>
                <input type="number" class="input" id="cfg-max-models" value="${cfg.max_models || 5}" style="width:100%"></div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div><label style="font-size:12px;font-weight:500;color:var(--text-secondary);display:block;margin-bottom:4px">Min Responses</label>
                <input type="number" class="input" id="cfg-min-resp" value="${cfg.min_responses || 2}" style="width:100%"></div>
              <div><label style="font-size:12px;font-weight:500;color:var(--text-secondary);display:block;margin-bottom:4px">Consensus Threshold</label>
                <input type="number" class="input" id="cfg-threshold" value="${cfg.consensus_threshold || 0.6}" step="0.1" min="0" max="1" style="width:100%"></div>
            </div>
            <button class="btn btn-primary" id="cfg-save">Save Settings</button>
          </div>
        </div>`
      document.getElementById('fugu-modal-close').addEventListener('click', () => { modalEl.style.display = 'none' })
      document.getElementById('cfg-save').addEventListener('click', async () => {
        try {
          const updates = {
            strategy: document.getElementById('cfg-strategy').value,
            judge_model: document.getElementById('cfg-judge').value === 'auto' ? 'auto' : document.getElementById('cfg-judge').value,
            timeout: parseInt(document.getElementById('cfg-timeout').value) || 60,
            max_models: parseInt(document.getElementById('cfg-max-models').value) || 5,
            min_responses: parseInt(document.getElementById('cfg-min-resp').value) || 2,
            consensus_threshold: parseFloat(document.getElementById('cfg-threshold').value) || 0.6,
          }
          await API.fuguConfig(updates)
          this.showToast('Fugu settings saved', 'success')
          modalEl.style.display = 'none'
          loadStatus()
        } catch (err) { this.showToast('Failed: ' + err.message, 'error') }
      })
    })
  },

  /* ─── ANALYTICS ────────────────────────────────── */

  async renderAnalytics() {
    this.setContent(`
      <div class="page-header">
        <div><h1>Analytics</h1><p>Usage statistics and performance metrics</p></div>
        <div class="page-header-actions" style="gap:8px">
          <button class="btn btn-secondary" id="analytics-refresh"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> Refresh</button>
        </div>
      </div>
      <div class="grid-3" id="analytics-stats">
        <div class="card"><div class="skeleton skeleton-card"></div></div>
        <div class="card"><div class="skeleton skeleton-card"></div></div>
        <div class="card"><div class="skeleton skeleton-card"></div></div>
      </div>
      <div class="page-section">
        <h2 class="page-section-title">Provider Ranking</h2>
        <div class="card" id="analytics-providers"><div class="skeleton skeleton-text"></div></div>
      </div>
      <div class="page-section">
        <h2 class="page-section-title">Top Models</h2>
        <div class="card" id="analytics-models"><div class="skeleton skeleton-text"></div></div>
      </div>
      <div class="page-section">
        <h2 class="page-section-title">Span Type Breakdown</h2>
        <div class="card" id="analytics-breakdown"><div class="skeleton skeleton-text"></div></div>
      </div>
    `)
    try {
      const [usageRes, rankingRes, popularityRes, overviewRes] = await Promise.allSettled([
        API.getUsage(),
        API.providerRanking(),
        API.modelPopularity(),
        API.analyticsOverview(24),
      ])
      const usage = usageRes.value || {}
      const totalReq = usage.total_requests || usage.total || 0
      const totalTokens = usage.total_tokens || usage.total_completion_tokens || 0
      const totalCost = usage.total_cost || usage.cost || 0
      const overview = overviewRes.value || {}
      const ranking = rankingRes.value?.ranking || []
      const popularity = popularityRes.value?.popularity || []
      document.getElementById('analytics-stats').innerHTML = `
        <div class="stat-card">
          <div class="stat-card-icon accent"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg></div>
          <div class="stat-card-label">Total Requests</div>
          <div class="stat-card-value">${this.formatNumber(overview.total_spans || totalReq)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-icon info"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg></div>
          <div class="stat-card-label">Avg Duration</div>
          <div class="stat-card-value">${this.formatDuration(overview.avg_duration_ms || 0)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-icon ${(overview.error_rate || 0) > 0.05 ? 'danger' : 'success'}"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></div>
          <div class="stat-card-label">Error Rate</div>
          <div class="stat-card-value">${overview.error_rate ? (overview.error_rate * 100).toFixed(1) + '%' : 'N/A'}</div>
        </div>`
      const providersEl = document.getElementById('analytics-providers')
      if (ranking.length) {
        const maxLat = Math.max(...ranking.map(r => r.avg_latency_ms || 0), 1)
        providersEl.innerHTML = ranking.map(r => {
          const pct = (r.avg_latency_ms / maxLat) * 100
          return `<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px"><span style="color:var(--text-primary)">${this.escapeHtml(r.provider)}</span><span style="color:var(--text-muted)">${this.formatDuration(r.avg_latency_ms)} (${r.total_calls} calls)</span></div><div class="progress"><div class="progress-bar progress-bar-success" style="width:${100 - pct}%;background:var(--success)"></div></div></div>`
        }).join('')
      } else {
        providersEl.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📊</div><div class="empty-state-title">No provider data</div></div>'
      }
      const modelsEl = document.getElementById('analytics-models')
      if (popularity.length) {
        const maxCount = Math.max(...popularity.map(m => m.calls || 0), 1)
        modelsEl.innerHTML = popularity.map(m => {
          const count = m.calls || 0
          const pct = (count / maxCount) * 100
          return `<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px"><span style="color:var(--text-primary)">${this.escapeHtml(m.model)}</span><span style="color:var(--text-muted)">${this.formatNumber(count)}</span></div><div class="progress"><div class="progress-bar" style="width:${pct}%"></div></div></div>`
        }).join('')
      } else {
        modelsEl.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📦</div><div class="empty-state-title">No model data</div></div>'
      }
      const breakdownEl = document.getElementById('analytics-breakdown')
      const breakdown = overview.span_type_breakdown || {}
      const bkKeys = Object.keys(breakdown)
      if (bkKeys.length) {
        const maxBk = Math.max(...Object.values(breakdown), 1)
        breakdownEl.innerHTML = bkKeys.map(k => {
          const val = breakdown[k]
          const pct = (val / maxBk) * 100
          return `<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px"><span style="color:var(--text-primary)">${this.escapeHtml(k)}</span><span style="color:var(--text-muted)">${this.formatNumber(val)}</span></div><div class="progress"><div class="progress-bar progress-bar-accent" style="width:${pct}%"></div></div></div>`
        }).join('')
      } else {
        breakdownEl.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🔍</div><div class="empty-state-title">No breakdown data</div></div>'
      }
    } catch (err) {
      this.showToast('Failed to load analytics: ' + err.message, 'error')
    }
  },

  /* ─── SETTINGS ─────────────────────────────────── */

  async renderSettings() {
    this.setContent(`
      <div class="page-header">
        <div><h1>Settings</h1><p>Configure your preferences</p></div>
      </div>
      <div class="page-section">
        <h2 class="page-section-title">Appearance</h2>
        <div class="card">
          <div class="card-body">
            <div style="display:flex;align-items:center;justify-content:space-between">
              <div><strong style="color:var(--text-primary)">Theme</strong><br><span style="font-size:13px">Choose dark or light mode</span></div>
              <div class="btn-group">
                <button class="btn btn-sm ${this.theme === 'dark' ? 'active btn-primary' : 'btn-secondary'}" data-theme-val="dark">Dark</button>
                <button class="btn btn-sm ${this.theme === 'light' ? 'active btn-primary' : 'btn-secondary'}" data-theme-val="light">Light</button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="page-section">
        <h2 class="page-section-title">Defaults</h2>
        <div class="card">
          <div class="card-body">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
              <div><label style="font-size:13px;font-weight:500;color:var(--text-secondary);display:block;margin-bottom:4px">Temperature</label><input type="number" class="input" id="settings-temp" value="${this.playground.temperature}" min="0" max="2" step="0.1"></div>
              <div><label style="font-size:13px;font-weight:500;color:var(--text-secondary);display:block;margin-bottom:4px">Max Tokens</label><input type="number" class="input" id="settings-maxtokens" value="${this.playground.maxTokens}" min="1" max="128000"></div>
            </div>
            <div style="margin-top:16px">
              <label style="font-size:13px;font-weight:500;color:var(--text-secondary);display:block;margin-bottom:4px">Default System Prompt</label>
              <textarea class="input" id="settings-system" rows="4" style="resize:vertical">${this.escapeHtml(this.playground.systemPrompt)}</textarea>
            </div>
            <button class="btn btn-primary" id="settings-save-defaults" style="margin-top:16px">Save Defaults</button>
          </div>
        </div>
      </div>
      <div class="page-section">
        <h2 class="page-section-title">Server</h2>
        <div class="card">
          <div class="card-body">
            <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">
              <div style="flex:1;min-width:200px">
                <label style="font-size:13px;font-weight:500;color:var(--text-secondary);display:block;margin-bottom:4px">Backend URL</label>
                <input type="url" class="input" id="settings-server-url" value="${this.escapeHtml(API.getServerURL())}" placeholder="http://localhost:3456/v1" style="width:100%">
              </div>
            </div>
            <div style="display:flex;gap:8px;margin-top:10px;align-items:center;flex-wrap:wrap">
              <button class="btn btn-primary" id="settings-save-server">Save &amp; Connect</button>
              <button class="btn btn-secondary" id="settings-test-connection">Test Connection</button>
              <span id="connection-status" style="font-size:13px"></span>
            </div>
            <div style="margin-top:10px;font-size:12px;color:var(--text-muted)">
              Deploy this PWA anywhere (Vercel, GitHub Pages, file://). Point to your JeumpaLLM Python server.
            </div>
          </div>
        </div>
      </div>
      <div class="page-section">
        <h2 class="page-section-title">Instructions</h2>
        <div class="card">
          <div class="card-body">
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
              <input type="text" class="input" id="settings-instr-name" placeholder="Instruction name" style="flex:1;min-width:120px">
              <button class="btn btn-primary btn-sm" id="settings-instr-save">Save</button>
            </div>
            <textarea class="input" id="settings-instr-prompt" rows="3" style="resize:vertical;font-size:13px" placeholder="System prompt for this instruction..."></textarea>
            <div id="settings-instr-list" style="margin-top:12px"></div>
          </div>
        </div>
      </div>
      <div class="page-section">
        <h2 class="page-section-title">Acehnese (Bahasa Aceh)</h2>
        <div class="card">
          <div class="card-body">
            <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
              <div>
                <strong style="color:var(--text-primary)">Auto-Detect Acehnese</strong><br>
                <span style="font-size:13px">Detect Aceh language &amp; inject glossary into system prompt</span>
              </div>
              <button class="btn ${Store.get('aceh_enabled') === 'true' ? 'btn-primary' : 'btn-secondary'} btn-sm" id="settings-aceh-toggle">${Store.get('aceh_enabled') === 'true' ? '✓ ON' : 'OFF'}</button>
            </div>
            <div style="margin-top:12px;font-size:12px;color:var(--text-muted);display:flex;align-items:center;gap:4px">
              <span>🔍</span>
              <span>Uses Google Translate API + <a href="https://kata.web.id" target="_blank" style="color:var(--accent)">kata.web.id</a> — no dataset needed<br>
              Endpoints: <code>/v1/aceh/detect</code> <code>/v1/aceh/lookup</code> <code>/v1/aceh/translate</code> <code>/v1/aceh/glossary</code></span>
            </div>
          </div>
        </div>
      </div>
      <div class="page-section">
        <h2 class="page-section-title">Authentication</h2>
        <div class="card">
          <div class="card-body">
            <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">
              <div style="flex:1;min-width:200px">
                <label style="font-size:13px;font-weight:500;color:var(--text-secondary);display:block;margin-bottom:4px">x-api-key (email:password)</label>
                <input type="password" class="input" id="settings-api-key" value="${this.escapeHtml(API.getApiKey())}" placeholder="email@example.com:password" style="width:100%">
              </div>
            </div>
            <div style="display:flex;gap:8px;margin-top:10px;align-items:center;flex-wrap:wrap">
              <button class="btn btn-primary" id="settings-save-auth">Save</button>
              <button class="btn btn-secondary" id="settings-test-auth">Test Auth</button>
              <button class="btn btn-danger" id="settings-clear-auth">Clear</button>
              <span id="auth-status" style="font-size:13px">${API.hasAuth() ? '✓ Authenticated as ' + this.escapeHtml(API.apiKey.split(':')[0]) : '✗ Not authenticated'}</span>
            </div>
            <div style="margin-top:10px;font-size:12px;color:var(--text-muted)">
              Format: <code>email@example.com:password</code>. Dikirim sebagai <code>x-api-key</code> header. Server mencocokkan langsung — tidak perlu JWT/token.
            </div>
          </div>
        </div>
      </div>
    `)
    document.querySelectorAll('[data-theme-val]').forEach(btn => {
      btn.addEventListener('click', () => {
        const theme = btn.dataset.themeVal
        this.setTheme(theme)
        document.querySelectorAll('[data-theme-val]').forEach(b => {
          b.className = `btn btn-sm ${b.dataset.themeVal === theme ? 'active btn-primary' : 'btn-secondary'}`
        })
      })
    })
    const acehToggle = document.getElementById('settings-aceh-toggle')
    if (acehToggle) {
      acehToggle.addEventListener('click', () => {
        const isOn = Store.get('aceh_enabled') === 'true'
        Store.set('aceh_enabled', isOn ? 'false' : 'true')
        acehToggle.textContent = isOn ? 'OFF' : '✓ ON'
        acehToggle.className = `btn btn-sm ${isOn ? 'btn-secondary' : 'btn-primary'}`
        this.showToast(isOn ? 'Acehnese auto-detect OFF' : 'Acehnese auto-detect ON', 'info')
      })
    }

    document.getElementById('settings-save-defaults').addEventListener('click', () => {
      this.playground.temperature = parseFloat(document.getElementById('settings-temp').value) || 0.7
      this.playground.maxTokens = parseInt(document.getElementById('settings-maxtokens').value) || 4096
      this.playground.systemPrompt = document.getElementById('settings-system').value
      this.showToast('Defaults saved', 'success')
    })

    const statusEl = document.getElementById('connection-status')
    const testConnection = async (url) => {
      statusEl.textContent = 'Connecting...'
      statusEl.style.color = 'var(--text-muted)'
      try {
        const res = await fetch(url.replace(/\/+$/, '') + '/health')
        if (!res.ok) throw new Error('HTTP ' + res.status)
        const data = await res.json()
        const status = data.status || 'healthy'
        statusEl.textContent = `✓ Connected — ${status} (uptime: ${this.formatDuration((data.uptime||0)*1000)})`
        statusEl.style.color = 'var(--success)'
        return true
      } catch (err) {
        statusEl.textContent = '✗ Failed: ' + err.message
        statusEl.style.color = 'var(--danger)'
        return false
      }
    }

    document.getElementById('settings-save-server').addEventListener('click', () => {
      const url = document.getElementById('settings-server-url').value.trim()
      if (!url) { this.showToast('Enter a server URL', 'warning'); return }
      const clean = url.replace(/\/+$/, '')
      API.setServerURL(clean)
      this.showToast('Server URL saved', 'success')
      testConnection(clean)
    })

    document.getElementById('settings-test-connection').addEventListener('click', () => {
      const url = document.getElementById('settings-server-url').value.trim() || API.getServerURL()
      testConnection(url)
    })

    const authStatusEl = document.getElementById('auth-status')
    const updateAuthStatus = () => {
      authStatusEl.textContent = API.hasAuth() ? '✓ Authenticated as ' + API.apiKey.split(':')[0] : '✗ Not authenticated'
      authStatusEl.style.color = API.hasAuth() ? 'var(--success)' : 'var(--danger)'
    }
    document.getElementById('settings-save-auth').addEventListener('click', () => {
      const val = document.getElementById('settings-api-key').value.trim()
      if (!val || !val.includes(':')) { this.showToast('Format: email@example.com:password', 'warning'); return }
      API.setApiKey(val)
      updateAuthStatus()
      this.showToast('API key saved', 'success')
    })
    document.getElementById('settings-test-auth').addEventListener('click', async () => {
      if (!API.hasAuth()) { this.showToast('Set API key first', 'warning'); return }
      authStatusEl.textContent = 'Testing...'
      authStatusEl.style.color = 'var(--text-muted)'
      try {
        const res = await API.getMe()
        authStatusEl.textContent = '✓ OK — ' + (res.email || API.apiKey.split(':')[0])
        authStatusEl.style.color = 'var(--success)'
        this.showToast('Auth works!', 'success')
      } catch (err) {
        authStatusEl.textContent = '✗ Failed: ' + err.message
        authStatusEl.style.color = 'var(--danger)'
      }
    })
    document.getElementById('settings-clear-auth').addEventListener('click', () => {
      API.setApiKey('')
      document.getElementById('settings-api-key').value = ''
      updateAuthStatus()
      this.showToast('Auth cleared', 'info')
    })
    updateAuthStatus()

    const renderInstrList = () => {
      const el = document.getElementById('settings-instr-list')
      if (!el) return
      const list = Store.instructions.list()
      el.innerHTML = list.length ? list.map(i => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:var(--bg-secondary);border-radius:var(--radius);margin-bottom:6px">
          <div><strong style="font-size:13px;color:var(--text-primary)">${this.escapeHtml(i.name)}</strong></div>
          <div style="display:flex;gap:4px">
            <button class="btn btn-ghost btn-sm instr-load" data-id="${i.id}" style="padding:2px 8px;font-size:11px">Load</button>
            <button class="btn btn-ghost btn-sm instr-del" data-id="${i.id}" style="padding:2px 8px;font-size:11px;color:var(--danger)">✕</button>
          </div>
        </div>`).join('') : '<div style="font-size:12px;color:var(--text-muted)">No saved instructions</div>'
      el.querySelectorAll('.instr-load').forEach(btn => btn.addEventListener('click', () => {
        const inst = Store.instructions.list().find(i => i.id === btn.dataset.id)
        if (inst) { document.getElementById('settings-instr-name').value = inst.name; document.getElementById('settings-instr-prompt').value = inst.prompt }
      }))
      el.querySelectorAll('.instr-del').forEach(btn => btn.addEventListener('click', () => {
        Store.instructions.delete(btn.dataset.id); renderInstrList()
      }))
    }
    document.getElementById('settings-instr-save')?.addEventListener('click', () => {
      const name = document.getElementById('settings-instr-name').value.trim()
      const prompt = document.getElementById('settings-instr-prompt').value.trim()
      if (!name || !prompt) { this.showToast('Name and prompt required', 'warning'); return }
      const existing = Store.instructions.list().find(i => i.name === name)
      if (existing) { existing.prompt = prompt; Store.instructions.save(existing) }
      else Store.instructions.save({ id: this._genId(), name, prompt })
      renderInstrList()
      this.showToast('Instruction saved', 'success')
    })
    renderInstrList()
  },

  /* ─── WORKFLOWS ────────────────────────────────── */

  async renderWorkflows() {
    this.setContent(`
      <div class="page-header">
        <div><h1>Workflows</h1><p>Orchestrate multi-step agent workflows</p></div>
        <div class="page-header-actions" style="gap:8px">
          <button class="btn btn-primary" id="wf-create-btn"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> New Workflow</button>
          <button class="btn btn-secondary" id="wf-refresh"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> Refresh</button>
        </div>
      </div>
      <div id="wf-list"><div style="text-align:center;padding:48px"><div class="spinner spinner-lg"></div></div></div>
      <div id="wf-create-form" style="display:none"></div>
    `)
    const listEl = document.getElementById('wf-list')
    const formEl = document.getElementById('wf-create-form')

    const loadList = async () => {
      try {
        const res = await API.listWorkflows()
        const workflows = res.workflows || []
        if (!workflows.length) {
          listEl.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⚡</div><div class="empty-state-title">No workflows yet</div><div class="empty-state-desc">Create your first agent workflow to get started</div></div>'
          return
        }
        listEl.innerHTML = `<div class="grid-2" style="grid-template-columns:repeat(auto-fill,minmax(320px,1fr))">${workflows.map(w => {
          const nodeCount = Object.keys(w.nodes || {}).length
          return `<div class="card">
            <div class="card-header"><span class="card-title">${this.escapeHtml(w.name || 'Untitled')}</span><span class="badge badge-info">${nodeCount} nodes</span></div>
            <div class="card-body" style="font-size:13px;color:var(--text-secondary)">${this.escapeHtml(w.description || 'No description')}</div>
            <div class="card-footer">
              <button class="btn btn-sm btn-primary" data-action="wf-execute" data-wf-id="${this.escapeHtml(w.id)}">Execute</button>
              <button class="btn btn-sm btn-ghost" data-action="wf-view" data-wf-id="${this.escapeHtml(w.id)}">View</button>
            </div>
          </div>`
        }).join('')}</div>`
      } catch (err) {
        listEl.innerHTML = `<div class="alert alert-danger">${this.escapeHtml(err.message)}</div>`
      }
    }

    const showCreateForm = () => {
      formEl.style.display = 'block'
      formEl.innerHTML = `
        <div class="card" style="margin-top:24px">
          <div class="card-header"><span class="card-title">Create Workflow</span></div>
          <div class="card-body" style="display:flex;flex-direction:column;gap:12px">
            <input type="text" class="input" id="wf-name" placeholder="Workflow name" value="New Workflow">
            <textarea class="input" id="wf-desc" rows="2" placeholder="Description"></textarea>
            <textarea class="input" id="wf-definition" rows="10" placeholder='{\n  "nodes": [{"id":"n1","type":"input","label":"Input","config":{},"next_nodes":["n2"]}],\n  "edges": [{"source":"n1","target":"n2"}],\n  "entry_node": "n1"\n}' style="font-family:monospace;font-size:13px">${'{\n  "nodes": [{"id":"n1","type":"input","label":"Input","config":{},"next_nodes":["n2"]},{"id":"n2","type":"llm","label":"LLM","config":{"prompt":"Hello {{input}}","model":"auto"},"next_nodes":["n3"]},{"id":"n3","type":"output","label":"Output","config":{},"next_nodes":[]}],\n  "edges": [{"source":"n1","target":"n2"},{"source":"n2","target":"n3"}],\n  "entry_node": "n1"\n}'}</textarea>
            <div style="display:flex;gap:8px">
              <button class="btn btn-primary" id="wf-save">Create</button>
              <button class="btn btn-ghost" id="wf-cancel-form">Cancel</button>
            </div>
          </div>
        </div>`
      document.getElementById('wf-save').addEventListener('click', async () => {
        const name = document.getElementById('wf-name').value
        const description = document.getElementById('wf-desc').value
        let def
        try { def = JSON.parse(document.getElementById('wf-definition').value) } catch { this.showToast('Invalid JSON definition', 'error'); return }
        try {
          await API.createWorkflow({ name, description, ...def })
          this.showToast('Workflow created', 'success')
          formEl.style.display = 'none'
          loadList()
        } catch (err) { this.showToast('Failed: ' + err.message, 'error') }
      })
      document.getElementById('wf-cancel-form').addEventListener('click', () => { formEl.style.display = 'none' })
    }

    document.getElementById('wf-create-btn').addEventListener('click', showCreateForm)
    document.getElementById('wf-refresh').addEventListener('click', loadList)
    listEl.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action]')
      if (!btn) return
      const wfId = btn.dataset.wfId
      if (btn.dataset.action === 'wf-execute') {
        try {
          this.showToast('Executing workflow...', 'info')
          const res = await API.executeWorkflow(wfId, { input: 'test' })
          const execution = res.execution || []
          const last = execution[execution.length - 1]
          this.showToast(last?.type === 'graph_complete' ? 'Workflow completed' : 'Workflow finished', 'success')
        } catch (err) { this.showToast('Execution failed: ' + err.message, 'error') }
      } else if (btn.dataset.action === 'wf-view') {
        try {
          const res = await API.getWorkflow(wfId)
          formEl.style.display = 'block'
          formEl.innerHTML = `<pre style="background:var(--bg-secondary);padding:16px;border-radius:var(--radius);overflow:auto;font-size:13px;max-height:400px">${this.escapeHtml(JSON.stringify(res, null, 2))}</pre>`
        } catch (err) { this.showToast('Failed: ' + err.message, 'error') }
      }
    })
    loadList()
  },

  /* ─── TOOLS ────────────────────────────────────── */

  async renderTools() {
    this.setContent(`
      <div class="page-header">
        <div><h1>Tools</h1><p>Browse and execute built-in tools</p></div>
      </div>
      <div class="page-section">
        <h2 class="page-section-title">Available Tools</h2>
        <div class="card" id="tools-list"><div style="text-align:center;padding:32px"><div class="spinner"></div></div></div>
      </div>
      <div class="page-section" id="tool-executor-section" style="display:none">
        <h2 class="page-section-title">Execute Tool</h2>
        <div class="card" id="tool-executor"></div>
      </div>
    `)
    const listEl = document.getElementById('tools-list')
    const execSection = document.getElementById('tool-executor-section')
    const execEl = document.getElementById('tool-executor')

    try {
      const res = await API.listTools()
      const tools = res.tools || []
      if (!tools.length) {
        listEl.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🔧</div><div class="empty-state-title">No tools available</div></div>'
        return
      }
      listEl.innerHTML = `<div class="grid-2" style="grid-template-columns:repeat(auto-fill,minmax(300px,1fr))">${tools.map(t => {
        const params = Object.keys(t.parameters || {}).length
        return `<div class="card">
          <div class="card-header"><span class="card-title">${this.escapeHtml(t.name)}</span>${params ? `<span class="badge badge-info">${params} params</span>` : ''}</div>
          <div class="card-body" style="font-size:13px;color:var(--text-secondary)">${this.escapeHtml(t.description || '')}</div>
          <div class="card-footer">
            <button class="btn btn-sm btn-primary" data-action="run-tool" data-tool='${this.escapeHtml(JSON.stringify(t))}'>Try It</button>
          </div>
        </div>`
      }).join('')}</div>`

      listEl.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action="run-tool"]')
        if (!btn) return
        const tool = JSON.parse(btn.dataset.tool)
        execSection.style.display = 'block'
        const paramKeys = Object.keys(tool.parameters || {})
        execEl.innerHTML = `
          <div style="margin-bottom:12px"><strong style="color:var(--text-primary);font-size:15px">${this.escapeHtml(tool.name)}</strong><br><span style="font-size:13px;color:var(--text-muted)">${this.escapeHtml(tool.description || '')}</span></div>
          ${paramKeys.length ? paramKeys.map(k => `
            <div style="margin-bottom:8px">
              <label style="font-size:12px;font-weight:500;color:var(--text-secondary);display:block;margin-bottom:4px">${this.escapeHtml(k)}</label>
              <input type="text" class="input" id="tool-arg-${this.escapeHtml(k)}" placeholder="${this.escapeHtml(k)}" style="width:100%">
            </div>`).join('') : '<p style="font-size:13px;color:var(--text-muted)">No arguments required</p>'}
          <button class="btn btn-primary" id="tool-execute-btn">Execute</button>
          <div id="tool-result" style="margin-top:12px"></div>`
        document.getElementById('tool-execute-btn').addEventListener('click', async () => {
          const args = {}
          paramKeys.forEach(k => { args[k] = document.getElementById('tool-arg-' + k)?.value || '' })
          const resultEl = document.getElementById('tool-result')
          resultEl.innerHTML = '<div class="spinner"></div>'
          try {
            const res = await API.executeTool(tool.name, args)
            resultEl.innerHTML = `<pre style="background:var(--bg-secondary);padding:12px;border-radius:var(--radius);overflow:auto;font-size:13px">${this.escapeHtml(JSON.stringify(res.result || res, null, 2))}</pre>`
          } catch (err) { resultEl.innerHTML = `<div class="alert alert-danger">${this.escapeHtml(err.message)}</div>` }
        })
      })
    } catch (err) {
      listEl.innerHTML = `<div class="alert alert-danger">${this.escapeHtml(err.message)}</div>`
    }
  },

  /* ─── TRACING ──────────────────────────────────── */

  async renderTracing() {
    this.setContent(`
      <div class="page-header">
        <div><h1>Tracing</h1><p>Distributed tracing and span inspection</p></div>
        <div class="page-header-actions" style="gap:8px">
          <select class="select" id="trace-type-filter" style="width:140px">
            <option value="">All Types</option>
            <option value="llm_call">LLM Call</option>
            <option value="tool_call">Tool Call</option>
            <option value="api_request">API Request</option>
            <option value="agent_step">Agent Step</option>
            <option value="orchestration">Orchestration</option>
          </select>
          <button class="btn btn-secondary" id="trace-refresh"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> Refresh</button>
        </div>
      </div>
      <div class="grid-3" id="trace-stats">
        <div class="stat-card"><div class="skeleton skeleton-card"></div></div>
        <div class="stat-card"><div class="skeleton skeleton-card"></div></div>
        <div class="stat-card"><div class="skeleton skeleton-card"></div></div>
      </div>
      <div class="page-section">
        <h2 class="page-section-title">Recent Spans</h2>
        <div class="card" style="padding:0;overflow:hidden">
          <table class="data-table" id="trace-table">
            <thead><tr><th>Name</th><th>Type</th><th>Service</th><th>Duration</th><th>Status</th></tr></thead>
            <tbody id="trace-tbody"><tr><td colspan="5" style="text-align:center;padding:32px"><div class="spinner"></div></td></tr></tbody>
          </table>
        </div>
      </div>
      <div id="trace-detail" style="display:none"></div>
    `)
    const tbody = document.getElementById('trace-tbody')
    const statsEl = document.getElementById('trace-stats')
    const detailEl = document.getElementById('trace-detail')
    const filterEl = document.getElementById('trace-type-filter')

    const load = async () => {
      try {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:32px"><div class="spinner"></div></td></tr>'
        const [spansRes, statsRes] = await Promise.allSettled([
          API.tracingSpans(100, filterEl.value),
          API.tracingStats(24),
        ])
        const spans = spansRes.value?.spans || []
        const stats = statsRes.value || {}
        statsEl.innerHTML = `
          <div class="stat-card"><div class="stat-card-icon info"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20v-4"/></svg></div><div class="stat-card-label">Total Spans</div><div class="stat-card-value">${stats.total_spans || 0}</div></div>
          <div class="stat-card"><div class="stat-card-icon accent"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg></div><div class="stat-card-label">Avg Duration</div><div class="stat-card-value">${this.formatDuration(stats.avg_duration_ms || 0)}</div></div>
          <div class="stat-card"><div class="stat-card-icon ${(stats.error_rate || 0) > 0.05 ? 'danger' : 'success'}"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></div><div class="stat-card-label">Error Rate</div><div class="stat-card-value">${stats.error_rate ? (stats.error_rate * 100).toFixed(1) + '%' : '0%'}</div></div>`
        if (!spans.length) {
          tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:48px;color:var(--text-muted)">No spans recorded yet</td></tr>'
          return
        }
        tbody.innerHTML = spans.map(s => {
          const isError = s.status === 'error'
          return `<tr style="cursor:pointer" data-trace-id="${this.escapeHtml(s.trace_id)}" data-span-id="${this.escapeHtml(s.id)}">
            <td style="color:var(--text-primary);font-weight:500">${this.escapeHtml(s.name || '-')}</td>
            <td><span class="badge badge-accent">${this.escapeHtml(s.span_type || '-')}</span></td>
            <td>${this.escapeHtml(s.service || '-')}</td>
            <td>${this.formatDuration(s.duration_ms)}</td>
            <td><span class="badge badge-${isError ? 'danger' : 'success'}">${this.escapeHtml(s.status)}</span></td>
          </tr>`
        }).join('')
      } catch (err) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--danger)">${this.escapeHtml(err.message)}</td></tr>`
      }
    }

    tbody.addEventListener('click', async (e) => {
      const row = e.target.closest('tr[data-trace-id]')
      if (!row) return
      const traceId = row.dataset.traceId
      detailEl.style.display = 'block'
      detailEl.innerHTML = '<div style="text-align:center;padding:24px"><div class="spinner"></div></div>'
      try {
        const res = await API.tracingTrace(traceId)
        detailEl.innerHTML = `
          <div class="page-section">
            <h2 class="page-section-title">Trace: ${this.escapeHtml(traceId.slice(0, 8))}...</h2>
            <div class="card" style="padding:0;overflow:hidden">
              <table class="data-table">
                <thead><tr><th>Span ID</th><th>Name</th><th>Type</th><th>Duration</th><th>Status</th></tr></thead>
                <tbody>${(res.spans || []).map(s => {
                  const isErr = s.status === 'error'
                  return `<tr><td style="font-family:monospace;font-size:12px">${this.escapeHtml(s.id.slice(0, 8))}...</td>
                    <td style="color:var(--text-primary)">${this.escapeHtml(s.name)}</td>
                    <td><span class="badge badge-accent">${this.escapeHtml(s.span_type)}</span></td>
                    <td>${this.formatDuration(s.duration_ms)}</td>
                    <td><span class="badge badge-${isErr ? 'danger' : 'success'}">${this.escapeHtml(s.status)}</span></td></tr>`
                }).join('')}</tbody>
              </table>
            </div>
          </div>`
      } catch (err) { detailEl.innerHTML = `<div class="alert alert-danger">${this.escapeHtml(err.message)}</div>` }
    })

    document.getElementById('trace-refresh').addEventListener('click', load)
    filterEl.addEventListener('change', load)
    load()
  },

  /* ─── LOGS ─────────────────────────────────────── */

  async renderLogs() {
    let page = 1
    this.setContent(`
      <div class="page-header">
        <div><h1>Logs</h1><p>Request history and debug information</p></div>
        <div class="page-header-actions" style="gap:8px">
          <select class="select" id="log-filter" style="width:140px">
            <option value="all">All</option>
            <option value="success">Success</option>
            <option value="error">Error</option>
          </select>
          <button class="btn btn-secondary" id="refresh-logs"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> Refresh</button>
        </div>
      </div>
      <div class="card" style="padding:0;overflow:hidden">
        <table class="data-table" id="logs-table">
          <thead><tr><th>Timestamp</th><th>Model</th><th>Provider</th><th>Status</th><th>Latency</th><th>Tokens</th></tr></thead>
          <tbody id="logs-tbody"><tr><td colspan="6" style="text-align:center;padding:32px"><div class="spinner"></div></td></tr></tbody>
        </table>
      </div>
      <div style="display:flex;align-items:center;justify-content:center;gap:12px;margin-top:16px">
        <button class="btn btn-sm btn-secondary" id="logs-prev" disabled>← Previous</button>
        <span style="font-size:14px;color:var(--text-muted)" id="log-page">Page 1</span>
        <button class="btn btn-sm btn-secondary" id="logs-next">Next →</button>
      </div>
    `)
    const tbody = document.getElementById('logs-tbody')
    const pageEl = document.getElementById('log-page')
    const prevBtn = document.getElementById('logs-prev')
    const nextBtn = document.getElementById('logs-next')
    const filterEl = document.getElementById('log-filter')

    const load = async () => {
      try {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:32px"><div class="spinner"></div></td></tr>'
        const res = await API.getLogs(page, 25)
        const logs = Array.isArray(res) ? res : (res?.logs || res?.data || res?.results || [])
        const total = res.total || res.total_count || res.count || logs.length
        const filter = filterEl.value
        let filtered = logs
        if (filter === 'success') filtered = logs.filter(l => /ok|success|200|201/i.test(l.status || l.status_code || ''))
        else if (filter === 'error') filtered = logs.filter(l => /error|fail|5\d{2}|4\d{2}/i.test(l.status || l.status_code || ''))
        if (!filtered.length) {
          tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:48px;color:var(--text-muted)">No logs found</td></tr>'
          prevBtn.disabled = page <= 1
          nextBtn.disabled = true
          pageEl.textContent = 'Page ' + page
          return
        }
        tbody.innerHTML = filtered.map(l => {
          const status = l.status || l.status_code || l.response_status || '200'
          const isError = /error|fail|5\d{2}|4\d{2}/i.test(String(status))
          const tokens = l.tokens || l.total_tokens || l.usage?.total_tokens || 0
          return `<tr>
            <td style="white-space:nowrap">${this.formatDate(l.timestamp || l.created_at || l.time || l.ts)}</td>
            <td style="color:var(--text-primary)">${this.escapeHtml(l.model || l.model_name || '-')}</td>
            <td>${this.escapeHtml(l.provider || l.provider_name || '-')}</td>
            <td><span class="badge badge-${isError ? 'danger' : 'success'}">${this.escapeHtml(String(status))}</span></td>
            <td>${this.formatDuration(l.latency || l.duration || l.response_time || l.elapsed)}</td>
            <td>${this.formatNumber(tokens)}</td>
          </tr>`
        }).join('')
        prevBtn.disabled = page <= 1
        nextBtn.disabled = filtered.length < 25
        pageEl.textContent = 'Page ' + page
      } catch (err) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--danger)">Error: ${this.escapeHtml(err.message)}</td></tr>`
      }
    }
    const refresh = () => { page = 1; load() }
    document.getElementById('refresh-logs').addEventListener('click', refresh)
    filterEl.addEventListener('change', refresh)
    prevBtn.addEventListener('click', () => { if (page > 1) { page--; load() } })
    nextBtn.addEventListener('click', () => { page++; load() })
    load()
  },

  /* ─── AGENT ────────────────────────────────────── */

  async renderAgent() {
    let subStatus = { agent_access: false, tier: 'guest', token_balance: 0, plans: [] }
    try {
      const res = await API.agentSubscribe()
      subStatus = typeof res === 'object' && res !== null ? res : subStatus
    } catch {}
    this.setContent(`
      <div class="page-header">
        <div><h1>Agent Mode</h1><p>AI coding agent with multi-provider fallback — Hermes Nous methodology</p></div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <span class="badge badge-${subStatus.agent_access ? 'success' : 'default'}" style="font-size:12px">${subStatus.agent_access ? '✓ Active' : '✗ Locked'}</span>
          ${!subStatus.agent_access ? '<button class="btn btn-primary btn-sm" id="agent-subscribe-btn">Subscribe 50K/bulan</button>' : ''}
        </div>
      </div>
      ${!subStatus.agent_access ? `
      <div class="card" style="margin-bottom:24px;border-left:3px solid var(--warning);background:var(--bg-secondary)">
        <div class="card-body">
          <strong style="color:var(--text-primary)">Agent subscription required</strong>
          <p style="font-size:13px;margin-top:4px">Agent mode requires donor tier (min donasi IDR 10.000). Donasi via <a href="#donasi" style="color:var(--accent)">Donasi page</a> untuk aktivasi.</p>
          <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">${(subStatus.plans || []).map(p => `
            <div class="card" style="padding:12px;margin:0;min-width:180px;text-align:center">
              <div style="font-size:16px;font-weight:700;color:var(--accent)">IDR ${(p.amount||0).toLocaleString()}</div>
              <div style="font-size:13px;font-weight:600;margin:4px 0">${this.escapeHtml(p.name)}</div>
              <div style="font-size:12px;color:var(--text-muted)">${this.escapeHtml(p.description)}</div>
            </div>`).join('')}</div>
        </div>
      </div>` : `<div style="background:var(--success-muted);color:var(--success);padding:10px 16px;border-radius:var(--radius);margin-bottom:16px;font-size:14px">✓ Agent active — ${subStatus.token_balance || 0} token balance</div>`}
      <div style="display:flex;gap:16px;height:calc(100vh - 240px)">
        <div class="card" style="flex:2;display:flex;flex-direction:column;margin-bottom:0;overflow:hidden">
          <div style="padding:10px 16px;border-bottom:1px solid var(--border);display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <select class="select" id="agent-lang" style="width:auto;font-size:12px">
              <option value="python">Python</option><option value="javascript">JavaScript</option><option value="typescript">TypeScript</option>
              <option value="go">Go</option><option value="rust">Rust</option><option value="java">Java</option><option value="cpp">C++</option>
              <option value="html/css">HTML/CSS</option><option value="bash">Bash</option><option value="sql">SQL</option>
            </select>
            <input type="text" class="input" id="agent-context" placeholder="Optional: file path or context..." style="flex:1;min-width:150px;font-size:12px">
            <button class="btn btn-primary btn-sm" id="agent-run" ${subStatus.agent_access ? '' : 'disabled'}>Run</button>
          </div>
          <textarea class="input" id="agent-task" rows="4" placeholder="Describe the coding task..." style="border-radius:0;border-left:none;border-right:none;border-top:none;resize:vertical;font-size:13px;font-family:var(--font-mono)" ${subStatus.agent_access ? '' : 'disabled'}></textarea>
          <div id="agent-output" style="flex:1;overflow-y:auto;padding:16px;font-size:13px;font-family:var(--font-mono);white-space:pre-wrap;color:var(--text-secondary);background:var(--bg-secondary)">${subStatus.agent_access ? 'Enter a task and click Run.' : 'Subscribe to use Agent mode.'}</div>
          <div id="agent-trace" style="padding:8px 16px;border-top:1px solid var(--border);font-size:11px;color:var(--text-muted);display:flex;gap:8px;flex-wrap:wrap"></div>
        </div>
        <div class="card" style="flex:1;display:flex;flex-direction:column;margin-bottom:0;overflow:hidden">
          <div style="padding:10px 16px;border-bottom:1px solid var(--border);font-size:13px;font-weight:600;color:var(--text-primary)">Telegram Bot</div>
          <div style="padding:12px;font-size:12px;color:var(--text-secondary)">
            <p style="margin-bottom:8px">Connect a Telegram bot for agent access via chat:</p>
            <input type="text" class="input" id="agent-telegram-token" placeholder="Bot token from @BotFather" style="font-size:12px;margin-bottom:8px" value="${localStorage.getItem('telegram_bot_token') || ''}">
            <button class="btn btn-primary btn-sm" id="agent-telegram-save" style="width:100%;margin-bottom:4px">Save Bot Token</button>
            <div id="agent-telegram-status" style="font-size:11px;margin-top:4px"></div>
            <hr style="border-color:var(--border);margin:12px 0">
            <p style="margin-bottom:8px;font-weight:600;color:var(--text-primary)">Provier Routing</p>
            <div id="agent-routing-info" style="font-size:11px;color:var(--text-muted)">Multi-fallback: primary → fallback1 → fallback2 → error. Providers detected automatically.</div>
          </div>
        </div>
      </div>
    `)

    document.getElementById('agent-subscribe-btn')?.addEventListener('click', () => {
      location.hash = '#donasi'
    })
    document.getElementById('agent-telegram-save')?.addEventListener('click', () => {
      const token = document.getElementById('agent-telegram-token').value.trim()
      if (!token) { this.showToast('Enter bot token', 'warning'); return }
      localStorage.setItem('telegram_bot_token', token)
      const statusEl = document.getElementById('agent-telegram-status')
      statusEl.textContent = 'Token saved locally. Server registration: POST /v1/agent/telegram'
      statusEl.style.color = 'var(--success)'
      this.showToast('Bot token saved', 'success')
    })
    document.getElementById('agent-run')?.addEventListener('click', async () => {
      const task = document.getElementById('agent-task').value.trim()
      if (!task) { this.showToast('Enter a task', 'warning'); return }
      const lang = document.getElementById('agent-lang').value
      const ctx = document.getElementById('agent-context').value.trim()
      const outEl = document.getElementById('agent-output')
      const traceEl = document.getElementById('agent-trace')
      outEl.textContent = 'Processing...'
      traceEl.innerHTML = '<span>⏳ Requesting...</span>'
      try {
        const res = await API.agentCode(task, lang, ctx)
        outEl.textContent = res.code || res.explanation || 'No response'
        if (res.files_created && res.files_created.length) {
          outEl.textContent += '\n\n--- Files Created ---\n' + res.files_created.join('\n')
        }
        traceEl.innerHTML = (res.providers_used || ['unknown']).map(p => `<span class="badge badge-accent">${p}</span>`).join(' ')
        if (res.files_created && res.files_created.length) {
          traceEl.innerHTML += res.files_created.map(f => `<span class="badge badge-success">📁 ${this.escapeHtml(f)}</span>`).join(' ')
        }
      } catch (err) {
        outEl.textContent = 'Error: ' + err.message
        traceEl.innerHTML = `<span style="color:var(--danger)">✗ ${this.escapeHtml(err.message)}</span>`
      }
    })
  },

  /* ─── PERSONA ──────────────────────────────────── */

  renderPersona() {
    const list = Store.personas.list()
    this.setContent(`
      <div class="page-header">
        <div><h1>Persona</h1><p>Custom AI personas with unique system prompts and avatars</p></div>
        <button class="btn btn-primary" id="persona-new">+ New Persona</button>
      </div>
      <div id="persona-list" class="grid-3" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr))">${list.map(p => `
        <div class="card" style="display:flex;flex-direction:column;gap:8px">
          <div style="display:flex;align-items:center;gap:10px">
            <div class="avatar avatar-sm" style="background:var(--accent-muted);color:var(--accent);width:40px;height:40px;font-size:18px">${this.escapeHtml(p.name[0])}</div>
            <div><strong style="color:var(--text-primary);font-size:15px">${this.escapeHtml(p.name)}</strong><br><span style="font-size:12px;color:var(--text-muted)">${p.greeting ? this.escapeHtml(p.greeting.slice(0, 60)) : 'No greeting'}</span></div>
          </div>
          <div style="font-size:12px;color:var(--text-secondary);background:var(--bg-secondary);padding:8px;border-radius:var(--radius);max-height:80px;overflow-y:auto">${this.escapeHtml(p.systemPrompt?.slice(0, 200) || '')}${(p.systemPrompt?.length || 0) > 200 ? '...' : ''}</div>
          <div style="display:flex;gap:4px;margin-top:4px">
            <button class="btn btn-ghost btn-sm persona-edit" data-id="${p.id}" style="font-size:11px">Edit</button>
            <button class="btn btn-ghost btn-sm persona-del" data-id="${p.id}" style="font-size:11px;color:var(--danger)">Delete</button>
          </div>
        </div>`).join('') || '<div style="grid-column:1/-1"><div class="empty-state"><div class="empty-state-icon">🧑</div><div class="empty-state-title">No personas yet</div><div class="empty-state-desc">Create a persona to customize AI behavior</div></div></div>'}
      </div>
      <div id="persona-editor" style="display:none"></div>
    `)
    document.getElementById('persona-new')?.addEventListener('click', () => this._editPersona(null))
    document.querySelectorAll('.persona-edit').forEach(btn => btn.addEventListener('click', () => {
      const p = Store.personas.list().find(x => x.id === btn.dataset.id)
      if (p) this._editPersona(p)
    }))
    document.querySelectorAll('.persona-del').forEach(btn => btn.addEventListener('click', () => {
      Store.personas.delete(btn.dataset.id); this.render()
    }))
  },

  _editPersona(persona) {
    const el = document.getElementById('persona-editor')
    if (!el) return
    const p = persona || { id: '', name: '', systemPrompt: '', greeting: '' }
    el.style.display = 'block'
    el.innerHTML = `
      <div class="card">
        <div class="card-header"><span class="card-title">${p.id ? 'Edit' : 'New'} Persona</span></div>
        <div class="card-body">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
            <div><label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:4px">Name</label><input type="text" class="input" id="persona-editor-name" value="${this.escapeHtml(p.name)}" placeholder="Assistant name" style="font-size:13px"></div>
            <div><label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:4px">Greeting</label><input type="text" class="input" id="persona-editor-greeting" value="${this.escapeHtml(p.greeting || '')}" placeholder='Hi! How can I help?' style="font-size:13px"></div>
          </div>
          <div><label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:4px">System Prompt</label><textarea class="input" id="persona-editor-prompt" rows="6" style="resize:vertical;font-size:13px;font-family:var(--font-mono)">${this.escapeHtml(p.systemPrompt || '')}</textarea></div>
          <div style="display:flex;gap:8px;margin-top:12px">
            <button class="btn btn-primary" id="persona-editor-save">Save</button>
            <button class="btn btn-secondary" id="persona-editor-cancel">Cancel</button>
          </div>
        </div>
      </div>`
    document.getElementById('persona-editor-save').addEventListener('click', () => {
      const name = document.getElementById('persona-editor-name').value.trim()
      const systemPrompt = document.getElementById('persona-editor-prompt').value.trim()
      const greeting = document.getElementById('persona-editor-greeting').value.trim()
      if (!name || !systemPrompt) { this.showToast('Name and system prompt required', 'warning'); return }
      Store.personas.save({ id: p.id || this._genId(), name, systemPrompt, greeting })
      this.showToast('Persona saved', 'success')
      this.render()
    })
    document.getElementById('persona-editor-cancel').addEventListener('click', () => this.render())
  },

  /* ─── MCP MARKET ────────────────────────────────── */

  async renderMcpMarket() {
    const installed = Store.installedMcp.list()
    const defaultMcpMarket = [
      { id: 'filesystem', name: 'Filesystem', desc: 'Read, write, move files on the server', url: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem', category: 'core' },
      { id: 'github', name: 'GitHub', desc: 'GitHub API — repos, issues, PRs, search', url: 'https://github.com/modelcontextprotocol/servers/tree/main/src/github', category: 'dev' },
      { id: 'sqlite', name: 'SQLite', desc: 'Query and manage SQLite databases', url: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sqlite', category: 'data' },
      { id: 'web-search', name: 'Web Search', desc: 'Search the web via Brave Search API', url: 'https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search', category: 'web' },
      { id: 'memory', name: 'Memory', desc: 'Persistent memory graph — remember facts across sessions', url: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory', category: 'core' },
      { id: 'puppeteer', name: 'Puppeteer', desc: 'Browser automation — screenshots, click, type, navigate', url: 'https://github.com/modelcontextprotocol/servers/tree/main/src/puppeteer', category: 'web' },
      { id: 'slack', name: 'Slack', desc: 'Slack workspace — messages, channels, search', url: 'https://github.com/modelcontextprotocol/servers/tree/main/src/slack', category: 'comms' },
      { id: 'google-maps', name: 'Google Maps', desc: 'Location, places, directions, geocoding', url: 'https://github.com/modelcontextprotocol/servers/tree/main/src/google-maps', category: 'web' },
      { id: 'docker', name: 'Docker', desc: 'Container management — pull, run, exec, logs', url: 'https://github.com/modelcontextprotocol/servers/tree/main/src/docker', category: 'dev' },
      { id: 'custom-api', name: 'Custom API', desc: 'Wrap any REST/GraphQL API as MCP tools', url: '#', category: 'custom' },
    ]

    this.setContent(`
      <div class="page-header">
        <div><h1>MCP Market</h1><p>Discover and install MCP servers</p></div>
        <span style="font-size:13px;color:var(--text-muted)">${installed.length} installed</span>
      </div>
      <div style="display:flex;gap:12px;margin-bottom:16px">
        <input type="text" class="input" id="mcp-market-search" placeholder="Search tools..." style="max-width:300px;font-size:13px">
        <select class="select" id="mcp-market-cat" style="width:auto;font-size:13px">
          <option value="">All categories</option>
          <option value="core">Core</option>
          <option value="dev">Developer</option>
          <option value="web">Web</option>
          <option value="data">Data</option>
          <option value="comms">Communications</option>
          <option value="custom">Custom</option>
        </select>
      </div>
      <div id="mcp-market-grid" class="grid-3" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr))">${defaultMcpMarket.map(m => `
        <div class="card mcp-market-item" data-cat="${m.category}" style="display:flex;flex-direction:column;gap:8px">
          <div class="card-header" style="margin-bottom:0"><span class="card-title">${this.escapeHtml(m.name)}</span><span class="badge badge-${m.category === 'core' ? 'accent' : m.category === 'dev' ? 'info' : m.category === 'web' ? 'success' : m.category === 'data' ? 'warning' : 'default'}">${m.category}</span></div>
          <div class="card-body" style="font-size:13px;flex:1">${this.escapeHtml(m.desc)}</div>
          <div style="display:flex;gap:4px;margin-top:4px">
            ${installed.includes(m.id) ? `<button class="btn btn-secondary btn-sm mcp-market-uninstall" data-id="${m.id}" style="font-size:11px">Uninstall</button>` : `<button class="btn btn-primary btn-sm mcp-market-install" data-id="${m.id}" style="font-size:11px">Install</button>`}
            ${m.url !== '#' ? `<a href="${this.escapeHtml(m.url)}" target="_blank" class="btn btn-ghost btn-sm" style="font-size:11px">Docs</a>` : ''}
          </div>
        </div>`).join('')}</div>
    `)

    document.getElementById('mcp-market-search')?.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase()
      document.querySelectorAll('.mcp-market-item').forEach(el => {
        el.style.display = el.textContent.toLowerCase().includes(q) ? 'flex' : 'none'
      })
    })
    document.getElementById('mcp-market-cat')?.addEventListener('change', (e) => {
      const cat = e.target.value
      document.querySelectorAll('.mcp-market-item').forEach(el => {
        el.style.display = !cat || el.dataset.cat === cat ? 'flex' : 'none'
      })
    })
    document.querySelectorAll('.mcp-market-install').forEach(btn => btn.addEventListener('click', () => {
      Store.installedMcp.add(btn.dataset.id); this.showToast('Installed', 'success'); this.render()
    }))
    document.querySelectorAll('.mcp-market-uninstall').forEach(btn => btn.addEventListener('click', () => {
      Store.installedMcp.remove(btn.dataset.id); this.render()
    }))
  },

  /* ─── SKILLS ───────────────────────────────────── */

  renderSkills() {
    const list = Store.skills.list()
    const activeId = Store.activeSkillId.get()
    const defaultSkills = [
      { id: 'translator', name: 'Translator', desc: 'Translate text between languages automatically', icon: '🌐', systemPrompt: 'You are a professional translator. When the user sends text, detect the source language and translate to the requested target language. Preserve formatting, tone, and intent. If no target language is specified, ask.' },
      { id: 'code-reviewer', name: 'Code Reviewer', desc: 'Review code for bugs, security, and best practices', icon: '🔍', systemPrompt: 'You are a senior code reviewer. Analyze code for bugs, security vulnerabilities, performance issues, and style violations. Provide actionable feedback with line-specific suggestions. Be thorough but constructive.' },
      { id: 'teacher', name: 'Teacher', desc: 'Explain concepts step-by-step like a patient tutor', icon: '📚', systemPrompt: 'You are a patient teacher. Explain concepts from first principles. Use analogies, examples, and check for understanding. Adapt complexity to the student\'s level. Never skip steps.' },
      { id: 'writer', name: 'Writer', desc: 'Creative and technical writing assistant', icon: '✍️', systemPrompt: 'You are a skilled writer. Help with creative writing, technical documentation, copywriting, and editing. Adapt tone and style to the audience. Provide multiple options when brainstorming.' },
      { id: 'debate', name: 'Debate Partner', desc: 'Challenge ideas with structured debate', icon: '⚖️', systemPrompt: 'You are a debate partner. Present balanced arguments on any topic. Challenge assumptions respectfully. Use evidence and logic. Clearly label your position and acknowledge uncertainty.' },
      { id: 'brainstorm', name: 'Brainstorm Buddy', desc: 'Generate ideas, mind maps, and creative solutions', icon: '💡', systemPrompt: 'You are a brainstorming assistant. Help generate diverse ideas without judgement. Use techniques like SCAMPER, lateral thinking, and mind mapping. Build on the user\'s ideas. Encourage wild possibilities then refine.' },
    ]

    const allSkills = [...defaultSkills, ...list.filter(s => !defaultSkills.find(d => d.id === s.id))]

    this.setContent(`
      <div class="page-header">
        <div><h1>Skills</h1><p>Activate skills to customize AI behavior</p></div>
        <button class="btn btn-primary" id="skills-new">+ Custom Skill</button>
      </div>
      ${activeId ? `<div style="background:var(--accent-muted);color:var(--accent);padding:10px 16px;border-radius:var(--radius);margin-bottom:16px;display:flex;align-items:center;gap:8px;font-size:14px">⚡ Active: ${this.escapeHtml(allSkills.find(s => s.id === activeId)?.name || activeId)} <button class="btn btn-ghost btn-sm" id="skills-deactivate" style="margin-left:auto;font-size:12px">Deactivate</button></div>` : '<div style="background:var(--bg-secondary);padding:10px 16px;border-radius:var(--radius);margin-bottom:16px;font-size:13px;color:var(--text-muted)">No active skill. Select a skill below to activate.</div>'}
      <div id="skills-grid" class="grid-3" style="grid-template-columns:repeat(auto-fill,minmax(260px,1fr))">${allSkills.map(s => `
        <div class="card${activeId === s.id ? ' skill-active' : ''}" style="display:flex;flex-direction:column;gap:8px;${activeId === s.id ? 'border-color:var(--accent)' : ''}">
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:24px">${s.icon || '🧩'}</span>
            <div><strong style="color:var(--text-primary);font-size:14px">${this.escapeHtml(s.name)}</strong></div>
          </div>
          <div style="font-size:13px;color:var(--text-secondary);flex:1">${this.escapeHtml(s.desc)}</div>
          <div style="display:flex;gap:4px;margin-top:4px">
            ${activeId === s.id ? `<button class="btn btn-secondary btn-sm skills-deactivate" style="font-size:11px">Deactivate</button>` : `<button class="btn btn-primary btn-sm skills-activate" data-id="${s.id}" style="font-size:11px">Activate</button>`}
            ${!defaultSkills.find(d => d.id === s.id) ? `<button class="btn btn-ghost btn-sm skills-del" data-id="${s.id}" style="font-size:11px;color:var(--danger)">Delete</button>` : ''}
          </div>
        </div>`).join('')}</div>
      <div id="skills-editor" style="display:none"></div>
    `)

    document.getElementById('skills-deactivate')?.addEventListener('click', () => {
      Store.activeSkillId.clear(); this.render()
    })
    document.querySelectorAll('.skills-activate').forEach(btn => btn.addEventListener('click', () => {
      Store.activeSkillId.set(btn.dataset.id); this.render()
    }))
    document.querySelectorAll('.skills-deactivate').forEach(btn => btn.addEventListener('click', () => {
      Store.activeSkillId.clear(); this.render()
    }))
    document.querySelectorAll('.skills-del').forEach(btn => btn.addEventListener('click', () => {
      Store.skills.delete(btn.dataset.id)
      if (Store.activeSkillId.get() === btn.dataset.id) Store.activeSkillId.clear()
      this.render()
    }))
    document.getElementById('skills-new')?.addEventListener('click', () => this._editSkill(null))
  },

  _editSkill(skill) {
    const el = document.getElementById('skills-editor')
    if (!el) return
    const s = skill || { id: '', name: '', desc: '', icon: '🧩', systemPrompt: '' }
    el.style.display = 'block'
    el.innerHTML = `
      <div class="card" style="margin-top:16px">
        <div class="card-header"><span class="card-title">${s.id ? 'Edit' : 'New'} Skill</span></div>
        <div class="card-body">
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px">
            <div><label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:4px">Name</label><input type="text" class="input" id="skill-editor-name" value="${this.escapeHtml(s.name)}" placeholder="Skill name" style="font-size:13px"></div>
            <div><label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:4px">Icon (emoji)</label><input type="text" class="input" id="skill-editor-icon" value="${this.escapeHtml(s.icon)}" placeholder="🧩" style="font-size:13px;width:80px"></div>
            <div><label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:4px">Description</label><input type="text" class="input" id="skill-editor-desc" value="${this.escapeHtml(s.desc)}" placeholder="Short description" style="font-size:13px"></div>
          </div>
          <div><label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:4px">System Prompt</label><textarea class="input" id="skill-editor-prompt" rows="6" style="resize:vertical;font-size:13px;font-family:var(--font-mono)">${this.escapeHtml(s.systemPrompt || '')}</textarea></div>
          <div style="display:flex;gap:8px;margin-top:12px">
            <button class="btn btn-primary" id="skill-editor-save">Save</button>
            <button class="btn btn-secondary" id="skill-editor-cancel">Cancel</button>
          </div>
        </div>
      </div>`
    document.getElementById('skill-editor-save').addEventListener('click', () => {
      const name = document.getElementById('skill-editor-name').value.trim()
      const icon = document.getElementById('skill-editor-icon').value.trim() || '🧩'
      const desc = document.getElementById('skill-editor-desc').value.trim()
      const systemPrompt = document.getElementById('skill-editor-prompt').value.trim()
      if (!name || !systemPrompt) { this.showToast('Name and system prompt required', 'warning'); return }
      Store.skills.save({ id: s.id || this._genId(), name, icon, desc, systemPrompt })
      this.showToast('Skill saved', 'success')
      this.render()
    })
    document.getElementById('skill-editor-cancel').addEventListener('click', () => this.render())
  },
}

document.addEventListener('DOMContentLoaded', () => App.init())
