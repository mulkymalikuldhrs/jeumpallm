import os, sys, json, asyncio, logging, uuid
from pathlib import Path
ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT))
import aiohttp.web
from aiohttp import web

log = logging.getLogger("jeumpa.mcp")

try:
    from agent import agent_loop, TOOLS_PROMPT, TOOL_HANDLERS
except ImportError:
    agent_loop = None
    TOOLS_PROMPT = ""
    TOOL_HANDLERS = {}

try:
    from sandbox import run_code, run_code_safe, list_sandbox_languages
except ImportError:
    run_code = None
    run_code_safe = None
    list_sandbox_languages = None

sse_clients: dict[str, web.StreamResponse] = {}

MCP_TOOLS = {
    "jeumpa_chat": {
        "description": "Chat completion via JeumpaLLM",
        "inputSchema": {
            "type": "object",
            "properties": {
                "messages": {"type": "array", "items": {"type": "object"}},
                "model": {"type": "string", "default": "auto"},
                "stream": {"type": "boolean", "default": False}
            },
            "required": ["messages"]
        }
    },
    "jeumpa_models": {
        "description": "List available models",
        "inputSchema": {"type": "object", "properties": {}}
    },
    "jeumpa_agent_code": {
        "description": "Execute coding agent",
        "inputSchema": {
            "type": "object",
            "properties": {
                "task": {"type": "string"},
                "language": {"type": "string", "default": "python"}
            },
            "required": ["task"]
        }
    },
    "jeumpa_sandbox_run": {
        "description": "Run code in sandbox",
        "inputSchema": {
            "type": "object",
            "properties": {
                "code": {"type": "string"},
                "language": {"type": "string", "default": "python"},
                "timeout": {"type": "integer", "default": 30}
            },
            "required": ["code"]
        }
    },
    "jeumpa_conversations": {
        "description": "List conversations",
        "inputSchema": {"type": "object", "properties": {
            "limit": {"type": "integer", "default": 50}
        }}
    },
    "jeumpa_health": {
        "description": "Health check",
        "inputSchema": {"type": "object", "properties": {}}
    }
}

async def call_tool(tool_name, tool_args, router=None):
    if tool_name == "jeumpa_chat":
        if not router:
            return {"error": "router_not_available"}
        messages = tool_args.get("messages", [])
        model = tool_args.get("model", "auto")
        stream = tool_args.get("stream", False)
        try:
            result = await router.chat_completion(messages, model=model, stream=stream)
            return result
        except Exception as e:
            return {"error": str(e)}
    elif tool_name == "jeumpa_models":
        if not router:
            return {"error": "router_not_available"}
        models = {}
        for pname, p in router.providers.items():
            ml = p.config.model_list if p.config.model_list != ["*"] else []
            if ml:
                for m in ml:
                    models[f"{pname}/{m}"] = {"provider": pname, "model": m, "status": p.status}
            else:
                models[pname] = {"provider": pname, "model": "*", "status": p.status}
        for alias, target in router.aliases.items():
            models[f"alias:{alias}"] = {"alias": alias, "target": target}
        return {"object": "list", "data": [{"id": k, **v} for k, v in models.items()]}
    elif tool_name == "jeumpa_agent_code":
        if not agent_loop or not router:
            return {"error": "agent_module_not_available"}
        task = tool_args.get("task", "")
        language = tool_args.get("language", "python")
        if not task:
            return {"error": "task_required"}
        messages = [{"role": "user", "content": f"Task: {task}\nLanguage: {language}\n\nWrite production-ready code."}]
        result = await agent_loop(router, messages, model="free-code")
        return result
    elif tool_name == "jeumpa_sandbox_run":
        if not run_code:
            return {"error": "sandbox_module_not_available"}
        code = tool_args.get("code", "")
        language = tool_args.get("language", "python")
        timeout = tool_args.get("timeout", 30)
        result = await run_code(code, language=language, timeout=timeout)
        return result
    elif tool_name == "jeumpa_conversations":
        return {"object": "list", "data": []}
    elif tool_name == "jeumpa_health":
        return {"status": "ok", "service": "jeumpa_mcp"}
    else:
        return {"error": f"unknown_tool: {tool_name}"}

def _get_msg_id(body):
    return body.get("id")

def _make_response(msg_id, result=None, error=None):
    resp = {"jsonrpc": "2.0"}
    if msg_id is not None:
        resp["id"] = msg_id
    else:
        resp["id"] = None
    if error:
        resp["error"] = error
    else:
        resp["result"] = result
    return resp

async def handle_sse(request):
    session_id = str(uuid.uuid4())
    resp = web.StreamResponse(
        status=200,
        headers={
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Access-Control-Allow-Origin": "*",
        }
    )
    await resp.prepare(request)
    await resp.write(f"event: endpoint\ndata: /mcp/message?session_id={session_id}\n\n".encode())
    sse_clients[session_id] = resp
    log.info(f"MCP SSE client connected: {session_id}")
    try:
        while True:
            await asyncio.sleep(15)
            await resp.write(b": keepalive\n\n")
    except (ConnectionResetError, ConnectionAbortedError):
        pass
    except Exception:
        pass
    finally:
        sse_clients.pop(session_id, None)
        log.info(f"MCP SSE client disconnected: {session_id}")
    return resp

async def handle_mcp_message(request):
    router = request.app.get("router") if hasattr(request, "app") else None
    if not router:
        try:
            router = request.config_dict.get("router")
        except:
            pass
    try:
        body = await request.json()
    except json.JSONDecodeError:
        return web.json_response(
            {"jsonrpc": "2.0", "error": {"code": -32700, "message": "Parse error"}, "id": None},
            status=400
        )
    except Exception:
        return web.json_response(
            {"jsonrpc": "2.0", "error": {"code": -32700, "message": "Parse error"}, "id": None},
            status=400
        )
    msg_id = _get_msg_id(body)
    method = body.get("method", "")
    params = body.get("params", {})
    session_id = request.query.get("session_id") or params.get("session_id", "")

    if method == "tools/list":
        tools = []
        for n, t in MCP_TOOLS.items():
            tools.append({
                "name": n,
                "description": t["description"],
                "inputSchema": t["inputSchema"]
            })
        return web.json_response(_make_response(msg_id, result={"tools": tools}))

    elif method == "tools/call":
        tool_name = params.get("name", "")
        tool_args = params.get("arguments", {})
        try:
            result = await call_tool(tool_name, tool_args, router)
            if session_id and session_id in sse_clients:
                try:
                    sse_msg = f"event: message\ndata: {json.dumps({'jsonrpc': '2.0', 'result': {'content': [{'type': 'text', 'text': json.dumps(result)}]}, 'id': msg_id})}\n\n"
                    await sse_clients[session_id].write(sse_msg.encode())
                except:
                    pass
            return web.json_response(_make_response(msg_id, result={
                "content": [{"type": "text", "text": json.dumps(result)}]
            }))
        except Exception as e:
            return web.json_response(_make_response(msg_id, error={
                "code": -32603, "message": str(e)
            }))

    elif method == "initialize":
        return web.json_response(_make_response(msg_id, result={
            "protocolVersion": "2024-11-05",
            "capabilities": {"tools": {}}
        }))

    elif method == "notifications/initialized":
        return web.json_response(_make_response(msg_id, result={}))

    else:
        return web.json_response(_make_response(msg_id, error={
            "code": -32601, "message": f"Method not found: {method}"
        }))

def setup_mcp_routes(app, router=None):
    if router:
        app["router"] = router
    app.router.add_get("/mcp/sse", handle_sse)
    app.router.add_post("/mcp/message", handle_mcp_message)
    app.router.add_post("/mcp", handle_mcp_message)
