#!/usr/bin/env python3
"""Stop Hook Self-Validation - Tests must pass before Claude can stop.
Fires on every Claude Code response. Only validates when code was changed.
Returns {"decision": "block", "reason": "..."} to force continuation on failure.
Max 3 retries to prevent infinite loops.
"""

import json
import sys
import os
import subprocess
from pathlib import Path

PROJECT_DIR = Path.home() / "claude-telegram-bot"
COUNTER_FILE = Path("/tmp/stop-validation-count")
SESSION_FILE = Path("/tmp/stop-validation-session")
MAX_RETRIES = 3
CODE_EXTENSIONS = {".ts", ".js", ".py", ".sh", ".json", ".md"}


def get_session_id():
    """Extract session_id from stdin hook data."""
    try:
        input_data = json.load(sys.stdin)
        return input_data.get("session_id", "unknown")
    except Exception:
        return "unknown"


def get_retry_count(session_id):
    """Get current retry count for this session. Reset if session changed."""
    try:
        if SESSION_FILE.exists():
            stored_session = SESSION_FILE.read_text().strip()
            if stored_session != session_id:
                # New session, reset counter
                COUNTER_FILE.write_text("0")
                SESSION_FILE.write_text(session_id)
                return 0
        else:
            SESSION_FILE.write_text(session_id)

        if COUNTER_FILE.exists():
            return int(COUNTER_FILE.read_text().strip())
        return 0
    except Exception:
        return 0


def increment_retry(count):
    """Increment retry counter."""
    try:
        COUNTER_FILE.write_text(str(count + 1))
    except Exception:
        pass


def reset_retry():
    """Reset retry counter (tests passed)."""
    try:
        COUNTER_FILE.write_text("0")
    except Exception:
        pass


def has_code_changes():
    """Check if there are uncommitted code changes."""
    try:
        result = subprocess.run(
            ["git", "diff", "--name-only", "HEAD"],
            capture_output=True, text=True, timeout=10,
            cwd=str(PROJECT_DIR)
        )
        # Also check staged changes
        staged = subprocess.run(
            ["git", "diff", "--name-only", "--cached"],
            capture_output=True, text=True, timeout=10,
            cwd=str(PROJECT_DIR)
        )
        all_files = (result.stdout.strip() + "\n" + staged.stdout.strip()).strip()
        if not all_files:
            return False

        # Check if any are code files
        for f in all_files.splitlines():
            f = f.strip()
            if f and Path(f).suffix in CODE_EXTENSIONS:
                return True
        return False
    except Exception:
        return False


def check_banned_keywords():
    """Check for BANNED API key patterns in changed files."""
    banned_patterns = [
        "ANTHROPIC_API_KEY",
        "OPENAI_API_KEY",
        "GEMINI_API_KEY",
        "sk-ant-",
        "sk-proj-",
    ]
    try:
        result = subprocess.run(
            ["git", "diff", "HEAD"],
            capture_output=True, text=True, timeout=15,
            cwd=str(PROJECT_DIR)
        )
        diff_content = result.stdout
        found = []
        for pattern in banned_patterns:
            if pattern in diff_content:
                # Ignore removals (lines starting with -)
                for line in diff_content.splitlines():
                    if line.startswith("+") and pattern in line:
                        found.append(pattern)
                        break
        return found
    except Exception:
        return []


def run_tests():
    """Run bun test and return (success, output)."""
    try:
        result = subprocess.run(
            ["bun", "test"],
            capture_output=True, text=True, timeout=120,
            cwd=str(PROJECT_DIR),
            env={
                **os.environ,
                "PATH": f"/opt/homebrew/bin:/usr/local/bin:{os.environ.get('PATH', '')}",
            }
        )
        output = result.stdout[-500:] if len(result.stdout) > 500 else result.stdout
        if result.stderr:
            stderr_tail = result.stderr[-300:] if len(result.stderr) > 300 else result.stderr
            output += f"\nSTDERR: {stderr_tail}"
        return result.returncode == 0, output.strip()
    except subprocess.TimeoutExpired:
        return False, "bun test timed out (120s)"
    except Exception as e:
        # If bun test not available, pass
        return True, f"Test runner error (allowing): {e}"


def main():
    session_id = get_session_id()

    # 1. No code changes → allow stop immediately
    if not has_code_changes():
        reset_retry()
        sys.exit(0)

    # 2. Check retry count
    count = get_retry_count(session_id)
    if count >= MAX_RETRIES:
        # Max retries reached → allow stop, notify
        reset_retry()
        # Output warning to stderr (shown in verbose mode)
        print(f"Self-validation: max retries ({MAX_RETRIES}) reached, allowing stop", file=sys.stderr)
        sys.exit(0)

    # 3. Check BANNED keywords
    banned = check_banned_keywords()
    if banned:
        increment_retry(count)
        result = {
            "decision": "block",
            "reason": f"BANNED API key patterns detected in diff: {', '.join(banned)}. "
                      f"Remove these before completing. (retry {count + 1}/{MAX_RETRIES})"
        }
        print(json.dumps(result))
        sys.exit(0)

    # 4. Run tests
    success, output = run_tests()
    if not success:
        increment_retry(count)
        result = {
            "decision": "block",
            "reason": f"Tests failed (retry {count + 1}/{MAX_RETRIES}):\n{output}\n\n"
                      f"Fix the failing tests before completing."
        }
        print(json.dumps(result))
        sys.exit(0)

    # 5. All passed → allow stop
    reset_retry()
    sys.exit(0)


if __name__ == "__main__":
    main()
