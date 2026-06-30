"""Cost estimation — model pricing table + token counting."""

import math
import re
from typing import Dict, Optional, List, Any

PRICING = {
    'gpt-4o': (0.005, 0.015),
    'gpt-4o-mini': (0.0015, 0.006),
    'gpt-4-turbo': (0.01, 0.03),
    'gpt-4': (0.03, 0.06),
    'gpt-3.5-turbo': (0.001, 0.002),
    'claude-3-opus': (0.015, 0.075),
    'claude-3-sonnet': (0.003, 0.015),
    'claude-3-haiku': (0.00025, 0.00125),
    'claude-3.5-sonnet': (0.003, 0.015),
    'gemini-1.5-pro': (0.0035, 0.0105),
    'gemini-1.5-flash': (0.00035, 0.00105),
    'gemini-2.0-flash': (0.0001, 0.0004),
    'deepseek-chat': (0.0005, 0.002),
    'deepseek-reasoner': (0.002, 0.008),
    'llama-3.1-70b': (0.0005, 0.0008),
    'llama-3.1-8b': (0.0001, 0.0002),
    'mistral-large': (0.002, 0.006),
    'mixtral-8x22b': (0.001, 0.003),
    'qwen-2.5-72b': (0.0005, 0.001),
    'command-r-plus': (0.0025, 0.01),
    'command-r': (0.0005, 0.0015),
}

FREE_PROVIDERS = [
    'groq', 'huggingface', 'google-ai', 'cerebras', 'claude', 'cohere',
    'blackbox', 'phind', 'pollinations', 'duckduckgo', 'freegpt', 'g4f',
    'llm7', 'inference', 'deepinfra', 'together', 'sambanova', 'cloudflare'
]

def estimate_tokens(text: str) -> int:
    cjk = len(re.findall(r'[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]', text))
    latin = len(text) - cjk
    return math.ceil(cjk / 1.5 + latin / 4)

def estimate_tokens_from_messages(messages: List[Dict]) -> int:
    total = 3
    for msg in messages:
        total += 4
        if isinstance(msg.get('content'), str):
            total += estimate_tokens(msg['content'])
        elif isinstance(msg.get('content'), list):
            for part in msg['content']:
                if isinstance(part, dict) and part.get('type') == 'text':
                    total += estimate_tokens(part.get('text', ''))
    return total

def estimate_cost(model: str, tokens_in: int, tokens_out: int) -> Dict[str, Any]:
    model_lower = model.lower()
    pricing = PRICING.get(model_lower)
    if not pricing:
        for key, val in PRICING.items():
            if key in model_lower or model_lower in key:
                pricing = val
                break

    if not pricing:
        return {'cost': None, 'currency': 'USD', 'model': model, 'note': 'Unknown model pricing'}

    in_price, out_price = pricing
    cost_in = (tokens_in / 1000) * in_price
    cost_out = (tokens_out / 1000) * out_price
    total = round(cost_in + cost_out, 6)

    return {
        'cost': total,
        'cost_input': round(cost_in, 6),
        'cost_output': round(cost_out, 6),
        'tokens_in': tokens_in,
        'tokens_out': tokens_out,
        'currency': 'USD',
        'model': model,
        'free': model_lower in [p.lower() for p in FREE_PROVIDERS] or any(
            f in model_lower for f in ['groq', 'huggingface']
        )
    }

def format_cost(cost: Optional[float]) -> str:
    if cost is None:
        return 'N/A'
    if cost == 0:
        return 'FREE'
    if cost < 0.001:
        return f'${cost:.6f}'
    if cost < 0.01:
        return f'${cost:.4f}'
    return f'${cost:.2f}'
