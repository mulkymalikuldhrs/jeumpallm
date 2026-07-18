import json, re, sqlite3, uuid, threading
from dataclasses import dataclass, field
from typing import Optional


ENTITY_PATTERNS = [
    ("person", re.compile(r'\b[A-Z][a-z]+ [A-Z][a-z]+\b')),
    ("organization", re.compile(r'\b[A-Z][a-z]+(?: (?:Inc|Corp|LLC|Ltd|AI|Labs?|Technologies|Systems|Research|Group|Foundation))\b')),
    ("technology", re.compile(r'\b(?:JavaScript|Python|TypeScript|React|Node\.?js|SQLite|PostgreSQL|Redis|Docker|Kubernetes|AWS|GCP|Azure|Linux|TensorFlow|PyTorch|LLM|API|REST|GraphQL|SQL)\b')),
    ("concept", re.compile(r'\b(?:AI|machine learning|deep learning|neural network|blockchain|quantum|encryption|authentication|authorization|microservices|serverless|edge computing|IoT|DevOps|CI/CD)\b', re.IGNORECASE)),
]


@dataclass
class Entity:
    id: str
    name: str
    type: str
    properties: dict = field(default_factory=dict)
    created_at: str = ""


@dataclass
class Relation:
    id: int
    source_id: str
    target_id: str
    relation_type: str
    properties: dict = field(default_factory=dict)
    weight: float = 1.0
    created_at: str = ""


class KnowledgeGraph:
    def __init__(self, db_path: str = ":memory:"):
        self._lock = threading.Lock()
        self._db = sqlite3.connect(db_path, check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        self._init_db()

    def _init_db(self):
        self._db.executescript("""
            CREATE TABLE IF NOT EXISTS graph_entities (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                type TEXT DEFAULT 'concept',
                properties TEXT DEFAULT '{}',
                created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS graph_relations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_id TEXT REFERENCES graph_entities(id),
                target_id TEXT REFERENCES graph_entities(id),
                relation_type TEXT NOT NULL,
                properties TEXT DEFAULT '{}',
                weight REAL DEFAULT 1.0,
                created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_graph_relations_source ON graph_relations(source_id);
            CREATE INDEX IF NOT EXISTS idx_graph_relations_target ON graph_relations(target_id);
            CREATE INDEX IF NOT EXISTS idx_graph_entities_name ON graph_entities(name);
        """)

    def _row_to_entity(self, row) -> Entity:
        props = {}
        if row["properties"]:
            try:
                props = json.loads(row["properties"])
            except (json.JSONDecodeError, TypeError):
                props = {}
        return Entity(id=row["id"], name=row["name"], type=row["type"],
                      properties=props, created_at=row["created_at"])

    def _row_to_relation(self, row) -> Relation:
        props = {}
        if row["properties"]:
            try:
                props = json.loads(row["properties"])
            except (json.JSONDecodeError, TypeError):
                props = {}
        return Relation(id=row["id"], source_id=row["source_id"],
                        target_id=row["target_id"], relation_type=row["relation_type"],
                        properties=props, weight=row["weight"], created_at=row["created_at"])

    def create_entity(self, name: str, type_: str = "concept",
                      properties: dict = None) -> Entity:
        with self._lock:
            cur = self._db.execute(
                "SELECT id FROM graph_entities WHERE name = ? AND type = ?",
                (name, type_))
            existing = cur.fetchone()
            if existing:
                row = self._db.execute(
                    "SELECT * FROM graph_entities WHERE id = ?", (existing["id"],)
                ).fetchone()
                return self._row_to_entity(row)
            entity_id = str(uuid.uuid4())
            self._db.execute(
                "INSERT INTO graph_entities (id, name, type, properties) VALUES (?, ?, ?, ?)",
                (entity_id, name, type_, json.dumps(properties or {})))
            self._db.commit()
            row = self._db.execute(
                "SELECT * FROM graph_entities WHERE id = ?", (entity_id,)
            ).fetchone()
            return self._row_to_entity(row)

    def get_entity(self, id_: str) -> Optional[Entity]:
        with self._lock:
            row = self._db.execute(
                "SELECT * FROM graph_entities WHERE id = ?", (id_,)
            ).fetchone()
            return self._row_to_entity(row) if row else None

    def list_entities(self, type_filter: str = None, search: str = None,
                      limit: int = 50, offset: int = 0) -> list:
        with self._lock:
            query = "SELECT * FROM graph_entities WHERE 1=1"
            params = []
            if type_filter:
                query += " AND type = ?"
                params.append(type_filter)
            if search:
                query += " AND name LIKE ?"
                params.append(f"%{search}%")
            query += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
            params.extend([limit, offset])
            rows = self._db.execute(query, params).fetchall()
            return [self._row_to_entity(r) for r in rows]

    def update_entity(self, id_: str, properties: dict) -> Optional[Entity]:
        with self._lock:
            row = self._db.execute(
                "SELECT * FROM graph_entities WHERE id = ?", (id_,)
            ).fetchone()
            if not row:
                return None
            existing_props = {}
            if row["properties"]:
                try:
                    existing_props = json.loads(row["properties"])
                except (json.JSONDecodeError, TypeError):
                    existing_props = {}
            merged = {**existing_props, **(properties or {})}
            self._db.execute(
                "UPDATE graph_entities SET properties = ? WHERE id = ?",
                (json.dumps(merged), id_))
            self._db.commit()
            row = self._db.execute(
                "SELECT * FROM graph_entities WHERE id = ?", (id_,)
            ).fetchone()
            return self._row_to_entity(row)

    def delete_entity(self, id_: str) -> bool:
        with self._lock:
            self._db.execute(
                "DELETE FROM graph_relations WHERE source_id = ? OR target_id = ?",
                (id_, id_))
            cur = self._db.execute(
                "DELETE FROM graph_entities WHERE id = ?", (id_,))
            self._db.commit()
            return cur.rowcount > 0

    def create_relation(self, source_id: str, target_id: str,
                        relation_type: str, properties: dict = None,
                        weight: float = 1.0) -> Relation:
        with self._lock:
            existing = self._db.execute(
                "SELECT * FROM graph_relations WHERE source_id = ? AND target_id = ? AND relation_type = ?",
                (source_id, target_id, relation_type)).fetchone()
            if existing:
                existing_props = {}
                if existing["properties"]:
                    try:
                        existing_props = json.loads(existing["properties"])
                    except (json.JSONDecodeError, TypeError):
                        existing_props = {}
                merged = {**existing_props, **(properties or {})}
                self._db.execute(
                    "UPDATE graph_relations SET weight = weight + ?, properties = ? WHERE id = ?",
                    (weight, json.dumps(merged), existing["id"]))
                self._db.commit()
                row = self._db.execute(
                    "SELECT * FROM graph_relations WHERE id = ?", (existing["id"],)
                ).fetchone()
                return self._row_to_relation(row)
            self._db.execute(
                "INSERT INTO graph_relations (source_id, target_id, relation_type, properties, weight) VALUES (?, ?, ?, ?, ?)",
                (source_id, target_id, relation_type, json.dumps(properties or {}), weight))
            self._db.commit()
            row = self._db.execute(
                "SELECT * FROM graph_relations WHERE id = last_insert_rowid()"
            ).fetchone()
            return self._row_to_relation(row)

    def get_relations(self, entity_id: str) -> list:
        with self._lock:
            rows = self._db.execute("""
                SELECT r.*, e_s.name as source_name, e_t.name as target_name,
                       e_s.type as source_type, e_t.type as target_type
                FROM graph_relations r
                LEFT JOIN graph_entities e_s ON r.source_id = e_s.id
                LEFT JOIN graph_entities e_t ON r.target_id = e_t.id
                WHERE r.source_id = ? OR r.target_id = ?
                ORDER BY r.weight DESC
            """, (entity_id, entity_id)).fetchall()
            result = []
            for r in rows:
                d = dict(r)
                if d.get("properties"):
                    try:
                        d["properties"] = json.loads(d["properties"])
                    except (json.JSONDecodeError, TypeError):
                        d["properties"] = {}
                result.append(d)
            return result

    def extract_entities(self, text: str) -> list:
        entities = []
        seen = set()
        for type_, pattern in ENTITY_PATTERNS:
            for match in pattern.finditer(text):
                name = match.group(0).strip()
                key = name.lower()
                if key not in seen:
                    seen.add(key)
                    entities.append((name, type_))
        return entities

    def extract_relations(self, text: str, entities: list) -> list:
        relations = []
        if len(entities) < 2:
            return relations
        sentences = re.split(r'[.!?]+', text)
        entity_names = [e[0] for e in entities]
        for sentence in sentences:
            present = [n for n in entity_names if n.lower() in sentence.lower()]
            for i in range(len(present)):
                for j in range(i + 1, len(present)):
                    relations.append((present[i], present[j], "co_occurs"))
        return relations

    def search(self, query: str) -> list:
        with self._lock:
            rows = self._db.execute(
                "SELECT * FROM graph_entities WHERE name LIKE ? ORDER BY created_at DESC LIMIT 20",
                (f"%{query}%",)).fetchall()
            results = []
            ql = query.lower()
            for r in rows:
                entity = self._row_to_entity(r)
                nl = entity.name.lower()
                if nl == ql:
                    score = 1.0
                elif nl.startswith(ql):
                    score = 0.8
                elif ql in nl:
                    score = 0.5
                else:
                    score = 0.3
                results.append((entity, score))
            return results

    def get_stats(self) -> dict:
        with self._lock:
            entity_count = self._db.execute(
                "SELECT COUNT(*) as c FROM graph_entities"
            ).fetchone()["c"]
            relation_count = self._db.execute(
                "SELECT COUNT(*) as c FROM graph_relations"
            ).fetchone()["c"]
            types_rows = self._db.execute(
                "SELECT type, COUNT(*) as count FROM graph_entities GROUP BY type ORDER BY count DESC"
            ).fetchall()
            return {
                "entities": entity_count,
                "relations": relation_count,
                "types": [{"type": r["type"], "count": r["count"]} for r in types_rows],
            }

    def clear(self):
        with self._lock:
            self._db.execute("DELETE FROM graph_relations")
            self._db.execute("DELETE FROM graph_entities")
            self._db.commit()
