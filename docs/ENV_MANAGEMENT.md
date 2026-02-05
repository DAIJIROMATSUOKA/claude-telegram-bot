# 環境変数管理ガイド

## 原則

**すべての機密情報は `.env` ファイルのみで管理する**

## 禁止事項

以下のファイルに `TELEGRAM_BOT_TOKEN` や他の機密情報を書かないこと：

- `~/.zshrc`
- `~/.bashrc`
- `~/.bash_profile`
- `~/.profile`
- その他のシェル設定ファイル

## 理由

1. **セキュリティリスク**: シェル設定ファイルは様々なプロセスから読み込まれ、意図しない場所に機密情報が漏洩する可能性がある
2. **管理の複雑化**: 複数の場所に環境変数があると、どれが有効かわからなくなる
3. **バージョン管理の問題**: シェル設定ファイルは通常Git管理されているが、`.env`は`.gitignore`で除外されている

## 正しい方法

### 1. `.env` ファイルで管理

```bash
# ~/claude-telegram-bot/.env
TELEGRAM_BOT_TOKEN=your_token_here
TELEGRAM_ALLOWED_USERS=your_user_id
```

### 2. プログラムで明示的に読み込む

```typescript
// src/index.ts
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(import.meta.dir, "../.env") });
```

これにより、LaunchAgentから起動した場合でも正しく`.env`が読み込まれる。

## チェックリスト

定期的に以下を確認すること：

```bash
# シェル設定ファイルに機密情報がないか確認
grep -n "TELEGRAM_BOT_TOKEN" ~/.zshrc ~/.bashrc ~/.bash_profile ~/.profile 2>/dev/null

# .envファイルが正しく設定されているか確認
cat ~/claude-telegram-bot/.env | grep TELEGRAM_BOT_TOKEN

# .envファイルがGit管理されていないか確認
git -C ~/claude-telegram-bot check-ignore .env
# → ".env" と表示されればOK
```

## トラブルシューティング

### 起動通知が来ない場合

1. `.env`ファイルが存在するか確認
2. `TELEGRAM_ALLOWED_USERS`が正しく設定されているか確認
3. LaunchAgentのログを確認: `tail -f ~/.claude-telegram-bot.log`
4. エラーログを確認: `tail -f ~/.claude-telegram-bot.err.log`

### 環境変数が読み込まれない場合

1. `src/index.ts`の先頭で`dotenv.config()`が呼ばれているか確認
2. WorkingDirectoryが正しく設定されているか確認（LaunchAgent）
3. 手動起動でテスト: `cd ~/claude-telegram-bot && bun run src/index.ts`

## 履歴

- 2026-02-04: 初版作成。~/.zshrcからTELEGRAM_BOT_TOKENを削除し、.envのみで管理するよう変更
