#!/usr/bin/env python3
"""Patch media-commands.ts: add withMediaQueue wrapper around all runAiMedia calls"""

import os

REPO = os.path.expanduser("~/claude-telegram-bot")
PATH = os.path.join(REPO, "src/handlers/media-commands.ts")

with open(PATH) as f:
    content = f.read()

# Step 1: Add queue function after last import
lines = content.split('\n')
last_import = 0
for i, line in enumerate(lines):
    if line.startswith('import ') or line.startswith('} from '):
        last_import = i

QUEUE_FN = [
    '',
    '// Media queue: serialize heavy AI tasks to prevent SIGTERM under memory pressure',
    'let mediaQueueBusy = false;',
    'const mediaQueueWaiting: Array<{ run: () => Promise<any>; resolve: (v: any) => void; reject: (e: any) => void }> = [];',
    'async function withMediaQueue<T>(fn: () => Promise<T>): Promise<T> {',
    '  if (mediaQueueBusy) {',
    '    return new Promise<T>((resolve, reject) => { mediaQueueWaiting.push({ run: fn, resolve, reject }); });',
    '  }',
    '  mediaQueueBusy = true;',
    '  try { return await fn(); }',
    '  finally {',
    '    const next = mediaQueueWaiting.shift();',
    '    if (next) { next.run().then(next.resolve, next.reject).finally(() => { mediaQueueBusy = false; }); }',
    '    else { mediaQueueBusy = false; }',
    '  }',
    '}',
]

for idx, qline in enumerate(QUEUE_FN):
    lines.insert(last_import + 1 + idx, qline)

content = '\n'.join(lines)

# Step 2: Wrap each "await runAiMedia(" with "await withMediaQueue(() => runAiMedia("
# Strategy: find "await runAiMedia(" then track parens to find the matching ")"
NEEDLE = 'await runAiMedia('
count = 0
result = []
i = 0
n = len(content)

while i < n:
    if content[i:i+len(NEEDLE)] == NEEDLE:
        # Found "await runAiMedia("
        paren_pos = i + len(NEEDLE) - 1  # position of the opening (
        depth = 1
        j = paren_pos + 1
        while j < n and depth > 0:
            if content[j] == '(':
                depth += 1
            elif content[j] == ')':
                depth -= 1
            j += 1
        # j is now right after the closing )
        # content[paren_pos+1 : j-1] is the inner content
        inner = content[paren_pos+1 : j-1]
        result.append('await withMediaQueue(() => runAiMedia(')
        result.append(inner)
        result.append('))')
        i = j
        count += 1
    else:
        result.append(content[i])
        i += 1

content = ''.join(result)

with open(PATH, 'w') as f:
    f.write(content)

print(f"OK: Inserted queue function after line {last_import + 1}")
print(f"OK: Wrapped {count} runAiMedia calls")
if count != 5:
    print(f"WARNING: Expected 5, got {count}")
