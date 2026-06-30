#!/usr/bin/env python3
"""
Dhaher Labs — Model Router
Auto-fetch · Round-Robin · Task Routing · Auto-Switch · Health Check
"""

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime

WORKSPACE = "/sdcard/dhaherlabs"
CONFIG_FILE = f"{WORKSPACE}/configs/model-routes.yaml"
STATE_FILE = f"{WORKSPACE}/data/model-router-state.json"
CACHE_FILE = f"{WORKSPACE}/data/available-models.json"
HEALTH_FILE = f"{WORKSPACE}/data/model-health.json"
LOG_FILE = f"{WORKSPACE}/logs/model-router.log"

import yaml


def log(msg):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with open(LOG_FILE, "a") as f:
        f.write(f"[{ts}] {msg}\n")
    print(f"[{ts}] {msg}")


def load_state():
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE) as f:
            return json.load(f)
    return {
        "round_robin_index": {},
        "failed_models": {},
        "latency_cache": {},
        "current_session_model": "",
        "switch_count": 0,
        "last_reset": "",
    }


def save_state(state):
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)


def load_config():
    with open(CONFIG_FILE) as f:
        return yaml.safe_load(f)


# ── Model Fetch ──────────────────────────────────────────────────

def fetch_models():
    log("Fetching available free models...")

    config = load_config()
    opencode_key = os.environ.get("OPENCODE_ZEN_API_KEY", "")
    nvidia_key = os.environ.get("NVIDIA_API_KEY", "")
    env_key = os.environ.get("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", "")

    results = {"opencode-zen": [], "nvidia": [], "jeumpallm": []}

    # OpenCode Zen - fetch live
    try:
        req = urllib.request.Request(
            "https://opencode.ai/zen/v1/models",
            headers={"Authorization": f"Bearer {opencode_key}"},
        )
        resp = urllib.request.urlopen(req, timeout=15)
        data = json.loads(resp.read())
        free_keywords = ["free", "flash", "mini", "nano"]
        for m in data.get("data", []):
            mid = m.get("id", "")
            if any(k in mid for k in free_keywords):
                results["opencode-zen"].append(mid)
    except Exception as e:
        log(f"OpenCode Zen fetch failed: {e}")

    # Always include known free models
    known_free = [
        "deepseek-v4-flash-free", "mimo-v2.5-free", "qwen3.6-plus-free",
        "minimax-m3-free", "nemotron-3-ultra-free", "north-mini-code-free",
    ]
    for m in known_free:
        if m not in results["opencode-zen"]:
            results["opencode-zen"].append(m)

    # JeumpaLLM — local LLM gateway
    try:
        req = urllib.request.Request("http://127.0.0.1:3456/v1/models")
        resp = urllib.request.urlopen(req, timeout=5)
        data = json.loads(resp.read())
        for m in data.get("data", []):
            results["jeumpallm"].append(m.get("id", ""))
    except Exception as e:
        log(f"JeumpaLLM fetch failed: {e}")
        results["jeumpallm"] = ["deepseek-v4-flash-free", "jeumpa-basic"]

    # NVIDIA - fetch live
    try:
        req = urllib.request.Request("https://integrate.api.nvidia.com/v1/models")
        resp = urllib.request.urlopen(req, timeout=15)
        data = json.loads(resp.read())
        all_ids = [m.get("id", "") for m in data.get("data", [])]
        free_nvidia = [
            "mistralai/codestral-22b-instruct-v0.1", "meta/llama-3.3-70b-instruct",
            "meta/llama-3.1-8b-instruct", "meta/llama-4-maverick-17b-128e-instruct",
            "google/gemma-3-12b-it", "microsoft/phi-4-mini-instruct",
            "mistralai/mistral-7b-instruct-v0.3", "meta/llama-3.2-3b-instruct",
        ]
        for m in free_nvidia:
            if m in all_ids:
                results["nvidia"].append(m)
    except Exception as e:
        log(f"NVIDIA fetch failed: {e}")

    # Fallback
    if not results["nvidia"]:
        results["nvidia"] = [
            "mistralai/codestral-22b-instruct-v0.1", "meta/llama-3.3-70b-instruct"
        ]

    with open(CACHE_FILE, "w") as f:
        json.dump(results, f, indent=2)

    log(f"Models cached: OpenCode Zen={len(results['opencode-zen'])}, NVIDIA={len(results['nvidia'])}, JeumpaLLM={len(results['jeumpallm'])}")
    return results


# ── Task Router ──────────────────────────────────────────────────

def get_model_for_task(task_type="default", round_index=0):
    config = load_config()
    tasks = config.get("tasks", {})
    task_config = tasks.get(task_type, tasks.get("default", {}))

    if not task_config:
        return "deepseek-v4-flash-free", "jeumpallm"

    all_models = [task_config.get("primary", {})]
    all_models.extend(task_config.get("fallbacks", []))

    idx = round_index % len(all_models) if all_models else 0
    selected = task_config if task_config else {"model": "deepseek-v4-flash-free", "provider": "jeumpallm"}

    return selected.get("model", "deepseek-v4-flash-free"), selected.get("provider", "jeumpallm")


def detect_task_type(prompt=""):
    prompt_lower = prompt.lower()

    coding_keywords = [
        "code", "implement", "function", "bug", "debug", "refactor",
        "write a", "create a", "generate", "algorithm", "api", "endpoint",
        "class", "method", "variable", "test", "unit test", "compile",
    ]
    brainstorm_keywords = [
        "idea", "brainstorm", "creative", "think", "possibilities",
        "imagine", "what if", "suggestion", "innovate", "design thinking",
    ]
    plan_keywords = [
        "plan", "roadmap", "strategy", "architecture", "design doc",
        "timeline", "milestone", "project plan", "sprint",
    ]
    orchestrate_keywords = [
        "delegate", "orchestrate", "coordinate", "subtask", "parallel",
        "multi-agent", "distribute", "assign", "organize",
    ]

    scores = {
        "coding": sum(1 for k in coding_keywords if k in prompt_lower),
        "brainstorming": sum(1 for k in brainstorm_keywords if k in prompt_lower),
        "planning": sum(1 for k in plan_keywords if k in prompt_lower),
        "orchestrating": sum(1 for k in orchestrate_keywords if k in prompt_lower),
    }

    if not any(scores.values()):
        return "default"

    return max(scores, key=scores.get)


# ── Health Check ─────────────────────────────────────────────────

def health_check():
    log("Running model health checks...")

    if os.path.exists(CACHE_FILE):
        with open(CACHE_FILE) as f:
            models = json.load(f)
    else:
        models = {"opencode-zen": ["mimo-v2.5-free"], "nvidia": [], "jeumpallm": ["deepseek-v4-flash-free"]}

    opencode_key = os.environ.get("OPENCODE_ZEN_API_KEY", "")
    nvidia_key = os.environ.get("NVIDIA_API_KEY", "")
    nvidia_key = nvidia_key or os.environ.get(
        "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", ""
    )

    # If no NVIDIA key set, check the .env file
    if not nvidia_key:
        env_path = os.path.expanduser("~/.hermes/.env")
        if os.path.exists(env_path):
            with open(env_path) as f:
                for line in f:
                    if "NVIDIA_API_KEY" in line or "nvapi-" in line:
                        parts = line.strip().split("=", 1)
                        if len(parts) == 2 and parts[1]:
                            nvidia_key = parts[1]

    config = load_config()
    providers_config = config.get("providers", {})

    results = {}

    for model in models.get("opencode-zen", [])[:3]:  # Check top 3
        try:
            start = time.time()
            req = urllib.request.Request(
                "https://opencode.ai/zen/v1/chat/completions",
                data=json.dumps({
                    "model": model,
                    "messages": [{"role": "user", "content": "Say ok"}],
                    "max_tokens": 10,
                }).encode(),
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {opencode_key}",
                },
            )
            resp = urllib.request.urlopen(req, timeout=30)
            latency = int((time.time() - start) * 1000)
            results[f"opencode-zen/{model}"] = {"status": "ok", "latency_ms": latency}
            log(f"  ✓ {model}: {latency}ms")
        except Exception as e:
            results[f"opencode-zen/{model}"] = {"status": "error", "error": str(e)[:100]}
            log(f"  ✗ {model}: {str(e)[:60]}")

    for model in models.get("nvidia", [])[:3]:
        if not nvidia_key:
            results[f"nvidia/{model}"] = {"status": "skip", "error": "no API key"}
            continue
        try:
            start = time.time()
            req = urllib.request.Request(
                "https://integrate.api.nvidia.com/v1/chat/completions",
                data=json.dumps({
                    "model": model,
                    "messages": [{"role": "user", "content": "Say ok"}],
                    "max_tokens": 10,
                }).encode(),
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {nvidia_key}",
                },
            )
            resp = urllib.request.urlopen(req, timeout=30)
            latency = int((time.time() - start) * 1000)
            results[f"nvidia/{model}"] = {"status": "ok", "latency_ms": latency}
            log(f"  ✓ {model}: {latency}ms")
        except Exception as e:
            results[f"nvidia/{model}"] = {"status": "error", "error": str(e)[:100]}
            log(f"  ✗ {model}: {str(e)[:60]}")

    for model in models.get("jeumpallm", [])[:3]:
        try:
            start = time.time()
            req = urllib.request.Request(
                "http://127.0.0.1:3456/v1/chat/completions",
                data=json.dumps({
                    "model": model,
                    "messages": [{"role": "user", "content": "Say ok"}],
                    "max_tokens": 10,
                }).encode(),
                headers={"Content-Type": "application/json"},
            )
            resp = urllib.request.urlopen(req, timeout=10)
            latency = int((time.time() - start) * 1000)
            results[f"jeumpallm/{model}"] = {"status": "ok", "latency_ms": latency}
            log(f"  ✓ {model} (JeumpaLLM): {latency}ms")
        except Exception as e:
            results[f"jeumpallm/{model}"] = {"status": "error", "error": str(e)[:100]}
            log(f"  ✗ {model} (JeumpaLLM): {str(e)[:60]}")

    with open(HEALTH_FILE, "w") as f:
        json.dump(results, f, indent=2)

    healthy = sum(1 for v in results.values() if v.get("status") == "ok")
    total = len(results)
    log(f"Health check: {healthy}/{total} models healthy")


# ── Apply to Hermes Config ──────────────────────────────────────

def apply_to_hermes(task_type="default", round_index=0):
    model, provider = get_model_for_task(task_type, round_index)

    provider_map = {
        "opencode-zen": ("opencode-zen", "https://opencode.ai/zen/v1"),
        "nvidia": ("nvidia", "https://integrate.api.nvidia.com/v1"),
        "jeumpallm": ("jeumpallm", "http://127.0.0.1:3456/v1"),
    }

    hermes_provider, base_url = provider_map.get(provider, ("opencode-zen", "https://opencode.ai/zen/v1"))

    log(f"Applying to Hermes: {model} via {hermes_provider} (task: {task_type})")

    import re
    config_path = os.path.expanduser("~/.hermes/config.yaml")

    with open(config_path) as f:
        content = f.read()

    # IMPORTANT: model name must NOT include provider prefix
    # OpenCode Zen API expects just the model name (e.g. "mimo-v2.5-free")
    content = re.sub(
        r'^  default: .*$',
        f'  default: {model}',
        content,
        count=1,
        flags=re.MULTILINE,
    )

    content = re.sub(
        r'^  provider: .*$',
        f'  provider: {hermes_provider}',
        content,
        count=1,
        flags=re.MULTILINE,
    )

    content = re.sub(
        r'^  base_url: .*$',
        f'  base_url: {base_url}',
        content,
        count=1,
        flags=re.MULTILINE,
    )

    with open(config_path, "w") as f:
        f.write(content)

    state = load_state()
    state["current_session_model"] = f"{provider}/{model}"
    state["current_task"] = task_type
    save_state(state)

    log(f"✓ Hermes model set to: {model}")


# ── OpenCode Proxy Router ───────────────────────────────────────

def start_opencode_proxy():
    """Start opencode serve as OpenAI-compatible proxy"""
    port = os.environ.get("OPENCODE_PROXY_PORT", "9876")
    password = os.environ.get("OPENCODE_SERVER_PASSWORD", "dhaherlabs")

    log(f"Starting OpenCode proxy server on port {port}...")
    os.environ["OPENCODE_SERVER_PASSWORD"] = password

    proc = subprocess.Popen(
        ["opencode", "serve", "--port", port, "--hostname", "0.0.0.0", "--cors", "*"],
        stdout=open(f"{WORKSPACE}/logs/opencode-proxy.log", "a"),
        stderr=subprocess.STDOUT,
    )

    # Save PID
    with open("/tmp/opencode-proxy.pid", "w") as f:
        f.write(str(proc.pid))

    # Save URL
    with open(f"{WORKSPACE}/data/opencode-proxy-url.txt", "w") as f:
        f.write(f"http://127.0.0.1:{port}")

    log(f"✓ OpenCode proxy started (PID: {proc.pid}, Port: {port})")
    log(f"  → Hermes can use: base_url=http://127.0.0.1:{port}")
    return proc


# ── Daemon Mode ─────────────────────────────────────────────────

def daemon():
    log("═══ Model Router Daemon Started ═══")
    fetch_models()
    health_check()

    while True:
        time.sleep(900)  # 15 minutes
        try:
            fetch_models()
            health_check()
        except Exception as e:
            log(f"Daemon error: {e}")


# ── CLI ─────────────────────────────────────────────────────────

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: model-router.py <command> [args]")
        print("")
        print("Commands:")
        print("  fetch                          Auto-fetch free models")
        print("  route <prompt|task>            Detect task & return model")
        print("  apply <task> [round_index]     Apply model to Hermes")
        print("  health                         Check model health")
        print("  detect <prompt>                Detect task type")
        print("  proxy [start|stop|status]      OpenCode proxy server")
        print("  daemon                         Background service")
        sys.exit(1)

    cmd = sys.argv[1]

    if cmd == "fetch":
        fetch_models()
    elif cmd == "route":
        prompt = sys.argv[2] if len(sys.argv) > 2 else ""
        task = detect_task_type(prompt)
        round_idx = int(sys.argv[3]) if len(sys.argv) > 3 else 0
        model, provider = get_model_for_task(task, round_idx)
        print(f"{model}:{provider}")
    elif cmd == "apply":
        task = sys.argv[2] if len(sys.argv) > 2 else "default"
        round_idx = int(sys.argv[3]) if len(sys.argv) > 3 else 0
        apply_to_hermes(task, round_idx)
    elif cmd == "health":
        health_check()
    elif cmd == "detect":
        prompt = sys.argv[2] if len(sys.argv) > 2 else ""
        print(detect_task_type(prompt))
    elif cmd == "proxy":
        sub_cmd = sys.argv[2] if len(sys.argv) > 2 else "start"
        if sub_cmd == "start":
            start_opencode_proxy()
        elif sub_cmd == "stop":
            if os.path.exists("/tmp/opencode-proxy.pid"):
                with open("/tmp/opencode-proxy.pid") as f:
                    pid = int(f.read().strip())
                os.kill(pid, 15)
                os.remove("/tmp/opencode-proxy.pid")
                log("OpenCode proxy stopped")
        elif sub_cmd == "status":
            if os.path.exists("/tmp/opencode-proxy.pid"):
                with open("/tmp/opencode-proxy.pid") as f:
                    pid = int(f.read().strip())
                try:
                    os.kill(pid, 0)
                    print(f"OpenCode proxy: RUNNING (PID: {pid})")
                except OSError:
                    print("OpenCode proxy: STOPPED")
            else:
                print("OpenCode proxy: STOPPED")
    elif cmd == "daemon":
        daemon()
    else:
        print(f"Unknown command: {cmd}")
        sys.exit(1)
