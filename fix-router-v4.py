#!/usr/bin/env python3
"""
Smart Router Suggest - キーワードマッチ方式に変更
作成: クロッピー🦞

変更理由:
- モード判定(detectWorkMode)はchatting/planning等のスコアが拮抗し不安定
- 「この設計どう思う？」がchattingに判定されcouncil提案が出ない
- シンプルにキーワードマッチで判定する方式に変更
"""
import sys

TEXT_TS = "/Users/daijiromatsuokam1/claude-telegram-bot/src/handlers/text.ts"

with open(TEXT_TS, "r") as f:
    lines = f.readlines()

# === Step 1: 現在の12.5ブロックの開始行と終了行を特定 ===
start_idx = None
end_idx = None

for i, line in enumerate(lines):
    if "// 12.5. Smart Router" in line:
        start_idx = i
    # 12.5ブロック発見後、次のコメントブロック(// 13.)を見つけたら終了
    if start_idx is not None and i > start_idx and "// 13." in line:
        end_idx = i
        break

if start_idx is None or end_idx is None:
    print(f"❌ 12.5ブロックが見つかりません (start={start_idx}, end={end_idx})")
    print("手動確認が必要です")
    sys.exit(1)

print(f"Found 12.5 block: lines {start_idx+1}-{end_idx}")
print(f"Replacing {end_idx - start_idx} lines...")

# === Step 2: 新しいブロックで置換 ===
new_block = [
    "    // 12.5. Smart Router - suggest council for strategic questions\n",
    "    var _councilKeywords = /設計|design|アーキテクチャ|architecture|戦略|strategy|提案|proposal|方針|council/i;\n",
    "    if (_councilKeywords.test(message) && !_lm.startsWith('council') && !_lm.startsWith('croppy:')) {\n",
    "      var _ck = String(userId) + '_council';\n",
    "      if (!_routerSuggestedCache.has(_ck)) {\n",
    "        _routerSuggestedCache.add(_ck);\n",
    "        try {\n",
    "          await ctx.reply('💡 戦略的な相談は council: で聞いてみて');\n",
    "          console.log('[Smart Router] council suggestion sent');\n",
    "        } catch (e) {\n",
    "          console.error('[Smart Router] send failed:', e);\n",
    "        }\n",
    "        setTimeout(function() { _routerSuggestedCache.delete(_ck); }, 3600000);\n",
    "      }\n",
    "    }\n",
    "\n",
]

lines[start_idx:end_idx] = new_block

# === Step 3: _modeDetection が不要になったので関連行も削除 ===
# (import文とローカル変数宣言)
cleaned = []
removed = []
for i, line in enumerate(lines):
    if "import { detectWorkMode } from" in line:
        removed.append(f"  Removed line {i+1}: {line.strip()}")
        continue
    if "const _modeDetection = detectWorkMode(message);" in line:
        removed.append(f"  Removed line {i+1}: {line.strip()}")
        continue
    cleaned.append(line)

lines = cleaned

# === Step 4: 書き込み ===
with open(TEXT_TS, "w") as f:
    f.writelines(lines)

# === Step 5: 検証 ===
print("✅ パッチ適用完了!")
if removed:
    print("Cleaned up:")
    for r in removed:
        print(r)
print("\nVerification:")
with open(TEXT_TS) as f:
    for i, line in enumerate(f, 1):
        if "Smart Router" in line or "councilKeywords" in line:
            print(f"  {i}: {line.rstrip()}")
