import os, sys, json, asyncio, re, time
from dataclasses import dataclass, field
from typing import Any, Optional
from collections.abc import AsyncGenerator

ROOT = (Path := __import__("pathlib").Path)(__file__).parent
sys.path.insert(0, str(ROOT))

from tool_framework import ToolRegistry, ToolResult, get_default_registry

TOOL_TEXT_RE = re.compile(
    r"TOOL:\s*(\w+)\s*\nARGS:\s*(\{.*?\})\s*(?:\nRESULT:.*?(?=\nTOOL:|\Z))",
    re.DOTALL,
)


@dataclass
class AgentConfig:
    model: str = "free-smart"
    system_prompt: str = ""
    max_tool_rounds: int = 10
    max_tokens: int = 4096
    temperature: float = 0.7


class ToolCallDetected(Exception):
    def __init__(self, name: str, arguments: dict):
        self.name = name
        self.arguments = arguments
        super().__init__(f"Tool call: {name}({arguments})")


class Agent:
    def __init__(
        self,
        model: str = "free-smart",
        tools: Optional[list[str]] = None,
        system_prompt: Optional[str] = None,
        registry: Optional[ToolRegistry] = None,
        router: Any = None,
    ):
        self.config = AgentConfig(
            model=model,
            system_prompt=system_prompt or self._default_system_prompt(),
        )
        self.registry = registry or get_default_registry()
        self._router = router
        self._history: list[dict] = []
        self._enabled_tools: list[str] = tools or [
            t.name for t in self.registry.list_tools()
        ]

    def _default_system_prompt(self) -> str:
        return (
            "You are an autonomous AI agent with access to tools. "
            "Use tools to accomplish tasks. "
            "When you need information or to perform actions, call the appropriate tool. "
            "Analyze tool results and continue until the task is complete."
        )

    def _get_enabled_specs(self) -> list:
        return [
            t for t in self.registry.list_tools()
            if t.name in self._enabled_tools
        ]

    async def _call_llm(
        self,
        messages: list[dict],
        tools: Optional[list[dict]] = None,
        stream: bool = False,
    ) -> dict:
        if self._router:
            kwargs = {"model": self.config.model, "stream": stream}
            if tools and self._supports_function_calling():
                kwargs["tools"] = tools
            result = await self._router.chat_completion(messages, **kwargs)
            return result

        payload = {
            "model": self.config.model,
            "messages": messages,
            "max_tokens": self.config.max_tokens,
            "temperature": self.config.temperature,
            "stream": stream,
        }
        if tools and self._supports_function_calling():
            payload["tools"] = tools

        try:
            import httpx
            base_url = os.environ.get("JEUMPALLM_URL", "http://localhost:3456")
            async with httpx.AsyncClient(timeout=60) as client:
                resp = await client.post(
                    f"{base_url}/v1/chat/completions",
                    json=payload,
                )
                resp.raise_for_status()
                return resp.json()
        except ImportError:
            raise RuntimeError("httpx required when no router is provided")

    def _supports_function_calling(self) -> bool:
        return self.config.model in (
            "gpt-4", "gpt-4-turbo", "gpt-4o", "gpt-4o-mini",
            "gpt-3.5-turbo", "gpt-3.5-turbo-0613",
            "claude-3-opus", "claude-3-sonnet", "claude-3-haiku",
            "claude-opus-4", "claude-sonnet-4", "claude-haiku-4",
            "claude-opus-4-5", "claude-sonnet-4-5",
            "gemini-1.5-pro", "gemini-1.5-flash",
            "gemini-2.0-pro", "gemini-2.0-flash",
            "mistral-large", "mistral-small",
            "deepseek-chat", "deepseek-reasoner",
            "free-smart", "free-code",
        ) or self.config.model.startswith(("gpt-", "claude-", "gemini-", "mistral-"))

    async def chat(
        self,
        messages: list[dict],
        system_prompt: Optional[str] = None,
    ) -> AsyncGenerator[dict, None]:
        full_messages = []
        if system_prompt or self.config.system_prompt:
            full_messages.append({
                "role": "system",
                "content": system_prompt or self.config.system_prompt,
            })
        full_messages.extend(messages)

        tools_openai = (
            [t.to_openai() for t in self._get_enabled_specs()]
            if self._supports_function_calling()
            else None
        )

        result = await self._call_llm(full_messages, tools=tools_openai)

        if isinstance(result, dict) and "error" in result:
            yield {"type": "error", "content": str(result["error"])}
            return

        for chunk in self._parse_response(result, tools_openai is not None):
            yield chunk

    def _parse_response(
        self,
        response: dict,
        has_tools: bool,
    ) -> list[dict]:
        chunks = []
        choices = response.get("choices", [])

        if not choices:
            chunks.append({"type": "error", "content": "no choices in response"})
            return chunks

        msg = choices[0].get("message", {})

        content = msg.get("content", "")
        if content:
            chunks.append({"type": "text", "content": content})

        tool_calls = msg.get("tool_calls", [])
        if has_tools and tool_calls:
            for tc in tool_calls:
                function_info = tc.get("function", {})
                name = function_info.get("name", "")
                raw_args = function_info.get("arguments", "{}")
                if isinstance(raw_args, str):
                    try:
                        args = json.loads(raw_args)
                    except json.JSONDecodeError:
                        args = {}
                else:
                    args = raw_args
                chunks.append({
                    "type": "tool_call",
                    "tool_call_id": tc.get("id", "call_unknown"),
                    "name": name,
                    "arguments": args,
                })

        if has_tools or not tool_calls:
            text_calls = self._parse_text_tool_calls(content)
            for name, args in text_calls:
                chunks.append({
                    "type": "tool_call",
                    "tool_call_id": f"call_text_{name}",
                    "name": name,
                    "arguments": args,
                })

        return chunks

    def _parse_text_tool_calls(self, text: str) -> list[tuple[str, dict]]:
        matches = TOOL_TEXT_RE.findall(text)
        results = []
        for name, args_json in matches:
            try:
                args = json.loads(args_json)
            except json.JSONDecodeError:
                args = {}
            results.append((name, args))
        return results

    def detect_tool_call(self, llm_response: dict) -> Optional[tuple[str, dict]]:
        choices = llm_response.get("choices", [])
        if not choices:
            return None
        msg = choices[0].get("message", {})
        tool_calls = msg.get("tool_calls", [])
        if tool_calls:
            tc = tool_calls[0]
            func_info = tc.get("function", {})
            name = func_info.get("name", "")
            raw_args = func_info.get("arguments", "{}")
            if isinstance(raw_args, str):
                try:
                    args = json.loads(raw_args)
                except json.JSONDecodeError:
                    args = {}
            else:
                args = raw_args
            return name, args

        content = msg.get("content", "")
        text_calls = self._parse_text_tool_calls(content)
        if text_calls:
            return text_calls[0]
        return None

    async def execute_tool_call(self, name: str, arguments: dict) -> ToolResult:
        if name not in self._enabled_tools:
            return ToolResult.fail(f"Tool '{name}' is not enabled")
        return await self.registry.execute_tool(name, arguments)

    async def chat_with_tools(
        self,
        messages: list[dict],
        system_prompt: Optional[str] = None,
        max_tool_rounds: Optional[int] = None,
    ) -> dict:
        rounds = max_tool_rounds or self.config.max_tool_rounds
        prompt = system_prompt or self.config.system_prompt

        full_messages = []
        if prompt:
            full_messages.append({"role": "system", "content": prompt})
        full_messages.extend(messages)

        tools_openai = (
            [t.to_openai() for t in self._get_enabled_specs()]
            if self._supports_function_calling()
            else None
        )

        for iteration in range(rounds + 1):
            result = await self._call_llm(full_messages, tools=tools_openai)

            if isinstance(result, dict) and "error" in result:
                return result

            choices = result.get("choices", [])
            if not choices:
                return result

            msg = choices[0].get("message", {})
            assistant_content = msg.get("content", "")
            assistant_msg = {"role": "assistant", "content": assistant_content}

            tool_calls = msg.get("tool_calls", [])
            text_tool_calls = []

            if not tools_openai:
                text_tool_calls = self._parse_text_tool_calls(assistant_content)
                if text_tool_calls:
                    assistant_msg["content"] = ""

            if tool_calls:
                assistant_msg["tool_calls"] = tool_calls
                full_messages.append(assistant_msg)
            else:
                full_messages.append(assistant_msg)

            all_calls = list(tool_calls)
            for name, args in text_tool_calls:
                all_calls.append({
                    "id": f"call_text_{name}",
                    "type": "function",
                    "function": {"name": name, "arguments": json.dumps(args)},
                })

            if not all_calls:
                final_text = assistant_content
                return {
                    "choices": [{
                        "message": {
                            "role": "assistant",
                            "content": final_text,
                        }
                    }],
                    "usage": result.get("usage", {}),
                }

            for tc in all_calls:
                func_info = tc.get("function", tc)
                name = func_info.get("name", "")
                raw_args = func_info.get("arguments", "{}")
                if isinstance(raw_args, str):
                    try:
                        args = json.loads(raw_args)
                    except json.JSONDecodeError:
                        args = {}
                else:
                    args = raw_args

                tool_result = await self.execute_tool_call(name, args)
                full_messages.append({
                    "role": "tool",
                    "tool_call_id": tc.get("id", f"call_{name}"),
                    "name": name,
                    "content": json.dumps(tool_result.to_dict()),
                })

        return {"error": "max_tool_rounds_exceeded", "status": 508}


async def agent_with_tools(
    router: Any,
    messages: list[dict],
    model: str = "free-code",
    system_prompt: Optional[str] = None,
    max_tool_rounds: int = 10,
) -> dict:
    agent = Agent(model=model, router=router)
    if system_prompt:
        agent.config.system_prompt = system_prompt
    return await agent.chat_with_tools(messages, max_tool_rounds=max_tool_rounds)
