import os
from datetime import datetime, timedelta
from aiohttp import web
from models import get_session, User, SantriProfile

routes = web.RouteTableDef()

SANTRI_VALID_DAYS = int(os.getenv("JEUMAPPA_SANTRI_VALID_DAYS", "365"))
SANTRI_QUESTIONS = [
    "Apa nama pesantren Anda?",
    "Di kecamatan mana pesantren Anda berada?",
    "Siapa nama pimpinan pesantren Anda?",
    "Berapa lama Anda sudah belajar di pesantren? (dalam bulan)",
]

@routes.post("/santri/register")
async def santri_register(request):
    user = request.get("user")
    if not user:
        return web.json_response({"error": "login_required"}, status=401)

    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "invalid_json"}, status=400)

    full_name = data.get("full_name", "").strip()
    pesantren_name = data.get("pesantren_name", "").strip()
    pesantren_address = data.get("pesantren_address", "").strip()
    province = data.get("province", "Aceh").strip()
    leader_name = data.get("leader_name", "").strip()
    parent_name = data.get("parent_name", "").strip()
    parent_email = data.get("parent_email", "").strip()
    parent_phone = data.get("parent_phone", "").strip()

    if not all([full_name, pesantren_name, pesantren_address, leader_name, parent_name, parent_email, parent_phone]):
        return web.json_response({"error": "Semua field harus diisi: full_name, pesantren_name, pesantren_address, leader_name, parent_name, parent_email, parent_phone"}, status=400)

    if province.lower() not in ("aceh", "nanggroe aceh darussalam", "aceh darussalam"):
        return web.json_response({"error": "Program santri gratis hanya untuk wilayah Aceh"}, status=400)

    with get_session() as s:
        existing = s.query(SantriProfile).filter_by(user_id=user["id"]).first()
        if existing:
            return web.json_response({
                "error": "Sudah terdaftar",
                "status": existing.verification_status
            }, status=400)

        profile = SantriProfile(
            user_id=user["id"],
            full_name=full_name,
            pesantren_name=pesantren_name,
            pesantren_address=pesantren_address,
            province=province,
            leader_name=leader_name,
            parent_name=parent_name,
            parent_email=parent_email,
            parent_phone=parent_phone,
            verification_status="pending",
        )
        s.add(profile)

    return web.json_response({
        "status": "registered",
        "message": "Pendaftaran santri berhasil. Silakan jawab pertanyaan verifikasi di POST /santri/verify",
        "questions": SANTRI_QUESTIONS
    })

@routes.post("/santri/verify")
async def santri_verify(request):
    user = request.get("user")
    if not user:
        return web.json_response({"error": "login_required"}, status=401)

    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "invalid_json"}, status=400)

    answers = data.get("answers", [])

    if not answers or len(answers) < len(SANTRI_QUESTIONS):
        return web.json_response({
            "error": f"Harap jawab {len(SANTRI_QUESTIONS)} pertanyaan",
            "questions": SANTRI_QUESTIONS
        }, status=400)

    with get_session() as s:
        profile = s.query(SantriProfile).filter_by(user_id=user["id"]).first()
        if not profile:
            return web.json_response({"error": "Silakan daftar dulu di POST /santri/register"}, status=400)
        if profile.verification_status == "verified":
            return web.json_response({"error": "Santri sudah terverifikasi"}, status=400)

        pesantren_answer = answers[0].strip().lower()
        if pesantren_answer != profile.pesantren_name.strip().lower():
            profile.verification_status = "rejected"
            return web.json_response({
                "status": "rejected",
                "error": "Nama pesantren tidak cocok dengan pendaftaran"
            }, status=400)

        profile.verification_status = "verified"
        profile.verified_at = datetime.utcnow()
        profile.expires_at = datetime.utcnow() + timedelta(days=SANTRI_VALID_DAYS)

        db_user = s.query(User).filter_by(id=user["id"]).first()
        db_user.tier = "santri"
        db_user.tier_expires_at = profile.expires_at

    return web.json_response({
        "status": "verified",
        "tier": "santri",
        "message": "Selamat! Anda mendapatkan akses gratis JeumpaLLM selama 1 tahun.",
        "expires_at": profile.expires_at.isoformat()
    })

@routes.get("/santri/status")
async def santri_status(request):
    user = request.get("user")
    if not user:
        return web.json_response({"error": "login_required"}, status=401)

    with get_session() as s:
        profile = s.query(SantriProfile).filter_by(user_id=user["id"]).first()
        db_user = s.query(User).filter_by(id=user["id"]).first()
        if not profile:
            return web.json_response({
                "registered": False,
                "tier": db_user.tier,
                "token_balance": db_user.token_balance or 0,
            })
        return web.json_response({
            "registered": True,
            "full_name": profile.full_name,
            "pesantren_name": profile.pesantren_name,
            "verification_status": profile.verification_status,
            "verified_at": profile.verified_at.isoformat() if profile.verified_at else None,
            "expires_at": profile.expires_at.isoformat() if profile.expires_at else None,
            "tier": db_user.tier,
            "token_balance": db_user.token_balance or 0,
        })
