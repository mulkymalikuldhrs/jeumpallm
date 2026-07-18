import uuid, time, json, logging
from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import Optional, Any
from collections import OrderedDict

log = logging.getLogger("jeumpa.a2a")


class TaskState(str, Enum):
    SUBMITTED = "submitted"
    WORKING = "working"
    INPUT_REQUIRED = "input-required"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELED = "canceled"


_VALID_TRANSITIONS: dict[TaskState, set[TaskState]] = {
    TaskState.SUBMITTED: {TaskState.WORKING, TaskState.COMPLETED, TaskState.FAILED},
    TaskState.WORKING: {TaskState.INPUT_REQUIRED, TaskState.COMPLETED, TaskState.FAILED, TaskState.CANCELED},
    TaskState.INPUT_REQUIRED: {TaskState.WORKING, TaskState.CANCELED},
    TaskState.COMPLETED: set(),
    TaskState.FAILED: set(),
    TaskState.CANCELED: set(),
}


@dataclass
class AgentSkill:
    id: str
    name: str
    description: str = ""
    tags: list[str] = field(default_factory=list)
    examples: list[str] = field(default_factory=list)


@dataclass
class AgentCapabilities:
    streaming: bool = False
    pushNotifications: bool = False
    stateTransitionHistory: bool = False


@dataclass
class AgentCard:
    name: str
    description: str = ""
    url: str = ""
    version: str = "1.0.0"
    capabilities: AgentCapabilities = field(default_factory=AgentCapabilities)
    skills: list[AgentSkill] = field(default_factory=list)
    authentication: dict = field(default_factory=lambda: {"schemes": ["none"]})
    defaultInputModes: list[str] = field(default_factory=lambda: ["text"])
    defaultOutputModes: list[str] = field(default_factory=lambda: ["text"])

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "description": self.description,
            "url": self.url,
            "version": self.version,
            "capabilities": asdict(self.capabilities),
            "skills": [asdict(s) for s in self.skills],
            "authentication": self.authentication,
            "defaultInputModes": self.defaultInputModes,
            "defaultOutputModes": self.defaultOutputModes,
        }

    def to_well_known(self) -> dict:
        card = self.to_dict()
        card["protocolVersion"] = "0.2.1"
        card["provider"] = {"organization": "Jeumpa LLM"}
        return card


@dataclass
class MessagePart:
    type: str  # "text" or "file"
    text: Optional[str] = None
    file: Optional[dict] = None


class A2AMessage:
    def __init__(self, role: str, parts: Optional[list[MessagePart]] = None):
        self.role = role
        self.parts = parts or []
        self.metadata: dict = {}

    @staticmethod
    def user(content: str) -> "A2AMessage":
        return A2AMessage("user", [MessagePart(type="text", text=content)])

    @staticmethod
    def agent(content: str) -> "A2AMessage":
        return A2AMessage("agent", [MessagePart(type="text", text=content)])

    @staticmethod
    def with_file(content: str, file: dict) -> "A2AMessage":
        return A2AMessage("user", [
            MessagePart(type="text", text=content),
            MessagePart(type="file", file={"mimeType": file["mimeType"], "data": file["data"]}),
        ])

    def to_dict(self) -> dict:
        return {
            "role": self.role,
            "parts": [
                {"type": p.type, **({"text": p.text} if p.text else {}), **({"file": p.file} if p.file else {})}
                for p in self.parts
            ],
            "metadata": self.metadata,
        }


class A2ATask:
    def __init__(self, task_id: Optional[str] = None, status: TaskState = TaskState.SUBMITTED):
        self.id = task_id or str(uuid.uuid4())
        self.status = status
        self.history: list[dict] = []
        self.metadata: dict = {}
        self.artifacts: list[dict] = []

    def transition(self, new_state: TaskState, message: str = "") -> "A2ATask":
        allowed = _VALID_TRANSITIONS.get(self.status, set())
        if new_state not in allowed:
            raise ValueError(f"Invalid transition: {self.status.value} -> {new_state.value}")
        self.history.append({
            "from": self.status.value,
            "to": new_state.value,
            "message": message,
            "timestamp": int(time.time() * 1000),
        })
        self.status = new_state
        return self

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "status": self.status.value,
            "history": self.history,
            "metadata": self.metadata,
            "artifacts": self.artifacts,
        }


class TaskManager:
    def __init__(self):
        self._tasks: OrderedDict[str, A2ATask] = OrderedDict()

    def create_task(self, task_id: Optional[str] = None) -> A2ATask:
        task = A2ATask(task_id=task_id)
        self._tasks[task.id] = task
        return task

    def get_task(self, task_id: str) -> Optional[A2ATask]:
        return self._tasks.get(task_id)

    def update_task(self, task_id: str, **updates) -> Optional[A2ATask]:
        task = self._tasks.get(task_id)
        if not task:
            return None
        for key, value in updates.items():
            if hasattr(task, key):
                setattr(task, key, value)
        return task

    def list_tasks(self, status: Optional[TaskState] = None) -> list[A2ATask]:
        if status:
            return [t for t in self._tasks.values() if t.status == status]
        return list(self._tasks.values())

    def delete_task(self, task_id: str) -> bool:
        return self._tasks.pop(task_id, None) is not None


class AgentCardManager:
    def __init__(self):
        self._agents: dict[str, tuple[AgentCard, Optional[callable]]] = {}

    def register(self, name: str, card: AgentCard, handler: Optional[callable] = None):
        self._agents[name] = (card, handler)

    def get_card(self, name: str) -> Optional[AgentCard]:
        agent = self._agents.get(name)
        return agent[0] if agent else None

    def get_handler(self, name: str) -> Optional[callable]:
        agent = self._agents.get(name)
        return agent[1] if agent else None

    def list_agents(self) -> list[AgentCard]:
        return [card for card, _ in self._agents.values()]

    def discover(self) -> list[dict]:
        return [card.to_dict() for card in self.list_agents()]


class A2AServer:
    def __init__(self, base_url: str = "http://localhost:3456"):
        self.base_url = base_url
        self.task_manager = TaskManager()
        self.card_manager = AgentCardManager()

    def register_agent(self, name: str, handler: Optional[callable] = None,
                       card_config: Optional[dict] = None) -> "A2AServer":
        cfg = card_config or {}
        card = AgentCard(
            name=name,
            url=f"{self.base_url}/a2a/{name}",
            **{k: v for k, v in cfg.items() if k in AgentCard.__dataclass_fields__},
        )
        self.card_manager.register(name, card, handler)
        return self

    def register_default_agent(self, handler: Optional[callable] = None) -> "A2AServer":
        return self.register_agent("jeumpa-llm", handler, {
            "description": "Multi-provider LLM gateway with A2A agent interoperability",
            "version": "2.0.0",
            "capabilities": AgentCapabilities(streaming=True, pushNotifications=False, stateTransitionHistory=True),
            "skills": [
                AgentSkill(id="chat", name="Chat Completion", description="Multi-provider chat", tags=["llm", "chat"]),
                AgentSkill(id="rag", name="RAG Query", description="Retrieval-augmented generation", tags=["rag", "search"]),
            ],
        })

    async def handle_request(self, agent_name: str, request_body: dict) -> dict:
        agent_card = self.card_manager.get_card(agent_name)
        if not agent_card:
            return {"error": f"Agent not found: {agent_name}", "status": 404}
        handler = self.card_manager.get_handler(agent_name)
        task = self.task_manager.create_task()
        task.transition(TaskState.WORKING, "Task received")
        try:
            if handler:
                message = request_body.get("params", {}).get("message") if request_body else None
                result = await handler(message, task)
                if isinstance(result, dict) and "output" in result:
                    task.artifacts.append({
                        "name": "response",
                        "parts": [{"type": "text", "text": result["output"]}],
                    })
            task.transition(TaskState.COMPLETED, "Task completed")
        except Exception as e:
            log.exception("A2A task failed")
            task.transition(TaskState.FAILED, str(e))
        return task.to_dict()

    async def handle_stream(self, agent_name: str, request_body: dict) -> dict:
        agent_card = self.card_manager.get_card(agent_name)
        if not agent_card:
            return {"error": f"Agent not found: {agent_name}", "status": 404}
        handler = self.card_manager.get_handler(agent_name)
        task = self.task_manager.create_task()
        task.transition(TaskState.WORKING, "Streaming task received")
        try:
            if handler:
                message = request_body.get("params", {}).get("message") if request_body else None
                async for chunk in handler(message, task, stream=True):
                    task.artifacts.append({
                        "name": "stream_chunk",
                        "parts": [{"type": "text", "text": chunk}],
                    })
            task.transition(TaskState.COMPLETED, "Streaming completed")
        except Exception as e:
            log.exception("A2A stream failed")
            task.transition(TaskState.FAILED, str(e))
        return task.to_dict()
