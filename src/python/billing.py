import os, json, asyncio, logging
try:
    import stripe
except ImportError:
    stripe = None
from datetime import datetime, timedelta
import aiohttp.web
from aiohttp import web
from models import User, Subscription, UsageLog, get_session

log = logging.getLogger("jeumpa.billing")

PLANS = {
    "free": {"name": "Free", "price_monthly": 0, "requests_per_day": 100},
    "pro": {"name": "Pro", "price_monthly": 999, "requests_per_day": 500, "price_id_env": "JEUMAPPA_STRIPE_PRICE_PRO"},
    "unlimited": {"name": "Unlimited", "price_monthly": 2999, "requests_per_day": -1, "price_id_env": "JEUMAPPA_STRIPE_PRICE_UNLIMITED"},
}

def get_stripe_key() -> str:
    return os.environ.get("JEUMAPPA_STRIPE_KEY")

def is_stripe_configured() -> bool:
    if stripe is None:
        return False
    key = get_stripe_key()
    return key is not None and len(key) > 0 and key.startswith("sk_")

def _get_base_url(request) -> str:
    forwarded = request.headers.get("X-Forwarded-Proto", "http")
    host = request.headers.get("Host", "localhost:3456")
    return f"{forwarded}://{host}"

async def handle_create_checkout(request):
    user_id = request.get("user_id")
    if not user_id:
        return web.json_response({"error": "unauthorized"}, status=401)
    if not is_stripe_configured():
        return web.json_response({"error": "stripe_not_configured"}, status=503)
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "invalid_json"}, status=400)
    tier = body.get("tier")
    if tier not in ("pro", "unlimited"):
        return web.json_response({"error": "invalid_tier", "valid_tiers": ["pro", "unlimited"]}, status=400)
    plan = PLANS[tier]
    price_id = os.environ.get(plan["price_id_env"])
    if not price_id:
        return web.json_response({"error": f"price_not_configured_for_{tier}"}, status=500)
    def get_user():
        with get_session() as db:
            return db.query(User).filter(User.id == user_id).first()
    user = await asyncio.to_thread(get_user)
    if not user:
        return web.json_response({"error": "user_not_found"}, status=404)
    stripe.api_key = get_stripe_key()
    base_url = _get_base_url(request)
    try:
        checkout = stripe.checkout.Session.create(
            customer_email=user.email,
            success_url=f"{base_url}/billing/success?session_id={{CHECKOUT_SESSION_ID}}",
            cancel_url=f"{base_url}/billing/cancel",
            mode="subscription",
            line_items=[{"price": price_id, "quantity": 1}],
            metadata={"user_id": str(user_id), "tier": tier},
        )
        return web.json_response({"url": checkout.url})
    except stripe.error.StripeError as e:
        log.error("Stripe checkout error: %s", e)
        return web.json_response({"error": "stripe_error", "detail": str(e)}, status=502)

async def handle_billing_success(request):
    session_id = request.query.get("session_id")
    if not session_id:
        return web.Response(text="Missing session_id", status=400, content_type="text/html")
    if not is_stripe_configured():
        return web.Response(text="Stripe not configured", status=503, content_type="text/html")
    stripe.api_key = get_stripe_key()
    try:
        session = stripe.checkout.Session.retrieve(session_id)
    except stripe.error.StripeError as e:
        return web.Response(text="Invalid session", status=400, content_type="text/html")
    if session.payment_status != "paid":
        return web.Response(text="Payment not completed", status=402, content_type="text/html")
    metadata = session.get("metadata", {})
    user_id_str = metadata.get("user_id")
    tier = metadata.get("tier", "pro")
    if not user_id_str:
        return web.Response(text="Missing user data", status=400, content_type="text/html")
    user_id = int(user_id_str)
    now = datetime.utcnow()
    period_end = now + timedelta(days=30)
    def update_sub():
        with get_session() as db:
            user = db.query(User).filter(User.id == user_id).first()
            if user:
                user.tier = tier
            sub = db.query(Subscription).filter(Subscription.user_id == user_id).first()
            if sub:
                sub.tier = tier
                sub.status = "active"
                sub.stripe_customer_id = session.get("customer")
                sub.stripe_subscription_id = session.get("subscription")
                sub.expires_at = period_end
            else:
                sub = Subscription(user_id=user_id, tier=tier, status="active", stripe_customer_id=session.get("customer"), stripe_subscription_id=session.get("subscription"), expires_at=period_end)
                db.add(sub)
            db.commit()
    await asyncio.to_thread(update_sub)
    return web.Response(content_type="text/html", text="""<!DOCTYPE html><html><head><title>Subscription Active</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:system-ui,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#0f0f0f;color:#e0e0e0}.card{background:#1a1a1a;padding:2rem;border-radius:12px;text-align:center;max-width:400px}.btn{display:inline-block;margin-top:1rem;padding:.75rem 1.5rem;background:#4f46e5;color:#fff;text-decoration:none;border-radius:8px}</style></head><body><div class="card"><h1>\u2705 Subscription Active</h1><p>Subscription activated.</p></div></body></html>""")

async def handle_stripe_webhook(request):
    if not is_stripe_configured():
        return web.json_response({"error": "stripe_not_configured"}, status=503)
    stripe.api_key = get_stripe_key()
    endpoint_secret = os.environ.get("JEUMAPPA_STRIPE_WEBHOOK_SECRET")
    body = await request.read()
    sig_header = request.headers.get("Stripe-Signature")
    if not sig_header:
        return web.json_response({"error": "missing_signature"}, status=400)
    try:
        event = stripe.Webhook.construct_event(body, sig_header, endpoint_secret)
    except (stripe.error.SignatureVerificationError, ValueError) as e:
        return web.json_response({"error": "invalid_signature"}, status=400)
    event_type = event.get("type")
    data = event.get("data", {}).get("object", {})
    def handle_event():
        with get_session() as db:
            if event_type == "checkout.session.completed":
                metadata = data.get("metadata", {})
                uid = metadata.get("user_id")
                tier = metadata.get("tier", "pro")
                if uid:
                    u = db.query(User).filter(User.id == int(uid)).first()
                    if u:
                        u.tier = tier
                    s = db.query(Subscription).filter(Subscription.user_id == int(uid)).first()
                    if s:
                        s.tier = tier
                        s.status = "active"
                        s.stripe_customer_id = data.get("customer")
                        s.stripe_subscription_id = data.get("subscription")
                    else:
                        s = Subscription(user_id=int(uid), tier=tier, status="active", stripe_customer_id=data.get("customer"), stripe_subscription_id=data.get("subscription"))
                        db.add(s)
                    db.commit()
            elif event_type == "invoice.paid":
                sid = data.get("subscription")
                if sid:
                    s = db.query(Subscription).filter(Subscription.stripe_subscription_id == sid).first()
                    if s:
                        s.status = "active"
                        u = db.query(User).filter(User.id == s.user_id).first()
                        if u:
                            u.tier = s.tier
                        db.commit()
            elif event_type == "customer.subscription.deleted":
                sid = data.get("id")
                if sid:
                    s = db.query(Subscription).filter(Subscription.stripe_subscription_id == sid).first()
                    if s:
                        s.status = "canceled"
                        s.tier = "free"
                        u = db.query(User).filter(User.id == s.user_id).first()
                        if u:
                            u.tier = "free"
                        db.commit()
    await asyncio.to_thread(handle_event)
    return web.json_response({"status": "ok"})

async def handle_billing_portal(request):
    user_id = request.get("user_id")
    if not user_id:
        return web.json_response({"error": "unauthorized"}, status=401)
    if not is_stripe_configured():
        return web.json_response({"error": "stripe_not_configured"}, status=503)
    def get_sub():
        with get_session() as db:
            return db.query(Subscription).filter(Subscription.user_id == user_id).first()
    sub = await asyncio.to_thread(get_sub)
    customer_id = sub.stripe_customer_id if sub else None
    if not customer_id:
        return web.json_response({"error": "no_stripe_customer"}, status=400)
    stripe.api_key = get_stripe_key()
    base_url = _get_base_url(request)
    try:
        portal = stripe.billing_portal.Session.create(customer=customer_id, return_url=f"{base_url}/billing/subscription")
        return web.json_response({"url": portal.url})
    except stripe.error.StripeError as e:
        return web.json_response({"error": "stripe_error", "detail": str(e)}, status=502)

async def handle_get_subscription(request):
    user_id = request.get("user_id")
    if not user_id:
        return web.json_response({"error": "unauthorized"}, status=401)
    def get_info():
        with get_session() as db:
            user = db.query(User).filter(User.id == user_id).first()
            if not user:
                return {"error": "user_not_found"}, 404
            sub = db.query(Subscription).filter(Subscription.user_id == user_id).first()
            plan = PLANS.get(user.tier, PLANS["free"])
            today = datetime.utcnow().date()
            used = sum(r.requests for r in db.query(UsageLog).filter(UsageLog.user_id == user_id, UsageLog.date == today).all())
            return {
                "tier": user.tier,
                "plan_name": plan["name"],
                "requests_per_day": plan["requests_per_day"],
                "requests_used_today": used,
                "requests_remaining": -1 if plan["requests_per_day"] == -1 else max(0, plan["requests_per_day"] - used),
                "subscription": {"status": sub.status if sub else "none", "expires_at": sub.expires_at.isoformat() if sub and sub.expires_at else None} if sub else None,
            }, 200
    result, status = await asyncio.to_thread(get_info)
    return web.json_response(result, status=status)

async def check_rate_limit(user_id: int) -> dict:
    def check():
        with get_session() as db:
            user = db.query(User).filter(User.id == user_id).first()
            if not user:
                return {"ok": False, "reason": "user_not_found"}
            tier_config = PLANS.get(user.tier, PLANS["free"])
            max_daily = tier_config["requests_per_day"]
            if max_daily == -1:
                return {"ok": True}
            today = datetime.utcnow().date()
            total = sum(r.requests for r in db.query(UsageLog).filter(UsageLog.user_id == user_id, UsageLog.date == today).all())
            if total >= max_daily:
                return {"ok": False, "reason": f"daily_limit_{max_daily}"}
            return {"ok": True}
    return await asyncio.to_thread(check)

def setup_billing_routes(app):
    app.router.add_post("/billing/create-checkout", handle_create_checkout)
    app.router.add_get("/billing/success", handle_billing_success)
    app.router.add_post("/billing/webhook", handle_stripe_webhook)
    app.router.add_post("/billing/portal", handle_billing_portal)
    app.router.add_get("/billing/subscription", handle_get_subscription)
