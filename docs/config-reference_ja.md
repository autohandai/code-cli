# Autohand 設定リファレンス

`~/.autohand/config.json`（または`.yaml`/`.yml`）のすべての設定オプションの完全なリファレンスです。

## 目次

- [設定ファイルの場所](#設定ファイルの場所)
- [環境変数](#環境変数)
- [プロバイダー設定](#プロバイダー設定)
- [ワークスペース設定](#ワークスペース設定)
- [UI設定](#ui設定)
- [エージェント設定](#エージェント設定)
- [権限設定](#権限設定)
- [ネットワーク設定](#ネットワーク設定)
- [テレメトリー設定](#テレメトリー設定)
- [外部エージェント](#外部エージェント)
- [スキルシステム](#スキルシステム)
- [API設定](#api設定)
- [認証設定](#認証設定)
- [コミュニティスキル設定](#コミュニティスキル設定)
- [共有設定](#共有設定)
- [フック設定](#フック設定)
- [完全な例](#完全な例)

---

## 設定ファイルの場所

Autohandは以下の順序で設定を検索します：

1. `AUTOHAND_CONFIG` 環境変数（カスタムパス）
2. `~/.autohand/config.yaml`
3. `~/.autohand/config.yml`
4. `~/.autohand/config.json`（デフォルト）

ベースディレクトリをオーバーライドすることもできます：
```bash
export AUTOHAND_HOME=/custom/path  # ~/.autohand を /custom/path に変更
```

---

## 環境変数

| 変数 | 説明 | 例 |
|------|------|-----|
| `AUTOHAND_HOME` | すべてのAutohandデータのベースディレクトリ | `/custom/path` |
| `AUTOHAND_CONFIG` | カスタム設定ファイルパス | `/path/to/config.json` |
| `AUTOHAND_API_URL` | APIエンドポイント（設定をオーバーライド） | `https://api.autohand.ai` |
| `AUTOHAND_SECRET` | 会社/チームの秘密鍵 | `sk-xxx` |
| `AUTOHAND_PERMISSION_CALLBACK_URL` | 権限コールバック用URL（実験的） | `http://localhost:3000/callback` |
| `AUTOHAND_PERMISSION_CALLBACK_TIMEOUT` | 権限コールバックのタイムアウト（ミリ秒） | `5000` |
| `AUTOHAND_NON_INTERACTIVE` | 非対話モードで実行 | `1` |
| `AUTOHAND_YES` | すべてのプロンプトを自動確認 | `1` |
| `AUTOHAND_NO_BANNER` | 起動バナーを無効化 | `1` |
| `AUTOHAND_STREAM_TOOL_OUTPUT` | ツール出力をリアルタイムでストリーム | `1` |
| `AUTOHAND_DEBUG` | デバッグログを有効化 | `1` |
| `AUTOHAND_THINKING_LEVEL` | 推論の深さレベルを設定 | `normal` |
| `AUTOHAND_CLIENT_NAME` | クライアント/エディター識別子（ACP拡張機能で設定） | `zed` |
| `AUTOHAND_CLIENT_VERSION` | クライアントバージョン（ACP拡張機能で設定） | `0.169.0` |

### 思考レベル

`AUTOHAND_THINKING_LEVEL` 環境変数は、モデルが使用する推論の深さを制御します：

| 値 | 説明 |
|------|------|
| `none` | 可視的な推論なしの直接応答 |
| `normal` | 標準的な推論の深さ（デフォルト） |
| `extended` | 複雑なタスク用の深い推論、より詳細な思考プロセスを表示 |

これは通常、設定ドロップダウンを通じてACPクライアント拡張機能（Zedなど）によって設定されます。

```bash
# 例：複雑なタスクに拡張思考を使用
AUTOHAND_THINKING_LEVEL=extended autohand --prompt "このモジュールをリファクタリング"
```

---

## プロバイダー設定

### `provider`
使用するアクティブなLLMプロバイダー。

| 値 | 説明 |
|------|------|
| `"openrouter"` | OpenRouter API（デフォルト） |
| `"ollama"` | ローカルOllamaインスタンス |
| `"llamacpp"` | ローカルllama.cppサーバー |
| `"openai"` | OpenAI API直接 |

### `openrouter`
OpenRouterプロバイダー設定。

```json
{
  "openrouter": {
    "apiKey": "sk-or-v1-xxx",
    "baseUrl": "https://openrouter.ai/api/v1",
    "model": "anthropic/claude-sonnet-4"
  }
}
```

| フィールド | 型 | 必須 | デフォルト | 説明 |
|------------|------|------|---------|------|
| `apiKey` | string | はい | - | OpenRouter APIキー |
| `baseUrl` | string | いいえ | `https://openrouter.ai/api/v1` | APIエンドポイント |
| `model` | string | はい | - | モデル識別子（例：`anthropic/claude-sonnet-4`） |

### `ollama`
Ollamaプロバイダー設定。

```json
{
  "ollama": {
    "baseUrl": "http://localhost:11434",
    "port": 11434,
    "model": "llama3.2"
  }
}
```

| フィールド | 型 | 必須 | デフォルト | 説明 |
|------------|------|------|---------|------|
| `baseUrl` | string | いいえ | `http://localhost:11434` | OllamaサーバーURL |
| `port` | number | いいえ | `11434` | サーバーポート（baseUrlの代替） |
| `model` | string | はい | - | モデル名（例：`llama3.2`、`codellama`） |

### `llamacpp`
llama.cppサーバー設定。

```json
{
  "llamacpp": {
    "baseUrl": "http://localhost:8080",
    "port": 8080,
    "model": "default"
  }
}
```

| フィールド | 型 | 必須 | デフォルト | 説明 |
|------------|------|------|---------|------|
| `baseUrl` | string | いいえ | `http://localhost:8080` | llama.cppサーバーURL |
| `port` | number | いいえ | `8080` | サーバーポート |
| `model` | string | はい | - | モデル識別子 |

### `openai`
OpenAI API設定。

```json
{
  "openai": {
    "apiKey": "sk-xxx",
    "baseUrl": "https://api.openai.com/v1",
    "model": "gpt-4o"
  }
}
```

| フィールド | 型 | 必須 | デフォルト | 説明 |
|------------|------|------|---------|------|
| `apiKey` | string | はい | - | OpenAI APIキー |
| `baseUrl` | string | いいえ | `https://api.openai.com/v1` | APIエンドポイント |
| `model` | string | はい | - | モデル名（例：`gpt-4o`、`gpt-4o-mini`） |

---

## ワークスペース設定

```json
{
  "workspace": {
    "defaultRoot": "/path/to/projects",
    "allowDangerousOps": false
  }
}
```

| フィールド | 型 | デフォルト | 説明 |
|------------|------|---------|------|
| `defaultRoot` | string | 現在のディレクトリ | 指定がない場合のデフォルトワークスペース |
| `allowDangerousOps` | boolean | `false` | 確認なしで破壊的操作を許可 |

### ワークスペースの安全性

Autohandは偶発的な損傷を防ぐため、危険なディレクトリでの操作を自動的にブロックします：

- **ファイルシステムルート** (`/`、`C:\`、`D:\` など)
- **ホームディレクトリ** (`~`、`/Users/<user>`、`/home/<user>`、`C:\Users\<user>`)
- **システムディレクトリ** (`/etc`、`/var`、`/System`、`C:\Windows` など)
- **WSL Windowsマウント** (`/mnt/c`、`/mnt/c/Users/<user>`)

このチェックはバイパスできません。危険なディレクトリでautohandを実行しようとすると、エラーが表示され、安全なプロジェクトディレクトリを指定する必要があります。

```bash
# これはブロックされます
cd ~ && autohand
# エラー: 安全でないワークスペースディレクトリ

# これは動作します
cd ~/projects/my-app && autohand
```

詳細は[ワークスペースの安全性](./workspace-safety.md)を参照してください。

---

## UI設定

```json
{
  "ui": {
    "theme": "dark",
    "autoConfirm": false,
    "readFileCharLimit": 300,
    "showCompletionNotification": true,
    "showThinking": true,
    "useInkRenderer": false,
    "terminalBell": true,
    "checkForUpdates": true,
    "updateCheckInterval": 24
  }
}
```

| フィールド | 型 | デフォルト | 説明 |
|------------|------|---------|------|
| `theme` | `"dark"` \| `"light"` | `"dark"` | ターミナル出力のカラーテーマ |
| `autoConfirm` | boolean | `false` | 安全な操作の確認プロンプトをスキップ |
| `readFileCharLimit` | number | `300` | 読み取り/検索ツール出力の最大表示文字数（完全な内容はモデルに送信されます） |
| `showCompletionNotification` | boolean | `true` | タスク完了時にシステム通知を表示 |
| `showThinking` | boolean | `true` | LLMの推論/思考プロセスを表示 |
| `useInkRenderer` | boolean | `false` | フリッカーフリーUI用のInkベースレンダラーを使用（実験的） |
| `terminalBell` | boolean | `true` | タスク完了時にターミナルベルを鳴らす（ターミナルタブ/ドックにバッジを表示） |
| `checkForUpdates` | boolean | `true` | 起動時にCLI更新を確認 |
| `updateCheckInterval` | number | `24` | 更新確認の間隔（時間）（間隔内はキャッシュ結果を使用） |

注：`readFileCharLimit` は `read_file`、`search`、`search_with_context` のターミナル表示にのみ影響します。完全な内容はモデルに送信され、ツールメッセージに保存されます。

### ターミナルベル

`terminalBell` が有効（デフォルト）の場合、Autohandはタスク完了時にターミナルベル（`\x07`）を鳴らします。これによりトリガーされるもの：

- **ターミナルタブのバッジ** - 作業完了を示す視覚的インジケーター
- **ドックアイコンのバウンス** - ターミナルがバックグラウンドにあるときに注意を引く（macOS）
- **サウンド** - ターミナル設定でターミナルサウンドが有効な場合

ターミナル固有の設定：
- **macOS Terminal**: 環境設定 > プロファイル > 詳細 > ベル（視覚/聴覚）
- **iTerm2**: 環境設定 > プロファイル > ターミナル > 通知
- **VS Code Terminal**: 設定 > ターミナル > 統合: ベルを有効にする

無効にするには：
```json
{
  "ui": {
    "terminalBell": false
  }
}
```

### Inkレンダラー（実験的）

`useInkRenderer` が有効な場合、Autohandは従来のoraスピナーの代わりにReactベースのターミナルレンダリング（Ink）を使用します。これにより：

- **フリッカーフリー出力**: すべてのUI更新がReact調整を通じてバッチ処理
- **作業キュー機能**: エージェントが作業中に指示を入力
- **より良い入力処理**: readlineハンドラー間の競合なし
- **コンポーザブルUI**: 将来の高度なUI機能の基盤

有効にするには：
```json
{
  "ui": {
    "useInkRenderer": true
  }
}
```

注：この機能は実験的であり、エッジケースがある可能性があります。デフォルトのoraベースUIは安定しており、完全に機能します。

### 更新確認

`checkForUpdates` が有効（デフォルト）の場合、Autohandは起動時に新しいリリースを確認します：

```
> Autohand v0.6.8 (abc1234) ✓ 最新版です
```

更新が利用可能な場合：
```
> Autohand v0.6.7 (abc1234) ⬆ 更新があります: v0.6.8
  ↳ 実行: curl -fsSL https://autohand.ai/install.sh | sh
```

仕組み：
- GitHub APIから最新リリースを取得
- 結果を `~/.autohand/version-check.json` にキャッシュ
- `updateCheckInterval` 時間ごとに1回のみ確認（デフォルト：24時間）
- ノンブロッキング：確認が失敗しても起動は継続

無効にするには：
```json
{
  "ui": {
    "checkForUpdates": false
  }
}
```

または環境変数経由：
```bash
export AUTOHAND_SKIP_UPDATE_CHECK=1
```

---

## エージェント設定

エージェントの動作と反復制限を制御します。

```json
{
  "agent": {
    "maxIterations": 100,
    "enableRequestQueue": true,
    "debug": false
  }
}
```

| フィールド | 型 | デフォルト | 説明 |
|------------|------|---------|------|
| `maxIterations` | number | `100` | 停止前のユーザーリクエストあたりの最大ツール反復回数 |
| `enableRequestQueue` | boolean | `true` | エージェント作業中にユーザーがリクエストを入力してキューに入れることを許可 |
| `debug` | boolean | `false` | 詳細なデバッグ出力を有効化（エージェント内部状態をstderrにログ） |

### デバッグモード

デバッグモードを有効にすると、エージェント内部状態の詳細なログ（reactループの反復、プロンプト構築、セッション詳細）が表示されます。出力は通常の出力に干渉しないようにstderrに送られます。

デバッグモードを有効にする3つの方法（優先順位順）：

1. **CLIフラグ**: `autohand -d` または `autohand --debug`
2. **環境変数**: `AUTOHAND_DEBUG=1`
3. **設定ファイル**: `agent.debug: true` を設定

### リクエストキュー

`enableRequestQueue` が有効な場合、エージェントが前のリクエストを処理している間もメッセージを入力し続けることができます。入力はキューに入り、現在のタスクが完了すると自動的に処理されます。

- メッセージを入力してEnterを押すとキューに追加
- ステータス行にキューされているリクエスト数を表示
- リクエストはFIFO（先入れ先出し）順で処理
- 最大キューサイズは10リクエスト

---

## 権限設定

ツール権限の細かい制御。

```json
{
  "permissions": {
    "mode": "interactive",
    "whitelist": [
      "run_command:npm *",
      "run_command:bun *",
      "run_command:git status"
    ],
    "blacklist": [
      "run_command:rm -rf *",
      "run_command:sudo *"
    ],
    "rules": [
      {
        "tool": "run_command",
        "pattern": "npm test",
        "action": "allow"
      }
    ],
    "rememberSession": true
  }
}
```

### `mode`

| 値 | 説明 |
|------|------|
| `"interactive"` | 危険な操作時に承認をプロンプト（デフォルト） |
| `"unrestricted"` | プロンプトなし、すべて許可 |
| `"restricted"` | すべての危険な操作を拒否 |

### `whitelist`
承認を必要としないツールパターンの配列。

```json
["run_command:npm *", "run_command:bun test"]
```

### `blacklist`
常にブロックされるツールパターンの配列。

```json
["run_command:rm -rf /", "run_command:sudo *"]
```

### `rules`
細かい権限ルール。

| フィールド | 型 | 説明 |
|------------|------|------|
| `tool` | string | マッチするツール名 |
| `pattern` | string | 引数とマッチするオプションのパターン |
| `action` | `"allow"` \| `"deny"` \| `"prompt"` | 実行するアクション |

### `rememberSession`
| 型 | デフォルト | 説明 |
|------|---------|------|
| boolean | `true` | セッション中の承認決定を記憶 |

### ローカルプロジェクト権限

各プロジェクトはグローバル設定をオーバーライドする独自の権限設定を持つことができます。これらはプロジェクトルートの `.autohand/settings.local.json` に保存されます。

ファイル操作（編集、書き込み、削除）を承認すると、このファイルに自動的に保存され、このプロジェクトで同じ操作を再度尋ねられることはありません。

```json
{
  "version": 1,
  "permissions": {
    "whitelist": [
      "multi_file_edit:src/components/Button.tsx",
      "write_file:package.json",
      "run_command:bun test"
    ]
  }
}
```

**仕組み：**
- 操作を承認すると、`.autohand/settings.local.json` に保存
- 次回は同じ操作が自動承認
- ローカルプロジェクト設定はグローバル設定とマージ（ローカルが優先）
- `.autohand/settings.local.json` を `.gitignore` に追加して個人設定をプライベートに

**パターン形式：**
- `tool_name:path` - ファイル操作用（例：`multi_file_edit:src/file.ts`）
- `tool_name:command args` - コマンド用（例：`run_command:npm test`）

### 権限の表示

現在の権限設定を2つの方法で表示できます：

**CLIフラグ（非対話）：**
```bash
autohand --permissions
```

表示内容：
- 現在の権限モード（interactive、unrestricted、restricted）
- ワークスペースと設定ファイルのパス
- すべての承認パターン（ホワイトリスト）
- すべての拒否パターン（ブラックリスト）
- サマリー統計

**対話コマンド：**
```
/permissions
```

対話モードでは、`/permissions` コマンドは同じ情報に加えて以下のオプションを提供：
- ホワイトリストからアイテムを削除
- ブラックリストからアイテムを削除
- 保存されたすべての権限をクリア

---

## パッチモード

パッチモードでは、ワークスペースファイルを変更せずに共有可能なgit互換パッチを生成できます。用途：
- 変更適用前のコードレビュー
- AI生成の変更をチームメンバーと共有
- 再現可能な変更セットの作成
- 変更を適用せずにキャプチャする必要があるCI/CDパイプライン

### 使用方法

```bash
# 標準出力にパッチを生成
autohand --prompt "ユーザー認証を追加" --patch

# ファイルに保存
autohand --prompt "ユーザー認証を追加" --patch --output auth.patch

# パイプでファイルに（代替方法）
autohand --prompt "APIハンドラーをリファクタリング" --patch > refactor.patch
```

### 動作

`--patch` が指定された場合：
- **自動確認**: すべての確認が自動的に受け入れ（`--yes` が暗黙的）
- **プロンプトなし**: 承認プロンプトは表示されない（`--unrestricted` が暗黙的）
- **プレビューのみ**: 変更はキャプチャされるがディスクには書き込まれない
- **セキュリティ強制**: ブラックリスト操作（`.env`、SSHキー、危険なコマンド）は引き続きブロック

### パッチの適用

受信者は標準的なgitコマンドでパッチを適用できます：

```bash
# 適用されるものを確認（ドライラン）
git apply --check changes.patch

# パッチを適用
git apply changes.patch

# 3方向マージで適用（競合をより適切に処理）
git apply -3 changes.patch

# 適用して変更をステージング
git apply --index changes.patch

# パッチを元に戻す
git apply -R changes.patch
```

### パッチ形式

生成されるパッチはgitの統一diff形式に従います：

```diff
diff --git a/src/auth.ts b/src/auth.ts
new file mode 100644
--- /dev/null
+++ b/src/auth.ts
@@ -0,0 +1,15 @@
+export function authenticate(user: string, password: string) {
+  // 実装はここに
+}

diff --git a/src/index.ts b/src/index.ts
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,5 +1,7 @@
 import express from 'express';
+import { authenticate } from './auth';

 const app = express();
+app.use(authenticate);
```

### 終了コード

| コード | 意味 |
|--------|------|
| `0` | 成功、パッチ生成 |
| `1` | エラー（`--prompt` 欠落、権限拒否など） |

### 他のフラグとの組み合わせ

```bash
# 特定のモデルを使用
autohand --prompt "クエリを最適化" --patch --model gpt-4o

# ワークスペースを指定
autohand --prompt "テストを追加" --patch --path ./my-project

# カスタム設定を使用
autohand --prompt "リファクタリング" --patch --config ~/.autohand/work.json
```

### チームワークフローの例

```bash
# 開発者A: 機能のパッチを生成
autohand --prompt "チャート付きユーザーダッシュボードを実装" --patch --output dashboard.patch

# git経由で共有（パッチファイルのみでPRを作成）
git checkout -b patch/dashboard
git add dashboard.patch
git commit -m "ダッシュボード機能パッチを追加"
git push

# 開発者B: レビューして適用
git fetch origin patch/dashboard
git apply dashboard.patch
# テスト実行、コードレビュー、その後コミット
git add -A && git commit -m "feat: チャート付きユーザーダッシュボードを追加"
```

---

## ネットワーク設定

```json
{
  "network": {
    "maxRetries": 3,
    "timeout": 30000,
    "retryDelay": 1000
  }
}
```

| フィールド | 型 | デフォルト | 最大 | 説明 |
|------------|------|---------|------|------|
| `maxRetries` | number | `3` | `5` | 失敗したAPIリクエストのリトライ回数 |
| `timeout` | number | `30000` | - | リクエストタイムアウト（ミリ秒） |
| `retryDelay` | number | `1000` | - | リトライ間の遅延（ミリ秒） |

---

## テレメトリー設定

テレメトリーは**デフォルトで無効**です（オプトイン）。有効にするとAutohandの改善に役立ちます。

```json
{
  "telemetry": {
    "enabled": false,
    "apiBaseUrl": "https://api.autohand.ai",
    "batchSize": 20,
    "flushIntervalMs": 60000,
    "maxQueueSize": 500,
    "maxRetries": 3,
    "enableSessionSync": false,
    "companySecret": ""
  }
}
```

| フィールド | 型 | デフォルト | 説明 |
|------------|------|---------|------|
| `enabled` | boolean | `false` | テレメトリーの有効/無効（オプトイン） |
| `apiBaseUrl` | string | `https://api.autohand.ai` | テレメトリーAPIエンドポイント |
| `batchSize` | number | `20` | 自動フラッシュ前にバッチするイベント数 |
| `flushIntervalMs` | number | `60000` | フラッシュ間隔（ミリ秒、1分） |
| `maxQueueSize` | number | `500` | 古いイベントを削除する前の最大キューサイズ |
| `maxRetries` | number | `3` | 失敗したテレメトリーリクエストのリトライ回数 |
| `enableSessionSync` | boolean | `false` | チーム機能用にセッションをクラウドに同期 |
| `companySecret` | string | `""` | API認証用の会社シークレット |

---

## 外部エージェント

外部ディレクトリからカスタムエージェント定義を読み込みます。

```json
{
  "externalAgents": {
    "enabled": true,
    "paths": [
      "~/.autohand/agents",
      "/team/shared/agents"
    ]
  }
}
```

| フィールド | 型 | デフォルト | 説明 |
|------------|------|---------|------|
| `enabled` | boolean | `false` | 外部エージェント読み込みを有効化 |
| `paths` | string[] | `[]` | エージェントを読み込むディレクトリ |

---

## スキルシステム

スキルは、AIエージェントに特化した指示を提供する指示パッケージです。特定のタスク用にアクティベートできるオンデマンドの `AGENTS.md` ファイルのように機能します。

### スキル検出場所

スキルは複数の場所から検出され、後のソースが優先されます：

| 場所 | ソースID | 説明 |
|------|----------|------|
| `~/.codex/skills/**/SKILL.md` | `codex-user` | ユーザーレベルCodexスキル（再帰的） |
| `~/.claude/skills/*/SKILL.md` | `claude-user` | ユーザーレベルClaudeスキル（1階層） |
| `~/.autohand/skills/**/SKILL.md` | `autohand-user` | ユーザーレベルAutohandスキル（再帰的） |
| `<project>/.claude/skills/*/SKILL.md` | `claude-project` | プロジェクトレベルClaudeスキル（1階層） |
| `<project>/.autohand/skills/**/SKILL.md` | `autohand-project` | プロジェクトレベルAutohandスキル（再帰的） |

### 自動コピー動作

CodexまたはClaudeの場所で検出されたスキルは、対応するAutohandの場所に自動的にコピーされます：

- `~/.codex/skills/` と `~/.claude/skills/` → `~/.autohand/skills/`
- `<project>/.claude/skills/` → `<project>/.autohand/skills/`

Autohandの場所にある既存のスキルは上書きされません。

### SKILL.md形式

スキルはYAMLフロントマターの後にマークダウンコンテンツを使用します：

```markdown
---
name: my-skill-name
description: スキルの簡単な説明
license: MIT
compatibility: Node.js 18+で動作
allowed-tools: read_file write_file run_command
metadata:
  author: your-name
  version: "1.0.0"
---

# マイスキル

AIエージェントへの詳細な指示...
```

| フィールド | 必須 | 最大長 | 説明 |
|------------|------|--------|------|
| `name` | はい | 64文字 | 小文字英数字とハイフンのみ |
| `description` | はい | 1024文字 | スキルの簡単な説明 |
| `license` | いいえ | - | ライセンス識別子（例：MIT、Apache-2.0） |
| `compatibility` | いいえ | 500文字 | 互換性に関するメモ |
| `allowed-tools` | いいえ | - | スペース区切りの許可ツールリスト |
| `metadata` | いいえ | - | 追加のキーバリューメタデータ |

### スラッシュコマンド

| コマンド | 説明 |
|----------|------|
| `/skills` | 利用可能なすべてのスキルを一覧表示 |
| `/skills use <name>` | 現在のセッションでスキルをアクティベート |
| `/skills deactivate <name>` | スキルを非アクティベート |
| `/skills info <name>` | スキルの詳細情報を表示 |
| `/skills new` | 対話的に新しいスキルを作成 |

### 自動スキル生成

`--auto-skill` フラグはプロジェクトを分析し、関連するスキルを生成します：

```bash
autohand --auto-skill
```

これにより：
1. プロジェクト構造を分析（package.json、requirements.txtなど）
2. 言語、フレームワーク、パターンを検出
3. LLMを使用して3〜5個の関連スキルを生成
4. スキルを `<project>/.autohand/skills/` に保存

検出されるパターン：
- **言語**: TypeScript、JavaScript、Python、Rust、Go
- **フレームワーク**: React、Next.js、Vue、Express、Flask、Django
- **パターン**: CLIツール、テスト、モノレポ、Docker、CI/CD

---

## API設定

チーム機能用のバックエンドAPI設定。

```json
{
  "api": {
    "baseUrl": "https://api.autohand.ai",
    "companySecret": "sk-team-xxx"
  }
}
```

| フィールド | 型 | デフォルト | 説明 |
|------------|------|---------|------|
| `baseUrl` | string | `https://api.autohand.ai` | APIエンドポイント |
| `companySecret` | string | - | 共有機能用のチーム/会社シークレット |

環境変数でも設定可能：
- `AUTOHAND_API_URL` → `api.baseUrl`
- `AUTOHAND_SECRET` → `api.companySecret`

---

## 認証設定

認証とユーザーセッション設定。

```json
{
  "auth": {
    "token": "your-auth-token",
    "user": {
      "id": "user-id",
      "email": "user@example.com",
      "name": "ユーザー名",
      "avatar": "https://example.com/avatar.png"
    },
    "expiresAt": "2025-12-31T23:59:59Z"
  }
}
```

| フィールド | 型 | デフォルト | 説明 |
|------------|------|---------|------|
| `token` | string | - | APIアクセス用の認証トークン |
| `user` | object | - | 認証済みユーザー情報 |
| `user.id` | string | - | ユーザーID |
| `user.email` | string | - | ユーザーメールアドレス |
| `user.name` | string | - | ユーザー表示名 |
| `user.avatar` | string | - | ユーザーアバターURL（オプション） |
| `expiresAt` | string | - | トークン有効期限タイムスタンプ（ISO 8601形式） |

---

## コミュニティスキル設定

コミュニティスキルの検出と管理の設定。

```json
{
  "communitySkills": {
    "enabled": true,
    "showSuggestionsOnStartup": true,
    "autoBackup": true
  }
}
```

| フィールド | 型 | デフォルト | 説明 |
|------------|------|---------|------|
| `enabled` | boolean | `true` | コミュニティスキル機能を有効化 |
| `showSuggestionsOnStartup` | boolean | `true` | ベンダースキルが存在しない場合、起動時にスキル提案を表示 |
| `autoBackup` | boolean | `true` | 検出されたベンダースキルを自動的にAPIにバックアップ |

---

## 共有設定

`/share` コマンドによるセッション共有の設定。セッションは [autohand.link](https://autohand.link) でホストされます。

```json
{
  "share": {
    "enabled": true
  }
}
```

| フィールド | 型 | デフォルト | 説明 |
|------------|------|---------|------|
| `enabled` | boolean | `true` | `/share` コマンドの有効/無効 |

### YAML形式

```yaml
share:
  enabled: true
```

### セッション共有の無効化

セキュリティやプライバシー上の理由でセッション共有を無効にしたい場合：

```json
{
  "share": {
    "enabled": false
  }
}
```

無効の場合、`/share` を実行すると以下が表示されます：
```
セッション共有は無効です。
有効にするには、設定ファイルで share.enabled: true を設定してください。
```

---

## フック設定

エージェントイベント時にシェルコマンドを実行するライフサイクルフックの設定。詳細は[フックドキュメント](./hooks.md)を参照。

```json
{
  "hooks": {
    "enabled": true,
    "hooks": [
      {
        "event": "pre-tool",
        "command": "echo \"ツール実行: $HOOK_TOOL\" >> ~/.autohand/hooks.log",
        "description": "すべてのツール実行をログ",
        "enabled": true
      },
      {
        "event": "file-modified",
        "command": "./scripts/on-file-change.sh",
        "description": "カスタムファイル変更ハンドラー",
        "filter": { "path": ["src/**/*.ts"] }
      },
      {
        "event": "post-response",
        "command": "curl -X POST https://api.example.com/webhook -d '{\"tokens\": $HOOK_TOKENS}'",
        "description": "トークン使用量を追跡",
        "async": true
      }
    ]
  }
}
```

### `hooks`

| フィールド | 型 | デフォルト | 説明 |
|------------|------|---------|------|
| `enabled` | boolean | `true` | すべてのフックをグローバルに有効/無効化 |
| `hooks` | array | `[]` | フック定義の配列 |

### フック定義

| フィールド | 型 | 必須 | デフォルト | 説明 |
|------------|------|------|---------|------|
| `event` | string | はい | - | フックするイベント |
| `command` | string | はい | - | 実行するシェルコマンド |
| `description` | string | いいえ | - | `/hooks` 表示用の説明 |
| `enabled` | boolean | いいえ | `true` | フックがアクティブかどうか |
| `timeout` | number | いいえ | `5000` | タイムアウト（ミリ秒） |
| `async` | boolean | いいえ | `false` | ブロッキングなしで実行 |
| `filter` | object | いいえ | - | ツールまたはパスでフィルタ |

### フックイベント

| イベント | 発火タイミング |
|----------|--------------|
| `pre-tool` | ツール実行前 |
| `post-tool` | ツール完了後 |
| `file-modified` | ファイルの作成/変更/削除時 |
| `pre-prompt` | LLMに送信前 |
| `post-response` | LLM応答後 |
| `session-error` | エラー発生時 |

### 環境変数

フック実行時に以下の環境変数が利用可能：

| 変数 | 説明 |
|------|------|
| `HOOK_EVENT` | イベント名 |
| `HOOK_WORKSPACE` | ワークスペースルートパス |
| `HOOK_TOOL` | ツール名（ツールイベント） |
| `HOOK_ARGS` | JSONエンコードされたツール引数 |
| `HOOK_SUCCESS` | true/false（post-tool） |
| `HOOK_PATH` | ファイルパス（file-modified） |
| `HOOK_TOKENS` | 使用トークン数（post-response） |

---

## 完全な例

### JSON形式（`~/.autohand/config.json`）

```json
{
  "provider": "openrouter",
  "openrouter": {
    "apiKey": "sk-or-v1-your-key-here",
    "baseUrl": "https://openrouter.ai/api/v1",
    "model": "anthropic/claude-sonnet-4"
  },
  "ollama": {
    "baseUrl": "http://localhost:11434",
    "model": "llama3.2"
  },
  "workspace": {
    "defaultRoot": "~/projects",
    "allowDangerousOps": false
  },
  "ui": {
    "theme": "dark",
    "autoConfirm": false,
    "showCompletionNotification": true,
    "showThinking": true,
    "terminalBell": true,
    "checkForUpdates": true,
    "updateCheckInterval": 24
  },
  "agent": {
    "maxIterations": 100,
    "enableRequestQueue": true,
    "debug": false
  },
  "permissions": {
    "mode": "interactive",
    "whitelist": [
      "run_command:npm *",
      "run_command:bun *"
    ],
    "blacklist": [
      "run_command:rm -rf /"
    ],
    "rememberSession": true
  },
  "network": {
    "maxRetries": 3,
    "timeout": 30000,
    "retryDelay": 1000
  },
  "telemetry": {
    "enabled": false,
    "apiBaseUrl": "https://api.autohand.ai",
    "batchSize": 20,
    "flushIntervalMs": 60000,
    "maxQueueSize": 500,
    "maxRetries": 3,
    "enableSessionSync": false
  },
  "externalAgents": {
    "enabled": false,
    "paths": []
  },
  "api": {
    "baseUrl": "https://api.autohand.ai"
  },
  "auth": {
    "token": "your-auth-token",
    "user": {
      "id": "user-id",
      "email": "user@example.com",
      "name": "ユーザー名"
    }
  },
  "communitySkills": {
    "enabled": true,
    "showSuggestionsOnStartup": true,
    "autoBackup": true
  },
  "share": {
    "enabled": true
  }
}
```

### YAML形式（`~/.autohand/config.yaml`）

```yaml
provider: openrouter

openrouter:
  apiKey: sk-or-v1-your-key-here
  baseUrl: https://openrouter.ai/api/v1
  model: anthropic/claude-sonnet-4

ollama:
  baseUrl: http://localhost:11434
  model: llama3.2

workspace:
  defaultRoot: ~/projects
  allowDangerousOps: false

ui:
  theme: dark
  autoConfirm: false
  showCompletionNotification: true
  showThinking: true
  terminalBell: true
  checkForUpdates: true
  updateCheckInterval: 24

agent:
  maxIterations: 100
  enableRequestQueue: true
  debug: false

permissions:
  mode: interactive
  whitelist:
    - "run_command:npm *"
    - "run_command:bun *"
  blacklist:
    - "run_command:rm -rf /"
  rememberSession: true

network:
  maxRetries: 3
  timeout: 30000
  retryDelay: 1000

telemetry:
  enabled: false
  apiBaseUrl: https://api.autohand.ai
  batchSize: 20
  flushIntervalMs: 60000
  maxQueueSize: 500
  maxRetries: 3
  enableSessionSync: false

externalAgents:
  enabled: false
  paths: []

api:
  baseUrl: https://api.autohand.ai

auth:
  token: your-auth-token
  user:
    id: user-id
    email: user@example.com
    name: ユーザー名

communitySkills:
  enabled: true
  showSuggestionsOnStartup: true
  autoBackup: true

share:
  enabled: true
```

---

## ディレクトリ構造

Autohandは `~/.autohand/`（または `$AUTOHAND_HOME`）にデータを保存します：

```
~/.autohand/
├── config.json          # メイン設定
├── config.yaml          # 代替YAML設定
├── device-id            # 一意のデバイス識別子
├── error.log            # エラーログ
├── feedback.log         # フィードバック送信
├── sessions/            # セッション履歴
├── projects/            # プロジェクト知識ベース
├── memory/              # ユーザーレベルメモリ
├── commands/            # カスタムコマンド
├── agents/              # エージェント定義
├── tools/               # カスタムメタツール
├── feedback/            # フィードバック状態
└── telemetry/           # テレメトリーデータ
    ├── queue.json
    └── session-sync-queue.json
```

**プロジェクトレベルディレクトリ**（ワークスペースルート内）：

```
<project>/.autohand/
├── settings.local.json  # ローカルプロジェクト権限（gitignoreに追加）
├── memory/              # プロジェクト固有メモリ
└── skills/              # プロジェクト固有スキル
```

---

## CLIフラグ（設定をオーバーライド）

これらのフラグは設定ファイルの設定をオーバーライドします：

| フラグ | 説明 |
|--------|------|
| `--model <model>` | モデルをオーバーライド |
| `--path <path>` | ワークスペースルートをオーバーライド |
| `--worktree [name]` | セッションを分離されたgit worktreeで実行（worktree/ブランチ名は任意） |
| `--tmux` | 専用のtmuxセッションで起動（`--worktree`を含意。`--no-worktree`とは併用不可） |
| `--add-dir <path>` | ワークスペーススコープに追加ディレクトリを追加（複数回使用可能） |
| `--config <path>` | カスタム設定ファイルを使用 |
| `--temperature <n>` | 温度を設定（0-1） |
| `--yes` | プロンプトを自動確認 |
| `--dry-run` | 実行せずにプレビュー |
| `-d, --debug` | 詳細なデバッグ出力を有効化 |
| `--unrestricted` | 承認プロンプトなし |
| `--restricted` | 危険な操作を拒否 |
| `--permissions` | 現在の権限設定を表示して終了 |
| `--patch` | 変更を適用せずにgitパッチを生成 |
| `--output <file>` | パッチの出力ファイル（--patchと併用） |
| `--auto-skill` | プロジェクト分析に基づいてスキルを自動生成 |
| `-c, --auto-commit` | タスク完了後に変更を自動コミット |
| `--login` | Autohandアカウントにサインイン |
| `--logout` | Autohandアカウントからサインアウト |
| `--setup` | セットアップウィザードを実行してAutohandを設定または再設定 |
| `--sys-prompt <値>` | システムプロンプト全体を置換（インライン文字列またはファイルパス） |
| `--append-sys-prompt <値>` | システムプロンプトに追加（インライン文字列またはファイルパス） |

---

## システムプロンプトのカスタマイズ

AutohandはAIエージェントが使用するシステムプロンプトをカスタマイズできます。これは、専門的なワークフロー、カスタム指示、または他のシステムとの統合に役立ちます。

### CLIフラグ

| フラグ | 説明 |
|--------|------|
| `--sys-prompt <値>` | システムプロンプト全体を置換 |
| `--append-sys-prompt <値>` | デフォルトのシステムプロンプトにコンテンツを追加 |

両方のフラグは以下を受け入れます：
- **インライン文字列**：直接のテキストコンテンツ
- **ファイルパス**：プロンプトを含むファイルへのパス（自動検出）

### ファイルパス検出

次の場合、値はファイルパスとして扱われます：
- `./`、`../`、`/`、または `~/` で始まる
- Windowsドライブレター（例：`C:\`）で始まる
- `.txt`、`.md`、または `.prompt` で終わる
- スペースなしでパス区切り文字を含む

それ以外の場合はインライン文字列として扱われます。

### `--sys-prompt`（完全置換）

提供された場合、デフォルトのシステムプロンプトを**完全に置換**します。エージェントは以下をロードしません：
- Autohandのデフォルト指示
- AGENTS.mdプロジェクト指示
- ユーザー/プロジェクトメモリ
- アクティブなスキル

```bash
# インライン文字列
autohand --sys-prompt "あなたはPythonエキスパートです。簡潔に。" --prompt "hello worldを書いて"

# ファイルから
autohand --sys-prompt ./custom-prompt.txt --prompt "このコードを説明して"
```

### `--append-sys-prompt`（デフォルトに追加）

提供された場合、完全なデフォルトシステムプロンプトにコンテンツを**追加**します。エージェントはすべてのデフォルト指示を引き続きロードします。

```bash
# インライン文字列
autohand --append-sys-prompt "常にJavaScriptではなくTypeScriptを使用してください" --prompt "関数を作成"

# ファイルから
autohand --append-sys-prompt ./team-guidelines.md --prompt "エラーハンドリングを追加"
```

### 優先順位

両方のフラグが提供された場合：
1. `--sys-prompt` が完全に優先
2. `--append-sys-prompt` は無視される

---

## マルチディレクトリサポート

Autohandはメインワークスペース以外の複数のディレクトリで作業できます。プロジェクトに異なるディレクトリにある依存関係、共有ライブラリ、または関連プロジェクトがある場合に便利です。

### CLIフラグ

`--add-dir`を使用して追加ディレクトリを追加します（複数回使用可能）：

```bash
# 単一の追加ディレクトリを追加
autohand --add-dir /path/to/shared-lib

# 複数のディレクトリを追加
autohand --add-dir /path/to/lib1 --add-dir /path/to/lib2

# 制限なしモードと組み合わせ（すべてのディレクトリへの書き込みを自動承認）
autohand --add-dir /path/to/shared-lib --unrestricted
```

### 対話コマンド

対話セッション中に`/add-dir`を使用します：

```
/add-dir              # 現在のディレクトリを表示
/add-dir /path/to/dir # 新しいディレクトリを追加
```

### セキュリティ制限

以下のディレクトリは追加できません：
- ホームディレクトリ（`~`または`$HOME`）
- ルートディレクトリ（`/`）
- システムディレクトリ（`/etc`、`/var`、`/usr`、`/bin`、`/sbin`）
- Windowsシステムディレクトリ（`C:\Windows`、`C:\Program Files`）
- Windowsユーザーディレクトリ（`C:\Users\username`）
- WSL Windowsマウント（`/mnt/c`、`/mnt/c/Windows`）
