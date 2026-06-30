#!/usr/bin/env python3
import os, sys, json, yaml, time, asyncio, logging
from pathlib import Path
from typing import Optional

import aiohttp.web
from aiohttp import web

ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT))

from providers.registry import ProviderRegistry
from providers.discovery import ProviderDiscovery
from providers.autodiscover import AutoDiscover
from providers.monitor import HealthMonitor
from providers.integrator import AutoIntegrator
from providers.intelligence import ProviderIntelligence
from router import Router, STRATEGY_ROUND_ROBIN
from task_router import TaskRouter
from jeumpa_paths import get_all_paths, load_env_file, get_home, get_data_root, get_log_dir, get_db_path, get_pid_dir, get_backup_dir, get_os, get_config, get_tunnel_config_path
from jeumpa_tunnel import TunnelDetector

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
log = logging.getLogger("jeumpa")

DEFAULT_CHAT_TIMEOUT = 120

class JeumpaLLM:
    def __init__(self):
        load_env_file()
        self.paths = get_all_paths()
        self.os_type = get_os()
        log.info(f"OS: {self.os_type} | Home: {self.paths['home']} | Data: {self.paths['data_root']}")

        self.router = Router()
        cfg_path = get_config()
        self.registry = ProviderRegistry(str(cfg_path) if cfg_path.exists() else str(ROOT / "config.yaml"))
        self.discovery = ProviderDiscovery(self.registry)
        self.autodiscover = None
        self.monitor = None
        self.integrator = None
        self.intel = ProviderIntelligence()
        self.tasks = TaskRouter(str(cfg_path) if cfg_path.exists() else str(ROOT / "config.yaml"))
        self.tunnel = TunnelDetector(port=int(os.environ.get("PORT", "3456")))
        self.config = {}
        self._start_time = time.time()
        self._refresh_task = None
        self._autonomous_tasks = []
        self._public_url = None

    async def init(self):
        self.config = self.registry.load_config()
        self.registry.build(self.router)

        tunnel_info = await self.tunnel.detect(force=True)
        if tunnel_info.get("public_url"):
            self._public_url = tunnel_info["public_url"]
            log.info(f"🌐 Public URL: {self._public_url}/v1")
        else:
            local_url = f"http://127.0.0.1:{os.environ.get('PORT', '3456')}"
            log.info(f"🌐 Local URL: {local_url}/v1 (no tunnel detected)")

        self.autodiscover = AutoDiscover(self.registry, self.router)
        self.monitor = HealthMonitor(self.router, self.registry)
        self.integrator = AutoIntegrator(self.registry, self.router)
        self.intel = ProviderIntelligence(self.router, self.registry)

        svr_cfg = self.config.get("server", {})
        rtr_cfg = self.config.get("routing", {})
        if rtr_cfg.get("fallback", True) is False:
            self.router.fallback_enabled = False
        self.router.strategy = rtr_cfg.get("strategy", STRATEGY_ROUND_ROBIN)
        mdl_cfg = self.config.get("models", {})
        for alias, target in mdl_cfg.get("aliases", {}).items():
            self.router.add_alias(alias, target)

        for p in self.router.providers.values():
            p.provider_category = self.intel.get_provider_category(
                p.name,
                {"base_url": p.config.base_url or "", "api_key": p.config.api_key or "", "models": p.config.model_list},
            )
            p.detected_capabilities = self.intel.classify_model_capabilities(p.name)

        log.info(f"Loaded — {len(self.router.providers)} providers, {len(self.router.model_map)} models, {len(self.tasks.tasks)} task profiles")

    async def _health_check_all(self):
        tasks = []
        for p in self.router.providers.values():
            if p.name in ("echo", "g4f"):
                continue
            tasks.append(self._safe_health(p))
        if not tasks:
            return
        results = await asyncio.gather(*tasks, return_exceptions=True)
        ok = sum(1 for r in results if r is True)
        if isinstance(ok, int):
            log.info(f"Health: {ok}/{len(tasks)} online")
        else:
            log.info(f"Health: {len([r for r in results if r is True])}/{len(tasks)} online")

        from providers.base import ProviderStatus
        for pname, p in self.router.providers.items():
            if p.status == ProviderStatus.RATE_LIMITED and p.cooldown_until < time.time():
                p.status = ProviderStatus.ONLINE
                log.info(f"  {pname}: cooldown expired, restored to ONLINE")

    async def _safe_health(self, provider):
        try:
            return await provider.check_health()
        except Exception as e:
            provider.status = "offline"
            provider.last_error = str(e)
            return False

    async def _discovery_loop(self):
        try:
            discovered = await self.discovery.scan_github_sources()
            if discovered:
                self.discovery.integrate_discovered(self.router)

            noauth = await self.discovery.discover_noauth_endpoints()
            if noauth:
                self.discovery.integrate_noauth(self.router, noauth)

            if self.autodiscover:
                candidates = await self.autodiscover.scan_all_sources()
                if candidates:
                    log.info(f"AutoDiscover: {len(candidates)} new candidates, probing...")
                    working = await self.autodiscover.probe_all_candidates(candidates)
                    if working and self.integrator:
                        self.integrator.integrate(working)
        except Exception as e:
            log.warn(f"Discovery: {e}")

    async def _auto_refresh(self, interval=1800):
        while True:
            await asyncio.sleep(interval)
            log.info("Auto-refresh: autonomous cycle starting...")
            try:
                prev_count = len(self.router.providers)

                discovered = await self.discovery.scan_github_sources()
                if discovered:
                    self.discovery.integrate_discovered(self.router)

                noauth = await self.discovery.discover_noauth_endpoints()
                if noauth:
                    self.discovery.integrate_noauth(self.router, noauth)

                if self.autodiscover:
                    candidates = await self.autodiscover.scan_all_sources()
                    if candidates:
                        working = await self.autodiscover.probe_all_candidates(candidates)
                        if working and self.integrator:
                            self.integrator.integrate(working)

                pruned = self.router.auto_prune_offline(max_age=86400)
                if pruned:
                    log.info(f"Auto-refresh: pruned {len(pruned)} stale offline providers")

                new_count = len(self.router.providers)
                if new_count != prev_count:
                    log.info(f"Auto-refresh: {new_count} providers (prev {prev_count})")
            except Exception as e:
                log.warn(f"Auto-refresh error: {e}")

    def resolve_model(self, model: str, task: str = None):
        if model and model != "auto":
            return model
        return self.tasks.get_model(task or "default")

    @property
    def stats(self):
        uptime = int(time.time() - self._start_time)
        return {
            "uptime": uptime,
            "providers": len(self.router.providers),
            "models": len(self.router.model_map),
            "strategy": self.router.strategy,
            "fallback": self.router.fallback_enabled,
            "tasks": len(self.tasks.tasks),
        }

app = JeumpaLLM()

async def handle_chat(request, body=None):
    if body is None:
        try:
            body = await request.json()
        except:
            return web.json_response({"error": "invalid_json", "status": 400}, status=400)
    messages = body.get("messages", [])
    model = body.get("model", "auto")
    task = body.get("task")
    stream = body.get("stream", False)
    strategy = body.get("strategy")

    user = request.get("user")
    if user:
        tier = (user.get("tier") or "free").lower()
        if tier == "donor":
            from models import get_session, User as UserModel
            with get_session() as s:
                db_user = s.query(UserModel).filter_by(id=user["id"]).first()
                if db_user and db_user.token_balance and db_user.token_balance > 0:
                    db_user.token_balance -= 1
        ci = user.get("custom_instructions")
        if ci and ci.strip():
            has_system = any(m.get("role") == "system" for m in messages)
            if not has_system:
                messages.insert(0, {"role": "system", "content": ci.strip()})

    model = app.resolve_model(model, task)
    timeout = app.tasks.get_timeout(task or "default")
    kwargs = {k: body[k] for k in body if k not in ("messages", "model", "task", "stream", "strategy")}
    try:
        result = await asyncio.wait_for(
            app.router.chat_completion(messages, model=model, stream=stream, strategy=strategy, **kwargs),
            timeout=timeout
        )
    except asyncio.TimeoutError:
        return web.json_response({"error": "request_timeout", "status": 504}, status=504)
    if stream and hasattr(result, '__aiter__'):
        resp = web.StreamResponse(status=200, headers={
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        })
        await resp.prepare(request)
        try:
            async for chunk in result:
                if chunk:
                    await resp.write(f"data: {chunk}\n\n".encode())
            await resp.write(b"data: [DONE]\n\n")
        except (ConnectionResetError, ConnectionAbortedError):
            pass
        except RuntimeError:
            pass
        return resp
    if isinstance(result, dict) and result.get("error"):
        status = result.get("status", 503)
        return web.json_response(result, status=status)
    return web.json_response(result)

async def handle_completion(request):
    try:
        body = await request.json()
    except:
        return web.json_response({"error": "invalid_json", "status": 400}, status=400)
    prompt = body.get("prompt", "")
    body["messages"] = [{"role": "user", "content": prompt}]
    return await handle_chat(request, body=body)

async def handle_streaming(request):
    try:
        body = await request.json()
    except:
        return web.json_response({"error": "invalid_json", "status": 400}, status=400)
    body["stream"] = True
    return await handle_chat(request, body=body)

async def handle_models(request):
    models = {}
    for pname, p in app.router.providers.items():
        ml = p.config.model_list if p.config.model_list != ["*"] else []
        if ml:
            for m in ml:
                models[f"{pname}/{m}"] = {"provider": pname, "model": m, "status": p.status}
        else:
            models[pname] = {"provider": pname, "model": "*", "status": p.status}
    for alias, target in app.router.aliases.items():
        models[f"alias:{alias}"] = {"alias": alias, "target": target, "type": "alias"}
    return web.json_response({
        "object": "list",
        "data": [{"id": k, **v} for k, v in models.items()]
    })

async def handle_tasks(request):
    return web.json_response({
        "object": "list",
        "data": [{"id": k, **v} for k, v in app.tasks.list_tasks().items()]
    })

async def handle_update_task(request):
    task = request.match_info.get("task")
    if not task:
        return web.json_response({"error": "task_required", "status": 400}, status=400)
    try:
        body = await request.json()
        app.tasks.update_task(task, body)
        return web.json_response({"status": "ok", "task": task, "config": body})
    except Exception as e:
        return web.json_response({"error": str(e), "status": 400}, status=400)

async def handle_refresh(request):
    log.info("Manual refresh triggered")
    asyncio.create_task(app._discovery_loop())
    return web.json_response({"status": "ok", "message": "refresh started"})

async def handle_status(request):
    return web.json_response({
        "jeumpa": app.stats,
        "providers": app.router.status_all(),
    })

async def handle_providers(request):
    return web.json_response(app.router.status_all())

async def handle_health(request):
    return web.json_response({"status": "ok", "stats": app.stats})

async def handle_paths(request):
    return web.json_response(app.paths)

async def handle_tunnel(request):
    info = app.tunnel.get_status()
    info["public_url"] = app._public_url
    return web.json_response(info)

async def handle_autodiscover_status(request):
    data = {
        "autodiscover": app.autodiscover.get_stats() if app.autodiscover else {"active": False},
        "monitor": app.monitor.get_summary() if app.monitor else {"active": False},
        "integrator": app.integrator.get_integration_stats() if app.integrator else {"active": False},
        "discovery": app.discovery.get_discovery_stats() if hasattr(app.discovery, 'get_discovery_stats') else {},
        "prune": {"can_prune": len([p for p in app.router.providers.values() if p.status == "offline"])},
    }
    return web.json_response(data)
    data = {
        "autodiscover": app.autodiscover.get_stats() if app.autodiscover else {"active": False},
        "monitor": app.monitor.get_summary() if app.monitor else {"active": False},
        "integrator": app.integrator.get_integration_stats() if app.integrator else {"active": False},
        "discovery": app.discovery.get_discovery_stats() if hasattr(app.discovery, 'get_discovery_stats') else {},
        "prune": {"can_prune": len([p for p in app.router.providers.values() if p.status == "offline"])},
    }
    return web.json_response(data)

async def handle_autodiscover_probe(request):
    if not app.autodiscover:
        return web.json_response({"error": "autodiscover_not_active"}, status=400)
    try:
        body = await request.json() if request.body_exists else {}
    except:
        body = {}
    force = body.get("force", False)
    if force:
        asyncio.create_task(app.autodiscover.scan_all_sources())
        return web.json_response({"status": "ok", "message": "forced scan started"})
    return web.json_response({
        "status": "ok",
        "stats": app.autodiscover.get_stats(),
        "probe_history": app.autodiscover.get_probe_history(),
    })

async def handle_autodiscover_integrate(request):
    if not app.integrator:
        return web.json_response({"error": "integrator_not_active"}, status=400)
    try:
        body = await request.json()
    except:
        return web.json_response({"error": "invalid_json"}, status=400)
    provider_name = body.get("provider")
    if provider_name:
        provider = app.registry.providers.get(provider_name)
        if not provider:
            return web.json_response({"error": "provider_not_found"}, status=404)
        features = app.integrator.auto_enable_features(provider_name)
        return web.json_response({"provider": provider_name, "features": features, "config": provider.to_dict()})
    return web.json_response(app.integrator.get_integration_stats())

async def handle_dashboard(request):
    rows = []
    for n, p in app.router.providers.items():
        i = p.to_dict()
        rows.append(f"<tr><td>{i['name']}</td><td><span class='s-{i['status']}'>{i['status']}</span></td>"
                     f"<td>{i['latency_ms']}ms</td><td>{i['total_requests']}</td>"
                     f"<td>{i['failed_requests']}</td>"
                     f"<td>{', '.join(i['models'][:2]) if i['models'] else '*'}</td></tr>")
    alive = sum(1 for p in app.router.providers.values() if p.status == "online")
    task_rows = "".join(f"<tr><td>{k}</td><td>{v['model']}</td><td>{','.join(v.get('fallback',[]))}</td></tr>"
                        for k, v in app.tasks.list_tasks().items())
    html = f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>JeumpaLLM</title><style>
*{{margin:0;padding:0;box-sizing:border-box}}
body{{font-family:'Inter',sans-serif;background:#0a0a0f;color:#cdd6f4}}
.hdr{{background:linear-gradient(135deg,#1e1e2e,#11111b);border-bottom:1px solid #313244;padding:20px 30px}}
.hdr h1{{font-size:24px;background:linear-gradient(135deg,#89b4fa,#cba6f7);-webkit-background-clip:text;-webkit-text-fill-color:transparent}}
.stats{{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;padding:20px 30px}}
.sc{{background:#181825;border:1px solid #313244;border-radius:12px;padding:16px}}
.sc .n{{font-size:28px;font-weight:700;color:#89b4fa}}
.sc .l{{font-size:12px;color:#6c7086;margin-top:4px}}
.content{{padding:0 30px 30px}}
.card{{background:#181825;border:1px solid #313244;border-radius:12px;margin-bottom:16px;overflow:hidden}}
.ct{{padding:14px 18px;font-size:14px;font-weight:600;border-bottom:1px solid #313244}}
table{{width:100%;border-collapse:collapse;font-size:13px}}
th{{text-align:left;padding:10px 14px;color:#6c7086;font-weight:500;border-bottom:1px solid #313244}}
td{{padding:10px 14px;border-bottom:1px solid #1e1e2e}}
.s-online{{color:#a6e3a1}}.s-offline{{color:#f38ba8}}.s-unknown{{color:#6c7086}}
.s-rate_limited{{color:#f9e2af}}.s-degraded{{color:#fab387}}
form{{padding:18px}}
form input,form select{{background:#1e1e2e;border:1px solid #313244;border-radius:6px;padding:8px 12px;color:#cdd6f4;margin:4px;font-size:13px}}
form button{{background:#89b4fa;color:#1e1e2e;border:none;padding:8px 20px;border-radius:8px;font-weight:600;cursor:pointer}}
pre{{background:#1e1e2e;border:1px solid #313244;border-radius:8px;padding:12px;margin:10px 18px;overflow:auto;font-size:12px;min-height:40px}}
</style></head><body>
<div class=hdr><h1>JeumpaLLM</h1><div style=color:#6c7086;font-size:13px;margin-top:4px>
{app.stats['providers']} providers &middot; {app.stats['models']} models &middot; {app.stats['tasks']} task profiles &middot; {alive} online &middot; {app.stats['strategy']}</div></div>
<div class=stats>
<div class=sc><div class=n>{app.stats['providers']}</div><div class=l>Providers</div></div>
<div class=sc><div class=n>{app.stats['models']}</div><div class=l>Models</div></div>
<div class=sc><div class=n>{alive}</div><div class=l>Online</div></div>
<div class=sc><div class=n>{app.stats['tasks']}</div><div class=l>Task Routes</div></div>
</div>
<div class=content>
<div class=card><div class=ct>Providers ({app.stats['providers']})</div>
<table><thead><tr><th>Name</th><th>Status</th><th>Latency</th><th>Req</th><th>Fail</th><th>Models</th></tr></thead>
<tbody>{"".join(rows)}</tbody></table></div>
<div class=card><div class=ct>Task Routing ({app.stats['tasks']} profiles)</div>
<table><thead><tr><th>Task</th><th>Model</th><th>Fallback</th></tr></thead>
<tbody>{task_rows}</tbody></table></div>
<div class=card><div class=ct>Quick Chat</div>
<form onsubmit="return chat(event)">
  <input id=msg placeholder="Message" size=40>
  <select id=task><option value="">auto</option><option value=chat>chat</option><option value=coding>coding</option><option value=reasoning>reasoning</option><option value=creative>creative</option></select>
  <button>Send</button>
</form>
<pre id=resp>Ready.</pre></div>
</div>
<script>
async function chat(e){{e.preventDefault()
const r=document.getElementById('resp');r.textContent='...'
try{{const d=await fetch('/v1/chat/completions',{{method:'POST',headers:{{'Content-Type':'application/json'}},
body:JSON.stringify({{model:'auto',task:document.getElementById('task').value||'chat',
messages:[{{role:'user',content:document.getElementById('msg').value}}]}})}}).then(r=>r.json())
r.textContent=d.choices?.[0]?.message?.content||JSON.stringify(d)}}catch(e){{r.textContent='Error: '+e}}}}
</script></body></html>"""
    return web.Response(text=html, content_type="text/html")

async def handle_chat_page(request):
    for sub in ("app", "static"):
        html_path = ROOT / sub / "index.html"
        if html_path.exists():
            return web.Response(text=html_path.read_text(), content_type="text/html")
    return web.Response(text="Chat UI not built yet. Run build first.", content_type="text/html")

async def handle_admin_page(request):
    for sub in ("app", "static"):
        html_path = ROOT / sub / "admin" / "index.html"
        if html_path.exists():
            return web.Response(text=html_path.read_text(), content_type="text/html")
    return web.Response(text="Admin panel not built yet.", content_type="text/html")

async def handle_api(request):
    return web.json_response({"endpoints": {
        "GET /": "dashboard",
        "GET /v1/models": "list models",
        "POST /v1/chat/completions": "chat (model, task, stream)",
        "GET /v1/tasks": "list task profiles",
        "PUT /v1/tasks/{task}": "update task profile",
        "POST /v1/refresh": "manual discovery refresh",
        "GET /v1/status": "status",
        "GET /v1/providers": "provider details",
        "GET /v1/health": "health",
        "GET /v1/paths": "auto-detect paths",
        "GET /v1/tunnel": "tunnel/public URL info",
        "GET /v1/discovery": "autodiscovery status",
        "POST /v1/discovery/probe": "trigger/query probe",
        "POST /v1/discovery/integrate": "integrate/manage providers",
    }})

async def _start_discovery(app_ctx):
    await asyncio.sleep(5)
    log.info("Discovery starting...")
    try:
        await app._discovery_loop()
        log.info("Discovery complete")
    except Exception as e:
        log.warn(f"Discovery: {e}")

async def _start_autorefresh(app_ctx):
    await asyncio.sleep(10)
    interval = app.config.get("server", {}).get("discovery_interval", 3600)
    if interval and interval > 0:
        log.info(f"Auto-refresh every {interval}s")
        app._refresh_task = asyncio.create_task(app._auto_refresh(interval))

async def on_startup_handler(wapp):
    """Run init and background tasks without blocking server startup."""
    try:
        await app.init()
    except Exception as e:
        log.warn(f"Init error: {e}")

    # Load persisted discovered providers
    try:
        from providers.autodiscover import load_discovered_providers
        saved = load_discovered_providers()
        if saved:
            from providers.integrator import AutoIntegrator
            integrator = AutoIntegrator(app.registry, app.router)
            restored = 0
            for name, info in saved.items():
                if name not in app.registry.providers:
                    cfg_data = {
                        "endpoint_url": info["base_url"],
                        "working": True,
                        "models": info.get("models", []),
                        "latency_ms": info.get("latency_ms", 0),
                    }
                    from providers.base import ProviderConfig, ProviderStatus
                    from providers.openai_compat import OpenAICompatibleProvider
                    pcfg = ProviderConfig(name=name, type="openai_compat", base_url=info["base_url"],
                                          api_key="", models=info.get("models", ["*"]),
                                          priority=info.get("priority", 10))
                    provider = OpenAICompatibleProvider(pcfg)
                    provider._is_autodiscovered = True
                    provider.latency_ms = info.get("latency_ms", 0)
                    provider.status = ProviderStatus.ONLINE
                    app.router.register(provider)
                    app.registry.providers[name] = provider
                    restored += 1
            if restored:
                log.info(f"Restored {restored} discovered providers from persistent store")
    except Exception as e:
        log.warn(f"Load discovered providers error: {e}")

    # Initialize database
    try:
        from models import init_db
        init_db()
        wapp["db_session_factory"] = True
        log.info("Database initialized")
    except Exception as e:
        log.warn(f"Database init error: {e}")

    # Setup auth (adds auth middleware + routes)
    try:
        from auth import setup_auth
        setup_auth(wapp)
        log.info("Auth module loaded")
    except Exception as e:
        log.warn(f"Auth init error: {e}")

    # Setup rate limiter (after auth so it runs first)
    try:
        from rate_limit import rate_limit_middleware
        wapp.middlewares.append(rate_limit_middleware)
        log.info("Rate limiter loaded")
    except Exception as e:
        log.warn(f"Rate limiter init error: {e}")

    # Setup memory routes
    try:
        from memory import setup_memory_routes
        setup_memory_routes(wapp)
        log.info("Memory module loaded")
    except Exception as e:
        log.warn(f"Memory init error: {e}")

    # Setup agent routes
    try:
        from agent import setup_agent_routes
        setup_agent_routes(wapp, app.router)
        log.info("Agent module loaded")
    except Exception as e:
        log.warn(f"Agent init error: {e}")

    # Setup MCP SSE routes
    try:
        from mcp_sse import setup_mcp_routes
        setup_mcp_routes(wapp, app.router)
        log.info("MCP SSE module loaded")
    except Exception as e:
        log.warn(f"MCP SSE init error: {e}")

    # Setup donation routes
    try:
        from donate import routes as donate_routes
        wapp.add_routes(donate_routes)
        log.info("Donation module loaded")
    except Exception as e:
        log.warn(f"Donation init error: {e}")

    # Setup santri routes
    try:
        from santri import routes as santri_routes
        wapp.add_routes(santri_routes)
        log.info("Santri module loaded")
    except Exception as e:
        log.warn(f"Santri init error: {e}")

    # Setup extra routes (RAG, graph, marketplace, etc.)
    try:
        from router import setup_extra_routes
        setup_extra_routes(wapp, app)
        log.info("Extra routes registered")
    except Exception as e:
        log.warn(f"Extra routes init error: {e}")

    asyncio.create_task(_start_discovery(None))
    asyncio.create_task(_start_autorefresh(None))

    if app.monitor:
        log.info("Starting AI HealthMonitor...")
        asyncio.create_task(app.monitor.start_with_retry())

    if app.autodiscover:
        log.info("Starting AutoDiscover background scanner...")
        interval = app.config.get("server", {}).get("discovery_interval", 1800)
        asyncio.create_task(app.autodiscover.continuous_discovery(interval))

def create_app():
    wapp = web.Application()
    wapp.on_startup.append(on_startup_handler)
    wapp.router.add_get("/", handle_dashboard)
    wapp.router.add_get("/chat", handle_chat_page)
    wapp.router.add_get("/api", handle_api)
    wapp.router.add_get("/v1/models", handle_models)
    wapp.router.add_post("/v1/chat/completions", handle_chat)
    wapp.router.add_post("/v1/streaming", handle_streaming)
    wapp.router.add_post("/v1/completion", handle_completion)
    wapp.router.add_get("/v1/tasks", handle_tasks)
    wapp.router.add_put("/v1/tasks/{task}", handle_update_task)
    wapp.router.add_post("/v1/refresh", handle_refresh)
    wapp.router.add_get("/v1/status", handle_status)
    wapp.router.add_get("/v1/providers", handle_providers)
    wapp.router.add_get("/v1/health", handle_health)
    wapp.router.add_get("/v1/paths", handle_paths)
    wapp.router.add_get("/v1/tunnel", handle_tunnel)
    wapp.router.add_get("/v1/discovery", handle_autodiscover_status)
    wapp.router.add_post("/v1/discovery/probe", handle_autodiscover_probe)
    wapp.router.add_post("/v1/discovery/integrate", handle_autodiscover_integrate)
    wapp.router.add_get("/admin", handle_admin_page)
    # Static files — serve from app/ or static/ directory
    for sub in ("app", "static"):
        p = ROOT / sub
        if p.exists():
            static_path = p
            log.info(f"Serving static files from {static_path}")
            break
    else:
        static_path = None
    if static_path:
        wapp.router.add_static("/static", str(static_path), show_index=True)
        if static_path.name == "app":
            wapp.router.add_static("/app", str(static_path), show_index=True)
        sw_path = static_path / "sw.js"
        if sw_path.exists():
            async def handle_sw(request):
                return web.Response(text=sw_path.read_text(), content_type="application/javascript", headers={"Service-Worker-Allowed": "/"})
            wapp.router.add_get("/sw.js", handle_sw)
    return wapp

def main():
    import socket, signal, platform
    svr_cfg = {}
    cfg_path = ROOT / "config.yaml"
    if cfg_path.exists():
        svr_cfg = yaml.safe_load(cfg_path.read_text()).get("server", {})
    host = svr_cfg.get("host", "0.0.0.0")
    port = svr_cfg.get("port", 3456)
    instance = os.environ.get("JEUMAPPA_INSTANCE", "0")
    reuse_port = os.environ.get("JEUMAPPA_REUSE_PORT", "").lower() in ("1", "true", "yes")

    wapp = create_app()
    wapp["instance"] = instance
    log.info(f"Instance {instance} starting on {host}:{port} (reuse_port={reuse_port})")

    if reuse_port or int(instance) > 0:
        runner = web.AppRunner(wapp)
        loop = asyncio.get_event_loop()
        loop.run_until_complete(runner.setup())
        site = web.TCPSite(runner, host, port, reuse_port=True)
        loop.run_until_complete(site.start())
        log.info(f"Instance {instance} running on {host}:{port} (PID={os.getpid()})")
        try:
            loop.run_forever()
        except KeyboardInterrupt:
            pass
        finally:
            loop.run_until_complete(runner.cleanup())
    else:
        web.run_app(wapp, host=host, port=port)

if __name__ == "__main__":
    main()
