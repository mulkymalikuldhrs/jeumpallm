import uuid
import time
import threading
from dataclasses import dataclass, field
from typing import Optional
from contextlib import contextmanager, asynccontextmanager
from collections import defaultdict, deque
from enum import Enum


class TraceLevel(Enum):
    DEBUG = "debug"
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"


class SpanStatus(Enum):
    OK = "ok"
    ERROR = "error"
    TIMEOUT = "timeout"
    CANCELLED = "cancelled"


SPAN_TYPES = {"llm_call", "tool_call", "api_request", "db_query", "agent_step", "orchestration"}


@dataclass
class Span:
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    trace_id: str = ""
    parent_id: Optional[str] = None
    name: str = ""
    service: str = ""
    span_type: str = "llm_call"
    status: SpanStatus = SpanStatus.OK
    start_time: float = field(default_factory=time.time)
    end_time: Optional[float] = None
    duration_ms: Optional[float] = None
    input: Optional[dict] = None
    output: Optional[dict] = None
    error: Optional[str] = None
    metadata: dict = field(default_factory=dict)
    tags: list[str] = field(default_factory=list)
    events: list[dict] = field(default_factory=list)


class Tracer:
    def __init__(self, max_spans: int = 10000):
        self._spans: list[Span] = []
        self._max_spans = max_spans
        self._lock = threading.Lock()

    def start_span(
        self,
        name: str,
        span_type: str = "llm_call",
        trace_id: Optional[str] = None,
        parent_id: Optional[str] = None,
        metadata: Optional[dict] = None,
    ) -> Span:
        span = Span(
            trace_id=trace_id or str(uuid.uuid4()),
            parent_id=parent_id,
            name=name,
            span_type=span_type if span_type in SPAN_TYPES else "llm_call",
            metadata=metadata or {},
        )
        with self._lock:
            self._spans.append(span)
            if len(self._spans) > self._max_spans:
                self._spans.pop(0)
        return span

    def end_span(
        self,
        span: Span,
        status: SpanStatus = SpanStatus.OK,
        output: Optional[dict] = None,
        error: Optional[str] = None,
    ) -> Span:
        span.end_time = time.time()
        span.duration_ms = (span.end_time - span.start_time) * 1000
        span.status = status
        if output is not None:
            span.output = output
        if error is not None:
            span.error = error
        return span

    def add_event(self, span: Span, event_name: str, event_data: Optional[dict] = None) -> None:
        span.events.append({"name": event_name, "timestamp": time.time(), "data": event_data or {}})

    @contextmanager
    def trace(self, name: str, span_type: str = "llm_call", metadata: Optional[dict] = None):
        span = self.start_span(name, span_type, metadata=metadata)
        try:
            yield span
        except Exception as e:
            self.end_span(span, status=SpanStatus.ERROR, error=str(e))
            raise
        else:
            self.end_span(span)

    @asynccontextmanager
    async def trace_async(self, name: str, span_type: str = "llm_call", metadata: Optional[dict] = None):
        span = self.start_span(name, span_type, metadata=metadata)
        try:
            yield span
        except Exception as e:
            self.end_span(span, status=SpanStatus.ERROR, error=str(e))
            raise
        else:
            self.end_span(span)

    def get_trace(self, trace_id: str) -> list[Span]:
        with self._lock:
            return [s for s in self._spans if s.trace_id == trace_id]

    def get_spans(self, filter_dict: Optional[dict] = None) -> list[Span]:
        with self._lock:
            if not filter_dict:
                return list(self._spans)
            result = list(self._spans)
            for key, value in filter_dict.items():
                result = [s for s in result if getattr(s, key, None) == value]
            return result

    def get_stats(self, time_range: Optional[tuple[float, float]] = None) -> dict:
        with self._lock:
            spans = self._spans
            if time_range:
                start, end = time_range
                spans = [s for s in spans if s.start_time >= start and s.start_time <= end]

            total = len(spans)
            if total == 0:
                return {"total_spans": 0, "avg_duration_ms": 0, "error_rate": 0, "by_span_type": {}}

            durations = [s.duration_ms for s in spans if s.duration_ms is not None]
            errors = sum(1 for s in spans if s.status == SpanStatus.ERROR)
            by_type = defaultdict(int)
            for s in spans:
                by_type[s.span_type] += 1

            return {
                "total_spans": total,
                "avg_duration_ms": sum(durations) / len(durations) if durations else 0,
                "error_rate": errors / total,
                "by_span_type": dict(by_type),
            }

    def get_top_slow(self, limit: int = 10, min_duration: float = 1000) -> list[Span]:
        with self._lock:
            candidates = [
                s for s in self._spans
                if s.duration_ms is not None and s.duration_ms >= min_duration
            ]
            candidates.sort(key=lambda s: s.duration_ms or 0, reverse=True)
            return candidates[:limit]


class TraceAnalytics:
    def __init__(self, tracer: Tracer):
        self._tracer = tracer

    def span_count_by_type(self, time_hours: int = 24) -> dict[str, int]:
        cutoff = time.time() - (time_hours * 3600)
        spans = self._tracer.get_spans()
        spans = [s for s in spans if s.start_time >= cutoff]
        counts: dict[str, int] = defaultdict(int)
        for s in spans:
            counts[s.span_type] += 1
        return dict(counts)

    def avg_latency_by_service(self, time_hours: int = 24) -> dict[str, float]:
        cutoff = time.time() - (time_hours * 3600)
        spans = self._tracer.get_spans()
        spans = [s for s in spans if s.start_time >= cutoff and s.duration_ms is not None]
        by_service: dict[str, list[float]] = defaultdict(list)
        for s in spans:
            if s.service:
                by_service[s.service].append(s.duration_ms)
        return {svc: sum(ds) / len(ds) for svc, ds in by_service.items()}

    def error_rate_by_span_type(self, time_hours: int = 24) -> dict[str, float]:
        cutoff = time.time() - (time_hours * 3600)
        spans = self._tracer.get_spans()
        spans = [s for s in spans if s.start_time >= cutoff]
        by_type: dict[str, list[SpanStatus]] = defaultdict(list)
        for s in spans:
            by_type[s.span_type].append(s.status)
        return {
            st: sum(1 for sts in statuses if sts == SpanStatus.ERROR) / len(statuses)
            for st, statuses in by_type.items()
        }

    def get_dashboard_stats(self, time_hours: int = 24) -> dict:
        return {
            "span_count_by_type": self.span_count_by_type(time_hours),
            "avg_latency_by_service": self.avg_latency_by_service(time_hours),
            "error_rate_by_span_type": self.error_rate_by_span_type(time_hours),
        }
