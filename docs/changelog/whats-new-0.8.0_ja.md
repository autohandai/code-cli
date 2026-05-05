# Autohand 0.8.0 の新機能

Autohand 0.8.0 は、Unix ワークフローのためのパイプモード、拡張思考制御、粒度の細かい自動承認（yolo モード）、MCP クライアントサポート、IDE 統合、プランモードなど、多数の機能を搭載したメジャーリリースです。このドキュメントでは、このリリースに含まれるすべての新機能と改善点を説明します。

## 目次

- [パイプモード](#パイプモード)
- [拡張思考](#拡張思考)
- [セッション履歴](#セッション履歴)
- [粒度の細かい自動承認（Yolo モード）](#粒度の細かい自動承認yolo-モード)
- [MCP クライアントサポート](#mcp-クライアントサポート)
- [IDE 統合](#ide-統合)
- [Homebrew インストール](#homebrew-インストール)
- [プランモード](#プランモード)
- [Web Repo ツール](#web-repo-ツール)
- [自動コンテキスト圧縮](#自動コンテキスト圧縮)
- [カスタムシステムプロンプト](#カスタムシステムプロンプト)
- [新しい CLI フラグ](#新しい-cli-フラグ)
- [新しいスラッシュコマンド](#新しいスラッシュコマンド)
- [アーキテクチャの改善](#アーキテクチャの改善)
- [アップグレード方法](#アップグレード方法)

---

## パイプモード

Autohand は Unix パイプラインの一部としてシームレスに動作するようになりました。stdin が TTY でない場合、Autohand は**パイプモード**に入ります。これは組み合わせ可能なワークフローのために設計された非インタラクティブな実行パスです。

### 仕組み

パイプモードは、パイプされたコンテンツをあなたの指示と一緒に LLM に送信します。最終結果は stdout に書き込まれ、エラーと進捗は stderr に送られます。これにより、下流のコンシューマーのために出力ストリームがクリーンに保たれます。

```bash
# diff を説明する
git diff | autohand 'explain these changes'

# ファイルからコードをレビューする
cat src/auth.ts | autohand 'review this code for security issues'

# 複数のツールを連鎖させる
git log --oneline -10 | autohand 'summarize recent changes' > changelog.txt
```

### 出力ルーティング

| ストリーム | 内容 |
|------------|------|
| **stdout** | 最終結果のみ（下流パイプで消費） |
| **stderr** | エラーとオプションの進捗メッセージ |

### JSON 出力

プログラマティックな消費に最適な構造化 ndjson 出力には `--json` を使用します：

```bash
git diff | autohand 'review' --json
```

各行は有効な JSON オブジェクトです：

```json
{"type": "result", "content": "diff は...を示しています"}
{"type": "error", "message": "レート制限超過"}
```

### 詳細な進捗

`--verbose` を使用して、stdout をクリーンに保ちながら進捗メッセージを stderr に送信します：

```bash
git diff | autohand 'review' --verbose 2>progress.log
```

### 組み合わせの例

```bash
# パイプチェーン：テストを生成し、その後 lint
autohand --prompt 'generate tests for auth.ts' | eslint --stdin

# xargs と組み合わせて使用
find src -name '*.ts' | xargs -I{} sh -c 'cat {} | autohand "review" > {}.review'

# CI 統合
git diff HEAD~1 | autohand 'check for breaking changes' --json | jq '.content'
```

---

## 拡張思考

`--thinking` フラグで、LLM が応答する前の推論の深さを制御します。速度と徹底性のバランスを調整するのに役立ちます。

### 使い方

```bash
# 複雑なタスクのための拡張推論
autohand --thinking extended

# 標準推論（デフォルト）
autohand --thinking normal

# 可視的な推論なしの直接応答
autohand --thinking none

# ショートカット：値なしの --thinking は extended にデフォルト
autohand --thinking
```

### 思考レベル

| レベル | 説明 | 最適な用途 |
|--------|------|------------|
| `extended` | 詳細な思考プロセスを伴う深い推論 | 複雑なリファクタリング、アーキテクチャの決定、デバッグ |
| `normal` | 標準的な推論の深さ（デフォルト） | 一般的なコーディングタスク |
| `none` | 可視的な推論なしの直接応答 | 簡単な質問、素早い編集 |

### 環境変数

環境変数で思考レベルを設定することもできます。IDE 統合に便利です：

```bash
AUTOHAND_THINKING_LEVEL=extended autohand --prompt "refactor this module"
```

---

## セッション履歴

新しい `/history` スラッシュコマンドは、セッション履歴のページネーション付きブラウジングを提供し、過去の作業を簡単に見つけて再開できます。

### 使い方

```
/history          # セッション履歴の最初のページを表示
/history 2        # 2 ページ目を表示
/history 3        # 3 ページ目を表示
```

### 表示フォーマット

各エントリに表示される情報：

| 列 | 説明 |
|----|------|
| **ID** | セッション識別子（20 文字に切り詰め） |
| **日付** | 作成日時 |
| **プロジェクト** | プロジェクト名 |
| **モデル** | 使用した LLM モデル（短縮表示） |
| **メッセージ** | メッセージ総数 |
| **ステータス** | アクティブセッションバッジ（緑色 `[active]`） |

### セッションの再開

`/history` と `/resume` を組み合わせてスムーズなワークフローを実現：

```
/history            # 目的のセッションを見つける
/resume abc123...   # 再開する
```

---

## 粒度の細かい自動承認（Yolo モード）

Yolo モードは、ツール呼び出しのパターンベースの自動承認を提供し、エージェントがプロンプトなしで何をできるかを細かく制御できます。`--timeout` と組み合わせて、時間制限付きの自律セッションを実現します。

### 使い方

```bash
# すべてを自動承認
autohand --yolo true

# 読み取りと書き込み操作のみ自動承認
autohand --yolo 'allow:read_file,write_file,search'

# 削除とコマンド実行以外のすべてを自動承認
autohand --yolo 'deny:delete_path,run_command'

# すべての操作を許可するが、10 分間のみ
autohand --yolo true --timeout 600
```

### パターン構文

| パターン | 効果 |
|----------|------|
| `true` | `allow:*` のショートカット -- すべてを承認 |
| `allow:*` | すべてのツールを自動承認 |
| `allow:read_file,write_file` | リストされたツールのみ自動承認 |
| `deny:delete_path,run_command` | リストされたツールを拒否し、残りを自動承認 |

### 仕組み

1. Autohand は `--yolo` パターンを `YoloPattern`（モード + ツールリスト）に解析します。
2. ツール呼び出しが承認を必要とする場合、Autohand はツール名がパターンに一致するかチェックします。
3. 一致する場合（allow モード）または一致しない場合（deny モード）、ツールはプロンプトなしで実行されます。
4. パターンがツールを自動承認しない場合、通常の権限プロンプトが表示されます。

### タイマー

`--timeout` フラグは残り時間を追跡する `YoloTimer` を作成します：

```bash
# 5 分間自動承認し、その後通常のプロンプトに戻る
autohand --yolo true --timeout 300
```

- タイマーがアクティブな間、一致するツールは自動承認されます。
- タイマーが期限切れになると、すべてのツール呼び出しが通常の権限プロンプトに戻ります。

### セキュリティ

- Yolo モードは既存の権限システムと統合されています。
- ブラックリストの操作（`permissions.blacklist`）は yolo モードでもブロックされます。
- `deny` パターンにより、危険な操作を明示的に除外できます。

---

## MCP クライアントサポート

Autohand には、外部 MCP サーバーに接続できる内蔵 MCP（Model Context Protocol）クライアントが含まれるようになりました。これにより、データベース、API、または MCP 互換サービスのカスタムツールで Autohand を拡張できます。

### 概要

MCP は AI エージェントを外部ツールに接続するための業界標準プロトコルです。Autohand の MCP クライアントは以下をサポートします：

- **stdio トランスポート** -- 子プロセスを起動し、stdin/stdout 上の JSON-RPC 2.0 で通信
- **SSE トランスポート** -- Server-Sent Events を使用して HTTP サーバーに接続
- **自動ツール発見** -- `tools/list` を照会し、ツールを動的に登録
- **名前空間付きツール** -- 衝突を避けるためツールには `mcp__<サーバー>__<ツール>` のプレフィックスが付与
- **サーバーライフサイクル管理** -- サーバーの起動、停止、再接続

### 設定

`~/.autohand/config.json` に MCP サーバーを追加します：

```json
{
  "mcp": {
    "servers": [
      {
        "name": "database",
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-postgres"],
        "env": {
          "DATABASE_URL": "postgresql://localhost/mydb"
        },
        "autoConnect": true
      },
      {
        "name": "custom-api",
        "transport": "sse",
        "url": "http://localhost:3001/mcp",
        "autoConnect": true
      }
    ]
  }
}
```

### サーバー設定フィールド

| フィールド | 型 | 必須 | デフォルト | 説明 |
|------------|-----|------|------------|------|
| `name` | string | はい | - | サーバーの一意な名前 |
| `transport` | `"stdio"` または `"sse"` | はい | - | 接続タイプ |
| `command` | string | stdio のみ | - | サーバーを起動するコマンド |
| `args` | string[] | いいえ | `[]` | コマンド引数 |
| `url` | string | sse のみ | - | SSE エンドポイント URL |
| `env` | object | いいえ | `{}` | サーバープロセスの環境変数 |
| `autoConnect` | boolean | いいえ | `true` | 起動時に自動接続 |

### ツール命名

MCP ツールは組み込みツールとの衝突を防ぐために名前空間を使用します：

```
mcp__<サーバー名>__<ツール名>
```

例えば、`database` というサーバーの `query` というツールは `mcp__database__query` になります。

---

## IDE 統合

`/ide` コマンドは、システムで実行中の IDE を検出し、統合機能を有効にします。Autohand は現在のワークスペースを編集している IDE を検出し、関連する拡張機能を提案できます。

### サポートされる IDE

| IDE | プラットフォーム | 拡張機能の有無 |
|-----|-------------------|----------------|
| Visual Studio Code | macOS, Linux, Windows | あり |
| Visual Studio Code Insiders | macOS, Linux, Windows | あり |
| Cursor | macOS, Linux, Windows | なし |
| Zed | macOS, Linux, Windows | あり |
| Antigravity | macOS | なし |

### 使い方

```
/ide
```

コマンドは以下の手順を実行します：

1. 実行中のプロセスをスキャンして既知の IDE パターンを探す
2. IDE ストレージを読み取り、各インスタンスが開いているワークスペースを特定
3. 検出された IDE を現在の作業ディレクトリと照合
4. 一致する IDE の選択モーダルを表示
5. より深い統合のための拡張機能インストールを提案

---

## Homebrew インストール

Autohand は macOS の Homebrew で利用可能になりました：

```bash
# 直接インストール
brew install autohand

# または公式 tap 経由
brew tap autohandai/tap && brew install autohand
```

### 詳細

- Node.js は依存関係として宣言され、必要に応じて自動インストールされます
- フォーミュラは npm レジストリからインストールされます
- インストール後、`autohand --version` でバージョンが検証されます
- `brew upgrade autohand` でアップデートが利用可能です

---

## プランモード

プランモードでは、エージェントが行動する前に計画を立てることができます。有効にすると、エージェントは読み取り専用ツールのみを使用して情報を収集し、計画を策定します。計画を承認すると、実行が開始されます。

### アクティベーション

**Shift+Tab** を押してプランモードのオン/オフを切り替えます。ステータスインジケーターが現在の状態を表示します：

| インジケーター | 意味 |
|----------------|------|
| `[PLAN]` | 計画フェーズ -- エージェントが情報を収集し計画を策定中 |
| `[EXEC]` | 実行フェーズ -- エージェントが承認された計画を実行中 |
| *（なし）* | プランモードオフ -- 通常動作 |

### 仕組み

1. **有効化** -- Shift+Tab を押す。プロンプトに `[PLAN]` が表示されます。
2. **計画フェーズ** -- エージェントは読み取り専用ツールのみ使用可能（ファイル読み取り、検索、git status、Web 検索など）。書き込み操作はブロックされます。
3. **計画の提示** -- エージェントがステップ付きの構造化された計画を提示します。
4. **承認オプション** -- 進め方を選択：
   - **コンテキストをクリアし編集を自動承認** -- 最善の計画遵守性、会話履歴をクリア
   - **手動承認** -- 各編集を個別にレビューして承認
   - **自動承認** -- レビューなしですべての編集を自動承認
5. **実行** -- インジケーターが `[EXEC]` に変わり、エージェントが計画を実行します。

---

## Web Repo ツール

新しい `web_repo` ツールは、`@owner/repo` 形式を使用して GitHub および GitLab からリポジトリ情報を取得します。これにより、エージェントはターミナルを離れることなく外部リポジトリのコンテキストを取得できます。

### 使い方

プロンプトで `@owner/repo` 構文を使用してリポジトリをメンションします：

```
@vercel/next.js について教えてください
```

エージェントは `web_repo` ツールを直接呼び出して、リポジトリのメタデータ、README の内容、構造情報を取得することもできます。

---

## 自動コンテキスト圧縮

Autohand は、セッションが長くなると会話コンテキストを自動的に圧縮するようになりました。これにより、コンテキストウィンドウの枯渇を防ぎ、長時間のセッション中もエージェントの応答性を維持します。

### 仕組み

- デフォルトで有効（`--cc` フラグ）
- モデルのコンテキストウィンドウに対する会話の長さを監視
- 会話が制限に近づくと、古いメッセージが要約・圧縮される
- インタラクティブモードとプランモードの両方で動作
- 重要な情報（ファイル内容、最近のツール結果）は保持される

### 設定

```bash
# コンテキスト圧縮を有効にする（デフォルト）
autohand --cc

# コンテキスト圧縮を無効にする
autohand --no-cc
```

---

## カスタムシステムプロンプト

専門的なワークフローのために、デフォルトのシステムプロンプトを上書きまたは拡張します。

### プロンプト全体の置換

```bash
# インライン文字列
autohand --sys-prompt "You are a Python expert. Be concise."

# ファイルから
autohand --sys-prompt ./custom-prompt.md
```

`--sys-prompt` を使用すると、デフォルトの Autohand 指示、AGENTS.md、メモリ、スキルがすべて置換されます。

### デフォルトプロンプトへの追加

```bash
# インライン文字列
autohand --append-sys-prompt "Always use TypeScript instead of JavaScript"

# ファイルから
autohand --append-sys-prompt ./team-guidelines.md
```

`--append-sys-prompt` を使用すると、コンテンツが完全なデフォルトプロンプトの末尾に追加されます。すべてのデフォルト動作が保持されます。

---

## 新しい CLI フラグ

| フラグ | 説明 |
|--------|------|
| `--thinking [level]` | 推論の深さを設定：`none`、`normal`、`extended` |
| `--yolo [pattern]` | パターンに一致するツール呼び出しを自動承認 |
| `--timeout <seconds>` | yolo モード自動承認の時間制限 |
| `--cc` / `--no-cc` | 自動コンテキスト圧縮の有効化/無効化 |
| `--search-engine <provider>` | Web 検索プロバイダーの設定（`brave`、`duckduckgo`、`parallel`） |
| `--sys-prompt <value>` | システムプロンプト全体の置換（インラインまたはファイルパス） |
| `--append-sys-prompt <value>` | デフォルトシステムプロンプトへの追加 |
| `--display-language <locale>` | 表示言語の設定（例：`en`、`zh-cn`、`fr`、`de`、`ja`） |
| `--add-dir <path>` | ワークスペーススコープへの追加ディレクトリの追加 |
| `--skill-install [name]` | コミュニティスキルのインストール |
| `--project` | プロジェクトレベルへのスキルインストール（`--skill-install` と併用） |

---

## 新しいスラッシュコマンド

| コマンド | 説明 |
|----------|------|
| `/history` | ページネーション付きでセッション履歴をブラウズ |
| `/history <ページ>` | 特定ページのセッション履歴を表示 |
| `/ide` | 実行中の IDE を検出し統合のために接続 |
| `/about` | Autohand の情報を表示（バージョン、リンク） |
| `/feedback` | CLI に関するフィードバックを送信 |
| `/plan` | プランモードと対話 |
| `/add-dir` | ワークスペーススコープに追加ディレクトリを追加 |
| `/language` | 表示言語を変更 |
| `/formatters` | 利用可能なコードフォーマッターを一覧表示 |
| `/lint` | 利用可能なコードリンターを一覧表示 |
| `/completion` | シェル補完スクリプトを生成（bash、zsh、fish） |
| `/export` | セッションを markdown、JSON、HTML にエクスポート |
| `/permissions` | 権限設定の表示と管理 |
| `/hooks` | ライフサイクルフックをインタラクティブに管理 |
| `/share` | autohand.link でセッションを共有 |
| `/skills` | スキルの一覧表示、有効化、無効化、作成 |

---

## アーキテクチャの改善

### Modal コンポーネント

`enquirer` 依存関係は Ink で構築されたカスタム `Modal` コンポーネントに置き換えられました。これにより、一貫したスタイリング、キーボードナビゲーション、TUI の残りの部分とのより良い統合が提供されます。

### 抽出されたモジュール

関心の分離を改善するために、いくつかの内部モジュールが抽出されました：

- **WorkspaceFileCollector** -- 30 秒のキャッシュ付きでワークスペースファイルの発見を処理
- **AgentFormatter** -- ターミナル表示用にエージェント出力をフォーマット
- **ProviderConfigManager** -- プロバイダー固有の設定ロジックを管理

### Ink UI レンダリング

実験的な Ink ベースのレンダラー（`ui.useInkRenderer`）が以下の点で最適化されました：

- React の差分検出によるちらつきのない出力
- 動作中のリクエストキュー（エージェントが作業中に入力可能）
- readline の競合なしのより良い入力処理

### 動的ヘルプ

`/help` コマンドは登録されたスラッシュコマンドから動的に出力を生成するようになり、常に現在利用可能なコマンドセットを反映します。

---

## アップグレード方法

### npm から

```bash
npm update -g autohand-cli
```

### Homebrew から

```bash
brew upgrade autohand
```

### 設定の互換性

既存の `~/.autohand/config.json` は完全に後方互換性があります。マイグレーションは不要です。

新しい設定セクション（`mcp.servers` など）はオプションであり、対応する機能を使用したい場合のみ必要です。Autohand はすべての新しい設定に合理的なデフォルト値を使用します。

---

## 関連ドキュメント

- [設定リファレンス](./config-reference_ja.md) -- すべての設定オプション
- [フックシステム](./hooks.md) -- ライフサイクルフック
- [プロバイダーガイド](./providers.md) -- LLM プロバイダーのセットアップ
- [自動モード](./automode.md) -- 自律開発ループ
- [RPC プロトコル](./rpc-protocol.md) -- プログラマティック制御
