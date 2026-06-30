import os, json, logging, asyncio
from datetime import datetime, timedelta
import httpx
from aiohttp import web
from models import Conversation, Message, MemoryEntry, SharedMemory, get_session

log = logging.getLogger("jeumpa.memory")
JINA_API_KEY = os.environ.get("JINA_API_KEY")
JINA_API_URL = "https://api.jina.ai/v1/embeddings"

def _get_embedding(text: str):
    if not JINA_API_KEY:
        return None
    try:
        import httpx as hx
        resp = hx.post(JINA_API_URL, headers={"Authorization": f"Bearer {JINA_API_KEY}", "Content-Type": "application/json"}, json={"input": text, "model": "jina-embeddings-v2-base-en"}, timeout=30)
        if resp.status_code == 200:
            return resp.json()["data"][0]["embedding"]
    except Exception as ex:
        log.warning("embedding_api_error: %s", ex)
    return None

def _cosine_similarity(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    na = sum(x * x for x in a) ** 0.5
    nb = sum(x * x for x in b) ** 0.5
    if not na or not nb:
        return 0.0
    return dot / (na * nb)

def create_conversation(user_id, title, model, task):
    with get_session() as db:
        conv = Conversation(user_id=user_id, title=title, model=model, task=task)
        db.add(conv)
        db.commit()
        db.refresh(conv)
        return conv

def get_conversation(conversation_id):
    with get_session() as db:
        return db.query(Conversation).filter(Conversation.id == conversation_id).first()

def list_conversations(user_id, limit=50, offset=0):
    with get_session() as db:
        return db.query(Conversation).filter(Conversation.user_id == user_id).order_by(Conversation.updated_at.desc()).offset(offset).limit(limit).all()

def delete_conversation(conversation_id):
    with get_session() as db:
        conv = db.query(Conversation).filter(Conversation.id == conversation_id).first()
        if conv:
            db.delete(conv)
            db.commit()

def add_message(conversation_id, role, content, tokens=0):
    with get_session() as db:
        msg = Message(conversation_id=conversation_id, role=role, content=content, tokens=tokens)
        db.add(msg)
        conv = db.query(Conversation).filter(Conversation.id == conversation_id).first()
        if conv:
            conv.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(msg)
        return msg

def get_messages(conversation_id, limit=100):
    with get_session() as db:
        return db.query(Message).filter(Message.conversation_id == conversation_id).order_by(Message.created_at.asc()).limit(limit).all()

def search_conversations(user_id, query):
    with get_session() as db:
        return db.query(Conversation).filter(Conversation.user_id == user_id, Conversation.title.ilike(f"%{query}%")).order_by(Conversation.updated_at.desc()).all()

def get_usage_stats(user_id, days=30):
    from models import UsageLog
    cutoff = datetime.utcnow() - timedelta(days=days)
    with get_session() as db:
        rows = db.query(UsageLog).filter(UsageLog.user_id == user_id, UsageLog.date >= cutoff.date()).all()
        return {"tokens_in": sum(r.tokens_in for r in rows), "tokens_out": sum(r.tokens_out for r in rows), "requests": sum(r.requests for r in rows), "days": days}

def store_embedding(conversation_id, message_id, text):
    if not JINA_API_KEY:
        return False
    embedding = _get_embedding(text)
    if embedding is None:
        return False
    with get_session() as db:
        entry = MemoryEntry(conversation_id=conversation_id, message_id=message_id, vector=json.dumps(embedding), text_snippet=text[:500])
        db.add(entry)
        db.commit()
    return True

def search_similar(query, limit=5):
    query_vec = _get_embedding(query)
    if query_vec is None:
        return None
    with get_session() as db:
        entries = db.query(MemoryEntry).order_by(MemoryEntry.created_at.desc()).all()
    scored = []
    for entry in entries:
        if not entry.vector:
            continue
        try:
            vec = json.loads(entry.vector)
        except (json.JSONDecodeError, TypeError):
            continue
        sim = _cosine_similarity(query_vec, vec)
        scored.append((sim, entry))
    scored.sort(key=lambda x: x[0], reverse=True)
    return scored[:limit]

def _conversation_to_dict(c):
    return {"id": c.id, "user_id": c.user_id, "title": c.title, "model": c.model, "task": c.task, "created_at": c.created_at.isoformat() if c.created_at else None, "updated_at": c.updated_at.isoformat() if c.updated_at else None}

def _message_to_dict(m):
    return {"id": m.id, "conversation_id": m.conversation_id, "role": m.role, "content": m.content, "tokens": m.tokens, "created_at": m.created_at.isoformat() if m.created_at else None}

def _require_user(request):
    user_id = request.get("user_id")
    if user_id is None:
        raise web.HTTPUnauthorized(text=json.dumps({"error": "authentication_required", "status": 401}), content_type="application/json")
    return user_id

async def handle_list_conversations(request):
    try:
        user_id = _require_user(request)
    except web.HTTPUnauthorized as e:
        return e
    limit = int(request.query.get("limit", "50"))
    offset = int(request.query.get("offset", "0"))
    convs = await asyncio.to_thread(list_conversations, user_id, limit=min(limit, 200), offset=offset)
    return web.json_response({"data": [_conversation_to_dict(c) for c in convs]})

async def handle_create_conversation(request):
    try:
        user_id = _require_user(request)
    except web.HTTPUnauthorized as e:
        return e
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "invalid_json", "status": 400}, status=400)
    title = body.get("title", "New Conversation")
    model = body.get("model", "auto")
    task = body.get("task", "chat")
    conv = await asyncio.to_thread(create_conversation, user_id, title, model, task)
    return web.json_response(_conversation_to_dict(conv), status=201)

async def handle_get_conversation(request):
    conv_id = request.match_info.get("id")
    conv = await asyncio.to_thread(get_conversation, conv_id)
    if conv is None:
        return web.json_response({"error": "conversation_not_found", "status": 404}, status=404)
    messages = await asyncio.to_thread(get_messages, conv_id, limit=500)
    return web.json_response({"conversation": _conversation_to_dict(conv), "messages": [_message_to_dict(m) for m in messages]})

async def handle_delete_conversation(request):
    conv_id = request.match_info.get("id")
    await asyncio.to_thread(delete_conversation, conv_id)
    return web.json_response({"status": "deleted"})

async def handle_get_messages(request):
    conv_id = request.match_info.get("id")
    limit = int(request.query.get("limit", "100"))
    messages = await asyncio.to_thread(get_messages, conv_id, limit=min(limit, 500))
    return web.json_response({"data": [_message_to_dict(m) for m in messages]})

async def handle_memory_search(request):
    query = request.query.get("q", "").strip()
    if not query:
        return web.json_response({"error": "query_required", "status": 400}, status=400)
    results = await asyncio.to_thread(search_similar, query)
    if results is not None:
        return web.json_response({"data": [{"id": entry.id, "message_id": entry.message_id, "conversation_id": entry.conversation_id, "text_snippet": entry.text_snippet, "score": round(score, 4)} for score, entry in results], "method": "vector"})
    return web.json_response({"data": [], "method": "none"})

def store_shared(user_id, content, scope="shared", key=None, title=None, tags=None, source=None):
    embedding = _get_embedding(content[:1000])
    with get_session() as db:
        entry = SharedMemory(user_id=user_id, scope=scope, key=key,
                             title=title, content=content, tags=tags,
                             vector=json.dumps(embedding) if embedding else None,
                             source=source)
        db.add(entry)
        db.commit()
        db.refresh(entry)
        return entry

def search_shared(query, scope="shared", limit=10):
    query_vec = _get_embedding(query)
    with get_session() as db:
        if query_vec:
            entries = db.query(SharedMemory).filter(SharedMemory.scope == scope).all()
            scored = []
            for e in entries:
                if not e.vector:
                    scored.append((0.0, e))
                    continue
                try:
                    vec = json.loads(e.vector)
                    sim = _cosine_similarity(query_vec, vec)
                    scored.append((sim, e))
                except:
                    scored.append((0.0, e))
            scored.sort(key=lambda x: x[0], reverse=True)
            return scored[:limit]
        return db.query(SharedMemory).filter(
            SharedMemory.scope == scope,
            SharedMemory.content.ilike(f"%{query}%")
        ).order_by(SharedMemory.updated_at.desc()).limit(limit).all()

def list_shared(scope="shared", limit=50, offset=0):
    with get_session() as db:
        return db.query(SharedMemory).filter(
            SharedMemory.scope == scope
        ).order_by(SharedMemory.updated_at.desc()).offset(offset).limit(limit).all()

def delete_shared(entry_id, user_id=None):
    with get_session() as db:
        entry = db.query(SharedMemory).filter(SharedMemory.id == entry_id).first()
        if not entry:
            return False
        if user_id and entry.user_id and entry.user_id != user_id:
            return False
        db.delete(entry)
        db.commit()
        return True

async def handle_store_shared(request):
    try:
        body = await request.json()
    except:
        return web.json_response({"error": "invalid_json", "status": 400}, status=400)
    user_id = request.get("user_id")
    content = body.get("content", "").strip()
    if not content:
        return web.json_response({"error": "content_required", "status": 400}, status=400)
    entry = await asyncio.to_thread(store_shared,
        user_id=user_id,
        content=content,
        scope=body.get("scope", "shared"),
        key=body.get("key"),
        title=body.get("title"),
        tags=body.get("tags"),
        source=body.get("source"))
    return web.json_response({"id": entry.id, "scope": entry.scope, "title": entry.title, "key": entry.key, "tags": entry.tags, "source": entry.source, "created_at": entry.created_at.isoformat() if entry.created_at else None}, status=201)

async def handle_search_shared(request):
    query = request.query.get("q", "").strip()
    scope = request.query.get("scope", "shared")
    limit = int(request.query.get("limit", "10"))
    if not query:
        return web.json_response({"error": "query_required", "status": 400}, status=400)
    results = await asyncio.to_thread(search_shared, query, scope=scope, limit=min(limit, 50))
    if results and isinstance(results[0], tuple):
        return web.json_response({"data": [{"id": e.id, "title": e.title, "content": e.content[:300], "tags": e.tags, "key": e.key, "source": e.source, "score": round(s, 4)} for s, e in results], "method": "vector"})
    return web.json_response({"data": [{"id": e.id, "title": e.title, "content": e.content[:300], "tags": e.tags, "key": e.key, "source": e.source} for e in results], "method": "keyword"})

async def handle_list_shared(request):
    scope = request.query.get("scope", "shared")
    limit = int(request.query.get("limit", "50"))
    offset = int(request.query.get("offset", "0"))
    entries = await asyncio.to_thread(list_shared, scope=scope, limit=min(limit, 200), offset=offset)
    return web.json_response({"data": [{"id": e.id, "title": e.title, "content": e.content[:300], "tags": e.tags, "key": e.key, "source": e.source, "scope": e.scope, "created_at": e.created_at.isoformat() if e.created_at else None} for e in entries]})

async def handle_delete_shared(request):
    entry_id = int(request.match_info.get("id", "0"))
    user_id = request.get("user_id")
    ok = await asyncio.to_thread(delete_shared, entry_id, user_id)
    if not ok:
        return web.json_response({"error": "not_found_or_forbidden", "status": 404}, status=404)
    return web.json_response({"status": "deleted"})

def setup_memory_routes(app):
    app.router.add_get("/v1/conversations", handle_list_conversations)
    app.router.add_post("/v1/conversations", handle_create_conversation)
    app.router.add_get("/v1/conversations/{id}", handle_get_conversation)
    app.router.add_delete("/v1/conversations/{id}", handle_delete_conversation)
    app.router.add_get("/v1/conversations/{id}/messages", handle_get_messages)
    app.router.add_get("/v1/memory/search", handle_memory_search)
    app.router.add_post("/v1/memory/shared", handle_store_shared)
    app.router.add_get("/v1/memory/shared/search", handle_search_shared)
    app.router.add_get("/v1/memory/shared", handle_list_shared)
    app.router.add_delete("/v1/memory/shared/{id}", handle_delete_shared)
