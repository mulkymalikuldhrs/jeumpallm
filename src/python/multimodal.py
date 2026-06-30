import enum, io, base64, json
from dataclasses import dataclass, field
from typing import Optional, Any

class ContentType(enum.Enum):
    TEXT = "text"
    IMAGE = "image"
    AUDIO = "audio"
    CODE = "code"
    FILE = "file"
    JSON = "json"

@dataclass
class ContentBlock:
    type: ContentType
    text: Optional[str] = None
    image_url: Optional[str] = None
    image_data: Optional[bytes] = None
    audio_url: Optional[str] = None
    code: Optional[str] = None
    code_language: Optional[str] = None
    file_name: Optional[str] = None
    file_mime: Optional[str] = None
    file_data: Optional[bytes] = None
    json_data: Optional[dict] = None
    metadata: dict = field(default_factory=dict)

    @staticmethod
    def text(content: str, metadata: Optional[dict] = None) -> "ContentBlock":
        return ContentBlock(type=ContentType.TEXT, text=content, metadata=metadata or {})

    @staticmethod
    def image(url_or_base64: str, metadata: Optional[dict] = None) -> "ContentBlock":
        block = ContentBlock(type=ContentType.IMAGE, metadata=metadata or {})
        if url_or_base64.startswith(("http://", "https://", "data:")):
            block.image_url = url_or_base64
        else:
            block.image_data = url_or_base64.encode()
        return block

    @staticmethod
    def audio(url: str, metadata: Optional[dict] = None) -> "ContentBlock":
        return ContentBlock(type=ContentType.AUDIO, audio_url=url, metadata=metadata or {})

    @staticmethod
    def code(code: str, language: str = "auto", metadata: Optional[dict] = None) -> "ContentBlock":
        return ContentBlock(type=ContentType.CODE, code=code, code_language=language, metadata=metadata or {})

    @staticmethod
    def file(name: str, data: bytes, mime: str = "application/octet-stream", metadata: Optional[dict] = None) -> "ContentBlock":
        return ContentBlock(type=ContentType.FILE, file_name=name, file_data=data, file_mime=mime, metadata=metadata or {})

    @staticmethod
    def json(data: dict, metadata: Optional[dict] = None) -> "ContentBlock":
        return ContentBlock(type=ContentType.JSON, json_data=data, metadata=metadata or {})

    def to_dict(self) -> dict:
        d = {"type": self.type.value, "metadata": self.metadata}
        if self.text is not None: d["text"] = self.text
        if self.image_url is not None: d["image_url"] = self.image_url
        if self.image_data is not None: d["image_data"] = base64.b64encode(self.image_data).decode()
        if self.audio_url is not None: d["audio_url"] = self.audio_url
        if self.code is not None: d["code"] = self.code
        if self.code_language is not None: d["code_language"] = self.code_language
        if self.file_name is not None: d["file_name"] = self.file_name
        if self.file_mime is not None: d["file_mime"] = self.file_mime
        if self.file_data is not None: d["file_data"] = base64.b64encode(self.file_data).decode()
        if self.json_data is not None: d["json_data"] = self.json_data
        return d


class ContentBuilder:
    def __init__(self):
        self._blocks: list[ContentBlock] = []

    def add_text(self, text: str) -> "ContentBuilder":
        self._blocks.append(ContentBlock.text(text))
        return self

    def add_image(self, url_or_base64: str, detail: str = "auto") -> "ContentBuilder":
        block = ContentBlock.image(url_or_base64)
        if detail != "auto":
            block.metadata["detail"] = detail
        self._blocks.append(block)
        return self

    def add_audio(self, url: str) -> "ContentBuilder":
        self._blocks.append(ContentBlock.audio(url))
        return self

    def add_code(self, code: str, language: str) -> "ContentBuilder":
        self._blocks.append(ContentBlock.code(code, language))
        return self

    def add_file(self, name: str, data: bytes, mime: str) -> "ContentBuilder":
        self._blocks.append(ContentBlock.file(name, data, mime))
        return self

    def add_json(self, data: dict) -> "ContentBuilder":
        self._blocks.append(ContentBlock.json(data))
        return self

    def build(self) -> list[ContentBlock]:
        return self._blocks


class ContentConverter:
    @staticmethod
    def to_openai(content_blocks: list[ContentBlock]) -> list[dict]:
        parts = []
        for block in content_blocks:
            if block.type == ContentType.TEXT:
                parts.append({"type": "text", "text": block.text})
            elif block.type == ContentType.IMAGE:
                if block.image_url:
                    parts.append({"type": "image_url", "image_url": {"url": block.image_url}})
                elif block.image_data:
                    b64 = block.image_data.decode() if isinstance(block.image_data, bytes) else block.image_data
                    parts.append({"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}})
            elif block.type == ContentType.AUDIO:
                parts.append({"type": "text", "text": f"[Audio: {block.audio_url}]"})
            elif block.type == ContentType.CODE:
                parts.append({"type": "text", "text": f"```{block.code_language}\n{block.code}\n```"})
            elif block.type == ContentType.FILE:
                parts.append({"type": "text", "text": f"[File: {block.file_name} ({block.file_mime})]"})
            elif block.type == ContentType.JSON:
                parts.append({"type": "text", "text": json.dumps(block.json_data, indent=2)})
        return parts

    @staticmethod
    def to_anthropic(content_blocks: list[ContentBlock]) -> list[dict]:
        blocks = []
        for block in content_blocks:
            if block.type == ContentType.TEXT:
                blocks.append({"type": "text", "text": block.text})
            elif block.type == ContentType.IMAGE:
                if block.image_url:
                    blocks.append({"type": "image", "source": {"type": "url", "url": block.image_url}})
                elif block.image_data:
                    b64 = block.image_data.decode() if isinstance(block.image_data, bytes) else block.image_data
                    blocks.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": b64}})
            elif block.type == ContentType.AUDIO:
                blocks.append({"type": "text", "text": f"[Audio: {block.audio_url}]"})
            elif block.type == ContentType.CODE:
                blocks.append({"type": "text", "text": f"```{block.code_language}\n{block.code}\n```"})
            elif block.type == ContentType.FILE:
                blocks.append({"type": "text", "text": f"[File: {block.file_name} ({block.file_mime})]"})
            elif block.type == ContentType.JSON:
                blocks.append({"type": "text", "text": json.dumps(block.json_data, indent=2)})
        return blocks

    @staticmethod
    def from_openai(openai_parts: list[dict]) -> list[ContentBlock]:
        blocks = []
        for part in openai_parts:
            t = part.get("type", "")
            if t == "text":
                blocks.append(ContentBlock.text(part.get("text", "")))
            elif t == "image_url":
                url = part.get("image_url", {}).get("url", "")
                blocks.append(ContentBlock.image(url))
            elif t == "image":
                blocks.append(ContentBlock.image(part.get("image_url", {}).get("url", "")))
        return blocks

    @staticmethod
    def from_anthropic(anthropic_blocks: list[dict]) -> list[ContentBlock]:
        blocks = []
        for block in anthropic_blocks:
            t = block.get("type", "")
            if t == "text":
                blocks.append(ContentBlock.text(block.get("text", "")))
            elif t == "image":
                source = block.get("source", {})
                if source.get("type") == "url":
                    blocks.append(ContentBlock.image(source.get("url", "")))
        return blocks

    @staticmethod
    def to_text_only(content_blocks: list[ContentBlock]) -> str:
        parts = []
        for block in content_blocks:
            if block.type == ContentType.TEXT and block.text:
                parts.append(block.text)
            elif block.type == ContentType.CODE and block.code:
                parts.append(f"```{block.code_language}\n{block.code}\n```")
            elif block.type == ContentType.JSON and block.json_data:
                parts.append(json.dumps(block.json_data, indent=2))
        return "\n".join(parts)


@dataclass
class MultiModalMessage:
    role: str
    content: list[ContentBlock]
    metadata: dict = field(default_factory=dict)

    def to_openai(self) -> dict:
        return {"role": self.role, "content": ContentConverter.to_openai(self.content)}

    def to_anthropic(self) -> dict:
        return {"role": self.role, "content": ContentConverter.to_anthropic(self.content)}


class MultiModalClient:
    def __init__(self, config: Optional[dict] = None):
        config = config or {}
        self.base_url = config.get("base_url", "http://localhost:3333")
        self.default_model = config.get("model", "auto")
        self.timeout = config.get("timeout", 60)

    def prepare_request(self, messages: list[MultiModalMessage], model: str) -> dict:
        openai_messages = []
        for msg in messages:
            if isinstance(msg, MultiModalMessage):
                openai_messages.append(msg.to_openai())
            elif isinstance(msg, dict):
                openai_messages.append(msg)
            else:
                openai_messages.append({"role": "user", "content": str(msg)})
        return {
            "model": model or self.default_model,
            "messages": openai_messages,
        }

    def handle_response(self, response: dict, model: str) -> MultiModalMessage:
        content_blocks = []
        choices = response.get("choices", [])
        if choices:
            msg = choices[0].get("message", {})
            content = msg.get("content", "")
            if isinstance(content, str):
                content_blocks.append(ContentBlock.text(content))
            elif isinstance(content, list):
                content_blocks = ContentConverter.from_openai(content)
        return MultiModalMessage(role="assistant", content=content_blocks, metadata={"model": model})
