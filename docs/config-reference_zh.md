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
- [补丁模式](#补丁模式)
- [网络设置](#网络设置)
- [遥测设置](#遥测设置)
- [外部代理](#外部代理)
- [API 设置](#api-设置)
- [认证设置](#认证设置)
- [社区技能设置](#社区技能设置)
- [分享设置](#分享设置)
- [同步设置](#同步设置)
- [钩子设置](#钩子设置)
- [MCP 设置](#mcp-设置)
- [Chrome 扩展设置](#chrome-扩展设置)
- [技能系统](#技能系统)
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

| 变量                                   | 描述                                            | 示例                             |
| -------------------------------------- | ----------------------------------------------- | -------------------------------- |
| `AUTOHAND_HOME`                        | 所有 Autohand 数据的基础目录                    | `/custom/path`                   |
| `AUTOHAND_CONFIG`                      | 自定义配置文件路径                              | `/path/to/config.json`           |
| `AUTOHAND_API_URL`                     | API 端点（覆盖配置）                            | `https://api.autohand.ai`        |
| `AUTOHAND_SECRET`                      | 公司/团队密钥                                   | `sk-xxx`                         |
| `AUTOHAND_PERMISSION_CALLBACK_URL`     | 权限回调 URL（实验性）                          | `http://localhost:3000/callback` |
| `AUTOHAND_PERMISSION_CALLBACK_TIMEOUT` | 权限回调超时（毫秒）                            | `5000`                           |
| `AUTOHAND_NON_INTERACTIVE`             | 以非交互模式运行                                | `1`                              |
| `AUTOHAND_YES`                         | 自动确认所有提示                                | `1`                              |
| `AUTOHAND_NO_BANNER`                   | 禁用启动横幅                                    | `1`                              |
| `AUTOHAND_STREAM_TOOL_OUTPUT`          | 实时流式输出工具结果                            | `1`                              |
| `AUTOHAND_DEBUG`                       | 启用调试日志                                    | `1`                              |
| `AUTOHAND_THINKING_LEVEL`              | 设置思考级别                                    | `normal`                         |
| `AUTOHAND_CLIENT_NAME`                 | 客户端/编辑器标识符（由 ACP 扩展设置）          | `zed`                            |
| `AUTOHAND_CLIENT_VERSION`              | 客户端版本（由 ACP 扩展设置）                   | `0.169.0`                        |
| `AUTOHAND_CODE`                        | 环境检测标志（自动设置）                         | `1`                              |

### 思考级别

`AUTOHAND_THINKING_LEVEL` 环境变量控制模型的推理深度：

| 值         | 描述                                                              |
| ---------- | ----------------------------------------------------------------- |
| `none`     | 直接回答，无可见推理                                              |
| `normal`   | 标准推理深度（默认值）                                              |
| `extended` | 针对复杂任务的深度推理，显示更详细的思考过程                      |

这通常由 ACP 客户端扩展（如 Zed）通过配置下拉菜单设置。

```bash
# 示例：对复杂任务使用扩展推理
AUTOHAND_THINKING_LEVEL=extended autohand --prompt "重构此模块"
```

---

## 提供商设置

### `provider`

要使用的活动 LLM 提供商。

| 值             | 描述                   |
| -------------- | ---------------------- |
| `"openrouter"` | OpenRouter API（默认） |
| `"ollama"`     | 本地 Ollama 实例       |
| `"llamacpp"`   | 本地 llama.cpp 服务器  |
| `"openai"`     | 直接使用 OpenAI API    |
| `"mlx"`        | Apple Silicon 上的 MLX（本地） |
| `"llmgateway"` | 集成 LLM Gateway API   |

### `openrouter`

OpenRouter 提供商配置。

```json
{
  "openrouter": {
    "apiKey": "sk-or-v1-xxx",
    "baseUrl": "https://openrouter.ai/api/v1",
    "model": "your-modelcard-id-here"
  }
}
```

| 字段      | 类型   | 必需 | 默认值                         | 描述                                         |
| --------- | ------ | ---- | ------------------------------ | -------------------------------------------- |
| `apiKey`  | string | 是   | -                              | 您的 OpenRouter API 密钥                     |
| `baseUrl` | string | 否   | `https://openrouter.ai/api/v1` | API 端点                                     |
| `model`   | string | 是   | -                              | 模型标识符（例如：`your-modelcard-id-here`） |

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

| 字段      | 类型   | 必需 | 默认值                   | 描述                                      |
| --------- | ------ | ---- | ------------------------ | ----------------------------------------- |
| `baseUrl` | string | 否   | `http://localhost:11434` | Ollama 服务器 URL                         |
| `port`    | number | 否   | `11434`                  | 服务器端口（baseUrl 的替代方案）          |
| `model`   | string | 是   | -                        | 模型名称（例如：`llama3.2`、`codellama`） |

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

| 字段      | 类型   | 必需 | 默认值                  | 描述                 |
| --------- | ------ | ---- | ----------------------- | -------------------- |
| `baseUrl` | string | 否   | `http://localhost:8080` | llama.cpp 服务器 URL |
| `port`    | number | 否   | `8080`                  | 服务器端口           |
| `model`   | string | 是   | -                       | 模型标识符           |

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

| 字段      | 类型   | 必需 | 默认值                      | 描述                                      |
| --------- | ------ | ---- | --------------------------- | ----------------------------------------- |
| `apiKey`  | string | 是   | -                           | OpenAI API 密钥                           |
| `baseUrl` | string | 否   | `https://api.openai.com/v1` | API 端点                                  |
| `model`   | string | 是   | -                           | 模型名称（例如：`gpt-4o`、`gpt-4o-mini`） |

### `mlx`

适用于 Apple Silicon Mac 的 MLX 提供商（本地推理）。

```json
{
  "mlx": {
    "baseUrl": "http://localhost:8080",
    "port": 8080,
    "model": "mlx-community/Llama-3.2-3B-Instruct-4bit"
  }
}
```

| 字段       | 类型   | 必需   | 默认值                     | 描述               |
| ---------- | ------ | ------ | -------------------------- | ------------------ |
| `baseUrl`  | string | 否     | `http://localhost:8080` | MLX 服务器 URL     |
| `port`     | number | 否     | `8080`                  | 服务器端口         |
| `model`    | string | 是     | -                       | MLX 模型标识符     |

### `llmgateway`

集成 LLM Gateway API 配置。通过单个 API 访问多个 LLM 提供商。

```json
{
  "llmgateway": {
    "apiKey": "your-llmgateway-api-key",
    "baseUrl": "https://api.llmgateway.io/v1",
    "model": "gpt-4o"
  }
}
```

| 字段       | 类型   | 必需   | 默认值                         | 描述                                               |
| ---------- | ------ | ------ | ------------------------------ | -------------------------------------------------- |
| `apiKey`   | string | 是     | -                              | LLM Gateway API 密钥                               |
| `baseUrl`  | string | 否     | `https://api.llmgateway.io/v1` | API 端点                                           |
| `model`    | string | 是     | -                              | 模型名称（例如：`gpt-4o`、`claude-3-5-sonnet-20241022`） |

**获取 API 密钥：**
访问 [llmgateway.io/dashboard](https://llmgateway.io/dashboard) 创建账户并获取 API 密钥。

**支持的模型：**
LLM Gateway 支持来自多个提供商的模型，包括：

- OpenAI: `gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo`
- Anthropic: `claude-3-5-sonnet-20241022`, `claude-3-5-haiku-20241022`
- Google: `gemini-1.5-pro`, `gemini-1.5-flash`

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

| 字段                | 类型    | 默认值   | 描述                     |
| ------------------- | ------- | -------- | ------------------------ |
| `defaultRoot`       | string  | 当前目录 | 未指定时的默认工作区     |
| `allowDangerousOps` | boolean | `false`  | 无需确认即允许破坏性操作 |

### 工作区安全

Autohand 自动阻止在危险目录中的操作，以防止意外损坏：

- **文件系统根目录** (`/`, `C:\`, `D:\`, 等)
- **主目录** (`~`, `/Users/<user>`, `/home/<user>`, `C:\Users\<user>`)
- **系统目录** (`/etc`, `/var`, `/System`, `C:\Windows`, 等)
- **Windows WSL 挂载** (`/mnt/c`, `/mnt/c/Users/<user>`)

此检查无法被覆盖。如果您尝试从危险目录运行 autohand，您将收到错误，并需要指定安全的项目目录。

```bash
# 这将被阻止
cd ~ && autohand
# 错误：不安全的工作区目录

# 这将正常工作
cd ~/projects/my-app && autohand
```

有关完整详情，请参阅 [工作区安全](./workspace-safety.md)。

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

| 字段                         | 类型                  | 默认值   | 描述                                                        |
| ---------------------------- | --------------------- | -------- | ----------------------------------------------------------- |
| `theme`                      | `"dark"` \| `"light"` | `"dark"` | 终端输出颜色主题                                            |
| `autoConfirm`                | boolean               | `false`  | 跳过安全操作的确认提示                                      |
| `readFileCharLimit`          | number                | `300`    | 读取/搜索工具输出中显示的最大字符数（完整内容仍发送给模型） |
| `showCompletionNotification` | boolean               | `true`   | 任务完成时显示系统通知                                      |
| `showThinking`               | boolean               | `true`   | 显示 LLM 的推理/思考过程                                    |
| `useInkRenderer`             | boolean               | `false`  | 使用基于 Ink 的渲染器以获得无闪烁 UI（实验性）              |
| `terminalBell`               | boolean               | `true`   | 任务完成时响铃（在终端标签/程序坞显示徽章）                 |
| `checkForUpdates`            | boolean               | `true`   | 启动时检查 CLI 更新                                         |
| `updateCheckInterval`        | number                | `24`     | 更新检查间隔小时数（在间隔内使用缓存结果）                  |

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
    "enableRequestQueue": true,
    "debug": false
  }
}
```

| 字段                 | 类型    | 默认值 | 描述                                 |
| -------------------- | ------- | ------ | ------------------------------------ |
| `maxIterations`      | number  | `100`  | 停止前每个用户请求的最大工具迭代次数 |
| `enableRequestQueue` | boolean | `true` | 允许用户在代理工作时输入和排队请求   |
| `debug`              | boolean | `false` | 启用详细调试输出（将代理内部状态日志记录到 stderr） |

### 调试模式

启用调试模式以查看代理内部状态的详细日志记录（react 循环迭代、提示构建、会话详情）。输出转到 stderr 以免干扰正常输出。

启用调试模式的三种方法（按优先级顺序）：

1. **CLI 标志**：`autohand -d` 或 `autohand --debug`
2. **环境变量**：`AUTOHAND_DEBUG=1`
3. **配置文件**：设置 `agent.debug: true`

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
    "blacklist": ["run_command:rm -rf *", "run_command:sudo *"],
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

| 值               | 描述                       |
| ---------------- | -------------------------- |
| `"interactive"`  | 对危险操作请求批准（默认） |
| `"unrestricted"` | 无提示，允许所有           |
| `"restricted"`   | 拒绝所有危险操作           |

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

| 字段      | 类型                                | 描述               |
| --------- | ----------------------------------- | ------------------ |
| `tool`    | string                              | 要匹配的工具名称   |
| `pattern` | string                              | 可选的参数匹配模式 |
| `action`  | `"allow"` \| `"deny"` \| `"prompt"` | 要采取的操作       |

### `rememberSession`

| 类型    | 默认值 | 描述                   |
| ------- | ------ | ---------------------- |
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

### 查看权限

您可以通过两种方式查看当前的权限配置：

**CLI 标志（非交互式）：**

```bash
autohand --permissions
```

这将显示：

- 当前权限模式（interactive、unrestricted、restricted）
- 工作区和配置文件路径
- 所有已批准的权限模式（白名单）
- 所有被拒绝的权限模式（黑名单）
- 摘要统计

**交互式命令：**

```
/permissions
```

在交互模式下，`/permissions` 命令提供相同的信息，以及：

- 从白名单中移除项目
- 从黑名单中移除项目
- 清除所有已保存的权限

---

## 补丁模式

补丁模式允许您生成与 git 兼容的补丁，而无需修改工作区文件。这对于以下情况非常有用：

- 在应用更改之前进行代码审查
- 与团队成员共享 AI 生成的更改
- 创建可重现的变更集
- 需要捕获更改但不应用它们的 CI/CD 管道

### 用法

```bash
# 生成补丁到 stdout
autohand --prompt "添加用户认证" --patch

# 保存到文件
autohand --prompt "添加用户认证" --patch --output auth.patch

# 管道到文件（替代方法）
autohand --prompt "重构 API 处理程序" --patch > refactor.patch
```

### 行为

当指定 `--patch` 时：

- **自动确认**：所有提示自动接受（隐含 `--yes`）
- **无提示**：不显示批准提示（隐含 `--unrestricted`）
- **仅预览**：捕获更改但不写入磁盘
- **强制执行安全**：列入黑名单的操作（`.env`、SSH 密钥、危险命令）仍然被阻止

### 应用补丁

接收者可以使用标准 git 命令应用补丁：

```bash
# 检查将应用什么（试运行）
git apply --check changes.patch

# 应用补丁
git apply changes.patch

# 使用三路合并应用（更好的冲突处理）
git apply -3 changes.patch

# 应用并暂存更改
git apply --index changes.patch

# 还原补丁
git apply -R changes.patch
```

### 补丁格式

生成的补丁遵循 git 统一差异格式：

```diff
diff --git a/src/auth.ts b/src/auth.ts
new file mode 100644
--- /dev/null
+++ b/src/auth.ts
@@ -0,0 +1,15 @@
+export function authenticate(user: string, password: string) {
+  // 在此实现
+}
+
diff --git a/src/index.ts b/src/index.ts
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,5 +1,7 @@
 import express from 'express';
+import { authenticate } from './auth';
+
 const app = express();
+app.use(authenticate);
```

### 退出代码

| 代码 | 含义                                                |
| ---- | --------------------------------------------------- |
| `0`  | 成功，补丁已生成                                    |
| `1`  | 错误（缺少 `--prompt`、权限被拒绝等）               |

### 与其他标志结合

```bash
# 使用特定模型
autohand --prompt "优化查询" --patch --model gpt-4o

# 指定工作区
autohand --prompt "添加测试" --patch --path ./my-project

# 使用自定义配置
autohand --prompt "重构" --patch --config ~/.autohand/work.json
```

### 团队工作流示例

```bash
# 开发者 A：为功能生成补丁
autohand --prompt "实现带图表的用户仪表板" --patch --output dashboard.patch

# 通过 git 共享（仅使用补丁文件创建 PR）
git checkout -b patch/dashboard
git add dashboard.patch
git commit -m "Add dashboard feature patch"
git push

# 开发者 B：审查并应用
git fetch origin patch/dashboard
git apply dashboard.patch
# 运行测试、审查代码，然后提交
git add -A && git commit -m "feat: add user dashboard with charts"
```

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

| 字段         | 类型   | 默认值  | 最大值 | 描述                    |
| ------------ | ------ | ------- | ------ | ----------------------- |
| `maxRetries` | number | `3`     | `5`    | 失败 API 请求的重试次数 |
| `timeout`    | number | `30000` | -      | 请求超时（毫秒）        |
| `retryDelay` | number | `1000`  | -      | 重试之间的延迟（毫秒）  |

---

## 遥测设置

遥测**默认禁用**（选择加入）。启用以帮助改进 Autohand。

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

| 字段               | 类型    | 默认值                   | 描述                                           |
| ------------------ | ------- | ------------------------ | ---------------------------------------------- |
| `enabled`          | boolean | `false`                  | 启用/禁用遥测（选择加入）                      |
| `apiBaseUrl`       | string  | `https://api.autohand.ai` | 遥测 API 端点                                  |
| `batchSize`        | number  | `20`                     | 自动刷新前批处理的事件数量                     |
| `flushIntervalMs`  | number  | `60000`                  | 刷新间隔（毫秒）（1 分钟）                     |
| `maxQueueSize`     | number  | `500`                    | 删除旧事件前的最大队列大小                     |
| `maxRetries`       | number  | `3`                      | 失败遥测请求的重试尝试次数                     |
| `enableSessionSync` | boolean | `false`                  | 将会话同步到云端以支持团队功能                 |
| `companySecret`    | string  | `""`                     | 用于 API 身份验证的公司密钥                     |

---

## 外部代理

从外部目录加载自定义代理定义。

```json
{
  "externalAgents": {
    "enabled": true,
    "paths": ["~/.autohand/agents", "/team/shared/agents"]
  }
}
```

| 字段      | 类型     | 默认值  | 描述             |
| --------- | -------- | ------- | ---------------- |
| `enabled` | boolean  | `false` | 启用外部代理加载 |
| `paths`   | string[] | `[]`    | 加载代理的目录   |

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

| 字段            | 类型   | 默认值                    | 描述                    |
| --------------- | ------ | ------------------------- | ----------------------- |
| `baseUrl`       | string | `https://api.autohand.ai` | API 端点                |
| `companySecret` | string | -                         | 共享功能的团队/公司密钥 |

也可以通过环境变量设置：

- `AUTOHAND_API_URL` → `api.baseUrl`
- `AUTOHAND_SECRET` → `api.companySecret`

---

## 认证设置

受保护资源的认证配置。

```json
{
  "auth": {
    "token": "your-auth-token",
    "refreshToken": "your-refresh-token",
    "expiresAt": "2024-12-31T23:59:59Z"
  }
}
```

| 字段           | 类型   | 必需   | 描述                                    |
| -------------- | ------ | ------ | --------------------------------------- |
| `token`        | string | 是     | 当前访问令牌                            |
| `refreshToken` | string | 否     | 用于刷新访问令牌的令牌                  |
| `expiresAt`    | string | 否     | 令牌过期日期/时间（ISO 格式）          |

---

## 社区技能设置

社区技能注册表的配置。

```json
{
  "communitySkills": {
    "registryUrl": "https://skills.autohand.ai",
    "cacheDuration": 3600,
    "autoUpdate": false
  }
}
```

| 字段            | 类型    | 默认值                         | 描述                                            |
| --------------- | ------- | ------------------------------ | ------------------------------------------------ |
| `registryUrl`   | string  | `https://skills.autohand.ai` | 技能注册表的基础 URL                           |
| `cacheDuration` | number  | `3600`                         | 缓存持续时间（秒）                              |
| `autoUpdate`    | boolean | `false`                        | 技能过时时自动更新                              |

---

## 分享设置

控制会话和工作区的分享方式。

```json
{
  "share": {
    "enabled": true,
    "defaultVisibility": "private",
    "allowPublicLinks": false,
    "requireApproval": true
  }
}
```

| 字段                | 类型    | 默认值       | 描述                                            |
| ------------------- | ------- | ------------- | ------------------------------------------------ |
| `enabled`           | boolean | `true`        | 启用分享功能                                    |
| `defaultVisibility` | string  | `"private"`   | 默认可见性：`private`、`team`、`public`        |
| `allowPublicLinks`  | boolean | `false`       | 允许创建公共链接                                |
| `requireApproval`   | boolean | `true`        | 分享前需要批准                                  |

---

## 同步设置

在设备之间同步您的设置。

```json
{
  "sync": {
    "enabled": false,
    "autoSync": true,
    "syncInterval": 300,
    "conflictResolution": "ask"
  }
}
```

| 字段                | 类型    | 默认值       | 描述                                            |
| ------------------- | ------- | ------------- | ------------------------------------------------ |
| `enabled`           | boolean | `false`       | 启用设置同步                                    |
| `autoSync`          | boolean | `true`        | 更改时自动同步                                  |
| `syncInterval`      | number  | `300`         | 同步间隔（秒）                                  |
| `conflictResolution` | string  | `"ask"`       | 冲突解决方法：`ask`、`local`、`remote`         |

---

## 钩子设置

为 Autohand 事件配置自定义钩子。

```json
{
  "hooks": {
    "preCommand": "~/.autohand/hooks/pre-command.sh",
    "postCommand": "~/.autohand/hooks/post-command.sh",
    "onError": "~/.autohand/hooks/on-error.sh",
    "onComplete": "~/.autohand/hooks/on-complete.sh"
  }
}
```

| 字段          | 类型   | 描述                                            |
| ------------- | ------ | ------------------------------------------------ |
| `preCommand`  | string | 在每个命令之前执行的脚本                        |
| `postCommand` | string | 在每个命令之后执行的脚本                        |
| `onError`     | string | 发生错误时执行的脚本                            |
| `onComplete`  | string | 任务完成时执行的脚本                            |

钩子中可用的环境变量：

- `AUTOHAND_HOOK_TYPE` - 钩子类型（`preCommand`、`postCommand` 等）
- `AUTOHAND_COMMAND` - 正在执行的命令
- `AUTOHAND_EXIT_CODE` - 退出代码（仅 `postCommand` 和 `onError`）
- `AUTOHAND_SESSION_ID` - 当前会话 ID

---

## MCP 设置

与工具服务器集成的 Model Context Protocol（MCP）配置。

```json
{
  "mcp": {
    "servers": {
      "filesystem": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allowed/dir"],
        "env": {
          "HOME": "/home/user"
        }
      },
      "sqlite": {
        "command": "uvx",
        "args": ["mcp-server-sqlite", "--db-path", "/path/to/db.sqlite"]
      }
    }
  }
}
```

| 字段      | 类型   | 描述                                            |
| --------- | ------ | ------------------------------------------------ |
| `command` | string | 启动 MCP 服务器的命令                            |
| `args`    | array  | 命令的参数                                       |
| `env`     | object | 额外的环境变量                                   |

MCP 服务器提供代理可以调用的额外工具。每个服务器都由唯一名称标识，并在需要时自动启动。

---

## Chrome 扩展设置

Autohand Chrome 扩展的设置。

```json
{
  "chrome": {
    "extensionId": "your-extension-id",
    "nativeMessaging": true,
    "autoLaunch": false,
    "preferredBrowser": "chrome"
  }
}
```

| 字段                | 类型    | 默认值       | 描述                                            |
| ------------------- | ------- | ------------- | ------------------------------------------------ |
| `extensionId`       | string  | -             | 已安装 Chrome 扩展的 ID                        |
| `nativeMessaging`   | boolean | `true`        | 通过原生消息传递启用通信                        |
| `autoLaunch`        | boolean | `false`       | 启动时自动打开 Chrome                           |
| `preferredBrowser`  | string  | `"chrome"`    | 首选浏览器：`chrome`、`chromium`、`edge`、`brave` |

Chrome 扩展允许与网页交互和浏览器自动化。原生消息传递允许 CLI 和扩展之间的双向通信。

---

## 技能系统

技能是指令包，为 AI 代理提供专业知识指令。它们像按需使用的 `AGENTS.md` 文件，可以为特定任务激活。

### 技能发现位置

技能从多个位置发现，较新的源具有更高的优先级：

| 位置                                  | 源 ID            | 描述                              |
| -------------------------------------- | ---------------- | ---------------------------------- |
| `~/.codex/skills/**/SKILL.md`          | `codex-user`     | Codex 用户技能（递归）            |
| `~/.claude/skills/*/SKILL.md`          | `claude-user`    | Claude 用户技能（单层）            |
| `~/.autohand/skills/**/SKILL.md`      | `autohand-user`  | Autohand 用户技能（递归）          |
| `<项目>/.claude/skills/*/SKILL.md`  | `claude-project` | Claude 项目技能（单层）            |
| `<项目>/.autohand/skills/**/SKILL.md` | `autohand-project` | Autohand 项目技能（递归）          |

### 自动复制行为

从 Codex 或 Claude 位置发现的技能会自动复制到相应的 Autohand 位置：

- `~/.codex/skills/` 和 `~/.claude/skills/` → `~/.autohand/skills/`
- `<项目>/.claude/skills/` → `<项目>/.autohand/skills/`

Autohand 位置中已有的技能永远不会被覆盖。

### SKILL.md 格式

技能使用 YAML frontmatter 后跟 markdown 内容：

```markdown
---
name: my-skill-name
description: 技能的简短描述
license: MIT
compatibility: 适用于 Node.js 18+
allowed-tools: read_file write_file run_command
metadata:
  author: your-name
  version: "1.0.0"
---

# My Skill

AI 代理的详细指令...
```

| 字段            | 必需   | 最大大小   | 描述                                      |
| ---------------- | ------ | ---------- | ------------------------------------------ |
| `name`           | 是     | 64 个字符  | 仅小写字母数字和连字符                     |
| `description`    | 是     | 1024 个字符 | 技能的简短描述                             |
| `license`        | 否     | -          | 许可证 ID（例如 MIT、Apache-2.0）          |
| `compatibility`  | 否     | 500 个字符  | 兼容性说明                                 |
| `allowed-tools`  | 否     | -          | 允许的工具列表，以空格分隔                   |
| `metadata`       | 否     | -          | 额外的键值元数据                           |

### 输入前缀

Autohand 支持提示输入中的特殊前缀：

| 前缀 | 描述                           | 示例                            |
| ---- | ------------------------------ | -------------------------------- |
| `/`  | 斜杠命令                       | `/help`, `/model`, `/quit`       |
| `@`  | 文件提及（自动完成）           | `@src/index.ts`                 |
| `$`  | 技能提及（自动完成）           | `$frontend-design`, `$code-review` |
| `!`  | 直接运行终端命令               | `! git status`, `! ls -la`        |

**技能提及 (`$`)：**

- 在 `$` 后输入以查看自动完成的可用技能
- Tab 接受主要建议（例如 `$frontend-design`）
- 技能从 `~/.autohand/skills/` 和 `<项目>/.autohand/skills/` 发现
- 激活的技能作为当前会话的特殊指令添加到提示中
- 预览面板显示技能元数据（名称、描述、激活状态）

**Shell 命令 (`!`)：**

- 在当前工作目录中执行
- 输出直接显示在终端中
- 不进入 LLM
- 30 秒超时
- 执行后返回提示

### 斜杠命令

#### `/skills` — 包管理器

| 命令                            | 描述                   |
| ------------------------------- | ---------------------- |
| `/skills`                       | 列出所有可用技能       |
| `/skills use <名称>`            | 为当前会话激活技能     |
| `/skills deactivate <名称>`     | 停用技能               |
| `/skills info <名称>`           | 显示技能详细信息       |
| `/skills install`               | 浏览并从社区注册表安装 |
| `/skills install @<slug>`       | 通过 slug 安装社区技能 |
| `/skills search <查询>`         | 搜索社区技能注册表     |
| `/skills trending`              | 显示热门社区技能       |
| `/skills remove <slug>`         | 卸载社区技能           |
| `/skills new`                   | 交互式创建新技能       |
| `/skills feedback <slug> <1-5>` | 为社区技能评分         |

#### `/learn` — LLM 驱动的技能顾问

| 命令            | 描述                                         |
| --------------- | -------------------------------------------- |
| `/learn`        | 分析项目并推荐技能（快速扫描）               |
| `/learn deep`   | 深度扫描项目（读取源文件）以获得更精准的结果 |
| `/learn update` | 重新分析项目并重新生成过时的 LLM 生成技能    |

`/learn` 使用两阶段 LLM 流程：

1. **阶段 1 — 分析 + 排名 + 审计**：扫描项目结构，审计已安装技能的冗余/冲突，并按相关性（0-100）对社区技能进行排名。
2. **阶段 2 — 生成**（有条件的）：如果没有社区技能得分超过 60 分，则提议生成一个为您的项目定制的自定义技能。

### 自动技能生成（`--auto-skill`）

`--auto-skill` CLI 标志在没有交互式顾问流程的情况下生成技能：

```bash
autohand --auto-skill
```

这将：

1. 分析项目结构（package.json、requirements.txt 等）
2. 检测语言、框架和模式
3. 使用 LLM 生成 3 个相关技能
4. 将技能保存到 `<项目>/.autohand/skills/`

如需更精准的交互式体验，请在会话中使用 `/learn`。

---

## 完整示例

### JSON 格式 (`~/.autohand/config.json`)

```json
{
  "provider": "openrouter",
  "openrouter": {
    "apiKey": "sk-or-v1-your-key-here",
    "baseUrl": "https://openrouter.ai/api/v1",
    "model": "your-modelcard-id-here"
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
    "whitelist": ["run_command:npm *", "run_command:bun *"],
    "blacklist": ["run_command:rm -rf /"],
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
    "enableSessionSync": false,
    "companySecret": ""
  },
  "auth": {
    "token": "your-auth-token",
    "refreshToken": "your-refresh-token"
  },
  "communitySkills": {
    "registryUrl": "https://skills.autohand.ai",
    "cacheDuration": 3600,
    "autoUpdate": false
  },
  "share": {
    "enabled": true,
    "defaultVisibility": "private",
    "allowPublicLinks": false,
    "requireApproval": true
  },
  "sync": {
    "enabled": false,
    "autoSync": true,
    "syncInterval": 300,
    "conflictResolution": "ask"
  },
  "hooks": {
    "preCommand": "~/.autohand/hooks/pre-command.sh",
    "postCommand": "~/.autohand/hooks/post-command.sh",
    "onError": "~/.autohand/hooks/on-error.sh",
    "onComplete": "~/.autohand/hooks/on-complete.sh"
  },
  "mcp": {
    "servers": {}
  },
  "chrome": {
    "extensionId": "",
    "nativeMessaging": true,
    "autoLaunch": false,
    "preferredBrowser": "chrome"
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
  model: your-modelcard-id-here

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
  companySecret: ""

auth:
  token: your-auth-token
  refreshToken: your-refresh-token

communitySkills:
  registryUrl: https://skills.autohand.ai
  cacheDuration: 3600
  autoUpdate: false

share:
  enabled: true
  defaultVisibility: private
  allowPublicLinks: false
  requireApproval: true

sync:
  enabled: false
  autoSync: true
  syncInterval: 300
  conflictResolution: ask

hooks:
  preCommand: ~/.autohand/hooks/pre-command.sh
  postCommand: ~/.autohand/hooks/post-command.sh
  onError: ~/.autohand/hooks/on-error.sh
  onComplete: ~/.autohand/hooks/on-complete.sh

mcp:
  servers: {}

chrome:
  extensionId: ""
  nativeMessaging: true
  autoLaunch: false
  preferredBrowser: chrome

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

| 标志                       | 描述                                                                         |
| -------------------------- | ---------------------------------------------------------------------------- |
| `--model <model>`          | 覆盖模型                                                                     |
| `--path <path>`            | 覆盖工作区根目录                                                             |
| `--worktree [name]`        | 在隔离的 git worktree 中运行会话（可选 worktree/分支名称）                   |
| `--tmux`                   | 在专用 tmux 会话中启动（隐含 `--worktree`；不能与 `--no-worktree` 一起使用） |
| `--add-dir <path>`         | 添加额外目录到工作区范围（可多次使用）                                       |
| `--config <path>`          | 使用自定义配置文件                                                           |
| `--temperature <n>`        | 设置温度（0-1）                                                              |
| `--yes`                    | 自动确认提示                                                                 |
| `--dry-run`                | 预览而不执行                                                                 |
| `--unrestricted`           | 无批准提示                                                                   |
| `--restricted`             | 拒绝危险操作                                                                 |
| `--setup`                  | 运行设置向导以配置或重新配置 Autohand                                        |
| `--about`                  | 显示 Autohand 信息（版本、链接、贡献信息）                                   |
| `--sys-prompt <值>`        | 完全替换系统提示（内联字符串或文件路径）                                     |
| `--append-sys-prompt <值>` | 附加到系统提示（内联字符串或文件路径）                                       |
| `--auto-skill`             | 基于项目分析自动生成技能（交互式请参见 `/learn`）                            |

---

## 系统提示自定义

Autohand 允许您自定义 AI 代理使用的系统提示。这对于专业工作流程、自定义指令或与其他系统集成非常有用。

### CLI 标志

| 标志                       | 描述                   |
| -------------------------- | ---------------------- |
| `--sys-prompt <值>`        | 完全替换系统提示       |
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
