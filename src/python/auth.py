import os, re, hashlib, secrets, logging, asyncio, time
from datetime import datetime, timedelta
from collections import defaultdict
from typing import Dict, List
import aiohttp.web
from aiohttp import web
from jose import jwt
from passlib.hash import pbkdf2_sha256
from models import User, ApiKey, get_session

log = logging.getLogger("jeumpa.auth")
_public_paths = {"/", "/api", "/v1/health", "/v1/models", "/v1/tasks", "/v1/streaming", "/v1/completion"}
_public_prefixes = ("/auth/", "/static/", "/chat", "/v1/chat", "/v1/agent", "/mcp/", "/donate/", "/santri/", "/v1/conversations", "/v1/health", "/v1/paths", "/v1/tunnel", "/v1/discovery")
_jwt_secret = None
VALID_KEY_PREFIXES = ("sk-jmpp-", "jl-")
_rate_limiters: Dict[str, List[float]] = defaultdict(list)
_daily_usage: Dict[str, int] = defaultdict(int)
_last_daily_reset: Dict[str, str] = {}

def get_jwt_secret():
    global _jwt_secret
    if _jwt_secret is None:
        _jwt_secret = os.environ.get("JEUMAPPA_JWT_SECRET") or secrets.token_hex(32)
    return _jwt_secret

def hash_password(password: str) -> str:
    return pbkdf2_sha256.hash(password)

def verify_password(password: str, hash: str) -> bool:
    return pbkdf2_sha256.verify(password, hash)

def create_access_token(user_id: int, expires_delta: timedelta = timedelta(days=7)) -> str:
    payload = {"user_id": user_id, "exp": datetime.utcnow() + expires_delta, "iat": datetime.utcnow(), "type": "access"}
    return jwt.encode(payload, get_jwt_secret(), algorithm="HS256")

def create_refresh_token(user_id: int) -> str:
    payload = {"user_id": user_id, "exp": datetime.utcnow() + timedelta(days=30), "iat": datetime.utcnow(), "type": "refresh"}
    return jwt.encode(payload, get_jwt_secret(), algorithm="HS256")

def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, get_jwt_secret(), algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise ValueError("token_expired")
    except jwt.JWTError as e:
        raise ValueError(f"invalid_token: {e}")

def _hash_api_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()

def _generate_api_key(prefix: str = "sk-jmpp-") -> tuple:
    if prefix not in VALID_KEY_PREFIXES:
        prefix = "sk-jmpp-"
    raw = prefix + secrets.token_hex(32)
    return raw, raw[:8], _hash_api_key(raw)

def _check_rate_limit(key_hash: str, max_req: int, window: int) -> bool:
    if max_req <= 0:
        return True
    now = time.time()
    timestamps = _rate_limiters[key_hash]
    while timestamps and timestamps[0] < now - window:
        timestamps.pop(0)
    if len(timestamps) >= max_req:
        return False
    timestamps.append(now)
    return True

def _check_daily_quota(key_hash: str, quota: int, tokens: int = 1) -> bool:
    if quota <= 0:
        return True
    today = datetime.utcnow().strftime("%Y-%m-%d")
    if _last_daily_reset.get(key_hash) != today:
        _daily_usage[key_hash] = 0
        _last_daily_reset[key_hash] = today
    if _daily_usage[key_hash] + tokens > quota:
        return False
    _daily_usage[key_hash] += tokens
    return True

def _check_key_expiry(api_key_obj) -> bool:
    if api_key_obj.expires_at and api_key_obj.expires_at < datetime.utcnow():
        return False
    return True

def _check_ip_whitelist(api_key_obj, ip: str) -> bool:
    if not api_key_obj.ip_whitelist:
        return True
    allowed = [x.strip() for x in api_key_obj.ip_whitelist.split(",") if x.strip()]
    if not allowed:
        return True
    return ip in allowed

def _user_to_dict(user):
    return {
        "id": user.id, "email": user.email, "display_name": user.display_name,
        "tier": user.tier, "credits": user.credits, "token_balance": user.token_balance or 0,
        "tier_expires_at": user.tier_expires_at.isoformat() if user.tier_expires_at else None,
        "custom_instructions": user.custom_instructions,
        "is_active": user.is_active, "created_at": user.created_at.isoformat() if user.created_at else None
    }

def _try_attach_user(request):
    auth_header = request.headers.get("Authorization", "")
    api_key_header = request.headers.get("x-api-key", "")

    if api_key_header:
        if ":" in api_key_header:
            parts = api_key_header.split(":", 1)
            email, password = parts[0].strip().lower(), parts[1]
            with get_session() as db:
                u = db.query(User).filter(User.email == email).first()
                if u and verify_password(password, u.password_hash):
                    request["user"] = _user_to_dict(u)
                    request["user_id"] = u.id
                    request["auth_method"] = "email:password"
            return

        key_hash = _hash_api_key(api_key_header)
        with get_session() as db:
            k = db.query(ApiKey).filter(ApiKey.key_hash == key_hash, ApiKey.is_active == True).first()
            if k:
                if not _check_key_expiry(k):
                    return
                if not _check_ip_whitelist(k, request.get("remote", "") or request.headers.get("X-Forwarded-For", "").split(",")[0].strip() or request.headers.get("X-Real-IP", "") or ""):
                    return
                if not _check_rate_limit(key_hash, k.rate_limit_max, k.rate_limit_window):
                    return
                k.last_used_at = datetime.utcnow()
                u = db.query(User).filter(User.id == k.user_id).first()
                if u:
                    request["user"] = _user_to_dict(u)
                    request["user_id"] = u.id
        return

    if auth_header.startswith("Bearer "):
        try:
            payload = decode_token(auth_header[7:])
            uid = payload.get("user_id")
            with get_session() as db:
                u = db.query(User).filter(User.id == uid).first()
                if u:
                    request["user"] = _user_to_dict(u)
                    request["user_id"] = u.id
        except ValueError:
            pass

@web.middleware
async def auth_middleware(request, handler):
    if request.path in _public_paths:
        return await handler(request)
    for prefix in _public_prefixes:
        if request.path.startswith(prefix):
            _try_attach_user(request)
            return await handler(request)
    auth_header = request.headers.get("Authorization", "")
    api_key_header = request.headers.get("x-api-key", "")
    if not auth_header and not api_key_header:
        return web.json_response({"error": "authentication_required", "status": 401}, status=401)
    if api_key_header:
        if ":" in api_key_header:
            parts = api_key_header.split(":", 1)
            email, password = parts[0].strip().lower(), parts[1]
            def find_user_by_email():
                with get_session() as db:
                    u = db.query(User).filter(User.email == email).first()
                    if u and verify_password(password, u.password_hash):
                        return _user_to_dict(u), u.id
                    return None, None
            user_dict, uid = await asyncio.to_thread(find_user_by_email)
            if not user_dict:
                return web.json_response({"error": "invalid_email_or_password", "status": 401}, status=401)
            request["user"] = user_dict
            request["user_id"] = uid
            request["auth_method"] = "email:password"
            return await handler(request)

        key_hash = _hash_api_key(api_key_header)
        def find_key():
            with get_session() as db:
                return db.query(ApiKey).filter(ApiKey.key_hash == key_hash, ApiKey.is_active == True).first()
        api_key_obj = await asyncio.to_thread(find_key)
        if api_key_obj is None:
            return web.json_response({"error": "invalid_api_key", "status": 401}, status=401)
        if not _check_key_expiry(api_key_obj):
            return web.json_response({"error": "api_key_expired", "status": 401}, status=401)
        client_ip = request.get("remote", "") or request.headers.get("X-Forwarded-For", "").split(",")[0].strip() or request.headers.get("X-Real-IP", "") or ""
        if not _check_ip_whitelist(api_key_obj, client_ip):
            return web.json_response({"error": "ip_not_whitelisted", "status": 403}, status=403)
        if not _check_rate_limit(key_hash, api_key_obj.rate_limit_max, api_key_obj.rate_limit_window):
            log.warning("rate_limit_exceeded key=%s ip=%s", api_key_obj.key_prefix, client_ip)
            return web.json_response({"error": "rate_limit_exceeded", "status": 429}, status=429)
        def touch_key():
            with get_session() as db:
                k = db.query(ApiKey).filter(ApiKey.id == api_key_obj.id).first()
                if k:
                    k.last_used_at = datetime.utcnow()
                    db.commit()
        await asyncio.to_thread(touch_key)
        def get_user():
            with get_session() as db:
                u = db.query(User).filter(User.id == api_key_obj.user_id).first()
                return _user_to_dict(u) if u else None
        user_dict = await asyncio.to_thread(get_user)
        request["user"] = user_dict
        request["user_id"] = api_key_obj.user_id
        return await handler(request)
    if auth_header.startswith("Bearer "):
        try:
            payload = decode_token(auth_header[7:])
        except ValueError:
            return web.json_response({"error": "invalid_or_expired_token", "status": 401}, status=401)
        user_id = payload.get("user_id")
        def get_user():
            with get_session() as db:
                u = db.query(User).filter(User.id == user_id).first()
                return _user_to_dict(u) if u else None
        user_dict = await asyncio.to_thread(get_user)
        request["user"] = user_dict
        request["user_id"] = user_id
        return await handler(request)
    return web.json_response({"error": "invalid_authorization_header", "status": 401}, status=401)

async def handle_register(request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "invalid_json", "status": 400}, status=400)
    email = (body.get("email") or "").strip().lower()
    password = body.get("password")
    display_name = body.get("display_name")
    if not email or not password:
        return web.json_response({"error": "email_and_password_required", "status": 400}, status=400)
    if not re.match(r"[^@]+@[^@]+\.[^@]+", email):
        return web.json_response({"error": "invalid_email_format", "status": 400}, status=400)
    if len(password) < 6:
        return web.json_response({"error": "password_too_short_min_6", "status": 400}, status=400)
    def do_register():
        with get_session() as db:
            existing = db.query(User).filter(User.email == email).first()
            if existing:
                return {"error": "email_already_registered", "status": 409}, 409
            user = User(email=email, password_hash=hash_password(password), display_name=display_name or email.split("@")[0])
            db.add(user)
            db.commit()
            db.refresh(user)
            token = create_access_token(user.id)
            refresh = create_refresh_token(user.id)
            return {"access_token": token, "refresh_token": refresh, "user": _user_to_dict(user)}, 201
    result, status = await asyncio.to_thread(do_register)
    return web.json_response(result, status=status)

async def handle_login(request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "invalid_json", "status": 400}, status=400)
    email = (body.get("email") or "").strip().lower()
    password = body.get("password")
    if not email or not password:
        return web.json_response({"error": "email_and_password_required", "status": 400}, status=400)
    def do_login():
        with get_session() as db:
            user = db.query(User).filter(User.email == email).first()
            if not user or not verify_password(password, user.password_hash):
                return {"error": "invalid_credentials", "status": 401}, 401
            if not user.is_active:
                return {"error": "account_disabled", "status": 403}, 403
            token = create_access_token(user.id)
            refresh = create_refresh_token(user.id)
            return {"access_token": token, "refresh_token": refresh, "user": _user_to_dict(user)}, 200
    result, status = await asyncio.to_thread(do_login)
    return web.json_response(result, status=status)

async def handle_refresh(request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "invalid_json", "status": 400}, status=400)
    refresh_token = body.get("refresh_token", "")
    try:
        payload = decode_token(refresh_token)
    except ValueError:
        return web.json_response({"error": "invalid_refresh_token", "status": 401}, status=401)
    if payload.get("type") != "refresh":
        return web.json_response({"error": "invalid_token_type", "status": 401}, status=401)
    user_id = payload.get("user_id")
    def verify_user():
        with get_session() as db:
            user = db.query(User).filter(User.id == user_id, User.is_active == True).first()
            return user is not None
    valid = await asyncio.to_thread(verify_user)
    if not valid:
        return web.json_response({"error": "user_not_found", "status": 404}, status=404)
    return web.json_response({"access_token": create_access_token(user_id)})

async def handle_me(request):
    user_id = request.get("user_id")
    if not user_id:
        return web.json_response({"error": "unauthorized", "status": 401}, status=401)
    def get_user():
        with get_session() as db:
            user = db.query(User).filter(User.id == user_id).first()
            return user
    user = await asyncio.to_thread(get_user)
    if not user:
        return web.json_response({"error": "user_not_found", "status": 404}, status=404)
    return web.json_response({"user": _user_to_dict(user)})

async def handle_update_me(request):
    user_id = request.get("user_id")
    if not user_id:
        return web.json_response({"error": "unauthorized", "status": 401}, status=401)
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "invalid_json", "status": 400}, status=400)
    def update_user():
        with get_session() as db:
            user = db.query(User).filter(User.id == user_id).first()
            if not user:
                return {"error": "user_not_found", "status": 404}, 404
            if "display_name" in body:
                user.display_name = body["display_name"]
            if "custom_instructions" in body:
                user.custom_instructions = body["custom_instructions"]
            db.commit()
            db.refresh(user)
            return {"user": _user_to_dict(user)}, 200
    result, status = await asyncio.to_thread(update_user)
    return web.json_response(result, status=status)

async def handle_create_api_key(request):
    user_id = request.get("user_id")
    if not user_id:
        return web.json_response({"error": "unauthorized", "status": 401}, status=401)
    try:
        body = await request.json()
    except Exception:
        body = {}
    name = body.get("name", "Default")
    key_prefix_type = body.get("prefix", "sk-jmpp-")
    raw, prefix, key_hash = _generate_api_key(key_prefix_type)
    expires_at = None
    if body.get("expires_at"):
        try:
            expires_at = datetime.fromisoformat(body["expires_at"])
        except (ValueError, TypeError):
            pass
    def save_key():
        with get_session() as db:
            ak = ApiKey(
                user_id=user_id, key_prefix=prefix, key_hash=key_hash, name=name,
                rate_limit_max=body.get("rate_limit_max", 0),
                rate_limit_window=body.get("rate_limit_window", 60),
                ip_whitelist=body.get("ip_whitelist"),
                daily_quota=body.get("daily_quota", 0),
                expires_at=expires_at,
            )
            db.add(ak)
            db.commit()
            db.refresh(ak)
            return ak.id
    kid = await asyncio.to_thread(save_key)
    return web.json_response({"id": kid, "name": name, "key": raw, "key_prefix": prefix}, status=201)

async def handle_list_api_keys(request):
    user_id = request.get("user_id")
    if not user_id:
        return web.json_response({"error": "unauthorized", "status": 401}, status=401)
    def list_keys():
        with get_session() as db:
            keys = db.query(ApiKey).filter(ApiKey.user_id == user_id).all()
            return [{
                "id": k.id, "name": k.name, "key_prefix": k.key_prefix,
                "is_active": k.is_active,
                "rate_limit_max": k.rate_limit_max,
                "rate_limit_window": k.rate_limit_window,
                "ip_whitelist": k.ip_whitelist,
                "daily_quota": k.daily_quota,
                "expires_at": k.expires_at.isoformat() if k.expires_at else None,
                "created_at": k.created_at.isoformat() if k.created_at else None,
                "last_used_at": k.last_used_at.isoformat() if k.last_used_at else None,
            } for k in keys]
    result = await asyncio.to_thread(list_keys)
    return web.json_response({"data": result})

async def handle_delete_api_key(request):
    user_id = request.get("user_id")
    key_id = request.match_info.get("id")
    if not key_id:
        return web.json_response({"error": "api_key_id_required", "status": 400}, status=400)
    def delete_key():
        with get_session() as db:
            api_key = db.query(ApiKey).filter(ApiKey.id == int(key_id), ApiKey.user_id == user_id).first()
            if api_key is None:
                return {"error": "api_key_not_found", "status": 404}, 404
            db.delete(api_key)
            db.commit()
            return {"status": "deleted"}, 200
    result, status = await asyncio.to_thread(delete_key)
    return web.json_response(result, status=status)

def setup_auth(app, _db_factory=None):
    app.middlewares.append(auth_middleware)
    app.router.add_post("/auth/register", handle_register)
    app.router.add_post("/auth/login", handle_login)
    app.router.add_post("/auth/refresh", handle_refresh)
    app.router.add_get("/auth/me", handle_me)
    app.router.add_put("/auth/me", handle_update_me)
    app.router.add_post("/auth/api-keys", handle_create_api_key)
    app.router.add_get("/auth/api-keys", handle_list_api_keys)
    app.router.add_delete("/auth/api-keys/{id}", handle_delete_api_key)
    return auth_middleware
