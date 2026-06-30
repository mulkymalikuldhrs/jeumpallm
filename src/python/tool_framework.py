import os, sys, json, asyncio, time, subprocess, inspect, shlex, tempfile, shutil
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional
from collections.abc import AsyncGenerator

ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT))


@dataclass
class ToolSchema:
    type: str = "object"
    properties: dict = field(default_factory=dict)
    required: List[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        d = {"type": self.type, "properties": self.properties}
        if self.required:
            d["required"] = self.required
        return d

    @classmethod
    def from_dict(cls, d: dict) -> "ToolSchema":
        return cls(
            type=d.get("type", "object"),
            properties=d.get("properties", {}),
            required=d.get("required", []),
        )


@dataclass
class ToolSpec:
    name: str
    description: str
    schema: ToolSchema

    def to_openai(self) -> dict:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.schema.to_dict(),
            },
        }


@dataclass
class ToolResult:
    success: bool
    output: str
    error: Optional[str] = None
    data: Optional[dict] = None
    duration_ms: float = 0.0

    @classmethod
    def ok(cls, output: Any, data: Optional[dict] = None, duration_ms: float = 0.0) -> "ToolResult":
        return cls(success=True, output=str(output), data=data, duration_ms=duration_ms)

    @classmethod
    def fail(cls, error: str, duration_ms: float = 0.0) -> "ToolResult":
        return cls(success=False, output="", error=error, duration_ms=duration_ms)

    def to_dict(self) -> dict:
        return {
            "success": self.success,
            "output": self.output,
            "error": self.error,
            "data": self.data,
            "duration_ms": self.duration_ms,
        }


class ToolCategory(Enum):
    FILESYSTEM = "filesystem"
    TERMINAL = "terminal"
    WEB = "web"
    GIT = "git"
    CODE = "code"
    CUSTOM = "custom"


@dataclass
class Tool:
    spec: ToolSpec
    handler: Callable
    category: ToolCategory = ToolCategory.CUSTOM
    timeout_seconds: int = 30

    @property
    def name(self) -> str:
        return self.spec.name

    async def execute(self, arguments: dict) -> ToolResult:
        start = time.time()
        try:
            if inspect.iscoroutinefunction(self.handler):
                result = await asyncio.wait_for(
                    self.handler(arguments), timeout=self.timeout_seconds
                )
            else:
                result = await asyncio.wait_for(
                    asyncio.to_thread(self.handler, arguments), timeout=self.timeout_seconds
                )
            elapsed = (time.time() - start) * 1000
            if isinstance(result, ToolResult):
                result.duration_ms = elapsed
                return result
            return ToolResult.ok(result, duration_ms=elapsed)
        except asyncio.TimeoutError:
            elapsed = (time.time() - start) * 1000
            return ToolResult.fail(f"Tool timed out after {self.timeout_seconds}s", elapsed)
        except Exception as e:
            elapsed = (time.time() - start) * 1000
            return ToolResult.fail(str(e), elapsed)

    def to_openai(self) -> dict:
        return self.spec.to_openai()


class ToolRegistry:
    def __init__(self):
        self._tools: Dict[str, Tool] = {}

    def register_tool(self, tool: Tool) -> "ToolRegistry":
        self._tools[tool.name] = tool
        return self

    def get_tool(self, name: str) -> Optional[Tool]:
        return self._tools.get(name)

    def list_tools(self, category: Optional[ToolCategory] = None) -> List[ToolSpec]:
        if category is None:
            return [t.spec for t in self._tools.values()]
        return [t.spec for t in self._tools.values() if t.category == category]

    def unregister_tool(self, name: str) -> bool:
        if name in self._tools:
            del self._tools[name]
            return True
        return False

    async def execute_tool(self, name: str, arguments: dict) -> ToolResult:
        tool = self._tools.get(name)
        if not tool:
            return ToolResult.fail(f"Tool not found: {name}")
        return await tool.execute(arguments)

    def get_openai_tools(self, category: Optional[ToolCategory] = None) -> List[dict]:
        specs = self.list_tools(category)
        return [s.to_openai() for s in specs]

    def execute_openai_tool_call(self, tool_call: dict) -> dict:
        tc_id = tool_call.get("id", "call_unknown")
        function_info = tool_call.get("function", {})
        name = function_info.get("name", "")
        try:
            args = json.loads(function_info.get("arguments", "{}"))
        except json.JSONDecodeError:
            args = {}
        result = asyncio.run(self.execute_tool(name, args))
        return {
            "tool_call_id": tc_id,
            "role": "tool",
            "name": name,
            "content": json.dumps(result.to_dict()),
        }


_default_registry: Optional[ToolRegistry] = None


def get_default_registry() -> ToolRegistry:
    global _default_registry
    if _default_registry is None:
        _default_registry = ToolRegistry()
        _register_builtins(_default_registry)
    return _default_registry


def _safe_path(path_str: str) -> Path:
    p = Path(path_str).expanduser().resolve()
    return p


async def _builtin_read_file(args: dict) -> str:
    path = _safe_path(args.get("path", ""))
    if not path.is_file():
        return json.dumps({"error": "file not found"})
    content = path.read_text(encoding="utf-8", errors="replace")
    if len(content) > 100000:
        content = content[:100000] + "\n...[truncated]"
    return json.dumps({"content": content, "path": str(path), "bytes": len(content)})


async def _builtin_write_file(args: dict) -> str:
    path = _safe_path(args.get("path", ""))
    content = args.get("content", "")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return json.dumps({"success": True, "path": str(path), "bytes": len(content)})


ALLOWED_COMMANDS = frozenset({
    "python3", "python", "node", "sh", "bash",
    "git", "ls", "cat", "head", "tail", "wc", "echo", "printf",
    "mkdir", "cp", "mv", "pip", "pip3", "npm",
    "grep", "find", "sort", "uniq", "which", "type", "chmod", "pwd",
    "make", "gcc", "g++", "rustc", "go", "cargo",
})

async def _builtin_run_command(args: dict) -> str:
    command = args.get("command", "")
    timeout = args.get("timeout", 30)
    parts = shlex.split(command)
    if not parts:
        return json.dumps({"error": "empty command", "stdout": "", "stderr": "", "exit_code": -1})
    executable = parts[0]
    if executable not in ALLOWED_COMMANDS:
        return json.dumps({
            "error": f"command not allowed: {executable}",
            "allowed": sorted(ALLOWED_COMMANDS),
            "stdout": "", "stderr": "", "exit_code": -1
        })
    tmpdir = None
    try:
        tmpdir = tempfile.mkdtemp(prefix="jeumpa_tool_")
        proc = await asyncio.create_subprocess_exec(
            *parts,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=tmpdir,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        try:
            proc.kill()
        except Exception:
            pass
        return json.dumps({"error": "timeout", "stdout": "", "stderr": ""})
    except ValueError as e:
        return json.dumps({"error": f"invalid command: {e}", "stdout": "", "stderr": ""})
    finally:
        if tmpdir:
            shutil.rmtree(tmpdir, ignore_errors=True)
    return json.dumps({
        "stdout": stdout.decode(errors="replace")[-8192:],
        "stderr": stderr.decode(errors="replace")[-8192:],
        "exit_code": proc.returncode,
    })


async def _builtin_search_web(args: dict) -> str:
    query = args.get("query", "")
    try:
        import httpx
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                "https://api.duckduckgo.com/",
                params={"q": query, "format": "json"},
            )
            data = resp.json()
            return json.dumps({
                "results": data.get("AbstractText", ""),
                "source": "duckduckgo",
            })
    except ImportError:
        return json.dumps({"error": "httpx not available", "source": "none"})
    except Exception as e:
        return json.dumps({"error": str(e), "source": "none"})


async def _builtin_list_directory(args: dict) -> str:
    path = _safe_path(args.get("path", "."))
    if not path.is_dir():
        return json.dumps({"error": "not a directory"})
    entries = []
    for f in path.iterdir():
        try:
            entries.append({"name": f.name, "type": "dir" if f.is_dir() else "file", "size": f.stat().st_size})
        except OSError:
            entries.append({"name": f.name, "type": "unknown"})
    return json.dumps({"files": entries, "path": str(path), "count": len(entries)})


async def _builtin_git_status(args: dict) -> str:
    repo_path = _safe_path(args.get("repo_path", "."))
    cwd_arg = {"cwd": str(repo_path)}
    try:
        proc = await asyncio.create_subprocess_exec(
            "git", "status", "--short",
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            cwd=str(repo_path),
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=10)
        return json.dumps({
            "stdout": stdout.decode(errors="replace"),
            "stderr": stderr.decode(errors="replace"),
            "exit_code": proc.returncode,
        })
    except FileNotFoundError:
        return json.dumps({"error": "git not found"})
    except asyncio.TimeoutError:
        return json.dumps({"error": "timeout"})


async def _builtin_http_request(args: dict) -> str:
    url = args.get("url", "")
    method = args.get("method", "GET").upper()
    headers = args.get("headers", {})
    body = args.get("body")
    try:
        import httpx
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.request(method, url, headers=headers, content=body)
            content = resp.text
            try:
                content = json.dumps(json.loads(content))
            except (json.JSONDecodeError, ValueError):
                pass
            return json.dumps({
                "status_code": resp.status_code,
                "headers": dict(resp.headers),
                "body": content[:50000],
            })
    except ImportError:
        return json.dumps({"error": "httpx not available"})
    except Exception as e:
        return json.dumps({"error": str(e)})


_BUILTIN_DEFS = [
    ("read_file", "Read a file from the filesystem", ToolCategory.FILESYSTEM,
     {"path": {"type": "string", "description": "Absolute path to the file"}}, ["path"], _builtin_read_file),
    ("write_file", "Write content to a file", ToolCategory.FILESYSTEM,
     {"path": {"type": "string", "description": "Absolute path to the file"},
      "content": {"type": "string", "description": "Content to write"}}, ["path", "content"], _builtin_write_file),
    ("run_command", "Execute a shell command", ToolCategory.TERMINAL,
     {"command": {"type": "string", "description": "Command to execute"},
      "timeout": {"type": "number", "description": "Timeout in seconds", "default": 30}}, ["command"], _builtin_run_command),
    ("search_web", "Search the web for information", ToolCategory.WEB,
     {"query": {"type": "string", "description": "Search query"}}, ["query"], _builtin_search_web),
    ("list_directory", "List files and directories in a path", ToolCategory.FILESYSTEM,
     {"path": {"type": "string", "description": "Directory path to list", "default": "."}}, [], _builtin_list_directory),
    ("git_status", "Get git repository status", ToolCategory.GIT,
     {"repo_path": {"type": "string", "description": "Repository path", "default": "."}}, [], _builtin_git_status),
    ("http_request", "Make an HTTP request to a URL", ToolCategory.WEB,
     {"url": {"type": "string", "description": "Request URL"},
      "method": {"type": "string", "enum": ["GET", "POST", "PUT", "DELETE", "PATCH"], "default": "GET"},
      "headers": {"type": "object", "description": "Request headers", "default": {}},
      "body": {"type": "string", "description": "Request body"}}, ["url"], _builtin_http_request),
]


def _register_builtins(registry: ToolRegistry) -> None:
    for name, desc, cat, props, required, handler in _BUILTIN_DEFS:
        schema = ToolSchema(properties=props, required=required)
        spec = ToolSpec(name=name, description=desc, schema=schema)
        registry.register_tool(Tool(spec=spec, handler=handler, category=cat))


class FunctionCallConverter:
    @staticmethod
    def to_openai_format(tool_specs: List[ToolSpec]) -> List[dict]:
        return [s.to_openai() for s in tool_specs]

    @staticmethod
    def parse_openai_call(tool_call_msg: dict) -> tuple[str, dict]:
        function_info = tool_call_msg.get("function", tool_call_msg)
        name = function_info.get("name", "")
        raw_args = function_info.get("arguments", "{}")
        if isinstance(raw_args, str):
            try:
                args = json.loads(raw_args)
            except json.JSONDecodeError:
                args = {}
        else:
            args = raw_args
        return name, args

    @staticmethod
    def format_result(name: str, result: ToolResult) -> dict:
        return {
            "role": "tool",
            "name": name,
            "content": json.dumps(result.to_dict()),
        }
