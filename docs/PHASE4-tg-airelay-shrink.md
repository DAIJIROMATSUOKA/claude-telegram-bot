# Phase 4: Telegram AI-relay 縮退 (Chrome orchestration撤去)

*2026-06-04 調査。前提: [[CC-ONLY-MIGRATION-DESIGN.md]] / MEMORY task-state「Phase4=条件付」*

## 結論
TG botの**心臓部 = 平文メッセージ→claude.ai Chromeタブ中継**。RC移行でDJはClaude Code直接運用に移行 → この中継経路は原則未使用の遺物。撤去は `text.ts`(主メッセージルータ)の解きほぐしを伴う**大型フェーズ**。機械的縮退でなく**設計判断を要する**。

## 構造: text.ts の平文ルーティング(全段Chrome中継)
```
平文メッセージ →
  1. F5 Domain routing   handleDomainRelay → domain-relay.sh → croppy-tab-manager.sh(claude.ai専門チャット)
  2. Orchestrator fallback getChromeOrchestrator → M番号 → claude.aiプロジェクトタブ
  3. Chat/Bridge reply    handleChatReply / handleBridgeReply(Telegramリプライ→claude.ai)
  4. Default              dispatchToWorker → claude.ai Workerタブ   ← 平文の既定動作
```

## 撤去footprint
| 種別 | 対象 | 備考 |
|---|---|---|
| TSハブ | `text.ts`(244-458の Chrome経路) | 主ルータ。解きほぐし必須 |
| TS handler | orchestrator-chrome.ts / claude-chat.ts / croppy-bridge.ts | text.tsがimport(Phase1-2で残置) |
| TS handler | refresh-command.ts(`/refresh`) | Access差分→claude.aiタブ。RC後obsolete |
| TS service | domain-buffer.ts | Chrome中継バッファ |
| TS service | inbox-triage.ts のChrome経路 | **設計分岐**(下記) |
| constants | CROPPY_TAB_MANAGER 他 | |
| scripts ~3138行 | croppy-tab-manager.sh(1146) / domain-relay.sh(233) / project-tab-router.sh(379) / project-context-builder.sh(354) / nightly-forge-chrome.sh(775) / nightshift.sh(175) / croppy-health.sh(76) | |
| LaunchAgent | nightly-forge / croppy-health系(あれば) | launchd要注意 |

## 即・安全(設計判断不要、いつでも可)
- **inbox-triage の死に3関数** `findReadyWorker` / `injectTriage` / `waitForResponse` = 定義のみ・呼出ゼロ → 削除可
- **`/refresh`** = Access差分→claude.aiタブ投入(RC後機能せず) → 撤去可(DJが/refresh不使用なら)

## 設計判断ゲート(DJ) ★これが先
**平文メッセージをTG botに送った時、撤去後どうする?**
- **A) `claude -p` CLI中継**: TG=AI窓口をRC(Claude Code)で維持。dispatchToWorker を claude -p spawn に置換。/code に近い。
- **B) AI中継廃止**: TG = 通知 + FAコマンドのみ。平文は短いヒント返し or スルー。MEMORY「99%CODE・TG=通知transport」と整合。最も縮退的。
- **C) 当面据置**: Chrome経路は黙って失敗するだけ。心臓部は触らず、即・安全部分(死に関数/refresh)のみ縮退。

## 推奨
**B**(方針と整合)。ただし即実行は影響大 → まず **C の即・安全部分**を片付け、本体撤去(text.ts解体)は B 確定後に別フェーズで慎重に。

---

## 進捗 (2026-06-04, branch phase0-tg-shrink, 未コミット)
**【決定】DJ承認=B(AI中継廃止)。**

### ✅ 完了(型クリーン TC_EXIT=0)
- **text.ts 本体改修**: handleText から claude.ai Chrome中継ルーティングを全撤去(20165→7749 bytes)。
  - 撤去: Domain reply / Direct domain send(/domain) / F5 domain routing / Orchestrator fallback / INBOX relay / Chat+Bridge reply / default dispatchToWorker
  - 置換: 平文 default = 「AI中継廃止、Claude Codeへ」hint返し(B)
  - import削除5本(domain-buffer/croppy-bridge/claude-chat/orchestrator-chrome/domain-router) + localヘルパー2(djQuote/sendRelayResponse)
  - 保持: [AGENT] / deadline / routeToProjectNotes / inbox-zero reply / memo(。) / task(、) / croppy:debug / rate-limit / /line /mail /imsg / AI Session Bridge(CLI=spawn claude, 非Chrome)

### ⏳ 残(Phase4-B 完遂に必要)
1. **voice-chat.ts も dispatchToWorker でChrome中継** → B適用(音声→中継廃止)要
2. **テスト改修**: text.test.ts(「routes plain text to dispatchToWorker」「handleChatReply/handleBridgeReply」等 旧挙動アサート)/ voice-chat.test.ts / claude-chat.test.ts。旧Chrome挙動の検証を削除orB対応に書換。**未改修だと bun test(pre-commit)赤**。
3. **孤立ハンドラ削除**: claude-chat.ts / orchestrator-chrome.ts(text.tsが唯一の親→孤立) / croppy-bridge.ts / domain-router.ts / domain-buffer.ts(要 orphan確認。croppy-bridge←orchestrator-chrome相互)
4. **/refresh 撤去**: refresh-command.ts + index.ts登録
5. **scripts撤去**: croppy-tab-manager.sh他。**ただし inbox-triage が domain-relay.sh/croppy-tab-manager.sh を domainTriageInject で使用中** → inbox-triageのChrome triage廃止(CLI化 or watcher置換)を先に決める要。死に3関数(findReadyWorker/injectTriage/waitForResponse)は即削除可。
6. launchd: croppy-health(既にdisabled) / nightly-forge-chrome 等の停止確認

### コミット境界の注意
text.ts単独commitは pre-commit の bun test がtext.test.tsで赤になる → テスト改修と同一commitにする(or --no-verify+即テスト追従)。bot稼働は再起動まで無影響(現行は旧コード)。
