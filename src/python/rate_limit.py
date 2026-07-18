import time, logging
from collections import defaultdict
from datetime import datetime, date
from aiohttp import web

log = logging.getLogger("jeumpa.ratelimit")

class RateLimiter:
    def __init__(self):
        self.buckets: dict[str, dict] = defaultdict(lambda: {"tokens": 100, "last_refill": time.time()})

    async def check(self, key: str, max_requests: int = 100, window_seconds: int = 86400) -> dict:
        bucket = self.buckets[key]
        now = time.time()
        elapsed = now - bucket["last_refill"]
        bucket["tokens"] = min(max_requests, bucket["tokens"] + elapsed * (max_requests / window_seconds))
        bucket["last_refill"] = now
        if bucket["tokens"] >= 1:
            bucket["tokens"] -= 1
            return {"allowed": True, "remaining": int(bucket["tokens"]), "reset": int(window_seconds - elapsed)}
        return {"allowed": False, "remaining": 0, "reset": int(window_seconds - elapsed)}

rate_limiter = RateLimiter()

@web.middleware
async def rate_limit_middleware(request, handler):
    if request.path.startswith(("/static/", "/v1/health", "/donate/", "/santri/")):
        return await handler(request)

    user = request.get("user")
    ip = request.remote

    if not user:
        from models import get_session, AnonymousUsage
        with get_session() as s:
            anon = s.query(AnonymousUsage).filter_by(ip_address=ip).first()
            if not anon:
                anon = AnonymousUsage(ip_address=ip, requests=0)
                s.add(anon)
                s.flush()
            if anon.requests >= 10:
                return web.json_response({
                    "error": "anonymous_limit_exceeded",
                    "message": "Anda telah mencapai 10 pertanyaan gratis. Silakan login untuk melanjutkan.",
                    "login_url": "/auth/login"
                }, status=429)
            anon.requests += 1
            anon.last_seen = datetime.utcnow()
        return await handler(request)

    tier = (user.get("tier") or "free").lower()

    if tier == "donor":
        balance = user.get("token_balance", 0)
        expires = user.get("tier_expires_at")
        if balance and balance > 0 and expires:
            exp_date = datetime.fromisoformat(expires).date()
            if exp_date >= date.today():
                return await handler(request)

    user_id = user.get("id")
    limit = 1000 if tier == "santri" else (200 if tier == "donor" else 100)
    result = await rate_limiter.check(f"user:{user_id}", max_requests=limit, window_seconds=86400)
    if not result["allowed"]:
        msg = "Batas harian tercapai." if tier not in ("santri", "donor") else f"Batas harian ({limit}) tercapai."
        return web.json_response({
            "error": "daily_limit_exceeded",
            "message": msg
        },
            status=429,
            headers={"Retry-After": str(result["reset"])}
        )

    return await handler(request)
