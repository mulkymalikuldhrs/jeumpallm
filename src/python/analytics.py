import json
import time
from collections import defaultdict
from typing import Any, Optional

from .observability import Tracer


def get_analytics_overview(tracer: Tracer, timeframe_hours: int = 24) -> dict[str, Any]:
    stats = tracer.get_stats(
        time_range=(time.time() - timeframe_hours * 3600, time.time())
    )
    return {
        "timeframe_hours": timeframe_hours,
        "total_spans": stats["total_spans"],
        "avg_duration_ms": round(stats["avg_duration_ms"], 2),
        "error_rate": round(stats["error_rate"], 4),
        "span_type_breakdown": stats["by_span_type"],
    }


def get_provider_ranking(tracer: Tracer) -> list[dict[str, Any]]:
    spans = tracer.get_spans()
    by_provider: dict[str, list[float]] = defaultdict(list)
    for s in spans:
        provider = s.metadata.get("provider") or s.service
        if provider and s.duration_ms is not None:
            by_provider[provider].append(s.duration_ms)

    ranking = []
    for provider, durs in by_provider.items():
        ranking.append({
            "provider": provider,
            "avg_latency_ms": round(sum(durs) / len(durs), 2),
            "total_calls": len(durs),
        })
    ranking.sort(key=lambda x: x["avg_latency_ms"])
    return ranking


def get_model_popularity(tracer: Tracer) -> list[dict[str, Any]]:
    spans = tracer.get_spans()
    by_model: dict[str, int] = defaultdict(int)
    for s in spans:
        model = s.metadata.get("model")
        if model:
            by_model[model] += 1

    ranking = [
        {"model": model, "calls": count}
        for model, count in by_model.items()
    ]
    ranking.sort(key=lambda x: x["calls"], reverse=True)
    return ranking


def generate_report(tracer: Tracer, fmt: str = "json") -> str:
    report = {
        "generated_at": time.time(),
        "overview": get_analytics_overview(tracer),
        "provider_ranking": get_provider_ranking(tracer),
        "model_popularity": get_model_popularity(tracer),
    }
    if fmt == "json":
        return json.dumps(report, indent=2)
    if fmt == "text":
        lines = [
            f"Report generated at: {time.ctime(report['generated_at'])}",
            "",
            "--- Overview ---",
            f"  Total spans: {report['overview']['total_spans']}",
            f"  Avg duration: {report['overview']['avg_duration_ms']}ms",
            f"  Error rate: {report['overview']['error_rate']*100:.2f}%",
            "",
            "--- Provider Ranking (by latency) ---",
        ]
        for p in report["provider_ranking"]:
            lines.append(
                f"  {p['provider']}: {p['avg_latency_ms']}ms avg ({p['total_calls']} calls)"
            )
        lines.extend(["", "--- Model Popularity ---"])
        for m in report["model_popularity"]:
            lines.append(f"  {m['model']}: {m['calls']} calls")
        return "\n".join(lines)
    return report
