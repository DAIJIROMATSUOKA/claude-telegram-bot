#!/usr/bin/env python3
"""
Patch index.ts to add Council Debate commands.
Safe: uses string matching, not line numbers.
"""

import sys
import os

INDEX_PATH = os.path.expanduser("~/claude-telegram-bot/src/index.ts")

# Read current file
with open(INDEX_PATH, "r") as f:
    content = f.read()

# Check if already patched
if "handleDebate" in content:
    print("Already patched. Skipping.")
    sys.exit(0)

# 1. Add import after meta-commands import
IMPORT_ANCHOR = 'from "./handlers/meta-commands";'
IMPORT_ADD = '''
import {
  handleDebate,
  handleAskGPT,
  handleAskGemini,
} from "./handlers/council";'''

if IMPORT_ANCHOR not in content:
    print("ERROR: Cannot find import anchor: " + IMPORT_ANCHOR)
    sys.exit(1)

content = content.replace(
    IMPORT_ANCHOR,
    IMPORT_ANCHOR + IMPORT_ADD
)

# 2. Add commands after croppy command block
# Find the croppy command block end and add after it
CMD_ANCHOR = 'bot.on("message:text", handleText);'
CMD_ADD = '''
// Council Debate commands (3AI)
bot.command("debate", handleDebate);
bot.command("gpt", handleAskGPT);
bot.command("gem", handleAskGemini);

'''

if CMD_ANCHOR not in content:
    print("ERROR: Cannot find command anchor: " + CMD_ANCHOR)
    sys.exit(1)

content = content.replace(
    CMD_ANCHOR,
    CMD_ADD + CMD_ANCHOR
)

# Write patched file
with open(INDEX_PATH, "w") as f:
    f.write(content)

print("Patched successfully!")
print("  Added: import { handleDebate, handleAskGPT, handleAskGemini }")
print("  Added: bot.command('debate'), bot.command('gpt'), bot.command('gem')")
