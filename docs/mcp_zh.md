# MCP (Model Context Protocol) 支持

Autohand 内置了一个 MCP 客户端，可以连接到外部 MCP 服务器，通过数据库、API、浏览器以及任何兼容 MCP 的服务来扩展你的代理功能。

## 目录

- [概述](#概述)
- [快速开始](#快速开始)
- [配置](#配置)
- [Slash 命令](#slash-命令)
- [社区 MCP 注册表](#社区-mcp-注册表)
- [工具命名](#工具命名)
- [非阻塞启动](#非阻塞启动)
- [故障排除](#故障排除)

---

## 概述

MCP 是一个用于将 AI 代理连接到外部工具的开放协议。Autohand 的 MCP 客户端支持：

- **stdio 传输** -- 生成子进程并通过 stdin/stdout 使用 JSON-RPC 2.0 进行通信
- **SSE 传输** -- 使用 Server-Sent Events 连接到 HTTP 服务器（计划中）
- **自动工具发现** -- 自动发现并注册已连接服务器的工具
- **命名空间工具** -- MCP 工具添加前缀以避免与内置工具冲突
- **非阻塞启动** -- 服务器在后台连接，不会延迟提示符的显示
- **交互式管理** -- 使用 `/mcp` 命令开启/关闭服务器

---

## 快速开始

### 从社区注册表安装

最快的入门方式是从社区注册表安装预配置的服务器：

```bash
# 在 Autohand REPL 中
/mcp install filesystem
```

这会将服务器添加到你的配置中并自动连接。你也可以浏览完整的注册表：

```bash
/mcp install
```

### 手动配置

将 MCP 服务器添加到 `~/.autohand/config.json`：

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

重启 Autohand，服务器将在后台自动连接。

---

## 配置

### 配置结构

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

### 服务器配置字段

| 字段 | 类型 | 是否必填 | 描述 |
|------|------|----------|------|
| `name` | string | 是 | 服务器的唯一标识符 |
| `transport` | `"stdio"` \| `"sse"` | 是 | 传输类型 |
| `command` | string | 是 (stdio) | 启动服务器进程的命令 |
| `args` | string[] | 否 | 命令的参数 |
| `url` | string | 是 (sse) | SSE 端点 URL |
| `env` | object | 否 | 传递给服务器的环境变量 |
| `autoConnect` | boolean | 否 | 启动时自动连接（默认：`true`） |

### 全局设置

| 字段 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `mcp.enabled` | boolean | `true` | 启用/禁用所有 MCP 支持 |
| `mcp.servers` | array | `[]` | 服务器配置列表 |

---

## Slash 命令

### `/mcp` -- 交互式服务器管理器

不带参数运行 `/mcp` 会打开一个**交互式切换列表**：

```
MCP Servers
────────────────────────────────────────────────────────
▸ ● filesystem          enabled (5 tools)
  ○ github              disabled
  ● postgres            error
    Connection refused

↑↓ navigate  ⏎/space toggle  q/esc close
```

- **方向键** 在服务器之间导航
- **空格键** 或 **回车键** 切换服务器的开/关状态（连接/断开）
- **q** 或 **ESC** 关闭列表
- 选中出错的服务器时会显示错误详情

### `/mcp` 子命令

| 命令 | 描述 |
|------|------|
| `/mcp` | 交互式服务器切换列表 |
| `/mcp connect <name>` | 连接到指定服务器 |
| `/mcp disconnect <name>` | 断开与服务器的连接 |
| `/mcp list` | 列出已连接服务器的所有工具 |
| `/mcp tools` | `/mcp list` 的别名 |
| `/mcp add <name> <cmd> [args]` | 将服务器添加到配置并连接 |
| `/mcp remove <name>` | 从配置中移除服务器 |

### 示例

```bash
# 手动添加服务器
/mcp add time npx -y @modelcontextprotocol/server-time

# 查看所有可用工具
/mcp list

# 断开服务器连接
/mcp disconnect time

# 永久移除服务器
/mcp remove time
```

---

### `/mcp install` -- 社区注册表浏览器

浏览并安装社区注册表中预配置的 MCP 服务器：

```bash
# 按类别浏览完整注册表
/mcp install

# 直接安装指定服务器
/mcp install filesystem
```

交互式浏览器显示：

- **类别**：开发工具、数据和数据库、Web 和 API、生产力工具、AI 和推理
- **精选服务器**及评分
- **搜索**，支持自动补全
- 安装前的**服务器详情**（描述、必需的环境变量、必需的参数）

#### 可用服务器

| 服务器 | 类别 | 描述 |
|--------|------|------|
| filesystem | 开发工具 | 读取、写入和管理文件与目录 |
| github | 开发工具 | GitHub 仓库、issues 和 PR |
| everything | 开发工具 | 用于测试的 MCP 参考服务器 |
| time | 开发工具 | 时间和时区工具 |
| postgres | 数据和数据库 | PostgreSQL 数据库查询 |
| sqlite | 数据和数据库 | SQLite 数据库操作 |
| brave-search | Web 和 API | Brave 网络搜索 |
| fetch | Web 和 API | 获取和解析网页 |
| puppeteer | Web 和 API | 使用 Puppeteer 进行浏览器自动化 |
| slack | 生产力工具 | Slack 消息 |
| memory | AI 和推理 | 基于知识图谱的持久化记忆 |
| sequential-thinking | AI 和推理 | 逐步推理 |

#### 环境变量

部分服务器需要环境变量。安装时，Autohand 会提示你输入必需的值：

```bash
/mcp install slack
# 提示输入：
#   SLACK_BOT_TOKEN: xoxb-your-token
#   SLACK_TEAM_ID: T0YOUR_TEAM_ID
```

#### 必需参数

像 `filesystem` 这样的服务器需要路径参数：

```bash
/mcp install filesystem
# 提示输入：允许访问的目录路径
```

---

## 工具命名

MCP 工具使用命名空间前缀进行注册，以避免冲突：

```
mcp__<server-name>__<tool-name>
```

例如，filesystem 服务器的 `read_file` 工具会变成 `mcp__filesystem__read_file`。

当 LLM 决定使用 MCP 工具时，Autohand 会自动将调用路由到正确的服务器。

---

## 非阻塞启动

MCP 服务器在启动期间**在后台异步连接**。这意味着：

1. 提示符立即出现 -- 无需等待服务器连接
2. 服务器并行连接，各自独立
3. 工具在服务器完成连接后变为可用
4. 如果某个服务器失败，其他服务器正常继续（可通过 `/mcp` 查看错误信息）
5. 当 LLM 调用 MCP 工具时，Autohand 会先等待连接完成

这种行为与 Claude Code 等类似工具处理 MCP 的方式一致 -- 用户永远不会因为服务器启动缓慢而被阻塞。

---

## 故障排除

### 服务器无法连接

```bash
# 检查状态
/mcp

# 尝试重新连接
/mcp disconnect <name>
/mcp connect <name>
```

### 常见错误

| 错误 | 原因 | 解决方法 |
|------|------|----------|
| `Command not found` | 包未安装 | 先手动运行 `npx` 命令 |
| `Connection refused` | 服务器未运行 (SSE) | 验证 URL 和服务器状态 |
| `Request timed out` | 服务器无响应 | 检查服务器日志，重启 |
| `SSE transport not yet implemented` | SSE 尚未支持 | 使用 stdio 传输 |

### 服务器日志

MCP 服务器的 stderr 输出在内部被捕获。如果服务器行为异常，请检查底层命令是否能在 Autohand 外部正常工作：

```bash
npx -y @modelcontextprotocol/server-filesystem /tmp
```

### 禁用 MCP

在配置中将 `mcp.enabled` 设置为 `false` 以禁用所有 MCP 支持：

```json
{
  "mcp": {
    "enabled": false
  }
}
```

或者设置单个服务器不自动连接：

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
