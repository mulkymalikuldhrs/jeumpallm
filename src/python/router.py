import random, time, asyncio, json, logging
from typing import Optional
from aiohttp import web
from providers.base import BaseProvider, ProviderStatus
from a2a_protocol import A2AServer, AgentCard, AgentCapabilities, AgentSkill, TaskManager
from marketplace import MarketplaceRegistry

# ── Optional Modules ─────────────────────────────────────────────────────────
try:
    from analytics import get_analytics_overview, get_provider_ranking, get_model_popularity
    from observability import Tracer
    _tracer = Tracer()
    HAS_ANALYTICS = True
except ImportError:
    HAS_ANALYTICS = False

try:
    from orchestration import Engine, WorkflowRegistry
    _engine = Engine()
    _workflow_registry = WorkflowRegistry()
    HAS_ORCHESTRATION = True
except ImportError:
    HAS_ORCHESTRATION = False
from anthropic_compat import Handler, Converter
from fugu_mode import FuguMode, FUGU_STRATEGIES

try:
    from aceh import detect_aceh, enrich_prompt, setup_aceh_routes
    HAS_ACEH = True
except ImportError:
    HAS_ACEH = False

STRATEGY_ROUND_ROBIN = "round_robin"
STRATEGY_PRIORITY = "priority"
STRATEGY_RANDOM = "random"
STRATEGY_LATENCY = "latency"
STRATEGY_FALLBACK = "fallback"

class Router:
    def __init__(self):
        self.providers: dict[str, BaseProvider] = {}
        self.model_map: dict[str, list[str]] = {}
        self.aliases: dict[str, str] = {}
        self.strategy = STRATEGY_ROUND_ROBIN
        self.fallback_enabled = True
        self._rr_indices: dict[str, int] = {}

    def register(self, provider: BaseProvider):
        self.providers[provider.name] = provider
        for m in provider.config.model_list:
            self.model_map.setdefault(m, []).append(provider.name)

    def unregister(self, provider_name: str):
        provider = self.providers.pop(provider_name, None)
        if not provider:
            return
        for m in provider.config.model_list:
            if m in self.model_map:
                self.model_map[m] = [p for p in self.model_map[m] if p != provider_name]
                if not self.model_map[m]:
                    del self.model_map[m]
        log = logging.getLogger("jeumpa.router")
        log.info(f"Unregistered provider: {provider_name}")

    def add_alias(self, alias: str, target_model: str):
        self.aliases[alias] = target_model

    def _resolve_model(self, model: str) -> str:
        return self.aliases.get(model, model)

    def _get_candidates(self, model: str) -> list[BaseProvider]:
        resolved = self._resolve_model(model)
        target_provider = None
        target_model = resolved
        if "/" in resolved:
            parts = resolved.split("/", 1)
            if parts[0] in self.providers:
                target_provider = parts[0]
                target_model = parts[1]
        candidates = []
        for pname, p in self.providers.items():
            if target_provider and pname != target_provider:
                continue
            model_match = (not target_model or target_model == "any" or
                          target_model in p.config.model_list or "*" in p.config.model_list)
            if not model_match:
                continue
            if not p.can_attempt():
                continue
            if p.status == ProviderStatus.RATE_LIMITED:
                continue
            if p.status == ProviderStatus.OFFLINE and p.failed_requests > 3:
                continue
            if p.cooldown_until >= time.time():
                continue
            exact = resolved in p.config.model_list
            candidates.append((exact, p))
        candidates.sort(key=lambda x: (not x[0], x[1].status == ProviderStatus.OFFLINE, x[1].config.priority))
        return [c[1] for c in candidates]

    def _select_rr(self, candidates: list, model_key: str = "", exact: list = None) -> Optional[BaseProvider]:
        if not candidates:
            return None
        pool = exact if exact else candidates
        idx = self._rr_indices.get(model_key, 0) % len(pool)
        self._rr_indices[model_key] = (idx + 1) % len(pool)
        return pool[idx]

    def _select_latency(self, candidates: list) -> Optional[BaseProvider]:
        if not candidates:
            return None
        return min(candidates, key=lambda p: p.latency_ms if p.latency_ms > 0 else 99999)

    def _select_priority(self, candidates: list) -> Optional[BaseProvider]:
        return candidates[0] if candidates else None

    def _select_random(self, candidates: list) -> Optional[BaseProvider]:
        return random.choice(candidates) if candidates else None

    def _split_exact(self, candidates: list, model: str) -> tuple[list, list]:
        check = model.split("/", 1)[-1] if "/" in model else model
        exact = [p for p in candidates if check in p.config.model_list or model in p.config.model_list]
        wild = [p for p in candidates if check not in p.config.model_list and model not in p.config.model_list and "*" in p.config.model_list]
        return exact, wild

    def select(self, model: str = None, strategy: str = None) -> Optional[BaseProvider]:
        strategy = strategy or self.strategy
        candidates = self._get_candidates(model)
        resolved = self._resolve_model(model or "")
        exact, wild = self._split_exact(candidates, resolved)
        pool = exact if exact else candidates
        if strategy == STRATEGY_ROUND_ROBIN:
            return self._select_rr(pool, resolved, exact)
        selectors = {
            STRATEGY_PRIORITY: self._select_priority,
            STRATEGY_RANDOM: self._select_random,
            STRATEGY_LATENCY: self._select_latency,
        }
        selector = selectors.get(strategy, lambda c: c[0] if c else None)
        return selector(pool)

    def _strip_provider(self, model: str, provider_name: str) -> str:
        if "/" in model:
            prefix = model.split("/", 1)[0]
            if prefix == provider_name:
                return model.split("/", 1)[1]
        return model

    async def chat_completion(self, messages: list, model: str = None,
                              stream: bool = False, strategy: str = None,
                              max_fallbacks: int = 3, **kwargs) -> dict:
        provider = self.select(model, strategy)
        if not provider:
            return {"error": "no_provider_available", "status": 503}
        used_providers = [provider.name]
        actual_model = self._strip_provider(model or "", provider.name)
        result = await provider.chat_completion(messages, model=actual_model, stream=stream, **kwargs)
        if isinstance(result, dict) and "error" in result and self.fallback_enabled:
            for attempt in range(max_fallbacks):
                provider.status = ProviderStatus.DEGRADED
                provider = self.select(model, strategy)
                if not provider or provider.name in used_providers:
                    break
                used_providers.append(provider.name)
                actual_model = self._strip_provider(model or "", provider.name)
                result = await provider.chat_completion(messages, model=actual_model, stream=stream, **kwargs)
                if isinstance(result, dict) and "error" not in result:
                    break
                if hasattr(result, '__aiter__'):
                    break
            else:
                return {"error": "all_providers_failed", "used": used_providers, "status": 503}
        if isinstance(result, dict) and "error" not in result:
            result["_provider"] = provider.name
            result["_model"] = model or provider.config.model_list[0] if provider.config.model_list else "unknown"
        return result

    def auto_register_from_probe(self, name: str, base_url: str, models: list, priority: int = 10):
        from providers.base import ProviderConfig, ProviderStatus
        from providers.openai_compat import OpenAICompatibleProvider
        if name in self.providers:
            if models:
                self.update_models(name, models)
            return
        cfg = ProviderConfig(name=name, type="openai_compat",
                             base_url=base_url, api_key="",
                             models=models if models else ["*"],
                             priority=priority)
        prov = OpenAICompatibleProvider(cfg)
        prov.status = ProviderStatus.ONLINE
        self.register(prov)
        log = logging.getLogger("jeumpa.router")
        log.info(f"Auto-registered: {name} ({len(models)} models, priority {priority})")
        return prov

    def auto_prune_offline(self, max_age: int = 86400):
        now = time.time()
        pruned = []
        for pname, provider in list(self.providers.items()):
            if provider.status == ProviderStatus.OFFLINE:
                if provider.last_used and (now - provider.last_used) > max_age:
                    self.unregister(pname)
                    pruned.append(pname)
        if pruned:
            log = logging.getLogger("jeumpa.router")
            log.info(f"Pruned {len(pruned)} offline providers: {pruned}")
        return pruned

    def update_models(self, provider_name: str, new_models: list):
        provider = self.providers.get(provider_name)
        if not provider:
            return
        old_list = provider.config.model_list[:]
        old_set = set(old_list)
        clean = [m for m in new_models if m != "*"]
        new = []
        for m in clean:
            if m not in new:
                new.append(m)
        new_set = set(new)
        added = new_set - old_set
        removed = old_set - new_set
        for m in removed:
            if m in self.model_map:
                self.model_map[m] = [p for p in self.model_map[m] if p != provider_name]
                if not self.model_map[m]:
                    del self.model_map[m]
        for m in added:
            self.model_map.setdefault(m, []).append(provider_name)
        provider.config.model_list = new if new else new_models
        import logging
        log = logging.getLogger("jeumpa.router")
        log.info(f"update_models {provider_name}: {len(old_list)}->{len(new)} models, +{len(added)}/-{len(removed)} net={len(new)-len(old_list)}, mmap={len(self.model_map)}")

    def status_all(self) -> dict:
        return {n: p.to_dict() for n, p in self.providers.items()}


# ─── Extra API Routes ──────────────────────────────────────────────────────────
# Request log ring buffer
_request_log: list[dict] = []
MAX_REQUEST_LOG = 500

# Graph knowledge base (SQLite-backed)
from graph_kb import KnowledgeGraph
_graph_kb: KnowledgeGraph | None = None

def get_graph_kb() -> KnowledgeGraph:
    global _graph_kb
    if _graph_kb is None:
        _graph_kb = KnowledgeGraph()
    return _graph_kb

# Pricing table for cost estimation
COST_TABLE = {
    "gpt-4o": {"input": 2.50, "output": 10.00},
    "gpt-4o-mini": {"input": 0.15, "output": 0.60},
    "gpt-4-turbo": {"input": 10.00, "output": 30.00},
    "claude-3-5-sonnet": {"input": 3.00, "output": 15.00},
    "claude-3-haiku": {"input": 0.25, "output": 1.25},
    "claude-opus-4-5": {"input": 15.00, "output": 75.00},
    "gemini-2.0-flash": {"input": 0.10, "output": 0.40},
    "gemini-2.5-pro": {"input": 1.25, "output": 10.00},
    "deepseek-chat": {"input": 0.14, "output": 0.28},
    "deepseek-r1": {"input": 0.55, "output": 2.19},
    "llama-3.3-70b": {"input": 0.59, "output": 0.79},
    "grok-3": {"input": 3.00, "output": 15.00},
}

log_extra = logging.getLogger("jeumpa.extra")


# ── RAG Endpoints ──────────────────────────────────────────────────────────────

async def handle_rag_ingest(request):
    try:
        from rag import get_engine
        body = await request.json()
    except Exception:
        return web.json_response({"error": "invalid_json", "status": 400}, status=400)
    text = body.get("text") or body.get("content")
    if not text:
        return web.json_response({"error": "text required", "status": 400}, status=400)
    try:
        metadata = body.get("metadata", {})
        ids = await get_engine().ingest(text, metadata)
        return web.json_response({"ids": ids, "count": len(ids)}, status=201)
    except Exception as e:
        log_extra.exception("RAG ingest error")
        return web.json_response({"error": str(e), "status": 500}, status=500)


async def handle_rag_query(request):
    try:
        from rag import get_engine
        body = await request.json()
    except Exception:
        return web.json_response({"error": "invalid_json", "status": 400}, status=400)
    query_text = body.get("query") or body.get("text")
    if not query_text:
        return web.json_response({"error": "query required", "status": 400}, status=400)
    try:
        limit = int(body.get("limit", 5))
        results = await get_engine().query(query_text, limit=limit)
        return web.json_response({"results": results})
    except Exception as e:
        log_extra.exception("RAG query error")
        return web.json_response({"error": str(e), "status": 500}, status=500)


async def handle_rag_list_documents(request):
    try:
        from rag import get_engine
        limit = int(request.query.get("limit", "50"))
        offset = int(request.query.get("offset", "0"))
        docs = get_engine().list_documents(limit=min(limit, 200), offset=offset)
        return web.json_response({"documents": docs})
    except Exception as e:
        log_extra.exception("RAG list error")
        return web.json_response({"error": str(e), "status": 500}, status=500)


async def handle_rag_delete_document(request):
    doc_id_str = request.match_info.get("id")
    if not doc_id_str:
        return web.json_response({"error": "id required", "status": 400}, status=400)
    try:
        from rag import get_engine
        doc_id = int(doc_id_str)
        ok = get_engine().delete_document(doc_id)
        if not ok:
            return web.json_response({"error": "document not found", "status": 404}, status=404)
        return web.json_response({"status": "deleted", "id": doc_id})
    except Exception as e:
        log_extra.exception("RAG delete error")
        return web.json_response({"error": str(e), "status": 500}, status=500)


# ── Circuit Breaker ────────────────────────────────────────────────────────────

async def handle_circuit_breakers(request):
    try:
        from circuit_breaker import get_registry
        states = get_registry().get_all_states()
        return web.json_response({"circuit_breakers": states})
    except Exception as e:
        log_extra.exception("Circuit breaker error")
        return web.json_response({"error": str(e), "status": 500}, status=500)


# ── Cost Estimation ────────────────────────────────────────────────────────────

async def handle_cost_estimate(request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "invalid_json", "status": 400}, status=400)
    model = body.get("model", "")
    tokens_in = int(body.get("tokens_in", 0))
    tokens_out = int(body.get("tokens_out", 0))
    if model in COST_TABLE:
        rates = COST_TABLE[model]
        cost = (tokens_in / 1000) * rates["input"] + (tokens_out / 1000) * rates["output"]
        return web.json_response({
            "model": model,
            "tokens_in": tokens_in,
            "tokens_out": tokens_out,
            "cost_usd": round(cost, 6),
            "input_rate": rates["input"],
            "output_rate": rates["output"],
        })
    return web.json_response({
        "model": model,
        "tokens_in": tokens_in,
        "tokens_out": tokens_out,
        "cost_usd": 0,
        "note": "Unknown model — no pricing data",
    })


# ── Request Logs (ring buffer) ────────────────────────────────────────────────

async def handle_logs(request):
    page = max(1, int(request.query.get("page", "1")))
    limit = max(1, min(200, int(request.query.get("limit", "50"))))
    start = (page - 1) * limit
    entries = list(reversed(_request_log))
    total = len(entries)
    paged = entries[start:start + limit]
    return web.json_response({
        "logs": paged,
        "page": page,
        "limit": limit,
        "total": total,
        "pages": (total + limit - 1) // limit if total else 0,
    })


# ── Anthropic Compat ───────────────────────────────────────────────────────────

async def handle_anthropic_messages(request):
    app = request.app.get("jeumpa_app") or request.config_dict.get("jeumpa_app")
    if not app:
        return web.json_response({"error": "server_not_ready", "status": 503}, status=503)
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "invalid_json", "status": 400}, status=400)

    stream = body.get("stream", False)
    model = body.get("model", "auto")
    resolved_model = app.resolve_model(model)

    async def provider_chat(messages, model, stream=False):
        try:
            result = await asyncio.wait_for(
                app.router.chat_completion(messages, model=model, stream=stream),
                timeout=app.tasks.get_timeout("default" if not model else model),
            )
            return result
        except asyncio.TimeoutError:
            return {"error": "request_timeout", "status": 504}

    if stream:
        resp = web.StreamResponse(status=200, headers={
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        })
        await resp.prepare(request)

        async def provider_stream(messages, model, stream=True):
            return await app.router.chat_completion(messages, model=model, stream=True)

        try:
            async for sse_event in Handler.handle_streaming_messages(body, provider_stream):
                if sse_event:
                    await resp.write(sse_event.encode())
        except (ConnectionResetError, ConnectionAbortedError):
            pass
        return resp

    try:
        anth_response = await Handler.handle_messages(body, provider_chat)
    except RuntimeError as e:
        return web.json_response({"error": str(e), "status": 502}, status=502)

    anth_response.model = resolved_model
    return web.json_response(anth_response.to_dict())


# ── Graph Knowledge Base ───────────────────────────────────────────────────────

async def handle_graph_create_entity(request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "invalid_json", "status": 400}, status=400)
    name = body.get("name")
    if not name:
        return web.json_response({"error": "name required", "status": 400}, status=400)
    kb = get_graph_kb()
    entity = kb.create_entity(name, body.get("type", "concept"), body.get("properties"))
    return web.json_response({
        "id": entity.id, "name": entity.name, "type": entity.type,
        "properties": entity.properties, "created_at": entity.created_at,
    }, status=201)


async def handle_graph_get_entity(request):
    entity_id = request.match_info.get("id")
    kb = get_graph_kb()
    entity = kb.get_entity(entity_id)
    if not entity:
        return web.json_response({"error": "Entity not found", "status": 404}, status=404)
    return web.json_response({
        "id": entity.id, "name": entity.name, "type": entity.type,
        "properties": entity.properties, "created_at": entity.created_at,
    })


async def handle_graph_list_entities(request):
    kb = get_graph_kb()
    q = request.query.get("q", "").strip()
    type_filter = request.query.get("type", "").strip() or None
    limit = int(request.query.get("limit", "50"))
    offset = int(request.query.get("offset", "0"))
    if q:
        results = kb.list_entities(search=q, limit=min(limit, 200), offset=offset)
    else:
        results = kb.list_entities(type_filter=type_filter, limit=min(limit, 200), offset=offset)
    return web.json_response({
        "results": [{
            "id": e.id, "name": e.name, "type": e.type,
            "properties": e.properties, "created_at": e.created_at,
        } for e in results]
    })


async def handle_graph_update_entity(request):
    entity_id = request.match_info.get("id")
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "invalid_json", "status": 400}, status=400)
    kb = get_graph_kb()
    entity = kb.update_entity(entity_id, body.get("properties"))
    if not entity:
        return web.json_response({"error": "Entity not found", "status": 404}, status=404)
    return web.json_response({
        "id": entity.id, "name": entity.name, "type": entity.type,
        "properties": entity.properties, "created_at": entity.created_at,
    })


async def handle_graph_delete_entity(request):
    entity_id = request.match_info.get("id")
    kb = get_graph_kb()
    ok = kb.delete_entity(entity_id)
    if not ok:
        return web.json_response({"error": "Entity not found", "status": 404}, status=404)
    return web.json_response({"status": "deleted", "id": entity_id})


async def handle_graph_create_relation(request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "invalid_json", "status": 400}, status=400)
    source_id = body.get("source_id")
    target_id = body.get("target_id")
    relation_type = body.get("relation_type")
    if not source_id or not target_id or not relation_type:
        return web.json_response(
            {"error": "source_id, target_id, relation_type required", "status": 400}, status=400)
    kb = get_graph_kb()
    rel = kb.create_relation(source_id, target_id, relation_type,
                             body.get("properties"), body.get("weight", 1.0))
    return web.json_response({
        "id": rel.id, "source_id": rel.source_id, "target_id": rel.target_id,
        "relation_type": rel.relation_type, "properties": rel.properties,
        "weight": rel.weight, "created_at": rel.created_at,
    }, status=201)


async def handle_graph_get_relations(request):
    entity_id = request.match_info.get("id")
    kb = get_graph_kb()
    relations = kb.get_relations(entity_id)
    return web.json_response({"relations": relations})


async def handle_graph_extract(request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "invalid_json", "status": 400}, status=400)
    text = body.get("text")
    if not text:
        return web.json_response({"error": "text required", "status": 400}, status=400)
    source = body.get("source")
    kb = get_graph_kb()
    extracted = kb.extract_entities(text)
    entities = []
    for name, etype in extracted:
        entity = kb.create_entity(name, etype, {"source": source} if source else None)
        entities.append({
            "id": entity.id, "name": entity.name, "type": entity.type,
        })
    for i in range(1, len(entities)):
        kb.create_relation(entities[i - 1]["id"], entities[i]["id"],
                           "co_occurs", {"source": source} if source else None)
    return web.json_response({"entities": entities, "count": len(entities)}, status=201)


async def handle_graph_search(request):
    q = request.query.get("q", "").strip()
    if not q:
        return web.json_response({"error": "query param q required", "status": 400}, status=400)
    kb = get_graph_kb()
    results = kb.search(q)
    return web.json_response({
        "results": [{
            "entity": {
                "id": e.id, "name": e.name, "type": e.type,
                "properties": e.properties, "created_at": e.created_at,
            },
            "score": s,
        } for e, s in results]
    })


async def handle_graph_stats(request):
    kb = get_graph_kb()
    return web.json_response(kb.get_stats())


async def handle_graph_clear(request):
    kb = get_graph_kb()
    kb.clear()
    return web.json_response({"message": "Graph cleared"})


# ── A2A Protocol ────────────────────────────────────────────────────────────────

a2a_server = A2AServer()

async def handle_agent_card(request):
    agents = a2a_server.card_manager.list_agents()
    if agents:
        return web.json_response(agents[0].to_well_known())
    app = request.app.get("jeumpa_app") or request.config_dict.get("jeumpa_app")
    provider_count = len(app.router.providers) if app and hasattr(app, "router") else 0
    model_count = len(app.router.model_map) if app and hasattr(app, "router") else 0
    fallback = AgentCard(
        name="JeumpaLLM",
        description="Multi-provider LLM gateway with agent capabilities",
        version="2.0.0",
        url=f"{a2a_server.base_url}/a2a/jeumpa-llm",
        capabilities=AgentCapabilities(streaming=True, pushNotifications=False, stateTransitionHistory=True),
        skills=[
            AgentSkill(id="chat", name="Chat Completion", description="Multi-provider chat", tags=["llm", "chat"]),
            AgentSkill(id="rag", name="RAG Query", description="Retrieval-augmented generation", tags=["rag", "search"]),
        ],
    )
    return web.json_response(fallback.to_well_known())


async def handle_a2a_list_agents(request):
    agents = a2a_server.card_manager.discover()
    return web.json_response({"agents": agents})


async def handle_a2a_agent_card(request):
    agent_name = request.match_info.get("agent")
    card = a2a_server.card_manager.get_card(agent_name)
    if not card:
        return web.json_response({"error": "Agent not found", "status": 404}, status=404)
    return web.json_response(card.to_well_known())


async def handle_a2a_submit_task(request):
    agent_name = request.match_info.get("agent")
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "invalid_json", "status": 400}, status=400)
    try:
        result = await a2a_server.handle_request(agent_name, body)
        if "error" in result and result.get("status") == 404:
            return web.json_response(result, status=404)
        return web.json_response(result)
    except Exception as e:
        log_extra.exception("A2A task error")
        return web.json_response({"error": str(e), "status": 500}, status=500)


async def handle_a2a_get_task(request):
    task_id = request.match_info.get("task_id")
    task = a2a_server.task_manager.get_task(task_id)
    if not task:
        return web.json_response({"error": "Task not found", "status": 404}, status=404)
    return web.json_response(task.to_dict())


async def handle_a2a_list_tasks(request):
    status_filter = request.query.get("status")
    tasks = a2a_server.task_manager.list_tasks()
    if status_filter:
        tasks = [t for t in tasks if t.status.value == status_filter]
    return web.json_response({"tasks": [t.to_dict() for t in tasks]})


# ── Agent Marketplace ──────────────────────────────────────────────────────────

_marketplace = MarketplaceRegistry()


async def handle_marketplace_search(request):
    q = request.query.get("q", "")
    category = request.query.get("category")
    sort = request.query.get("sort", "downloads")
    limit = int(request.query.get("limit", "20"))
    results = _marketplace.search(query=q, category=category, sort=sort, limit=limit)
    return web.json_response({"results": results})


async def handle_marketplace_packages(request):
    category = request.query.get("category")
    if category:
        pkgs = _marketplace.search(category=category)
    else:
        pkgs = _marketplace.get_popular(100)
    return web.json_response({"packages": pkgs})


async def handle_marketplace_popular(request):
    return web.json_response({"packages": _marketplace.get_popular()})


async def handle_marketplace_featured(request):
    return web.json_response({"packages": _marketplace.get_featured()})


async def handle_marketplace_categories(request):
    return web.json_response({"categories": _marketplace.get_categories()})


# ── Logging Middleware ─────────────────────────────────────────────────────────

async def log_request_middleware(request, handler):
    start = time.time()
    response = None
    try:
        response = await handler(request)
        return response
    finally:
        elapsed = time.time() - start
        status = response.status if response else 500
        entry = {
            "method": request.method,
            "path": str(request.rel_url),
            "status": status,
            "elapsed_ms": round(elapsed * 1000, 2),
            "time": time.time(),
            "remote": request.remote or "",
        }
        _request_log.append(entry)
        if len(_request_log) > MAX_REQUEST_LOG:
            _request_log[:len(_request_log) - MAX_REQUEST_LOG] = []


# ── Analytics Endpoints ──────────────────────────────────────────────────────

async def handle_analytics_overview(request):
    if not HAS_ANALYTICS:
        return web.json_response({"error": "analytics module not available", "status": 501}, status=501)
    try:
        hours = int(request.query.get("hours", "24"))
        overview = get_analytics_overview(_tracer, hours)
        return web.json_response(overview)
    except Exception as e:
        log_extra.exception("Analytics overview error")
        return web.json_response({"error": str(e), "status": 500}, status=500)


async def handle_provider_ranking(request):
    if not HAS_ANALYTICS:
        return web.json_response({"error": "analytics module not available", "status": 501}, status=501)
    try:
        ranking = get_provider_ranking(_tracer)
        return web.json_response({"ranking": ranking})
    except Exception as e:
        log_extra.exception("Provider ranking error")
        return web.json_response({"error": str(e), "status": 500}, status=500)


async def handle_model_popularity(request):
    if not HAS_ANALYTICS:
        return web.json_response({"error": "analytics module not available", "status": 501}, status=501)
    try:
        popularity = get_model_popularity(_tracer)
        return web.json_response({"popularity": popularity})
    except Exception as e:
        log_extra.exception("Model popularity error")
        return web.json_response({"error": str(e), "status": 500}, status=500)


# ── Tracing Endpoints ────────────────────────────────────────────────────────

async def handle_tracing_spans(request):
    if not HAS_ANALYTICS:
        return web.json_response({"error": "tracing module not available", "status": 501}, status=501)
    try:
        limit = int(request.query.get("limit", "50"))
        span_type = request.query.get("type")
        filters = {}
        if span_type:
            filters["span_type"] = span_type
        spans = _tracer.get_spans(filters)[:limit]
        return web.json_response({
            "spans": [{
                "id": s.id, "trace_id": s.trace_id, "name": s.name,
                "span_type": s.span_type, "status": s.status.value,
                "start_time": s.start_time, "duration_ms": s.duration_ms,
                "service": s.service, "error": s.error,
            } for s in spans]
        })
    except Exception as e:
        log_extra.exception("Tracing spans error")
        return web.json_response({"error": str(e), "status": 500}, status=500)


async def handle_tracing_trace(request):
    if not HAS_ANALYTICS:
        return web.json_response({"error": "tracing module not available", "status": 501}, status=501)
    trace_id = request.match_info.get("trace_id")
    try:
        spans = _tracer.get_trace(trace_id)
        if not spans:
            return web.json_response({"error": "trace not found", "status": 404}, status=404)
        return web.json_response({
            "trace_id": trace_id,
            "spans": [{
                "id": s.id, "name": s.name, "parent_id": s.parent_id,
                "span_type": s.span_type, "status": s.status.value,
                "start_time": s.start_time, "end_time": s.end_time,
                "duration_ms": s.duration_ms, "service": s.service,
                "error": s.error, "metadata": s.metadata,
            } for s in spans]
        })
    except Exception as e:
        log_extra.exception("Tracing trace error")
        return web.json_response({"error": str(e), "status": 500}, status=500)


async def handle_tracing_stats(request):
    if not HAS_ANALYTICS:
        return web.json_response({"error": "tracing module not available", "status": 501}, status=501)
    try:
        hours = int(request.query.get("hours", "24"))
        cutoff = time.time() - hours * 3600
        stats = _tracer.get_stats(time_range=(cutoff, time.time()))
        return web.json_response(stats)
    except Exception as e:
        log_extra.exception("Tracing stats error")
        return web.json_response({"error": str(e), "status": 500}, status=500)


# ── Orchestration Endpoints ──────────────────────────────────────────────────

async def handle_workflows_list(request):
    if not HAS_ORCHESTRATION:
        return web.json_response({"error": "orchestration module not available", "status": 501}, status=501)
    try:
        workflows = _workflow_registry.list()
        return web.json_response({"workflows": workflows})
    except Exception as e:
        log_extra.exception("Workflows list error")
        return web.json_response({"error": str(e), "status": 500}, status=500)


async def handle_workflow_create(request):
    if not HAS_ORCHESTRATION:
        return web.json_response({"error": "orchestration module not available", "status": 501}, status=501)
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "invalid_json", "status": 400}, status=400)
    try:
        name = body.get("name", "Untitled")
        description = body.get("description", "")
        from orchestration import NodeConfig, Edge, NodeType
        nodes = [NodeConfig(**n) for n in body.get("nodes", [])]
        edges = [Edge(**e) for e in body.get("edges", [])]
        graph = _engine.create_graph(
            name=name, nodes=nodes, edges=edges,
            entry_node=body.get("entry_node"),
            description=description,
        )
        _workflow_registry.register(graph)
        return web.json_response(graph.to_dict(), status=201)
    except Exception as e:
        log_extra.exception("Workflow create error")
        return web.json_response({"error": str(e), "status": 500}, status=500)


async def handle_workflow_get(request):
    if not HAS_ORCHESTRATION:
        return web.json_response({"error": "orchestration module not available", "status": 501}, status=501)
    workflow_id = request.match_info.get("id")
    graph = _workflow_registry.get(workflow_id)
    if not graph:
        return web.json_response({"error": "workflow not found", "status": 404}, status=404)
    return web.json_response(graph.to_dict())


async def handle_workflow_execute(request):
    if not HAS_ORCHESTRATION:
        return web.json_response({"error": "orchestration module not available", "status": 501}, status=501)
    workflow_id = request.match_info.get("id")
    graph = _workflow_registry.get(workflow_id)
    if not graph:
        return web.json_response({"error": "workflow not found", "status": 404}, status=404)
    try:
        body = await request.json() if request.can_read_body else {}
    except Exception:
        body = {}
    try:
        results = []
        async for event in _engine.execute_graph(graph, initial_input=body.get("input")):
            results.append(event)
        return web.json_response({"execution": results})
    except Exception as e:
        log_extra.exception("Workflow execute error")
        return web.json_response({"error": str(e), "status": 500}, status=500)


async def handle_workflow_execution_status(request):
    # Placeholder — full execution tracking would use a proper store
    execution_id = request.match_info.get("id")
    return web.json_response({
        "execution_id": execution_id,
        "status": "completed",
        "note": "Execution status tracking coming soon",
    })


# ── Tool Execution Endpoints (built-in tools) ───────────────────────────────

AVAILABLE_TOOLS = [
    {"name": "rag_query", "description": "Query the RAG knowledge base", "parameters": {"query": "string", "limit": "integer"}},
    {"name": "rag_ingest", "description": "Ingest text into RAG", "parameters": {"text": "string", "metadata": "object"}},
    {"name": "cost_estimate", "description": "Estimate LLM API cost", "parameters": {"model": "string", "tokens_in": "integer", "tokens_out": "integer"}},
    {"name": "circuit_breaker_status", "description": "Get circuit breaker status for all providers", "parameters": {}},
    {"name": "graph_query", "description": "Query knowledge graph entities", "parameters": {"query": "string"}},
    {"name": "list_models", "description": "List all available models", "parameters": {}},
    {"name": "health_check", "description": "Check system health", "parameters": {}},
]


async def handle_tools_list(request):
    return web.json_response({"tools": AVAILABLE_TOOLS})


async def handle_tool_execute(request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "invalid_json", "status": 400}, status=400)
    tool_name = body.get("name", "")
    tool_args = body.get("arguments", {})
    tool = next((t for t in AVAILABLE_TOOLS if t["name"] == tool_name), None)
    if not tool:
        return web.json_response({"error": f"unknown tool: {tool_name}", "status": 404}, status=404)
    try:
        if tool_name == "rag_query":
            from rag import get_engine
            results = await get_engine().query(tool_args.get("query", ""), limit=int(tool_args.get("limit", 5)))
            return web.json_response({"result": results})
        elif tool_name == "rag_ingest":
            from rag import get_engine
            ids = await get_engine().ingest(tool_args.get("text", ""), tool_args.get("metadata", {}))
            return web.json_response({"result": {"ids": ids}})
        elif tool_name == "cost_estimate":
            model = tool_args.get("model", "")
            tokens_in = int(tool_args.get("tokens_in", 0))
            tokens_out = int(tool_args.get("tokens_out", 0))
            cost_data = {}
            if model in COST_TABLE:
                rates = COST_TABLE[model]
                cost = (tokens_in / 1000) * rates["input"] + (tokens_out / 1000) * rates["output"]
                cost_data = {"cost_usd": round(cost, 6)}
            return web.json_response({"result": cost_data})
        elif tool_name == "circuit_breaker_status":
            from circuit_breaker import get_registry
            states = get_registry().get_all_states()
            return web.json_response({"result": states})
        elif tool_name == "graph_query":
            q = tool_args.get("query", "")
            results = get_graph_kb().search(q)
            return web.json_response({"result": [{
                "entity": {"id": e.id, "name": e.name, "type": e.type},
                "score": s,
            } for e, s in results]})
        elif tool_name == "list_models":
            return web.json_response({"result": list(COST_TABLE.keys())})
        elif tool_name == "health_check":
            return web.json_response({"result": {"status": "healthy", "time": time.time()}})
        else:
            return web.json_response({"error": f"tool {tool_name} not implemented", "status": 501}, status=501)
    except Exception as e:
        log_extra.exception(f"Tool {tool_name} execution error")
        return web.json_response({"error": str(e), "status": 500}, status=500)


async def handle_agent_chat(request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "invalid_json", "status": 400}, status=400)
    app = request.app.get("jeumpa_app") or request.config_dict.get("jeumpa_app")
    if not app:
        return web.json_response({"error": "server_not_ready", "status": 503}, status=503)
    messages = body.get("messages", [])
    model = body.get("model", "auto")
    stream = body.get("stream", False)
    tools = body.get("tools", [])
    if tools:
        tool_names = [t.get("name", "") for t in tools if t.get("name")]
        tool_hints = "\n\nAvailable tools: " + ", ".join(tool_names)
        if messages and messages[-1].get("role") == "user":
            messages[-1]["content"] = str(messages[-1].get("content", "")) + tool_hints
    resolved_model = app.resolve_model(model)
    try:
        result = await asyncio.wait_for(
            app.router.chat_completion(messages, model=resolved_model, stream=stream),
            timeout=app.tasks.get_timeout("default" if not model else model),
        )
    except asyncio.TimeoutError:
        return web.json_response({"error": "request_timeout", "status": 504}, status=504)
    if isinstance(result, dict) and result.get("error"):
        return web.json_response(result, status=result.get("status", 500))
    return web.json_response(result)


# ── Enhanced A2A Endpoints ──────────────────────────────────────────────────

async def handle_a2a_register_agent(request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "invalid_json", "status": 400}, status=400)
    name = body.get("name", "")
    if not name:
        return web.json_response({"error": "name required", "status": 400}, status=400)
    agent = AgentCard(
        name=name,
        description=body.get("description", ""),
        version=body.get("version", "1.0.0"),
        capabilities=AgentCapabilities(
            streaming=body.get("capabilities", {}).get("streaming", False),
            pushNotifications=body.get("capabilities", {}).get("pushNotifications", False),
            stateTransitionHistory=body.get("capabilities", {}).get("stateTransitionHistory", False),
        ),
        skills=[AgentSkill(**s) for s in body.get("skills", [])],
    )
    a2a_server.card_manager.register(agent)
    return web.json_response(agent.to_dict(), status=201)


async def handle_a2a_create_task(request):
    agent_name = request.match_info.get("name")
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "invalid_json", "status": 400}, status=400)
    if not agent_name:
        return web.json_response({"error": "agent name required", "status": 400}, status=400)
    session_id = body.get("session_id", "default")
    task = a2a_server.task_manager.create_task(session_id=session_id, input_data=body.get("input", {}))
    a2a_server.task_manager.assign_agent(task.id, agent_name)
    return web.json_response(task.to_dict(), status=201)


async def handle_a2a_get_task_status(request):
    task_id = request.match_info.get("id")
    task = a2a_server.task_manager.get_task(task_id)
    if not task:
        return web.json_response({"error": "Task not found", "status": 404}, status=404)
    return web.json_response(task.to_dict())


# ── Enhanced Marketplace Endpoints ──────────────────────────────────────────

async def handle_marketplace_package_detail(request):
    pkg_id = request.match_info.get("id")
    pkg = _marketplace.get_package(pkg_id)
    if not pkg:
        return web.json_response({"error": "package not found", "status": 404}, status=404)
    return web.json_response(pkg.to_dict())


async def handle_marketplace_register(request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "invalid_json", "status": 400}, status=400)
    from marketplace import Package, Category
    cat = body.get("category", "utility")
    try:
        category = Category(cat)
    except ValueError:
        category = Category.OTHER
    pkg = Package(
        id=body.get("id", str(int(time.time()))),
        name=body.get("name", ""),
        version=body.get("version", "1.0.0"),
        description=body.get("description", ""),
        author=body.get("author", ""),
        category=category,
        created_at=time.time(),
    )
    _marketplace.register_package(pkg)
    return web.json_response(pkg.to_dict(), status=201)


async def handle_marketplace_rate(request):
    pkg_id = request.match_info.get("id")
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "invalid_json", "status": 400}, status=400)
    pkg = _marketplace.rate_package(pkg_id, float(body.get("rating", 5)))
    if not pkg:
        return web.json_response({"error": "package not found", "status": 404}, status=404)
    return web.json_response(pkg.to_dict())


# ── Fugu Multi-Agent Ensemble ──────────────────────────────────────────────────

_fugu = None

def get_fugu() -> FuguMode:
    global _fugu
    return _fugu

async def handle_fugu_ask(request):
    global _fugu
    app = request.app.get("jeumpa_app") or request.config_dict.get("jeumpa_app")
    if not app:
        return web.json_response({"error": "server_not_ready", "status": 503}, status=503)
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "invalid_json", "status": 400}, status=400)
    messages = body.get("messages", [])
    if not messages:
        return web.json_response({"error": "messages required", "status": 400}, status=400)
    if _fugu is None:
        _fugu = FuguMode(app.router)
    try:
        result = await _fugu.ask(
            messages=messages,
            models=body.get("models"),
            strategy=body.get("strategy"),
            timeout=body.get("timeout"),
            return_all=body.get("return_all"),
        )
        if "error" in result:
            return web.json_response(result, status=result.get("status", 500))
        return web.json_response(result)
    except Exception as e:
        log_extra.exception("Fugu ask error")
        return web.json_response({"error": str(e), "status": 500}, status=500)


async def handle_fugu_status(request):
    global _fugu
    app = request.app.get("jeumpa_app") or request.config_dict.get("jeumpa_app")
    if not app:
        return web.json_response({"error": "server_not_ready", "status": 503}, status=503)
    if _fugu is None:
        _fugu = FuguMode(app.router)
    return web.json_response(_fugu.get_status())


async def handle_fugu_config(request):
    global _fugu
    app = request.app.get("jeumpa_app") or request.config_dict.get("jeumpa_app")
    if not app:
        return web.json_response({"error": "server_not_ready", "status": 503}, status=503)
    if _fugu is None:
        _fugu = FuguMode(app.router)
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "invalid_json", "status": 400}, status=400)
    try:
        config = _fugu.update_config(body)
        return web.json_response({"config": config})
    except Exception as e:
        return web.json_response({"error": str(e), "status": 400}, status=400)


def setup_extra_routes(wapp, jeumpa_app):
    wapp["jeumpa_app"] = jeumpa_app

    # RAG
    wapp.router.add_post("/v1/rag/ingest", handle_rag_ingest)
    wapp.router.add_post("/v1/rag/query", handle_rag_query)
    wapp.router.add_get("/v1/rag/documents", handle_rag_list_documents)
    wapp.router.add_delete("/v1/rag/documents/{id}", handle_rag_delete_document)

    # Circuit breaker
    wapp.router.add_get("/circuit-breakers", handle_circuit_breakers)

    # Cost estimation
    wapp.router.add_post("/v1/cost-estimate", handle_cost_estimate)

    # Logs
    wapp.router.add_get("/v1/logs", handle_logs)

    # Anthropic compat
    wapp.router.add_post("/v1/messages", handle_anthropic_messages)

    # Graph knowledge base
    wapp.router.add_post("/v1/graph/entities", handle_graph_create_entity)
    wapp.router.add_get("/v1/graph/entities", handle_graph_list_entities)
    wapp.router.add_get("/v1/graph/entities/{id}", handle_graph_get_entity)
    wapp.router.add_patch("/v1/graph/entities/{id}", handle_graph_update_entity)
    wapp.router.add_delete("/v1/graph/entities/{id}", handle_graph_delete_entity)
    wapp.router.add_post("/v1/graph/relations", handle_graph_create_relation)
    wapp.router.add_get("/v1/graph/entities/{id}/relations", handle_graph_get_relations)
    wapp.router.add_post("/v1/graph/extract", handle_graph_extract)
    wapp.router.add_get("/v1/graph/search", handle_graph_search)
    wapp.router.add_get("/v1/graph/stats", handle_graph_stats)
    wapp.router.add_post("/v1/graph/clear", handle_graph_clear)

    # A2A agent card
    wapp.router.add_get("/.well-known/agent.json", handle_agent_card)

    # A2A protocol
    wapp.router.add_get("/a2a/agents", handle_a2a_list_agents)
    wapp.router.add_get("/a2a/{agent}", handle_a2a_agent_card)
    wapp.router.add_post("/a2a/{agent}/tasks", handle_a2a_submit_task)
    wapp.router.add_get("/a2a/tasks/{task_id}", handle_a2a_get_task)
    wapp.router.add_get("/a2a/tasks", handle_a2a_list_tasks)

    # Register default A2A agent that proxies to jeumpa's router
    async def _a2a_chat_handler(message, task):
        app = wapp.get("jeumpa_app")
        if not app or not hasattr(app, "router"):
            return {"output": "Server not ready"}
        messages = [{"role": "user", "content": message}] if message else []
        result = await app.router.chat_completion(messages)
        if isinstance(result, dict) and "error" not in result:
            choices = result.get("choices", [{}])
            content = choices[0].get("message", {}).get("content", "") if choices else ""
            return {"output": content}
        return {"output": str(result)}

    a2a_server.register_default_agent(handler=_a2a_chat_handler)

    # Agent marketplace
    wapp.router.add_get("/marketplace/search", handle_marketplace_search)
    wapp.router.add_get("/marketplace/packages", handle_marketplace_packages)
    wapp.router.add_get("/marketplace/packages/{id}", handle_marketplace_package_detail)
    wapp.router.add_get("/marketplace/popular", handle_marketplace_popular)
    wapp.router.add_get("/marketplace/featured", handle_marketplace_featured)
    wapp.router.add_get("/marketplace/categories", handle_marketplace_categories)
    wapp.router.add_post("/marketplace/packages", handle_marketplace_register)
    wapp.router.add_post("/marketplace/packages/{id}/rate", handle_marketplace_rate)

    # Enhanced A2A
    wapp.router.add_post("/a2a/agents", handle_a2a_register_agent)
    wapp.router.add_post("/a2a/{name}/tasks", handle_a2a_create_task)
    wapp.router.add_get("/a2a/tasks/{id}", handle_a2a_get_task_status)

    # Analytics
    wapp.router.add_get("/v1/analytics/overview", handle_analytics_overview)
    wapp.router.add_get("/v1/analytics/provider-ranking", handle_provider_ranking)
    wapp.router.add_get("/v1/analytics/model-popularity", handle_model_popularity)

    # Tracing
    wapp.router.add_get("/v1/tracing/spans", handle_tracing_spans)
    wapp.router.add_get("/v1/tracing/trace/{trace_id}", handle_tracing_trace)
    wapp.router.add_get("/v1/tracing/stats", handle_tracing_stats)

    # Tools
    wapp.router.add_get("/v1/tools", handle_tools_list)
    wapp.router.add_post("/v1/tools/execute", handle_tool_execute)
    wapp.router.add_post("/v1/agent/chat", handle_agent_chat)

    # Orchestration / Workflows
    wapp.router.add_get("/v1/workflows", handle_workflows_list)
    wapp.router.add_post("/v1/workflows", handle_workflow_create)
    wapp.router.add_get("/v1/workflows/{id}", handle_workflow_get)
    wapp.router.add_post("/v1/workflows/{id}/execute", handle_workflow_execute)
    wapp.router.add_get("/v1/workflows/executions/{id}", handle_workflow_execution_status)

    # Fugu multi-agent ensemble
    wapp.router.add_post("/v1/fugu/ask", handle_fugu_ask)
    wapp.router.add_get("/v1/fugu/status", handle_fugu_status)
    wapp.router.add_post("/v1/fugu/config", handle_fugu_config)

    # Acehnese language module
    if HAS_ACEH:
        setup_aceh_routes(wapp)

    # Acehnese auto-detect middleware — injects glossary into chat system prompt
    @web.middleware
    async def aceh_enrich_middleware(request, handler):
        if request.method == "POST" and "/v1/chat/" in request.path:
            try:
                body = await request.json()
                messages = body.get("messages", [])
                if messages and any(m.get("content") for m in messages):
                    all_text = " ".join(m.get("content", "") for m in messages if isinstance(m.get("content"), str))
                    if all_text and detect_aceh(all_text) >= 0.15:
                        enrich = await enrich_prompt(messages)
                        if enrich.get("glossary"):
                            system_msg = next((m for m in messages if m.get("role") == "system"), None)
                            if system_msg:
                                system_msg["content"] += "\n\n" + enrich["enrichment"]
                            else:
                                messages.insert(0, {"role": "system", "content": enrich["enrichment"]})
                            request.data = body
            except (json.JSONDecodeError, Exception):
                pass
        return await handler(request)

    wapp.middlewares.append(aceh_enrich_middleware)

    # Logging middleware
    wapp.middlewares.append(log_request_middleware)

    log_extra.info(f"Extra routes registered ({len(wapp.router.routes())} total)")
