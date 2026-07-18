import time, asyncio, json, logging, hashlib
from typing import Optional

log = logging.getLogger("jeumpa.fugu")

FUGU_STRATEGY_LLM_JUDGE = "llm_judge"
FUGU_STRATEGY_CONSENSUS = "consensus"
FUGU_STRATEGY_CONFIDENCE = "confidence"
FUGU_STRATEGY_WEIGHTED = "weighted"
FUGU_STRATEGY_HYBRID = "hybrid"
FUGU_STRATEGIES = [FUGU_STRATEGY_LLM_JUDGE, FUGU_STRATEGY_CONSENSUS,
                   FUGU_STRATEGY_CONFIDENCE, FUGU_STRATEGY_WEIGHTED, FUGU_STRATEGY_HYBRID]

FUGU_DEFAULT_CONFIG = {
    "strategy": FUGU_STRATEGY_HYBRID,
    "judge_model": "auto",
    "timeout": 60,
    "min_responses": 2,
    "max_models": 5,
    "consensus_threshold": 0.6,
    "return_all": False,
}


class FuguMode:
    def __init__(self, router):
        self.router = router
        self.config = dict(FUGU_DEFAULT_CONFIG)
        self._judge_cache = {}

    async def ask(self, messages: list, models: list = None, strategy: str = None,
                  timeout: int = None, return_all: bool = None, **kwargs) -> dict:
        strat = strategy or self.config["strategy"]
        to = timeout or self.config["timeout"]
        ra = return_all if return_all is not None else self.config["return_all"]

        targets = models or self._select_targets()
        if len(targets) < 2:
            return {"error": "Need at least 2 models for Fugu ensemble", "status": 400}

        start = time.time()
        responses = await self._fan_out(messages, targets, to)
        elapsed = time.time() - start

        success = [(m, r) for m, r in responses if r and "error" not in r]
        if len(success) < self.config["min_responses"]:
            return {"error": f"Only {len(success)}/{len(targets)} models responded",
                    "responses": {m: r for m, r in responses}, "status": 502}

        scores = await self._score(strat, messages, success)
        best_model, best_resp = max(success, key=lambda x: scores.get(x[0], 0))
        best_score = scores.get(best_model, 0)

        result = {
            "fugu": True,
            "strategy": strat,
            "models_queried": len(targets),
            "models_responded": len(success),
            "elapsed_ms": round(elapsed * 1000, 2),
            "best_model": best_model,
            "best_score": round(best_score, 3),
            "choices": [{
                "index": 0,
                "message": {"role": "assistant", "content": self._extract_content(best_resp)},
                "finish_reason": "stop",
            }],
            "usage": self._merge_usage(success),
            "scores": {m: round(s, 3) for m, s in scores.items()},
        }
        if ra:
            result["all_responses"] = {
                m: {"content": self._extract_content(r), "score": round(scores.get(m, 0), 3)}
                for m, r in success
            }
        return result

    def _select_targets(self) -> list:
        pool = []
        seen = set()
        for model, providers in self.router.model_map.items():
            for pname in providers:
                key = f"{pname}/{model}"
                if key not in seen:
                    seen.add(key)
                    pool.append(key)
        max_m = self.config["max_models"]
        pool.sort()
        return pool[:max_m] if max_m else pool

    async def _fan_out(self, messages: list, targets: list, timeout: int) -> list:
        async def query_one(target: str):
            try:
                result = await asyncio.wait_for(
                    self.router.chat_completion(messages, model=target),
                    timeout=timeout,
                )
                return target, result
            except asyncio.TimeoutError:
                return target, {"error": "timeout"}
            except Exception as e:
                return target, {"error": str(e)}

        return await asyncio.gather(*[query_one(t) for t in targets])

    async def _score(self, strategy: str, messages: list,
                     responses: list) -> dict[str, float]:
        if strategy == FUGU_STRATEGY_LLM_JUDGE:
            return await self._score_llm_judge(messages, responses)
        elif strategy == FUGU_STRATEGY_CONSENSUS:
            return self._score_consensus(responses)
        elif strategy == FUGU_STRATEGY_CONFIDENCE:
            return self._score_confidence(responses)
        elif strategy == FUGU_STRATEGY_WEIGHTED:
            return self._score_weighted(responses)
        else:
            hs = self._score_weighted(responses)
            js = await self._score_llm_judge(messages, responses)
            return {m: hs.get(m, 0) * 0.3 + js.get(m, 0) * 0.7 for m, _ in responses}

    async def _score_llm_judge(self, messages: list, responses: list) -> dict[str, float]:
        judge_model = self.config["judge_model"]
        content_list = "\n\n---\n\n".join(
            f"Response from {m}:\n{self._extract_content(r)[:2000]}"
            for m, r in responses
        )

        judge_prompt = [{
            "role": "user",
            "content": (
                "You are a judge. Evaluate each response below on a scale of 0.0 to 1.0 "
                "based on: accuracy, completeness, clarity, helpfulness.\n\n"
                f"Original query:\n{messages[-1]['content'] if messages else 'N/A'}\n\n"
                f"{content_list}\n\n"
                "Return ONLY a JSON object with model names as keys and scores as values, like:\n"
                '{"model_a": 0.85, "model_b": 0.70}'
            )
        }]

        try:
            cache_key = hashlib.md5(json.dumps(judge_prompt, sort_keys=True).encode()).hexdigest()
            if cache_key in self._judge_cache:
                return self._judge_cache[cache_key]

            result = await asyncio.wait_for(
                self.router.chat_completion(judge_prompt, model=judge_model),
                timeout=30,
            )
            content = self._extract_content(result)
            json_str = content.strip()
            if "```" in json_str:
                json_str = json_str.split("```")[1]
                if json_str.startswith("json"):
                    json_str = json_str[4:]
            scores = json.loads(json_str)
            validated = {m: max(0.0, min(1.0, float(scores.get(m, 0.5))))
                         for m, _ in responses}
            self._judge_cache[cache_key] = validated
            if len(self._judge_cache) > 200:
                self._judge_cache.clear()
            return validated
        except Exception as e:
            log.warning(f"Judge LLM failed: {e}")
            return {m: 0.5 for m, _ in responses}

    def _score_consensus(self, responses: list) -> dict[str, float]:
        texts = [self._extract_content(r).lower().split() for m, r in responses]
        if not texts:
            return {}
        all_words = set()
        for t in texts:
            all_words.update(t)
        doc_freq = {w: sum(1 for t in texts if w in t) for w in all_words}
        scores = {}
        for i, (m, _) in enumerate(responses):
            if not texts[i]:
                scores[m] = 0
                continue
            score = sum(doc_freq.get(w, 0) for w in set(texts[i])) / (len(set(texts[i])) + 1)
            scores[m] = (score / max(len(responses), 2)) if score > 0 else 0
        if scores:
            mx = max(scores.values())
            if mx > 0:
                scores = {m: s / mx for m, s in scores.items()}
        return scores

    def _score_confidence(self, responses: list) -> dict[str, float]:
        scores = {}
        for m, r in responses:
            pname = m.split("/", 1)[0] if "/" in m else m
            provider = self.router.providers.get(pname)
            if not provider:
                scores[m] = 0.5
                continue
            health = 1.0
            if provider.consecutive_failures > 5:
                health = 0.2
            elif provider.consecutive_failures > 2:
                health = 0.5
            latency_score = max(0.0, 1.0 - (provider.latency_ms / 10000)) if provider.latency_ms > 0 else 0.5
            scores[m] = health * 0.6 + latency_score * 0.4
        return scores

    def _score_weighted(self, responses: list) -> dict[str, float]:
        scores = {}
        for m, r in responses:
            pname = m.split("/", 1)[0] if "/" in m else m
            provider = self.router.providers.get(pname)
            if not provider:
                scores[m] = 0.5
                continue
            priority_score = 1.0 - (provider.config.priority / 100)
            health_score = 1.0 if provider.consecutive_failures == 0 else max(0.0, 1.0 - (provider.consecutive_failures * 0.15))
            latency_score = max(0.0, 1.0 - (provider.latency_ms / 5000)) if provider.latency_ms > 0 else 0.5
            scores[m] = priority_score * 0.3 + health_score * 0.4 + latency_score * 0.3
        return scores

    def _extract_content(self, result: dict) -> str:
        if not result or "error" in result:
            return ""
        choices = result.get("choices", [])
        if choices:
            return choices[0].get("message", {}).get("content", "")
        return result.get("content", result.get("text", json.dumps(result)))

    def _merge_usage(self, responses: list) -> dict:
        total = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
        for _, r in responses:
            u = r.get("usage", {}) or {}
            total["prompt_tokens"] += u.get("prompt_tokens", 0)
            total["completion_tokens"] += u.get("completion_tokens", 0)
            total["total_tokens"] += u.get("total_tokens", 0)
        return total

    def get_status(self) -> dict:
        return {
            "config": self.config,
            "strategies": FUGU_STRATEGIES,
        }

    def update_config(self, updates: dict):
        for k, v in updates.items():
            if k in self.config:
                self.config[k] = v
        log.info(f"Fugu config updated: {updates}")
        return self.config
