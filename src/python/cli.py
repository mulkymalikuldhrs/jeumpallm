import sys, os, json, yaml, subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
ENV = {k: v for k, v in os.environ.items()}
_STATE_FILE = ROOT / "data" / "state.json"

def _load_state():
    if _STATE_FILE.exists():
        try:
            return json.loads(_STATE_FILE.read_text())
        except (json.JSONDecodeError, OSError):
            pass
    return {"task": "chat", "model": "auto"}

def _save_state(**kw):
    cur = _load_state()
    cur.update(kw)
    _STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    _STATE_FILE.write_text(json.dumps(cur, indent=2))

def _discovered():
    p = ROOT / "data" / "discovered_providers.json"
    if p.exists():
        try:
            return json.loads(p.read_text())
        except (json.JSONDecodeError, OSError):
            pass
    return {}

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
    state = _load_state()
    base = _server_url()
    task = state.get("task", "chat")
    model = state.get("model", "auto")
    messages = [{"role": "user", "content": " ".join(args)}] if args else []
    _print(f"jeumpallm chat (task={task}, model={model}) — Ctrl+C to exit\n")

    async def stream(prompt):
        nonlocal messages, task, model
        if not messages:
            messages = [{"role": "user", "content": prompt}]
        async with aiohttp.ClientSession() as sess:
            pl = {"messages": messages, "model": model, "task": task, "stream": True}
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
        _print("jeumpallm v2.5 — Type /help for commands\n")
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
                _save_state(task=task, model=model)
                break
            if prompt == "/help":
                _print("  /help           Show this help")
                _print("  /models         List models")
                _print("  /providers      List providers")
                _print("  /clear          Clear conversation")
                _print("  /task <name>    Switch task profile (auto-save)")
                _print("  /model <name>   Switch model (auto-save)")
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
                _save_state(task=task)
                _print(f"Task set to: {task}  (auto-saved)")
                continue
            if prompt.startswith("/model "):
                model = prompt[7:].strip()
                _save_state(model=model)
                _print(f"Model set to: {model}  (auto-saved)")
                continue
            messages.append({"role": "user", "content": prompt})
            asyncio.run(stream(None))
            _print()

def cmd_models(args):
    cfg = _cfg()
    provs = cfg.get("providers", {})
    discovered = _discovered()
    if args and args[0] == "search":
        q = args[1].lower() if len(args) > 1 else ""
        for name, p in provs.items():
            models = p.get("models", [])
            for m in models:
                if q in m.lower() or q in name.lower():
                    _print(f"  {name:25s} {m}")
        for name, p in discovered.items():
            models = p.get("models", [])
            for m in models:
                if q in m.lower() or q in name.lower():
                    _print(f"  {name:25s} {m}  [discovered]")
    elif args and args[0] in ("use", "set") and len(args) >= 2:
        _save_state(model=args[1])
        _print(f"Default model set to: {args[1]}  (auto-saved)")
    else:
        state = _load_state()
        _print(f"Current: model={state.get('model','auto')}  task={state.get('task','chat')}")
        _print()
        for name, p in provs.items():
            models = p.get("models", [])
            pm = p.get("priority", "-")
            _print(f"  {name:25s} priority={pm}  {len(models)} models")
            if args and args[0] == "--verbose":
                for m in models:
                    _print(f"    └─ {m}")
        if discovered:
            _print()
            _print(f"  — Discovered ({len(discovered)}) —")
            for name, p in discovered.items():
                models = p.get("models", [])
                _print(f"  {name:25s} {len(models)} models  [auto]")
                if args and args[0] == "--verbose":
                    for m in models:
                        _print(f"    └─ {m}")
    _print(f"\n  Total: {len(provs)} configured + {len(discovered)} discovered")

def cmd_providers(args):
    cfg = _cfg()
    provs = cfg.get("providers", {})
    discovered = _discovered()
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
    if discovered:
        _print()
        _print(f"  — Discovered ({len(discovered)}) —")
        for name, p in discovered.items():
            url = p.get("base_url", "-")
            _print(f"  ◇ {name:25s} {url}  [auto]")
    _print(f"\n  Total: {len(provs)} configured + {len(discovered)} discovered")

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
    _print("jeumpallm CLI v2.5")
    _print()
    _print("  jeumpa chat [message...]         Interactive streaming chat")
    _print("  jeumpa models list               List all providers & models")
    _print("  jeumpa models search <q>         Search models by keyword")
    _print("  jeumpa models set <model>        Set default model (auto-save)")
    _print("  jeumpa providers list            List configured providers")
    _print("  jeumpa providers probe           Run autonomous discovery")
    _print("  jeumpa server start|stop|...     Server management (single instance)")
    _print("  jeumpa server triangle           Start 2 instances, zero-downtime failover")
    _print("  jeumpa voice                     Voice chat mode")
    _print("  jeumpa help                      Show this help")
    _print()
    _print("Auto-save: model & task state persisted in data/state.json")
    _print("Auto-discovery: every 60s, dead providers auto-pruned, state persisted")
    _print("Triangle mode: start.sh triangle → 2 instances, zero-downtime failover")

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
