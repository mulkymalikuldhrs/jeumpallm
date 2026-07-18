import yaml, time, json, logging
from pathlib import Path

log = logging.getLogger("jeumpa.tasks")

DEFAULT_TASKS = {
    "coding": {"model": "pollinations/openai-fast", "fallback": ["keylessai/openai-fast", "echo"]},
    "reasoning": {"model": "keylessai/openai-fast", "fallback": ["pollinations/openai", "echo"]},
    "long_task": {"model": "pollinations/openai", "fallback": ["keylessai/default", "echo"], "timeout": 300},
    "vision": {"model": "google/gemini-2.0-flash", "fallback": ["pollinations/openai", "echo"]},
    "brainstorming": {"model": "keylessai/openai-fast", "fallback": ["pollinations/openai", "echo"]},
    "creative": {"model": "pollinations/openai", "fallback": ["keylessai/openai-fast", "echo"]},
    "fast": {"model": "echo", "fallback": []},
    "chat": {"model": "pollinations/openai", "fallback": ["keylessai/openai-fast", "echo"]},
    "balanced": {"model": "free-smart", "fallback": ["free-anon", "echo"]},
    "default": {"model": "free-smart", "fallback": ["free-anon", "pollinations/openai", "echo"]},
}

class TaskRouter:
    def __init__(self, config_path: str = None):
        self.tasks = {}
        self._load_config(config_path)

    def _load_config(self, config_path: str = None):
        cfg = {}
        if config_path and Path(config_path).exists():
            with open(config_path) as f:
                cfg = yaml.safe_load(f) or {}
        task_cfg = cfg.get("tasks", {})
        merged = {}
        for name, defaults in DEFAULT_TASKS.items():
            merged[name] = {**defaults, **(task_cfg.get(name, {}))}
        for name, custom in task_cfg.items():
            if name not in merged:
                merged[name] = custom
        self.tasks = merged

    def get_model(self, task: str) -> str:
        if not task or task not in self.tasks:
            task = "default"
        return self.tasks[task].get("model", "free-smart")

    def get_fallbacks(self, task: str) -> list:
        if not task or task not in self.tasks:
            task = "default"
        return self.tasks[task].get("fallback", [])

    def get_timeout(self, task: str) -> int:
        return self.tasks.get(task, {}).get("timeout", 120)

    def list_tasks(self) -> dict:
        return {k: {
            "model": v["model"],
            "fallback": v.get("fallback", []),
            "timeout": v.get("timeout", 120),
        } for k, v in self.tasks.items()}

    def update_task(self, task: str, config: dict):
        self.tasks[task] = config
        log.info(f"Updated task '{task}': {config}")

    def to_yaml(self) -> str:
        out = {"tasks": self.tasks}
        return yaml.dump(out, default_flow_style=False)
