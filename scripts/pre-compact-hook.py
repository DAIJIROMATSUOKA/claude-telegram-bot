#!/usr/bin/env python3
"""PreCompact Hook - Save context before compaction destroys it.
Fires before auto/manual compaction. Backs up transcript + key state.
Always exit(0) - must not block compaction.
"""

import json
import sys
import shutil
import os
import subprocess
from pathlib import Path
from datetime import datetime

def notify(msg):
    """Send Telegram notification."""
    try:
        env_file = Path.home() / "claude-telegram-bot" / ".env"
        env = {}
        if env_file.exists():
            for line in env_file.read_text().splitlines():
                if "=" in line and not line.startswith("#"):
                    k, _, v = line.partition("=")
                    env[k.strip()] = v.strip().strip('"').strip("'")
        token = env.get("TELEGRAM_BOT_TOKEN", "")
        chat_id = env.get("TELEGRAM_ALLOWED_USERS", "")
        if token and chat_id:
            subprocess.run([
                "curl", "-s", "-X", "POST",
                f"https://api.telegram.org/bot{token}/sendMessage",
                "-d", f"chat_id={chat_id}",
                "--data-urlencode", f"text={msg}"
            ], capture_output=True, timeout=10)
    except Exception:
        pass

def extract_summary(transcript_path):
    """Extract key info from JSONL transcript."""
    summary_lines = []
    user_requests = []
    files_modified = set()
    
    try:
        with open(transcript_path, "r") as f:
            for line in f:
                try:
                    entry = json.loads(line.strip())
                except (json.JSONDecodeError, ValueError):
                    continue
                
                # Extract user messages
                if entry.get("type") == "human" or entry.get("role") == "user":
                    content = entry.get("content", "")
                    if isinstance(content, str) and content.strip():
                        # Truncate long messages
                        text = content.strip()[:200]
                        user_requests.append(text)
                    elif isinstance(content, list):
                        for block in content:
                            if isinstance(block, dict) and block.get("type") == "text":
                                text = block.get("text", "").strip()[:200]
                                if text:
                                    user_requests.append(text)
                
                # Extract file modifications from tool use
                if entry.get("type") == "tool_use" or entry.get("tool_name"):
                    tool = entry.get("name", entry.get("tool_name", ""))
                    inp = entry.get("input", {})
                    if isinstance(inp, dict):
                        path = inp.get("file_path", inp.get("path", ""))
                        if path:
                            files_modified.add(path)
    except Exception as e:
        summary_lines.append(f"Transcript parse error: {e}")
    
    return user_requests, list(files_modified)

def main():
    try:
        # Read hook input from stdin
        try:
            input_data = json.load(sys.stdin)
        except (json.JSONDecodeError, ValueError):
            input_data = {}
        
        transcript_path = input_data.get("transcript_path", "")
        trigger = input_data.get("trigger", "unknown")
        session_id = input_data.get("session_id", "unknown")
        
        now = datetime.now()
        timestamp = now.strftime("%Y%m%d_%H%M%S")
        date_str = now.strftime("%Y-%m-%d")
        time_str = now.strftime("%H:%M")
        
        # === 1. Backup raw transcript ===
        backup_dir = Path.home() / ".claude" / "backups"
        backup_dir.mkdir(parents=True, exist_ok=True)
        
        transcript_backed_up = False
        if transcript_path and Path(transcript_path).exists():
            backup_name = f"transcript_{trigger}_{timestamp}.jsonl"
            shutil.copy2(transcript_path, backup_dir / backup_name)
            transcript_backed_up = True
            
            # Keep only last 10 backups
            backups = sorted(backup_dir.glob("transcript_*.jsonl"))
            for old in backups[:-10]:
                old.unlink()
        
        # === 2. Extract summary ===
        user_requests = []
        files_modified = []
        if transcript_path and Path(transcript_path).exists():
            user_requests, files_modified = extract_summary(transcript_path)
        
        # === 3. Save structured summary to JARVIS-Journal ===
        journal_dir = Path.home() / "Machinelab Dropbox" / "Matsuoka Daijiro" / "JARVIS-Journal"
        if journal_dir.exists():
            summary_file = journal_dir / f"pre-compact-{date_str}.md"
            
            entry = f"\n## Compaction {time_str} ({trigger})\n"
            entry += f"- Session: {session_id[:16]}...\n"
            
            if transcript_backed_up:
                entry += f"- Backup: ~/.claude/backups/transcript_{trigger}_{timestamp}.jsonl\n"
            
            if user_requests:
                entry += f"\n### User Requests ({len(user_requests)})\n"
                for i, req in enumerate(user_requests[-10:], 1):  # Last 10 only
                    entry += f"{i}. {req}\n"
            
            if files_modified:
                entry += f"\n### Files Modified ({len(files_modified)})\n"
                for f_path in sorted(files_modified)[-20:]:  # Last 20
                    entry += f"- {f_path}\n"
            
            # Append to daily file
            with open(summary_file, "a") as f:
                f.write(entry)
        
        # === 4. Save to Auto Memory recovery file ===
        memory_dir = Path.home() / ".claude" / "projects" / "-Users-daijiromatsuokam1-claude-telegram-bot" / "memory"
        if memory_dir.exists():
            recovery_file = memory_dir / "last-compaction.md"
            recovery_content = f"# Last Compaction: {date_str} {time_str}\n"
            recovery_content += f"Trigger: {trigger}\n\n"
            if user_requests:
                recovery_content += "## Recent Context\n"
                for req in user_requests[-5:]:
                    recovery_content += f"- {req}\n"
            if files_modified:
                recovery_content += "\n## Files in play\n"
                for f_path in sorted(files_modified)[-10:]:
                    recovery_content += f"- {f_path}\n"
            recovery_file.write_text(recovery_content)
        
        # === 5. Notify ===
        notify(f"🗜️ Context compaction ({trigger}) at {time_str}\n"
               f"Requests: {len(user_requests)}, Files: {len(files_modified)}\n"
               f"Backup: {'✅' if transcript_backed_up else '❌'}")
        
    except Exception as e:
        # Never fail - compaction must proceed
        try:
            notify(f"⚠️ PreCompact hook error: {e}")
        except Exception:
            pass
    
    sys.exit(0)

if __name__ == "__main__":
    main()
