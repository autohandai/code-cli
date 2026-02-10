# MCP (Model Context Protocol) サポート

Autohand には、外部の MCP サーバーに接続するビルトイン MCP クライアントが含まれており、データベース、API、ブラウザ、その他の MCP 互換サービスからのツールでエージェントを拡張できます。

## 目次

- [概要](#概要)
- [クイックスタート](#クイックスタート)
- [設定](#設定)
- [スラッシュコマンド](#スラッシュコマンド)
- [コミュニティ MCP レジストリ](#コミュニティ-mcp-レジストリ)
- [ツールの命名規則](#ツールの命名規則)
- [ノンブロッキング起動](#ノンブロッキング起動)
- [トラブルシューティング](#トラブルシューティング)

---

## 概要

MCP は、AI エージェントを外部ツールに接続するためのオープンプロトコルです。Autohand の MCP クライアントは以下をサポートしています：

- **stdio トランスポート** -- 子プロセスを起動し、stdin/stdout 上で JSON-RPC 2.0 を介して通信します
- **SSE トランスポート** -- Server-Sent Events を使用して HTTP サーバーに接続します（計画中）
- **自動ツール検出** -- 接続されたサーバーからツールを検出し登録します
- **名前空間付きツール** -- MCP ツールには、ビルトインツールとの衝突を避けるためにプレフィックスが付きます
- **ノンブロッキング起動** -- サーバーはプロンプトを遅らせることなくバックグラウンドで接続します
- **インタラクティブ管理** -- `/mcp` コマンドでサーバーのオン/オフを切り替えられます

---

## クイックスタート

### コミュニティレジストリからのインストール

最も簡単に始める方法は、コミュニティレジストリから事前設定済みのサーバーをインストールすることです：

```bash
# Autohand REPL 内で
/mcp install filesystem
```

これにより、サーバーが設定に追加され、自動的に接続されます。レジストリ全体を閲覧することもできます：

```bash
/mcp install
```

### 手動設定

`~/.autohand/config.json` に MCP サーバーを追加します：

```json
{
  "mcp": {
    "servers": [
      {
        "name": "filesystem",
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/me/projects"]
      }
    ]
  }
}
```

Autohand を再起動すると、サーバーはバックグラウンドで自動的に接続されます。

---

## 設定

### 設定構造

```json
{
  "mcp": {
    "enabled": true,
    "servers": [
      {
        "name": "filesystem",
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
        "env": {},
        "autoConnect": true
      }
    ]
  }
}
```

### サーバー設定フィールド

| フィールド | 型 | 必須 | 説明 |
|-------|------|----------|-------------|
| `name` | string | はい | サーバーの一意の識別子 |
| `transport` | `"stdio"` \| `"sse"` | はい | トランスポートの種類 |
| `command` | string | はい (stdio) | サーバープロセスを起動するコマンド |
| `args` | string[] | いいえ | コマンドの引数 |
| `url` | string | はい (sse) | SSE エンドポイント URL |
| `env` | object | いいえ | サーバーに渡される環境変数 |
| `autoConnect` | boolean | いいえ | 起動時に自動接続する（デフォルト: `true`） |

### グローバル設定

| フィールド | 型 | デフォルト | 説明 |
|-------|------|---------|-------------|
| `mcp.enabled` | boolean | `true` | 全 MCP サポートの有効化/無効化 |
| `mcp.servers` | array | `[]` | サーバー設定のリスト |

---

## スラッシュコマンド

### `/mcp` -- インタラクティブサーバーマネージャー

引数なしで `/mcp` を実行すると、**インタラクティブなトグルリスト**が開きます：

```
MCP Servers
────────────────────────────────────────────────────────
▸ ● filesystem          enabled (5 tools)
  ○ github              disabled
  ● postgres            error
    Connection refused

↑↓ navigate  ⏎/space toggle  q/esc close
```

- **矢印キー** でサーバー間を移動
- **スペース** または **Enter** でサーバーのオン/オフを切り替え（接続/切断）
- **q** または **ESC** でリストを閉じる
- エラーが発生したサーバーを選択すると、エラーの詳細が表示されます

### `/mcp` サブコマンド

| コマンド | 説明 |
|---------|-------------|
| `/mcp` | インタラクティブなサーバートグルリスト |
| `/mcp connect <name>` | 特定のサーバーに接続 |
| `/mcp disconnect <name>` | サーバーから切断 |
| `/mcp list` | 接続されたサーバーの全ツールを一覧表示 |
| `/mcp tools` | `/mcp list` のエイリアス |
| `/mcp add <name> <cmd> [args]` | サーバーを設定に追加して接続 |
| `/mcp remove <name>` | 設定からサーバーを削除 |

### 例

```bash
# サーバーを手動で追加
/mcp add time npx -y @modelcontextprotocol/server-time

# 利用可能な全ツールを表示
/mcp list

# サーバーを切断
/mcp disconnect time

# サーバーを永久に削除
/mcp remove time
```

---

### `/mcp install` -- コミュニティレジストリブラウザ

コミュニティレジストリから事前設定済みの MCP サーバーを閲覧してインストールします：

```bash
# カテゴリ付きでレジストリ全体を閲覧
/mcp install

# 特定のサーバーを直接インストール
/mcp install filesystem
```

インタラクティブブラウザには以下が表示されます：

- **カテゴリ**: 開発ツール、データ＆データベース、Web＆API、生産性向上、AI＆推論
- **おすすめサーバー** と評価
- **検索** とオートコンプリート
- インストール前の**サーバー詳細**（説明、必要な環境変数、必要な引数）

#### 利用可能なサーバー

| サーバー | カテゴリ | 説明 |
|--------|----------|-------------|
| filesystem | 開発ツール | ファイルとディレクトリの読み取り、書き込み、管理 |
| github | 開発ツール | GitHub リポジトリ、Issue、プルリクエスト |
| everything | 開発ツール | テスト用リファレンス MCP サーバー |
| time | 開発ツール | 時刻とタイムゾーンのツール |
| postgres | データ＆データベース | PostgreSQL データベースクエリ |
| sqlite | データ＆データベース | SQLite データベース操作 |
| brave-search | Web＆API | Brave ウェブ検索 |
| fetch | Web＆API | ウェブページの取得と解析 |
| puppeteer | Web＆API | Puppeteer によるブラウザ自動化 |
| slack | 生産性向上 | Slack メッセージング |
| memory | AI＆推論 | 永続的なナレッジグラフメモリ |
| sequential-thinking | AI＆推論 | ステップバイステップの推論 |

#### 環境変数

一部のサーバーには環境変数が必要です。インストール時に、Autohand は必要な値の入力を求めます：

```bash
/mcp install slack
# 以下の入力を求められます:
#   SLACK_BOT_TOKEN: xoxb-your-token
#   SLACK_TEAM_ID: T0YOUR_TEAM_ID
```

#### 必須引数

`filesystem` のようなサーバーにはパス引数が必要です：

```bash
/mcp install filesystem
# 入力を求められます: 許可するディレクトリパス
```

---

## ツールの命名規則

MCP ツールは、衝突を避けるために名前空間プレフィックス付きで登録されます：

```
mcp__<server-name>__<tool-name>
```

例えば、filesystem サーバーの `read_file` ツールは `mcp__filesystem__read_file` になります。

LLM が MCP ツールの使用を決定すると、Autohand は自動的に適切なサーバーに呼び出しをルーティングします。

---

## ノンブロッキング起動

MCP サーバーは起動時に**バックグラウンドで非同期的に接続**されます。これにより：

1. プロンプトは即座に表示されます -- サーバーの接続を待つ必要はありません
2. サーバーは並列に、それぞれ独立して接続されます
3. サーバーの接続が完了すると、ツールが利用可能になります
4. サーバーが失敗しても、他のサーバーは正常に動作し続けます（エラーは `/mcp` で表示されます）
5. LLM が MCP ツールを呼び出す場合、Autohand は最初に接続の完了を待ちます

この動作は、Claude Code や同様のツールが MCP を処理する方法と一致しています -- サーバーの起動が遅くてもユーザーがブロックされることはありません。

---

## トラブルシューティング

### サーバーが接続できない

```bash
# ステータスを確認
/mcp

# 再接続を試みる
/mcp disconnect <name>
/mcp connect <name>
```

### よくあるエラー

| エラー | 原因 | 修正方法 |
|-------|-------|-----|
| `Command not found` | パッケージがインストールされていない | まず `npx` コマンドを手動で実行してください |
| `Connection refused` | サーバーが稼働していない (SSE) | URL とサーバーのステータスを確認してください |
| `Request timed out` | サーバーが応答しない | サーバーログを確認し、再起動してください |
| `SSE transport not yet implemented` | SSE はまだサポートされていない | stdio トランスポートを使用してください |

### サーバーログ

MCP サーバーの stderr 出力は内部的にキャプチャされます。サーバーの動作がおかしい場合は、Autohand の外でそのコマンドが正常に動作するか確認してください：

```bash
npx -y @modelcontextprotocol/server-filesystem /tmp
```

### MCP の無効化

設定で `mcp.enabled` を `false` に設定すると、すべての MCP サポートが無効になります：

```json
{
  "mcp": {
    "enabled": false
  }
}
```

または、個々のサーバーを自動接続しないように設定します：

```json
{
  "mcp": {
    "servers": [
      {
        "name": "filesystem",
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem"],
        "autoConnect": false
      }
    ]
  }
}
```
