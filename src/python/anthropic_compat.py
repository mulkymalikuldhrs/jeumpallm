import json, time, logging, asyncio
from dataclasses import dataclass, field, asdict
from typing import Optional

log = logging.getLogger("jeumpa.anthropic")

# ── Dataclasses ──────────────────────────────────────────────────────────

@dataclass
class AnthropicMessage:
    role: str
    content: str | list

@dataclass
class AnthropicRequest:
    model: str
    messages: list[AnthropicMessage]
    max_tokens: int = 4096
    stream: bool = False
    system: str | None = None
    temperature: float | None = None
    stop_sequences: list[str] | None = None
    metadata: dict | None = None

    @classmethod
    def from_dict(cls, d: dict):
        raw_msgs = d.get("messages", [])
        msgs = []
        for m in raw_msgs:
            msgs.append(AnthropicMessage(role=m.get("role", "user"), content=m.get("content", "")))
        return cls(
            model=d.get("model", "auto"),
            messages=msgs,
            max_tokens=d.get("max_tokens", 4096),
            stream=d.get("stream", False),
            system=d.get("system"),
            temperature=d.get("temperature"),
            stop_sequences=d.get("stop_sequences"),
            metadata=d.get("metadata"),
        )

@dataclass
class AnthropicContentBlock:
    type: str = "text"
    text: str = ""

@dataclass
class AnthropicUsage:
    input_tokens: int = 0
    output_tokens: int = 0

@dataclass
class AnthropicResponse:
    id: str = ""
    type: str = "message"
    role: str = "assistant"
    content: list[AnthropicContentBlock] = field(default_factory=lambda: [AnthropicContentBlock(text="")])
    model: str = ""
    stop_reason: str = "end_turn"
    stop_sequence: str | None = None
    usage: AnthropicUsage = field(default_factory=AnthropicUsage)

    def to_dict(self) -> dict:
        return {
            "id": self.id or f"msg_{int(time.time()*1000)}",
            "type": self.type,
            "role": self.role,
            "content": [{"type": c.type, "text": c.text} for c in self.content],
            "model": self.model,
            "stop_reason": self.stop_reason,
            "stop_sequence": self.stop_sequence,
            "usage": {"input_tokens": self.usage.input_tokens, "output_tokens": self.usage.output_tokens},
        }

@dataclass
class AnthropicStreamChunk:
    type: str = "content_block_delta"
    delta: dict | None = None
    index: int = 0
    content_block: dict | None = None

# ── STOP_REASON MAP ──────────────────────────────────────────────────────

ANTHROPIC_STOP = {"end_turn": "stop", "max_tokens": "length", "stop_sequence": "stop"}
OPENAI_STOP = {"stop": "end_turn", "length": "max_tokens"}

# ── Converter ────────────────────────────────────────────────────────────

class Converter:

    @staticmethod
    def convert_messages(anthropic_messages: list[AnthropicMessage], system: str | None = None) -> list[dict]:
        out = []
        if system:
            out.append({"role": "system", "content": system})
        for msg in anthropic_messages:
            conv = {"role": msg.role}
            if isinstance(msg.content, list):
                parts = []
                for block in msg.content:
                    if isinstance(block, dict):
                        btype = block.get("type", "text")
                        if btype == "text":
                            parts.append({"type": "text", "text": block.get("text", "")})
                        elif btype == "image":
                            source = block.get("source", {})
                            parts.append({
                                "type": "image_url",
                                "image_url": {"url": f"data:{source.get('media_type','image/png')};base64,{source.get('data','')}"}
                            })
                        else:
                            parts.append({"type": "text", "text": str(block)})
                    else:
                        parts.append({"type": "text", "text": str(block)})
                conv["content"] = parts
            else:
                conv["content"] = str(msg.content)
            if out and out[-1]["role"] == conv["role"]:
                existing = out[-1]["content"]
                if isinstance(existing, str) and isinstance(conv["content"], str):
                    out[-1]["content"] = existing + "\n" + conv["content"]
                elif isinstance(existing, list) and isinstance(conv["content"], list):
                    out[-1]["content"].extend(conv["content"])
                elif isinstance(existing, str) and isinstance(conv["content"], list):
                    out[-1]["content"] = [{"type": "text", "text": existing}] + conv["content"]
                elif isinstance(existing, list) and isinstance(conv["content"], str):
                    out[-1]["content"].append({"type": "text", "text": conv["content"]})
                continue
            out.append(conv)
        return out

    @staticmethod
    def anthropic_to_openai(anthropic_request: AnthropicRequest) -> dict:
        messages = Converter.convert_messages(anthropic_request.messages, anthropic_request.system)
        oai = {
            "messages": messages,
            "model": anthropic_request.model,
            "max_tokens": anthropic_request.max_tokens,
            "stream": anthropic_request.stream,
        }
        if anthropic_request.temperature is not None:
            oai["temperature"] = anthropic_request.temperature
        if anthropic_request.stop_sequences:
            oai["stop"] = anthropic_request.stop_sequences
        return oai

    @staticmethod
    def openai_to_anthropic(openai_response: dict, model: str) -> AnthropicResponse:
        choices = openai_response.get("choices", [{}])
        choice = choices[0] if choices else {}
        msg = choice.get("message", {})
        finish = choice.get("finish_reason", "stop")
        usage = openai_response.get("usage", {})

        content = msg.get("content", "")
        if isinstance(content, list):
            blocks = []
            for c in content:
                if isinstance(c, dict):
                    blocks.append(AnthropicContentBlock(type=c.get("type", "text"), text=c.get("text", "")))
                else:
                    blocks.append(AnthropicContentBlock(text=str(c)))
        else:
            blocks = [AnthropicContentBlock(text=content or "")]

        return AnthropicResponse(
            id=f"msg_{int(time.time()*1000)}",
            model=model,
            stop_reason=ANTHROPIC_STOP.get(finish, "end_turn"),
            content=blocks,
            usage=AnthropicUsage(
                input_tokens=usage.get("prompt_tokens", 0),
                output_tokens=usage.get("completion_tokens", 0),
            ),
        )

    @staticmethod
    def anthropic_stream_chunk_to_sse(chunk) -> str:
        events = []

        if isinstance(chunk, dict):
            choices = chunk.get("choices", [{}])
            choice = choices[0] if choices else {}
            delta = choice.get("delta", {})
            content = delta.get("content", "")
            finish = choice.get("finish_reason")

            if finish:
                events.append(f"event: message_delta\ndata: {json.dumps({
                    'type': 'message_delta',
                    'delta': {'stop_reason': ANTHROPIC_STOP.get(finish, 'end_turn'), 'stop_sequence': None},
                })}\n\n")
                events.append(f"event: message_stop\ndata: {json.dumps({'type': 'message_stop'})}\n\n")
            elif content:
                events.append(f"event: content_block_delta\ndata: {json.dumps({
                    'type': 'content_block_delta',
                    'index': 0,
                    'delta': {'type': 'text_delta', 'text': content},
                })}\n\n")
        elif isinstance(chunk, str):
            if chunk == "[DONE]":
                events.append(f"event: message_stop\ndata: {json.dumps({'type': 'message_stop'})}\n\n")
            else:
                events.append(f"event: content_block_delta\ndata: {json.dumps({
                    'type': 'content_block_delta',
                    'index': 0,
                    'delta': {'type': 'text_delta', 'text': chunk},
                })}\n\n")
        else:
            events.append(f"event: content_block_delta\ndata: {json.dumps({
                'type': 'content_block_delta',
                'index': 0,
                'delta': {'type': 'text_delta', 'text': str(chunk)},
            })}\n\n")

        return "".join(events)


# ── Handler ──────────────────────────────────────────────────────────────

class Handler:

    @staticmethod
    async def handle_messages(request_data: dict, provider_func) -> AnthropicResponse:
        anth_req = AnthropicRequest.from_dict(request_data)
        oai_request = Converter.anthropic_to_openai(anth_req)

        oai_response = await provider_func(
            messages=oai_request["messages"],
            model=oai_request["model"],
            stream=False,
        )

        if isinstance(oai_response, dict) and oai_response.get("error"):
            raise RuntimeError(oai_response.get("error", "provider_error"))

        if isinstance(oai_response, dict) and "choices" in oai_response:
            return Converter.openai_to_anthropic(oai_response, anth_req.model)

        # Raw text from fallback providers
        text = str(oai_response)
        return AnthropicResponse(
            id=f"msg_{int(time.time()*1000)}",
            model=anth_req.model,
            content=[AnthropicContentBlock(text=text)],
        )

    @staticmethod
    async def handle_streaming_messages(request_data: dict, provider_stream_func):
        anth_req = AnthropicRequest.from_dict(request_data)
        oai_request = Converter.anthropic_to_openai(anth_req)

        stream = provider_stream_func(
            messages=oai_request["messages"],
            model=oai_request["model"],
            stream=True,
        )

        # Send message_start
        yield f"event: message_start\ndata: {json.dumps({
            'type': 'message_start',
            'message': {
                'id': f'msg_{int(time.time()*1000)}',
                'type': 'message',
                'role': 'assistant',
                'content': [],
                'model': anth_req.model,
                'stop_reason': None,
                'stop_sequence': None,
                'usage': {'input_tokens': 0, 'output_tokens': 0},
            },
        })}\n\n"

        # Send content_block_start
        yield f"event: content_block_start\ndata: {json.dumps({
            'type': 'content_block_start',
            'index': 0,
            'content_block': {'type': 'text', 'text': ''},
        })}\n\n"

        text_buffer = []

        if hasattr(stream, '__aiter__'):
            async for chunk in stream:
                sse_events = Converter.anthropic_stream_chunk_to_sse(chunk)
                if sse_events:
                    yield sse_events
                if isinstance(chunk, dict):
                    choices = chunk.get("choices", [{}])
                    delta = choices[0].get("delta", {}) if choices else {}
                    c = delta.get("content", "")
                    if c:
                        text_buffer.append(c)
                elif isinstance(chunk, str) and chunk != "[DONE]":
                    text_buffer.append(chunk)

        # If stream is an awaitable returning an async iterable, handle it
        elif asyncio.iscoroutine(stream):
            real_stream = await stream
            if hasattr(real_stream, '__aiter__'):
                async for chunk in real_stream:
                    sse_events = Converter.anthropic_stream_chunk_to_sse(chunk)
                    if sse_events:
                        yield sse_events
                    if isinstance(chunk, dict):
                        choices = chunk.get("choices", [{}])
                        delta = choices[0].get("delta", {}) if choices else {}
                        c = delta.get("content", "")
                        if c:
                            text_buffer.append(c)
                    elif isinstance(chunk, str) and chunk != "[DONE]":
                        text_buffer.append(chunk)
        else:
            log.warning("handle_streaming_messages: stream is not async iterable or coroutine")

        # Final message_stop if not already sent
        yield f"event: message_stop\ndata: {json.dumps({'type': 'message_stop'})}\n\n"
