#!/usr/bin/env python3
"""
JARVIS Memory Embedding Server
Local HTTP server for text embedding + vector search.
Runs on M1 MAX with MPS acceleration. No API costs.

Usage: python3 memory-embed-server.py [--port 19823]
"""

import json
import sqlite3
import struct
import os
import sys
import hashlib
import time
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path

# --- Config ---
PORT = int(sys.argv[sys.argv.index('--port') + 1]) if '--port' in sys.argv else 19823
DB_PATH = os.path.expanduser('~/jarvis-memory/vectors.db')
MODEL_NAME = 'intfloat/multilingual-e5-small'  # 118MB, 384-dim, Japanese OK
MAX_RESULTS = 10

# --- Lazy model loading ---
_model = None

def get_model():
    global _model
    if _model is None:
        print(f'[Embed Server] Loading model: {MODEL_NAME}...')
        from sentence_transformers import SentenceTransformer
        import torch
        device = 'mps' if torch.backends.mps.is_available() else 'cpu'
        _model = SentenceTransformer(MODEL_NAME, device=device)
        print(f'[Embed Server] Model loaded on {device}')
    return _model


def init_db():
    """Initialize local SQLite vector store."""
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute('''
        CREATE TABLE IF NOT EXISTS embeddings (
            id TEXT PRIMARY KEY,
            source_id TEXT NOT NULL,
            source_type TEXT NOT NULL,
            vector BLOB NOT NULL,
            text_chunk TEXT NOT NULL,
            metadata TEXT,
            created_at REAL DEFAULT (unixepoch())
        )
    ''')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_embeddings_source ON embeddings(source_type, source_id)')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_embeddings_created ON embeddings(created_at)')
    conn.commit()
    conn.close()
    print(f'[Embed Server] DB initialized: {DB_PATH}')


def vector_to_blob(vec):
    """Convert float list to binary blob."""
    return struct.pack(f'{len(vec)}f', *vec)


def blob_to_vector(blob):
    """Convert binary blob to float list."""
    n = len(blob) // 4
    return list(struct.unpack(f'{n}f', blob))


def cosine_similarity(a, b):
    """Compute cosine similarity between two vectors."""
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = sum(x * x for x in a) ** 0.5
    norm_b = sum(x * x for x in b) ** 0.5
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


class EmbedHandler(BaseHTTPRequestHandler):
    """HTTP request handler for embedding operations."""

    def do_GET(self):
        if self.path == '/health':
            self._json_response({'status': 'ok', 'model': MODEL_NAME, 'db': DB_PATH})
        elif self.path == '/stats':
            conn = sqlite3.connect(DB_PATH)
            count = conn.execute('SELECT COUNT(*) FROM embeddings').fetchone()[0]
            conn.close()
            self._json_response({'total_embeddings': count})
        else:
            self._json_response({'error': 'Not found'}, 404)

    def do_POST(self):
        content_length = int(self.headers.get('Content-Length', 0))
        body = json.loads(self.rfile.read(content_length)) if content_length > 0 else {}

        if self.path == '/embed':
            self._handle_embed(body)
        elif self.path == '/store':
            self._handle_store(body)
        elif self.path == '/search':
            self._handle_search(body)
        elif self.path == '/delete':
            self._handle_delete(body)
        else:
            self._json_response({'error': 'Not found'}, 404)

    def _handle_embed(self, body):
        """Generate embeddings for texts (no storage)."""
        texts = body.get('texts', [])
        if not texts:
            self._json_response({'error': 'texts required'}, 400)
            return
        # e5 models need "query: " or "passage: " prefix
        prefix = body.get('prefix', 'passage: ')
        prefixed = [prefix + t for t in texts]
        model = get_model()
        vectors = model.encode(prefixed, normalize_embeddings=True).tolist()
        self._json_response({'vectors': vectors, 'dim': len(vectors[0])})

    def _handle_store(self, body):
        """Embed + store text chunks with metadata."""
        chunks = body.get('chunks', [])
        if not chunks:
            self._json_response({'error': 'chunks required'}, 400)
            return

        model = get_model()
        texts = [c.get('text', '') for c in chunks]
        prefixed = ['passage: ' + t for t in texts]
        vectors = model.encode(prefixed, normalize_embeddings=True)

        conn = sqlite3.connect(DB_PATH)
        stored = 0
        for i, chunk in enumerate(chunks):
            chunk_id = chunk.get('id') or hashlib.sha256(
                f"{chunk.get('source_id','')}-{chunk.get('text','')}".encode()
            ).hexdigest()[:16]

            conn.execute('''
                INSERT OR REPLACE INTO embeddings (id, source_id, source_type, vector, text_chunk, metadata, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            ''', (
                chunk_id,
                chunk.get('source_id', ''),
                chunk.get('source_type', 'conversation'),
                vector_to_blob(vectors[i].tolist()),
                chunk.get('text', ''),
                json.dumps(chunk.get('metadata', {})),
                time.time()
            ))
            stored += 1

        conn.commit()
        conn.close()
        self._json_response({'stored': stored})

    def _handle_search(self, body):
        """Semantic search over stored embeddings."""
        query = body.get('query', '')
        top_k = min(body.get('top_k', 5), MAX_RESULTS)
        source_type = body.get('source_type')
        min_score = body.get('min_score', 0.3)

        if not query:
            self._json_response({'error': 'query required'}, 400)
            return

        model = get_model()
        query_vec = model.encode(['query: ' + query], normalize_embeddings=True)[0].tolist()

        conn = sqlite3.connect(DB_PATH)
        if source_type:
            rows = conn.execute(
                'SELECT id, source_id, source_type, vector, text_chunk, metadata, created_at FROM embeddings WHERE source_type = ?',
                (source_type,)
            ).fetchall()
        else:
            rows = conn.execute(
                'SELECT id, source_id, source_type, vector, text_chunk, metadata, created_at FROM embeddings'
            ).fetchall()
        conn.close()

        # Compute similarities
        results = []
        for row in rows:
            vec = blob_to_vector(row[3])
            score = cosine_similarity(query_vec, vec)
            if score >= min_score:
                results.append({
                    'id': row[0],
                    'source_id': row[1],
                    'source_type': row[2],
                    'text': row[4],
                    'metadata': json.loads(row[5]) if row[5] else {},
                    'score': round(score, 4),
                    'created_at': row[6],
                })

        # Sort by score desc, apply recency bias
        now = time.time()
        for r in results:
            age_days = (now - (r.get('created_at') or now)) / 86400
            recency_boost = max(0, 0.05 * (1 - age_days / 30))  # Boost recent, decay over 30d
            r['final_score'] = r['score'] + recency_boost

        results.sort(key=lambda x: x['final_score'], reverse=True)
        results = results[:top_k]

        self._json_response({'results': results, 'total_searched': len(rows)})

    def _handle_delete(self, body):
        """Delete embeddings by source_id or source_type."""
        source_id = body.get('source_id')
        source_type = body.get('source_type')
        older_than_days = body.get('older_than_days')

        conn = sqlite3.connect(DB_PATH)
        deleted = 0

        if source_id:
            r = conn.execute('DELETE FROM embeddings WHERE source_id = ?', (source_id,))
            deleted = r.rowcount
        elif source_type and older_than_days:
            cutoff = time.time() - (older_than_days * 86400)
            r = conn.execute('DELETE FROM embeddings WHERE source_type = ? AND created_at < ?',
                           (source_type, cutoff))
            deleted = r.rowcount
        else:
            self._json_response({'error': 'source_id or (source_type + older_than_days) required'}, 400)
            conn.close()
            return

        conn.commit()
        conn.close()
        self._json_response({'deleted': deleted})

    def _json_response(self, data, status=200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def log_message(self, format, *args):
        if '/health' not in str(args):
            print(f'[Embed Server] {args[0]}')


if __name__ == '__main__':
    init_db()
    print(f'[Embed Server] Starting on port {PORT}...')
    # Pre-load model
    try:
        get_model()
    except Exception as e:
        print(f'[Embed Server] WARNING: Model load failed: {e}')
        print('[Embed Server] Install: pip install sentence-transformers torch --break-system-packages')
        sys.exit(1)

    server = HTTPServer(('127.0.0.1', PORT), EmbedHandler)
    print(f'[Embed Server] Ready at http://127.0.0.1:{PORT}')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n[Embed Server] Shutting down...')
        server.server_close()
