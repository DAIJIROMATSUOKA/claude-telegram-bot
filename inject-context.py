#!/usr/bin/env python3
"""Inject JARVIS 47-command context into council.ts R1 and R2 prompts."""

import sys

FILEPATH = sys.argv[1] if len(sys.argv) > 1 else "src/handlers/council.ts"

JARVIS_CONTEXT = """
=====【JARVIS 47コマンド完全マップ — 全提案でこのリストを参照しろ】=====
■基本操作(8): /start /new /stop /status /resume /restart /retry /continue
■AI会話(5): /debate /gpt /gem /why /recall
■画像動画(5): /imagine /edit /outpaint /animate /undress
■タスク管理(6): /task_start /task_stop /task_pause /todoist /todoist_add /todoist_done
■生活(2): /focus /alarm
■自動化(7): /meta /meta_run /meta_audit /meta_review /meta_gaps /meta_stop /meta_start
■Darwin(8): /darwin_status /darwin_themes /darwin_history /darwin_detail /darwin_feedback /darwin_patterns /darwin_bottlenecks /darwin_analyze
■その他(4): /croppy /ai /nightshift /autopilot
■技術スタック: Bun+Grammy+Claude CLI/Gemini CLI/ChatGPT Shortcuts+Cloudflare D1+ComfyUI+mflux+M1 MAX
=====提案にはコマンド名・ファイル名・変更内容を必ず含めろ。抽象論禁止=====

"""

with open(FILEPATH, "r", encoding="utf-8") as f:
    content = f.read()

# --- R1: inject before テーマ: "{topic}" in R1_PROMPT_TEMPLATE ---
R1_OLD = '''const R1_PROMPT_TEMPLATE = `
テーマ: "{topic}"'''

R1_NEW = '''const R1_PROMPT_TEMPLATE = `
''' + JARVIS_CONTEXT + '''テーマ: "{topic}"'''

if R1_OLD not in content:
    print("ERROR: R1_PROMPT_TEMPLATE not found")
    sys.exit(1)

content = content.replace(R1_OLD, R1_NEW, 1)
print("OK: R1_PROMPT_TEMPLATE patched")

# --- R2: inject before テーマ: "{topic}" in R2_PROMPT_TEMPLATE ---
R2_OLD = '''const R2_PROMPT_TEMPLATE = `
テーマ: "{topic}"'''

R2_NEW = '''const R2_PROMPT_TEMPLATE = `
''' + JARVIS_CONTEXT + '''テーマ: "{topic}"'''

if R2_OLD not in content:
    print("ERROR: R2_PROMPT_TEMPLATE not found")
    sys.exit(1)

content = content.replace(R2_OLD, R2_NEW, 1)
print("OK: R2_PROMPT_TEMPLATE patched")

with open(FILEPATH, "w", encoding="utf-8") as f:
    f.write(content)

print(f"DONE: {FILEPATH} updated")
