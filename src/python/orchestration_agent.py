"""Agent interface wrapping the graph-based orchestration engine."""

import asyncio
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional

from orchestration import Engine, ExecutionContext, GraphDefinition, WorkflowRegistry


class WorkerStatus(Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class WorkerRecord:
    id: str
    graph_id: str
    graph_name: str
    status: WorkerStatus
    progress: list[dict] = field(default_factory=list)
    input: dict = field(default_factory=dict)
    result: Optional[dict] = None
    error: Optional[str] = None
    created_at: float = 0.0
    completed_at: Optional[float] = None

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "graph_id": self.graph_id,
            "graph_name": self.graph_name,
            "status": self.status.value,
            "progress": self.progress,
            "input": self.input,
            "result": self.result,
            "error": self.error,
            "created_at": self.created_at,
            "completed_at": self.completed_at,
        }


class AgentWorker:
    """Wraps a single graph execution as an async task."""

    def __init__(
        self,
        engine: Engine,
        registry: WorkflowRegistry,
        graph_id: str,
        input_data: Optional[dict] = None,
    ):
        self._engine = engine
        self._registry = registry
        self._graph_id = graph_id
        self._input = input_data or {}
        self._cancelled = False
        self._task: Optional[asyncio.Task] = None

        graph = registry.get(graph_id)
        self._record = WorkerRecord(
            id=str(uuid.uuid4()),
            graph_id=graph_id,
            graph_name=graph.name if graph else "unknown",
            status=WorkerStatus.PENDING,
            input=self._input,
            created_at=time.time(),
        )

    @property
    def id(self) -> str:
        return self._record.id

    @property
    def record(self) -> WorkerRecord:
        return self._record

    def start(self) -> asyncio.Task:
        self._task = asyncio.create_task(self._run())
        return self._task

    def cancel(self) -> None:
        self._cancelled = True
        if self._task and not self._task.done():
            self._task.cancel()
        self._record.status = WorkerStatus.CANCELLED

    async def _run(self) -> None:
        self._record.status = WorkerStatus.RUNNING
        graph = self._registry.get(self._graph_id)

        if not graph:
            self._record.status = WorkerStatus.FAILED
            self._record.error = f"Graph not found: {self._graph_id}"
            return

        context = ExecutionContext(variables=dict(self._input))
        context.metadata["start_time"] = time.time()

        try:
            async for event in self._engine.execute_graph(graph, context=context):
                if self._cancelled:
                    break
                self._record.progress.append(event)

                if event["type"] == "graph_complete":
                    self._record.status = WorkerStatus.COMPLETED
                    self._record.result = event["state"]
                elif event["type"] == "graph_error":
                    self._record.status = WorkerStatus.FAILED
                    self._record.error = event.get("error", "Unknown error")
                elif event["type"] == "error":
                    self._record.status = WorkerStatus.FAILED
                    self._record.error = event.get("message", "Unknown error")

        except asyncio.CancelledError:
            self._record.status = WorkerStatus.CANCELLED
        except Exception as e:
            self._record.status = WorkerStatus.FAILED
            self._record.error = str(e)

        if self._record.status == WorkerStatus.RUNNING:
            self._record.status = WorkerStatus.COMPLETED

        self._record.completed_at = time.time()


class AgentManager:
    """Manages multiple agent workers in memory."""

    def __init__(self, engine: Optional[Engine] = None, registry: Optional[WorkflowRegistry] = None):
        self._engine = engine or Engine()
        self._registry = registry or WorkflowRegistry()
        self._workers: dict[str, AgentWorker] = {}

    @property
    def engine(self) -> Engine:
        return self._engine

    @property
    def registry(self) -> WorkflowRegistry:
        return self._registry

    def submit(self, graph_id: str, input_data: Optional[dict] = None) -> str:
        worker = AgentWorker(self._engine, self._registry, graph_id, input_data)
        self._workers[worker.id] = worker
        worker.start()
        return worker.id

    def get_status(self, worker_id: str) -> Optional[dict]:
        worker = self._workers.get(worker_id)
        if not worker:
            return None
        return worker.record.to_dict()

    def get_progress(self, worker_id: str) -> Optional[list[dict]]:
        worker = self._workers.get(worker_id)
        if not worker:
            return None
        return worker.record.progress

    def cancel(self, worker_id: str) -> bool:
        worker = self._workers.get(worker_id)
        if not worker:
            return False
        worker.cancel()
        return True

    def list_workers(self) -> list[dict]:
        return [w.record.to_dict() for w in self._workers.values()]

    def list_active(self) -> list[dict]:
        return [
            w.record.to_dict()
            for w in self._workers.values()
            if w.record.status in (WorkerStatus.PENDING, WorkerStatus.RUNNING)
        ]

    def cleanup_completed(self, max_age_seconds: float = 3600) -> int:
        now = time.time()
        to_remove = []
        for wid, worker in self._workers.items():
            r = worker.record
            if r.status in (WorkerStatus.COMPLETED, WorkerStatus.FAILED, WorkerStatus.CANCELLED):
                if r.completed_at and (now - r.completed_at) > max_age_seconds:
                    to_remove.append(wid)
        for wid in to_remove:
            del self._workers[wid]
        return len(to_remove)
