# Autohand 配置参考

`~/.autohand/config.json`（或 `.yaml`/`.yml`）中所有配置选项的完整参考文档。

## 目录

- [配置文件位置](#配置文件位置)
- [环境变量](#环境变量)
- [提供商设置](#提供商设置)
- [工作区设置](#工作区设置)
- [界面设置](#界面设置)
- [代理设置](#代理设置)
- [权限设置](#权限设置)
- [网络设置](#网络设置)
- [遥测设置](#遥测设置)
- [外部代理](#外部代理)
- [API 设置](#api-设置)
- [完整示例](#完整示例)

---

## 配置文件位置

Autohand 按以下顺序查找配置：

1. `AUTOHAND_CONFIG` 环境变量（自定义路径）
2. `~/.autohand/config.yaml`
3. `~/.autohand/config.yml`
4. `~/.autohand/config.json`（默认）

您还可以覆盖基础目录：
```bash
export AUTOHAND_HOME=/custom/path  # 将 ~/.autohand 更改为 /custom/path
```

---

## 环境变量

| 变量 | 描述 | 示例 |
|------|------|------|
| `AUTOHAND_HOME` | 所有 Autohand 数据的基础目录 | `/custom/path` |
| `AUTOHAND_CONFIG` | 自定义配置文件路径 | `/path/to/config.json` |
| `AUTOHAND_API_URL` | API 端点（覆盖配置） | `https://api.autohand.ai` |
| `AUTOHAND_SECRET` | 公司/团队密钥 | `sk-xxx` |

---

## 提供商设置

### `provider`
要使用的活动 LLM 提供商。

| 值 | 描述 |
|----|------|
| `"openrouter"` | OpenRouter API（默认） |
| `"ollama"` | 本地 Ollama 实例 |
| `"llamacpp"` | 本地 llama.cpp 服务器 |
| `"openai"` | 直接使用 OpenAI API |

### `openrouter`
OpenRouter 提供商配置。

```json
{
  "openrouter": {
    "apiKey": "sk-or-v1-xxx",
    "baseUrl": "https://openrouter.ai/api/v1",
    "model": "anthropic/claude-sonnet-4"
  }
}
```

| 字段 | 类型 | 必需 | 默认值 | 描述 |
|------|------|------|--------|------|
| `apiKey` | string | 是 | - | 您的 OpenRouter API 密钥 |
| `baseUrl` | string | 否 | `https://openrouter.ai/api/v1` | API 端点 |
| `model` | string | 是 | - | 模型标识符（例如：`anthropic/claude-sonnet-4`） |

### `ollama`
Ollama 提供商配置。

```json
{
  "ollama": {
    "baseUrl": "http://localhost:11434",
    "port": 11434,
    "model": "llama3.2"
  }
}
```

| 字段 | 类型 | 必需 | 默认值 | 描述 |
|------|------|------|--------|------|
| `baseUrl` | string | 否 | `http://localhost:11434` | Ollama 服务器 URL |
| `port` | number | 否 | `11434` | 服务器端口（baseUrl 的替代方案） |
| `model` | string | 是 | - | 模型名称（例如：`llama3.2`、`codellama`） |

### `llamacpp`
llama.cpp 服务器配置。

```json
{
  "llamacpp": {
    "baseUrl": "http://localhost:8080",
    "port": 8080,
    "model": "default"
  }
}
```

| 字段 | 类型 | 必需 | 默认值 | 描述 |
|------|------|------|--------|------|
| `baseUrl` | string | 否 | `http://localhost:8080` | llama.cpp 服务器 URL |
| `port` | number | 否 | `8080` | 服务器端口 |
| `model` | string | 是 | - | 模型标识符 |

### `openai`
OpenAI API 配置。

```json
{
  "openai": {
    "apiKey": "sk-xxx",
    "baseUrl": "https://api.openai.com/v1",
    "model": "gpt-4o"
  }
}
```

| 字段 | 类型 | 必需 | 默认值 | 描述 |
|------|------|------|--------|------|
| `apiKey` | string | 是 | - | OpenAI API 密钥 |
| `baseUrl` | string | 否 | `https://api.openai.com/v1` | API 端点 |
| `model` | string | 是 | - | 模型名称（例如：`gpt-4o`、`gpt-4o-mini`） |

---

## 工作区设置

```json
{
  "workspace": {
    "defaultRoot": "/path/to/projects",
    "allowDangerousOps": false
  }
}
```

| 字段 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `defaultRoot` | string | 当前目录 | 未指定时的默认工作区 |
| `allowDangerousOps` | boolean | `false` | 无需确认即允许破坏性操作 |

---

## 界面设置

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

| 字段 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `theme` | `"dark"` \| `"light"` | `"dark"` | 终端输出颜色主题 |
| `autoConfirm` | boolean | `false` | 跳过安全操作的确认提示 |
| `readFileCharLimit` | number | `300` | 读取/搜索工具输出中显示的最大字符数（完整内容仍发送给模型） |
| `showCompletionNotification` | boolean | `true` | 任务完成时显示系统通知 |
| `showThinking` | boolean | `true` | 显示 LLM 的推理/思考过程 |
| `useInkRenderer` | boolean | `false` | 使用基于 Ink 的渲染器以获得无闪烁 UI（实验性） |
| `terminalBell` | boolean | `true` | 任务完成时响铃（在终端标签/程序坞显示徽章） |
| `checkForUpdates` | boolean | `true` | 启动时检查 CLI 更新 |
| `updateCheckInterval` | number | `24` | 更新检查间隔小时数（在间隔内使用缓存结果） |

注意：`readFileCharLimit` 仅影响 `read_file`、`search` 和 `search_with_context` 的终端显示。完整内容仍发送给模型并存储在工具消息中。

### 终端铃声

当 `terminalBell` 启用时（默认），Autohand 在任务完成时会响铃（`\x07`）。这会触发：

- **终端标签徽章** - 显示工作完成的视觉指示器
- **程序坞图标弹跳** - 当终端在后台时吸引注意力（macOS）
- **声音** - 如果终端设置中启用了声音

要禁用：
```json
{
  "ui": {
    "terminalBell": false
  }
}
```

### Ink 渲染器（实验性）

当 `useInkRenderer` 启用时，Autohand 使用基于 React 的终端渲染（Ink）而不是传统的 ora 加载器。这提供：

- **无闪烁输出**：所有 UI 更新通过 React 协调批处理
- **工作队列功能**：在代理工作时输入指令
- **更好的输入处理**：readline 处理器之间无冲突
- **可组合 UI**：未来高级 UI 功能的基础

要启用：
```json
{
  "ui": {
    "useInkRenderer": true
  }
}
```

注意：此功能是实验性的，可能存在边缘情况。默认的基于 ora 的 UI 保持稳定且功能完整。

### 更新检查

当 `checkForUpdates` 启用时（默认），Autohand 在启动时检查新版本：

```
> Autohand v0.6.8 (abc1234) ✓ Up to date
```

如果有更新：
```
> Autohand v0.6.7 (abc1234) ⬆ Update available: v0.6.8
  ↳ Run: curl -fsSL https://autohand.ai/install.sh | sh
```

要禁用：
```json
{
  "ui": {
    "checkForUpdates": false
  }
}
```

或通过环境变量：
```bash
export AUTOHAND_SKIP_UPDATE_CHECK=1
```

---

## 代理设置

控制代理行为和迭代限制。

```json
{
  "agent": {
    "maxIterations": 100,
    "enableRequestQueue": true
  }
}
```

| 字段 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `maxIterations` | number | `100` | 停止前每个用户请求的最大工具迭代次数 |
| `enableRequestQueue` | boolean | `true` | 允许用户在代理工作时输入和排队请求 |

### 请求队列

当 `enableRequestQueue` 启用时，您可以在代理处理先前请求时继续输入消息。您的输入将自动排队，并在当前任务完成时处理。

- 输入消息并按 Enter 添加到队列
- 状态栏显示排队的请求数
- 请求按 FIFO（先进先出）顺序处理
- 最大队列大小为 10 个请求

---

## 权限设置

对工具权限的细粒度控制。

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

| 值 | 描述 |
|----|------|
| `"interactive"` | 对危险操作请求批准（默认） |
| `"unrestricted"` | 无提示，允许所有 |
| `"restricted"` | 拒绝所有危险操作 |

### `whitelist`
永不需要批准的工具模式数组。

```json
["run_command:npm *", "run_command:bun test"]
```

### `blacklist`
始终阻止的工具模式数组。

```json
["run_command:rm -rf /", "run_command:sudo *"]
```

### `rules`
细粒度权限规则。

| 字段 | 类型 | 描述 |
|------|------|------|
| `tool` | string | 要匹配的工具名称 |
| `pattern` | string | 可选的参数匹配模式 |
| `action` | `"allow"` \| `"deny"` \| `"prompt"` | 要采取的操作 |

### `rememberSession`
| 类型 | 默认值 | 描述 |
|------|--------|------|
| boolean | `true` | 记住会话期间的批准决定 |

### 本地项目权限

每个项目可以有自己的权限设置，覆盖全局配置。这些存储在项目根目录的 `.autohand/settings.local.json` 中。

当您批准文件操作（编辑、写入、删除）时，它会自动保存到此文件，这样您就不会在此项目中再次被询问相同的操作。

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

**工作原理：**
- 当您批准操作时，它会保存到 `.autohand/settings.local.json`
- 下次，相同的操作将自动批准
- 本地项目设置与全局设置合并（本地优先）
- 将 `.autohand/settings.local.json` 添加到 `.gitignore` 以保持个人设置私密

**模式格式：**
- `工具名:路径` - 用于文件操作（例如：`multi_file_edit:src/file.ts`）
- `工具名:命令 参数` - 用于命令（例如：`run_command:npm test`）

---

## 网络设置

```json
{
  "network": {
    "maxRetries": 3,
    "timeout": 30000,
    "retryDelay": 1000
  }
}
```

| 字段 | 类型 | 默认值 | 最大值 | 描述 |
|------|------|--------|--------|------|
| `maxRetries` | number | `3` | `5` | 失败 API 请求的重试次数 |
| `timeout` | number | `30000` | - | 请求超时（毫秒） |
| `retryDelay` | number | `1000` | - | 重试之间的延迟（毫秒） |

---

## 遥测设置

遥测**默认禁用**（选择加入）。启用以帮助改进 Autohand。

```json
{
  "telemetry": {
    "enabled": false,
    "apiBaseUrl": "https://api.autohand.ai",
    "enableSessionSync": false
  }
}
```

| 字段 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `enabled` | boolean | `false` | 启用/禁用遥测（选择加入） |
| `apiBaseUrl` | string | `https://api.autohand.ai` | 遥测 API 端点 |
| `enableSessionSync` | boolean | `false` | 将会话同步到云端以获得团队功能 |

---

## 外部代理

从外部目录加载自定义代理定义。

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

| 字段 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `enabled` | boolean | `false` | 启用外部代理加载 |
| `paths` | string[] | `[]` | 加载代理的目录 |

---

## API 设置

用于团队功能的后端 API 配置。

```json
{
  "api": {
    "baseUrl": "https://api.autohand.ai",
    "companySecret": "sk-team-xxx"
  }
}
```

| 字段 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `baseUrl` | string | `https://api.autohand.ai` | API 端点 |
| `companySecret` | string | - | 共享功能的团队/公司密钥 |

也可以通过环境变量设置：
- `AUTOHAND_API_URL` → `api.baseUrl`
- `AUTOHAND_SECRET` → `api.companySecret`

---

## 完整示例

### JSON 格式 (`~/.autohand/config.json`)

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
    "enableRequestQueue": true
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
    "enableSessionSync": false
  },
  "externalAgents": {
    "enabled": false,
    "paths": []
  },
  "api": {
    "baseUrl": "https://api.autohand.ai"
  }
}
```

### YAML 格式 (`~/.autohand/config.yaml`)

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
  enableSessionSync: false

externalAgents:
  enabled: false
  paths: []

api:
  baseUrl: https://api.autohand.ai
```

---

## 目录结构

Autohand 将数据存储在 `~/.autohand/`（或 `$AUTOHAND_HOME`）：

```
~/.autohand/
├── config.json          # 主配置
├── config.yaml          # 备用 YAML 配置
├── device-id            # 唯一设备标识符
├── error.log            # 错误日志
├── feedback.log         # 反馈提交
├── sessions/            # 会话历史
├── projects/            # 项目知识库
├── memory/              # 用户级内存
├── commands/            # 自定义命令
├── agents/              # 代理定义
├── tools/               # 自定义元工具
├── feedback/            # 反馈状态
└── telemetry/           # 遥测数据
    ├── queue.json
    └── session-sync-queue.json
```

**项目级目录**（在工作区根目录）：

```
<project>/.autohand/
├── settings.local.json  # 本地项目权限（添加到 gitignore）
├── memory/              # 项目特定内存
└── skills/              # 项目特定技能
```

---

## CLI 标志（覆盖配置）

这些标志覆盖配置文件设置：

| 标志 | 描述 |
|------|------|
| `--model <model>` | 覆盖模型 |
| `--path <path>` | 覆盖工作区根目录 |
| `--add-dir <path>` | 添加额外目录到工作区范围（可多次使用） |
| `--config <path>` | 使用自定义配置文件 |
| `--temperature <n>` | 设置温度（0-1） |
| `--yes` | 自动确认提示 |
| `--dry-run` | 预览而不执行 |
| `--unrestricted` | 无批准提示 |
| `--restricted` | 拒绝危险操作 |
| `--setup` | 运行设置向导以配置或重新配置 Autohand |
| `--about` | 显示 Autohand 信息（版本、链接、贡献信息） |
| `--sys-prompt <值>` | 完全替换系统提示（内联字符串或文件路径） |
| `--append-sys-prompt <值>` | 附加到系统提示（内联字符串或文件路径） |

---

## 系统提示自定义

Autohand 允许您自定义 AI 代理使用的系统提示。这对于专业工作流程、自定义指令或与其他系统集成非常有用。

### CLI 标志

| 标志 | 描述 |
|------|------|
| `--sys-prompt <值>` | 完全替换系统提示 |
| `--append-sys-prompt <值>` | 向默认系统提示附加内容 |

两个标志都接受：
- **内联字符串**：直接文本内容
- **文件路径**：包含提示的文件路径（自动检测）

### 文件路径检测

如果值满足以下条件，则被视为文件路径：
- 以 `./`、`../`、`/` 或 `~/` 开头
- 以 Windows 驱动器号开头（例如 `C:\`）
- 以 `.txt`、`.md` 或 `.prompt` 结尾
- 包含路径分隔符且不含空格

否则，被视为内联字符串。

### `--sys-prompt`（完全替换）

提供时，**完全替换**默认系统提示。代理将不会加载：
- Autohand 默认指令
- AGENTS.md 项目指令
- 用户/项目记忆
- 活动技能

```bash
# 内联字符串
autohand --sys-prompt "你是一个 Python 专家。请简洁回答。" --prompt "编写 hello world"

# 从文件
autohand --sys-prompt ./custom-prompt.txt --prompt "解释这段代码"
```

### `--append-sys-prompt`（附加到默认）

提供时，向完整的默认系统提示**附加**内容。代理仍将加载所有默认指令。

```bash
# 内联字符串
autohand --append-sys-prompt "始终使用 TypeScript 而不是 JavaScript" --prompt "创建一个函数"

# 从文件
autohand --append-sys-prompt ./team-guidelines.md --prompt "添加错误处理"
```

### 优先级

当同时提供两个标志时：
1. `--sys-prompt` 具有完全优先权
2. `--append-sys-prompt` 被忽略

---

## 多目录支持

Autohand 可以使用主工作区以外的多个目录。当您的项目在不同目录中有依赖项、共享库或相关项目时，这非常有用。

### CLI 标志

使用 `--add-dir` 添加额外目录（可多次使用）：

```bash
# 添加单个额外目录
autohand --add-dir /path/to/shared-lib

# 添加多个目录
autohand --add-dir /path/to/lib1 --add-dir /path/to/lib2

# 使用无限制模式（自动批准对所有目录的写入）
autohand --add-dir /path/to/shared-lib --unrestricted
```

### 交互式命令

在交互式会话中使用 `/add-dir`：

```
/add-dir              # 显示当前目录
/add-dir /path/to/dir # 添加新目录
```

### 安全限制

以下目录无法添加：
- 主目录（`~` 或 `$HOME`）
- 根目录（`/`）
- 系统目录（`/etc`、`/var`、`/usr`、`/bin`、`/sbin`）
- Windows 系统目录（`C:\Windows`、`C:\Program Files`）
- Windows 用户目录（`C:\Users\username`）
- WSL Windows 挂载（`/mnt/c`、`/mnt/c/Windows`）
