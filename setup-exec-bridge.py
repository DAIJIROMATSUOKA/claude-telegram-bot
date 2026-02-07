#!/usr/bin/env python3
"""
Setup: Croppy-Jarvis Remote Execution Bridge
1. Patch Memory Gateway Worker (exec endpoints)
2. Add task-poller to Jarvis
3. Patch Jarvis index.ts to start poller
"""

import os
import shutil

HOME = os.path.expanduser("~")
GATEWAY_DIR = os.path.join(HOME, "memory-gateway")
JARVIS_DIR = os.path.join(HOME, "claude-telegram-bot")
DL_DIR = os.path.join(HOME, "Library", "Mobile Documents", "com~apple~CloudDocs", "Downloads")

# ========== 1. Copy task-poller.ts to Jarvis ==========
src_poller = os.path.join(DL_DIR, "task-poller.ts")
dst_poller = os.path.join(JARVIS_DIR, "src", "utils", "task-poller.ts")

if os.path.exists(src_poller):
    shutil.copy2(src_poller, dst_poller)
    print(f"[OK] Copied task-poller.ts -> {dst_poller}")
else:
    print(f"[SKIP] task-poller.ts not found in Downloads. Copy manually.")

# ========== 2. Patch Jarvis index.ts to start poller ==========
index_file = os.path.join(JARVIS_DIR, "src", "index.ts")

with open(index_file, "r") as f:
    content = f.read()

# Add import at top (after last import)
if "task-poller" not in content:
    # Find the last import line
    lines = content.split("\n")
    last_import_idx = 0
    for i, line in enumerate(lines):
        if line.startswith("import "):
            last_import_idx = i

    lines.insert(last_import_idx + 1, "import { startTaskPoller } from './utils/task-poller';")
    content = "\n".join(lines)
    print("[OK] Added task-poller import")

    # Add startTaskPoller() call after bot.start or runner
    # Look for the startup notification section
    if "Startup notification" in content or "startup notification" in content.lower():
        # Add after startup notification block
        content = content.replace(
            '📨 Startup notification sent to DJ',
            '📨 Startup notification sent to DJ'
        )

    # Find a good place to add - after "Bot started" or "Starting bot"
    if "startTaskPoller();" not in content:
        # Add before the startup notification try block
        marker = "// Startup notification"
        if marker in content:
            content = content.replace(
                marker,
                "// Start task poller for remote execution\n  startTaskPoller();\n\n  " + marker
            )
        else:
            # Fallback: add after "Starting bot..."
            content = content.replace(
                'console.log("Starting bot...");',
                'console.log("Starting bot...");\n\n  // Start task poller for remote execution\n  startTaskPoller();'
            )
        print("[OK] Added startTaskPoller() call")
else:
    print("[SKIP] task-poller already integrated")

with open(index_file, "w") as f:
    f.write(content)
print(f"[OK] Patched: {index_file}")

# ========== 3. Run Memory Gateway patch ==========
patch_script = os.path.join(DL_DIR, "patch-memory-gateway.py")
if os.path.exists(patch_script):
    print("\n[INFO] Running Memory Gateway patch...")
    os.system(f"python3 {patch_script}")
else:
    print(f"[SKIP] patch-memory-gateway.py not found in Downloads")

print("\n" + "=" * 60)
print("SETUP COMPLETE")
print("=" * 60)
print()
print("Next steps (copy-paste these commands):")
print()
print("# 1. Deploy Memory Gateway (migration + worker)")
print(f"cd {GATEWAY_DIR} && wrangler d1 execute memory_gateway --remote --file=migrations/0002_task_queue.sql && wrangler deploy")
print()
print("# 2. Restart Jarvis")
print(f"kill $(pgrep -f 'bun run src/index') 2>/dev/null; cd {JARVIS_DIR} && bun run src/index.ts > /tmp/jarvis-bot.log 2>&1 & sleep 3 && grep -E 'Task Poller|error' /tmp/jarvis-bot.log | head -10")
