import sys, os, json, yaml, subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
ENV = {k: v for k, v in os.environ.items()}

def _cfg():
    p = ROOT / "config.yaml"
    return yaml.safe_load(p.read_text()) if p.exists() else {}

def _server_url():
    cfg = _cfg().get("server", {})
    host = cfg.get("host", "0.0.0.0")
    port = cfg.get("port", 3456)
    return f"http://127.0.0.1:{port}"

def _print(*a, **kw):
    print(*a, **kw)

def cmd_chat(args):
    import aiohttp, asyncio
    base = _server_url()
    task = "chat"
    messages = [{"role": "user", "content": " ".join(args)}] if args else []
    _print(f"JeumpaLLM Chat (task={task}) — Ctrl+C to exit\n")

    async def stream(prompt):
        nonlocal messages
        if not messages:
            messages = [{"role": "user", "content": prompt}]
        async with aiohttp.ClientSession() as sess:
            pl = {"messages": messages, "model": "auto", "task": task, "stream": True}
            async with sess.post(f"{base}/v1/streaming", json=pl) as resp:
                if resp.status != 200:
                    body = await resp.json()
                    _print(f"\nError {resp.status}: {body.get('error', 'unknown')}")
                    return
                buf = ""
                async for line in resp.content:
                    txt = line.decode().strip()
                    if not txt or txt == "data: [DONE]":
                        continue
                    if txt.startswith("data: "):
                        try:
                            chunk = json.loads(txt[6:])
                            delta = chunk.get("choices", [{}])[0].get("delta", {})
                            content = delta.get("content", "")
                            if content:
                                _print(content, end="", flush=True)
                                buf += content
                        except json.JSONDecodeError:
                            pass
                if buf:
                    messages.append({"role": "assistant", "content": buf})

    if messages:
        asyncio.run(stream(None))
        _print()
    else:
        _print("JeumpaLLM v2.5 — Type /help for commands\n")
        try:
            import readline
        except ImportError:
            pass
        while True:
            try:
                prompt = input("\033[1;34m>>> \033[0m")
            except (EOFError, KeyboardInterrupt):
                _print("\nBye!")
                break
            if not prompt:
                continue
            if prompt == "/exit" or prompt == "/quit":
                break
            if prompt == "/help":
                _print("  /help           Show this help")
                _print("  /models         List models")
                _print("  /providers      List providers")
                _print("  /clear          Clear conversation")
                _print("  /task <name>    Switch task profile")
                _print("  /exit, /quit    Exit CLI")
                continue
            if prompt == "/models":
                cmd_models([])
                continue
            if prompt == "/providers":
                cmd_providers([])
                continue
            if prompt == "/clear":
                messages = []
                _print("Conversation cleared")
                continue
            if prompt.startswith("/task "):
                task = prompt[6:].strip()
                _print(f"Task set to: {task}")
                continue
            messages.append({"role": "user", "content": prompt})
            asyncio.run(stream(None))
            _print()

def cmd_models(args):
    cfg = _cfg()
    provs = cfg.get("providers", {})
    if args and args[0] == "search":
        q = args[1].lower() if len(args) > 1 else ""
        for name, p in provs.items():
            models = p.get("models", [])
            for m in models:
                if q in m.lower() or q in name.lower():
                    _print(f"  {name:25s} {m}")
    else:
        for name, p in provs.items():
            models = p.get("models", [])
            pm = p.get("priority", "-")
            url = p.get("base_url", "")
            _print(f"  {name:25s} priority={pm}  {len(models)} models")
            if args and args[0] == "--verbose":
                for m in models:
                    _print(f"    └─ {m}")
    _print(f"\n  Total: {len(provs)} providers")

def cmd_providers(args):
    cfg = _cfg()
    provs = cfg.get("providers", {})
    if args and args[0] == "probe":
        import aiohttp, asyncio
        base = _server_url()
        async def probe():
            async with aiohttp.ClientSession() as sess:
                resp = await sess.post(f"{base}/v1/discovery/probe", json={})
                if resp.status == 200:
                    data = await resp.json()
                    _print(json.dumps(data, indent=2))
                else:
                    _print(f"Error {resp.status}: {await resp.text()}")
        asyncio.run(probe())
        return
    for name, p in provs.items():
        url = p.get("base_url", "-")
        st = "✓" if p.get("models") else "✗"
        _print(f"  {st} {name:25s} {url}")
    _print(f"\n  Total: {len(provs)} providers")

def cmd_server(args):
    script = ROOT / "start.sh"
    if not script.exists():
        _print("start.sh not found")
        return
    cmd = args[0] if args else "status"
    if cmd not in ("start", "stop", "status", "logs", "backup", "restart"):
        _print(f"Usage: jeumpa server {{start|stop|status|logs|backup|restart}}")
        return
    subprocess.run(["bash", str(script), cmd])

def cmd_voice(args):
    _print("Voice chat — requires microphone + speech-to-text provider")
    _print("Usage: arecord | jeumpa voice | aplay")
    _print("Not yet implemented in this release")

def cmd_help(args):
    _print("JeumpaLLM CLI v2.5")
    _print()
    _print("  jeumpa chat [message...]      Interactive streaming chat")
    _print("  jeumpa models list             List all providers & models")
    _print("  jeumpa models search <q>       Search models by keyword")
    _print("  jeumpa providers list          List configured providers")
    _print("  jeumpa providers probe         Run autonomous discovery")
    _print("  jeumpa server start|stop|...   Server management")
    _print("  jeumpa voice                   Voice chat mode")
    _print("  jeumpa help                    Show this help")
    _print()
    _print("Server: config.yaml | Port 3456 | Providers auto-discover")

CMDS = {
    "chat": cmd_chat, "models": cmd_models, "providers": cmd_providers,
    "server": cmd_server, "voice": cmd_voice, "help": cmd_help,
}

def main():
    if len(sys.argv) < 2 or sys.argv[1] in ("-h", "--help"):
        cmd_help(sys.argv[1:])
        return
    cmd = sys.argv[1]
    if cmd in CMDS:
        CMDS[cmd](sys.argv[2:])
    else:
        _print(f"Unknown command: {cmd}")
        cmd_help([])

if __name__ == "__main__":
    main()
