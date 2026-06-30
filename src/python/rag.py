"""RAG Engine — Document ingestion, embedding, and similarity search."""

import sqlite3
import json
import math
import re
import os
from typing import List, Dict, Optional, Any
from collections import Counter
from dataclasses import dataclass, asdict

import aiohttp

RAG_DB = 'data/rag.db'

@dataclass
class Document:
    id: int
    content: str
    metadata: dict
    embedding: Optional[List[float]]
    created_at: str


class RAGEngine:
    def __init__(self, db_path: str = RAG_DB):
        self.db_path = db_path
        self._init_db()

    def _init_db(self):
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        conn = sqlite3.connect(self.db_path)
        conn.execute('''CREATE TABLE IF NOT EXISTS documents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            content TEXT NOT NULL,
            metadata TEXT DEFAULT '{}',
            embedding TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )''')
        conn.commit()
        conn.close()

    def _chunk_text(self, text: str, chunk_size: int = 500) -> List[str]:
        paragraphs = re.split(r'\n\s*\n', text)
        chunks = []
        current = []
        current_len = 0
        for p in paragraphs:
            words = p.split()
            if not words:
                continue
            if current_len + len(words) > chunk_size and current:
                chunks.append(' '.join(current))
                current = []
                current_len = 0
            current.extend(words)
            current_len += len(words)
        if current:
            chunks.append(' '.join(current))
        return chunks if chunks else [text]

    def _token_frequency_embedding(self, text: str, dim: int = 128) -> List[float]:
        tokens = re.findall(r'\w+', text.lower())
        freq = Counter(tokens)
        total = len(tokens) or 1

        common_words = ['the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i',
                       'it', 'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at',
                       'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her', 'she',
                       'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their', 'what',
                       'so', 'up', 'out', 'if', 'about', 'who', 'get', 'which', 'go', 'me']

        embedding = []
        for word in common_words[:dim]:
            embedding.append(freq.get(word, 0) / total)

        while len(embedding) < dim:
            embedding.append(0.0)

        return embedding[:dim]

    def _cosine_similarity(self, a: List[float], b: List[float]) -> float:
        dot = sum(x * y for x, y in zip(a, b))
        na = math.sqrt(sum(x * x for x in a))
        nb = math.sqrt(sum(x * x for x in b))
        if na == 0 or nb == 0:
            return 0.0
        return dot / (na * nb)

    async def _jina_embed(self, text: str) -> Optional[List[float]]:
        api_key = os.environ.get('JINA_API_KEY', '')
        if not api_key:
            return None
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    'https://api.jina.ai/v1/embeddings',
                    headers={'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'},
                    json={'input': text, 'model': 'jina-embeddings-v2-base-en'}
                ) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        return data['data'][0]['embedding']
        except Exception:
            pass
        return None

    async def _get_embedding(self, text: str) -> List[float]:
        emb = await self._jina_embed(text)
        return emb if emb else self._token_frequency_embedding(text)

    async def ingest(self, text: str, metadata: Optional[Dict] = None) -> List[int]:
        chunks = self._chunk_text(text)
        metadata = metadata or {}
        ids = []

        conn = sqlite3.connect(self.db_path)
        for chunk in chunks:
            embedding = await self._get_embedding(chunk)
            cursor = conn.execute(
                'INSERT INTO documents (content, metadata, embedding) VALUES (?, ?, ?)',
                (chunk, json.dumps(metadata), json.dumps(embedding))
            )
            ids.append(cursor.lastrowid)

        conn.commit()
        conn.close()
        return ids

    async def query(self, query_text: str, limit: int = 5) -> List[Dict]:
        query_emb = await self._get_embedding(query_text)

        conn = sqlite3.connect(self.db_path)
        rows = conn.execute(
            'SELECT id, content, metadata, embedding, created_at FROM documents ORDER BY id DESC LIMIT 100'
        ).fetchall()
        conn.close()

        results = []
        for row in rows:
            doc_emb = json.loads(row[3]) if row[3] else []
            if not doc_emb:
                continue
            score = self._cosine_similarity(query_emb, doc_emb)
            results.append({
                'id': row[0],
                'content': row[1],
                'metadata': json.loads(row[2]),
                'score': round(score, 4),
                'created_at': row[4]
            })

        results.sort(key=lambda x: x['score'], reverse=True)
        return results[:limit]

    def list_documents(self, limit: int = 50, offset: int = 0) -> List[Dict]:
        conn = sqlite3.connect(self.db_path)
        rows = conn.execute(
            'SELECT id, content, metadata, created_at FROM documents ORDER BY id DESC LIMIT ? OFFSET ?',
            (limit, offset)
        ).fetchall()
        conn.close()
        return [{'id': r[0], 'content': r[1][:200], 'metadata': json.loads(r[2]), 'created_at': r[3]} for r in rows]

    def delete_document(self, doc_id: int) -> bool:
        conn = sqlite3.connect(self.db_path)
        cursor = conn.execute('DELETE FROM documents WHERE id = ?', (doc_id,))
        deleted = cursor.rowcount > 0
        conn.commit()
        conn.close()
        return deleted

    def clear(self):
        conn = sqlite3.connect(self.db_path)
        conn.execute('DELETE FROM documents')
        conn.commit()
        conn.close()


_engine: Optional[RAGEngine] = None


def get_engine() -> RAGEngine:
    global _engine
    if _engine is None:
        _engine = RAGEngine()
    return _engine
