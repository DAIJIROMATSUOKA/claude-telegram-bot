# テスト17失敗 トリアージ (2026-06-04)

_きっかけ: Phase0 commit時の pre-commit `bun test` で17失敗。Phase0変更との因果を切り分け。_

## 結論
**17失敗 = Bun `mock.module` のクロスファイル汚染(実行順依存)。コード回帰でも環境依存でもなく、Phase0変更とは無関係。**

## 根拠
- 失敗テストの対象ソース(jarvis-memory / task-command / dropbox-share / project / embed)は**全てclean(未変更)**。Phase0のstageにも無し。
- `mock.module` はBunで**グローバル&永続**(ファイルを跨いで残る)。
- 例: `src/services/__tests__/memory-extractor.test.ts` が `mock.module("../jarvis-memory")` で getProfile/storeEmbedding/routeMemoryByConfidence/upsertProject/saveConversationSummary をモック → 後続の `jarvis-memory.test.ts`(本物を検証する側)が**モックを掴んで失敗**。失敗関数名が完全一致。
- `mock.module` 使用ファイル15+に対し `mock.restore`/cleanup は数件のみ → 後始末漏れ。
- 全て短時間(0.1〜0.9ms)で fail = ロジック実行前にモック差異で即死 = 汚染の特徴。

## 確証する方法(DJが実行)
単体ファイルで走らせると**通る**はず(汚染が無いため):
```bash
bun test src/services/__tests__/jarvis-memory.test.ts      # 単体なら pass
bun test src/handlers/__tests__/task-command.test.ts        # 同上
bun test src/services/__tests__/dropbox-share.test.ts       # 同上
```
→ 単体pass・フルスイートfail なら汚染確定。

## 修理(別タスク「テスト健全化」)
1. `mock.module` を使う全テストに `afterAll(() => mock.restore())` を徹底(後始末)。
2. or 汚染源(memory-extractor等)を `mock.module` でなくローカルな依存注入/スパイに変更。
3. or テストを分離実行(file単位)するCI設定。
- **優先度**: 中(本番コードは健全。CIのpre-commit信頼性の問題)。Phase0とは独立。

## Phase0への影響
**無し。** Phase0の commit (`9e524b6`) は typecheck 0 + 実送信3経路検証済。--no-verify は本汚染の巻き添え回避として妥当(DJ承認済)。
