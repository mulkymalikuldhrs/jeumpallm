#!/usr/bin/env python3
import os, sys, json, pathlib, asyncio
ROOT = pathlib.Path(__file__).parent
sys.path.insert(0, str(ROOT))
from providers.registry import ProviderRegistry
from router import Router

router = Router()
registry = ProviderRegistry(str(ROOT / "config.yaml"))
registry.build(router)

async def handle_async(name, args):
    if name == "jeumpa_chat":
        messages = args.get("messages", [])
        model = args.get("model", "free-smart")
        result = await router.chat_completion(messages, model=model)
        return result
    if name == "jeumpa_models":
        return list(router.model_map.keys())
    if name == "jeumpa_status":
        return {n: p.to_dict() for n, p in router.providers.items()}
    if name == "jeumpa_health":
        return {"status": "ok", "providers": len(router.providers)}
    return {"error": f"unknown tool: {name}"}

def handle(name, args):
    try:
        result = asyncio.run(handle_async(name, args))
        return result
    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    for line in sys.stdin:
        try:
            msg = json.loads(line)
            rid = msg.get("id")
            method = msg.get("method", "")
            params = msg.get("params", {})
            if method == "tools/list":
                print(json.dumps({"id": rid, "result": {"tools": [
                    {"name": "jeumpa_chat", "description": "Chat completion via JeumpaLLM",
                     "inputSchema": {"type": "object", "properties": {
                         "messages": {"type": "array"},
                         "model": {"type": "string"}
                     }}},
                    {"name": "jeumpa_models", "description": "List available models",
                     "inputSchema": {"type": "object", "properties": {}}},
                    {"name": "jeumpa_status", "description": "Provider status",
                     "inputSchema": {"type": "object", "properties": {}}},
                    {"name": "jeumpa_health", "description": "Health check",
                     "inputSchema": {"type": "object", "properties": {}}}
                ]}}))
            elif method == "tools/call":
                tool = params.get("name", "")
                args = params.get("arguments", {})
                result = handle(tool, args)
                print(json.dumps({"id": rid, "result": {"content": [{"type": "text", "text": json.dumps(result)}]}}))
            else:
                print(json.dumps({"id": rid, "error": {"code": -32601, "message": "not supported"}}))
        except Exception as e:
            print(json.dumps({"id": "error", "error": {"code": -32700, "message": str(e)}}))
        sys.stdout.flush()
