# AI_MEMORY取得失敗の修正

## 問題
- `gemini:` と `gpt:` プレフィックス経由で「AI_MEMORYの取得に失敗しました」が表示される

## 原因
環境変数 `AI_MEMORY_DOC_ID` が間違っていた：
- **誤**: `1aFvMLt58q0U8xVLSj2CjrBK6gUJwg0oaEQoXPuPXnNA`
- **正**: `172siSUWPADVWBV-IpcnxfjLP_pV5G_gUSmQiGTDbTCc`

## 修正内容

### 1. `.env` ファイル修正
```bash
# 修正前
AI_MEMORY_DOC_ID=1aFvMLt58q0U8xVLSj2CjrBK6gUJwg0oaEQoXPuPXnNA

# 修正後
AI_MEMORY_DOC_ID=172siSUWPADVWBV-IpcnxfjLP_pV5G_gUSmQiGTDbTCc
```

### 2. `ai-router.ts` 改善
- 詳細なエラーメッセージを追加
- 認証情報ファイルの存在確認を追加
- 404エラーの特別処理を追加
- デバッグログを整理

## 次のステップ

### mothershipでBotを再起動

**方法1: 手動再起動**
```bash
# SSH接続
ssh daijiromatsuokam1@192.168.1.20

# Botプロセスを確認
ps aux | grep "claude-telegram-bot"

# 既存プロセスを停止
pkill -f "bun.*telegram-bot"

# 新しいプロセスを起動
cd ~/claude-telegram-bot
bun run src/index.ts &
```

**方法2: 再起動スクリプト使用**
```bash
ssh daijiromatsuokam1@192.168.1.20 "cd ~/claude-telegram-bot && ./restart-bot.sh"
```

## 検証方法

Telegram Botで以下をテスト：
```
gemini: AI_MEMORYの内容を教えて
```

期待される結果：
- AI_MEMORYの内容が正常に取得される
- エラーメッセージが表示されない

## 関連ファイル
- `.env` - 環境変数設定
- `src/handlers/ai-router.ts` - AI Router実装
- `restart-bot.sh` - Bot再起動スクリプト
