import os, uuid
from datetime import datetime, date
from contextlib import contextmanager
from sqlalchemy import create_engine, Column, Integer, String, Boolean, DateTime, Date, Text, ForeignKey, func
from sqlalchemy.orm import DeclarativeBase, relationship, sessionmaker

class Base(DeclarativeBase):
    pass

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    email = Column(String, unique=True, nullable=False)
    password_hash = Column(String, nullable=False)
    display_name = Column(String)
    tier = Column(String, default="free")
    credits = Column(Integer, default=0)
    token_balance = Column(Integer, default=0)
    tier_expires_at = Column(DateTime, nullable=True)
    custom_instructions = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    api_keys = relationship("ApiKey", back_populates="user")
    sessions = relationship("Session", back_populates="user")
    conversations = relationship("Conversation", back_populates="user")
    usage_logs = relationship("UsageLog", back_populates="user")
    donation = relationship("Donation", uselist=False, back_populates="user")
    santri_profile = relationship("SantriProfile", uselist=False, back_populates="user")

class ApiKey(Base):
    __tablename__ = "api_keys"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    key_prefix = Column(String(8), nullable=False)
    key_hash = Column(String, nullable=False)
    name = Column(String)
    is_active = Column(Boolean, default=True)
    rate_limit_max = Column(Integer, default=0)
    rate_limit_window = Column(Integer, default=60)
    ip_whitelist = Column(String, nullable=True)
    daily_quota = Column(Integer, default=0)
    expires_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    last_used_at = Column(DateTime, nullable=True)
    user = relationship("User", back_populates="api_keys")

class Session(Base):
    __tablename__ = "sessions"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    token_hash = Column(String, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    user = relationship("User", back_populates="sessions")

class Conversation(Base):
    __tablename__ = "conversations"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    title = Column(String(200), nullable=False)
    model = Column(String(100), nullable=False)
    task = Column(String(50), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    user = relationship("User", back_populates="conversations")
    messages = relationship("Message", back_populates="conversation", cascade="all, delete-orphan")
    memory_entries = relationship("MemoryEntry", back_populates="conversation", cascade="all, delete-orphan")

class Message(Base):
    __tablename__ = "messages"
    id = Column(Integer, primary_key=True)
    conversation_id = Column(String, ForeignKey("conversations.id"), nullable=False)
    role = Column(String(20), nullable=False)
    content = Column(Text, nullable=False)
    tokens = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    conversation = relationship("Conversation", back_populates="messages")

class UsageLog(Base):
    __tablename__ = "usage_logs"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    ip_address = Column(String, nullable=True)
    date = Column(Date, default=lambda: datetime.utcnow().date())
    tokens_in = Column(Integer, default=0)
    tokens_out = Column(Integer, default=0)
    requests = Column(Integer, default=0)
    api_key_id = Column(Integer, ForeignKey("api_keys.id"), nullable=True)
    user = relationship("User", back_populates="usage_logs")

class Donation(Base):
    __tablename__ = "donations"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    amount = Column(Integer, default=0)
    currency = Column(String, default="IDR")
    token_amount = Column(Integer, default=0)
    payment_method = Column(String)
    payment_ref = Column(String, unique=True)
    status = Column(String, default="pending")
    expires_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    user = relationship("User", back_populates="donation")

class SantriProfile(Base):
    __tablename__ = "santri_profiles"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False)
    full_name = Column(String, nullable=False)
    pesantren_name = Column(String, nullable=False)
    pesantren_address = Column(Text, nullable=False)
    province = Column(String, default="Aceh")
    leader_name = Column(String, nullable=False)
    parent_name = Column(String, nullable=False)
    parent_email = Column(String, nullable=False)
    parent_phone = Column(String, nullable=False)
    verification_status = Column(String, default="pending")
    verified_at = Column(DateTime, nullable=True)
    expires_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    user = relationship("User", back_populates="santri_profile")

class MemoryEntry(Base):
    __tablename__ = "memory_entries"
    id = Column(Integer, primary_key=True)
    conversation_id = Column(String, ForeignKey("conversations.id"), nullable=False)
    message_id = Column(Integer, ForeignKey("messages.id"), nullable=False)
    vector = Column(Text, nullable=True)
    text_snippet = Column(String(500), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    conversation = relationship("Conversation", back_populates="memory_entries")

class SharedMemory(Base):
    __tablename__ = "shared_memory"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    scope = Column(String(20), default="shared")  # private | shared | public
    key = Column(String(100), nullable=True, index=True)
    title = Column(String(200), nullable=True)
    content = Column(Text, nullable=False)
    tags = Column(String(500), nullable=True)
    vector = Column(Text, nullable=True)
    source = Column(String(100), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class AnonymousUsage(Base):
    __tablename__ = "anonymous_usage"
    id = Column(Integer, primary_key=True)
    ip_address = Column(String, nullable=False)
    requests = Column(Integer, default=0)
    first_seen = Column(DateTime, default=datetime.utcnow)
    last_seen = Column(DateTime, default=datetime.utcnow)

ROOT = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(ROOT, "data", "jeumpa.db")
os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)

engine = create_engine(f"sqlite:///{DB_PATH}", echo=False)
SessionLocal = sessionmaker(bind=engine)

def init_db():
    Base.metadata.create_all(engine)

@contextmanager
def get_session():
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
