#!/usr/bin/env python3
"""Smart Router提案の修正パッチ v2 - Memory Gateway依存排除"""
import sys

TEXT_TS = "/Users/daijiromatsuokam1/claude-telegram-bot/src/handlers/text.ts"
errors = []

def patch_file(path, old, new, label):
    with open(path, "r") as f:
        content = f.read()
    if old not in content:
        errors.append(f"❌ {label}: 置換対象が見つかりません")
        return False
    if content.count(old) > 1:
        errors.append(f"❌ {label}: 置換対象が複数あります（{content.count(old)}箇所）")
        return False
    content = content.replace(old, new)
    with open(path, "w") as f:
        f.write(content)
    print(f"✅ {label}")
    return True

# パッチA: detectWorkMode のimport追加
patch_file(TEXT_TS,
    'import { autoUpdateContext, getJarvisContext, autoDetectAndUpdateWorkMode } from "../utils/jarvis-context";',
    'import { autoUpdateContext, getJarvisContext, autoDetectAndUpdateWorkMode } from "../utils/jarvis-context";\nimport { detectWorkMode } from "../utils/context-detector";',
    "パッチA: detectWorkMode import追加")

# パッチB: ローカル変数に判定結果を保持
patch_file(TEXT_TS,
    '    // 10.5. Smart AI Router - Auto-detect work mode and update DB\n    await autoDetectAndUpdateWorkMode(userId, message);',
    '    // 10.5. Smart AI Router - Auto-detect work mode and update DB\n    const _modeDetection = detectWorkMode(message);\n    await autoDetectAndUpdateWorkMode(userId, message);',
    "パッチB: ローカル判定結果保持")

# パッチC: 12.5の条件をローカル計算結果に変更
patch_file(TEXT_TS,
    "    // 12.5. Smart Router - suggest council for planning-mode questions\n    if (jarvisContext?.work_mode === 'planning' &&\n        jarvisContext.mode_confidence >= 0.7 &&\n        !_lm.startsWith('council') &&\n        !_lm.startsWith('croppy:')) {",
    "    // 12.5. Smart Router - suggest council for planning-mode questions\n    if (_modeDetection.mode === 'planning' &&\n        _modeDetection.confidence >= 0.5 &&\n        !_lm.startsWith('council') &&\n        !_lm.startsWith('croppy:')) {",
    "パッチC: DB依存排除+閾値0.5")

print("\n" + "=" * 40)
if errors:
    print(f"⚠️ {len(errors)}件のエラー:")
    for e in errors:
        print(f"  {e}")
    sys.exit(1)
else:
    print("✅ 全3パッチ適用完了!")
    sys.exit(0)
