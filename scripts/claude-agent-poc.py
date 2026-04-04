#!/usr/bin/env python3
"""
Claude Agent SDK POC — replaces bash spawn.sh pipeline.
Uses OAuth login from claude CLI (no ANTHROPIC_API_KEY).

Usage: python3 scripts/claude-agent-poc.py <prompt_file> [cwd] [model] [output_log]
"""

import asyncio
import sys
import os
from pathlib import Path


async def main():
    if len(sys.argv) < 2:
        print("Usage: python3 claude-agent-poc.py <prompt_file> [cwd] [model] [output_log]")
        sys.exit(1)

    prompt_file = sys.argv[1]
    cwd = sys.argv[2] if len(sys.argv) > 2 else os.path.expanduser("~/claude-telegram-bot")
    model = sys.argv[3] if len(sys.argv) > 3 else "sonnet"
    output_log = sys.argv[4] if len(sys.argv) > 4 else "/tmp/claude-agent-poc.log"

    # Read prompt from file
    prompt_path = Path(prompt_file)
    if not prompt_path.exists():
        print(f"ERROR: prompt file not found: {prompt_file}")
        sys.exit(1)
    prompt_text = prompt_path.read_text().strip()
    if not prompt_text:
        print("ERROR: prompt file is empty")
        sys.exit(1)

    try:
        from claude_agent_sdk import query, ClaudeAgentOptions
    except ImportError:
        print("ERROR: claude-agent-sdk not installed.")
        print("Install: pip3 install --break-system-packages claude-agent-sdk")
        sys.exit(1)

    options = ClaudeAgentOptions(
        permission_mode="bypassPermissions",
        cwd=cwd,
        model=model,
        max_turns=200,
    )

    full_prompt = f"Read the file {prompt_file} and follow every instruction in it exactly."
    output_parts: list[str] = []
    session_id: str | None = None

    print(f"[POC] Starting query: model={model}, cwd={cwd}")
    print(f"[POC] Prompt: {prompt_text[:150]}...")

    try:
        async for message in query(prompt=full_prompt, options=options):
            # Extract session_id from first message
            if session_id is None and hasattr(message, "session_id"):
                session_id = message.session_id

            # Collect text content from assistant messages
            if hasattr(message, "content") and isinstance(message.content, list):
                for block in message.content:
                    if hasattr(block, "text"):
                        output_parts.append(block.text)
            elif hasattr(message, "content") and isinstance(message.content, str):
                output_parts.append(message.content)

    except KeyboardInterrupt:
        print("\n[POC] Interrupted by user")
    except Exception as e:
        error_msg = f"[POC] Error: {e}"
        print(error_msg)
        output_parts.append(error_msg)

    # Write output to log file
    full_output = "\n".join(output_parts)
    Path(output_log).write_text(full_output)
    print(f"[POC] Output written to {output_log} ({len(full_output)} chars)")

    if session_id:
        print(f"[POC] session_id={session_id}")
        print(f"[POC] Resume with: --resume {session_id}")
    else:
        print("[POC] No session_id captured (may not be supported in this SDK version)")


if __name__ == "__main__":
    asyncio.run(main())
