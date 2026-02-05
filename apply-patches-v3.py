#!/usr/bin/env python3
"""Smart Router デバッグログ追加 + エラーハンドリング"""
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

patch_file(TEXT_TS,
    "    // 12.5. Smart Router - suggest council for planning-mode questions\n    if (_modeDetection.mode === 'planning' &&\n        _modeDetection.confidence >= 0.5 &&\n        !_lm.startsWith('council') &&\n        !_lm.startsWith('croppy:')) {\n      const cacheKey = `${userId}_planning`;\n      if (!_routerSuggestedCache.has(cacheKey)) {\n        _routerSuggestedCache.add(cacheKey);\n        await ctx.reply('💡 戦略的な相談は council: で聞いてみて');\n        setTimeout(() => _routerSuggestedCache.delete(cacheKey), 60 * 60 * 1000);\n      }\n    }",
    "    // 12.5. Smart Router - suggest council for planning-mode questions\n    console.log(`[Smart Router Suggest] mode=${_modeDetection.mode}, confidence=${_modeDetection.confidence}, lm=${_lm.slice(0,30)}`);\n    if (_modeDetection.mode === 'planning' &&\n        _modeDetection.confidence >= 0.5 &&\n        !_lm.startsWith('council') &&\n        !_lm.startsWith('croppy:')) {\n      const cacheKey = `${userId}_planning`;\n      if (!_routerSuggestedCache.has(cacheKey)) {\n        _routerSuggestedCache.add(cacheKey);\n        try {\n          await ctx.reply('💡 戦略的な相談は council: で聞いてみて');\n          console.log('[Smart Router Suggest] ✅ Sent council suggestion');\n        } catch (e) {\n          console.error('[Smart Router Suggest] ❌ Failed to send:', e);\n        }\n        setTimeout(() => _routerSuggestedCache.delete(cacheKey), 60 * 60 * 1000);\n      } else {\n        console.log('[Smart Router Suggest] Skipped (cached)');\n      }\n    }",
    "パッチ: Smart Routerデバッグログ+エラーハンドリング")

print("\n" + "=" * 40)
if errors:
    print(f"⚠️ {len(errors)}件のエラー:")
    for e in errors:
        print(f"  {e}")
    sys.exit(1)
else:
    print("✅ パッチ適用完了!")
    sys.exit(0)
