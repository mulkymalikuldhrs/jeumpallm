import sqlite3, json, threading, time
from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import Optional, List


class Category(str, Enum):
    CHAT = "chat"
    CODING = "coding"
    AUTOMATION = "automation"
    RESEARCH = "research"
    CREATIVE = "creative"
    ANALYSIS = "analysis"
    UTILITY = "utility"
    OTHER = "other"


@dataclass
class Package:
    id: str
    name: str
    version: str = "1.0.0"
    description: str = ""
    author: str = ""
    category: Category = Category.OTHER
    tags: List[str] = field(default_factory=list)
    dependencies: List[str] = field(default_factory=list)
    rating: float = 0.0
    rating_count: int = 0
    downloads: int = 0
    source_url: str = ""
    created_at: float = 0.0

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "version": self.version,
            "description": self.description,
            "author": self.author,
            "category": self.category.value if isinstance(self.category, Category) else self.category,
            "tags": self.tags,
            "dependencies": self.dependencies,
            "rating": round(self.rating, 1),
            "rating_count": self.rating_count,
            "downloads": self.downloads,
            "source_url": self.source_url,
            "created_at": self.created_at,
        }


BUILTIN_PACKAGES = [
    Package(id="code-assistant", name="Code Assistant", version="2.1.0",
            description="Write, review, and debug code across 40+ languages with context-aware suggestions",
            author="JeumpaLLM", category=Category.CODING,
            tags=["coding", "debugging", "code-review", "refactoring"],
            downloads=1520, rating=4.8, rating_count=312, created_at=time.time() - 86400 * 90),
    Package(id="research-bot", name="Research Bot", version="1.3.0",
            description="Deep multi-source research with citation extraction and synthesis",
            author="JeumpaLLM", category=Category.RESEARCH,
            tags=["research", "analysis", "citation", "deep-dive"],
            downloads=980, rating=4.5, rating_count=187, created_at=time.time() - 86400 * 60),
    Package(id="writing-helper", name="Writing Helper", version="2.0.0",
            description="Draft, refine, and polish content across genres and formats",
            author="JeumpaLLM", category=Category.CREATIVE,
            tags=["writing", "editing", "content", "creative"],
            downloads=1340, rating=4.6, rating_count=245, created_at=time.time() - 86400 * 75),
    Package(id="data-analyst", name="Data Analyst", version="1.5.0",
            description="Analyze datasets, generate visualizations, and extract statistical insights",
            author="JeumpaLLM", category=Category.ANALYSIS,
            tags=["data", "analytics", "visualization", "statistics"],
            downloads=760, rating=4.3, rating_count=98, created_at=time.time() - 86400 * 45),
    Package(id="translator", name="Translator Pro", version="1.1.0",
            description="Real-time translation between 50+ languages with cultural nuance awareness",
            author="JeumpaLLM", category=Category.UTILITY,
            tags=["translation", "languages", "i18n"],
            downloads=2100, rating=4.7, rating_count=420, created_at=time.time() - 86400 * 120),
    Package(id="teacher", name="AI Teacher", version="1.0.0",
            description="Explain concepts, generate practice problems, and tutor across subjects",
            author="JeumpaLLM", category=Category.CHAT,
            tags=["education", "tutoring", "explanation", "learning"],
            downloads=620, rating=4.2, rating_count=55, created_at=time.time() - 86400 * 30),
    Package(id="automation-agent", name="Automation Agent", version="0.9.0",
            description="Schedule tasks, trigger webhooks, and orchestrate multi-step workflows",
            author="JeumpaLLM", category=Category.AUTOMATION,
            tags=["automation", "workflow", "scheduling", "integration"],
            downloads=450, rating=4.0, rating_count=33, created_at=time.time() - 86400 * 20),
    Package(id="creative-companion", name="Creative Companion", version="1.2.0",
            description="Brainstorm ideas, generate art prompts, and co-create stories",
            author="JeumpaLLM", category=Category.CREATIVE,
            tags=["creative", "brainstorm", "art", "storytelling"],
            downloads=890, rating=4.4, rating_count=120, created_at=time.time() - 86400 * 50),
    Package(id="sentiment-analyzer", name="Sentiment Analyzer", version="1.0.0",
            description="Analyze text sentiment, emotion, and tone with actionable reports",
            author="JeumpaLLM", category=Category.ANALYSIS,
            tags=["sentiment", "nlp", "emotion", "text-analysis"],
            downloads=310, rating=3.8, rating_count=22, created_at=time.time() - 86400 * 15),
    Package(id="toolkit-utils", name="Toolkit Utilities", version="2.2.0",
            description="Collection of utility tools: calculator, weather, JSON formatter, QR generator",
            author="JeumpaLLM", category=Category.UTILITY,
            tags=["utilities", "tools", "productivity"],
            downloads=1750, rating=4.5, rating_count=290, created_at=time.time() - 86400 * 100),
]

CATEGORY_META = [
    {"id": "chat", "name": "Chat", "icon": "message-circle"},
    {"id": "coding", "name": "Coding", "icon": "code"},
    {"id": "automation", "name": "Automation", "icon": "zap"},
    {"id": "research", "name": "Research", "icon": "search"},
    {"id": "creative", "name": "Creative", "icon": "palette"},
    {"id": "analysis", "name": "Analysis", "icon": "bar-chart"},
    {"id": "utility", "name": "Utility", "icon": "tool"},
    {"id": "other", "name": "Other", "icon": "package"},
]


class MarketplaceRegistry:
    def __init__(self, db_path: Optional[str] = None):
        self._packages: dict[str, Package] = {}
        self._lock = threading.Lock()
        self._db_path = db_path
        if db_path:
            self._init_db()
        self._seed()

    def _init_db(self):
        conn = sqlite3.connect(self._db_path)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS packages (
                id TEXT PRIMARY KEY, name TEXT, version TEXT, description TEXT,
                author TEXT, category TEXT, tags TEXT, dependencies TEXT,
                rating REAL, rating_count INTEGER, downloads INTEGER,
                source_url TEXT, created_at REAL
            )
        """)
        conn.commit()
        conn.close()

    def _seed(self):
        for pkg in BUILTIN_PACKAGES:
            self._packages[pkg.id] = pkg

    def register_package(self, pkg: Package) -> Package:
        with self._lock:
            self._packages[pkg.id] = pkg
            if self._db_path:
                self._persist(pkg)
        return pkg

    def get_package(self, id: str) -> Optional[Package]:
        return self._packages.get(id)

    def search(self, query: str = "", category: Optional[str] = None,
               tags: Optional[List[str]] = None, sort: str = "downloads",
               limit: int = 20) -> List[dict]:
        q = query.lower().strip()
        results = []
        for pkg in self._packages.values():
            if category and pkg.category.value != category:
                continue
            if tags:
                if not any(t in pkg.tags for t in tags):
                    continue
            if q:
                match = (q in pkg.id.lower() or q in pkg.name.lower()
                         or q in pkg.description.lower()
                         or any(q in t.lower() for t in pkg.tags))
                if not match:
                    continue
            results.append(pkg.to_dict())
        rev = True
        if sort == "rating":
            results.sort(key=lambda p: p["rating"], reverse=rev)
        elif sort == "name":
            results.sort(key=lambda p: p["name"].lower())
            rev = False
        elif sort == "newest":
            results.sort(key=lambda p: p["created_at"], reverse=rev)
        else:
            results.sort(key=lambda p: p["downloads"], reverse=rev)
        return results[:limit]

    def get_popular(self, limit: int = 10) -> List[dict]:
        pkgs = sorted(self._packages.values(), key=lambda p: p.downloads, reverse=True)
        return [p.to_dict() for p in pkgs[:limit]]

    def get_featured(self, limit: int = 5) -> List[dict]:
        pkgs = [p for p in self._packages.values() if p.rating >= 4.0 and p.downloads >= 100]
        pkgs.sort(key=lambda p: p.rating, reverse=True)
        return [p.to_dict() for p in pkgs[:limit]]

    def get_categories(self) -> List[dict]:
        return CATEGORY_META

    def rate_package(self, id: str, rating: float) -> Optional[Package]:
        with self._lock:
            pkg = self._packages.get(id)
            if not pkg:
                return None
            rating = max(1.0, min(5.0, rating))
            total = pkg.rating * pkg.rating_count + rating
            pkg.rating_count += 1
            pkg.rating = total / pkg.rating_count
            if self._db_path:
                self._persist(pkg)
            return pkg

    def increment_downloads(self, id: str) -> Optional[Package]:
        with self._lock:
            pkg = self._packages.get(id)
            if not pkg:
                return None
            pkg.downloads += 1
            if self._db_path:
                self._persist(pkg)
            return pkg

    def get_package_stats(self, id: str) -> Optional[dict]:
        pkg = self._packages.get(id)
        if not pkg:
            return None
        return {
            "downloads": pkg.downloads,
            "rating": round(pkg.rating, 1),
            "rating_count": pkg.rating_count,
            "category": pkg.category.value,
            "tags": pkg.tags,
        }

    def _persist(self, pkg: Package):
        conn = sqlite3.connect(self._db_path)
        conn.execute("""
            INSERT OR REPLACE INTO packages
            (id, name, version, description, author, category, tags, dependencies,
             rating, rating_count, downloads, source_url, created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, (
            pkg.id, pkg.name, pkg.version, pkg.description,
            pkg.author, pkg.category.value, json.dumps(pkg.tags),
            json.dumps(pkg.dependencies), pkg.rating, pkg.rating_count,
            pkg.downloads, pkg.source_url, pkg.created_at,
        ))
        conn.commit()
        conn.close()
