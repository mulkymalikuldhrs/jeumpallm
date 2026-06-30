"""JeumpaLLM Agent Orchestration — graph-based execution engine"""

from __future__ import annotations

import asyncio
import json
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, AsyncGenerator, Callable, Optional


class NodeType(Enum):
    LLM = "llm"
    TOOL = "tool"
    CONDITION = "condition"
    PARALLEL = "parallel"
    AGGREGATOR = "aggregator"
    INPUT = "input"
    OUTPUT = "output"


class NodeStatus(Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"


@dataclass
class NodeConfig:
    id: str
    type: NodeType
    label: str = ""
    config: dict = field(default_factory=dict)
    next_nodes: list[str] = field(default_factory=list)


@dataclass
class Edge:
    source: str
    target: str
    condition: Optional[Callable[[dict], bool]] = None


@dataclass
class GraphDefinition:
    id: str
    name: str
    description: str = ""
    nodes: dict[str, NodeConfig] = field(default_factory=dict)
    edges: list[Edge] = field(default_factory=list)
    entry_node: Optional[str] = None
    finish_nodes: set[str] = field(default_factory=set)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "nodes": {k: {
                "id": v.id,
                "type": v.type.value,
                "label": v.label,
                "config": v.config,
                "next_nodes": v.next_nodes,
            } for k, v in self.nodes.items()},
            "edges": [{"source": e.source, "target": e.target} for e in self.edges],
            "entry_node": self.entry_node,
            "finish_nodes": list(self.finish_nodes),
        }


@dataclass
class ExecutionContext:
    variables: dict = field(default_factory=dict)
    message_history: list[dict] = field(default_factory=list)
    current_node: Optional[str] = None
    results: dict[str, Any] = field(default_factory=dict)
    errors: list[dict] = field(default_factory=list)
    metadata: dict = field(default_factory=lambda: {
        "start_time": 0,
        "node_executions": [],
        "token_usage": {"input": 0, "output": 0},
    })

    def get(self, key: str, default: Any = None) -> Any:
        return self.variables.get(key, default)

    def set(self, key: str, value: Any) -> None:
        self.variables[key] = value

    def update(self, partial: dict) -> None:
        self.variables.update(partial)

    def snapshot(self) -> dict:
        return json.loads(json.dumps(self.variables))


class Engine:
    """Graph-based execution engine for agent orchestration."""

    def __init__(self, llm_api_url: str = "http://localhost:3333"):
        self.llm_api_url = llm_api_url
        self.tools: dict[str, Callable] = {}
        self._next_node_id = 0

    def register_tool(self, name: str, fn: Callable) -> None:
        self.tools[name] = fn

    def _make_node_id(self) -> str:
        self._next_node_id += 1
        return f"node_{self._next_node_id}"

    def create_graph(
        self,
        name: str,
        nodes: list[NodeConfig],
        edges: list[Edge],
        entry_node: Optional[str] = None,
        description: str = "",
    ) -> GraphDefinition:
        graph_id = str(uuid.uuid4())
        nodes_dict = {n.id: n for n in nodes}
        finish_nodes = set()
        edge_sources = {e.source for e in edges}
        for nid in nodes_dict:
            if nid not in edge_sources:
                finish_nodes.add(nid)

        if entry_node is None:
            edge_targets = {e.target for e in edges}
            for nid in nodes_dict:
                if nid not in edge_targets:
                    entry_node = nid
                    break

        return GraphDefinition(
            id=graph_id,
            name=name,
            description=description,
            nodes=nodes_dict,
            edges=edges,
            entry_node=entry_node,
            finish_nodes=finish_nodes,
        )

    async def execute_graph(
        self,
        graph: GraphDefinition,
        initial_input: Optional[dict] = None,
        context: Optional[ExecutionContext] = None,
    ) -> AsyncGenerator[dict, None]:
        if context is None:
            context = ExecutionContext(variables=initial_input or {})
            context.metadata["start_time"] = time.time()
        elif initial_input:
            context.update(initial_input)

        if not graph.entry_node:
            yield {"type": "error", "message": "Graph has no entry node"}
            return

        yield {"type": "graph_start", "graph_id": graph.id, "name": graph.name}

        current_node_id = graph.entry_node
        iterations = 0
        max_iterations = 100

        while current_node_id and iterations < max_iterations:
            iterations += 1
            node = graph.nodes.get(current_node_id)
            if not node:
                yield {"type": "error", "message": f"Node not found: {current_node_id}"}
                break

            context.current_node = current_node_id
            yield {"type": "node_start", "node_id": current_node_id, "node_type": node.type.value}

            start_time = time.time()
            result = None

            try:
                result = await self.execute_node(node, context)
                status = NodeStatus.COMPLETED
            except Exception as e:
                result = {"error": str(e)}
                context.errors.append({"node_id": current_node_id, "error": str(e)})
                status = NodeStatus.FAILED

            context.results[current_node_id] = result
            context.metadata["node_executions"].append({
                "node_id": current_node_id,
                "duration": time.time() - start_time,
                "status": status.value,
            })

            yield {
                "type": "node_complete",
                "node_id": current_node_id,
                "status": status.value,
                "result": result,
            }

            if status == NodeStatus.FAILED:
                yield {"type": "graph_error", "node_id": current_node_id, "error": str(result.get("error", ""))}
                break

            if current_node_id in graph.finish_nodes:
                break

            edges_out = [e for e in graph.edges if e.source == current_node_id]
            next_node_id: Optional[str] = None

            for edge in edges_out:
                if not edge.condition or edge.condition(context.variables):
                    next_node_id = edge.target
                    break

            current_node_id = next_node_id

        yield {"type": "graph_complete", "state": context.snapshot()}

    async def execute_node(self, node: NodeConfig, context: ExecutionContext) -> Any:
        if node.type == NodeType.LLM:
            return await self._execute_llm_node(node, context)
        elif node.type == NodeType.TOOL:
            return await self._execute_tool_node(node, context)
        elif node.type == NodeType.CONDITION:
            return self._execute_condition_node(node, context)
        elif node.type == NodeType.PARALLEL:
            return await self._execute_parallel_node(node, context)
        elif node.type == NodeType.AGGREGATOR:
            return self._execute_aggregator_node(node, context)
        elif node.type == NodeType.INPUT:
            return context.snapshot()
        elif node.type == NodeType.OUTPUT:
            return context.snapshot()
        else:
            raise ValueError(f"Unknown node type: {node.type}")

    async def _execute_llm_node(self, node: NodeConfig, context: ExecutionContext) -> dict:
        prompt_template = node.config.get("prompt", "")
        prompt = self._render_template(prompt_template, context.variables)
        model = node.config.get("model", "auto")
        temperature = node.config.get("temperature", 0.7)
        max_tokens = node.config.get("max_tokens", 2048)
        messages = node.config.get("messages", None)

        if messages:
            rendered_messages = []
            for msg in messages:
                rendered_messages.append({
                    "role": msg.get("role", "user"),
                    "content": self._render_template(msg.get("content", ""), context.variables),
                })
        else:
            rendered_messages = [{"role": "user", "content": prompt}]

        import aiohttp
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{self.llm_api_url}/v1/chat/completions",
                json={
                    "model": model,
                    "messages": rendered_messages,
                    "max_tokens": max_tokens,
                    "temperature": temperature,
                },
                headers={"Content-Type": "application/json"},
            ) as resp:
                if not resp.ok:
                    error_text = await resp.text()
                    raise RuntimeError(f"LLM error {resp.status}: {error_text}")
                data = await resp.json()

        content = (data.get("choices") or [{}])[0].get("message", {}).get("content", "")
        context.metadata["token_usage"]["input"] += (data.get("usage") or {}).get("prompt_tokens", 0)
        context.metadata["token_usage"]["output"] += (data.get("usage") or {}).get("completion_tokens", 0)

        context.set("output", content)
        context.set("lastOutput", content)
        return {"output": content, "lastOutput": content}

    async def _execute_tool_node(self, node: NodeConfig, context: ExecutionContext) -> dict:
        tool_name = node.config.get("tool", "")
        tool_input_key = node.config.get("input_key", "input")
        tool_input = context.get(tool_input_key, context.get("output", {}))

        fn = self.tools.get(tool_name)
        if not fn:
            raise ValueError(f"Tool not registered: {tool_name}")

        if asyncio.iscoroutinefunction(fn):
            result = await fn(tool_input, context)
        else:
            result = fn(tool_input, context)

        context.set("toolResult", result)
        return {"toolResult": result}

    def _execute_condition_node(self, node: NodeConfig, context: ExecutionContext) -> dict:
        expression = node.config.get("condition", "")
        result = self._eval_condition(expression, context.variables)
        context.set("conditionResult", result)
        return {"conditionResult": result}

    async def _execute_parallel_node(self, node: NodeConfig, context: ExecutionContext) -> dict:
        branches = node.config.get("branches", [])
        tasks = []
        for branch in branches:
            tasks.append(self._execute_llm_node(
                NodeConfig(id=branch.get("id", ""), type=NodeType.LLM, config=branch),
                context,
            ))
        results = await asyncio.gather(*tasks, return_exceptions=True)
        processed = [r if not isinstance(r, Exception) else {"error": str(r)} for r in results]
        context.set("parallelResults", processed)
        return {"parallelResults": processed}

    def _execute_aggregator_node(self, node: NodeConfig, context: ExecutionContext) -> dict:
        strategy = node.config.get("strategy", "concat")
        inputs = context.get("parallelResults", [])

        if strategy == "concat":
            result = "\n\n".join(
                i.get("output", "") or i.get("lastOutput", "") or json.dumps(i)
                for i in inputs
            )
        elif strategy == "merge":
            merged = {}
            for i in inputs:
                if isinstance(i, dict):
                    merged.update(i)
            result = merged
        elif strategy == "first":
            result = inputs[0] if inputs else {}
        else:
            result = inputs

        context.set("aggregated", result)
        context.set("output", result)
        return {"aggregated": result, "output": result}

    def _render_template(self, template: str, variables: dict) -> str:
        result = template
        for key, value in variables.items():
            placeholder = "{{" + key + "}}"
            if placeholder in result:
                result = result.replace(placeholder, str(value))
        return result

    def _eval_condition(self, expression: str, variables: dict) -> bool:
        if expression.startswith("has:"):
            key = expression[4:]
            return key in variables
        elif "==" in expression:
            parts = expression.split("==", 1)
            left = parts[0].strip()
            right = parts[1].strip().strip("'\"")
            return str(variables.get(left, "")) == right
        elif "!=" in expression:
            parts = expression.split("!=", 1)
            left = parts[0].strip()
            right = parts[1].strip().strip("'\"")
            return str(variables.get(left, "")) != right
        return True


class WorkflowRegistry:
    def __init__(self):
        self._workflows: dict[str, GraphDefinition] = {}
        self._engine = Engine()
        self._seed_templates()

    def register(self, graph: GraphDefinition) -> None:
        self._workflows[graph.id] = graph

    def get(self, workflow_id: str) -> Optional[GraphDefinition]:
        return self._workflows.get(workflow_id)

    def list(self) -> list[dict]:
        return [g.to_dict() for g in self._workflows.values()]

    def delete(self, workflow_id: str) -> bool:
        return self._workflows.pop(workflow_id, None) is not None

    def get_by_name(self, name: str) -> Optional[GraphDefinition]:
        for g in self._workflows.values():
            if g.name == name:
                return g
        return None

    def _seed_templates(self) -> None:
        templates = self._build_templates()
        for t in templates:
            self.register(t)

    def _build_templates(self) -> list[GraphDefinition]:
        return [
            self._research_summarize_template(),
            self._code_review_template(),
            self._data_analysis_template(),
        ]

    def _research_summarize_template(self) -> GraphDefinition:
        input_node = NodeConfig(id="input", type=NodeType.INPUT, label="Input",
                                config={"description": "Topic to research"})
        research_node = NodeConfig(id="research", type=NodeType.LLM, label="Research",
                                   config={"prompt": "Research the following topic comprehensively: {{input}}",
                                           "model": "auto", "temperature": 0.3})
        summarize_node = NodeConfig(id="summarize", type=NodeType.LLM, label="Summarize",
                                    config={"prompt": "Summarize the following research concisely:\n\n{{output}}",
                                            "model": "auto", "temperature": 0.3})
        output_node = NodeConfig(id="output", type=NodeType.OUTPUT, label="Output",
                                 config={"description": "Final research summary"})

        return self._engine.create_graph(
            name="Research & Summarize",
            description="Takes a topic, researches it via LLM, then summarizes the findings.",
            nodes=[input_node, research_node, summarize_node, output_node],
            edges=[
                Edge(source="input", target="research"),
                Edge(source="research", target="summarize"),
                Edge(source="summarize", target="output"),
            ],
            entry_node="input",
        )

    def _code_review_template(self) -> GraphDefinition:
        input_node = NodeConfig(id="input", type=NodeType.INPUT, label="Input",
                                config={"description": "Code to review"})
        review_node = NodeConfig(id="review", type=NodeType.LLM, label="Review Code",
                                 config={"prompt": "Review the following code for bugs, security issues, and style:\n\n{{input}}",
                                         "model": "auto", "temperature": 0.2})
        suggestions_node = NodeConfig(id="suggestions", type=NodeType.LLM, label="Suggest Improvements",
                                      config={"prompt": "Based on this code review:\n\n{{output}}\n\nProvide specific improvement suggestions with code examples.",
                                              "model": "auto", "temperature": 0.4})
        output_node = NodeConfig(id="output", type=NodeType.OUTPUT, label="Output",
                                 config={"description": "Code review with suggestions"})

        return self._engine.create_graph(
            name="Code Review",
            description="Reviews code for issues and suggests improvements.",
            nodes=[input_node, review_node, suggestions_node, output_node],
            edges=[
                Edge(source="input", target="review"),
                Edge(source="review", target="suggestions"),
                Edge(source="suggestions", target="output"),
            ],
            entry_node="input",
        )

    def _data_analysis_template(self) -> GraphDefinition:
        input_node = NodeConfig(id="input", type=NodeType.INPUT, label="Input",
                                config={"description": "Data to analyze"})
        analyze_node = NodeConfig(id="analyze", type=NodeType.LLM, label="Analyze Data",
                                  config={"prompt": "Analyze the following data and identify key patterns, trends, and insights:\n\n{{input}}",
                                          "model": "auto", "temperature": 0.3})
        condition_node = NodeConfig(id="has_insights", type=NodeType.CONDITION, label="Has Insights?",
                                    config={"condition": "has:output"})
        deep_dive_node = NodeConfig(id="deep_dive", type=NodeType.LLM, label="Deep Dive",
                                    config={"prompt": "Perform a deep dive analysis on:\n\n{{output}}\n\nProvide detailed statistical insights and recommendations.",
                                            "model": "auto", "temperature": 0.3})
        output_node = NodeConfig(id="output", type=NodeType.OUTPUT, label="Output",
                                 config={"description": "Analysis results"})

        return self._engine.create_graph(
            name="Data Analysis",
            description="Analyzes data, optionally deep-dives if insights are found.",
            nodes=[input_node, analyze_node, condition_node, deep_dive_node, output_node],
            edges=[
                Edge(source="input", target="analyze"),
                Edge(source="analyze", target="has_insights"),
                Edge(source="has_insights", target="deep_dive", condition=lambda v: v.get("output") is not None),
                Edge(source="has_insights", target="output", condition=lambda v: v.get("output") is None),
                Edge(source="deep_dive", target="output"),
            ],
            entry_node="input",
        )
