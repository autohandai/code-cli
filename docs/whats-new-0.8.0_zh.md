# Autohand 0.8.0 新功能

Autohand 0.8.0 是一个重大版本更新，带来了用于可组合 Unix 工作流的管道模式、扩展思考控制、粒度化自动批准（yolo 模式）、MCP 客户端支持、IDE 集成、计划模式等诸多功能。本文档涵盖了此版本中的每一项新功能和改进。

## 目录

- [管道模式](#管道模式)
- [扩展思考](#扩展思考)
- [会话历史](#会话历史)
- [粒度化自动批准（Yolo 模式）](#粒度化自动批准yolo-模式)
- [MCP 客户端支持](#mcp-客户端支持)
- [IDE 集成](#ide-集成)
- [Homebrew 安装](#homebrew-安装)
- [计划模式](#计划模式)
- [Web Repo 工具](#web-repo-工具)
- [自动上下文压缩](#自动上下文压缩)
- [自定义系统提示词](#自定义系统提示词)
- [新增 CLI 标志](#新增-cli-标志)
- [新增斜杠命令](#新增斜杠命令)
- [架构改进](#架构改进)
- [升级方式](#升级方式)

---

## 管道模式

Autohand 现在可以作为 Unix 管道的一部分无缝工作。当 stdin 不是 TTY 时，Autohand 进入**管道模式** -- 一种为可组合工作流设计的非交互式执行路径。

### 工作原理

管道模式将管道内容与您的指令一起发送给 LLM。最终结果写入 stdout，而错误和进度信息发送到 stderr。这使输出流保持干净，便于下游消费者使用。

```bash
# 解释一个 diff
git diff | autohand 'explain these changes'

# 审查文件中的代码
cat src/auth.ts | autohand 'review this code for security issues'

# 链式使用多个工具
git log --oneline -10 | autohand 'summarize recent changes' > changelog.txt
```

### 输出路由

| 流 | 内容 |
|----|------|
| **stdout** | 仅最终结果（供下游管道消费） |
| **stderr** | 错误和可选的进度消息 |

### JSON 输出

使用 `--json` 获取结构化的 ndjson 输出，适合程序化消费：

```bash
git diff | autohand 'review' --json
```

每行是一个有效的 JSON 对象：

```json
{"type": "result", "content": "该 diff 显示..."}
{"type": "error", "message": "超出速率限制"}
```

### 详细进度

使用 `--verbose` 将进度消息发送到 stderr，同时保持 stdout 干净：

```bash
git diff | autohand 'review' --verbose 2>progress.log
```

### 可组合示例

```bash
# 管道链：生成测试，然后 lint
autohand --prompt 'generate tests for auth.ts' | eslint --stdin

# 与 xargs 配合使用
find src -name '*.ts' | xargs -I{} sh -c 'cat {} | autohand "review" > {}.review'

# CI 集成
git diff HEAD~1 | autohand 'check for breaking changes' --json | jq '.content'
```

---

## 扩展思考

使用 `--thinking` 标志控制 LLM 在回答前的推理深度。这对于调节速度与全面性之间的平衡非常有用。

### 用法

```bash
# 复杂任务的扩展推理
autohand --thinking extended

# 标准推理（默认）
autohand --thinking normal

# 无可见推理的直接回答
autohand --thinking none

# 快捷方式：--thinking 不带值默认为 extended
autohand --thinking
```

### 思考级别

| 级别 | 描述 | 适用场景 |
|------|------|----------|
| `extended` | 深度推理，展示详细的思维过程 | 复杂重构、架构决策、调试 |
| `normal` | 标准推理深度（默认） | 一般编程任务 |
| `none` | 无可见推理的直接回答 | 简单问题、快速编辑 |

### 环境变量

您还可以通过环境变量设置思考级别，这对 IDE 集成很有用：

```bash
AUTOHAND_THINKING_LEVEL=extended autohand --prompt "refactor this module"
```

---

## 会话历史

新的 `/history` 斜杠命令提供分页浏览会话历史的功能，方便查找和恢复以前的工作。

### 用法

```
/history          # 显示会话历史的第一页
/history 2        # 显示第 2 页
/history 3        # 显示第 3 页
```

### 显示格式

每个条目显示：

| 列 | 描述 |
|----|------|
| **ID** | 会话标识符（截断为 20 个字符） |
| **日期** | 创建日期和时间 |
| **项目** | 项目名称 |
| **模型** | 使用的 LLM 模型（缩写） |
| **消息** | 消息总数 |
| **状态** | 活跃会话标记（绿色 `[active]`） |

### 恢复会话

将 `/history` 与 `/resume` 结合使用，实现流畅的工作流：

```
/history            # 找到您想要的会话
/resume abc123...   # 恢复它
```

---

## 粒度化自动批准（Yolo 模式）

Yolo 模式提供基于模式的工具调用自动批准，让您对代理可以在无提示情况下执行的操作进行精细控制。结合 `--timeout` 实现有时间限制的自主会话。

### 用法

```bash
# 自动批准所有操作
autohand --yolo true

# 仅自动批准读取和写入操作
autohand --yolo 'allow:read_file,write_file,search'

# 自动批准除删除和命令执行外的所有操作
autohand --yolo 'deny:delete_path,run_command'

# 允许所有操作，但仅限 10 分钟
autohand --yolo true --timeout 600
```

### 模式语法

| 模式 | 效果 |
|------|------|
| `true` | `allow:*` 的快捷方式 -- 批准所有 |
| `allow:*` | 自动批准所有工具 |
| `allow:read_file,write_file` | 仅自动批准列出的工具 |
| `deny:delete_path,run_command` | 拒绝列出的工具，自动批准其余的 |

### 工作原理

1. Autohand 将 `--yolo` 模式解析为 `YoloPattern`（模式 + 工具列表）。
2. 当工具调用需要批准时，Autohand 检查工具名称是否匹配模式。
3. 如果匹配（在 allow 模式下）或不匹配（在 deny 模式下），工具无需提示即可执行。
4. 如果模式未自动批准该工具，则显示正常的权限提示。

### 计时器

`--timeout` 标志创建一个跟踪剩余时间的 `YoloTimer`：

```bash
# 自动批准 5 分钟，然后恢复正常提示
autohand --yolo true --timeout 300
```

- 当计时器活跃时，匹配的工具会被自动批准。
- 当计时器到期时，所有工具调用恢复正常的权限提示。

### 安全性

- Yolo 模式与现有权限系统集成。
- 黑名单中的操作（`permissions.blacklist`）即使在 yolo 模式下仍然被阻止。
- `deny` 模式让您可以明确排除危险操作。

---

## MCP 客户端支持

Autohand 现在包含一个内置的 MCP（Model Context Protocol）客户端，可以连接到外部 MCP 服务器。这让您可以使用来自数据库、API 或任何 MCP 兼容服务的自定义工具来扩展 Autohand。

### 概述

MCP 是连接 AI 代理与外部工具的行业标准协议。Autohand 的 MCP 客户端支持：

- **stdio 传输** -- 启动子进程并通过 stdin/stdout 上的 JSON-RPC 2.0 通信
- **SSE 传输** -- 使用 Server-Sent Events 连接到 HTTP 服务器
- **自动工具发现** -- 查询 `tools/list` 并动态注册工具
- **命名空间工具** -- 工具以 `mcp__<服务器>__<工具>` 为前缀，避免冲突
- **服务器生命周期管理** -- 启动、停止和重新连接服务器

### 配置

将 MCP 服务器添加到您的 `~/.autohand/config.json`：

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

### 服务器配置字段

| 字段 | 类型 | 必填 | 默认值 | 描述 |
|------|------|------|--------|------|
| `name` | string | 是 | - | 服务器唯一名称 |
| `transport` | `"stdio"` 或 `"sse"` | 是 | - | 连接类型 |
| `command` | string | 仅 stdio | - | 启动服务器的命令 |
| `args` | string[] | 否 | `[]` | 命令参数 |
| `url` | string | 仅 sse | - | SSE 端点 URL |
| `env` | object | 否 | `{}` | 服务器进程的环境变量 |
| `autoConnect` | boolean | 否 | `true` | 启动时自动连接 |

### 工具命名

MCP 工具使用命名空间以防止与内置工具冲突：

```
mcp__<服务器名称>__<工具名称>
```

例如，来自名为 `database` 的服务器的 `query` 工具变为 `mcp__database__query`。

---

## IDE 集成

`/ide` 命令检测系统上正在运行的 IDE，并启用集成功能。Autohand 可以检测哪个 IDE 正在编辑您当前的工作区并建议相关扩展。

### 支持的 IDE

| IDE | 平台 | 扩展可用 |
|-----|------|----------|
| Visual Studio Code | macOS, Linux, Windows | 是 |
| Visual Studio Code Insiders | macOS, Linux, Windows | 是 |
| Cursor | macOS, Linux, Windows | 否 |
| Zed | macOS, Linux, Windows | 是 |
| Antigravity | macOS | 否 |

### 用法

```
/ide
```

该命令执行以下步骤：

1. 扫描运行中的进程以查找已知的 IDE 模式
2. 读取 IDE 存储以确定每个实例打开了哪个工作区
3. 将检测到的 IDE 与当前工作目录进行匹配
4. 为匹配的 IDE 显示选择模态框
5. 建议安装扩展以实现更深层的集成

---

## Homebrew 安装

Autohand 现在可以通过 macOS 上的 Homebrew 安装：

```bash
# 直接安装
brew install autohand

# 或通过官方 tap
brew tap autohandai/tap && brew install autohand
```

### 详情

- Node.js 被声明为依赖项，如果需要会自动安装
- 公式从 npm 注册表安装
- 安装后通过 `autohand --version` 验证版本
- 通过 `brew upgrade autohand` 获取更新

---

## 计划模式

计划模式让代理在行动前先制定计划。启用后，代理仅使用只读工具收集信息并制定计划。一旦您批准计划，执行就会开始。

### 激活

按 **Shift+Tab** 切换计划模式的开关。状态指示器显示当前状态：

| 指示器 | 含义 |
|--------|------|
| `[PLAN]` | 规划阶段 -- 代理正在收集信息并制定计划 |
| `[EXEC]` | 执行阶段 -- 代理正在执行已批准的计划 |
| *（无）* | 计划模式关闭 -- 正常操作 |

### 工作原理

1. **激活** -- 按 Shift+Tab。提示符显示 `[PLAN]`。
2. **规划阶段** -- 代理只能使用只读工具（文件读取、搜索、git status、网络搜索等）。写操作被阻止。
3. **计划展示** -- 代理展示一个带有步骤的结构化计划。
4. **接受选项** -- 选择如何继续：
   - **清除上下文并自动接受编辑** -- 最佳计划遵循性，清除对话历史
   - **手动批准** -- 逐一审查和批准每个编辑
   - **自动接受** -- 无需审查自动接受所有编辑
5. **执行** -- 指示器变为 `[EXEC]`，代理执行计划。

---

## Web Repo 工具

新的 `web_repo` 工具使用 `@owner/repo` 格式从 GitHub 和 GitLab 获取仓库信息。这让代理无需离开终端即可获取外部仓库的上下文。

### 用法

在提示中使用 `@owner/repo` 语法提及一个仓库：

```
告诉我关于 @vercel/next.js 的信息
```

代理还可以直接调用 `web_repo` 工具来获取仓库元数据、README 内容和结构信息。

---

## 自动上下文压缩

Autohand 现在会在会话变长时自动压缩对话上下文。这可以防止上下文窗口耗尽，并在长时间会话中保持代理的响应能力。

### 工作原理

- 默认启用（`--cc` 标志）
- 监控对话长度相对于模型上下文窗口的比例
- 当对话接近限制时，旧消息被总结和压缩
- 在交互模式和计划模式中均有效
- 关键信息（文件内容、最近的工具结果）被保留

### 配置

```bash
# 启用上下文压缩（默认）
autohand --cc

# 禁用上下文压缩
autohand --no-cc
```

---

## 自定义系统提示词

覆盖或扩展默认系统提示词，用于专业化工作流。

### 替换整个提示词

```bash
# 内联字符串
autohand --sys-prompt "You are a Python expert. Be concise."

# 从文件加载
autohand --sys-prompt ./custom-prompt.md
```

使用 `--sys-prompt` 时，默认的 Autohand 指令、AGENTS.md、记忆和技能都会被替换。

### 追加到默认提示词

```bash
# 内联字符串
autohand --append-sys-prompt "Always use TypeScript instead of JavaScript"

# 从文件加载
autohand --append-sys-prompt ./team-guidelines.md
```

使用 `--append-sys-prompt` 时，内容添加到完整默认提示词的末尾。所有默认行为被保留。

---

## 新增 CLI 标志

| 标志 | 描述 |
|------|------|
| `--thinking [level]` | 设置推理深度：`none`、`normal`、`extended` |
| `--yolo [pattern]` | 自动批准匹配模式的工具调用 |
| `--timeout <seconds>` | yolo 模式自动批准的时间限制 |
| `--cc` / `--no-cc` | 启用/禁用自动上下文压缩 |
| `--search-engine <provider>` | 设置网络搜索提供者（`brave`、`duckduckgo`、`parallel`） |
| `--sys-prompt <value>` | 替换整个系统提示词（内联或文件路径） |
| `--append-sys-prompt <value>` | 追加到默认系统提示词 |
| `--display-language <locale>` | 设置显示语言（例如 `en`、`zh-cn`、`fr`、`de`、`ja`） |
| `--add-dir <path>` | 添加额外目录到工作区范围 |
| `--skill-install [name]` | 安装社区技能 |
| `--project` | 安装技能到项目级别（与 `--skill-install` 配合使用） |

---

## 新增斜杠命令

| 命令 | 描述 |
|------|------|
| `/history` | 分页浏览会话历史 |
| `/history <页码>` | 查看特定页的会话历史 |
| `/ide` | 检测运行中的 IDE 并连接以进行集成 |
| `/about` | 显示 Autohand 信息（版本、链接） |
| `/feedback` | 提交关于 CLI 的反馈 |
| `/plan` | 与计划模式交互 |
| `/add-dir` | 添加额外目录到工作区范围 |
| `/language` | 更改显示语言 |
| `/formatters` | 列出可用的代码格式化工具 |
| `/lint` | 列出可用的代码检查工具 |
| `/completion` | 生成 shell 自动补全脚本（bash、zsh、fish） |
| `/export` | 将会话导出为 markdown、JSON 或 HTML |
| `/permissions` | 查看和管理权限设置 |
| `/hooks` | 交互式管理生命周期钩子 |
| `/share` | 通过 autohand.link 分享会话 |
| `/skills` | 列出、激活、停用或创建技能 |

---

## 架构改进

### Modal 组件

`enquirer` 依赖已被基于 Ink 构建的自定义 `Modal` 组件替换。这提供了一致的样式、键盘导航和与 TUI 其余部分更好的集成。

### 提取的模块

多个内部模块已被提取以实现更好的关注点分离：

- **WorkspaceFileCollector** -- 处理工作区文件发现，具有 30 秒缓存
- **AgentFormatter** -- 格式化代理输出以供终端显示
- **ProviderConfigManager** -- 管理特定于提供者的配置逻辑

### Ink UI 渲染

实验性的基于 Ink 的渲染器（`ui.useInkRenderer`）已针对以下方面进行优化：

- 通过 React 协调实现无闪烁输出
- 工作请求队列（代理工作时继续输入）
- 更好的输入处理，无 readline 冲突

### 动态帮助

`/help` 命令现在从注册的斜杠命令动态生成其输出，因此始终反映当前可用命令集。

---

## 升级方式

### 通过 npm

```bash
npm update -g autohand-cli
```

### 通过 Homebrew

```bash
brew upgrade autohand
```

### 配置兼容性

您现有的 `~/.autohand/config.json` 完全向后兼容。无需迁移。

新的配置部分（如 `mcp.servers`）是可选的，仅在您想使用相应功能时才需要。Autohand 对所有新设置使用合理的默认值。

---

## 相关文档

- [配置参考](./config-reference_zh.md) -- 所有配置选项
- [钩子系统](./hooks.md) -- 生命周期钩子
- [提供者指南](./providers.md) -- LLM 提供者设置
- [自动模式](./automode.md) -- 自主开发循环
- [RPC 协议](./rpc-protocol.md) -- 程序化控制
