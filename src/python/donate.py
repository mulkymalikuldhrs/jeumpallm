import os, uuid, json
from datetime import datetime, timedelta
from aiohttp import web
from models import get_session, User, Donation

routes = web.RouteTableDef()

TOKENS_PER_UNIT = int(os.getenv("JEUMAPPA_TOKENS_PER_UNIT", "10"))
DONATION_VALID_DAYS = int(os.getenv("JEUMAPPA_DONATION_VALID_DAYS", "30"))
DAYS_PER_TOKEN = 0.3
EXTENSION_MIN = 30
EXTENSION_MAX = 90

WALLET_PHONE = os.getenv("JEUMAPPA_WALLET_PHONE", "085322624048")

def token_for_amount(amount):
    return amount * TOKENS_PER_UNIT

def donation_extension_days(token_amount):
    return min(EXTENSION_MAX, max(EXTENSION_MIN, int(token_amount * DAYS_PER_TOKEN)))

def get_payment_methods():
    return {
        "dana": {
            "label": "DANA",
            "type": "ewallet",
            "account": os.getenv("JEUMAPPA_WALLET_DANA", WALLET_PHONE),
            "name": os.getenv("JEUMAPPA_WALLET_DANA_NAME", "M. Dhaher"),
            "instructions": "Buka DANA → Kirim ke nomor di atas. Masukkan kode referensi sebagai catatan.",
            "icon": "dana",
        },
        "ovo": {
            "label": "OVO",
            "type": "ewallet",
            "account": os.getenv("JEUMAPPA_WALLET_OVO", WALLET_PHONE),
            "name": os.getenv("JEUMAPPA_WALLET_OVO_NAME", "M. Dhaher"),
            "instructions": "Buka OVO → Transfer ke nomor di atas. Masukkan kode referensi sebagai catatan.",
            "icon": "ovo",
        },
        "gopay": {
            "label": "GoPay",
            "type": "ewallet",
            "account": os.getenv("JEUMAPPA_WALLET_GOPAY", WALLET_PHONE),
            "name": os.getenv("JEUMAPPA_WALLET_GOPAY_NAME", "M. Dhaher"),
            "instructions": "Buka GoPay → Kirim ke nomor di atas. Masukkan kode referensi sebagai catatan.",
            "icon": "gopay",
        },
        "shopeepay": {
            "label": "ShopeePay",
            "type": "ewallet",
            "account": os.getenv("JEUMAPPA_WALLET_SHOPEEPAY", WALLET_PHONE),
            "name": os.getenv("JEUMAPPA_WALLET_SHOPEEPAY_NAME", "M. Dhaher"),
            "instructions": "Buka ShopeePay → Kirim ke nomor di atas. Gunakan kode referensi.",
            "icon": "shopeepay",
        },
        "qris": {
            "label": "QRIS",
            "type": "qris",
            "account": os.getenv("JEUMAPPA_WALLET_QRIS_ID", WALLET_PHONE),
            "name": os.getenv("JEUMAPPA_WALLET_QRIS_NAME", "M. Dhaher"),
            "instructions": "Scan QRIS merchant atau transfer ke nomor tujuan. Konfirmasi dengan kode referensi.",
            "icon": "qris",
        },
        "bsi": {
            "label": "BSI (Bank Syariah Indonesia)",
            "type": "bank",
            "account": os.getenv("JEUMAPPA_WALLET_BSI_ACCOUNT", "1234567890"),
            "name": os.getenv("JEUMAPPA_WALLET_BSI_NAME", "YAYASAN PENDIDIKAN JEUMAPA"),
            "instructions": "Transfer BSI ke rekening di atas. Gunakan kode referensi sebagai berita transfer.",
            "icon": "bsi",
        },
        "mandiri": {
            "label": "Bank Mandiri",
            "type": "bank",
            "account": os.getenv("JEUMAPPA_WALLET_MANDIRI_ACCOUNT", ""),
            "name": os.getenv("JEUMAPPA_WALLET_MANDIRI_NAME", "M. Dhaher"),
            "instructions": "Transfer Mandiri ke rekening di atas.",
            "icon": "mandiri",
        },
        "bca": {
            "label": "BCA",
            "type": "bank",
            "account": os.getenv("JEUMAPPA_WALLET_BCA_ACCOUNT", ""),
            "name": os.getenv("JEUMAPPA_WALLET_BCA_NAME", "M. Dhaher"),
            "instructions": "Transfer BCA ke rekening di atas.",
            "icon": "bca",
        },
        "linkaja": {
            "label": "LinkAja",
            "type": "ewallet",
            "account": os.getenv("JEUMAPPA_WALLET_LINKAJA", WALLET_PHONE),
            "name": os.getenv("JEUMAPPA_WALLET_LINKAJA_NAME", "M. Dhaher"),
            "instructions": "Kirim via LinkAja ke nomor di atas.",
            "icon": "linkaja",
        },
    }

@routes.get("/donate/methods")
async def get_methods(request):
    methods = get_payment_methods()
    return web.json_response({
        "methods": [
            {
                "key": k,
                "label": v["label"],
                "type": v["type"],
                "icon": v["icon"],
                "account": v["account"] or "-",
                "name": v["name"] or "-",
            }
            for k, v in methods.items() if v.get("account")
        ]
    })

@routes.get("/donate/tiers")
async def get_tiers(request):
    tiers_data = [
        {"amount": 10000, "tokens": token_for_amount(10000), "label": "Santunan Santri"},
        {"amount": 25000, "tokens": token_for_amount(25000), "label": "Dukungan Santri"},
        {"amount": 50000, "tokens": token_for_amount(50000), "label": "Beasiswa Santri"},
        {"amount": 100000, "tokens": token_for_amount(100000), "label": "Pendidikan Santri"},
        {"amount": 250000, "tokens": token_for_amount(250000), "label": "Pesantren Berkah"},
        {"amount": 500000, "tokens": token_for_amount(500000), "label": "Pesantren Maju"},
    ]
    for t in tiers_data:
        t["valid_days"] = donation_extension_days(t["tokens"])
    return web.json_response({
        "unit": "IDR",
        "tokens_per_unit": TOKENS_PER_UNIT,
        "min_donation": 0,
        "extension_min": EXTENSION_MIN,
        "extension_max": EXTENSION_MAX,
        "valid_days": DONATION_VALID_DAYS,
        "note": "Makin besar donasi, makin panjang masa aktif (30-90 hari). Token menumpuk, masa aktif diperpanjang otomatis.",
        "tiers": tiers_data,
        "custom": True,
    })

@routes.post("/donate/create")
async def create_donation(request):
    user = request.get("user")
    if not user:
        return web.json_response({"error": "login_required"}, status=401)

    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "invalid_json"}, status=400)

    amount = data.get("amount", 0)
    if amount <= 0:
        return web.json_response({"error": "jumlah donasi harus lebih dari 0"}, status=400)

    currency = data.get("currency", "IDR")
    payment_method = data.get("payment_method", "dana")
    token_amount = token_for_amount(amount)
    payment_ref = f"DON-{uuid.uuid4().hex[:12].upper()}"
    expires_at = datetime.utcnow() + timedelta(days=DONATION_VALID_DAYS)

    methods = get_payment_methods()
    pm = methods.get(payment_method, methods.get("dana"))
    if not pm or not pm.get("account"):
        return web.json_response({"error": f"metode pembayaran {payment_method} tidak tersedia"}, status=400)

    with get_session() as s:
        don = Donation(
            user_id=user["id"],
            amount=amount,
            currency=currency,
            token_amount=token_amount,
            payment_method=payment_method,
            payment_ref=payment_ref,
            status="pending",
            expires_at=expires_at,
        )
        s.add(don)
        s.flush()
        don_id = don.id

    return web.json_response({
        "donation_id": don_id,
        "payment_ref": payment_ref,
        "amount": amount,
        "currency": currency,
        "token_amount": token_amount,
        "status": "pending",
        "expires_at": expires_at.isoformat(),
        "payment_method": payment_method,
        "payment_instructions": {
            "method": pm["label"],
            "type": pm["type"],
            "account": pm["account"],
            "name": pm["name"],
            "note": f"Gunakan kode {payment_ref} sebagai referensi pembayaran",
            "instructions": pm["instructions"],
        },
    })

@routes.post("/donate/confirm")
async def confirm_donation(request):
    user = request.get("user")
    if not user:
        return web.json_response({"error": "login_required"}, status=401)

    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "invalid_json"}, status=400)

    payment_ref = data.get("payment_ref")
    if not payment_ref:
        return web.json_response({"error": "payment_ref diperlukan"}, status=400)

    with get_session() as s:
        don = s.query(Donation).filter_by(payment_ref=payment_ref, user_id=user["id"]).first()
        if not don:
            return web.json_response({"error": "donasi tidak ditemukan"}, status=404)
        if don.status != "pending":
            return web.json_response({"error": f"donasi sudah {don.status}"}, status=400)

        don.status = "confirmed"
        db_user = s.query(User).filter_by(id=user["id"]).first()

        ext_days = donation_extension_days(don.token_amount)
        now = datetime.utcnow()
        current_exp = db_user.tier_expires_at
        if current_exp and current_exp > now:
            expires = current_exp + timedelta(days=ext_days)
        else:
            expires = now + timedelta(days=ext_days)

        db_user.token_balance = (db_user.token_balance or 0) + don.token_amount
        db_user.tier = "donor"
        db_user.tier_expires_at = expires

        return web.json_response({
            "status": "confirmed",
            "token_amount": don.token_amount,
            "total_balance": db_user.token_balance,
            "tier": "donor",
            "expires_at": expires.isoformat(),
            "extension_days": ext_days,
        })

@routes.get("/donate/status")
async def donation_status(request):
    user = request.get("user")
    if not user:
        return web.json_response({"error": "login_required"}, status=401)

    with get_session() as s:
        dons = s.query(Donation).filter_by(user_id=user["id"]).order_by(Donation.created_at.desc()).all()
        db_user = s.query(User).filter_by(id=user["id"]).first()
        return web.json_response({
            "tier": db_user.tier,
            "token_balance": db_user.token_balance or 0,
            "tier_expires_at": db_user.tier_expires_at.isoformat() if db_user.tier_expires_at else None,
            "donations": [
                {
                    "id": d.id,
                    "amount": d.amount,
                    "currency": d.currency,
                    "token_amount": d.token_amount,
                    "payment_method": d.payment_method,
                    "status": d.status,
                    "created_at": d.created_at.isoformat(),
                    "expires_at": d.expires_at.isoformat() if d.expires_at else None,
                }
                for d in dons
            ]
        })

@routes.post("/donate/webhook")
async def donation_webhook(request):
    body = await request.text()
    data = {}
    content_type = request.content_type or ""
    if "json" in content_type:
        try:
            data = await request.json()
        except Exception:
            data = {}
    else:
        try:
            data = json.loads(body)
        except Exception:
            data = {}

    payment_ref = (
        data.get("payment_ref")
        or data.get("external_id")
        or data.get("order_id")
        or data.get("reference")
    )
    if not payment_ref:
        return web.json_response({"error": "no_payment_ref"})

    with get_session() as s:
        don = s.query(Donation).filter_by(payment_ref=payment_ref).first()
        if not don:
            return web.json_response({"error": "donation_not_found", "payment_ref": payment_ref})
        if don.status != "pending":
            return web.json_response({"status": "already", "donation_status": don.status})

        don.status = "confirmed"
        db_user = s.query(User).filter_by(id=don.user_id).first()
        if not db_user:
            return web.json_response({"error": "user_not_found"})

        ext_days = donation_extension_days(don.token_amount)
        now = datetime.utcnow()
        current_exp = db_user.tier_expires_at
        if current_exp and current_exp > now:
            expires = current_exp + timedelta(days=ext_days)
        else:
            expires = now + timedelta(days=ext_days)

        db_user.token_balance = (db_user.token_balance or 0) + don.token_amount
        db_user.tier = "donor"
        db_user.tier_expires_at = expires

        return web.json_response({
            "status": "confirmed",
            "payment_ref": payment_ref,
            "user_id": don.user_id,
            "token_amount": don.token_amount,
            "extension_days": ext_days,
            "expires_at": expires.isoformat(),
        })
