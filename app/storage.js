const Store = {
  _ns: 'jmpp_',

  _key(k) { return this._ns + k },

  _get(key, fallback) {
    try { const v = localStorage.getItem(this._key(key)); return v ? JSON.parse(v) : fallback }
    catch { return fallback }
  },

  _set(key, val) { localStorage.setItem(this._key(key), JSON.stringify(val)) },

  // ── Sessions ──
  sessions: {
    list() {
      return Store._get('sessions', []).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    },
    get(id) {
      return Store._get('sessions', []).find(s => s.id === id) || null
    },
    save(session) {
      const all = Store._get('sessions', [])
      const idx = all.findIndex(s => s.id === session.id)
      session.updatedAt = Date.now()
      if (idx >= 0) all[idx] = session
      else all.push(session)
      Store._set('sessions', all)
    },
    delete(id) {
      Store._set('sessions', Store._get('sessions', []).filter(s => s.id !== id))
      if (Store._get('current_session') === id) Store._set('current_session', null)
    },
    current() {
      return Store._get('current_session', null)
    },
    setCurrent(id) {
      Store._set('current_session', id)
    },
  },

  // ── Instructions ──
  instructions: {
    list() {
      return Store._get('instructions', [])
    },
    save(inst) {
      const all = Store._get('instructions', [])
      const idx = all.findIndex(i => i.id === inst.id)
      if (idx >= 0) all[idx] = inst
      else all.push(inst)
      Store._set('instructions', all)
    },
    delete(id) {
      Store._set('instructions', Store._get('instructions', []).filter(i => i.id !== id))
    },
  },

  // ── Personas ──
  personas: {
    list() {
      return Store._get('personas', [])
    },
    save(p) {
      const all = Store._get('personas', [])
      const idx = all.findIndex(x => x.id === p.id)
      if (idx >= 0) all[idx] = p
      else all.push(p)
      Store._set('personas', all)
    },
    delete(id) {
      Store._set('personas', Store._get('personas', []).filter(p => p.id !== id))
    },
  },

  // ── Custom MCP ──
  customMcp: {
    list() {
      return Store._get('custom_mcp', [])
    },
    save(mcp) {
      const all = Store._get('custom_mcp', [])
      const idx = all.findIndex(x => x.id === mcp.id)
      if (idx >= 0) all[idx] = mcp
      else all.push(mcp)
      Store._set('custom_mcp', all)
    },
    delete(id) {
      Store._set('custom_mcp', Store._get('custom_mcp', []).filter(m => m.id !== id))
    },
  },

  // ── Installed MCP Market ──
  installedMcp: {
    list() {
      return Store._get('installed_mcp', [])
    },
    add(id) {
      const all = Store._get('installed_mcp', [])
      if (!all.includes(id)) { all.push(id); Store._set('installed_mcp', all) }
    },
    remove(id) {
      Store._set('installed_mcp', Store._get('installed_mcp', []).filter(x => x !== id))
    },
    has(id) {
      return Store._get('installed_mcp', []).includes(id)
    },
  },

  // ── Skills ──
  skills: {
    list() {
      return Store._get('skills', [])
    },
    save(skill) {
      const all = Store._get('skills', [])
      const idx = all.findIndex(s => s.id === skill.id)
      if (idx >= 0) all[idx] = skill
      else all.push(skill)
      Store._set('skills', all)
    },
    delete(id) {
      Store._set('skills', Store._get('skills', []).filter(s => s.id !== id))
    },
  },

  // ── Active Skill ──
  activeSkillId: {
    get() { return Store._get('active_skill', null) },
    set(id) { Store._set('active_skill', id) },
    clear() { Store._set('active_skill', null) },
  },
}
