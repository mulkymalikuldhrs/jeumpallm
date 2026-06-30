"""Request logger — in-memory ring buffer."""

import time
from collections import deque
from typing import Dict, List, Any
from dataclasses import dataclass, field, asdict

MAX_LOG_ENTRIES = 2000

@dataclass
class LogEntry:
    timestamp: float
    method: str
    path: str
    status: int
    model: str = ''
    provider: str = ''
    latency_ms: float = 0.0
    tokens_in: int = 0
    tokens_out: int = 0
    cost: float = 0.0
    error: str = ''
    ip: str = ''

class RequestLogger:
    def __init__(self, max_entries: int = MAX_LOG_ENTRIES):
        self._entries = deque(maxlen=max_entries)

    def log(self, entry: LogEntry):
        self._entries.append(entry)

    def get_entries(self, page: int = 1, limit: int = 50, status_filter: str = '') -> Dict[str, Any]:
        entries = list(self._entries)
        if status_filter == 'error':
            entries = [e for e in entries if e.status >= 400]
        elif status_filter == 'success':
            entries = [e for e in entries if e.status < 400]

        total = len(entries)
        total_pages = max(1, (total + limit - 1) // limit)
        start = (page - 1) * limit
        end = start + limit
        page_entries = entries[start:end] if start < total else []

        return {
            'entries': [asdict(e) for e in page_entries],
            'page': page,
            'limit': limit,
            'total': total,
            'total_pages': total_pages,
        }

    def get_stats(self) -> Dict:
        entries = list(self._entries)
        total = len(entries)
        errors = sum(1 for e in entries if e.status >= 400)
        avg_latency = sum(e.latency_ms for e in entries) / total if total else 0
        return {
            'total_requests': total,
            'error_count': errors,
            'error_rate': round(errors / total * 100, 2) if total else 0,
            'avg_latency_ms': round(avg_latency, 1),
        }


_logger: RequestLogger = None

def get_logger() -> RequestLogger:
    global _logger
    if _logger is None:
        _logger = RequestLogger()
    return _logger
