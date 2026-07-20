# Autohand Konfigurációs referencia

Teljes referencia az összes konfigurációs beállításhoz itt: `~/.autohand/config.json` (vagy `.toml`/`.yaml`/`.yml`).

> **Tipp:** A legtöbb alábbi beállítás interaktívan módosítható a `/settings` paranccsal a fájl manuális szerkesztése helyett.

Lokalizált referenciák:

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

## Tartalomjegyzék

- [A konfigurációs fájl helye](#configuration-file-location)
- [Környezeti változók](#environment-variables)
- [Csupasz mód](#bare-mode)
- [Szolgáltatói beállítások](#provider-settings)
- [Munkaterület beállításai](#workspace-settings)
- [UI beállítások](#ui-settings)
- [Ügynökbeállítások](#agent-settings)
- [Engedélyek beállításai](#permissions-settings)
- [Javítási mód](#patch-mode)
- [Hálózati beállítások](#network-settings)
- [Telemetriai beállítások](#telemetry-settings)
- [Külső ügynökök](#external-agents)
- [Skills System](#skills-system)
- [API beállítások](#api-settings)
- [Authentication Settings](#authentication-settings)
- [Közösségi készségek beállításai](#community-skills-settings)
- [Megosztási beállítások](#share-settings)
- [Beállítások szinkronizálása](#settings-sync)
- [Hook beállításai](#hooks-settings)
- [MCP beállítások](#mcp-settings)
- [Chrome-bővítmény beállításai](#chrome-extension-settings)
- [Teljes példa](#complete-example)

---

## Konfigurációs fájl helye

Autohand a következő sorrendben keresi a konfigurációt:

1. `AUTOHAND_CONFIG` környezeti változó (egyéni elérési út)
2. `~/.autohand/config.toml`
3. `~/.autohand/config.yaml`
4. `~/.autohand/config.yml`
5. `~/.autohand/config.json` (alapértelmezett)

Az alapkönyvtárat is felülírhatja:
```bash
export AUTOHAND_HOME=/custom/path  # Changes ~/.autohand to /custom/path
```
---

## Környezeti változók

| Változó | Leírás | Példa |
| --------------------------------------- | ------------------------------------------------- | --------------------------------- |
| `AUTOHAND_HOME` | Alapkönyvtár az összes Autohand adathoz | `/custom/path` |
| `AUTOHAND_CONFIG` | Egyéni konfigurációs fájl elérési útja | `/path/to/config.toml` |
| `AUTOHAND_API_URL` | API-végpont (felülbírálja a konfigurációt) | `https://api.autohand.ai` |
| `AUTOHAND_SECRET` | Vállalat/csapat titkos kulcsa | `sk-xxx` |
| `AUTOHAND_PERMISSION_CALLBACK_URL` | Az engedély visszahívásának URL-je (kísérleti) | `http://localhost:3000/callback` |
| `AUTOHAND_PERMISSION_CALLBACK_TIMEOUT` | Az engedély-visszahívás időtúllépése ms-ban | `5000` |
| `AUTOHAND_NON_INTERACTIVE` | Futtatás nem interaktív módban | `1` |
| `AUTOHAND_YES` | Minden felszólítás automatikus megerősítése | `1` |
| `AUTOHAND_NO_BANNER` | Indítási szalaghirdetés letiltása | `1` |
| `AUTOHAND_STREAM_TOOL_OUTPUT` | Az eszköz kimenetének streamelése valós időben | `1` |
| `AUTOHAND_DEBUG` | Hibakeresési naplózás engedélyezése | `1` |
| `AUTOHAND_THINKING_LEVEL` | Érvelési mélységszint beállítása | `normal` |
| `AUTOHAND_CLIENT_NAME` | Kliens/szerkesztő azonosító (ACP kiterjesztések által beállítva) | `zed` |
| `AUTOHAND_CLIENT_VERSION` | Kliens verzió (az ACP-bővítmények által beállított) | `0.169.0` |
| `AUTOHAND_CODE` | Környezetérzékelési jelző (automatikusan beállítva) | `1` |
| `AUTOHAND_CODE_SIMPLE` | A csupasz mód engedélyezése a `--bare` | átadása nélkül `1` |

### Gondolkodási szint

A `AUTOHAND_THINKING_LEVEL` környezeti változó szabályozza a modell által használt érvelés mélységét:

| Érték | Leírás |
| ---------- | --------------------------------------------------------------------- |
| `none` | Közvetlen válaszok látható indoklás nélkül |
| `normal` | Szabványos érvelési mélység (alapértelmezett) |
| `extended` | Mély érvelés összetett feladatokhoz, részletesebb gondolkodási folyamatot mutat |

Ezt általában az ACP-kliens-bővítmények (például a Zed) állítják be a konfigurációs legördülő menüben.
```bash
# Example: Use extended thinking for complex tasks
AUTOHAND_THINKING_LEVEL=extended autohand --prompt "refactor this module"
```
---

## Csupasz mód

A csupasz mód a Autohand csak kifejezetten kért kontextus- és futásidejű integrációkkal indul. Engedélyezze a következők egyikével:
```bash
autohand --bare
AUTOHAND_CODE_SIMPLE=1 autohand
```
A `--bare` átadásakor a Autohand a `AUTOHAND_CODE_SIMPLE=1` értéket is beállítja a futó folyamathoz.

A csupasz mód letiltja az automatikus indítást és az interaktív integrációkat:

- horgok és horog értesítések
- LSP indítás
- plugin szinkronizálás, bővítmény automatikus betöltése és meta-eszköz automatikus betöltése
- hozzárendelés, telemetria, munkamenet-szinkronizálás, automatikus jelentéskészítés és háttérpingek
- automatikus memória/munkamenet bootstrap kontextus
- háttérkérdések, frissítés-ellenőrzések, funkciójelző-lekérések és modell-metaadatok előzetes letöltése
- kulcstartó és böngésző OAuth-hitelesítési tartalék
- automatikus `AGENTS.md` és szolgáltatói utasítás keresés
- minden perjel parancs, beleértve a parancssorba beírt csupasz `/`

A perjel alakú abszolút fájlútvonalakat, például a `/Users/alex/project/file.ts`, továbbra is normál prompt szövegként kezeli a rendszer. A parancs alakú perjel bevitel, például `/help`, `/model` vagy `/mcp`, a `Slash commands are disabled in bare mode.` kódot írja ki, és nem hajtódik végre.

A csupasz módban történő hitelesítés csak explicit. A Autohand először a következőt olvassa: `AUTOHAND_API_KEY`, majd `auth.apiKeyHelper`, ha be van állítva. Nem olvassa be a kulcstartó hitelesítő adatait, és nem indítja el az OAuth/böngésző bejelentkezést. A külső szolgáltatók továbbra is a szolgáltatóspecifikus API-kulcsokat és konfigurációkat használják.

Ezek az explicit bemenetek csupasz módban is elérhetők:

| Bemenet | Leírás |
| ------------------------------ | -------------------------------------------------------------------------- |
| `--system-prompt <value>` | Cserélje ki a rendszerprompt szövegközi szöveggel vagy elérési út-szerű értékkel |
| `--system-prompt-file <path>` | Cserélje ki a rendszerpromptot a fájltartalommal |
| `--append-system-prompt <value>` | Szövegközi szöveg vagy elérési út-szerű érték hozzáfűzése a | rendszerprompthoz
| `--append-system-prompt-file <path>` | Fájl tartalmának hozzáfűzése a rendszerprompthoz |
| `--add-dir <path...>` | Explicit könyvtárak hozzáadása a munkaterület hatóköréhez |
| `--mcp-config <path>` | Töltsön be egy explicit MCP konfigurációs fájlt |
| `--settings` | Nyissa meg a beállításokat közvetlenül a CLI jelzőből |
| `--config <path>` | Használjon explicit Autohand konfigurációs fájlt |
| `--agents <json\|path>` | Explicit beépített ügynökök JSON vagy explicit ügynökök könyvtárának betöltése |
| `--plugin-dir <path>` | Töltsön be egy explicit plugin/meta-tool könyvtárat |

---

## Szolgáltatói beállítások

### `provider`

Aktív LLM szolgáltató használható.

| Érték | Leírás |
| -------------- | ----------------------------- |
| `"openrouter"` | OpenRouter API (alapértelmezett) |
| `"ollama"` | Helyi Ollama példány |
| `"llamacpp"` | Helyi llama.cpp szerver |
| `"openai"` | OpenAI API közvetlenül |
| `"mlx"` | MLX az Apple Siliconon (helyi) |
| `"llmgateway"` | LLM Gateway egyesített API |
| `"deepseek"` | DeepSeek API |
| `"zai"` | Z.ai GLM API |
| `"sakana"` | Sakana.AI Fugu API |
| `"bedrock"` | AWS alapkőzet |
| `"custom:<id>"` | Felhasználó által meghatározott OpenAI-kompatibilis szolgáltató a következőtől: `customProviders` |

### `openrouter`

OpenRouter szolgáltató konfigurációja.
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
| Mező | Típus | Kötelező | Alapértelmezett | Leírás |
| ---------------- | ------ | -------- | ------------------------------- | --------------------------------------------------------------------------- |
| `apiKey` | húr | Igen | - | Az Ön OpenRouter API kulcsa |
| `baseUrl` | húr | Nem | `https://openrouter.ai/api/v1` | API-végpont |
| `model` | húr | Igen | - | Modellazonosító (pl. `your-modelcard-id-here`) |
| `contextWindow` | szám | Nem | Auto | Pontos modell kontextusablak. Autohand kitölti ezt az OpenRouterből, ha ismert. |

### `zai`

Z.ai szolgáltató konfigurációja.
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
| Mező | Típus | Kötelező | Alapértelmezett | Leírás |
| ---------------- | ------ | -------- | ------------------------------- | -------------------------------------------------------------------------------- |
| `apiKey` | húr | Igen | - | Az Ön Z.ai API-kulcsa |
| `baseUrl` | húr | Nem | `https://api.z.ai/api/paas/v4` | API-végpont |
| `model` | húr | Igen | `glm-5.2` | Modellazonosító, például `glm-5.2`, `glm-5.1` vagy `glm-4.5` |
| `contextWindow` | szám | Nem | Auto | Pontos modell kontextusablak. A Autohand 1M-re következtet a GLM-5.2-nél és 200K-ra a GLM-5.1-nél. |

### `sakana`

Sakana.AI szolgáltató konfigurációja. Az API OpenAI-kompatibilis, és a `https://api.sakana.ai/v1`-t használja alap URL-ként.
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
| Mező | Típus | Kötelező | Alapértelmezett | Leírás |
| ---------------- | ------ | -------- | ------------------------------ | ------------------------------------------------------------------ |
| `apiKey` | húr | Igen | - | Az Ön Sakana API kulcsa |
| `baseUrl` | húr | Nem | `https://api.sakana.ai/v1` | API-végpont |
| `model` | húr | Igen | `fugu` | Modellazonosító, például `fugu` vagy `fugu-ultra` |
| `contextWindow` | szám | Nem | Auto | Pontos modell kontextusablak. Autohand 1M-re következtet a Fugu modelleknél.   |

### `customProviders`

Az egyéni szolgáltatók lehetővé teszik a felhasználók számára, hogy OpenAI-kompatibilis végpontot hozzanak létre kódmódosítás vagy új csomagolt szolgáltató nélkül. Adja hozzá a szolgáltatót a `customProviders` alatt, majd válassza ki a `provider: "custom:<id>"` kóddal. Ugyanez a folyamat elérhető a `/model` **Új szolgáltatóval**. A telepítés során a Autohand a szolgáltató mentése előtt ellenőrzi az alap URL-t, a hitelesítést és a kiválasztott modellt az OpenAI-kompatibilis `/models` végponton keresztül.
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
Azon helyi OpenAI-kompatibilis szervereknél, amelyek nem igényelnek hitelesítést, állítsa a `apiKeyRequired` értékét `false` értékre, és hagyja ki a `apiKey` értéket.

| Mező | Típus | Kötelező | Alapértelmezett | Leírás |
| ------------------ | ------- | -------- | ------- | ----------- |
| `id` | húr | Igen | - | Stabil szolgáltatói azonosító. Meg kell egyeznie az objektumkulccsal, és a következőképpen van kiválasztva: `custom:<id>`. |
| `displayName` | húr | Igen | - | A `/model` és a szolgáltató beállításai között látható név. |
| `apiFormat` | húr | Igen | - | A következőnek kell lennie: `openai-compatible`. |
| `baseUrl` | húr | Igen | - | Végpont gyökér, például `https://api.example.com/v1`. Autohand ellenőrzi a `/models` kódot, és felhívja a `/chat/completions` kódot. |
| `apiKey` | húr | Feltételes | - | Adathordozó token a tárolt végpontokhoz. Kötelező, ha a `apiKeyRequired` igaz. |
| `apiKeyRequired` | logikai | Nem | `true` | Állítsa be a false értéket a helyi vagy már hitelesített átjárókhoz. |
| `model` | húr | Igen | - | Aktív modell azonosító. |
| `contextWindow` | szám | Nem | Auto | Pontos kontextusablak a token-költségvetéshez, állapothoz, telemetriához és szinkronizálási metaadatokhoz. |
| `reasoningEffort` | húr | Nem | - | Opcionális `none`, `low`, `medium`, `high` vagy `xhigh`. `reasoning_effort` néven küldve egyéni OpenAI-kompatibilis kérésekhez. |
| `models` | tömb | Nem | - | Opcionális modellválasztó bejegyzések modellenkénti kontextussal és érvelési metaadatokkal. |

### `ollama`

Ollama szolgáltató konfigurációja.
```json
{
  "ollama": {
    "baseUrl": "http://localhost:11434",
    "port": 11434,
    "model": "llama3.2"
  }
}
```
| Mező | Típus | Kötelező | Alapértelmezett | Leírás |
| --------- | ------ | -------- | ------------------------- | ------------------------------------------- |
| `baseUrl` | húr | Nem | `http://localhost:11434` | Ollama szerver URL |
| `port` | szám | Nem | `11434` | Szerverport (a baseUrl alternatívája) |
| `model` | húr | Igen | - | Modellnév (pl. `llama3.2`, `codellama`) |

### `llamacpp`

llama.cpp szerver konfigurációja.
```json
{
  "llamacpp": {
    "baseUrl": "http://localhost:8080",
    "port": 8080,
    "model": "default"
  }
}
```
| Mező | Típus | Kötelező | Alapértelmezett | Leírás |
| --------- | ------ | -------- | ------------------------ | -------------------- |
| `baseUrl` | húr | Nem | `http://localhost:8080` | llama.cpp szerver URL |
| `port` | szám | Nem | `8080` | Szerver port |
| `model` | húr | Igen | - | Modellazonosító |

### `openai`

OpenAI API konfiguráció.
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
Az OpenAI a Autohand beépített OpenAI bejelentkezési folyamatán keresztül is használhatja ChatGPT-előfizetését:
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
| Mező | Típus | Kötelező | Alapértelmezett | Leírás |
| ---------------- | ------ | ----------------------- | ---------------------------- | -------------------------------------------------------------------------- |
| `authMode` | húr | Nem | `api-key` | Hitelesítési mód: `api-key` vagy `chatgpt` |
| `apiKey` | húr | Igen a `api-key` módhoz | - | OpenAI API kulcs |
| `baseUrl` | húr | Nem | `https://api.openai.com/v1` | API-végpont |
| `model` | húr | Igen | - | Modellnév (pl. `gpt-5.4`, `gpt-5.4-mini`) |
| `contextWindow` | szám | Nem | Auto | Pontos modell kontextusablak. Állítsa be az elavult helyi feltételezések felülbírálásához. |
| `chatgptAuth` | tárgy | Igen a `chatgpt` módhoz | - | Tárolt ChatGPT/Codex hitelesítési tokenek és fiókazonosító |

### `mlx`

MLX szolgáltató Apple Silicon Mac gépekhez (helyi következtetés).
```json
{
  "mlx": {
    "baseUrl": "http://localhost:8080",
    "port": 8080,
    "model": "mlx-community/Llama-3.2-3B-Instruct-4bit"
  }
}
```
| Mező | Típus | Kötelező | Alapértelmezett | Leírás |
| --------- | ------ | -------- | ------------------------ | -------------------- |
| `baseUrl` | húr | Nem | `http://localhost:8080` | MLX szerver URL |
| `port` | szám | Nem | `8080` | Szerver port |
| `model` | húr | Igen | - | MLX modell azonosító |

### `llmgateway`

LLM Gateway egységes API konfiguráció. Hozzáférést biztosít több LLM-szolgáltatóhoz egyetlen API-n keresztül.
```json
{
  "llmgateway": {
    "apiKey": "your-llmgateway-api-key",
    "baseUrl": "https://api.llmgateway.io/v1",
    "model": "gpt-4o"
  }
}
```
| Mező | Típus | Kötelező | Alapértelmezett | Leírás |
| --------- | ------ | -------- | ------------------------------- | ---------------------------------------------------------- |
| `apiKey` | húr | Igen | - | LLM Gateway API kulcs |
| `baseUrl` | húr | Nem | `https://api.llmgateway.io/v1` | API-végpont |
| `model` | húr | Igen | - | Modellnév (pl. `gpt-4o`, `claude-3-5-sonnet-20241022`) |

**API-kulcs beszerzése:**
Keresse fel a [llmgateway.io/dashboard](https://llmgateway.io/dashboard) webhelyet fiók létrehozásához és API-kulcsának beszerzéséhez.

**Támogatott modellek:**
Az LLM Gateway több szolgáltató modelljét támogatja, többek között:

- OpenAI: `gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo`
`claude-3-5-haiku-20241022`
- Google: `gemini-1.5-pro`, `gemini-1.5-flash`

### `deepseek`

DeepSeek szolgáltató konfigurációja. Az API OpenAI-kompatibilis, és a `https://api.deepseek.com`-t használja alap URL-ként.
```json
{
  "deepseek": {
    "apiKey": "your-deepseek-api-key",
    "baseUrl": "https://api.deepseek.com",
    "model": "deepseek-v4-flash"
  }
}
```
| Mező | Típus | Kötelező | Alapértelmezett | Leírás |
| --------- | ------ | -------- | --------------------------- | --------------------------------------------------------------- |
| `apiKey` | húr | Igen | - | DeepSeek API kulcs |
| `baseUrl` | húr | Nem | `https://api.deepseek.com` | API-végpont |
| `model` | húr | Igen | - | Modellnév, például `deepseek-v4-flash` vagy `deepseek-v4-pro` |

### `bedrock`

AWS Bedrock szolgáltató konfigurációja. `converse` az alapértelmezett mód, és az AWS SDK hitelesítési láncot használja. Az OpenAI-kompatibilis módok Bedrock API-kulcsokat és Bedrock OpenAI-kompatibilis végpontokat használnak.
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
| Mező | Típus | Kötelező | Alapértelmezett | Leírás |
| ---------- | ------ | -------- | ------- | ----------- |
| `model` | húr | Igen | - | Alapkőzetmodell-azonosító, következtetési profilazonosító vagy ARN |
| `region` | húr | Igen | `AWS_REGION`, majd `AWS_DEFAULT_REGION`, majd `us-east-1` a beállításban | AWS régió |
| `apiMode` | húr | Nem | `converse` | `converse`, `openai-chat` vagy `openai-responses` |
| `authMode` | húr | Nem | `aws-credentials` `converse`, `bedrock-api-key` OpenAI-kompatibilis módokhoz | Hitelesítési mód |
| `profile` | húr | Nem | - | Opcionális AWS-profil a hitelesítő adatok láncos hitelesítéséhez |
| `endpoint` | húr | Nem | Módból és régióból származtatva | Egyéni/privát Bedrock végpont |
| `apiKey` | húr | Igen OpenAI-kompatibilis módokhoz | - | Bedrock API kulcs. Ne használjon OpenAI API-kulcsokat. |

Futtassa a `aws configure sso` kódot, vagy állítsa be a `AWS_PROFILE=enterprise-prod autohand` értéket a profilalapú AWS-hitelesítéshez. Az IAM-szerepkört, a tárolót és a példány metaadat-hitelesítő adatait az AWS SDK támogatja. Modell használata előtt engedélyezze a modellelérést az AWS-konzolon.

---

## Munkaterület beállításai
```json
{
  "workspace": {
    "defaultRoot": "/path/to/projects",
    "allowDangerousOps": false
  }
}
```
| Mező | Típus | Alapértelmezett | Leírás |
| -------------------- | ------- | ------------------ | -------------------------------------------------- |
| `defaultRoot` | húr | Aktuális címtár | Alapértelmezett munkaterület, ha nincs megadva |
| `allowDangerousOps` | logikai | `false` | Pusztító műveletek engedélyezése megerősítés nélkül |

### Munkahelyi biztonság

Autohand automatikusan blokkolja a működést a veszélyes könyvtárakban, hogy megelőzze a véletlen károsodást:

- **Fájlrendszer gyökerei** (`/`, `C:\`, `D:\` stb.)
- **Házikönyvtárak** (`~`, `/Users/<user>`, `/home/<user>`, `C:\Users\<user>`)
- **Rendszerkönyvtárak** (`/etc`, `/var`, `/System`, `C:\Windows` stb.)
- **WSL Windows-csatlakozások** (`/mnt/c`, `/mnt/c/Users/<user>`)

Ezt az ellenőrzést nem lehet megkerülni. Ha egy veszélyes könyvtárban próbálja meg futtatni a autohand alkalmazást, hibaüzenetet fog látni, és meg kell adnia egy biztonságos projektkönyvtárat.
```bash
# This will be blocked
cd ~ && autohand
# Error: Unsafe Workspace Directory

# This works
cd ~/projects/my-app && autohand
```
A részletekért lásd a [Workspace Safety](./workspace-safety.md) részt.

---

## UI beállítások
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
| Mező | Típus | Alapértelmezett | Leírás |
| ----------------------------- | ------ | ------- | ---------------------------------------------------------------------------------------------- |
| `theme` | húr | `"dark"` | Színes téma a terminál kimenetéhez. A beépítettek a következők: `dark`, `light`, `dracula`, `sandy`, `tui`, `github-dark`, `cappadocia`, CODE és ___8__ `australia`. A régi `turkey` és `brazil` értékek továbbra is betöltődnek álnévként. |
| `customThemes` | tárgy | `{}` | Soron belüli egyéni témadefiníciók a téma nevével. A használatához állítsa be a `theme` kulcsot ugyanarra a kulcsra.   |
| `autoConfirm` | logikai | `false` | A biztonságos működés érdekében hagyja ki a megerősítő felszólításokat |
| `readFileCharLimit` | szám | `300` | Maximum megjeleníthető karakter az olvasási/kereső eszköz kimenetéből (a teljes tartalom továbbra is elküldésre kerül a modellnek) |
| `silentToolOutput` | logikai | `false` | A szerszám kimeneti blokkjainak elrejtése a terminálban, miközben továbbra is megőrzi a modell/munkamenet szerszámeredményeit |
| `activityVerbs` | karakterlánc vagy karakterlánc[] | beépített medence | Egyéni tevékenység ige vagy igekészlet a munkajelzőhöz, `Verb...` formátumban |
| `activityVerbsEnabled` | logikai | `true` | Forgó tevékenység igék megjelenítése, például `Compiling...`, miközben az ügynök dolgozik |
| `activitySymbol` | húr | `"✳"` | A tevékenységi ige előtt látható szimbólum a tevékenységmutató kimenetében |
| `statusLine.showProviderModel` | logikai | `true` | Jelenítse meg az aktív szolgáltatót és modellt a szerző állapotsorában |
| `statusLine.showContext` | logikai | `true` | Jelenítse meg a kontextus százalékos arányát a szerző állapotsorában |
| `statusLine.showCommandHint` | logikai | `true` | Parancs, említés, készség és terminálbejegyzési tippek megjelenítése a szerző állapotsorában |
| `statusLine.showPullRequest` | logikai | `true` | Mutassa meg a kapcsolódó lekérési kérés számát, vagy `PR #123`, ha nincs PR társítva |
| `statusLine.showSessionLines` | logikai | `false` | Az aktuális munkamenet során hozzáadott és eltávolított sorok megjelenítése |
| `statusLine.showQueue` | logikai | `true` | A sorba állított kérések számának megjelenítése az állapotsorban |
| `statusLine.showActiveStatus` | logikai | `true` | Az aktív forduló állapotszövege megjelenítése, miközben az ügynök dolgozik |
| `statusLine.showActiveMetrics` | logikai | `true` | Az eltelt idő és a token mérőszámainak megjelenítése, amíg az ügynök dolgozik |
| `statusLine.showCancelHint` | logikai | `true` | Az Esc megszakítási tipp megjelenítése, miközben az ügynök dolgozik |
| `completionReportEnabled` | logikai | `true` | Kérje meg a modellt, hogy a végrehajtott műveleti körök után tartalmazzon egy tömör befejezési jelentést |
| `showCompletionNotification` | logikai | `true` | Rendszerértesítés megjelenítése a feladat befejezésekor |
| `showThinking` | logikai | `true` | Az LLM érvelésének/gondolati folyamatának megjelenítése |
| `terminalBell` | logikai | `true` | Csengessen terminálcsengőt, amikor a feladat befejeződött (jelvényt mutat a terminálfülön/dokkon) |
| `checkForUpdates` | logikai | `true` | CLI frissítések keresése indításkor |
| `updateCheckInterval` | szám | `24` | Órák a frissítési ellenőrzések között (a gyorsítótárazott eredményt az intervallumon belül használja) |

Az egyéni témák bármely szemantikai színtokent felülírhatnak. A hiányzó tokenek a sötét témából származnak:
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
Megjegyzés: A `readFileCharLimit` és `silentToolOutput` csak a terminál megjelenítését érinti. A teljes tartalom továbbra is elküldésre kerül a modellnek, és eszközüzenetekben tárolódik.

A néma eszközkimenetet a fájl szerkesztése nélkül is átkapcsolhatja:
```bash
autohand config set silent_tool_output true
autohand config set silent_tool_output false
```
A forgó tevékenység igék között válthat a fájl szerkesztése nélkül:
```bash
autohand config set verbs activity true
autohand config set verbs activity false
```
Szabja testre az igéket a konfigurációs fájlban, ha rögzített állapotcímkét vagy kis projektspecifikus elforgatást szeretne:
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
A `activityVerbs` egyetlen karakterláncot vagy nem üres karakterlánc-tömböt fogad el. Ha a `activityVerbsEnabled` értéke `false`, a Autohand visszaesik a `Working...` értékre, ahelyett, hogy az egyéni vagy beépített igék között forogna.

A fájl szerkesztése nélkül válthat a befejezési jelentések között, beleértve a strukturált `SITREP` promptot is:
```bash
autohand config set sitrep true
autohand config set sitrep false
```
### Terminal Bell

Ha a `terminalBell` engedélyezve van (alapértelmezett), a Autohand megszólal a terminál csengőjén (`\x07`), amikor egy feladat befejeződik. Ez kiváltja:

- **Jelvény a terminál lapon** - Vizuális jelzőt mutat, hogy a munka elkészült
- **Dokk ikon ugrál** - Felhívja a figyelmet, ha a terminál a háttérben van (macOS)
- **Hang** - Ha a terminál hangjai engedélyezve vannak a terminál beállításaiban

Terminálspecifikus beállítások:

- **macOS terminál**: Beállítások > Profilok > Speciális > Bell (vizuális/hallható)
- **iTerm2**: Beállítások > Profilok > Terminál > Értesítések
- **VS Code Terminal**: Beállítások > Terminál > Integrált: Bell engedélyezése

Letiltása:
```json
{
  "ui": {
    "terminalBell": false
  }
}
```
### Ink Renderer

A Autohand alapértelmezés szerint az Ink 7 + React 19 renderert használja az interaktív terminálokhoz. A régi `ui.useInkRenderer` konfigurációs mezőt figyelmen kívül hagyja, így a régi konfigurációs fájlok nem kényszeríthetik a sima terminálszerkesztőt. A tinta a következőket nyújtja:

- **Recgésmentes kimenet**: Minden UI-frissítés kötegelt React-egyeztetésen keresztül történik
- **Munkasor funkció**: Írja be az utasításokat, amíg az ügynök dolgozik
- **Jobb bemenetkezelés**: Nincsenek ütközések a readline-kezelők között
- **Összeállítható felhasználói felület**: A jövőbeni fejlett felhasználói felületi funkciók alapja

Vészhelyzeti tartalék a terminál kompatibilitás érdekében:
```bash
AUTOHAND_LEGACY_UI=1 autohand
```
Megjegyzés: Ez a funkció kísérleti jellegű, és lehetnek szélső esetek. Az alapértelmezett ora-alapú felhasználói felület stabil és teljesen működőképes marad.

### Frissítési ellenőrzés

Ha a `checkForUpdates` engedélyezve van (alapértelmezett), a Autohand indításkor ellenőrzi az új kiadásokat:
```
> Autohand v0.6.8 (abc1234) ✓ Up to date
```
Ha elérhető frissítés:
```
> Autohand v0.6.7 (abc1234) ⬆ Update available: v0.6.8
  ↳ Run: curl -fsSL https://autohand.ai/install.sh | sh
```
Hogyan működik:

- Lekéri a GitHub API legújabb kiadását
- A gyorsítótárak eredménye `~/.autohand/version-check.json`
- Csak egyszer ellenőrzi `updateCheckInterval` óránként (alapértelmezett: 24)
- Nem blokkoló: az indítás akkor is folytatódik, ha az ellenőrzés sikertelen

Letiltása:
```json
{
  "ui": {
    "checkForUpdates": false
  }
}
```
Vagy környezeti változón keresztül:
```bash
export AUTOHAND_SKIP_UPDATE_CHECK=1
```
---

## Ügynök beállításai

Az ügynök viselkedésének és iterációs korlátainak szabályozása.
```json
{
  "agent": {
    "maxIterations": 100,
    "enableRequestQueue": true,
    "toolSelectionCache": true,
    "autoMemory": true,
    "idleLogoutEnabled": true,
    "idleTimeoutMs": 3600000,
    "debug": false
  }
}
```
| Mező | Típus | Alapértelmezett | Leírás |
| -------------------- | ------- | ------- | ------------------------------------------------------------------------------ |
| `maxIterations` | szám | `100` | Maximális szerszámiterációk felhasználói kérésenként a leállítás előtt |
| `enableRequestQueue` | logikai | `true` | Lehetővé teszi a felhasználók számára, hogy kéréseket írjanak be és sorba állítsanak, miközben az ügynök dolgozik |
| `toolSelectionCache` | logikai | `true` | Gyorsítótárazza a körönkénti szerszámséma helyi kiválasztását az egyenértékű szerszámkiválasztási bemenethez |
| `autoMemory` | logikai | `true` | Tartós felhasználói/projektmemóriák kibontása és mentése sikeres interaktív fordulatok után |
| `idleLogoutEnabled` | logikai | `true` | Jelentkezzen ki a hitelesített interaktív munkamenetekből az üresjárati időtúllépés után |
| `idleTimeoutMs` | szám | `3600000` | Az inaktivitás ezredmásodpercei a hitelesített munkamenet kijelentkeztetése előtt (60 perc) |
| `debug` | logikai | `false` | Részletes hibakeresési kimenet engedélyezése (naplózza az ügynök belső állapotát az stderr-be) |

### Eszközséma kiválasztása

A Autohand nem küld el minden teljes eszközsémát minden LLM-kérelemnél. A rendszerprompt tartalmaz egy kompakt eszközképesség-katalógust, és minden kérés csak egy kis konkrét sémát tesz közzé, amely a következők közül választható ki:

- Az alapvető felderítési eszközök, például `tool_search`, `read_file`, `fff_find` és `fff_grep`
- Szándékhoz illő eszközök szerkesztési, ellenőrzési, git, böngésző, web, függőségi vagy projektkövetési munkákhoz
- A legutóbbi `tool_search` hívások során kért vagy kifejezetten név szerint megemlített eszközök

Ezzel elkerülhető a nagy előzetes kontextusköltség, ha az összes eszközséma elküldése a felhasználói szándék ismertsége előtt felmerül. `toolSelectionCache` csak a helyi választó gyorsítótárát vezérli az egyenértékű fordulatokhoz; nem hajt végre felhasználói előtti LLM-bemelegítést, és nem kényszerít ki nagy gyorsítótárazott prompt előtagot.

A helyi választó gyorsítótárának letiltása:
```json
{
  "agent": {
    "toolSelectionCache": false
  }
}
```
A hitelesített, régóta működő ügynöki munkamenetek életben tartásához, amíg munkára várnak:
```json
{
  "agent": {
    "idleLogoutEnabled": false
  }
}
```
Egyetlen folyamathoz használja a `autohand --no-idle-logout` kódot, vagy állítsa be a `AUTOHAND_NO_IDLE_LOGOUT=1` értéket.

Az inaktivitási idő módosításához állítsa az `idleTimeoutMs` értékét pozitív, ezredmásodpercben megadott időtartamra. Az alapértelmezett érték `3600000` (60 perc); az érvénytelen értékek az alapértelmezett értéket használják.

### Hibakeresési mód

Engedélyezze a hibakeresési módot az ügynök belső állapotának részletes naplózásához (reakcióhurok iterációi, prompt felépítés, munkamenet részletei). A kimenet az stderr-hez megy, hogy elkerülje a normál kimenet zavarását.

Háromféleképpen engedélyezheti a hibakeresési módot (elsőbbségi sorrendben):

1. **CLI jelző**: `autohand -d` vagy `autohand --debug`
2. **Környezeti változó**: `AUTOHAND_DEBUG=1`
3. **Konfigurációs fájl**: Állítsa be: `agent.debug: true`

### Kérési sor

Ha a `enableRequestQueue` engedélyezve van, folytathatja az üzenetek beírását, miközben az ügynök feldolgoz egy korábbi kérést. A bevitel a sorba kerül, és automatikusan feldolgozásra kerül, amikor az aktuális feladat befejeződik.

- Írja be az üzenetet, és nyomja meg az Enter billentyűt, hogy hozzáadja a sorhoz
- Az állapotsor azt mutatja, hogy hány kérés van sorban
- A kérések feldolgozása FIFO (first-in, first-out) sorrendben történik
- A sor maximális mérete 10 kérés

---

## Engedélyek beállításai

A szerszámengedélyek finom vezérlése.
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

| Érték | Leírás |
| ----------------- | ------------------------------------------------------ |
| `"interactive"` | Jóváhagyás kérése veszélyes műveletekhez (alapértelmezett) |
| `"unrestricted"` | Nincsenek felszólítások, engedélyezzen mindent |
| `"restricted"` | Minden veszélyes művelet megtagadása |

### `whitelist`

Szerszámminták sora, amelyek soha nem igényelnek jóváhagyást.
```json
["run_command:npm *", "run_command:bun test"]
```
### `blacklist`

Mindig blokkolt szerszámminták tömbje.
```json
["run_command:rm -rf /", "run_command:sudo *"]
```
### `rules`

Finom szemcsés engedélyezési szabályok.

| Mező | Típus | Leírás |
| --------- | --------- | -------------------------------------------- | ---------- | -------------- |
| `tool` | húr | A megfelelő eszköznév |
| `pattern` | húr | Opcionális minta az érvekhez való illeszkedéshez |
| `action` | `"allow"` | `"deny"` | `"prompt"` | Intézkedések |

### `rememberSession`

| Típus | Alapértelmezett | Leírás |
| ------- | ------- | -------------------------------------------- |
| logikai | `true` | Emlékezzen az ülés jóváhagyási határozataira |

### Helyi projektengedélyek

Minden projektnek saját engedélybeállításai lehetnek, amelyek felülírják a globális konfigurációt. Ezeket a projekt gyökérkönyvtárában a `.autohand/settings.local.json` tartalmazza.

Amikor jóváhagy egy fájlműveletet (szerkesztés, írás, törlés), a rendszer automatikusan ebbe a fájlba menti, így nem kéri újra ugyanazt a műveletet ebben a projektben.
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
**Hogyan működik:**

- Amikor jóváhagy egy műveletet, a rendszer a következőbe menti: `.autohand/settings.local.json`
- Legközelebb ugyanazt a műveletet a rendszer automatikusan jóváhagyja
- A helyi projektbeállítások egyesülnek a globális beállításokkal (a helyi beállítások elsőbbséget élveznek)
- Adja hozzá a `.autohand/settings.local.json` kódot a `.gitignore`-hoz, hogy a személyes beállítások privátak maradjanak

**Mintaformátum:**

- `tool_name:path` - Fájlműveletekhez (pl. `apply_patch:src/file.ts`)
- `tool_name:command args` - Parancsokhoz (pl. `run_command:npm test`)

### Megtekintési engedélyek

Jelenlegi engedélybeállításait kétféleképpen tekintheti meg:

**CLI jelző (nem interaktív):**
```bash
autohand --permissions
```
Ez a következőket jeleníti meg:

- Jelenlegi engedélyezési mód (interaktív, korlátlan, korlátozott)
- Munkaterület és konfigurációs fájlok elérési útjai
- Minden jóváhagyott minta (engedélyezőlista)
- Minden elutasított minta (feketelista)
- Összefoglaló statisztika

**Interaktív parancs:**
```
/permissions
```
Interaktív módban a `/permissions` parancs ugyanazokat az információkat és lehetőségeket biztosít a következőkhöz:

- Elemek eltávolítása az engedélyezési listáról
- Távolítsa el az elemeket a feketelistáról
- Törölje az összes mentett engedélyt

---

## Patch mód

A Patch mód lehetővé teszi megosztható, git-kompatibilis javítás létrehozását a munkaterület-fájlok módosítása nélkül. Ez hasznos:

- A kód felülvizsgálata a változtatások alkalmazása előtt
- Az AI által generált változások megosztása a csapat tagjaival
- Reprodukálható változáskészletek készítése
- CI/CD folyamatok, amelyeknek alkalmazása nélkül kell rögzíteni a változásokat

### Használat
```bash
# Generate patch to stdout
autohand --prompt "add user authentication" --patch

# Save to file
autohand --prompt "add user authentication" --patch --output auth.patch

# Pipe to file (alternative)
autohand --prompt "refactor api handlers" --patch > refactor.patch
```
### Viselkedés

Ha `--patch` meg van adva:

- **Automatikus megerősítés**: Minden visszaigazolás automatikusan elfogadásra kerül (`--yes`)
- **Nincsenek felszólítások**: Nem jelennek meg jóváhagyási értesítések (`--unrestricted` vélelmezett)
- **Csak előnézet**: A változtatásokat rögzíti, de NEM írja lemezre
- **Kikényszerített biztonság**: A feketelistán szereplő műveletek (`.env`, SSH-kulcsok, veszélyes parancsok) továbbra is blokkolva vannak

### Javítások alkalmazása

A címzettek szabványos git parancsokkal alkalmazhatják a javítást:
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
### Patch formátum

A generált javítás a git egységes diff formátumát követi:
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
### Kilépési kódok

| Kód | Jelentése |
| ---- | ---------------------------------------------------- |
| `0` | Siker, patch generált |
| `1` | Hiba (hiányzó `--prompt`, engedély megtagadva stb.) |

### Kombinálva más zászlókkal
```bash
# Use specific model
autohand --prompt "optimize queries" --patch --model gpt-4o

# Specify workspace
autohand --prompt "add tests" --patch --path ./my-project

# Use custom config
autohand --prompt "refactor" --patch --config ~/.autohand/work.json
```
### Csapatmunkafolyamat-példa
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

## Hálózati beállítások
```json
{
  "network": {
    "maxRetries": 3,
    "timeout": 30000,
    "retryDelay": 1000
  }
}
```
| Mező | Típus | Alapértelmezett | Max | Leírás |
| ------------ | ------ | ------- | --- | --------------------------------------- |
| `maxRetries` | szám | `3` | `5` | Próbálkozzon újra sikertelen API-kérésekkel |
| `timeout` | szám | `30000` | - | Kérelem időtúllépése ezredmásodpercben |
| `retryDelay` | szám | `1000` | - | Az újrapróbálkozások közötti késleltetés ezredmásodpercben |

---

## Telemetriai beállítások

A telemetria **alapértelmezés szerint le van tiltva** (feliratkozás). Engedélyezze a Autohand fejlesztéséhez.
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
| Mező | Típus | Alapértelmezett | Leírás |
| -------------------- | ------- | -------------------------- | ---------------------------------------------- |
| `enabled` | logikai | `false` | Telemetria engedélyezése/letiltása (feliratkozás) |
| `apiBaseUrl` | húr | `https://api.autohand.ai` | Telemetria API végpont |
| `batchSize` | szám | `20` | Az automatikus kiürítés előtt kötegelt események száma |
| `flushIntervalMs` | szám | `60000` | Öblítési időköz ezredmásodpercben (1 perc) |
| `maxQueueSize` | szám | `500` | Maximális sorméret a régi események eldobása előtt |
| `maxRetries` | szám | `3` | Próbálkozzon újra sikertelen telemetriai kérések esetén |
| `enableSessionSync` | logikai | `true` | Szinkronizálja a munkameneteket a felhővel a csapatfunkciókhoz, ha a telemetria engedélyezve van |
| `companySecret` | húr | `""` | Vállalati titok API-hitelesítéshez |

A szolgáltató/modell telemetria tartalmazza az aktív szolgáltatói azonosítót, a modellazonosítót és az elérhető nem titkos metaadatokat, például az egyéni szolgáltató megjelenítési nevét, API-formátumát, érvelési erőfeszítéseit és kontextusablakát. Az API-kulcsok és a vivőjogkivonatok soha nem szerepelnek benne.

---

## Külső ügynökök

Egyéni ügynökdefiníciók betöltése külső könyvtárakból.
```json
{
  "externalAgents": {
    "enabled": true,
    "paths": ["~/.autohand/agents", "/team/shared/agents"]
  }
}
```
| Mező | Típus | Alapértelmezett | Leírás |
| --------- | -------- | ------- | -------------------------------- |
| `enabled` | logikai | `false` | Külső ügynök betöltésének engedélyezése |
| `paths` | string[] | `[]` | Könyvtárak az ügynökök betöltéséhez |

---

## Skills System

A készségek olyan utasításcsomagok, amelyek speciális utasításokat adnak az AI-ügynöknek. Úgy működnek, mint az igény szerinti `AGENTS.md` fájlok, amelyek bizonyos feladatokhoz aktiválhatók.

### Készségek felfedező helyek

A készségek több helyről fedezhetők fel, és a későbbi források élveznek elsőbbséget:

| Helyszín | Forrásazonosító | Leírás |
| ----------------------------------------- | ------------------- | ------------------------------------------ |
| `~/.codex/skills/**/SKILL.md` | `codex-user` | Felhasználói szintű Codex készségek (rekurzív) |
| `~/.claude/skills/*/SKILL.md` | `claude-user` | Felhasználói szintű Claude-készségek (egy szint) |
| `~/.autohand/skills/**/SKILL.md` | `autohand-user` | Felhasználói szintű Autohand készségek (rekurzív) |
| `<project>/.claude/skills/*/SKILL.md` | `claude-project` | Projektszintű Claude-készségek (egy szint) |
| `<project>/.autohand/skills/**/SKILL.md` | `autohand-project` | Projekt szintű Autohand készségek (rekurzív) |

### Automatikus másolási viselkedés

A Codex vagy Claude helyekről felfedezett készségek automatikusan átmásolódnak a megfelelő Autohand helyre:

- `~/.codex/skills/` és `~/.claude/skills/` → `~/.autohand/skills/`
- `<project>/.claude/skills/` → `<project>/.autohand/skills/`

A Autohand helyeken meglévő készségek soha nem íródnak felül.

### SKILL.md formátum

A YAML frontmatter-t használó készségek, majd a leértékelési tartalom:
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
| Mező | Kötelező | Max hossz | Leírás |
| ---------------- | -------- | ---------- | ------------------------------------------- |
| `name` | Igen | 64 karakter | Kisbetűs alfanumerikus, csak kötőjelekkel |
| `description` | Igen | 1024 karakter | A készség rövid leírása |
| `license` | Nem | - | Licencazonosító (pl. MIT, Apache-2.0) |
| `compatibility` | Nem | 500 karakter | Kompatibilitási megjegyzések |
| `allowed-tools` | Nem | - | Az engedélyezett eszközök szóközzel tagolt listája |
| `metadata` | Nem | - | További kulcs-érték metaadatok |

### Beviteli előtagok

A Autohand támogatja a speciális előtagokat a beviteli promptban:

| Előtag | Leírás | Példa |
| ------ | ------------------------------- | ---------------------------------- |
| `/` | Slash parancsok | `/help`, `/model`, `/quit`, `/exit` |
| `@` | Fájl említések (automatikus kiegészítés) | `@src/index.ts` |
| `$` | Szakértelem említése (automatikus kiegészítés) | `$frontend-design`, `$code-review` |
| `!` | A terminálparancsok közvetlen futtatása | `! git status`, `! ls -la` |

**Képességmegemlítések (`$`):**

- Írja be a következőt: `$`, majd karaktereket az automatikus kiegészítéssel elérhető készségek megtekintéséhez
- A Tab elfogadja a felső javaslatot (pl. `$frontend-design`)
- A készségek a következőből fedezhetők fel: `~/.autohand/skills/` és `<project>/.autohand/skills/`
- Az aktivált készségek a prompthoz vannak csatolva, mint speciális utasítások az aktuális munkamenethez
- Az előnézeti panel a készség metaadatait mutatja (név, leírás, aktiválási állapot)

**Shell-parancsok (`!`):**

- A parancsok az aktuális munkakönyvtárban futnak
- A kimenet közvetlenül a terminálon jelenik meg
- Nem megy az LLM-be
- 30 másodperces időtúllépés
- A végrehajtás után visszatér a prompthoz

### Slash parancsok

#### `/skills` - Csomagkezelő

| Parancs | Leírás |
| -------------------------------- | ------------------------------------------- |
| `/skills` | Sorolja fel az összes elérhető készséget |
| `/skills use <name>` | Képesség aktiválása az aktuális munkamenethez |
| `/skills deactivate <name>` | Készség deaktiválása |
| `/skills info <name>` | Részletes képzettségi információk megjelenítése |
| `/skills install` | Tallózás és telepítés a közösségi nyilvántartásból |
| `/skills install @<slug>` | Telepítsen közösségi készségeket a slug |
| `/skills search <query>` | Keresés a közösségi készségek nyilvántartásában |
| `/skills trending` | Felkapott közösségi készségek megjelenítése |
| `/skills remove <slug>` | Közösségi készség eltávolítása |
| `/skills new` | Hozzon létre új készségeket interaktívan |
| `/skills feedback <slug> <1-5>` | Értékeljen egy közösségi képességet |

#### `/learn` - LLM-alapú Skill Advisor

| Parancs | Leírás |
| ---------------- | ---------------------------------------------------------------- |
| `/learn` | A projekt elemzése és készségek ajánlása (gyors szkennelés) |
| `/learn deep` | Mélyszkennelési projekt (forrásfájlokat olvas) a célzottabb eredmények érdekében |
| `/learn update` | A projekt újraelemzése és az LLM által generált elavult készségek regenerálása |

A `/learn` kétfázisú LLM-folyamatot használ:

1. **1. fázis – Elemzés + Rangsorolás + Ellenőrzés**: Ellenőrzi a projekt szerkezetét, auditálja a telepített készségeket redundanciák/konfliktusok szempontjából, és rangsorolja a közösségi készségeket relevancia szerint (0-100).
2. **2. fázis – Létrehozás** (feltételes): Ha egyik közösségi képesség sem ér el 60 feletti pontszámot, felajánlja a projektjéhez szabott egyéni képesség létrehozását.
A generált készségek metaadatokat (`agentskill-source: llm-generated`, `agentskill-project-hash`) tartalmaznak, így a `/learn update` képes észlelni, ha megváltozik a kódbázis, és újra előállíthatja az elavult készségeket.

### Automatikus készséggenerálás (`--auto-skill`)

A `--auto-skill` CLI jelző készségeket generál az interaktív tanácsadói folyamat nélkül:
```bash
autohand --auto-skill
```
Ez:

1. Elemezze a projekt felépítését (package.json, követelmények.txt stb.)
2. Nyelvek, keretrendszerek és minták észlelése
3. Generáljon 3 releváns készséget az LLM segítségével
4. Mentse el a készségeket ide: `<project>/.autohand/skills/`

A célzottabb, interaktívabb élmény érdekében használja inkább a `/learn` kódot egy munkameneten belül.

Az észlelt minták a következők:

- **Nyelvek**: TypeScript, JavaScript, Python, Rust, Go
- **Frameworks**: React, Next.js, Vue, Express, Flask, Django
- **Minták**: CLI eszközök, tesztelés, monorepo, Docker, CI/CD

---

## API beállítások

Backend API konfiguráció a csapatfunkciókhoz.
```json
{
  "api": {
    "baseUrl": "https://api.autohand.ai",
    "companySecret": "sk-team-xxx"
  }
}
```
| Mező | Típus | Alapértelmezett | Leírás |
| ---------------- | ------ | -------------------------- | ---------------------------------------- |
| `baseUrl` | húr | `https://api.autohand.ai` | API-végpont |
| `companySecret` | húr | - | Csapat/vállalati titok a megosztott funkciókhoz |

Környezeti változókkal is beállítható:

- `AUTOHAND_API_URL` → `api.baseUrl`
- `AUTOHAND_SECRET` → `api.companySecret`

---

## Hitelesítési beállítások

Hitelesítés és felhasználói munkamenet konfigurálása.
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
| Mező | Típus | Alapértelmezett | Leírás |
| ------------- | ------ | ------- | --------------------------------------------- |
| `token` | húr | - | Hitelesítési token API-hozzáféréshez |
| `user` | tárgy | - | Hitelesített felhasználói adatok |
| `user.id` | húr | - | Felhasználói azonosító |
| `user.email` | húr | - | Felhasználó e-mail címe |
| `user.name` | húr | - | Felhasználó megjelenített név |
| `user.avatar` | húr | - | Felhasználói avatar URL-je (nem kötelező) |
| `expiresAt` | húr | - | Token lejárati időbélyegzője (ISO 8601 formátum) |

---

## Közösségi készségek beállításai

Konfiguráció a közösségi készségek felfedezéséhez és kezeléséhez.
```json
{
  "communitySkills": {
    "enabled": true,
    "showSuggestionsOnStartup": true,
    "autoBackup": true
  }
}
```
| Mező | Típus | Alapértelmezett | Leírás |
| --------------------------- | ------- | ------- | -------------------------------------------------------------- |
| `enabled` | logikai | `true` | Közösségi készségek funkcióinak engedélyezése |
| `showSuggestionsOnStartup` | logikai | `true` | Képességi javaslatok megjelenítése indításkor, ha nem állnak rendelkezésre szállítói ismeretek |
| `autoBackup` | logikai | `true` | A felfedezett szállítói ismeretek automatikus biztonsági mentése API |

---

## Megosztási beállítások

Konfiguráció a munkamenet megosztásához a `/share` paranccsal. A munkamenetek a [autohand.link](https://autohand.link) címen találhatók.
```json
{
  "share": {
    "enabled": true
  }
}
```
| Mező | Típus | Alapértelmezett | Leírás |
| --------- | ------- | ------- | ------------------------------------ |
| `enabled` | logikai | `true` | A `/share` parancs engedélyezése/letiltása |

### YAML formátum
```yaml
share:
  enabled: true
```
### Munkamenet-megosztás letiltása

Ha biztonsági vagy adatvédelmi okokból ki szeretné kapcsolni a munkamenet-megosztást:
```json
{
  "share": {
    "enabled": false
  }
}
```
Ha le van tiltva, a `/share` futtatásakor a következő jelenik meg:
```
Session sharing is disabled.
To enable, set share.enabled: true in your config file.
```
---

## Beállítások szinkronizálása

A Autohand szinkronizálhatja a konfigurációt az eszközök között a bejelentkezett felhasználók számára. A beállításokat a Cloudflare R2 biztonságosan tárolja, és a feltöltés előtt titkosítja.
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
| Mező | Típus | Alapértelmezett | Leírás |
| ------------------- | -------- | ---------------- | --------------------------------------------------- |
| `enabled` | logikai | `true` (naplózva) | Beállítások szinkronizálásának engedélyezése/letiltása |
| `interval` | szám | `300000` | Szinkronizálási idő ezredmásodpercben (alapértelmezett: 5 perc) |
| `exclude` | string[] | `[]` | Globális minták a szinkronizálásból kizárandó |
| `includeTelemetry` | logikai | `false` | Telemetriai adatok szinkronizálása (felhasználói hozzájárulás szükséges) |
| `includeFeedback` | logikai | `false` | Visszajelzési adatok szinkronizálása (felhasználói hozzájárulás szükséges) |

### CLI zászló
```bash
# Disable sync for this session
autohand --sync-settings=false

# Enable sync (default for logged users)
autohand --sync-settings
```
### Mi lesz szinkronizálva

Alapértelmezés szerint ezek az elemek szinkronizálva vannak a bejelentkezett felhasználók számára:

- **Konfiguráció** (`config.json`) - Az API-kulcsok a feltöltés előtt titkosítva vannak
- **Egyéni ügynökök** (`agents/`)
- **Közösségi készségek** (`community-skills/`)
- **Felhasználói akasztók** (`hooks/`)
- **Memória** (`memory/`)
- **Projektismeret** (`projects/`)
- **Munkamenetek előzményei** (`sessions/`)
- **Megosztott tartalom** (`share/`)
- **Egyéni készségek** (`skills/`)

### Mi nem szinkronizál (alapértelmezés szerint)

- **Eszközazonosító** (`device-id`) - Eszközönként egyedi
- **Hibanaplók** (`error.log`) - Csak helyi
- **Verziógyorsítótár** (`version-*.json`) - Helyi gyorsítótár fájlok

### Beleegyezés alapú szinkronizálás

Ezek az elemek kifejezett feliratkozást igényelnek a konfigurációban:

- **Telemetriai adatok** - Állítsa be a `sync.includeTelemetry: true` szinkronizálást
- **Visszajelzési adatok** - Állítsa be a `sync.includeFeedback: true` szinkronizálását
```json
{
  "sync": {
    "enabled": true,
    "includeTelemetry": true,
    "includeFeedback": true
  }
}
```
### Konfliktusmegoldás

Ha ütközések lépnek fel (ugyanaz a fájl több eszközön módosítva), a **felhőverzió nyer**. Ez biztosítja a következetességet az új eszközökön való bejelentkezéskor.

### Biztonság

A `config.json` API-kulcsait és egyéb bizalmas adatait a rendszer a hitelesítési token segítségével titkosítja a feltöltés előtt. Csak az Ön hitelesítő adataival lehet visszafejteni.

**Mi van titkosítva:**

- `apiKey` nevű mezők
- `Key`, `Token`, `Secret` végződő mezők
- A `password` mező

### Hogyan működik

1. **Indításkor**: Ha be van jelentkezve, a szinkronizálási szolgáltatás automatikusan elindul
2. **5 percenként**: A beállításokat összehasonlítja a felhőalapú tárolással
3. **A felhő nyer**: A távoli módosítások letöltése először történik meg
4. **Helyi feltöltések**: Új helyi módosítások kerülnek feltöltésre
5. **Kilépéskor**: A szinkronizálási szolgáltatás kecsesen leáll

### Fájlok kizárása

Kizárhat bizonyos fájlokat vagy mintákat a szinkronizálásból:
```json
{
  "sync": {
    "enabled": true,
    "exclude": ["custom-local-config.json", "temp/*"]
  }
}
```
### YAML formátum
```yaml
sync:
  enabled: true
  interval: 300000
  exclude: []
  includeTelemetry: false
  includeFeedback: false
```
---

## MCP beállítások

Állítsa be az MCP-kiszolgálókat (Model Context Protocol) a Autohand külső eszközökkel történő bővítésére.
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

- **Típus**: `boolean`
- **Alapértelmezett**: `true`
- **Leírás**: Az összes MCP-támogatás engedélyezése vagy letiltása. Ha `false`, akkor az indításkor nem csatlakozik szerver, és az MCP-eszközök nem érhetők el.

### `mcp.servers`

- **Típus**: `McpServerConfigEntry[]`
- **Alapértelmezett**: `[]`
- **Leírás**: MCP szerver konfigurációk tömbje.

### Szerver beviteli mezői

| Mező | Típus | Kötelező | Alapértelmezett | Leírás |
| ------------- | --------------------------------- | -------------- | ------- | -------------------------------------------------------------- |
| `name` | `string` | Igen | - | Egyedi szerverazonosító |
| `transport` | `"stdio"` \| `"sse"` \| `"http"` | Igen | - | Szállítás típusa |
| `command` | `string` | Igen (stdio) | - | Parancs a szerverfolyamat elindításához |
| `args` | `string[]` | Nem | `[]` | Érvek a parancs mellett |
| `url` | `string` | Igen (sse/http) | - | Szervervégpont URL |
| `headers` | `Record<string, string>` | Nem | `{}` | Egyéni HTTP-fejlécek http/sse szállításhoz (pl. hitelesítési tokenek) |
| `env` | `Record<string, string>` | Nem | `{}` | A kiszolgálónak átadott környezeti változók |
| `autoConnect` | `boolean` | Nem | `true` | Automatikus csatlakozás indításkor |

> A szerverek aszinkron módon csatlakoznak a háttérben az indítás során anélkül, hogy blokkolnák a promptot. A `/mcp` segítségével interaktívan kezelheti a szervereket, vagy a `/mcp add` segítségével böngészhet a közösségi nyilvántartásban, vagy adhat hozzá egyéni szervereket.

> A teljes MCP-dokumentációért lásd: [docs/mcp.md](mcp.md).

---

## Hooks beállítások

Konfiguráció életciklus-horogokhoz, amelyek shell-parancsokat futtatnak az ügynökeseményeken. A részletekért lásd a [Hooks dokumentációt] (./hooks.md).
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

| Mező | Típus | Alapértelmezett | Leírás |
| --------- | ------- | ------- | ---------------------------------- |
| `enabled` | logikai | `true` | Az összes hook engedélyezése/letiltása globálisan |
| `hooks` | tömb | `[]` | Horogdefiníciók tömbje |

### Hook meghatározása

| Mező | Típus | Kötelező | Alapértelmezett | Leírás |
| ------------- | ------- | -------- | ------- | --------------------------------- |
| `event` | húr | Igen | - | Bekapcsolandó esemény |
| `command` | húr | Igen | - | Shell parancs végrehajtásához |
| `description` | húr | Nem | - | A `/hooks` kijelző leírása |
| `enabled` | logikai | Nem | `true` | Aktív-e a horog |
| `timeout` | szám | Nem | `5000` | Időtúllépés ezredmásodpercben |
| `async` | logikai | Nem | `false` | Futtasson blokkolás nélkül |
| `filter` | tárgy | Nem | - | Szűrés szerszám vagy útvonal szerint |

### Hook események

| Esemény | Amikor kirúgták |
| ---------------- | -------------------------------------- |
| `pre-tool` | Mielőtt bármilyen eszköz végrehajtaná |
| `post-tool` | A szerszám befejezése után |
| `file-modified` | A fájl létrehozásakor/módosításakor/törlésekor |
| `pre-prompt` | Mielőtt elküldené az LLM-nek |
| `post-response` | Miután az LLM válaszol |
| `session-error` | Hiba esetén |

### Környezeti változók

Amikor a hook fut, ezek a környezeti változók állnak rendelkezésre:

| Változó | Leírás |
| ----------------- | ---------------------------- |
| `HOOK_EVENT` | Esemény neve |
| `HOOK_WORKSPACE` | Munkaterület gyökérútvonala |
| `HOOK_TOOL` | Szerszámnév (szerszámesemények) |
| `HOOK_ARGS` | JSON-kódolt eszköz args |
| `HOOK_SUCCESS` | igaz/hamis (utóeszköz) |
| `HOOK_PATH` | Fájl elérési útja (fájlmódosított) |
| `HOOK_TOKENS` | Felhasznált tokenek (válasz után) |

---

## Chrome-bővítmény beállításai

Irányítsd a Autohand Chrome-bővítmény integrációját. Tekintse meg a teljes útmutatót: [Autohand Chrome-ban](./autohand-in-chrome.md).
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
| Kulcs | Típus | Alapértelmezett | Leírás |
| ------------------- | --------- | -------- | -------------------------------------------------------------------------- |
| `extensionId` | `string` | — | Telepített Chrome-bővítményazonosító a közvetlen átadáshoz |
| `enabledByDefault` | `boolean` | `false` | A böngészőhíd automatikus indítása a CLI |-vel
| `browser` | `string` | `"auto"` | Előnyben részesített Chromium böngésző: `auto`, `chrome`, `chromium`, `brave`, `edge` |
| `userDataDir` | `string` | — | Böngésző felhasználói adatok könyvtára a megfelelő profil megcélzásához |
| `profileDirectory` | `string` | — | Böngészőprofil-könyvtár neve (pl. `"Default"`, `"Profile 1"`) |
| `installUrl` | `string` | — | Tartalék URL, ha a bővítményazonosító nincs konfigurálva |

### CLI zászlók
```bash
autohand --chrome          # Start with browser bridge enabled
autohand --no-chrome       # Start with browser bridge disabled
```
### Slash parancsok
```
/browser                   # Open Chrome integration panel
/browser disconnect        # Close the browser bridge connection
```
---

## Teljes példa

### JSON formátum (`~/.autohand/config.json`)
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
    "idleTimeoutMs": 3600000,
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
### YAML formátum (`~/.autohand/config.yaml`)
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
  idleTimeoutMs: 3600000
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
### TOML formátum (`~/.autohand/config.toml`)
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
idleTimeoutMs = 3600000
debug = false

[permissions]
mode = "interactive"
whitelist = ["run_command:npm *", "run_command:bun *"]
blacklist = ["run_command:rm -rf /"]
rememberSession = true
```
---

## Címtárszerkezet

A Autohand az adatokat `~/.autohand/` (vagy `$AUTOHAND_HOME`) kódban tárolja:
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
**Projektszintű könyvtár** (a munkaterület gyökérkönyvtárában):
```
<project>/.autohand/
├── settings.local.json  # Local project permissions (gitignore this)
├── memory/              # Project-specific memory
├── skills/              # Project-specific skills
└── tools/               # Project-specific meta-tools
```
---

## CLI-jelzők (konfig felülbírálása)

Ezek a jelzők felülírják a konfigurációs fájl beállításait:

### Alapjelzők

| zászló | Leírás |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| `-v, --version` | Az aktuális verzió kiadása |
| `-p, --prompt [text]` | Futtasson egyetlen utasítást parancs módban |
| `--path <path>` | Munkaterület gyökér felülbírálása |
| `--config <path>` | Egyéni konfigurációs fájl használata |
| `--model <model>` | Modell felülírása |
| `--temperature <n>` | Beállított mintavételi hőmérséklet (0-1) |
| `--thinking [level]` | Gondolkodási/érvelési mélység beállítása (nincs, normál, kiterjesztett) |
| `-y, --yes` | Automatikus megerősítési kérések |
| `--dry-run` | Előnézet végrehajtás nélkül |
| `-d, --debug` | Részletes hibakeresési kimenet engedélyezése |
| `--bare` | Minimális explicit mód; beállítja a `AUTOHAND_CODE_SIMPLE=1` értéket és letiltja a perjel parancsokat |

### Engedélyek és biztonság

| zászló | Leírás |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| `--unrestricted` | Nincs jóváhagyási felszólítás |
| `--restricted` | Veszélyes műveletek megtagadása |
| `--permissions` | Jelenítse meg az aktuális engedélybeállításokat, és lépjen ki |
| `--no-idle-logout` | A hitelesített tétlen kijelentkezés letiltása a hosszan futó ügynöki munkamenetekhez |
| `--yolo [pattern]` | Eszközhívások megfelelő minta automatikus jóváhagyása (pl. `allow:read,write` vagy `deny:delete`) |
| `--timeout <seconds>` | Időtúllépés másodpercben az automatikus jóváhagyási módhoz |

### Git & Worktree

| zászló | Leírás |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| `--worktree [name]` | Munkamenet futtatása elszigetelt git-munkafán (opcionális munkafa/ág neve) |
| `--tmux` | Indítás egy dedikált tmux munkamenetben (az `--worktree`-t jelenti; nem használható a `--no-worktree` kóddal) |
| `--no-worktree` | A git munkafa elkülönítésének letiltása automatikus módban |
| `-c, --auto-commit` | Változások automatikus véglegesítése a feladatok elvégzése után |
| `--patch` | Git javítás generálása változtatások alkalmazása nélkül |
| `--output <file>` | A javítás kimeneti fájlja (a --patch-el együtt használatos) |

### Automatikus mód
| zászló | Leírás |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| `--auto-mode [prompt]` | Engedélyezze az interaktív automatikus módot, vagy indítson önálló hurkot egy soron belüli feladattal |
| `--max-iterations <n>` | Maximális automatikus módú iterációk (alapértelmezett: 50) |
| `--completion-promise <text>` | Befejezésjelző szövege (alapértelmezett: "KÉSZ") |
| `--checkpoint-interval <n>` | A Git minden N iterációt végrehajt (alapértelmezett: 5) |
| `--max-runtime <m>` | Maximális futási idő percekben (alapértelmezett: 120) |
| `--max-cost <d>` | Maximális API költség dollárban (alapértelmezett: 10) |
| `--interactive-on-complete` | Az automatikus mód vége után adja át közvetlenül az interaktív módba (csak TTY) |

### Készségek és tanulás

| zászló | Leírás |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| `--auto-skill` | Készségek automatikus generálása projektelemzés alapján (lásd még: `/learn` az interaktív tanácsadóhoz) |
| `--learn` | Futtassa a `/learn` készségtanácsadót nem interaktív módon (a javasolt készségek elemzése és telepítése) |
| `--learn-update` | A projekt újraelemzése és az LLM által generált elavult készségek nem interaktív módon történő regenerálása |
| `--skill-install [name]` | Telepítsen egy közösségi képességet (megnyitja a böngészőt, ha nincs megadva név) |
| `--project` | A készség telepítése projektszintre (a --skill-install funkcióval) |

### Hitelesítés és fiók

| zászló | Leírás |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| `--login` | Jelentkezzen be Autohand-fiókjába |
| `--logout` | Jelentkezzen ki Autohand-fiókjából |
| `--sync-settings` | A beállítások szinkronizálásának engedélyezése/letiltása (alapértelmezett: igaz a bejelentkezett felhasználók számára) |

### Beállítás és információ

| zászló | Leírás |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| `--setup` | Futtassa a telepítővarázslót a Autohand |
| `--about` | Információk megjelenítése a Autohand-ról (verzió, linkek, hozzájárulási információk) |
| `--feedback` | Visszajelzés küldése a Autohand csapatának |
| `--settings` | A Autohand beállításainak konfigurálása (ugyanaz, mint a `/settings` interaktív módban) |

### Munkaterület és könyvtárak

| zászló | Leírás |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| `--add-dir <path...>` | További könyvtárak hozzáadása a munkaterület hatóköréhez (többször is használható) |

### Futtatási módok

| zászló | Leírás |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| `--mode <mode>` | Futtatási mód: interaktív (alapértelmezett), rpc vagy acp |
| `--acp` | A --mode acp rövidítése (Agent Client Protocol over stdio) |
| `--teammate-mode <mode>` | Csapat megjelenítési mód: automatikus, folyamatban lévő vagy tmux |

### UI és nyelv

| zászló | Leírás |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| `--display-language <locale>` | Megjelenítési nyelv beállítása (pl. en, id, zh-cn, fr, de, ja) |
| `--search-engine <provider>` | Internetes keresőszolgáltató beállítása (google, brave, duckduckgo, párhuzamos) |
| `--cc, --context-compact` | Környezettömörítés engedélyezése (alapértelmezett: be) |
| `--no-cc, --no-context-compact` | Kontextustömörítés letiltása |

### Chrome integráció

| zászló | Leírás |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| `--chrome` | A Chrome böngésző integrációjának engedélyezése (ugyanaz, mint `/browser`) |
| `--no-chrome` | A Chrome böngésző integrációjának letiltása |

### Rendszerprompt

| zászló | Leírás |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| `--sys-prompt <value>` | Cserélje ki a teljes rendszerpromptot (soron belüli karakterlánc vagy fájl elérési útja) |
| `--append-sys-prompt <value>` | Hozzáfűzés a rendszerprompthoz (soron belüli karakterlánc vagy fájl elérési útja) |
| `--system-prompt <value>` | Cserélje ki a teljes rendszerpromptot (soron belüli karakterlánc vagy fájl elérési útja) |
| `--system-prompt-file <path>` | Cserélje le a teljes rendszerprompt a fájltartalommal |
| `--append-system-prompt <value>` | Hozzáfűzés a rendszerprompthoz (soron belüli karakterlánc vagy fájl elérési útja) |
| `--append-system-prompt-file <path>` | Fájl tartalmának hozzáfűzése a rendszerprompthoz |
| `--mcp-config <path>` | Töltsön be egy explicit MCP konfigurációs fájlt |
| `--agents <json\|path>` | Explicit beépített ügynökök JSON vagy explicit ügynökök könyvtárának betöltése |
| `--plugin-dir <path>` | Töltsön be egy explicit plugin/meta-tool könyvtárat |

### Kísérletváltási parancsok

| Parancs | Leírás |
| -------------------------------------- | ------------------------------------------------- |
| `autohand experiments list` | Sorolja fel a helyi és távoli funkciók azonosítóit, a forrást, az életciklus szakaszt és az állapotot |
| `autohand experiments status <feature>` | Mutasson egy szolgáltatáskapcsolót, konfigurációs elérési utat vagy távoli metaadatokat és állapotot |
| `autohand experiments refresh` | Távoli funkciójelzők letöltése a Autohand API-ból |
| `autohand experiments enable <feature>` | Konfigurációval támogatott szolgáltatáskapcsoló engedélyezése |
| `autohand experiments disable <feature>` | A konfigurációval támogatott szolgáltatáskapcsoló letiltása |

A távoli funkciójelzők lekérése innen: `/v1/feature-flags/evaluate`, gyorsítótár a `~/.autohand/feature-flags.json` címen történik, és az API által biztosított TTL lejárta után frissül. A `features.environment` segítségével válassza ki a távoli jelzőkörnyezetet, a `features.remoteOverrides` segítségével pedig a felhasználó által felülbírálható távoli jelzők helyi letiltásához.

A `usage_v2` egy kísérleti funkciókapcsoló a `/usage` irányítópulthoz és a továbbfejlesztett `/status` Használat laphoz. Engedélyezze a következővel: `autohand experiments enable usage_v2`.

A `token_usage_status` egy kísérleti funkciókapcsoló (konfigurációs útvonal `features.tokenUsageStatus`, alapértelmezés szerint kikapcsolva), amely a valós idejű tokenhasználatot mutatja a működő állapotsorban – kumulatív tokenek felfelé (`↑`) és lefelé (`↓`) plusz g kontextusban, cc. `↑15.7k ↓3.2k · context: 6.0% (15.7k/262.1k)`. A kontextusablak modellenként van feloldva az összes szolgáltatónál. Engedélyezze a következővel: `autohand experiments enable token_usage_status`.

---

## Slash parancsok

Az Autohand perjel parancsok gazdag készletét kínálja interaktív használatra. A javaslatok megtekintéséhez írja be a `/` kódot a REPL-be.

### Munkamenet-kezelés

| Parancs | Leírás |
| ------------- | ------------------------------------------------------ |
| `/quit` | Kilépés az aktuális munkamenetből |
| `/exit` | Kilépés az aktuális munkamenetből |
| `/new` | Új beszélgetés indítása (memóriakivonattal) |
| `/clear` | Tiszta beszélgetés automatikus memóriakivonással |
| `/session` | Az aktuális munkamenet részleteinek megjelenítése |
| `/sessions` | Korábbi munkamenetek listája |
| `/resume` | Előző munkamenet folytatása |
| `/history` | A munkamenet-előzmények böngészése oldalszámozással |
| `/undo` | Git módosítások és utolsó forduló visszaállítása |
| `/export` | Munkamenet exportálása markdown/JSON/HTML |
| `/share` | Aktuális munkamenet megosztása |
| `/status` | Munkamenet állapotának megjelenítése |
| `/usage` | Modell, szolgáltató, kontextus és használati korlátok megjelenítése |

### Modell és szolgáltató

| Parancs | Leírás |
| ------------- | ------------------------------------------------------ |
| `/model` | LLM-modell váltása vagy konfigurálása |
| `/cc` | Kézi környezet tömörítése |

### Projektbeállítás

| Parancs | Leírás |
| ------------- | ------------------------------------------------------ |
| `/init` | Hozzon létre `AGENTS.md` fájlt az aktuális könyvtárban |
| `/setup` | Futtassa a telepítővarázslót a Autohand | konfigurálásához
| `/add-dir` | Könyvtárak hozzáadása a munkaterület hatóköréhez |

### Ügynökök és csapatok

| Parancs | Leírás |
| ------------- | ------------------------------------------------------ |
| `/agents` | Az elérhető alügynökök listája |
| `/agents-new` | Hozzon létre egy új ügynököt a varázslón keresztül |
| `/squad` | Nyissa meg/kezelje az önálló Autohand Squad futtatókörnyezetet |
| `/team` | Csapat irányítása párhuzamos munkához |
| `/tasks` | Feladatok kezelése csapatban |
| `/message` | Üzenet küldése csapattársnak |

### Készségek

| Parancs | Leírás |
| ----------------- | --------------------------------------------------- |
| `/skills` | Készségek listája és kezelése |
| `/skills-new` | Új készség létrehozása |
| `/learn` | Tanulja meg és telepítse az ajánlott készségeket |

### Memória és beállítások

| Parancs | Leírás |
| ------------- | ------------------------------------------------------ |
| `/memory` | Tárolt emlékek megtekintése és kezelése |
| `/settings` | A Autohand beállításainak konfigurálása |
| `/statusline` | A szerző állapotsor mezőinek konfigurálása |
| `/experiments` | Kísérleti jellemzők kapcsolóinak váltása |
| `/sync` | Beállítások szinkronizálása eszközök között |
| `/import` | Importálhat munkameneteket, beállításokat, MCP-t, memóriát, készségeket és hook-okat a támogatott ügynökökről |

### Engedélyek és akasztók

| Parancs | Leírás |
| ------------- | ------------------------------------------------------ |
| `/permissions`| Szerszámengedélyek kezelése |
| `/hooks` | Életciklus-horogok kezelése |

### Hitelesítés

| Parancs | Leírás |
| ------------- | ------------------------------------------------------ |
| `/login` | Hitelesítés a Autohand API-val |
| `/logout` | Kijelentkezés a Autohand fiókból |

### Eszközök és segédprogramok

| Parancs | Leírás |
| ------------- | ------------------------------------------------------ |
| `/search` | Keresés az interneten |
| `/formatters` | Az elérhető kódformázók listája |
| `/lint` | Sorolja fel a rendelkezésre álló kódsorokat |
| `/completion` | Shell befejező szkriptek generálása |
| `/plan` | Megvalósítási terv létrehozása |
| `/review` | Kódellenőrzés végrehajtása |
| `/pr-review` | Lehívási kérelem áttekintése |

### IDE integráció

| Parancs | Leírás |
| ------------- | ------------------------------------------------------ |
| `/ide` | A futó IDE észlelése és csatlakozása |

### MCP (Model Context Protocol)

| Parancs | Leírás |
| ------------- | ------------------------------------------------------ |
| `/mcp` | Interaktív MCP-kiszolgálókezelő |

### Automatizálás

| Parancs | Leírás |
| ------------- | ------------------------------------------------------ |
| `/automode` | Indítsa el az autonóm kódolási módot |
| `/repeat` | Ismétlődő munkák ütemezése |
| `/yolo` | Yolo mód váltása (automatikus jóváhagyási eszközök) |

### Chrome integráció

| Parancs | Leírás |
| ------------- | ------------------------------------------------------ |
| `/browser` | A Chrome böngésző integrációjának engedélyezése |

### UI és kijelző

| Parancs | Leírás |
| ------------- | ------------------------------------------------------ |
| `/help` | Az elérhető perjel parancsok és tippek megjelenítése |
| `/about` | Információk megjelenítése a következőről: Autohand |
| `/theme` | Színtéma módosítása |
| `/language` | Kijelző nyelvének módosítása |
| `/feedback` | Visszajelzés küldése a Autohand csapatának |

---

## Rendszerprompt testreszabás
Autohand lehetővé teszi az AI-ügynök által használt rendszerprompt testreszabását. Ez speciális munkafolyamatok, egyedi utasítások vagy más rendszerekkel való integráció esetén hasznos.

### CLI zászlók

| zászló | Leírás |
| ------------------------------ | -------------------------------------------- |
| `--sys-prompt <value>` | Cserélje ki a teljes rendszerprompt |
| `--append-sys-prompt <value>` | Tartalom hozzáfűzése az alapértelmezett rendszerprompthoz |

Mindkét zászló elfogadja a következőket:

- **Inline karakterlánc**: Közvetlen szövegtartalom
- **Fájl elérési útja**: A promptot tartalmazó fájl elérési útja (automatikusan észlelve)

### Fájlútvonal észlelése

Egy érték fájlútvonalként kezelendő, ha:

- A következővel kezdődik: `./`, `../`, `/` vagy `~/`
- Windows meghajtóbetűjellel kezdődik (pl. `C:\`)
- A következővel végződik: `.txt`, `.md` vagy `.prompt`
- Útleválasztókat tartalmaz szóközök nélkül

Ellenkező esetben a rendszer soron belüli karakterláncként kezeli.

### `--sys-prompt` (Teljes csere)

Ha rendelkezésre áll, ez **teljesen lecseréli** az alapértelmezett rendszerpromptot. Az ügynök NEM tölti be:

- Alapértelmezett Autohand utasítások
- AGENTS.md projekt utasítások
- Felhasználói/projekt memóriák
- Aktív készségek
```bash
# Inline string
autohand --sys-prompt "You are a Python expert. Be concise." --prompt "Write hello world"

# From file
autohand --sys-prompt ./custom-prompt.txt --prompt "Explain this code"

# Home directory
autohand --sys-prompt ~/.autohand/prompts/python-expert.md --prompt "Debug this function"
```
**Példa egyéni prompt fájlra (`custom-prompt.txt`):**
```
You are a specialized Python debugging assistant.

Rules:
- Focus only on Python code
- Always explain the root cause
- Suggest fixes with code examples
- Be concise and direct
```
### `--append-sys-prompt` (Hozzáadás az alapértelmezetthez)

Ha rendelkezésre áll, ez **hozzáfűzi** a tartalmat a teljes alapértelmezett rendszerprompthoz. Az ügynök továbbra is betölti:

- Alapértelmezett Autohand utasítások
- AGENTS.md projekt utasítások
- Felhasználói/projekt memóriák
- Aktív készségek

A csatolt tartalom a legvégére kerül hozzáadásra.
```bash
# Inline string
autohand --append-sys-prompt "Always use TypeScript instead of JavaScript" --prompt "Create a function"

# From file
autohand --append-sys-prompt ./team-guidelines.md --prompt "Add error handling"
```
**Példa hozzáfűző fájl (`team-guidelines.md`):**
```
## Team Guidelines

- Use 2-space indentation
- Prefer functional patterns
- Add JSDoc comments to public APIs
- Run tests before committing
```
### Elsőbbség

Ha mindkét zászló rendelkezésre áll:

1. A `--sys-prompt` teljes elsőbbséget élvez
2. A `--append-sys-prompt` figyelmen kívül hagyva
```bash
# --append-sys-prompt is ignored in this case
autohand --sys-prompt "Custom only" --append-sys-prompt "This is ignored"
```
### Használati esetek

| Használati eset | Ajánlott zászló |
| ---------------------------------- | ---------------------- |
| Egyedi ügynök személye | `--sys-prompt` |
| Minimális utasítások | `--sys-prompt` |
| Csapatirányelvek hozzáadása | `--append-sys-prompt` |
| Projektkonvenciók hozzáadása | `--append-sys-prompt` |
| Integráció külső rendszerekkel | `--sys-prompt` |
| Speciális hibakeresés | `--sys-prompt` |

### Hibakezelés

| Forgatókönyv | Viselkedés |
| ------------------ | ------------------------- |
| Üres érték | Hiba |
| A fájl nem található | Soron belüli karakterláncként kezelve |
| Üres fájl | Hiba |
| Fájl > 1 MB | Hiba |
| Engedély megtagadva | Hiba |
| Címtár elérési útja | Hiba |

### Példák
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

## Több könyvtár támogatása

Az Autohand a fő munkaterületen kívül több könyvtárral is működhet. Ez akkor hasznos, ha a projektben különböző könyvtárakban vannak függőségek, megosztott könyvtárak vagy kapcsolódó projektek.

### CLI zászló

A `--add-dir` használatával további könyvtárakat adhat hozzá (többször is használható):
```bash
# Add a single additional directory
autohand --add-dir /path/to/shared-lib

# Add multiple directories
autohand --add-dir /path/to/lib1 --add-dir /path/to/lib2

# With unrestricted mode (auto-approve writes to all directories)
autohand --add-dir /path/to/shared-lib --unrestricted
```
### Interaktív parancs

`/add-dir` használata interaktív munkamenet során:
```
/add-dir              # Show current directories
/add-dir /path/to/dir # Add a new directory
```
### Biztonsági korlátozások

A következő könyvtárak nem adhatók hozzá:

- Saját könyvtár (`~` vagy `$HOME`)
- Gyökérkönyvtár (`/`)
- Rendszerkönyvtárak (`/etc`, `/var`, `/usr`, `/bin`, `/sbin`)
- Windows rendszerkönyvtárak (`C:\Windows`, `C:\Program Files`)
- Windows felhasználói könyvtárak (`C:\Users\username`)
- WSL Windows-csatlakozások (`/mnt/c`, `/mnt/c/Windows`)
