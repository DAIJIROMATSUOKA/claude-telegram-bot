#!/usr/bin/env python3
"""Search Claude chatlog files with optional SQLite index for fast lookups.

Usage:
  python3 search-chatlogs.py "keyword" [--list] [--context N] [--build-index]
"""

import argparse
import glob
import hashlib
import json
import os
import re
import sqlite3
import sys
from pathlib import Path

CHATLOG_DIRS = [
    os.path.expanduser("~/.claude/projects"),
    os.path.expanduser("~/Library/Application Support/Claude/chat-logs"),
    os.path.expanduser("~/.config/claude/chat-logs"),
]
INDEX_DB = os.path.expanduser("~/.chatlog-index.db")


def get_chatlog_files():
    """Find all chatlog JSON/JSONL files."""
    files = []
    for d in CHATLOG_DIRS:
        if os.path.isdir(d):
            for ext in ("*.json", "*.jsonl"):
                files.extend(glob.glob(os.path.join(d, "**", ext), recursive=True))
    return sorted(set(files))


def init_db(db_path):
    """Initialize the SQLite index database."""
    conn = sqlite3.connect(db_path)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS chatlog_index (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT UNIQUE NOT NULL,
            date TEXT,
            content_hash TEXT NOT NULL,
            preview TEXT,
            size INTEGER,
            indexed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS chatlog_content (
            index_id INTEGER NOT NULL,
            line_num INTEGER NOT NULL,
            content TEXT NOT NULL,
            FOREIGN KEY (index_id) REFERENCES chatlog_index(id)
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_content ON chatlog_content(content)")
    conn.commit()
    return conn


def build_index():
    """Build or update the SQLite index of all chatlog files."""
    conn = init_db(INDEX_DB)
    files = get_chatlog_files()
    new_count = 0
    updated = 0

    for fpath in files:
        try:
            stat = os.stat(fpath)
            content = open(fpath, "r", errors="replace").read()
            content_hash = hashlib.md5(content.encode()).hexdigest()

            existing = conn.execute(
                "SELECT id, content_hash FROM chatlog_index WHERE path = ?", (fpath,)
            ).fetchone()

            if existing and existing[1] == content_hash:
                continue

            # Extract date from filename or path
            date_match = re.search(r"(\d{4}-\d{2}-\d{2})", os.path.basename(fpath))
            date_str = date_match.group(1) if date_match else None
            preview = content[:200].replace("\n", " ")

            if existing:
                idx_id = existing[0]
                conn.execute(
                    "UPDATE chatlog_index SET content_hash=?, date=?, preview=?, size=?, indexed_at=CURRENT_TIMESTAMP WHERE id=?",
                    (content_hash, date_str, preview, stat.st_size, idx_id),
                )
                conn.execute("DELETE FROM chatlog_content WHERE index_id=?", (idx_id,))
                updated += 1
            else:
                cur = conn.execute(
                    "INSERT INTO chatlog_index (path, date, content_hash, preview, size) VALUES (?, ?, ?, ?, ?)",
                    (fpath, date_str, content_hash, preview, stat.st_size),
                )
                idx_id = cur.lastrowid
                new_count += 1

            # Index content line by line
            for i, line in enumerate(content.split("\n"), 1):
                stripped = line.strip()
                if stripped:
                    conn.execute(
                        "INSERT INTO chatlog_content (index_id, line_num, content) VALUES (?, ?, ?)",
                        (idx_id, i, stripped[:500]),
                    )

        except Exception as e:
            print(f"WARN: {fpath}: {e}", file=sys.stderr)

    conn.commit()
    conn.close()
    print(f"Index built: {new_count} new, {updated} updated, {len(files)} total files")
    print(f"Stored at: {INDEX_DB}")


def search_index(keyword):
    """Search using SQLite index (fast)."""
    if not os.path.exists(INDEX_DB):
        return None

    conn = sqlite3.connect(INDEX_DB)
    results = conn.execute(
        """
        SELECT ci.path, ci.date, cc.line_num, cc.content
        FROM chatlog_content cc
        JOIN chatlog_index ci ON ci.id = cc.index_id
        WHERE cc.content LIKE ?
        ORDER BY ci.date DESC, cc.line_num
        LIMIT 100
        """,
        (f"%{keyword}%",),
    ).fetchall()
    conn.close()
    return results


def search_direct(keyword, context=0, list_only=False):
    """Direct file search (fallback)."""
    files = get_chatlog_files()
    matches = []

    for fpath in files:
        try:
            lines = open(fpath, "r", errors="replace").readlines()
            for i, line in enumerate(lines):
                if keyword.lower() in line.lower():
                    if list_only:
                        matches.append(fpath)
                        break
                    else:
                        start = max(0, i - context)
                        end = min(len(lines), i + context + 1)
                        ctx_lines = lines[start:end]
                        matches.append((fpath, i + 1, ctx_lines))
        except Exception:
            pass

    return matches


def main():
    parser = argparse.ArgumentParser(description="Search Claude chatlogs")
    parser.add_argument("keyword", nargs="?", help="Search keyword")
    parser.add_argument("--list", action="store_true", help="List matching files only")
    parser.add_argument("--context", "-C", type=int, default=0, help="Context lines")
    parser.add_argument("--build-index", action="store_true", help="Build SQLite index")
    args = parser.parse_args()

    if args.build_index:
        build_index()
        return

    if not args.keyword:
        parser.print_help()
        sys.exit(1)

    # Try index first
    idx_results = search_index(args.keyword)
    if idx_results is not None and not args.list:
        print(f"[Index search: {len(idx_results)} matches]")
        for path, date, line_num, content in idx_results:
            short_path = os.path.basename(path)
            print(f"  {short_path}:{line_num} ({date or '?'}): {content[:120]}")
        return

    # Fall back to direct search
    matches = search_direct(args.keyword, args.context, args.list)

    if args.list:
        for fpath in matches:
            print(fpath)
    else:
        for fpath, line_num, ctx_lines in matches:
            short_path = os.path.basename(fpath)
            print(f"\n--- {short_path}:{line_num} ---")
            for line in ctx_lines:
                print(line.rstrip())


if __name__ == "__main__":
    main()
