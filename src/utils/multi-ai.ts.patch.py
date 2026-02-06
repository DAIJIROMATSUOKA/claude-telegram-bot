import os

fp = os.path.expanduser("~/claude-telegram-bot/src/utils/multi-ai.ts")
with open(fp, "r") as f:
    content = f.read()

# Fix 1: Gemini - pass prompt via stdin instead of -p arg
content = content.replace(
    'const r = await spawnCLI("gemini", ["-p", prompt], null, timeoutMs);',
    'const r = await spawnCLI("gemini", [], prompt, timeoutMs);'
)

# Fix 2: All backends - treat as success if stdout has content even with non-zero exit
old_claude_return = '''output: r.code === 0 ? r.stdout : "",
    backend: "claude",'''
new_claude_return = '''output: (r.code === 0 || r.stdout) ? r.stdout : "",
    backend: "claude",'''
content = content.replace(old_claude_return, new_claude_return)

old_gemini_return = '''output: (r.code === 0 || r.stdout) ? r.stdout : "",
    backend: "gemini",'''
# Already handled by the claude fix pattern, let's be explicit
old_gemini_return2 = '''output: r.code === 0 ? r.stdout : "",
    backend: "gemini",'''
new_gemini_return = '''output: (r.code === 0 || r.stdout) ? r.stdout : "",
    backend: "gemini",'''
content = content.replace(old_gemini_return2, new_gemini_return)

old_gpt_return = '''output: r.code === 0 ? r.stdout : "",
    backend: "chatgpt",'''
new_gpt_return = '''output: (r.code === 0 || r.stdout) ? r.stdout : "",
    backend: "chatgpt",'''
content = content.replace(old_gpt_return, new_gpt_return)

# Fix 3: error field - only set error if no output
old_err1 = '''error: r.code !== 0 ? (r.timedOut ? "timeout" : "exit " + r.code) : undefined,
  };
}

/**
 * Gemini CLI'''
new_err1 = '''error: (r.code !== 0 && !r.stdout) ? (r.timedOut ? "timeout" : "exit " + r.code) : undefined,
  };
}

/**
 * Gemini CLI'''
content = content.replace(old_err1, new_err1)

old_err2 = '''error: r.code !== 0 ? (r.timedOut ? "timeout" : "exit " + r.code) : undefined,
  };
}

/**
 * ChatGPT'''
new_err2 = '''error: (r.code !== 0 && !r.stdout) ? (r.timedOut ? "timeout" : "exit " + r.code) : undefined,
  };
}

/**
 * ChatGPT'''
content = content.replace(old_err2, new_err2)

# Last error field (ChatGPT)
old_err3 = '''error: r.code !== 0 ? (r.timedOut ? "timeout" : "exit " + r.code) : undefined,
  };
}

/**
 * 3AI'''
new_err3 = '''error: (r.code !== 0 && !r.stdout) ? (r.timedOut ? "timeout" : "exit " + r.code) : undefined,
  };
}

/**
 * 3AI'''
content = content.replace(old_err3, new_err3)

with open(fp, "w") as f:
    f.write(content)

print("multi-ai.ts patched:")
print("  1. Gemini: stdin instead of -p arg")
print("  2. All: stdout present = success even with non-zero exit")
