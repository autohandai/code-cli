# Autohand 設定參考

`~/.autohand/config.json`（或`.toml`/`.yaml`/`.yml`）中所有配置選項的完整參考。

> **提示：** 下面的大多數設定都可以使用 `/settings` 命令以互動方式更改，而無需手動編輯檔案。

本地化參考：

- [English](./config-reference.md)
- [日本語](./config-reference_ja.md)
- [简体中文](./config-reference_zh.md)
- [繁體中文](./config-reference_zh-tw.md)
- [한국어](./config-reference_ko.md)
- [Deutsch](./config-reference_de.md)
- [Español](./config-reference_es.md)
- [Français](./config-reference_fr.md)
- [Italiano](./config-reference_it.md)
- [Polski](./config-reference_pl.md)
- [Русский](./config-reference_ru.md)
- [Português (Brasil)](./config-reference_ptBR.md)
- [Türkçe](./config-reference_tr.md)
- [Čeština](./config-reference_cs.md)
- [Magyar](./config-reference_hu.md)
- [हिन्दी](./config-reference_hi.md)
- [Bahasa Indonesia](./config-reference_id.md)

## 目錄

- [設定檔位置](#configuration-file-location)
- [環境變數](#environment-variables)
- [裸模式](#bare-mode)
- [提供者設定](#provider-settings)
- [工作區設定](#workspace-settings)
- [使用者介面設定](#ui-settings)
- [代理設定](#agent-settings)
- [權限設定](#permissions-settings)
- [補丁模式](#patch-mode)
- [網路設定](#network-settings)
- [遙測設定](#telemetry-settings)
- [外部代理](#external-agents)
- [技能係統](#skills-system)
- [API設定](#api-settings)
- [驗證設定](#authentication-settings)
- [社區技能設定](#community-skills-settings)
- [共享設定](#share-settings)
- [設定同步](#settings-sync)
- [掛鉤設定](#hooks-settings)
- [MCP 設定](#mcp-settings)
- [Chrome 擴充程式設定](#chrome-extension-settings)
- [完整範例](#complete-example)

---

## 設定檔位置

Autohand 依下列順序尋找配置：

1. `AUTOHAND_CONFIG`環境變數（自訂路徑）
2.__AH_代碼_6__
3.`~/.autohand/config.yaml`
4. `~/.autohand/config.yml`
5. `~/.autohand/config.json`（預設）

您也可以覆蓋基本目錄：
```bash
export AUTOHAND_HOME=/custom/path  # Changes ~/.autohand to /custom/path
```
---

## 環境變數

|變數|描述 |範例|
| -------------------------------------- | ------------------------------------------------ |-------------------------------- |
| `AUTOHAND_HOME` |所有 Autohand 資料的基底目錄 | `/custom/path` |
| `AUTOHAND_CONFIG` |自訂設定檔路徑| `/path/to/config.toml` |
| `AUTOHAND_API_URL` | API端點（覆蓋配置）| `https://api.autohand.ai` |
| `AUTOHAND_SECRET` |公司/團隊密碼金庫 | `sk-xxx` |
| `AUTOHAND_PERMISSION_CALLBACK_URL` |權限回呼的 URL（實驗性）| `http://localhost:3000/callback` |
| `AUTOHAND_PERMISSION_CALLBACK_TIMEOUT` |權限回呼逾時（以毫秒為單位） | `5000` |
| `AUTOHAND_NON_INTERACTIVE` |以非互動模式運作 | `1` |
| `AUTOHAND_YES` |自動確認所有提示 | `1` |
| `AUTOHAND_NO_BANNER` |停用啟動橫幅 | `1` |
| `AUTOHAND_STREAM_TOOL_OUTPUT` |即時串流工具輸出 | `1` |
| `AUTOHAND_DEBUG` |啟用偵錯日誌記錄 | `1` |
| `AUTOHAND_THINKING_LEVEL` |設定推理深度等級 | `normal` |
| `AUTOHAND_CLIENT_NAME` |客戶/編輯識別碼（由 ACP 擴充設定） | `zed` |
| `AUTOHAND_CLIENT_VERSION` |客戶端版本（由 ACP 擴充設定） | `0.169.0` |
| `AUTOHAND_CODE` |環境偵測標誌（自動設定）| `1` |
| `AUTOHAND_CODE_SIMPLE` |啟用裸模式而不傳遞 `--bare` | `1` |

### 思維水平

`AUTOHAND_THINKING_LEVEL` 環境變數控制模型所使用的推理深度：

|價值|描述 |
| ---------- | ---------------------------------------------------------------------------------- |
| `none` |沒有明顯推理的直接回應 |
| `normal` |標準推理深度（預設）|
| `extended` |複雜任務深度推理，展現更細緻的思考過程 |

這通常由 ACP 用戶端擴充功能（如 Zed）透過配置下拉清單進行設定。
```bash
# Example: Use extended thinking for complex tasks
AUTOHAND_THINKING_LEVEL=extended autohand --prompt "refactor this module"
```
---

## 裸模式

裸模式僅使用明確請求的上下文和執行時間整合來啟動 Autohand。透過以下任一方式啟用它：
```bash
autohand --bare
AUTOHAND_CODE_SIMPLE=1 autohand
```
當傳遞 `--bare` 時，Autohand 也會為正在執行的程序設定 `AUTOHAND_CODE_SIMPLE=1`。

裸模式禁用自動啟動和互動式整合：

- 掛鉤和掛鉤通知
-LSP啟動
- 外掛同步、外掛自動載入和元工具自動加載
- 歸因、遙測、會話同步、自動報告和後台 ping
- 自動記憶體/會話引導上下文
- 後台提示建議、更新檢查、功能標誌取得和模型元資料預取
- 鑰匙圈和瀏覽器 OAuth 驗證回退
- 自動 `AGENTS.md` 和提供者指令發現
- 所有斜線指令，包含在提示字元中鍵入的裸 `/`

斜杠形狀的絕對檔案路徑，例如`/Users/alex/project/file.ts`，仍然被視為正常的提示文字。命令形斜線輸入，例如 `/help`、`/model` 或 `/mcp`，會列印 `Slash commands are disabled in bare mode.` 且不執行。

裸模式下的身份驗證僅是明確的。 Autohand 先讀取 `AUTOHAND_API_KEY`，然後讀取 `auth.apiKeyHelper`（如果已設定）。它不會讀取鑰匙串憑證或啟動 OAuth/瀏覽器登入。第三方提供者繼續使用其提供者特定的 API 金鑰和配置。

這些顯式輸入在裸模式下仍然可用：

|輸入|描述 |
| -------------------------------------- | ------------------------------------------------------------------------------------ |
| `--system-prompt <value>` |以內嵌文字或類似路徑的值取代系統提示字元 |
| `--system-prompt-file <path>` |用檔案內容取代系統提示字元 |
| `--append-system-prompt <value>` |將內嵌文字或類似路徑的值附加到系統提示字元 |
| `--append-system-prompt-file <path>` |將檔案內容附加到系統提示符號 |
| `--add-dir <path...>` |將明確目錄新增至工作區範圍 |
| `--mcp-config <path>` |載入明確 MCP 設定檔 |
| `--settings` |直接從 CLI 標誌開啟設定 |
| `--config <path>` |使用明確 Autohand 設定檔 |
| `--agents <json\|path>` |載入明確內嵌代理 JSON 或明確代理目錄 |
| `--plugin-dir <path>` |載入明確插件/元工具目錄 |

---

## 提供者設置

### `provider`

使用活躍的法學碩士提供者。

|價值|描述 |
| -------------- | ---------------------------- |
| `"openrouter"` | OpenRouter API（預設）|
| `"ollama"` |本地 Ollama 實例 |
| `"llamacpp"` |本地 llama.cpp 伺服器 |
| `"openai"` |直接OpenAI API |
| `"mlx"` | Apple Silicon 上的 MLX（本地）|
| `"llmgateway"` | LLM網關統一API |
| `"deepseek"` | DeepSeek API |
| `"zai"` | Z.ai GLM API |
| `"sakana"` | Sakana.AI 河豚 API |
| `"bedrock"` | AWS 基岩 |
| `"custom:<id>"` |來自 `customProviders` 的使用者定義 OpenAI 相容提供者 |

### `openrouter`

OpenRouter 提供者設定。
```json
{
  "openrouter": {
    "apiKey": "sk-or-v1-xxx",
    "baseUrl": "https://openrouter.ai/api/v1",
    "model": "your-modelcard-id-here",
    "contextWindow": 262144
  }
}
```
|領域 |類型 |必填|預設 |說明 |
| ---------------- | ------ | -------- | ------------------------------------------ | --------------------------------------------------------------------------- |
| `apiKey` |字串|是的 | - |您的 OpenRouter API 金鑰 |
| `baseUrl` |字串|沒有 | `https://openrouter.ai/api/v1` | API端點|
| `model` |字串|是的 | - |型號識別碼（例如 `your-modelcard-id-here`）|
| `contextWindow` |數量 |沒有 |汽車 |精確模型上下文視窗。 Autohand 在已知時從 OpenRouter 填入此值。 |

### `zai`

Z.ai 提供者配置。
```json
{
  "zai": {
    "apiKey": "your-zai-api-key",
    "baseUrl": "https://api.z.ai/api/paas/v4",
    "model": "glm-5.2",
    "contextWindow": 1000000
  }
}
```
|領域 |類型 |必填|預設 |說明 |
| ---------------- | ------ | -------- | ------------------------------------------ |-------------------------------------------------------------------------------- |
| `apiKey` |字串|是的 | - |您的 Z.ai API 金鑰 |
| `baseUrl` |字串|沒有 | `https://api.z.ai/api/paas/v4` | API端點|
| `model` |字串|是的 | `glm-5.2` |型號標識符，例如 `glm-5.2`、`glm-5.1` 或 `glm-4.5` |
| `contextWindow` |數量 |沒有 |汽車 |精確模型上下文視窗。 Autohand 推論 GLM-5.2 為 1M，GLM-5.1 為 200K。 |

### `sakana`

Sakana.AI 提供者配置。該 API 與 OpenAI 相容，並使用 `https://api.sakana.ai/v1` 作為其基本 URL。
```json
{
  "sakana": {
    "apiKey": "your-sakana-api-key",
    "baseUrl": "https://api.sakana.ai/v1",
    "model": "fugu",
    "contextWindow": 1000000
  }
}
```
|領域 |類型 |必填|預設 |說明 |
| ---------------- | ------ | -------- | -------------------------------------- | ------------------------------------------------------------------ |
| `apiKey` |字串|是的 | - |您的 Sakana API 金鑰 |
| `baseUrl` |字串|沒有 | `https://api.sakana.ai/v1` | API端點|
| `model` |字符串|是的 | `fugu` |型号标识符，例如 `fugu` 或 `fugu-ultra` |
| `contextWindow` |數量 |沒有 |汽車 |精確模型上下文視窗。 Autohand 推斷 Fugu 型號為 1M。   |

### `customProviders`

自訂提供者允許使用者帶來與 OpenAI 相容的端點，而無需更改程式碼或新的捆綁提供者。在 `customProviders` 下新增提供程序，然後使用 `provider: "custom:<id>"` 選擇它。 `/model` 和 **新提供者...** 提供相同的流程。在設定過程中，Autohand 在儲存提供者之前透過 OpenAI 相容的 `/models` 端點驗證基本 URL、驗證和所選模型。
```json
{
  "provider": "custom:acme",
  "customProviders": {
    "acme": {
      "id": "acme",
      "displayName": "Acme AI",
      "apiFormat": "openai-compatible",
      "baseUrl": "https://api.acme.example/v1",
      "apiKey": "acme-api-key",
      "apiKeyRequired": true,
      "model": "acme-code-1",
      "contextWindow": 256000,
      "reasoningEffort": "high",
      "models": [
        {
          "id": "acme-code-1",
          "label": "Acme Code 1",
          "contextWindow": 256000,
          "reasoningEffort": "high"
        }
      ]
    }
  }
}
```
對於不需要驗證的本機 OpenAI 相容伺服器，請將 `apiKeyRequired` 設定為 `false` 並省略 `apiKey`。

|領域 |類型 |必填|預設 |說明 |
| ----------------- | -------- | -------- | -------- | ----------- |
| `id` |字串|是的 | - |穩定的提供者 ID。它必須與物件鍵相符並選擇為 `custom:<id>`。 |
| `displayName` |字串|是的 | - | `/model` 和提供者設定中顯示的名稱。 |
| `apiFormat` |字串|是的 | - |必須是 `openai-compatible`。 |
| `baseUrl` |字串|是的 | - |端點根，例如 `https://api.example.com/v1`。 Autohand 驗證 `/models` 並呼叫 `/chat/completions`。 |
| `apiKey` |字串|有條件| - |託管端點的承載令牌。當 `apiKeyRequired` 為 true 時需要。 |
| `apiKeyRequired` |布林 |沒有 | `true` |對於本地或已驗證的網關設定 false。 |
| `model` |字串|是的 | - |活動型號 ID。 |
| `contextWindow` |數量 |沒有 |汽車 |代幣預算、狀態、遙測和同步元資料的精確上下文視窗。 |
| `reasoningEffort` |字串|沒有 | - |可選 `none`、`low`、`medium`、`high` 或 `xhigh`。對於自訂 OpenAI 相容請求，以 `reasoning_effort` 形式傳送。 |
| `models` |陣列|沒有 | - |帶有每個模型上下文和推理元資料的可選模型選擇器條目。 |

### `ollama`

Ollama 提供者配置。
```json
{
  "ollama": {
    "baseUrl": "http://localhost:11434",
    "port": 11434,
    "model": "llama3.2"
  }
}
```
|領域|類型 |必填|預設 |描述 |
| ---------| ------ | -------- | ------------------------ | ------------------------------------------------------ |
| `baseUrl` |字串|沒有 | `http://localhost:11434` |奧拉瑪伺服器網址 |
| `port` |數量 |沒有 | `11434` |伺服器連接埠（替代baseUrl） |
| `model` |字串|是的 | - |型號名稱（例如 `llama3.2`、`codellama`）|

### `llamacpp`

llama.cpp 伺服器配置。
```json
{
  "llamacpp": {
    "baseUrl": "http://localhost:8080",
    "port": 8080,
    "model": "default"
  }
}
```
|領域|類型 |必填|預設|描述 |
| ---------| ------ | -------- | ----------------------- | -------------------- |
| `baseUrl` |字串|沒有 | `http://localhost:8080` | llama.cpp 伺服器 URL |
| `port` |數量 |沒有 | `8080` |伺服器連接埠|
| `model` |字串|是的 | - |型號識別碼|

### `openai`

OpenAI API 配置。
```json
{
  "openai": {
    "authMode": "api-key",
    "apiKey": "sk-xxx",
    "baseUrl": "https://api.openai.com/v1",
    "model": "gpt-5.4"
  }
}
```
OpenAI 也可以透過 Autohand 的內建 OpenAI 登入流程使用您的 ChatGPT 訂閱：
```json
{
  "openai": {
    "authMode": "chatgpt",
    "baseUrl": "https://api.openai.com/v1",
    "contextWindow": 1050000,
    "model": "gpt-5.4",
    "chatgptAuth": {
      "accessToken": "...",
      "refreshToken": "...",
      "accountId": "..."
    }
  }
}
```
|領域 |類型 |必填 |預設 |說明 |
| ---------------- | ------ | ---------------------- | ------------------------ || ------------------------------------------------------------------------------------ |
| `authMode` |字串|沒有 | `api-key` |驗證模式：`api-key` 或 `chatgpt` |
| `apiKey` |字串|是，適用於 `api-key` 模式 | - | OpenAI API 金鑰 |
| `baseUrl` |字串|沒有 | `https://api.openai.com/v1` | API端點|
| `model` |字串|是的 | - |型號名稱（例如 `gpt-5.4`、`gpt-5.4-mini`）|
| `contextWindow` |數量 |沒有 |汽車 |精確模型上下文視窗。設定此值以覆蓋過時的本地假設。 |
| `chatgptAuth` |物件|是的 `chatgpt` 模式 | - |儲存的 ChatGPT/Codex 驗證令牌和帳戶 ID |

### `mlx`

Apple Silicon Mac 的 MLX 供應商（本地推理）。
```json
{
  "mlx": {
    "baseUrl": "http://localhost:8080",
    "port": 8080,
    "model": "mlx-community/Llama-3.2-3B-Instruct-4bit"
  }
}
```
|領域|類型 |必填|預設|描述 |
| ---------| ------ | -------- | ----------------------- | -------------------- |
| `baseUrl` |字串|沒有 | `http://localhost:8080` | MLX 伺服器 URL |
| `port` |數量 |沒有 | `8080` |伺服器連接埠|
| `model` |字串|是的 | - | MLX 型號識別碼 |

### `llmgateway`

LLM網關統一API設定。透過單一 API 提供對多個 LLM 提供者的存取。
```json
{
  "llmgateway": {
    "apiKey": "your-llmgateway-api-key",
    "baseUrl": "https://api.llmgateway.io/v1",
    "model": "gpt-4o"
  }
}
```
|領域|類型 |必填|預設 |描述 |
| ---------| ------ | -------- | ------------------------------------------ |---------------------------------------------------------------- |
| `apiKey` |字串|是的 | - | LLM 閘道 API 金鑰 |
| `baseUrl` |字串|沒有 | `https://api.llmgateway.io/v1` | API端點|
| `model` |字串|是的 | - |型號名稱（例如 `gpt-4o`、`claude-3-5-sonnet-20241022`）|

**取得 API 金鑰：**
存取 [llmgateway.io/dashboard](https://llmgateway.io/dashboard) 建立帳戶並取得 API 金鑰。

**支援的型號：**
LLM Gateway 支援來自多個提供者的模型，包括：

- OpenAI：`gpt-4o`、`gpt-4o-mini`、`gpt-4-turbo`
`claude-3-5-haiku-20241022`
- 谷歌：`gemini-1.5-pro`、`gemini-1.5-flash`

### `deepseek`

DeepSeek 提供程式配置。該 API 與 OpenAI 相容，並使用 `https://api.deepseek.com` 作為其基本 URL。
```json
{
  "deepseek": {
    "apiKey": "your-deepseek-api-key",
    "baseUrl": "https://api.deepseek.com",
    "model": "deepseek-v4-flash"
  }
}
```
|領域|類型 |必填|預設 |描述 |
| ---------| ------ | -------- | -------------------------- | -------------------------------------------------------------------------- |
| `apiKey` |字串|是的 | - | DeepSeek API 金鑰 |
| `baseUrl` |字串|沒有 | `https://api.deepseek.com` | API端點|
| `model` |字串|是的 | - |型號名稱，例如 `deepseek-v4-flash` 或 `deepseek-v4-pro` |

### `bedrock`

AWS Bedrock 供應商配置。 `converse` 是預設模式並使用 AWS 開發工具包憑證鏈。 OpenAI 相容模式使用 Bedrock API 金鑰和 Bedrock OpenAI 相容端點。
```json
{
  "bedrock": {
    "apiMode": "converse",
    "authMode": "aws-credentials",
    "profile": "enterprise-prod",
    "region": "us-east-1",
    "model": "anthropic.claude-3-5-sonnet-20241022-v2:0"
  }
}
```

```yaml
provider: bedrock
bedrock:
  apiMode: openai-chat
  authMode: bedrock-api-key
  apiKey: bedrock-api-key
  region: us-east-1
  model: openai.gpt-oss-120b-1:0
```

```toml
provider = "bedrock"

[bedrock]
apiMode = "openai-responses"
authMode = "bedrock-api-key"
apiKey = "bedrock-api-key"
region = "us-west-2"
endpoint = "https://vpce-abc123.bedrock-runtime.us-west-2.vpce.amazonaws.com/openai/v1"
model = "arn:aws:bedrock:us-west-2:123456789012:inference-profile/us.anthropic.claude-3-5-sonnet-20241022-v2:0"
```
|領域 |類型 |必填|預設 |說明 |
| ---------- | ------ | -------- | -------- | ----------- |
| `model` |字串|是的 | - |基岩模型 ID、推理配置檔案 ID 或 ARN |
| `region` |字串|是的 | setup | 中的 `AWS_REGION`，然後 `AWS_DEFAULT_REGION`，然後 `us-east-1` AWS 區域 |
| `apiMode` |字串|沒有 | `converse` | `converse`、`openai-chat` 或 `openai-responses` |
| `authMode` |字串|沒有 | `aws-credentials` 表示 `converse`，`bedrock-api-key` 表示 OpenAI 相容模式 |認證方式|
| `profile` |字串|沒有 | - |用於憑證鏈驗證的可選 AWS 設定檔 |
| `endpoint` |字串|沒有 |源自模式和區域 |自訂/私有基岩端點 |
| `apiKey` |字串|是，適用於 OpenAI 相容模式 | - |基岩 API 金鑰。請勿使用 OpenAI API 金鑰。 |

執行 `aws configure sso` 或設定 `AWS_PROFILE=enterprise-prod autohand` 進行基於設定檔的 AWS 驗證。 AWS 開發工具包支援 IAM 角色、容器和實例元資料憑證。使用模型之前在 AWS 控制台中啟用模型存取。

---

## 工作區設置
```json
{
  "workspace": {
    "defaultRoot": "/path/to/projects",
    "allowDangerousOps": false
  }
}
```
|領域|類型 |預設 |描述 |
| ------------------- | -------- | ----------------- |------------------------------------------------ |
| `defaultRoot` |字串|目前目錄 |未指定時的預設工作區 |
| `allowDangerousOps` |布林 | `false` |允許未經確認的破壞性操作 |

### 工作場所安全

Autohand 自動阻止危險目錄中的操作以防止意外損壞：

- **檔案系統根**（`/`、`C:\`、`D:\` 等）
- **主目錄**（`~`、`/Users/<user>`、`/home/<user>`、`C:\Users\<user>`）
- **系統目錄**（`/etc`、`/var`、`/System`、`C:\Windows` 等）
- **WSL Windows 安裝**（`/mnt/c`、`/mnt/c/Users/<user>`）

無法繞過此檢查。如果您嘗試在危險目錄中執行 autohand，您將看到錯誤，並且必須指定一個安全的專案目錄。
```bash
# This will be blocked
cd ~ && autohand
# Error: Unsafe Workspace Directory

# This works
cd ~/projects/my-app && autohand
```
有關完整詳細信息，請參閱[工作空間安全性](./workspace-safety.md)。

---

## 使用者介面設定
```json
{
  "ui": {
    "theme": "dark",
    "customThemes": {
      "company": {
        "colors": {
          "accent": "#7c3aed",
          "success": "#22c55e"
        }
      }
    },
    "autoConfirm": false,
    "readFileCharLimit": 300,
    "silentToolOutput": false,
    "activityVerbs": ["Compiling", "Parsing", "Reviewing"],
    "activityVerbsEnabled": true,
    "activitySymbol": "✳",
    "statusLine": {
      "showProviderModel": true,
      "showContext": true,
      "showCommandHint": true,
      "showPullRequest": true,
      "showSessionLines": false,
      "showQueue": true,
      "showActiveStatus": true,
      "showActiveMetrics": true,
      "showCancelHint": true
    },
    "showCompletionNotification": true,
    "showThinking": true,
    "terminalBell": true,
    "checkForUpdates": true,
    "updateCheckInterval": 24
  }
}
```
|領域 |類型 |預設 |描述 |
| ---------------------------- | ------ | -------- |---------------------------------------------------------------------------------------------------------------- |
| `theme` |字串| `"dark"` |終端輸出的顏色主題。內建函數包括 `dark`、`light`、`dracula`、`sandy`、`tui`、`github-dark`、`cappadocia`、`rio` 和 `australia`。舊版 `turkey` 和 `brazil` 值仍會作為別名載入。 |
| `customThemes` |物件| `{}` |按主題名稱鍵入的內聯自訂主題定義。將 `theme` 設定為同一鍵以使用一個。   |
| `autoConfirm` |布林 | `false` |跳過確認提示以確保安全操作 |
| `readFileCharLimit` |數量 | `300` |從讀取/查找工具輸出中顯示的最大字元數（完整內容仍發送到模型）|
| `silentToolOutput` |布林 | `false` |在終端機中隱藏工具輸出區塊，同時仍保留模型/會話的工具結果 |
| `activityVerbs` |字串或字串[] |內建泳池|工作指示器的自訂活動動詞或動詞池，呈現為 `Verb...` |
| `activityVerbsEnabled` |布林 | `true` |在代理工作時顯示輪流活動動詞，如 `Compiling...` |
| `activitySymbol` |字串| `"✳"` |活動指示器輸出中活動動詞之前顯示的符號 |
| `statusLine.showProviderModel` |布林 | `true` |在 Composer 狀態列中顯示活動的提供者與模型 |
| `statusLine.showContext` |布林 | `true` |在作曲家狀態列中顯示上下文百分比 |
| `statusLine.showCommandHint` |布林 | `true` |在作曲家狀態列中顯示命令、提及、技能和終端輸入提示 |
| `statusLine.showPullRequest` |布林 | `true` |顯示關聯的拉取請求編號，或在沒有關聯 PR 時顯示 `PR #123` |
| `statusLine.showSessionLines` |布林 | `false` |顯示目前會話期間新增和刪除的行 |
| `statusLine.showQueue` |布林 | `true` |在狀態列中顯示排隊的請求計數 |
| `statusLine.showActiveStatus` |布林 | `true` |代理程式工作時顯示活動輪次狀態文字 |
| `statusLine.showActiveMetrics` |布林 | `true` |顯示代理程式工作時經過的時間和令牌指標 |
| `statusLine.showCancelHint` |布林 | `true` |代理程式工作時顯示 Esc 取消提示 |
| `completionReportEnabled` |布林 | `true` |要求模型在完成的操作輪流後包含一份簡明的完成報告 |
| `showCompletionNotification` |布林 | `true` |任務完成時顯示系統通知 |
| `showThinking` |布林 | `true` |顯示LLM的推理/思考過程|
| `terminalBell` |布林 | `true` |任務完成時敲響終端鈴聲（在終端標籤/停靠列上顯示徽章）|
| `checkForUpdates` |布林 | `true` |啟動時檢查 CLI 更新 |
| `updateCheckInterval` |數量 | `24` |更新檢查之間的小時數（使用間隔內的快取結果）|

自訂主題可以覆蓋任何語義顏色標記。缺失的標記是從黑暗主題繼承的：
```json
{
  "ui": {
    "theme": "company",
    "customThemes": {
      "company": {
        "vars": {
          "brand": "#7c3aed",
          "brandSoft": "#a78bfa"
        },
        "colors": {
          "accent": "brand",
          "borderAccent": "brandSoft",
          "mdHeading": "brand"
        }
      }
    }
  }
}
```
注意：`readFileCharLimit` 和 `silentToolOutput` 只影響終端顯示。完整內容仍會發送到模型並儲存在工具訊息中。

您可以切換靜默工具輸出而無需編輯檔案：
```bash
autohand config set silent_tool_output true
autohand config set silent_tool_output false
```
您可以切換旋轉活動動詞而無需編輯文件：
```bash
autohand config set verbs activity true
autohand config set verbs activity false
```
當您需要固定狀態標籤或特定於項目的小型輪換時，可以自訂設定檔中的動詞：
```json
{
  "ui": {
    "activityVerbs": "Compiling"
  }
}
```

```json
{
  "ui": {
    "activityVerbs": ["Indexing", "Reviewing", "Testing"],
    "activitySymbol": ">"
  }
}
```
`activityVerbs` 接受單一字串或非空字串陣列。當 `activityVerbsEnabled` 為 `false` 時，Autohand 回退到 `Working...`，而不是透過自訂或內建動詞進行輪換。

您可以切換完成報告，包括結構化的 `SITREP` 提示，而無需編輯文件：
```bash
autohand config set sitrep true
autohand config set sitrep false
```
### 航廈鈴聲

啟用 `terminalBell` 時（預設），任務完成時 Autohand 會響起終端鈴聲 (`\x07`)。這會觸發：

- **終端選項卡上的徽章** - 顯示工作已完成的視覺指示器
- **Dock 圖示彈跳** - 當終端機處於背景時引起您的注意 (macOS)
- **聲音** - 如果您的終端設定中啟用了終端聲音

終端特定設定：

- **macOS 終端機**：首選項 > 設定檔 > 進階 > 響鈴（視覺/聽覺）
- **iTerm2**：首選項 > 設定檔 > 終端機 > 通知
- **VS Code 終端機**：設定 > 終端機 > 整合：啟用響鈴

禁用：
```json
{
  "ui": {
    "terminalBell": false
  }
}
```
### 墨跡渲染器

Autohand 預設使用 Ink 7 + React 19 渲染器用於互動式終端。遺留的 `ui.useInkRenderer` 設定欄位被忽略，因此舊的設定檔無法強制使用普通終端編輯器。墨水提供：

- **無閃爍輸出**：所有 UI 更新都透過 React 協調進行批次處理
- **工作佇列功能**：在代理程式工作時鍵入指令
- **更好的輸入處理**：readline 處理程序之間沒有衝突
- **可組合 UI**：未來進階 UI 功能的基礎

終端相容性的緊急回退：
```bash
AUTOHAND_LEGACY_UI=1 autohand
```
注意：此功能是實驗性的，可能有邊緣情況。預設的基於 ora 的 UI 保持穩定且功能齊全。

### 更新檢查

啟用 `checkForUpdates` 時（預設），Autohand 在啟動時檢查新版本：
```
> Autohand v0.6.8 (abc1234) ✓ Up to date
```
如果有可用更新：
```
> Autohand v0.6.7 (abc1234) ⬆ Update available: v0.6.8
  ↳ Run: curl -fsSL https://autohand.ai/install.sh | sh
```
工作原理：

- 從 GitHub API 取得最新版本
- 快取結果為 `~/.autohand/version-check.json`
- 每 `updateCheckInterval` 小時僅檢查一次（預設值：24）
- 非阻塞：即使檢查失敗啟動也會繼續

禁用：
```json
{
  "ui": {
    "checkForUpdates": false
  }
}
```
或透過環境變數：
```bash
export AUTOHAND_SKIP_UPDATE_CHECK=1
```
---

## 代理設定

控制代理行為和迭代限制。
```json
{
  "agent": {
    "maxIterations": 100,
    "enableRequestQueue": true,
    "toolSelectionCache": true,
    "autoMemory": true,
    "idleLogoutEnabled": true,
    "debug": false
  }
}
```
|領域|類型 |預設 |描述 |
| -------------------- | -------- | -------- | ------------------------------------------------------------------------------------------ |
| `maxIterations` |數量 | `100` |停止前每個使用者請求的最大工具迭代次數
| `enableRequestQueue` |布林 | `true` |允許使用者在代理程式工作時鍵入請求並對其進行排隊 |
| `toolSelectionCache` |布林 | `true` |快取本地每轉工具模式選擇以取得等效的工具選擇輸入 |
| `autoMemory` |布林 | `true` |成功互動後擷取並儲存持久的使用者/專案記憶 |
| `idleLogoutEnabled` |布林 | `true` |空閒逾時後登出經過驗證的互動式會話 |
| `debug` |布林 | `false` |啟用詳細偵錯輸出（將代理內部狀態記錄到 stderr）|

### 工具架構選擇

Autohand 不會在每個 LLM 請求上傳送每個完整的工具架構。系統提示包含一個緊湊的工具功能目錄，每個請求僅公開選自以下內容的一小組特定模式：

- 核心發現工具，如 `tool_search`、`read_file`、`fff_find` 和 `fff_grep`
- 用於編輯、驗證、git、瀏覽器、網路、依賴項或專案追蹤工作的意圖匹配工具
- 透過最近的 `tool_search` 呼叫請求的工具或透過名稱明確提及的工具

這避免了在知道用戶意圖之前發送所有工具模式的大量前期上下文成本。 `toolSelectionCache` 僅控制等效輪次的本機選擇器快取；它不執行使用者前 LLM 預熱，也不強制使用大型快取提示前綴。

若要停用本機選擇器快取：
```json
{
  "agent": {
    "toolSelectionCache": false
  }
}
```
要在等待工作時使經過身份驗證的長時間運行的代理會話保持活動狀態：
```json
{
  "agent": {
    "idleLogoutEnabled": false
  }
}
```
對於單一進程，請使用 `autohand --no-idle-logout` 或設定 `AUTOHAND_NO_IDLE_LOGOUT=1`。

### 偵錯模式

啟用偵錯模式以查看代理內部狀態的詳細日誌記錄（反應循環迭代、提示建置、會話詳細資訊）。輸出轉到 stderr 以避免干擾正常輸出。

啟用調試模式的三種方法（按優先順序排列）：

1. **CLI 標誌**：`autohand -d` 或 `autohand --debug`
2. **環境變數**：`AUTOHAND_DEBUG=1`
3. **設定檔**：設定`agent.debug: true`

### 請求隊列

啟用 `enableRequestQueue` 後，您可以在代理程式處理先前的請求時繼續鍵入訊息。噹噹前任務完成時，您的輸入將自動排隊並處理。

- 輸入您的訊息並按 Enter 將其新增至佇列中
- 狀態列顯示有多少請求正在排隊
- 請求以 FIFO（先進先出）順序處理
- 最大佇列大小為 10 個請求

---

## 權限設定

對工具權限的細粒度控制。
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

|價值|描述 |
| ---------------- | ---------------------------------------------------------------- |
| `"interactive"` |危险操作提示批准（默认）|
| `"unrestricted"` |沒有提示，允許一切 |
| `"restricted"` |拒絕一切危險操作|

### `whitelist`

無需批准的一系列工具模式。
```json
["run_command:npm *", "run_command:bun test"]
```
### `blacklist`

始終被阻止的一系列工具圖案。
```json
["run_command:rm -rf /", "run_command:sudo *"]
```
### `rules`

細粒度的權限規則。

|領域|類型 |描述 |
| ---------| ---------| ------------------------------------------- | ---------- | -------------- |
| `tool` |字串|要符合的工具名稱 |
| `pattern` |字串|用於匹配參數的可選模式 |
| `action` | `"allow"` | `"deny"` | `"prompt"` |採取的行動|

### `rememberSession`

|類型 |預設 |描述 |
| -------- | -------- | ------------------------------------------- |
|布爾 | `true` |記住會議的批准決定 |

### 本機專案權限

每個項目都可以有自己的權限設置，這些設置會覆蓋全域配置。這些儲存在專案根目錄的 `.autohand/settings.local.json` 中。

當您批准文件操作（編輯、寫入、刪除）時，它會自動儲存到此文件中，因此不會再次要求您在此項目中進行相同的操作。
```json
{
  "version": 1,
  "permissions": {
    "whitelist": [
      "apply_patch:src/components/Button.tsx",
      "write_file:package.json",
      "run_command:bun test"
    ]
  }
}
```
**它是如何工作的：**

- 當您核准操作時，它會儲存到 `.autohand/settings.local.json`
- 下次相同的操作將會自動被批准
- 本地項目設定與全域設定合併（本地優先）
- 將 `.autohand/settings.local.json` 新增至 `.gitignore` 以維持個人設定的隱私

**圖案格式：**

- `tool_name:path` - 用於檔案操作（例如，`apply_patch:src/file.ts`）
- `tool_name:command args` - 用於指令（例如 `run_command:npm test`）

### 查看權限

您可以透過兩種方式查看目前的權限設定：

**CLI 標誌（非互動式）：**
```bash
autohand --permissions
```
這顯示：

- 目前權限模式（互動、無限制、受限制）
- 工作空間和設定檔路徑
- 所有核准的模式（白名單）
- 所有被拒絕的模式（黑名單）
- 匯總統計數據

**交互命令：**
```
/permissions
```
在互動模式下，`/permissions` 指令提供相同的資訊以及選項：

- 從白名單中刪除項目
- 從黑名單中刪除項目
- 清除所有已儲存的權限

---

## 補丁模式

補丁模式可讓您產生可共享的 git 相容補丁，而無需修改工作區檔案。這對於：

- 在應用更改之前進行程式碼審查
- 與團隊成員分享人工智慧生成的變更
- 建立可重複的變更集
- 需要捕獲更改而不應用它們的 CI/CD 管道

### 用法
```bash
# Generate patch to stdout
autohand --prompt "add user authentication" --patch

# Save to file
autohand --prompt "add user authentication" --patch --output auth.patch

# Pipe to file (alternative)
autohand --prompt "refactor api handlers" --patch > refactor.patch
```
### 行為

當指定 `--patch` 時：

- **自動確認**：自動接受所有確認（隱含`--yes`）
- **無提示**：不顯示核准提示（隱含 `--unrestricted`）
- **僅預覽**：捕獲更改但不寫入磁碟
- **安全強制**：黑名單作業（`.env`、SSH 金鑰、危險指令）仍被阻止

### 應用補丁

收件者可以使用標準 git 指令套用補丁：
```bash
# Check what would be applied (dry-run)
git apply --check changes.patch

# Apply the patch
git apply changes.patch

# Apply with 3-way merge (handles conflicts better)
git apply -3 changes.patch

# Apply and stage changes
git apply --index changes.patch

# Reverse a patch
git apply -R changes.patch
```
### 補丁格式

產生的補丁遵循git統一的diff格式：
```diff
diff --git a/src/auth.ts b/src/auth.ts
new file mode 100644
--- /dev/null
+++ b/src/auth.ts
@@ -0,0 +1,15 @@
+export function authenticate(user: string, password: string) {
+  // Implementation here
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
### 退出程式碼

|程式碼|意義|
| ---- | --------------------------------------------------- |
| `0` |成功，補丁產生 |
| `1` |錯誤（缺少 `--prompt`、權限被拒絕等）|

### 與其他標誌組合
```bash
# Use specific model
autohand --prompt "optimize queries" --patch --model gpt-4o

# Specify workspace
autohand --prompt "add tests" --patch --path ./my-project

# Use custom config
autohand --prompt "refactor" --patch --config ~/.autohand/work.json
```
### 團隊工作流程範例
```bash
# Developer A: Generate patch for a feature
autohand --prompt "implement user dashboard with charts" --patch --output dashboard.patch

# Share via git (create PR with just the patch file)
git checkout -b patch/dashboard
git add dashboard.patch
git commit -m "Add dashboard feature patch"
git push

# Developer B: Review and apply
git fetch origin patch/dashboard
git apply dashboard.patch
# Run tests, review code, then commit
git add -A && git commit -m "feat: add user dashboard with charts"
```
---

## 網路設定
```json
{
  "network": {
    "maxRetries": 3,
    "timeout": 30000,
    "retryDelay": 1000
  }
}
```
|領域|類型 |預設 |最大|描述 |
| ------------ | ------ | -------- | ---| -------------------------------------- |
| `maxRetries` |數量 | `3` | `5` |重試失敗的 API 請求 |
| `timeout` |數量 | `30000` | - |請求逾時（以毫秒為單位）|
| `retryDelay` |數量 | `1000` | - |重試之間的延遲（以毫秒為單位）|

---

## 遙測設定

遙測功能**預設為停用**（選擇加入）。啟用它可以幫助改進 Autohand。
```json
{
  "telemetry": {
    "enabled": false,
    "apiBaseUrl": "https://api.autohand.ai",
    "batchSize": 20,
    "flushIntervalMs": 60000,
    "maxQueueSize": 500,
    "maxRetries": 3,
    "enableSessionSync": true,
    "companySecret": ""
  }
}
```
|領域|類型 |預設 |描述 |
| ------------------- | -------- | ---------------------------------- | -------------------------------------------------------- |
| `enabled` |布林 | `false` |啟用/停用遙測（選擇加入）|
| `apiBaseUrl` |字串| `https://api.autohand.ai` |遙測 API 端點 |
| `batchSize` |數量 | `20` |自動刷新之前要批次處理的事件數 |
| `flushIntervalMs` |數量 | `60000` |刷新間隔以毫秒為單位（1 分鐘）|
| `maxQueueSize` |數量 | `500` |刪除舊事件之前的最大佇列大小
| `maxRetries` |數量 | `3` |重試失敗的遙測請求 |
| `enableSessionSync` |布林 | `true` |啟用遙測功能時將會話同步到雲端以實現團隊功能 |
| `companySecret` |字串| `""` | API認證的公司機密|

提供者/模型遙測包括活動提供者 ID、模型 ID 和可用的非秘密元數據，例如自訂提供者顯示名稱、API 格式、推理工作和上下文視窗。 API 金鑰和不記名令牌永遠不會包含在內。

---

## 外部代理

從外部目錄載入自訂代理定義。
```json
{
  "externalAgents": {
    "enabled": true,
    "paths": ["~/.autohand/agents", "/team/shared/agents"]
  }
}
```
|領域|類型 |預設 |描述 |
| ---------| -------- | -------- | ------------------------------------------- |
| `enabled` |布林 | `false` |啟用外部代理程式載入 |
| `paths` |字串[] | `[]` |從中載入代理的目錄 |

---

## 技能係統

技能是向人工智慧代理提供專門指令的指令包。它們的運作方式類似於按需 `AGENTS.md` 文件，可以針對特定任務啟動。

### 技能發現地點

技能是從多個位置發現的，優先考慮較晚的來源：

|地點 |來源ID |描述 |
| ---------------------------------------------------- | ------------------ | ---------------------------------------------------- |
| `~/.codex/skills/**/SKILL.md` | `codex-user` |用戶級 Codex 技能（遞歸）|
| `~/.claude/skills/*/SKILL.md` | `claude-user` |用戶級克勞德技能（一級）|
| `~/.autohand/skills/**/SKILL.md` | `autohand-user` |用戶級 Autohand 技能（遞歸） |
| `<project>/.claude/skills/*/SKILL.md` | `claude-project` |項目級克勞德技能（一級）|
| `<project>/.autohand/skills/**/SKILL.md` | `autohand-project` |專案層級 Autohand 技能（遞迴）|

### 自動複製行為

從 Codex 或 Claude 位置發現的技能會自動複製到對應的 Autohand 位置：

- `~/.codex/skills/` 且 `~/.claude/skills/` → `~/.autohand/skills/`
- `<project>/.claude/skills/` → `<project>/.autohand/skills/`

Autohand 地點的現有技能永遠不會被覆蓋。

### SKILL.md 格式

技能使用 YAML frontmatter 後面跟著 markdown 內容：
```markdown
---
name: my-skill-name
description: Brief description of the skill
license: MIT
compatibility: Works with Node.js 18+
allowed-tools: read_file write_file run_command
metadata:
  author: your-name
  version: "1.0.0"
---

# My Skill

Detailed instructions for the AI agent...
```
|領域 |必填|最大長度|說明 |
| ---------------- | -------- | ---------- | ------------------------------------------------------ |
| `name` |是的 | 64 個字元 |僅帶有連字符的小寫字母數字 |
| `description` |是的 | 1024 個字元 |技能簡述|
| `license` |沒有 | - |許可證標識符（例如 MIT、Apache-2.0）|
| `compatibility` |沒有 | 500 個字元 |相容性說明 |
| `allowed-tools` |沒有 | - |以空格分隔的允許工具清單 |
| `metadata` |沒有 | - |附加鍵值元資料 |

### 輸入前綴

Autohand 支援輸入提示中的特殊前綴：

|前綴 |描述 |範例|
| ------ | ------------------------------------------ | ---------------------------------- |
| `/` |斜線指令 | `/help`、`/model`、`/quit`、`/exit` |
| `@` |文件提及（自動完成）| `@src/index.ts` |
| `$` |技能提及（自動完成）| `$frontend-design`、`$code-review` |
| `!` |直接執行終端指令 | `! git status`、`! ls -la` |

**技能提及（`$`）：**

- 輸入 `$` 後跟字元以查看具有自動完成功能的可用技能
- Tab 接受最上面的建議（例如 `$frontend-design`）
- 技能是從`~/.autohand/skills/`和`<project>/.autohand/skills/`發現的
- 啟動的技能會附加到提示中，作為當前會話的特殊說明
- 預覽面板顯示技能元資料（名稱、描述、啟動狀態）

**Shell 指令 (`!`):**

- 命令在目前工作目錄中執行
- 輸出直接顯示在終端機中
- 不去LLM
- 30秒超時
- 執行後返回提示

### 斜線指令

#### `/skills` - 套件管理器

|命令 |描述 |
| ------------------------------------------- | ------------------------------------------------------ |
| `/skills` |列出所有可用技能 |
| `/skills use <name>` |啟動目前會話的技能 |
| `/skills deactivate <name>` |停用技能 |
| `/skills info <name>` |顯示詳細技能資訊 |
| `/skills install` |從社區註冊表瀏覽並安裝 |
| `/skills install @<slug>` |透過 slug 安裝社區技能 |
| `/skills search <query>` |搜尋社區技能註冊表 |
| `/skills trending` |展示熱門社群技能 |
| `/skills remove <slug>` |卸載社區技能 |
| `/skills new` |互動式建立新技能 |
| `/skills feedback <slug> <1-5>` |評估社區技能 |

#### `/learn` - LLM 支援的技能顧問

|命令|描述 |
| ---------------- | ---------------------------------------------------------------- |
| `/learn` |分析專案並推薦技能（快速掃描）|
| `/learn deep` |深度掃描項目（讀取原始檔）以獲得更有針對性的結果 |
| `/learn update` |重新分析專案並重新產生過時的 LLM 產生的技能 |

`/learn` 使用兩階段 LLM 流程：

1. **階段 1 - 分析 + 排名 + 審核**：掃描您的專案結構，審核已安裝的技能是否有冗餘/衝突，並按相關性 (0-100) 對社區技能進行排名。
2. **第 2 階段 - 生成**（有條件）：如果沒有社區技能得分超過 60，則提供針對您的專案量身定制的自訂技能。
產生的技能包括元資料（`agentskill-source: llm-generated`、`agentskill-project-hash`），因此 `/learn update` 可以偵測到您的程式碼庫何時發生變更並重新產生過時的技能。

### 自動技能產生 (`--auto-skill`)

`--auto-skill` CLI 標誌無需互動式顧問流程即可產生技能：
```bash
autohand --auto-skill
```
這將：

1.分析你的專案結構（package.json、requirements.txt等）
2. 檢測語言、框架和模式
3. 利用LLM培養3項相關技能
4. 將技能儲存到`<project>/.autohand/skills/`

為了獲得更有針對性的互動體驗，請在會話中使用 `/learn` 。

偵測到的模式包括：

- **語言**：TypeScript、JavaScript、Python、Rust、Go
- **框架**：React、Next.js、Vue、Express、Flask、Django
- **模式**：CLI 工具、測試、monorepo、Docker、CI/CD

---

## API 設定

團隊功能的後端 API 設定。
```json
{
  "api": {
    "baseUrl": "https://api.autohand.ai",
    "companySecret": "sk-team-xxx"
  }
}
```
|領域 |類型 |預設 |描述 |
| ---------------- | ------ | ---------------------------------- | --------------------------------------- |
| `baseUrl` |字串| `https://api.autohand.ai` | API端點|
| `companySecret` |字串| - |共享功能的團隊/公司秘密 |

也可以透過環境變數設定：

- `AUTOHAND_API_URL` → `api.baseUrl`
- `AUTOHAND_SECRET` → `api.companySecret`

---

## 身份驗證設定

身份驗證和使用者會話配置。
```json
{
  "auth": {
    "token": "your-auth-token",
    "user": {
      "id": "user-id",
      "email": "user@example.com",
      "name": "User Name",
      "avatar": "https://example.com/avatar.png"
    },
    "expiresAt": "2025-12-31T23:59:59Z"
  }
}
```
|領域 |類型 |預設 |描述 |
| ------------- | ------ | -------- | -------------------------------------------------------- |
| `token` |字串| - | API 存取的身份驗證令牌 |
| `user` |物件| - |已驗證的使用者資訊 |
| `user.id` |字串| - |使用者名稱|
| `user.email` |字串| - |使用者電子郵件地址 |
| `user.name` |字串| - |使用者顯示名稱 |
| `user.avatar` |字串| - |使用者頭像 URL（可選）|
| `expiresAt` |字串| - |令牌過期時間戳記（ISO 8601 格式）|

---

## 社區技能設置

社區技能發現和管理的配置。
```json
{
  "communitySkills": {
    "enabled": true,
    "showSuggestionsOnStartup": true,
    "autoBackup": true
  }
}
```
|領域 |類型 |預設 |描述 |
| -------------------------- | -------- | -------- | ------------------------------------------------------------------------ |
| `enabled` |布林 | `true` |啟用社群技能功能 |
| `showSuggestionsOnStartup` |布林 | `true` |當不存在供應商技能時在啟動時顯示技能建議 |
| `autoBackup` |布林 | `true` |自動將發現的供應商技能備份到API |

---

## 共享設定

透過 `/share` 指令設定會話共用。會議在 [autohand.link](https://autohand.link) 舉行。
```json
{
  "share": {
    "enabled": true
  }
}
```
|領域|類型 |預設 |描述 |
| ---------| -------- | -------- | ----------------------------------- |
| `enabled` |布林 | `true` |啟用/停用 `/share` 指令 |

### YAML 格式
```yaml
share:
  enabled: true
```
### 停用會話共享

如果您出於安全或隱私原因想要停用會話共享：
```json
{
  "share": {
    "enabled": false
  }
}
```
停用後，執行 `/share` 將顯示：
```
Session sharing is disabled.
To enable, set share.enabled: true in your config file.
```
---

## 設定同步

Autohand 可以為登入使用者跨裝置同步您的設定。設定安全性儲存在 Cloudflare R2 中，並在上傳前進行加密。
```json
{
  "sync": {
    "enabled": true,
    "interval": 300000,
    "exclude": [],
    "includeTelemetry": false,
    "includeFeedback": false
  }
}
```
|領域|類型 |預設|描述 |
| ------------------ | -------- | ---------------- | -------------------------------------------------- |
| `enabled` |布林 | `true`（已記錄）|啟用/停用設定同步 |
| `interval` |數量 | `300000` |同步間隔（以毫秒為單位）（預設值：5 分鐘）|
| `exclude` |字串[] | `[]` |從同步中排除的全域模式 |
| `includeTelemetry` |布林 | `false` |同步遙測資料（需要使用者同意）|
| `includeFeedback` |布林 | `false` |同步回饋資料（需要使用者同意）|

### CLI 標誌
```bash
# Disable sync for this session
autohand --sync-settings=false

# Enable sync (default for logged users)
autohand --sync-settings
```
### 同步的內容

預設情況下，這些項目會為登入使用者同步：

- **設定** (`config.json`) - API 金鑰在上傳前加密
- **自訂代理程式** (`agents/`)
- **社區技能** (`community-skills/`)
- **使用者掛鉤** (`hooks/`)
- **記憶體** (`memory/`)
- **專案知識** (`projects/`)
- **會話歷史記錄** (`sessions/`)
- **分享內容** (`share/`)
- **自訂技能** (`skills/`)

### 不同步的內容（預設）

- **設備 ID** (`device-id`) - 每個設備唯一
- **錯誤日誌** (`error.log`) - 僅限本地
- **版本快取** (`version-*.json`) - 本機快取文件

### 基於同意的同步

這些項目需要在您的配置中明確選擇加入：

- **遙測資料** - 設定 `sync.includeTelemetry: true` 進行同步
- **回饋資料** - 設定 `sync.includeFeedback: true` 進行同步
```json
{
  "sync": {
    "enabled": true,
    "includeTelemetry": true,
    "includeFeedback": true
  }
}
```
### 衝突解決

當發生衝突時（在多個裝置上修改相同檔案），**雲端版本獲勝**。這可以確保在新裝置上登入時的一致性。

### 安全

`config.json` 中的 API 金鑰和其他敏感資料在上傳前使用您的驗證令牌進行加密。它們只能使用您的憑證進行解密。

遠端檔案名稱僅接受啟用同步類別內的相對 POSIX 路徑。同步會拒絕目錄遍歷、絕對路徑或 Windows 樣式路徑、重複或空白區段，以及由符號連結重新導向至啟用根目錄之外的目的地。

應用程式登入權杖只會透過 `Authorization` 標頭傳送至與已設定同步 API 相同來源的傳輸 URL。跨來源的預先簽署 HTTPS URL 絕不會收到此權杖；不安全或格式錯誤的跨來源 URL 會遭到拒絕。

**加密內容：**

- 名為 `apiKey` 的字段
- 以 `Key`、`Token`、`Secret` 結尾的字段
- `password` 字段

### 它是如何運作的

1. **啟動時**：如果您已登錄，同步服務將自動啟動
2. **每5分鐘**：設定與雲端儲存進行比較
3. **雲端獲勝**：首先下載遠端更改
4. **本地上傳**：上傳新的本地更改
5. **退出時**：同步服務正常停止

### 排除文件

您可以從同步中排除特定檔案或模式：
```json
{
  "sync": {
    "enabled": true,
    "exclude": ["custom-local-config.json", "temp/*"]
  }
}
```
### YAML 格式
```yaml
sync:
  enabled: true
  interval: 300000
  exclude: []
  includeTelemetry: false
  includeFeedback: false
```
---

## MCP 設定

配置 MCP（模型上下文協定）伺服器以使用外部工具擴展 Autohand。
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
      },
      {
        "name": "context7",
        "transport": "http",
        "url": "https://mcp.context7.com/mcp",
        "headers": {
          "CONTEXT7_API_KEY": "ctx7sk-your-api-key"
        },
        "autoConnect": true
      }
    ]
  }
}
```
### `mcp.enabled`

- **類型**：`boolean`
- **預設**：`true`
- **描述**：啟用或停用所有 MCP 支援。當`false`時，啟動時沒有連接伺服器，MCP工具不可用。

### `mcp.servers`

- **類型**：`McpServerConfigEntry[]`
- **預設**：`[]`
- **描述**：MCP 伺服器設定數組。

### 伺服器條目字段

|領域 |類型 |必填 |預設 |說明 |
| ------------- | -------------------------------- | -------------- | -------- |------------------------------------------------------------------------ |
| `name` | `string` |是的 | - |唯一的伺服器識別碼 |
| `transport` | `"stdio"` \| `"sse"` \| `"http"` |是的 | - |運送類型|
| `command` | `string` |是（stdio）| - |啟動伺服器程序的命令 |
| `args` | `string[]` |沒有 | `[]` |指令的參數 |
| `url` | `string` |是（sse/http）| - |伺服器端點 URL |
| `headers` | `Record<string, string>` |沒有 | `{}` |用於 http/sse 傳輸的自訂 HTTP 標頭（例如驗證令牌）|
| `env` | `Record<string, string>` |沒有 | `{}` |傳遞到伺服器的環境變數 |
| `autoConnect` | `boolean` |沒有 | `true` |啟動時是否自動連線 |

> 伺服器在啟動期間在後台非同步連接，不會阻止提示。使用 `/mcp` 以互動方式管理伺服器，或使用 `/mcp add` 瀏覽社群註冊表或新增自訂伺服器。

> 有關完整的 MCP 文檔，請參閱 [docs/mcp.md](mcp.md)。

---

## 掛鉤設置

對代理事件執行 shell 指令的生命週期掛鉤的設定。有關完整詳細信息，請參閱 [Hooks 文件](./hooks.md)。
```json
{
  "hooks": {
    "enabled": true,
    "hooks": [
      {
        "event": "pre-tool",
        "command": "echo \"Running tool: $HOOK_TOOL\" >> ~/.autohand/hooks.log",
        "description": "Log all tool executions",
        "enabled": true
      },
      {
        "event": "file-modified",
        "command": "./scripts/on-file-change.sh",
        "description": "Custom file change handler",
        "filter": { "path": ["src/**/*.ts"] }
      },
      {
        "event": "post-response",
        "command": "curl -X POST https://api.example.com/webhook -d '{\"tokens\": $HOOK_TOKENS}'",
        "description": "Track token usage",
        "async": true
      }
    ]
  }
}
```
### `hooks`

|領域|類型 |預設 |描述 |
| ---------| -------- | -------- | --------------------------------- |
| `enabled` |布林 | `true` |全域啟用/停用所有鉤子 |
| `hooks` |陣列| `[]` |鉤子定義陣列 |

### 鉤子定義

|領域 |類型 |必填|預設 |說明 |
| ------------- | -------- | -------- | -------- | -------------------------------- |
| `event` |字串|是的 | - |要掛鉤的事件 |
| `command` |字串|是的 | - |執行的 Shell 指令 |
| `description` |字串|沒有 | - | `/hooks` 顯示說明 |
| `enabled` |布林 |沒有 | `true` |鉤子是否處於活動狀態 |
| `timeout` |數量 |沒有 | `5000` |逾時（以毫秒為單位）|
| `async` |布林 |沒有 | `false` |運作無阻塞 |
| `filter` |物件|沒有 | - | 依工具或路徑過濾 |

### 掛鉤事件

|活動 |當被解僱時 |
| ---------------- | -------------------------------------------------- |
| `pre-tool` |在任何工具執行之前 |
| `post-tool` |工具完成後|
| `file-modified` |檔案何時建立/修改/刪除 |
| `pre-prompt` |傳送至 LLM 之前 |
| `post-response` | LLM回復後|
| `session-error` |發生錯誤時 |

### 環境變數

當鉤子執行時，這些環境變數可用：

|變數|描述 |
| ---------------- | ------------------------ | |
| `HOOK_EVENT` |活動名稱|
| `HOOK_WORKSPACE` |工作區根路徑 |
| `HOOK_TOOL` |工具名稱（工具事件）|
| `HOOK_ARGS` | JSON 編碼的工具參數 |
| `HOOK_SUCCESS` |真/假（後工具）|
| `HOOK_PATH` |檔案路徑（檔案修改） |
| `HOOK_TOKENS` |使用的代幣（回應後）|

---

## Chrome 擴充功能設定

控制 Autohand Chrome 擴充功能整合。請參閱 [Autohand in Chrome](./autohand-in-chrome.md) 中的完整指南。
```json
{
  "chrome": {
    "extensionId": "your-extension-id",
    "enabledByDefault": false,
    "browser": "auto",
    "userDataDir": "/path/to/chrome/user-data",
    "profileDirectory": "Default",
    "installUrl": "https://autohand.ai/chrome"
  }
}
```
|關鍵|類型 |預設 |描述 |
| ------------------ | ---------| -------- | ------------------------------------------------------------------------------------------------ |
| `extensionId` | `string` | — |已安裝 Chrome 擴充功能 ID 以進行直接切換 |
| `enabledByDefault` | `boolean` | `false` |使用 CLI 自動啟動瀏覽器橋接器 |
| `browser` | `string` | `"auto"` |首選 Chromium 瀏覽器：`auto`、`chrome`、`chromium`、`brave`、`edge` |
| `userDataDir` | `string` | — |瀏覽器使用者資料目錄以正確的設定檔為目標|
| `profileDirectory` | `string` | — |瀏覽器設定檔目錄名稱（例如，`"Default"`、`"Profile 1"`）|
| `installUrl` | `string` | — |未配置擴充 ID 時的後備 URL |

### CLI 標誌
```bash
autohand --chrome          # Start with browser bridge enabled
autohand --no-chrome       # Start with browser bridge disabled
```
### 斜線指令
```
/chrome                    # Open Chrome integration panel
/chrome disconnect         # Close the browser bridge connection
```
---

## 完整範例

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
    "toolSelectionCache": true,
    "idleLogoutEnabled": true,
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
    "enableSessionSync": true
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
      "name": "User Name"
    }
  },
  "communitySkills": {
    "enabled": true,
    "showSuggestionsOnStartup": true,
    "autoBackup": true
  },
  "share": {
    "enabled": true
  },
  "sync": {
    "enabled": true,
    "interval": 300000,
    "includeTelemetry": false,
    "includeFeedback": false
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
  toolSelectionCache: true
  idleLogoutEnabled: true
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
  enableSessionSync: true

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
    name: User Name

communitySkills:
  enabled: true
  showSuggestionsOnStartup: true
  autoBackup: true

share:
  enabled: true

sync:
  enabled: true
  interval: 300000
  includeTelemetry: false
  includeFeedback: false
```
### TOML 格式 (`~/.autohand/config.toml`)
```toml
provider = "openrouter"

[openrouter]
apiKey = "sk-or-v1-your-key-here"
baseUrl = "https://openrouter.ai/api/v1"
model = "your-modelcard-id-here"

[ollama]
baseUrl = "http://localhost:11434"
model = "llama3.2"

[workspace]
defaultRoot = "~/projects"
allowDangerousOps = false

[ui]
theme = "dark"
autoConfirm = false
showCompletionNotification = true
showThinking = true
terminalBell = true
checkForUpdates = true
updateCheckInterval = 24

[ui.customThemes.company.vars]
brand = "#7c3aed"
brandSoft = "#a78bfa"

[ui.customThemes.company.colors]
accent = "brand"
borderAccent = "brandSoft"
mdHeading = "brand"

[agent]
maxIterations = 100
enableRequestQueue = true
toolSelectionCache = true
idleLogoutEnabled = true
debug = false

[permissions]
mode = "interactive"
whitelist = ["run_command:npm *", "run_command:bun *"]
blacklist = ["run_command:rm -rf /"]
rememberSession = true
```
---

## 目錄結構

Autohand 將資料儲存在 `~/.autohand/` （或 `$AUTOHAND_HOME`）：
```
~/.autohand/
├── config.json          # Main configuration
├── config.toml          # Alternative TOML config
├── config.yaml          # Alternative YAML config
├── device-id            # Unique device identifier
├── error.log            # Error log
├── feedback.log         # Feedback submissions
├── sessions/            # Session history
├── projects/            # Project knowledge base
├── memory/              # User-level memory
├── commands/            # Custom commands
├── agents/              # Agent definitions
├── tools/               # Custom meta-tools
├── feedback/            # Feedback state
└── telemetry/           # Telemetry data
    ├── queue.json
    └── session-sync-queue.json
```
**專案級目錄**（在工作區根目錄）：
```
<project>/.autohand/
├── settings.local.json  # Local project permissions (gitignore this)
├── memory/              # Project-specific memory
├── skills/              # Project-specific skills
└── tools/               # Project-specific meta-tools
```
---

## CLI 標誌（覆蓋配置）

這些標誌會覆蓋設定檔設定：

### 核心標誌

|旗幟|描述 |
| -------------------------------------- |---------------------------------------------------------------------------------------------------------------- |
| `-v, --version` |輸出目前版本 |
| `-p, --prompt [text]` |在指令模式下執行單一指令|
| `--path <path>` |覆寫工作區根目錄 |
| `--config <path>` |使用自訂設定檔|
| `--model <model>` |覆寫模型 |
| `--temperature <n>` |設定採樣溫度（0-1）|
| `--thinking [level]` |設定思考/推理深度（無、正常、擴展） |
| `-y, --yes` |自動確認提示|
| `--dry-run` |預覽而不執行 |
| `-d, --debug` |啟用詳細偵錯輸出 |
| `--bare` |最小明確模式；也設定 `AUTOHAND_CODE_SIMPLE=1` 並停用斜線指令 |

### 權限與安全

|旗幟|描述 |
| -------------------------------------- |---------------------------------------------------------------------------------------------------------------- |
| `--unrestricted` |沒有核准提示 |
| `--restricted` |拒絕危險作業|
| `--permissions` |顯示目前權限設定並退出 |
| `--no-idle-logout` |禁用長時間運行的代理會話的經過身份驗證的空閒註銷 |
| `--yolo [pattern]` |自動核准工具呼叫符合模式（例如 `allow:read,write` 或 `deny:delete`）|
| `--timeout <seconds>` |自動核准模式的逾時（以秒為單位）|

### Git 和工作樹

|旗幟|描述 |
| -------------------------------------- |---------------------------------------------------------------------------------------------------------------- |
| `--worktree [name]` |在隔離的 git 工作樹中執行會話（可選工作樹/分支名稱）|
| `--tmux` |在專用 tmux 會話中啟動（意味著 `--worktree`；不能與 `--no-worktree` 一起使用）|
| `--no-worktree` |在自動模式下停用 git worktree 隔離 |
| `-c, --auto-commit` |完成任務後自動提交變更 |
| `--patch` |產生 git 補丁而不套用變更 |
| `--output <file>` |補丁的輸出檔案（與--patch一起使用）|

### 自動模式
|旗幟|描述 |
| -------------------------------------- |---------------------------------------------------------------------------------------------------------------- |
| `--auto-mode [prompt]` |啟用互動式自動模式，或使用內聯任務啟動獨立循環 |
| `--max-iterations <n>` |最大自動模式迭代次數（預設值：50）|
| `--completion-promise <text>` |完成標記文字（預設：「DONE」）|
| `--checkpoint-interval <n>` | Git 每 N 次迭代提交一次（預設值：5）|
| `--max-runtime <m>` |最大運轉時間（以分鐘為單位）（預設值：120）|
| `--max-cost <d>` |最大 API 成本（以美元為單位）（預設值：10）|
| `--interactive-on-complete` |自動模式結束後，直接切換到互動模式（僅限 TTY） |

### 技能與學習

|旗幟|描述 |
| -------------------------------------- |---------------------------------------------------------------------------------------------------------------- |
| `--auto-skill` |基於專案分析自動產生技能（另請參閱 `/learn` 了解互動式顧問）|
| `--learn` |以非互動方式運行 `/learn` 技能顧問（分析並安裝推薦技能） |
| `--learn-update` |以非互動方式重新分析專案並重新產生過時的法學碩士產生的技能 |
| `--skill-install [name]` |安裝社群技能（如果未提供名稱，則開啟瀏覽器）|
| `--project` |將技能安裝到專案層級（使用 --skill-install） |

### 身份驗證和帳戶

|旗幟|描述 |
| -------------------------------------- |---------------------------------------------------------------------------------------------------------------- |
| `--login` |登入您的 Autohand 帳戶 |
| `--logout` |退出您的 Autohand 帳戶 |
| `--sync-settings` |啟用/停用設定同步（預設值：對於登入使用者為 true）|

### 設定和訊息

|旗幟|描述 |
| -------------------------------------- |---------------------------------------------------------------------------------------------------------------- |
| `--setup` |執行設定精靈來設定或重新設定 Autohand |
| `--about` |顯示有關 Autohand 的資訊（版本、連結、貢獻資訊）|
| `--feedback` |向 Autohand 團隊提交回饋 |
| `--settings` |配置 Autohand 設定（與交互模式下的 `/settings` 相同） |

### 工作區和目錄

|旗幟|描述 |
| -------------------------------------- |---------------------------------------------------------------------------------------------------------------- |
| `--add-dir <path...>` |將其他目錄新增至工作區範圍（可使用多次）|

### 運行模式

|旗幟|描述 |
| -------------------------------------- |---------------------------------------------------------------------------------------------------------------- |
| `--mode <mode>` |運作模式：互動（預設）、rpc 或 acp |
| `--acp` | --mode acp（基於 stdio 的代理客戶端協定）的簡寫 |
| `--teammate-mode <mode>` |團隊顯示模式：自動、進程內或 tmux |

### 使用者介面和語言

|旗幟|描述 |
| -------------------------------------- |---------------------------------------------------------------------------------------------------------------- |
| `--display-language <locale>` |設定顯示語言（例如 en、id、zh-cn、fr、de、ja）|
| `--search-engine <provider>` |設定網路搜尋提供者（google、brave、duckduckgo、parallel）|
| `--cc, --context-compact` |啟用上下文壓縮（預設：開啟）|
| `--no-cc, --no-context-compact` |停用上下文壓縮 |

### Chrome 集成

|旗幟|描述 |
| -------------------------------------- |---------------------------------------------------------------------------------------------------------------- |
| `--chrome` |啟用 Chrome 瀏覽器整合（與 `/chrome` 相同）|
| `--no-chrome` |停用 Chrome 瀏覽器整合 |

###系統提示

|旗幟|描述 |
| -------------------------------------- |---------------------------------------------------------------------------------------------------------------- |
| `--sys-prompt <value>` |取代整個系統提示字元（內嵌字串或檔案路徑）|
| `--append-sys-prompt <value>` |附加到系統提示字元（內聯字串或檔案路徑）|
| `--system-prompt <value>` |取代整個系統提示字元（內嵌字串或檔案路徑）|
| `--system-prompt-file <path>` |用檔案內容取代整個系統提示符號 |
| `--append-system-prompt <value>` |附加到系統提示字元（內聯字串或檔案路徑）|
| `--append-system-prompt-file <path>` |將檔案內容附加到系統提示符號 |
| `--mcp-config <path>` |載入明確 MCP 設定檔 |
| `--agents <json\|path>` |載入明確內嵌代理 JSON 或明確代理目錄 |
| `--plugin-dir <path>` |載入明確插件/元工具目錄 |

### 實驗切換指令

|命令 |描述 |
| -------------------------------------------------- | ------------------------------------------------ |
| `autohand experiments list` |列出本地和遠端功能 ID、來源、生命週期階段和狀態 |
| `autohand experiments status <feature>` |顯示一個功能開關、設定路徑或遠端元資料以及狀態 |
| `autohand experiments refresh` |從 Autohand API 下載遠端功能標誌 |
| `autohand experiments enable <feature>` |啟用設定支援的功能開關 |
| `autohand experiments disable <feature>` |停用設定支援的功能開關 |

遠端功能標誌從 `/v1/feature-flags/evaluate` 取得，快取在 `~/.autohand/feature-flags.json` 中，並在 API 提供的 TTL 到期後刷新。使用 `features.environment` 選擇遠端標誌環境，並使用 `features.remoteOverrides` 用於本機選擇退出使用者可覆寫的遠端標誌。

`usage_v2` 是 `/usage` 儀表板和增強型 `/status` 使用標籤的實驗性功能開關。使用 `autohand experiments enable usage_v2` 啟用它。

`token_usage_status` 是一個實驗性功能開關（配置路徑 `features.tokenUsageStatus`，預設關閉），它在工作狀態行中顯示即時令牌使用 - 累積令牌向上 (`↑`) 和向下 (`↓`) 加上上下文視窗佔用率，例如`↑15.7k ↓3.2k · context: 6.0% (15.7k/262.1k)`。上下文視窗是針對所有提供者中的每個模型進行解析的。使用 `autohand experiments enable token_usage_status` 啟用它。

---

## 斜線指令

Autohand 提供了一組豐富的斜線命令供互動式使用。在 REPL 中鍵入 `/` 以查看建議。

### 會話管理

|命令|描述 |
| ------------- | ---------------------------------------------------------------- |
| `/quit` |退出目前會話 |
| `/exit` |退出目前會話 |
| `/new` |開始新的對話（透過記憶擷取）|
| `/clear` |自動記憶擷取功能讓對話清晰 |
| `/session` |顯示目前會話詳細資料 |
| `/sessions` |列出過去的會議 |
| `/resume` |恢復之前的會話 |
| `/history` |使用分頁瀏覽會話歷史記錄 |
| `/undo` |復原 git 變更與上一回合 |
| `/export` |將會話匯出為 markdown/JSON/HTML |
| `/share` |分享目前會話 |
| `/status` |顯示會話狀態 |
| `/usage` |顯示模型、提供者、上下文和使用限制 |

### 型號和提供者

|命令 |描述 |
| ------------- | ---------------------------------------------------------------- |
| `/model` |切換或設定LLM模式 |
| `/cc` |手動壓縮上下文 |

### 項目設置

|命令 |描述 |
| ------------- | ---------------------------------------------------------------- |
| `/init` |在目前目錄中建立 `AGENTS.md` 檔案 |
| `/setup` |執行設定精靈來設定 Autohand |
| `/add-dir` |將目錄新增至工作區範圍 |

### 代理商和團隊

|命令 |描述 |
| ------------- | ---------------------------------------------------------------- |
| `/agents` |列出可用的子代理程式 |
| `/agents-new` |透過精靈建立新代理程式 |
| `/squad` |開啟/管理獨立的 Autohand Squad 執行時期 |
| `/team` |管理團隊並行工作 |
| `/tasks` |管理團隊中的任務 |
| `/message` |傳送訊息給隊友 |

### 技能

|命令 |描述 |
| ---------------- | -------------------------------------------------- |
| `/skills` |列出與管理技能 |
| `/skills-new` |創造新技能|
| `/learn` |學習並安裝推薦技能 |

### 記憶體和設置

|命令 |描述 |
| ------------- | ---------------------------------------------------------------- |
| `/memory` |檢視並管理儲存的記憶 |
| `/settings` |配置 Autohand 設定 |
| `/statusline` |配置 Composer 狀態行欄位 |
| `/experiments` |切換實驗性功能開關 |
| `/sync` |跨裝置同步設定 |
| `/import` |從支援的代理匯入會話、設定、MCP、記憶體、技能和掛鉤 |

### 權限和掛鉤

|命令 |描述 |
| ------------- | ---------------------------------------------------------------- |
| `/permissions`|管理工具權限 |
| `/hooks` |管理生命週期掛鉤 |

### 身份驗證

|命令 |描述 |
| ------------- | ---------------------------------------------------------------- |
| `/login` |使用 Autohand API 進行驗證 |
| `/logout` |登出 Autohand 帳號 |

### 工具和實用程式

|命令 |描述 |
| ------------- | ---------------------------------------------------------------- |
| `/search` |搜尋網路 |
| `/formatters` |列出可用的程式碼格式化程式 |
| `/lint` |列出可用的程式碼檢查 |
| `/completion` |產生 shell 完成腳本 |
| `/plan` |制定實施計畫 |
| `/review` |執行程式碼審查 |
| `/pr-review` |審查拉取請求 |

### IDE 集成

|命令 |描述 |
| ------------- | ---------------------------------------------------------------- |
| `/ide` |偵測並連接到正在執行的 IDE |

### MCP（模型上下文協定）

|命令 |描述 |
| ------------- | ---------------------------------------------------------------- |
| `/mcp` |互動式MCP伺服器管理員|

### 自動化

|命令 |描述 |
| ------------- | ---------------------------------------------------------------- |
| `/automode` |開啟自主編碼模式 |
| `/repeat` |安排重複性工作 |
| `/yolo` |切換 yolo 模式（自動核准工具）|

### Chrome 集成

|命令 |描述 |
| ------------- | ---------------------------------------------------------------- |
| `/chrome` |啟用 Chrome 瀏覽器整合 |

### 使用者介面和顯示

|命令 |描述 |
| ------------- | ---------------------------------------------------------------- |
| `/help` |顯示可用的斜線指令與提示 |
| `/about` |顯示有關 Autohand 的資訊 |
| `/theme` |更改顏色主題 |
| `/language` |更改顯示語言 |
| `/feedback` |向 Autohand 團隊傳送回饋 |

---

## 系統提示定制
Autohand 允許您自訂 AI 代理程式使用的系統提示字元。這對於專門的工作流程、自訂指令或與其他系統的整合非常有用。

### CLI 標誌

|旗幟|描述 |
| -------------------------------------- |------------------------------------------------- |
| `--sys-prompt <value>` |取代整個系統提示符號 |
| `--append-sys-prompt <value>` |將內容追加到預設系統提示字元 |

兩個標誌都接受：

- **內聯字串**：直接文字內容
- **檔案路徑**：包含提示的檔案的路徑（自動偵測）

### 檔案路徑偵測

如果值符合以下條件，則將其視為檔案路徑：

- 以 `./`、`../`、`/` 或 `~/` 開頭
- 以 Windows 磁碟機號開頭（例如 `C:\`）
- 以 `.txt`、`.md` 或 `.prompt` 結尾
- 包含不含空格的路徑分隔符

否則，它被視為內聯字串。

### `--sys-prompt`（完全替換）

一旦提供，這**完全取代**預設的系統提示字元。代理不會加載：

- 預設 Autohand 指令
- AGENTS.md 專案說明
- 使用者/項目記憶
- 主動技能
```bash
# Inline string
autohand --sys-prompt "You are a Python expert. Be concise." --prompt "Write hello world"

# From file
autohand --sys-prompt ./custom-prompt.txt --prompt "Explain this code"

# Home directory
autohand --sys-prompt ~/.autohand/prompts/python-expert.md --prompt "Debug this function"
```
**自訂提示檔案範例 (`custom-prompt.txt`):**
```
You are a specialized Python debugging assistant.

Rules:
- Focus only on Python code
- Always explain the root cause
- Suggest fixes with code examples
- Be concise and direct
```
### `--append-sys-prompt` （加到預設值）

當提供時，這**附加**內容到完整的預設系統提示符號。代理仍將載入：

- 預設 Autohand 指令
- AGENTS.md 專案說明
- 使用者/項目記憶
- 主動技能

附加內容添加在最後。
```bash
# Inline string
autohand --append-sys-prompt "Always use TypeScript instead of JavaScript" --prompt "Create a function"

# From file
autohand --append-sys-prompt ./team-guidelines.md --prompt "Add error handling"
```
**附加檔案範例 (`team-guidelines.md`):**
```
## Team Guidelines

- Use 2-space indentation
- Prefer functional patterns
- Add JSDoc comments to public APIs
- Run tests before committing
```
### 優先權

當提供兩個標誌時：

1. `--sys-prompt` 完全優先
2. `--append-sys-prompt` 被忽略
```bash
# --append-sys-prompt is ignored in this case
autohand --sys-prompt "Custom only" --append-sys-prompt "This is ignored"
```
### 用例

|使用案例|推薦旗幟|
| --------------------------------- | -------------------- |
|自訂代理角色 | `--sys-prompt` |
|最少的說明 | `--sys-prompt` |
|新增團隊指南 | `--append-sys-prompt` |
|新增項目約定 | `--append-sys-prompt` |
|與外部系統整合 | `--sys-prompt` |
|專業調試| `--sys-prompt` |

### 錯誤處理

|場景 |行為 |
| ----------------- | ------------------------ |
|空值|錯誤 |
|找不到檔案 |視為內聯字串 |
|空白文件 |錯誤 |
|文件 > 1MB |錯誤 |
|權限被拒絕 |錯誤 |
|目錄路徑 |錯誤 |

### 範例
```bash
# Python expert mode
autohand --sys-prompt "You are a Python expert. Only write Python code." \
  --prompt "Create a web scraper"

# TypeScript enforcement
autohand --append-sys-prompt "Always use TypeScript, never JavaScript." \
  --prompt "Create a REST API"

# CI/CD integration (non-interactive)
autohand --sys-prompt ./ci-prompt.txt \
  --prompt "Fix the failing tests" \
  --unrestricted \
  --patch

# Custom team workflow
autohand --append-sys-prompt ~/.company/coding-standards.md \
  --prompt "Refactor this module"
```
---

## 多目錄支持

Autohand 可以使用主工作區以外的多個目錄。當您的專案在不同目錄中具有相依性、共用程式庫或相關專案時，這非常有用。

### CLI 標誌

使用 `--add-dir` 新增附加目錄（可以多次使用）：
```bash
# Add a single additional directory
autohand --add-dir /path/to/shared-lib

# Add multiple directories
autohand --add-dir /path/to/lib1 --add-dir /path/to/lib2

# With unrestricted mode (auto-approve writes to all directories)
autohand --add-dir /path/to/shared-lib --unrestricted
```
### 互動式指令

在互動式會話期間使用 `/add-dir`：
```
/add-dir              # Show current directories
/add-dir /path/to/dir # Add a new directory
```
### 安全限制

無法新增以下目錄：

- 主目錄（`~` 或 `$HOME`）
- 根目錄 (`/`)
- 系統目錄（`/etc`、`/var`、`/usr`、`/bin`、`/sbin`）
- Windows 系統目錄（`C:\Windows`、`C:\Program Files`）
- Windows 使用者目錄 (`C:\Users\username`)
- WSL Windows 安裝（`/mnt/c`、`/mnt/c/Windows`）
