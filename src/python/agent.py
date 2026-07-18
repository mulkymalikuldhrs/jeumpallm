import os, sys, json, asyncio, logging, re, shlex, tempfile, shutil
from pathlib import Path
ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT))
from aiohttp import web
import httpx

log = logging.getLogger("jeumpa.agent")

HERMES_CODER = """You are an expert coding agent based on Hermes Nous Research methodology.

<methodology>
1. **Analyze**: Understand requirements, constraints, and edge cases
2. **Plan**: Design the architecture before writing code
3. **Code**: Write production-ready, well-structured code
4. **Verify**: Check for errors, edge cases, and test
5. **Iterate**: Fix issues and optimize
</methodology>

Always think step-by-step. Show your reasoning clearly.
For every task, output: <thinking>your analysis</thinking> then the code.
Use tools (read_file, write_file, run_command, search_web, list_directory) when needed.
"""
CODER_PROMPT = """You have access to these tools. To use one, respond with exactly:
TOOL: <tool_name>
ARGS: {"key": "value"}
RESULT: <expected result>

Available tools:
- read_file(path: str) -> str: Read a file from the filesystem
- write_file(path: str, content: str) -> str: Write content to a file
- run_command(command: str) -> str: Run a shell command (allowed: python3, node, sh, git, pip, etc — output truncated to 4096 chars)
- search_web(query: str) -> str: Search the web for information
- list_directory(path: str) -> list: List files in a directory

When you need to use a tool, output the TOOL/ARGS/RESULT block.
After receiving the result, continue your response.
You can use multiple tools sequentially."""

AGENT_PROMPT = HERMES_CODER + "\n" + CODER_PROMPT

TOOL_RE = re.compile(r'TOOL:\s*(\w+)\s*\nARGS:\s*(\{.*?\})\s*\n(?:RESULT:)', re.DOTALL)

try:
    from jeumpa_paths import get_home, get_data_root, get_writable_dirs
    _home = get_home()
    _data = get_data_root()
    ALLOWED_ROOTS = [_home, _data, Path("/tmp")] + [d for d in get_writable_dirs() if d not in (_home, _data, Path("/tmp"))]
except ImportError:
    ALLOWED_ROOTS = [Path("/root/services/jeumpa"), Path("/tmp")]

def _safe_path(path):
    p = Path(path)
    if p.is_absolute():
        for root in ALLOWED_ROOTS:
            try:
                resolved = p.resolve()
                if str(resolved).startswith(str(root.resolve())):
                    return resolved
            except:
                pass
        return ALLOWED_ROOTS[0]
    for root in ALLOWED_ROOTS:
        candidate = (root / p).resolve()
        if str(candidate).startswith(str(root.resolve())):
            return candidate
    return ALLOWED_ROOTS[0]

async def _read_file(args):
    path = _safe_path(args.get("path", ""))
    if not path.exists():
        return {"error": "file not found"}
    if not path.is_file():
        return {"error": "not a file"}
    try:
        content = path.read_text(encoding="utf-8", errors="replace")
        if len(content) > 100000:
            content = content[:100000] + "\n...[truncated]"
        return {"content": content, "path": str(path)}
    except Exception as e:
        return {"error": str(e)}

async def _write_file(args):
    path = _safe_path(args.get("path", ""))
    content = args.get("content", "")
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        return {"status": "ok", "path": str(path), "bytes": len(content)}
    except Exception as e:
        return {"error": str(e)}

ALLOWED_COMMANDS = frozenset({
    "python3", "python", "node", "sh", "bash",
    "git", "ls", "cat", "head", "tail", "wc", "echo", "printf",
    "mkdir", "cp", "mv", "pip", "pip3", "npm",
    "grep", "find", "sort", "uniq", "which", "type", "chmod", "pwd",
    "make", "gcc", "g++", "rustc", "go", "cargo",
})

async def _run_command(args):
    command = args.get("command", "")
    import subprocess
    parts = shlex.split(command)
    if not parts:
        return {"error": "empty command", "stdout": "", "stderr": "", "exit_code": -1}
    executable = parts[0]
    if executable not in ALLOWED_COMMANDS:
        return {
            "error": f"command not allowed: {executable}",
            "allowed": sorted(ALLOWED_COMMANDS),
            "stdout": "", "stderr": "", "exit_code": -1
        }
    tmpdir = None
    try:
        tmpdir = tempfile.mkdtemp(prefix="jeumpa_agent_")
        proc = await asyncio.create_subprocess_exec(
            *parts,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            stdin=subprocess.DEVNULL,
            cwd=tmpdir,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=30)
    except asyncio.TimeoutError:
        try:
            proc.kill()
            await proc.wait()
        except:
            pass
        return {"error": "timeout", "stdout": "", "stderr": "", "exit_code": -1}
    except ValueError as e:
        return {"error": f"invalid command: {e}", "stdout": "", "stderr": "", "exit_code": -1}
    finally:
        if tmpdir:
            shutil.rmtree(tmpdir, ignore_errors=True)
    return {
        "stdout": stdout.decode(errors="replace")[-4096:],
        "stderr": stderr.decode(errors="replace")[-4096:],
        "exit_code": proc.returncode
    }

async def _search_web(args):
    query = args.get("query", "")
    async with httpx.AsyncClient(timeout=15) as client:
        try:
            resp = await client.get(
                "https://api.duckduckgo.com/",
                params={"q": query, "format": "json"}
            )
            data = resp.json()
            return {"results": data.get("AbstractText", ""), "source": "duckduckgo"}
        except Exception as e:
            return {"error": f"web search unavailable: {str(e)}"}

async def _list_directory(args):
    path = _safe_path(args.get("path", ""))
    if not path.is_dir():
        return {"error": "not a directory"}
    try:
        entries = []
        for f in path.iterdir():
            try:
                rel = str(f.relative_to(path))
                entries.append(rel)
            except:
                entries.append(f.name)
        return {"files": entries[:50], "path": str(path)}
    except Exception as e:
        return {"error": str(e)}

TOOL_HANDLERS = {
    "read_file": _read_file,
    "write_file": _write_file,
    "run_command": _run_command,
    "search_web": _search_web,
    "list_directory": _list_directory,
}

def parse_tool_calls(text):
    matches = TOOL_RE.findall(text)
    results = []
    for name, args_json in matches:
        try:
            args = json.loads(args_json)
        except:
            args = {}
        results.append((name, args))
    return results

def check_agent_access(user):
    if not user:
        return False
    tier = user.get("tier", "")
    token_balance = user.get("token_balance", 0)
    return tier in ("donor", "admin") or token_balance > 0

async def agent_loop(router, messages, max_iterations=5, model="free-smart", user=None):
    system_prompt = AGENT_PROMPT + "\n\nYou are an autonomous coding agent. Write production code. Use tools when needed. Analyze results and fix errors."
    full_messages = [{"role": "system", "content": system_prompt}] + messages
    used_providers = []
    for iteration in range(max_iterations):
        result = await router.chat_completion(full_messages, model=model, stream=False)
        if isinstance(result, dict) and "error" in result:
            return result
        provider_name = result.get("_provider", "unknown")
        if provider_name not in used_providers:
            used_providers.append(provider_name)
        choices = result.get("choices", [])
        if not choices:
            return result
        content = choices[0].get("message", {}).get("content", "")
        if not content:
            return result
        tool_calls = parse_tool_calls(content)
        if not tool_calls:
            return {
                "choices": [{"message": {"role": "assistant", "content": content}}],
                "usage": result.get("usage", {}),
                "_providers_used": used_providers,
            }
        for name, args in tool_calls:
            handler = TOOL_HANDLERS.get(name)
            if handler:
                tool_result = await handler(args)
                full_messages.append({"role": "assistant", "content": content})
                full_messages.append({
                    "role": "user",
                    "content": f"Tool result for {name}: {json.dumps(tool_result)}\nContinue with your response."
                })
    return {"error": "max_iterations_exceeded", "status": 508, "_providers_used": used_providers}

async def handle_agent_code(request):
    router = request.app.get("router") or request.config_dict.get("router")
    if not router:
        return web.json_response({"error": "router_not_available", "status": 503}, status=503)
    user = request.get("user")
    if user and not check_agent_access(user):
        return web.json_response({
            "error": "agent_subscription_required",
            "message": "Agent mode requires donor subscription. Donasi minimal IDR 10.000 via /donate.",
            "subscribe_url": "/donate/tiers",
        }, status=402)
    try:
        body = await request.json()
    except:
        return web.json_response({"error": "invalid_json", "status": 400}, status=400)
    task = body.get("task", "")
    language = body.get("language", "python")
    context = body.get("context", "")
    if not task:
        return web.json_response({"error": "task_required", "status": 400}, status=400)
    coding_prompt = f"<task>{task}</task>\n<language>{language}</language>"
    if context:
        coding_prompt += f"\n<context>{context}</context>"
    coding_prompt += "\n\nFollow the Hermes methodology: analyze, plan, code, verify. Output <thinking> then code."
    messages = [{"role": "user", "content": coding_prompt}]
    result = await agent_loop(router, messages, model=body.get("model", "free-smart"), user=user)
    if isinstance(result, dict) and "error" in result:
        status = result.get("status", 500)
        return web.json_response(result, status=status)
    content = ""
    files_created = []
    used_providers = result.get("_providers_used", [])
    if isinstance(result, dict):
        choices = result.get("choices", [])
        if choices:
            content = choices[0].get("message", {}).get("content", "")
    fc_match = re.findall(r'(?:created|wrote|saved)\s+(?:file\s+)?[\"`]?([\w./\\-]+)[\"`]?', content, re.IGNORECASE)
    if fc_match:
        files_created = list(set(fc_match))
    return web.json_response({
        "code": content,
        "explanation": content,
        "files_created": files_created,
        "language": language,
        "providers_used": used_providers,
    })

async def handle_agent_chat(request):
    router = request.app.get("router") or request.config_dict.get("router")
    if not router:
        return web.json_response({"error": "router_not_available", "status": 503}, status=503)
    user = request.get("user")
    if user and not check_agent_access(user):
        return web.json_response({
            "error": "agent_subscription_required",
            "message": "Agent mode requires donor subscription.",
        }, status=402)
    try:
        body = await request.json()
    except:
        return web.json_response({"error": "invalid_json", "status": 400}, status=400)
    messages = body.get("messages", [])
    model = body.get("model", "free-smart")
    stream = body.get("stream", False)
    if not messages:
        return web.json_response({"error": "messages_required", "status": 400}, status=400)
    full_messages = [{"role": "system", "content": AGENT_PROMPT + "\n\nYou are a helpful AI assistant with tool access."}]
    full_messages.extend(messages)
    if stream:
        result = await router.chat_completion(full_messages, model=model, stream=True)
        if hasattr(result, '__aiter__'):
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
        if isinstance(result, dict) and "error" in result:
            return web.json_response(result, status=result.get("status", 503))
        return web.json_response(result)
    result = await agent_loop(router, messages, model=model, user=user)
    if isinstance(result, dict) and "error" in result:
        status = result.get("status", 500)
        return web.json_response(result, status=status)
    return web.json_response(result)

async def handle_agent_tools(request):
    tools_list = []
    for name, handler in TOOL_HANDLERS.items():
        tools_list.append({
            "name": name,
            "description": handler.__doc__ or f"Execute {name} tool",
            "parameters": {"type": "object"}
        })
    return web.json_response({
        "object": "list",
        "data": tools_list
    })

async def handle_agent_subscribe(request):
    user = request.get("user")
    if not user:
        return web.json_response({"error": "login_required"}, status=401)
    token_balance = user.get("token_balance", 0)
    tier = user.get("tier", "guest")
    return web.json_response({
        "tier": tier,
        "token_balance": token_balance,
        "agent_access": check_agent_access(user),
        "plans": [
            {"name": "Agent Monthly", "amount": 50000, "tokens": 500, "description": "Full agent access + 500 token/bulan"},
            {"name": "Agent Pro", "amount": 100000, "tokens": 1200, "description": "Agent + priority routing + 1200 token/bulan"},
        ],
        "subscribe_url": "/donate/create?amount=50000",
        "note": "Donasi via /donate untuk aktivasi. Tier donor = akses agent otomatis."
    })

async def handle_agent_telegram_register(request):
    user = request.get("user")
    if not user:
        return web.json_response({"error": "login_required"}, status=401)
    if not check_agent_access(user):
        return web.json_response({"error": "agent_subscription_required"}, status=402)
    try:
        data = await request.json()
    except:
        return web.json_response({"error": "invalid_json"}, status=400)
    bot_token = data.get("bot_token", "").strip()
    if not bot_token:
        return web.json_response({"error": "bot_token_required"}, status=400)
    webhook_url = data.get("webhook_url", "").strip()
    if not webhook_url:
        scheme = request.scheme
        host = request.host
        webhook_url = f"{scheme}://{host}/v1/agent/telegram/webhook"
    request.app["telegram_bot_token"] = bot_token
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(
                f"https://api.telegram.org/bot{bot_token}/setWebhook",
                json={"url": webhook_url}
            )
            data = r.json()
        if data.get("ok"):
            return web.json_response({"status": "ok", "webhook_url": webhook_url, "description": data.get("description", "")})
        return web.json_response({"error": data.get("description", "telegram_api_error")}, status=400)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)

async def handle_agent_telegram_webhook(request):
    bot_token = request.app.get("telegram_bot_token", "")
    if not bot_token:
        return web.json_response({"error": "no_bot_configured"})
    router = request.app.get("router") or request.config_dict.get("router")
    try:
        update = await request.json()
    except:
        return web.json_response({"error": "invalid_update"})
    message = update.get("message", {})
    chat_id = message.get("chat", {}).get("id")
    text = message.get("text", "")
    if not chat_id or not text:
        return web.json_response({"status": "ok"})
    agent_messages = [{"role": "user", "content": text}]
    result = None
    if router:
        result = await router.chat_completion(
            [{"role": "system", "content": "You are a helpful AI assistant. Be concise and friendly."},
             {"role": "user", "content": text}],
            model="free-smart", stream=False
        )
    reply = "Maaf, agent sedang tidak tersedia."
    if result and isinstance(result, dict):
        choices = result.get("choices", [])
        if choices:
            reply = choices[0].get("message", {}).get("content", reply)
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(
                f"https://api.telegram.org/bot{bot_token}/sendMessage",
                json={"chat_id": chat_id, "text": reply[:4096]}
            )
    except:
        pass
    return web.json_response({"status": "ok"})

def setup_agent_routes(app, router):
    app["router"] = router
    app.router.add_post("/v1/agent/code", handle_agent_code)
    app.router.add_post("/v1/agent/chat", handle_agent_chat)
    app.router.add_post("/v1/agent/tools", handle_agent_tools)
    app.router.add_get("/v1/agent/subscribe", handle_agent_subscribe)
    app.router.add_post("/v1/agent/telegram", handle_agent_telegram_register)
    app.router.add_post("/v1/agent/telegram/webhook", handle_agent_telegram_webhook)
