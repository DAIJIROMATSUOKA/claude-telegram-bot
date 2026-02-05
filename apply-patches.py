#!/usr/bin/env python3
import sys

PROJECT = "/Users/daijiromatsuokam1/claude-telegram-bot"
TEXT_TS = f"{PROJECT}/src/handlers/text.ts"
INDEX_TS = f"{PROJECT}/src/index.ts"
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
    '    // 10.6. Tool Pre-Loading - Preload context based on work mode\n    let preloadedContext = \'\';\n    if (jarvisContext?.work_mode && jarvisContext.work_mode !== \'chatting\') {\n      const preloaded = preloadToolContext(jarvisContext.work_mode as any, WORKING_DIR);\n      preloadedContext = formatPreloadedContext(preloaded);\n      if (preloadedContext) {\n        console.log(`[Tool Preloader] Loaded context for mode: ${jarvisContext.work_mode}`);\n      }\n    }',
    '    // 10.6. Tool Pre-Loading - Detect file refs, git context, errors from message\n    let preloadedContext = \'\';\n    const preloaded = preloadToolContext(message);\n    preloadedContext = formatPreloadedContext(preloaded);\n    if (preloadedContext) {\n      console.log(`[Tool Preloader] Loaded ${preloaded.length} context(s): ${preloaded.map(p => p.type).join(\', \')}`);\n    }',
    "パッチ1: Tool Pre-Loader修正")

patch_file(TEXT_TS,
    'import { WORKING_DIR } from "../config";',
    'import { WORKING_DIR } from "../config";\n\n// Smart Router: 同じモードで連続提案しないようキャッシュ（1時間TTL）\nconst _routerSuggestedCache = new Set<string>();',
    "パッチ2-1: Smart Routerキャッシュ変数")

patch_file(TEXT_TS,
    '    // 12. Save assistant response to chat history\n    await saveChatMessage(userId, \'assistant\', response);\n\n    // 13. Auto-update jarvis_context (task, phase, assumptions, decisions)',
    '    // 12. Save assistant response to chat history\n    await saveChatMessage(userId, \'assistant\', response);\n\n    // 12.5. Smart Router - suggest council for planning-mode questions\n    if (jarvisContext?.work_mode === \'planning\' &&\n        jarvisContext.mode_confidence >= 0.7 &&\n        !_lm.startsWith(\'council\') &&\n        !_lm.startsWith(\'croppy:\')) {\n      const cacheKey = `${userId}_planning`;\n      if (!_routerSuggestedCache.has(cacheKey)) {\n        _routerSuggestedCache.add(cacheKey);\n        await ctx.reply(\'💡 戦略的な相談は council: で聞いてみて\');\n        setTimeout(() => _routerSuggestedCache.delete(cacheKey), 60 * 60 * 1000);\n      }\n    }\n\n    // 13. Auto-update jarvis_context (task, phase, assumptions, decisions)',
    "パッチ2-2: Smart Router提案メッセージ")

patch_file(INDEX_TS,
    'const runner = run(bot);\n\n// Graceful shutdown',
    'const runner = run(bot);\n\n// Startup notification - DJに起動完了を通知\ntry {\n  const djChatId = ALLOWED_USERS[0];\n  if (djChatId) {\n    await bot.api.sendMessage(djChatId, \'🤖 Jarvis起動完了\');\n    console.log(\'📨 Startup notification sent to DJ\');\n  }\n} catch (e) {\n  console.warn(\'⚠️ Startup notification failed (non-fatal):\', e);\n}\n\n// Graceful shutdown',
    "パッチ3: Startup通知")

print("\n" + "=" * 40)
if errors:
    print(f"⚠️ {len(errors)}件のエラー:")
    for e in errors:
        print(f"  {e}")
    sys.exit(1)
else:
    print("✅ 全4パッチ適用完了!")
    sys.exit(0)
