# Autohand Reference konfigurace

Kompletní reference pro všechny možnosti konfigurace v `~/.autohand/config.json` (nebo `.toml`/`.yaml`/`.yml`).

> **Tip:** Většinu nastavení níže lze změnit interaktivně pomocí příkazu `/settings` namísto ruční úpravy souboru.

Lokalizované reference:

- [anglicky](./config-reference.md)
– [日本語](./config-reference_ja.md)
– [简体中文](./config-reference_zh.md)
– [繁體中文](./config-reference_zh-tw.md)
– [한국어](./config-reference_ko.md)
– [Deutsch](./config-reference_de.md)
- [Español](./config-reference_es.md)
- [Français](./config-reference_fr.md)
– [Italiano](./config-reference_it.md)
- [Polski](./config-reference_pl.md)
– [Русский](./config-reference_ru.md)
- [Português (Brazílie)] (./config-reference_ptBR.md)
– [Türkçe](./config-reference_tr.md)
- [Čeština](./config-reference_cs.md)
- [Magyar](./config-reference_hu.md)
– [हिन्दी](./config-reference_hi.md)
– [Bahasa Indonesia](./config-reference_id.md)

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

## Obsah

- [Umístění konfiguračního souboru](#configuration-file-location)
- [Proměnné prostředí](#environment-variables)
- [Holý režim](#bare-mode)
– [Nastavení poskytovatele](#provider-settings)
- [Nastavení pracovního prostoru] (#workspace-settings)
- [Nastavení uživatelského rozhraní](#ui-settings)
– [Nastavení agenta](#agent-settings)
– [Nastavení oprávnění](#permissions-settings)
- [Režim opravy](#patch-mode)
– [Nastavení sítě](#network-settings)
- [Nastavení telemetrie](#telemetry-settings)
– [Externí zástupci](#external-agents)
- [Systém dovedností](#skills-system)
– [Nastavení API](#api-settings)
– [Nastavení ověřování](#authentication-settings)
– [Nastavení dovedností komunity](#community-skills-settings)
- [Nastavení sdílení](#share-settings)
– [Synchronizace nastavení](#settings-sync)
- [Nastavení háčků](#hooks-settings)
– [Nastavení MCP](#mcp-settings)
– [Nastavení rozšíření pro Chrome](#chrome-extension-settings)
- [Úplný příklad](#complete-example)

---

## Umístění konfiguračního souboru

Autohand hledá konfiguraci v tomto pořadí:

1. `AUTOHAND_CONFIG` proměnná prostředí (vlastní cesta)
2. `~/.autohand/config.toml`
3. `~/.autohand/config.yaml`
4. `~/.autohand/config.yml`
5. `~/.autohand/config.json` (výchozí)

Můžete také přepsat základní adresář:
```bash
export AUTOHAND_HOME=/custom/path  # Changes ~/.autohand to /custom/path
```
---

## Proměnné prostředí

| Proměnná | Popis | Příklad |
| --------------------------------------- | ------------------------------------------------- | --------------------------------- |
| `AUTOHAND_HOME` | Základní adresář pro všechna data Autohand | `/custom/path` |
| `AUTOHAND_CONFIG` | Vlastní cesta konfiguračního souboru | `/path/to/config.toml` |
| `AUTOHAND_API_URL` | Koncový bod API (přepíše konfiguraci) | `https://api.autohand.ai` |
| `AUTOHAND_SECRET` | Tajný klíč společnosti/týmu | `sk-xxx` |
| `AUTOHAND_PERMISSION_CALLBACK_URL` | URL pro zpětné volání oprávnění (experimentální) | `http://localhost:3000/callback` |
| `AUTOHAND_PERMISSION_CALLBACK_TIMEOUT` | Časový limit pro zpětné volání oprávnění v ms | `5000` |
| `AUTOHAND_NON_INTERACTIVE` | Spustit v neinteraktivním režimu | `1` |
| `AUTOHAND_YES` | Automaticky potvrdit všechny výzvy | `1` |
| `AUTOHAND_NO_BANNER` | Zakázat úvodní banner | `1` |
| `AUTOHAND_STREAM_TOOL_OUTPUT` | Streamujte výstup nástroje v reálném čase | `1` |
| `AUTOHAND_DEBUG` | Povolit protokolování ladění | `1` |
| `AUTOHAND_THINKING_LEVEL` | Nastavte úroveň hloubky uvažování | `normal` |
| `AUTOHAND_CLIENT_NAME` | Identifikátor klienta/editor (nastavený rozšířeními ACP) | `zed` |
| `AUTOHAND_CLIENT_VERSION` | Verze klienta (nastavená rozšířeními ACP) | `0.169.0` |
| `AUTOHAND_CODE` | Příznak detekce prostředí (automaticky nastavený) | `1` |
| `AUTOHAND_CODE_SIMPLE` | Povolit holý režim bez předání `--bare` | `1` |

### Úroveň myšlení

Proměnná prostředí `AUTOHAND_THINKING_LEVEL` řídí hloubku uvažování, které model používá:

| Hodnota | Popis |
| ---------- | ---------------------------------------------------------------------- |
| `none` | Přímé odpovědi bez viditelného zdůvodnění |
| `normal` | Standardní hloubka uvažování (výchozí) |
| `extended` | Hluboké zdůvodnění složitých úkolů ukazuje podrobnější myšlenkový proces |

To je obvykle nastaveno klientskými rozšířeními ACP (jako Zed) prostřednictvím rozevíracího seznamu konfigurace.
```bash
# Example: Use extended thinking for complex tasks
AUTOHAND_THINKING_LEVEL=extended autohand --prompt "refactor this module"
```
---

## Holý režim

Holý režim začíná Autohand pouze s explicitně požadovanými integracemi kontextu a běhového prostředí. Povolte ji buď:
```bash
autohand --bare
AUTOHAND_CODE_SIMPLE=1 autohand
```
Když je předán `--bare`, Autohand také nastaví `AUTOHAND_CODE_SIMPLE=1` pro běžící proces.

Holý režim zakáže automatické spouštění a interaktivní integrace:

- háčky a upozornění na háčky
- Spuštění LSP
- synchronizace zásuvných modulů, automatické načítání zásuvných modulů a automatické načítání metanástrojů
- atribuce, telemetrie, synchronizace relace, automatické hlášení a pingy na pozadí
- kontext automatického zavádění paměti/relace
- návrhy výzev na pozadí, kontroly aktualizací, načítání příznaků funkcí a předběžné načítání metadat modelu
- klíčenka a záložní ověřování OAuth prohlížeče
- automatické zjišťování `AGENTS.md` a instrukcí poskytovatele
- všechny příkazy lomítka, včetně holého `/` napsaného do výzvy

Absolutní cesty k souboru ve tvaru lomítka, jako je `/Users/alex/project/file.ts`, jsou stále považovány za normální text výzvy. Vstup lomítka ve tvaru příkazu, například `/help`, `/model` nebo `/mcp`, vytiskne `Slash commands are disabled in bare mode.` a neprovede se.

Autentizace v holém režimu je pouze explicitní. Autohand nejprve přečte `AUTOHAND_API_KEY` a poté `auth.apiKeyHelper`, pokud je nakonfigurován. Nečte přihlašovací údaje klíčenek ani nespouští přihlášení OAuth/prohlížeč. Poskytovatelé třetích stran nadále používají své klíče API a konfiguraci specifické pro poskytovatele.

Tyto explicitní vstupy zůstávají dostupné v holém režimu:

| Vstup | Popis |
| ------------------------------ | ------------------------------------------------------------------------- |
| `--system-prompt <value>` | Nahraďte systémovou výzvu vloženým textem nebo hodnotou podobnou cestě |
| `--system-prompt-file <path>` | Nahraďte systémovou výzvu obsahem souboru |
| `--append-system-prompt <value>` | Připojte vložený text nebo hodnotu podobnou cestě do systémové výzvy |
| `--append-system-prompt-file <path>` | Připojte obsah souboru do systémového řádku |
| `--add-dir <path...>` | Přidat explicitní adresáře do rozsahu pracovního prostoru |
| `--mcp-config <path>` | Načtěte explicitní konfigurační soubor MCP |
| `--settings` | Otevřete nastavení přímo z příznaku CLI |
| `--config <path>` | Použijte explicitní konfigurační soubor Autohand |
| `--agents <json\|path>` | Načtěte explicitní inline agenty JSON nebo adresář explicitních agentů |
| `--plugin-dir <path>` | Načtěte explicitní adresář plugin/meta-tool |

---

## Nastavení poskytovatele

### `provider`

Aktivní poskytovatel LLM k použití.

| Hodnota | Popis |
| --------------- | ----------------------------- |
| `"openrouter"` | OpenRouter API (výchozí) |
| `"ollama"` | Místní instance Ollamy |
| `"llamacpp"` | Místní server lama.cpp |
| `"openai"` | OpenAI API přímo |
| `"mlx"` | MLX na Apple Silicon (místní) |
| `"llmgateway"` | LLM Gateway jednotné API |
| `"deepseek"` | DeepSeek API |
| `"zai"` | Z.ai GLM API |
| `"sakana"` | Sakana.AI Fugu API |
| `"bedrock"` | AWS Bedrock |
| `"custom:<id>"` | Uživatelem definovaný poskytovatel kompatibilní s OpenAI od `customProviders` |

### `openrouter`

Konfigurace poskytovatele OpenRouter.
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
| Pole | Typ | Povinné | Výchozí | Popis |
| ---------------- | ------ | -------- | ------------------------------- | --------------------------------------------------------------------------- |
| `apiKey` | řetězec | Ano | - | Váš klíč API OpenRouter |
| `baseUrl` | řetězec | Ne | `https://openrouter.ai/api/v1` | Koncový bod API |
| `model` | řetězec | Ano | - | Identifikátor modelu (např. `your-modelcard-id-here`) |
| `contextWindow` | číslo | Ne | Auto | Kontextové okno přesného modelu. Autohand to vyplní z OpenRouter, když je známo. |

### `zai`

Konfigurace poskytovatele Z.ai.
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
| Pole | Typ | Povinné | Výchozí | Popis |
| ---------------- | ------ | -------- | ------------------------------- | -------------------------------------------------------------------------------- |
| `apiKey` | řetězec | Ano | - | Váš klíč API Z.ai |
| `baseUrl` | řetězec | Ne | `https://api.z.ai/api/paas/v4` | Koncový bod API |
| `model` | řetězec | Ano | `glm-5.2` | Identifikátor modelu, například `glm-5.2`, `glm-5.1` nebo `glm-4.5` |
| `contextWindow` | číslo | Ne | Auto | Kontextové okno přesného modelu. Autohand odvodí 1 milion pro GLM-5.2 a 200 000 pro GLM-5.1. |

### `sakana`

Konfigurace poskytovatele Sakana.AI. Rozhraní API je kompatibilní s OpenAI a jako základní URL používá `https://api.sakana.ai/v1`.
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
| Pole | Typ | Povinné | Výchozí | Popis |
| ---------------- | ------ | -------- | ------------------------------ | ------------------------------------------------------------------ |
| `apiKey` | řetězec | Ano | - | Váš klíč API Sakana |
| `baseUrl` | řetězec | Ne | `https://api.sakana.ai/v1` | Koncový bod API |
| `model` | řetězec | Ano | `fugu` | Identifikátor modelu, například `fugu` nebo `fugu-ultra` |
| `contextWindow` | číslo | Ne | Auto | Kontextové okno přesného modelu. Autohand odvodí 1M pro modely Fugu.   |

### `customProviders`

Vlastní poskytovatelé umožňují uživatelům přinést koncový bod kompatibilní s OpenAI bez změny kódu nebo nového poskytovatele v balíčku. Přidejte poskytovatele pod `customProviders` a poté jej vyberte pomocí `provider: "custom:<id>"`. Stejný postup je k dispozici od `/model` s **Novým poskytovatelem...**. Během nastavení Autohand před uložením poskytovatele ověří základní adresu URL, ověření a vybraný model prostřednictvím koncového bodu `/models` kompatibilního s OpenAI.
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
U místních serverů kompatibilních s OpenAI, které nevyžadují ověření, nastavte `apiKeyRequired` na `false` a vynechejte `apiKey`.

| Pole | Typ | Povinné | Výchozí | Popis |
| ------------------ | ------- | -------- | ------- | ----------- |
| `id` | řetězec | Ano | - | ID stabilního poskytovatele. Musí odpovídat klíči objektu a je vybrán jako `custom:<id>`. |
| `displayName` | řetězec | Ano | - | Jméno zobrazené v `/model` a nastavení poskytovatele. |
| `apiFormat` | řetězec | Ano | - | Musí být `openai-compatible`. |
| `baseUrl` | řetězec | Ano | - | Kořen koncového bodu, například `https://api.example.com/v1`. Autohand ověří `/models` a zavolá `/chat/completions`. |
| `apiKey` | řetězec | Podmíněné | - | Nosný token pro hostované koncové body. Vyžadováno, když je `apiKeyRequired` pravdivé. |
| `apiKeyRequired` | booleovský | Ne | `true` | Nastavte hodnotu false pro místní nebo již ověřené brány. |
| `model` | řetězec | Ano | - | ID aktivního modelu. |
| `contextWindow` | číslo | Ne | Auto | Přesné kontextové okno pro token budgeting, stav, telemetrii a metadata synchronizace. |
| `reasoningEffort` | řetězec | Ne | - | Volitelné `none`, `low`, `medium`, `high` nebo `xhigh`. Odesláno jako `reasoning_effort` pro vlastní požadavky kompatibilní s OpenAI. |
| `models` | pole | Ne | - | Volitelné položky pro výběr modelu s kontextem jednotlivých modelů a metadaty zdůvodnění. |

### `ollama`

Konfigurace poskytovatele Ollama.
```json
{
  "ollama": {
    "baseUrl": "http://localhost:11434",
    "port": 11434,
    "model": "llama3.2"
  }
}
```
| Pole | Typ | Povinné | Výchozí | Popis |
| --------- | ------ | -------- | ------------------------- | ------------------------------------------- |
| `baseUrl` | řetězec | Ne | `http://localhost:11434` | URL serveru Ollama |
| `port` | číslo | Ne | `11434` | Port serveru (alternativa k baseUrl) |
| `model` | řetězec | Ano | - | Název modelu (např. `llama3.2`, `codellama`) |

### `llamacpp`

konfigurace serveru lama.cpp.
```json
{
  "llamacpp": {
    "baseUrl": "http://localhost:8080",
    "port": 8080,
    "model": "default"
  }
}
```
| Pole | Typ | Povinné | Výchozí | Popis |
| --------- | ------ | -------- | ------------------------- | --------------------- |
| `baseUrl` | řetězec | Ne | `http://localhost:8080` | URL serveru lama.cpp |
| `port` | číslo | Ne | `8080` | Port serveru |
| `model` | řetězec | Ano | - | Identifikátor modelu |

### `openai`

Konfigurace OpenAI API.
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
OpenAI může také používat vaše předplatné ChatGPT prostřednictvím vestavěného přihlašovacího postupu OpenAI Autohand:
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
| Pole | Typ | Povinné | Výchozí | Popis |
| ---------------- | ------ | ----------------------- | ---------------------------- | ------------------------------------------------------------------------- |
| `authMode` | řetězec | Ne | `api-key` | Režim ověřování: `api-key` nebo `chatgpt` |
| `apiKey` | řetězec | Ano pro režim `api-key` | - | OpenAI API klíč |
| `baseUrl` | řetězec | Ne | `https://api.openai.com/v1` | Koncový bod API |
| `model` | řetězec | Ano | - | Název modelu (např. `gpt-5.4`, `gpt-5.4-mini`) |
| `contextWindow` | číslo | Ne | Auto | Kontextové okno přesného modelu. Nastavte toto, chcete-li přepsat zastaralé místní předpoklady. |
| `chatgptAuth` | objekt | Ano pro režim `chatgpt` | - | Uložené tokeny ověření ChatGPT/Codex a ID účtu |

### `mlx`

Poskytovatel MLX pro Apple Silicon Mac (místní závěr).
```json
{
  "mlx": {
    "baseUrl": "http://localhost:8080",
    "port": 8080,
    "model": "mlx-community/Llama-3.2-3B-Instruct-4bit"
  }
}
```
| Pole | Typ | Povinné | Výchozí | Popis |
| --------- | ------ | -------- | ------------------------- | --------------------- |
| `baseUrl` | řetězec | Ne | `http://localhost:8080` | URL serveru MLX |
| `port` | číslo | Ne | `8080` | Port serveru |
| `model` | řetězec | Ano | - | Identifikátor modelu MLX |

### `llmgateway`

LLM Gateway sjednocená konfigurace API. Poskytuje přístup k více poskytovatelům LLM prostřednictvím jediného API.
```json
{
  "llmgateway": {
    "apiKey": "your-llmgateway-api-key",
    "baseUrl": "https://api.llmgateway.io/v1",
    "model": "gpt-4o"
  }
}
```
| Pole | Typ | Povinné | Výchozí | Popis |
| --------- | ------ | -------- | ------------------------------- | ---------------------------------------------------------- |
| `apiKey` | řetězec | Ano | - | LLM Gateway API klíč |
| `baseUrl` | řetězec | Ne | `https://api.llmgateway.io/v1` | Koncový bod API |
| `model` | řetězec | Ano | - | Název modelu (např. `gpt-4o`, `claude-3-5-sonnet-20241022`) |

**Získání klíče API:**
Navštivte [llmgateway.io/dashboard](https://llmgateway.io/dashboard), vytvořte si účet a získejte klíč API.

**Podporované modely:**
LLM Gateway podporuje modely od více poskytovatelů, včetně:

– OpenAI: `gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo`
`claude-3-5-haiku-20241022`
– Google: `gemini-1.5-pro`, `gemini-1.5-flash`

### `deepseek`

Konfigurace poskytovatele DeepSeek. Rozhraní API je kompatibilní s OpenAI a jako základní URL používá `https://api.deepseek.com`.
```json
{
  "deepseek": {
    "apiKey": "your-deepseek-api-key",
    "baseUrl": "https://api.deepseek.com",
    "model": "deepseek-v4-flash"
  }
}
```
| Pole | Typ | Povinné | Výchozí | Popis |
| --------- | ------ | -------- | --------------------------- | --------------------------------------------------------------- |
| `apiKey` | řetězec | Ano | - | Klíč API DeepSeek |
| `baseUrl` | řetězec | Ne | `https://api.deepseek.com` | Koncový bod API |
| `model` | řetězec | Ano | - | Název modelu, například `deepseek-v4-flash` nebo `deepseek-v4-pro` |

### `bedrock`

Konfigurace poskytovatele AWS Bedrock. `converse` je výchozí režim a používá řetězec pověření AWS SDK. Režimy kompatibilní s OpenAI používají klíče API Bedrock a koncové body kompatibilní s Bedrock OpenAI.
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
| Pole | Typ | Povinné | Výchozí | Popis |
| ---------- | ------ | -------- | ------- | ----------- |
| `model` | řetězec | Ano | - | ID modelu podloží, ID odvozeného profilu nebo ARN |
| `region` | řetězec | Ano | `AWS_REGION`, poté `AWS_DEFAULT_REGION` a poté `us-east-1` v nastavení | Region AWS |
| `apiMode` | řetězec | Ne | `converse` | `converse`, `openai-chat` nebo `openai-responses` |
| `authMode` | řetězec | Ne | `aws-credentials` pro `converse`, `bedrock-api-key` pro režimy kompatibilní s OpenAI | Režim autentizace |
| `profile` | řetězec | Ne | - | Volitelný profil AWS pro ověření řetězce pověření |
| `endpoint` | řetězec | Ne | Odvozeno z režimu a regionu | Vlastní/soukromý koncový bod Bedrock |
| `apiKey` | řetězec | Ano pro režimy kompatibilní s OpenAI | - | Klíč API Bedrock. Nepoužívejte klíče OpenAI API. |

Spusťte `aws configure sso` nebo nastavte `AWS_PROFILE=enterprise-prod autohand` pro ověření AWS založené na profilu. AWS SDK podporuje roli, kontejner a přihlašovací údaje metadat IAM. Před použitím modelu povolte přístup k modelu v konzole AWS.

---

## Nastavení pracovního prostoru
```json
{
  "workspace": {
    "defaultRoot": "/path/to/projects",
    "allowDangerousOps": false
  }
}
```
| Pole | Typ | Výchozí | Popis |
| -------------------- | ------- | ------------------ | -------------------------------------------------- |
| `defaultRoot` | řetězec | Aktuální adresář | Výchozí pracovní prostor, pokud není zadán žádný |
| `allowDangerousOps` | booleovský | `false` | Povolit destruktivní operace bez potvrzení |

### Bezpečnost pracovního prostoru

Autohand automaticky blokuje operace v nebezpečných adresářích, aby se zabránilo náhodnému poškození:

- **Kořeny systému souborů** (`/`, `C:\`, `D:\` atd.)
- **Domovské adresáře** (`~`, `/Users/<user>`, `/home/<user>`, `C:\Users\<user>`)
- **Systémové adresáře** (`/etc`, `/var`, `/System`, `C:\Windows` atd.)
- **Připojení WSL pro Windows** (`/mnt/c`, `/mnt/c/Users/<user>`)

Tuto kontrolu nelze obejít. Pokud se pokusíte spustit autohand v nebezpečném adresáři, zobrazí se chyba a musíte zadat bezpečný adresář projektu.
```bash
# This will be blocked
cd ~ && autohand
# Error: Unsafe Workspace Directory

# This works
cd ~/projects/my-app && autohand
```
Úplné podrobnosti naleznete v části [Bezpečnost pracovního prostoru](./workspace-safety.md).

---

## Nastavení uživatelského rozhraní
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
| Pole | Typ | Výchozí | Popis |
| ----------------------------- | ------ | ------- | ---------------------------------------------------------------------------------------------- |
| `theme` | řetězec | `"dark"` | Barevný motiv pro výstup na terminál. Mezi vestavěné moduly patří `dark`, `light`, `dracula`, `sandy`, `tui`, `github-dark`, `cappadocia`, _DE_10_AH_DE a _9_1AH_CO_DE. Starší hodnoty `turkey` a `brazil` se stále načítají jako aliasy. |
| `customThemes` | objekt | `{}` | Vložené definice vlastního motivu s klíčem podle názvu motivu. Chcete-li jej použít, nastavte `theme` na stejný klíč.   |
| `autoConfirm` | booleovský | `false` | Přeskočte výzvy k potvrzení pro bezpečný provoz |
| `readFileCharLimit` | číslo | `300` | Max. počet znaků k zobrazení z výstupu nástroje pro čtení/hledání (celý obsah je stále odesílán do modelu) |
| `silentToolOutput` | booleovský | `false` | Skrýt výstupní bloky nástroje v terminálu a přitom zachovat výsledky nástroje pro model/relaci |
| `activityVerbs` | řetězec nebo řetězec[] | vestavěný bazén | Vlastní sloveso aktivity nebo fond sloves pro pracovní indikátor vykreslený jako `Verb...` |
| `activityVerbsEnabled` | booleovský | `true` | Zobrazit rotující slovesa aktivity jako `Compiling...`, zatímco agent pracuje |
| `activitySymbol` | řetězec | `"✳"` | Symbol zobrazený před slovesem aktivity ve výstupu indikátoru aktivity |
| `statusLine.showProviderModel` | booleovský | `true` | Zobrazit aktivního poskytovatele a model ve stavovém řádku skladatele |
| `statusLine.showContext` | booleovský | `true` | Zobrazit procento kontextu ve stavovém řádku skladatele |
| `statusLine.showCommandHint` | booleovský | `true` | Zobrazte příkazy, zmínky, dovednosti a rady pro zadání terminálu ve stavovém řádku skladatele |
| `statusLine.showPullRequest` | booleovský | `true` | Ukažte přidružené číslo požadavku na stažení nebo `PR #123`, pokud není přidruženo žádné PR |
| `statusLine.showSessionLines` | booleovský | `false` | Zobrazit řádky přidané a odstraněné během aktuální relace |
| `statusLine.showQueue` | booleovský | `true` | Zobrazit počty požadavků ve frontě ve stavovém řádku |
| `statusLine.showActiveStatus` | booleovský | `true` | Zobrazit text stavu aktivního odbočení, když agent pracuje |
| `statusLine.showActiveMetrics` | booleovský | `true` | Zobrazit uplynulý čas a metriky tokenů, když agent pracuje |
| `statusLine.showCancelHint` | booleovský | `true` | Zobrazit nápovědu ke zrušení Esc, když agent pracuje |
| `completionReportEnabled` | booleovský | `true` | Požádejte model, aby zahrnul stručnou zprávu o dokončení po otočení dokončené akce |
| `showCompletionNotification` | booleovský | `true` | Zobrazit systémové upozornění po dokončení úlohy |
| `showThinking` | booleovský | `true` | Zobrazit proces uvažování/myšlenek LLM |
| `terminalBell` | booleovský | `true` | Po dokončení úkolu zazvoňte na zvonek terminálu (zobrazí odznak na kartě terminálu/doku) |
| `checkForUpdates` | booleovský | `true` | Zkontrolovat aktualizace CLI při spuštění |
| `updateCheckInterval` | číslo | `24` | Hodiny mezi kontrolami aktualizací (používá výsledky uložené v mezipaměti v rámci intervalu) |

Vlastní motivy mohou přepsat jakýkoli sémantický barevný token. Chybějící tokeny jsou zděděny z temného tématu:
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
Poznámka: `readFileCharLimit` a `silentToolOutput` ovlivňují pouze zobrazení terminálu. Úplný obsah se stále odesílá do modelu a ukládá se do zpráv nástroje.

Můžete přepínat tichý výstup nástroje bez úpravy souboru:
```bash
autohand config set silent_tool_output true
autohand config set silent_tool_output false
```
Rotující slovesa aktivity můžete přepínat bez úpravy souboru:
```bash
autohand config set verbs activity true
autohand config set verbs activity false
```
Přizpůsobte si slovesa v konfiguračním souboru, pokud chcete pevný štítek stavu nebo malou rotaci specifickou pro projekt:
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
`activityVerbs` přijímá buď jeden řetězec, nebo neprázdné pole řetězců. Když je `activityVerbsEnabled` `false`, Autohand se vrátí zpět na `Working...` namísto rotace přes vlastní nebo vestavěná slovesa.

Zprávy o dokončení, včetně strukturované výzvy `SITREP`, můžete přepínat bez úpravy souboru:
```bash
autohand config set sitrep true
autohand config set sitrep false
```
### Terminálový zvonek

Když je povoleno `terminalBell` (výchozí), Autohand zazvoní na terminálu (`\x07`) po dokončení úlohy. Toto spouští:

- **Odznak na záložce terminálu** - Ukazuje vizuální indikátor, že práce je hotová
- **Dock icon bounce** - Upoutá vaši pozornost, když je terminál na pozadí (macOS)
- **Sound** - Pokud jsou v nastavení terminálu povoleny zvuky terminálu

Nastavení specifická pro terminál:

- **MacOS Terminal**: Předvolby > Profily > Pokročilé > Bell (vizuální/zvuk)
- **iTerm2**: Předvolby > Profily > Terminál > Upozornění
- **VS Code Terminal**: Nastavení > Terminál > Integrovaný: Povolit zvonek

Postup deaktivace:
```json
{
  "ui": {
    "terminalBell": false
  }
}
```
### Ink Renderer

Autohand standardně používá vykreslovací modul Ink 7 + React 19 pro interaktivní terminály. Starší konfigurační pole `ui.useInkRenderer` je ignorováno, takže staré konfigurační soubory nemohou vynutit skládání prostého terminálu. Inkoust poskytuje:

- **Výstup bez blikání**: Všechny aktualizace uživatelského rozhraní jsou dávkové prostřednictvím odsouhlasení React
- **Funkce pracovní fronty**: Zadejte pokyny, zatímco agent pracuje
- **Lepší zpracování vstupu**: Žádné konflikty mezi obslužnými programy readline
- **Složitelné uživatelské rozhraní**: Základ pro budoucí pokročilé funkce uživatelského rozhraní

Nouzové řešení pro kompatibilitu terminálu:
```bash
AUTOHAND_LEGACY_UI=1 autohand
```
Poznámka: Tato funkce je experimentální a může mít okrajové případy. Výchozí uživatelské rozhraní založené na ora zůstává stabilní a plně funkční.

### Kontrola aktualizací

Když je povoleno `checkForUpdates` (výchozí), Autohand zkontroluje při spuštění nová vydání:
```
> Autohand v0.6.8 (abc1234) ✓ Up to date
```
Pokud je k dispozici aktualizace:
```
> Autohand v0.6.7 (abc1234) ⬆ Update available: v0.6.8
  ↳ Run: curl -fsSL https://autohand.ai/install.sh | sh
```
Jak to funguje:

- Načítá nejnovější verzi z GitHub API
- Výsledek mezipaměti je `~/.autohand/version-check.json`
- Kontroly pouze jednou za `updateCheckInterval` hodin (výchozí: 24)
- Neblokování: spouštění pokračuje, i když kontrola selže

Postup deaktivace:
```json
{
  "ui": {
    "checkForUpdates": false
  }
}
```
Nebo prostřednictvím proměnné prostředí:
```bash
export AUTOHAND_SKIP_UPDATE_CHECK=1
```
---

## Nastavení agenta

Řízení chování agenta a limity iterací.
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
| Pole | Typ | Výchozí | Popis |
| --------------------- | ------- | ------- | ------------------------------------------------------------------------------ |
| `maxIterations` | číslo | `100` | Maximální počet iterací nástroje na požadavek uživatele před zastavením |
| `enableRequestQueue` | booleovský | `true` | Povolit uživatelům psát a řadit požadavky do fronty, zatímco agent pracuje |
| `toolSelectionCache` | booleovský | `true` | Uložte do mezipaměti místní výběr schématu nástroje na otočení pro ekvivalentní vstup pro výběr nástroje |
| `autoMemory` | booleovský | `true` | Extrahujte a uložte trvalé uživatelské/projektové vzpomínky po úspěšných interaktivních otočeních |
| `idleLogoutEnabled` | booleovský | `true` | Odhlaste ověřené interaktivní relace po vypršení časového limitu nečinnosti |
| `idleTimeoutMs` | číslo | `3600000` | Milisekundy nečinnosti před odhlášením ověřené relace (60 minut) |
| `debug` | booleovský | `false` | Povolit podrobný výstup ladění (protokoluje interní stav agenta do stderr) |

### Výběr schématu nástroje

Autohand neodesílá každé úplné schéma nástroje na každý požadavek LLM. Systémová výzva obsahuje kompaktní katalog funkcí nástrojů a každý požadavek odhaluje pouze malou sadu konkrétních schémat vybraných z:

– Základní nástroje pro zjišťování, jako jsou `tool_search`, `read_file`, `fff_find` a `fff_grep`
- Nástroje přizpůsobené záměru pro editaci, ověřování, git, prohlížeč, web, závislost nebo práci se sledováním projektu
- Nástroje požadované prostřednictvím nedávných volání `tool_search` nebo výslovně uvedené jménem

Vyhnete se tak velkým nákladům na kontext zasílání všech schémat nástrojů dříve, než je znám záměr uživatele. `toolSelectionCache` ovládá pouze místní mezipaměť selektoru pro ekvivalentní obraty; neprovádí zahřívání LLM před uživatelem a nevynucuje velkou předponu výzvy v mezipaměti.

Chcete-li zakázat mezipaměť místního výběru:
```json
{
  "agent": {
    "toolSelectionCache": false
  }
}
```
Chcete-li udržet ověřené dlouhotrvající relace agentů naživu, zatímco čekají na práci:
```json
{
  "agent": {
    "idleLogoutEnabled": false
  }
}
```
Pro jeden proces použijte `autohand --no-idle-logout` nebo nastavte `AUTOHAND_NO_IDLE_LOGOUT=1`.

Chcete-li změnit dobu nečinnosti, nastavte `idleTimeoutMs` na kladnou dobu v milisekundách. Výchozí hodnota je `3600000` (60 minut); neplatné hodnoty použijí výchozí nastavení.

### Režim ladění

Povolte režim ladění, abyste viděli podrobné protokolování vnitřního stavu agenta (opakování smyčky reakcí, sestavení výzvy, podrobnosti o relaci). Výstup jde do stderr, aby nedošlo k rušení normálního výstupu.

Tři způsoby, jak povolit režim ladění (v pořadí priority):

1. **Příznak CLI**: `autohand -d` nebo `autohand --debug`
2. **Proměnná prostředí**: `AUTOHAND_DEBUG=1`
3. **Konfigurační soubor**: Nastavte `agent.debug: true`

### Fronta požadavků

Když je povolen `enableRequestQueue`, můžete pokračovat v psaní zpráv, zatímco agent zpracovává předchozí požadavek. Váš vstup bude zařazen do fronty a zpracován automaticky po dokončení aktuální úlohy.

- Napište svou zprávu a stisknutím klávesy Enter ji přidejte do fronty
- Stavový řádek ukazuje, kolik požadavků je ve frontě
- Požadavky jsou zpracovávány v pořadí FIFO (first-in, first-out).
- Maximální velikost fronty je 10 požadavků

---

## Nastavení oprávnění

Jemná kontrola nad oprávněními nástroje.
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

| Hodnota | Popis |
| ----------------- | ------------------------------------------------------ |
| `"interactive"` | Výzva ke schválení nebezpečných operací (výchozí) |
| `"unrestricted"` | Žádné výzvy, povolit vše |
| `"restricted"` | Odmítnout všechny nebezpečné operace |

### `whitelist`

Pole vzorů nástrojů, které nikdy nevyžadují schválení.
```json
["run_command:npm *", "run_command:bun test"]
```
### `blacklist`

Pole vzorů nástrojů, které jsou vždy blokovány.
```json
["run_command:rm -rf /", "run_command:sudo *"]
```
### `rules`

Jemná pravidla povolení.

| Pole | Typ | Popis |
| --------- | --------- | -------------------------------------------- | ---------- | --------------- |
| `tool` | řetězec | Název nástroje, který se má shodovat |
| `pattern` | řetězec | Volitelný vzor pro shodu s argumenty |
| `action` | `"allow"` | `"deny"` | `"prompt"` | Opatření k provedení |

### `rememberSession`

| Typ | Výchozí | Popis |
| ------- | ------- | -------------------------------------------- |
| booleovský | `true` | Zapamatujte si rozhodnutí o schválení pro relaci |

### Oprávnění k místnímu projektu

Každý projekt může mít svá vlastní nastavení oprávnění, která přepíší globální konfiguraci. Ty jsou uloženy v `.autohand/settings.local.json` v kořenovém adresáři vašeho projektu.

Když schválíte operaci se souborem (úpravy, zápis, smazání), automaticky se uloží do tohoto souboru, takže nebudete znovu požádáni o stejnou operaci v tomto projektu.
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
**Jak to funguje:**

– Když operaci schválíte, uloží se do `.autohand/settings.local.json`
- Příště bude stejná operace schválena automaticky
- Místní nastavení projektu jsou sloučena s globálním nastavením (místní má přednost)
- Přidejte `.autohand/settings.local.json` do `.gitignore`, aby osobní nastavení zůstalo soukromé

**Formát vzoru:**

- `tool_name:path` - Pro operace se soubory (např. `apply_patch:src/file.ts`)
- `tool_name:command args` - Pro příkazy (např. `run_command:npm test`)

### Oprávnění k prohlížení

Aktuální nastavení oprávnění můžete zobrazit dvěma způsoby:

**Příznak CLI (neinteraktivní):**
```bash
autohand --permissions
```
Toto zobrazuje:

- Aktuální režim oprávnění (interaktivní, neomezený, omezený)
- Cesty k pracovnímu prostoru a konfiguračním souborům
- Všechny schválené vzory (bílá listina)
- Všechny odepřené vzory (černá listina)
- Souhrnné statistiky

**Interaktivní příkaz:**
```
/permissions
```
V interaktivním režimu poskytuje příkaz `/permissions` stejné informace plus možnosti pro:

- Odebrat položky z bílé listiny
- Odstraňte položky z černé listiny
- Vymažte všechna uložená oprávnění

---

## Režim opravy

Režim opravy vám umožňuje vygenerovat sdílenou opravu kompatibilní s git bez úpravy souborů pracovního prostoru. To je užitečné pro:

- Kontrola kódu před použitím změn
- Sdílení změn generovaných AI se členy týmu
- Vytváření reprodukovatelných sad změn
- CI/CD kanály, které potřebují zachytit změny bez jejich použití

### Použití
```bash
# Generate patch to stdout
autohand --prompt "add user authentication" --patch

# Save to file
autohand --prompt "add user authentication" --patch --output auth.patch

# Pipe to file (alternative)
autohand --prompt "refactor api handlers" --patch > refactor.patch
```
### Chování

Když je zadán `--patch`:

- **Automatické potvrzení**: Všechna potvrzení jsou automaticky přijímána (implicitně `--yes`)
- **Žádné výzvy**: Nezobrazují se žádné výzvy ke schválení (implicitně `--unrestricted`)
- **Pouze náhled**: Změny jsou zachyceny, ale NEzapsány na disk
- **Vynuceno zabezpečení**: Operace na černé listině (`.env`, klíče SSH, nebezpečné příkazy) jsou stále blokovány

### Aplikace oprav

Příjemci mohou opravu aplikovat pomocí standardních příkazů git:
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
### Formát opravy

Vygenerovaná oprava se řídí jednotným formátem rozdílů git:
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
### Výstupní kódy

| Kód | Význam |
| ---- | ---------------------------------------------------- |
| `0` | Úspěch, oprava vygenerována |
| `1` | Chyba (chybí `--prompt`, oprávnění odepřeno atd.) |

### Kombinace s jinými příznaky
```bash
# Use specific model
autohand --prompt "optimize queries" --patch --model gpt-4o

# Specify workspace
autohand --prompt "add tests" --patch --path ./my-project

# Use custom config
autohand --prompt "refactor" --patch --config ~/.autohand/work.json
```
### Příklad týmového pracovního postupu
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

## Nastavení sítě
```json
{
  "network": {
    "maxRetries": 3,
    "timeout": 30000,
    "retryDelay": 1000
  }
}
```
| Pole | Typ | Výchozí | Max | Popis |
| ------------ | ------ | ------- | --- | --------------------------------------- |
| `maxRetries` | číslo | `3` | `5` | Opakujte pokusy o neúspěšné požadavky API |
| `timeout` | číslo | `30000` | - | Časový limit požadavku v milisekundách |
| `retryDelay` | číslo | `1000` | - | Prodleva mezi pokusy v milisekundách |

---

## Nastavení telemetrie

Telemetrie je **ve výchozím nastavení zakázána** (přihlášení). Povolením pomůžete zlepšit Autohand.
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
| Pole | Typ | Výchozí | Popis |
| -------------------- | ------- | -------------------------- | ---------------------------------------------- |
| `enabled` | booleovský | `false` | Povolit/zakázat telemetrii (přihlášení) |
| `apiBaseUrl` | řetězec | `https://api.autohand.ai` | Koncový bod telemetrie API |
| `batchSize` | číslo | `20` | Počet událostí do dávky před automatickým vyprázdněním |
| `flushIntervalMs` | číslo | `60000` | Interval splachování v milisekundách (1 minuta) |
| `maxQueueSize` | číslo | `500` | Maximální velikost fronty před vypuštěním starých událostí |
| `maxRetries` | číslo | `3` | Opakujte pokusy o neúspěšné telemetrické požadavky |
| `enableSessionSync` | booleovský | `true` | Synchronizujte relace do cloudu pro týmové funkce, když je povolena telemetrie |
| `companySecret` | řetězec | `""` | Tajemství společnosti pro ověřování API |

Telemetrie poskytovatele/modelu zahrnuje ID aktivního poskytovatele, ID modelu a dostupná netajná metadata, jako je zobrazovaný název vlastního poskytovatele, formát rozhraní API, zdůvodnění a kontextové okno. Klíče API a tokeny nosiče nejsou nikdy zahrnuty.

---

## Externí agenti

Načtěte uživatelské definice agentů z externích adresářů.
```json
{
  "externalAgents": {
    "enabled": true,
    "paths": ["~/.autohand/agents", "/team/shared/agents"]
  }
}
```
| Pole | Typ | Výchozí | Popis |
| --------- | -------- | ------- | -------------------------------- |
| `enabled` | booleovský | `false` | Povolit načítání externího agenta |
| `paths` | řetězec[] | `[]` | Adresáře pro načtení agentů z |

---

## Systém dovedností

Dovednosti jsou balíčky instrukcí, které agentovi AI poskytují specializované pokyny. Fungují jako soubory `AGENTS.md` na vyžádání, které lze aktivovat pro konkrétní úkoly.

### Místa pro objevování dovedností

Dovednosti se objevují z více míst, přičemž přednost mají pozdější zdroje:

| Umístění | ID zdroje | Popis |
| ----------------------------------------- | ------------------- | ------------------------------------------ |
| `~/.codex/skills/**/SKILL.md` | `codex-user` | Kodexové dovednosti na uživatelské úrovni (rekurzivní) |
| `~/.claude/skills/*/SKILL.md` | `claude-user` | Uživatelské dovednosti Claude (jedna úroveň) |
| `~/.autohand/skills/**/SKILL.md` | `autohand-user` | Dovednosti Autohand na uživatelské úrovni (rekurzivní) |
| `<project>/.claude/skills/*/SKILL.md` | `claude-project` | Claude dovednosti na úrovni projektu (jedna úroveň) |
| `<project>/.autohand/skills/**/SKILL.md` | `autohand-project` | Autohand dovednosti na úrovni projektu (rekurzivní) |

### Chování automatického kopírování

Dovednosti objevené z umístění Codex nebo Claude se automaticky zkopírují do odpovídajícího umístění Autohand:

- `~/.codex/skills/` a `~/.claude/skills/` → `~/.autohand/skills/`
- `<project>/.claude/skills/` → `<project>/.autohand/skills/`

Stávající dovednosti v lokalitách Autohand nejsou nikdy přepsány.

### Formát SKILL.md

Dovednosti využívají YAML frontmatter následovaný markdown obsahem:
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
| Pole | Povinné | Maximální délka | Popis |
| ---------------- | -------- | ---------- | ------------------------------------------- |
| `name` | Ano | 64 znaků | Malá písmena alfanumerická pouze se spojovníky |
| `description` | Ano | 1024 znaků | Stručný popis dovednosti |
| `license` | Ne | - | Identifikátor licence (např. MIT, Apache-2.0) |
| `compatibility` | Ne | 500 znaků | Poznámky ke kompatibilitě |
| `allowed-tools` | Ne | - | Mezerou oddělený seznam povolených nástrojů |
| `metadata` | Ne | - | Další metadata pár klíč–hodnota |

### Vstupní předpony

Autohand podporuje speciální předpony ve vstupním řádku:

| Předpona | Popis | Příklad |
| ------ | ------------------------------- | ---------------------------------- |
| `/` | Příkazy lomítka | `/help`, `/model`, `/quit`, `/exit` |
| `@` | Zmínky o souboru (automatické doplňování) | `@src/index.ts` |
| `$` | Zmínky o dovednostech (automatické doplňování) | `$frontend-design`, `$code-review` |
| `!` | Přímé spouštění příkazů terminálu | `! git status`, `! ls -la` |

**Zmínky o dovednostech (`$`):**

- Zadejte `$` následovaný znaky, abyste viděli dostupné dovednosti s automatickým doplňováním
– Karta přijímá horní návrh (např. `$frontend-design`)
- Dovednosti jsou objeveny z `~/.autohand/skills/` a `<project>/.autohand/skills/`
- Aktivované dovednosti jsou připojeny k výzvě jako speciální instrukce pro aktuální relaci
- Panel náhledu zobrazuje metadata dovedností (jméno, popis, stav aktivace)

**Příkazy shellu (`!`):**

- Příkazy se spouštějí ve vašem aktuálním pracovním adresáři
- Zobrazení výstupu přímo v terminálu
- Nechodí do LLM
- 30 sekundový časový limit
- Po provedení se vrátí na výzvu

### Příkazy lomítka

#### `/skills` – Správce balíčků

| Příkaz | Popis |
| -------------------------------- | ------------------------------------------- |
| `/skills` | Seznam všech dostupných dovedností |
| `/skills use <name>` | Aktivujte dovednost pro aktuální relaci |
| `/skills deactivate <name>` | Deaktivovat dovednost |
| `/skills info <name>` | Zobrazit podrobné informace o dovednostech |
| `/skills install` | Procházet a instalovat z registru komunity |
| `/skills install @<slug>` | Nainstalujte komunitní dovednost pomocí slug |
| `/skills search <query>` | Prohledejte registr dovedností komunity |
| `/skills trending` | Ukažte trendy komunitní dovednosti |
| `/skills remove <slug>` | Odinstalujte dovednost komunity |
| `/skills new` | Vytvořte novou dovednost interaktivně |
| `/skills feedback <slug> <1-5>` | Ohodnoťte dovednost komunity |

#### `/learn` – poradce pro dovednosti LLM

| Příkaz | Popis |
| ---------------- | ----------------------------------------------------------------- |
| `/learn` | Analyzujte projekt a doporučte dovednosti (rychlé skenování) |
| `/learn deep` | Projekt hlubokého skenování (čte zdrojové soubory) pro cílenější výsledky |
| `/learn update` | Znovu analyzujte projekt a obnovte zastaralé dovednosti generované LLM |

`/learn` používá dvoufázový tok LLM:

1. **Fáze 1 – Analýza + hodnocení + audit**: Prohledá strukturu vašeho projektu, prověří nainstalované dovednosti z hlediska redundance/konfliktů a seřadí dovednosti komunity podle relevance (0–100).
2. **Fáze 2 – Generovat** (podmíněně): Pokud žádná dovednost komunity nedosáhne hodnoty vyšší než 60, nabízí se vygenerování vlastní dovednosti přizpůsobené vašemu projektu.
Generované dovednosti zahrnují metadata (`agentskill-source: llm-generated`, `agentskill-project-hash`), takže `/learn update` může zjistit, kdy se vaše kódová základna změní, a obnovit zastaralé dovednosti.

### Automatické generování dovedností (`--auto-skill`)

Příznak `--auto-skill` CLI generuje dovednosti bez interaktivního toku poradců:
```bash
autohand --auto-skill
```
Toto bude:

1. Analyzujte strukturu svého projektu (package.json, requirements.txt atd.)
2. Detekce jazyků, rámců a vzorů
3. Vygenerujte 3 relevantní dovednosti pomocí LLM
4. Uložte dovednosti do `<project>/.autohand/skills/`

Pro cílenější a interaktivnější zážitek použijte místo toho `/learn` v rámci relace.

Mezi zjištěné vzory patří:

- **Jazyky**: TypeScript, JavaScript, Python, Rust, Go
- **Frameworks**: React, Next.js, Vue, Express, Flask, Django
- **Vzory**: Nástroje CLI, testování, monorepo, Docker, CI/CD

---

## Nastavení API

Konfigurace backendového API pro týmové funkce.
```json
{
  "api": {
    "baseUrl": "https://api.autohand.ai",
    "companySecret": "sk-team-xxx"
  }
}
```
| Pole | Typ | Výchozí | Popis |
| ---------------- | ------ | -------------------------- | ---------------------------------------- |
| `baseUrl` | řetězec | `https://api.autohand.ai` | Koncový bod API |
| `companySecret` | řetězec | - | Tajemství týmu/společnosti pro sdílené funkce |

Lze také nastavit pomocí proměnných prostředí:

- `AUTOHAND_API_URL` → `api.baseUrl`
- `AUTOHAND_SECRET` → `api.companySecret`

---

## Nastavení ověřování

Autentizace a konfigurace uživatelské relace.
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
| Pole | Typ | Výchozí | Popis |
| ------------- | ------ | ------- | --------------------------------------------- |
| `token` | řetězec | - | Autentizační token pro přístup k API |
| `user` | objekt | - | Informace o ověřeném uživateli |
| `user.id` | řetězec | - | ID uživatele |
| `user.email` | řetězec | - | E-mailová adresa uživatele |
| `user.name` | řetězec | - | Zobrazované jméno uživatele |
| `user.avatar` | řetězec | - | URL uživatelského avataru (volitelné) |
| `expiresAt` | řetězec | - | Časové razítko vypršení platnosti tokenu (formát ISO 8601) |

---

## Nastavení komunitních dovedností

Konfigurace pro objevování a správu komunitních dovedností.
```json
{
  "communitySkills": {
    "enabled": true,
    "showSuggestionsOnStartup": true,
    "autoBackup": true
  }
}
```
| Pole | Typ | Výchozí | Popis |
| --------------------------- | ------- | ------- | -------------------------------------------------------------- |
| `enabled` | booleovský | `true` | Povolit funkce komunitních dovedností |
| `showSuggestionsOnStartup` | booleovský | `true` | Zobrazit návrhy dovedností při spuštění, když neexistují žádné dovednosti dodavatele |
| `autoBackup` | booleovský | `true` | Automaticky zálohovat zjištěné dovednosti dodavatele do API |

---

## Nastavení sdílení

Konfigurace pro sdílení relace pomocí příkazu `/share`. Relace jsou hostovány na adrese [autohand.link](https://autohand.link).
```json
{
  "share": {
    "enabled": true
  }
}
```
| Pole | Typ | Výchozí | Popis |
| --------- | ------- | ------- | ------------------------------------ |
| `enabled` | booleovský | `true` | Povolit/zakázat příkaz `/share` |

### Formát YAML
```yaml
share:
  enabled: true
```
### Zakázání sdílení relací

Pokud chcete zakázat sdílení relací z důvodu zabezpečení nebo ochrany soukromí:
```json
{
  "share": {
    "enabled": false
  }
}
```
Když je zakázáno, spuštění `/share` zobrazí:
```
Session sharing is disabled.
To enable, set share.enabled: true in your config file.
```
---

## Nastavení Synchronizace

Autohand může synchronizovat vaši konfiguraci mezi zařízeními pro přihlášené uživatele. Nastavení jsou bezpečně uložena v Cloudflare R2 a před nahráním zašifrována.
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
| Pole | Typ | Výchozí | Popis |
| ------------------- | -------- | ---------------- | --------------------------------------------------- |
| `enabled` | booleovský | `true` (přihlášeno) | Povolit/zakázat synchronizaci nastavení |
| `interval` | číslo | `300000` | Interval synchronizace v milisekundách (výchozí: 5 minut) |
| `exclude` | řetězec[] | `[]` | Vzory globusů k vyloučení ze synchronizace |
| `includeTelemetry` | booleovský | `false` | Synchronizace telemetrických dat (vyžaduje souhlas uživatele) |
| `includeFeedback` | booleovský | `false` | Synchronizovat data zpětné vazby (vyžaduje souhlas uživatele) |

### Vlajka CLI
```bash
# Disable sync for this session
autohand --sync-settings=false

# Enable sync (default for logged users)
autohand --sync-settings
```
### Co se synchronizuje

Ve výchozím nastavení se pro přihlášené uživatele synchronizují tyto položky:

- **Konfigurace** (`config.json`) - Klíče API jsou před nahráním zašifrovány
– **Vlastní zástupci** (`agents/`)
- **Dovednosti komunity** (`community-skills/`)
- **Uživatelské háčky** (`hooks/`)
- **Paměť** (`memory/`)
- **Znalost projektu** (`projects/`)
- **Historie relací** (`sessions/`)
- **Sdílený obsah** (`share/`)
- **Vlastní dovednosti** (`skills/`)

### Co se nesynchronizuje (ve výchozím nastavení)

- **ID zařízení** (`device-id`) - Jedinečné pro každé zařízení
- **Protokoly chyb** (`error.log`) - Pouze místní
- **Mezipaměť verze** (`version-*.json`) - Soubory místní mezipaměti

### Synchronizace na základě souhlasu

Tyto položky vyžadují výslovné přihlášení ve vaší konfiguraci:

- **Data telemetrie** - Nastavte `sync.includeTelemetry: true` na synchronizaci
- **Data zpětné vazby** - Nastavte `sync.includeFeedback: true` na synchronizaci
```json
{
  "sync": {
    "enabled": true,
    "includeTelemetry": true,
    "includeFeedback": true
  }
}
```
### Řešení konfliktů

Když dojde ke konfliktům (stejný soubor upraven na více zařízeních), vyhraje **cloudová verze**. To zajišťuje konzistenci při přihlašování na nových zařízeních.

### Zabezpečení

Klíče API a další citlivá data v `config.json` jsou před nahráním zašifrovány pomocí vašeho ověřovacího tokenu. Lze je dešifrovat pouze pomocí vašich přihlašovacích údajů.

**Co je šifrováno:**

– Pole s názvem `apiKey`
– Pole končící na `Key`, `Token`, `Secret`
- Pole `password`

### Jak to funguje

1. **Při spuštění**: Pokud jste přihlášeni, služba synchronizace se spustí automaticky
2. **Každých 5 minut**: Nastavení se porovnávají s cloudovým úložištěm
3. **Cloud vyhrává**: Vzdálené změny se stahují jako první
4. **Místní nahrání**: Nahrají se nové místní změny
5. **Při ukončení**: Služba synchronizace se plynule zastaví

### Vyjma souborů

Ze synchronizace můžete vyloučit konkrétní soubory nebo vzory:
```json
{
  "sync": {
    "enabled": true,
    "exclude": ["custom-local-config.json", "temp/*"]
  }
}
```
### Formát YAML
```yaml
sync:
  enabled: true
  interval: 300000
  exclude: []
  includeTelemetry: false
  includeFeedback: false
```
---

## Nastavení MCP

Nakonfigurujte servery MCP (Model Context Protocol) pro rozšíření Autohand o externí nástroje.
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

- **Typ**: `boolean`
- **Výchozí**: `true`
- **Popis**: Povolí nebo zakáže veškerou podporu MCP. Když je `false`, při spuštění nejsou připojeny žádné servery a nástroje MCP nejsou dostupné.

### `mcp.servers`

- **Typ**: `McpServerConfigEntry[]`
- **Výchozí**: `[]`
- **Popis**: Pole konfigurací serveru MCP.

### Pole pro zadání serveru

| Pole | Typ | Povinné | Výchozí | Popis |
| ------------- | --------------------------------- | --------------- | ------- | -------------------------------------------------------------- |
| `name` | `string` | Ano | - | Jedinečný identifikátor serveru |
| `transport` | `"stdio"` \| `"sse"` \| `"http"` | Ano | - | Typ dopravy |
| `command` | `string` | Ano (stdio) | - | Příkaz ke spuštění procesu serveru |
| `args` | `string[]` | Ne | `[]` | Argumenty pro příkaz |
| `url` | `string` | Ano (sse/http) | - | URL koncového bodu serveru |
| `headers` | `Record<string, string>` | Ne | `{}` | Vlastní hlavičky HTTP pro přenos http/sse (např. auth tokeny) |
| `env` | `Record<string, string>` | Ne | `{}` | Proměnné prostředí předané serveru |
| `autoConnect` | `boolean` | Ne | `true` | Zda se má automaticky připojit při spuštění |

> Servery se při spouštění připojují asynchronně na pozadí bez blokování výzvy. Použijte `/mcp` pro interaktivní správu serverů nebo `/mcp add` pro procházení registru komunity nebo přidání vlastních serverů.

> Úplnou dokumentaci MCP naleznete na [docs/mcp.md] (mcp.md).

---

## Nastavení háčků

Konfigurace pro háky životního cyklu, které spouštějí příkazy shellu při událostech agenta. Úplné podrobnosti naleznete v [Dokumentace háčků](./hooks.md).
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

| Pole | Typ | Výchozí | Popis |
| --------- | ------- | ------- | ---------------------------------- |
| `enabled` | booleovský | `true` | Povolit/zakázat všechny háky globálně |
| `hooks` | pole | `[]` | Pole definic háčků |

### Definice háku

| Pole | Typ | Povinné | Výchozí | Popis |
| ------------- | ------- | -------- | ------- | --------------------------------- |
| `event` | řetězec | Ano | - | Událost k připojení |
| `command` | řetězec | Ano | - | Shell příkaz k provedení |
| `description` | řetězec | Ne | - | Popis pro displej `/hooks` |
| `enabled` | booleovský | Ne | `true` | Zda je háček aktivní |
| `timeout` | číslo | Ne | `5000` | Časový limit v milisekundách |
| `async` | booleovský | Ne | `false` | Běh bez blokování |
| `filter` | objekt | Ne | - | Filtrovat podle nástroje nebo cesty |

### Hook Events

| Akce | Při výstřelu |
| ---------------- | -------------------------------------- |
| `pre-tool` | Před spuštěním jakéhokoli nástroje |
| `post-tool` | Po dokončení nástroje |
| `file-modified` | Při vytvoření/změně/smazání souboru |
| `pre-prompt` | Před odesláním do LLM |
| `post-response` | Poté, co LLM odpoví |
| `session-error` | Když dojde k chybě |

### Proměnné prostředí

Při spuštění háčků jsou k dispozici tyto proměnné prostředí:

| Proměnná | Popis |
| ----------------- | ---------------------------- |
| `HOOK_EVENT` | Název události |
| `HOOK_WORKSPACE` | Kořenová cesta pracovního prostoru |
| `HOOK_TOOL` | Název nástroje (události nástroje) |
| `HOOK_ARGS` | JSON kódované nástroje args |
| `HOOK_SUCCESS` | true/false (post-tool) |
| `HOOK_PATH` | Cesta k souboru (upravený soubor) |
| `HOOK_TOKENS` | Použité tokeny (po reakci) |

---

## Nastavení rozšíření Chrome

Ovládejte integraci rozšíření Autohand pro Chrome. Úplného průvodce naleznete na adrese [Autohand v prohlížeči Chrome] (./autohand-in-chrome.md).
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
| Klíč | Typ | Výchozí | Popis |
| ------------------- | --------- | -------- | ------------------------------------------------------------------------- |
| `extensionId` | `string` | — | Nainstalované ID rozšíření Chrome pro přímé předání |
| `enabledByDefault` | `boolean` | `false` | Spusťte prohlížeč bridge automaticky pomocí CLI |
| `browser` | `string` | `"auto"` | Preferovaný prohlížeč Chromium: `auto`, `chrome`, `chromium`, `brave`, `edge` |
| `userDataDir` | `string` | — | Adresář uživatelských dat prohlížeče pro zacílení na správný profil |
| `profileDirectory` | `string` | — | Název adresáře profilu prohlížeče (např. `"Default"`, `"Profile 1"`) |
| `installUrl` | `string` | — | Záložní adresa URL, když není nakonfigurováno ID rozšíření |

### Příznaky CLI
```bash
autohand --chrome          # Start with browser bridge enabled
autohand --no-chrome       # Start with browser bridge disabled
```
### Příkazy lomítka
```
/chrome                    # Open Chrome integration panel
/chrome disconnect         # Close the browser bridge connection
```
---

## Úplný příklad

### Formát JSON (`~/.autohand/config.json`)
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
### Formát YAML (`~/.autohand/config.yaml`)
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
### Formát TOML (`~/.autohand/config.toml`)
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

## Struktura adresáře

Autohand ukládá data do `~/.autohand/` (nebo `$AUTOHAND_HOME`):
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
**Adresář na úrovni projektu** (v kořenovém adresáři vašeho pracovního prostoru):
```
<project>/.autohand/
├── settings.local.json  # Local project permissions (gitignore this)
├── memory/              # Project-specific memory
├── skills/              # Project-specific skills
└── tools/               # Project-specific meta-tools
```
---

## Příznaky CLI (přepsat konfiguraci)

Tyto příznaky přepisují nastavení konfiguračního souboru:

### Základní příznaky

| Vlajka | Popis |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| `-v, --version` | Vytisknout aktuální verzi |
| `-p, --prompt [text]` | Spusťte jednu instrukci v příkazovém režimu |
| `--path <path>` | Přepsat kořen pracovního prostoru |
| `--config <path>` | Použít vlastní konfigurační soubor |
| `--model <model>` | Model potlačení |
| `--temperature <n>` | Nastavení teploty odběru vzorků (0-1) |
| `--thinking [level]` | Nastavte hloubku myšlení/uvažování (žádná, normální, rozšířená) |
| `-y, --yes` | Výzvy k automatickému potvrzení |
| `--dry-run` | Náhled bez provedení |
| `-d, --debug` | Povolit podrobný výstup ladění |
| `--bare` | Minimální explicitní režim; také nastaví `AUTOHAND_CODE_SIMPLE=1` a zakáže příkazy lomítka |

### Oprávnění a bezpečnost

| Vlajka | Popis |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| `--unrestricted` | Žádné výzvy ke schválení |
| `--restricted` | Odmítnout nebezpečné operace |
| `--permissions` | Zobrazte aktuální nastavení oprávnění a ukončete |
| `--no-idle-logout` | Zakázat ověřené odhlášení při nečinnosti pro dlouhotrvající relace agenta |
| `--yolo [pattern]` | Automaticky schvalovat volání nástroje odpovídající vzor (např. `allow:read,write` nebo `deny:delete`) |
| `--timeout <seconds>` | Časový limit v sekundách pro režim automatického schválení |

### Git & Worktree

| Vlajka | Popis |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| `--worktree [name]` | Spustit relaci v izolovaném pracovním stromu git (volitelný název pracovního stromu/větve) |
| `--tmux` | Spustit ve vyhrazené relaci tmux (předpokládá `--worktree`; nelze použít s `--no-worktree`) |
| `--no-worktree` | Zakázat izolaci pracovního stromu git v automatickém režimu |
| `-c, --auto-commit` | Automatické potvrzení změn po dokončení úkolů |
| `--patch` | Vygenerujte git patch bez použití změn |
| `--output <file>` | Výstupní soubor pro patch (používá se s --patch) |

### Automatický režim
| Vlajka | Popis |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| `--auto-mode [prompt]` | Povolte interaktivní automatický režim nebo spusťte samostatnou smyčku s vloženou úlohou |
| `--max-iterations <n>` | Maximální počet iterací automatického režimu (výchozí: 50) |
| `--completion-promise <text>` | Text značky dokončení (výchozí: "HOTOVO") |
| `--checkpoint-interval <n>` | Git odevzdá každých N iterací (výchozí: 5) |
| `--max-runtime <m>` | Maximální doba běhu v minutách (výchozí: 120) |
| `--max-cost <d>` | Maximální cena API v dolarech (výchozí: 10) |
| `--interactive-on-complete` | Po skončení automatického režimu přejděte přímo do interaktivního režimu (pouze TTY) |

### Dovednosti a učení

| Vlajka | Popis |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| `--auto-skill` | Automatické generování dovedností na základě projektové analýzy (viz také `/learn` pro interaktivního poradce) |
| `--learn` | Spustit `/learn` poradce dovedností neinteraktivně (analyzovat a nainstalovat doporučené dovednosti) |
| `--learn-update` | Znovu analyzujte projekt a neinteraktivně regenerujte zastaralé dovednosti generované LLM |
| `--skill-install [name]` | Nainstalujte komunitní dovednost (otevře prohlížeč, pokud není zadán název) |
| `--project` | Nainstalujte dovednost na úroveň projektu (pomocí --skill-install) |

### Autentizace a účet

| Vlajka | Popis |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| `--login` | Přihlaste se ke svému účtu Autohand |
| `--logout` | Odhlaste se ze svého účtu Autohand |
| `--sync-settings` | Povolit/zakázat synchronizaci nastavení (výchozí: true pro přihlášené uživatele) |

### Nastavení a informace

| Vlajka | Popis |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| `--setup` | Spusťte průvodce nastavením a nakonfigurujte nebo překonfigurujte Autohand |
| `--about` | Zobrazit informace o Autohand (verze, odkazy, informace o příspěvku) |
| `--feedback` | Odeslat zpětnou vazbu týmu Autohand |
| `--settings` | Nakonfigurujte nastavení Autohand (stejné jako `/settings` v interaktivním režimu) |

### Pracovní prostor a adresáře

| Vlajka | Popis |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| `--add-dir <path...>` | Přidat další adresáře do rozsahu pracovního prostoru (lze použít vícekrát) |

### Režimy běhu

| Vlajka | Popis |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| `--mode <mode>` | Režim spuštění: interaktivní (výchozí), rpc nebo acp |
| `--acp` | Zkratka pro --mode acp (Protokol klienta agenta přes stdio) |
| `--teammate-mode <mode>` | Režim týmového zobrazení: auto, v procesu nebo tmux |

### Uživatelské rozhraní a jazyk

| Vlajka | Popis |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| `--display-language <locale>` | Nastavit jazyk zobrazení (např. en, id, zh-cn, fr, de, ja) |
| `--search-engine <provider>` | Nastavit poskytovatele vyhledávání na webu (google, brave, duckduckgo, parallel) |
| `--cc, --context-compact` | Povolit komprimaci kontextu (výchozí: zapnuto) |
| `--no-cc, --no-context-compact` | Zakázat komprimaci kontextu |

### Integrace Chrome

| Vlajka | Popis |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| `--chrome` | Povolit integraci prohlížeče Chrome (stejné jako `/chrome`) |
| `--no-chrome` | Zakázat integraci prohlížeče Chrome |

### Systémová výzva

| Vlajka | Popis |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| `--sys-prompt <value>` | Nahradit celou systémovou výzvu (vložený řetězec nebo cestu k souboru) |
| `--append-sys-prompt <value>` | Připojit k systémové výzvě (vložený řetězec nebo cesta k souboru) |
| `--system-prompt <value>` | Nahradit celou systémovou výzvu (vložený řetězec nebo cestu k souboru) |
| `--system-prompt-file <path>` | Nahradit celý systémový řádek obsahem souboru |
| `--append-system-prompt <value>` | Připojit k systémové výzvě (vložený řetězec nebo cesta k souboru) |
| `--append-system-prompt-file <path>` | Připojit obsah souboru do systémového řádku |
| `--mcp-config <path>` | Načtěte explicitní konfigurační soubor MCP |
| `--agents <json\|path>` | Načtěte explicitní inline agenty JSON nebo adresář explicitních agentů |
| `--plugin-dir <path>` | Načtěte explicitní adresář plugin/meta-tool |

### Příkazy přepínače experimentu

| Příkaz | Popis |
| -------------------------------------- | ------------------------------------------------- |
| `autohand experiments list` | Uveďte místní a vzdálené ID funkcí, zdroj, fázi životního cyklu a stav |
| `autohand experiments status <feature>` | Zobrazit jeden přepínač funkcí, konfigurační cestu nebo vzdálená metadata a stav |
| `autohand experiments refresh` | Stáhněte si příznaky vzdálené funkce z Autohand API |
| `autohand experiments enable <feature>` | Povolte přepínač funkcí podporovaných konfigurací |
| `autohand experiments disable <feature>` | Zakázat přepínač funkcí podporovaných konfigurací |

Příznaky vzdálené funkce se načítají z `/v1/feature-flags/evaluate`, ukládají do mezipaměti `~/.autohand/feature-flags.json` a obnovují se po vypršení platnosti TTL poskytovaného rozhraním API. Použijte `features.environment` pro výběr prostředí vzdáleného příznaku a `features.remoteOverrides` pro místní odhlášení vzdálených příznaků, které může uživatel přepsat.

`usage_v2` je experimentální přepínač funkcí pro řídicí panel `/usage` a vylepšenou kartu `/status` Použití. Povolte jej pomocí `autohand experiments enable usage_v2`.

`token_usage_status` je experimentální přepínač funkcí (konfigurační cesta `features.tokenUsageStatus`, výchozí vypnuto), který ukazuje využití tokenu v reálném čase na řádku pracovního stavu – kumulativní tokeny nahoru (`↑`) a dolů (`↓`) plus obsazení kontextového okna. `↑15.7k ↓3.2k · context: 6.0% (15.7k/262.1k)`. Kontextové okno je řešeno podle modelu napříč všemi poskytovateli. Povolte jej pomocí `autohand experiments enable token_usage_status`.

---

## Příkazy lomítka

Autohand poskytuje bohatou sadu příkazů lomítka pro interaktivní použití. Chcete-li zobrazit návrhy, zadejte `/` do REPL.

### Správa relací

| Příkaz | Popis |
| ------------- | ------------------------------------------------------ |
| `/quit` | Ukončit aktuální relaci |
| `/exit` | Ukončit aktuální relaci |
| `/new` | Začněte novou konverzaci (s extrakcí paměti) |
| `/clear` | Jasná konverzace s automatickou extrakcí paměti |
| `/session` | Zobrazit podrobnosti o aktuální relaci |
| `/sessions` | Seznam minulých relací |
| `/resume` | Obnovit předchozí relaci |
| `/history` | Procházet historii relace pomocí stránkování |
| `/undo` | Vrátit změny git a poslední kolo |
| `/export` | Exportovat relaci do markdown/JSON/HTML |
| `/share` | Sdílet aktuální relaci |
| `/status` | Zobrazit stav relace |
| `/usage` | Zobrazit model, poskytovatele, kontext a limity využití |

### Model a poskytovatel

| Příkaz | Popis |
| ------------- | ------------------------------------------------------ |
| `/model` | Přepnout nebo nakonfigurovat model LLM |
| `/cc` | Kompaktní kontext ručně |

### Nastavení projektu

| Příkaz | Popis |
| ------------- | ------------------------------------------------------ |
| `/init` | Vytvořte soubor `AGENTS.md` v aktuálním adresáři |
| `/setup` | Spusťte průvodce nastavením a nakonfigurujte Autohand |
| `/add-dir` | Přidat adresáře do rozsahu pracovního prostoru |

### Agenti a týmy

| Příkaz | Popis |
| ------------- | ------------------------------------------------------ |
| `/agents` | Seznam dostupných sub-agentů |
| `/agents-new` | Vytvořte nového agenta pomocí průvodce |
| `/squad` | Otevřete/spravujte samostatný běhový modul Autohand Squad |
| `/team` | Řídit tým pro paralelní práci |
| `/tasks` | Správa úkolů v týmu |
| `/message` | Poslat zprávu spoluhráči |

### Dovednosti

| Příkaz | Popis |
| ----------------- | --------------------------------------------------- |
| `/skills` | Seznam a správa dovedností |
| `/skills-new` | Vytvořte novou dovednost |
| `/learn` | Naučte se a nainstalujte doporučené dovednosti |

### Paměť a nastavení

| Příkaz | Popis |
| ------------- | ------------------------------------------------------ |
| `/memory` | Zobrazení a správa uložených vzpomínek |
| `/settings` | Nakonfigurujte nastavení Autohand |
| `/statusline` | Konfigurace polí stavového řádku skladatele |
| `/experiments` | Přepnout přepínače experimentálních funkcí |
| `/sync` | Synchronizace nastavení mezi zařízeními |
| `/import` | Import relací, nastavení, MCP, paměti, dovedností a háčků z podporovaných agentů |

### Oprávnění a háčky

| Příkaz | Popis |
| ------------- | ------------------------------------------------------ |
| `/permissions`| Spravovat oprávnění nástroje |
| `/hooks` | Správa háčků životního cyklu |

### Autentizace

| Příkaz | Popis |
| ------------- | ------------------------------------------------------ |
| `/login` | Ověření pomocí Autohand API |
| `/logout` | Odhlaste se z účtu Autohand |

### Nástroje a utility

| Příkaz | Popis |
| ------------- | ------------------------------------------------------ |
| `/search` | Hledat na webu |
| `/formatters` | Seznam dostupných formátovačů kódu |
| `/lint` | Seznam dostupných kódových linterů |
| `/completion` | Generovat skripty pro dokončení shellu |
| `/plan` | Vytvořit plán implementace |
| `/review` | Proveďte kontrolu kódu |
| `/pr-review` | Zkontrolujte žádost o stažení |

### Integrace IDE

| Příkaz | Popis |
| ------------- | ------------------------------------------------------ |
| `/ide` | Detekce a připojení k běžícím IDE |

### MCP (Model Context Protocol)

| Příkaz | Popis |
| ------------- | ------------------------------------------------------ |
| `/mcp` | Interaktivní správce serveru MCP |

### Automatizace

| Příkaz | Popis |
| ------------- | ------------------------------------------------------ |
| `/automode` | Spusťte režim autonomního kódování |
| `/repeat` | Naplánovat opakující se úlohy |
| `/yolo` | Přepnout režim yolo (automatické schvalování nástrojů) |

### Integrace Chrome

| Příkaz | Popis |
| ------------- | ------------------------------------------------------ |
| `/chrome` | Povolit integraci prohlížeče Chrome |

### Uživatelské rozhraní a displej

| Příkaz | Popis |
| ------------- | ------------------------------------------------------ |
| `/help` | Zobrazit dostupné lomítko a tipy |
| `/about` | Zobrazit informace o Autohand |
| `/theme` | Změnit barevný motiv |
| `/language` | Změnit jazyk zobrazení |
| `/feedback` | Odeslat zpětnou vazbu týmu Autohand |

---

## Přizpůsobení systémových výzev
Autohand vám umožňuje přizpůsobit systémovou výzvu používanou agentem AI. To je užitečné pro specializované pracovní postupy, vlastní pokyny nebo integraci s jinými systémy.

### Příznaky CLI

| Vlajka | Popis |
| ------------------------------ | -------------------------------------------- |
| `--sys-prompt <value>` | Vyměňte celý systémový řádek |
| `--append-sys-prompt <value>` | Připojit obsah k výchozímu systémovému řádku |

Obě vlajky přijímají buď:

- **Vložený řetězec**: Přímý textový obsah
- **Cesta k souboru**: Cesta k souboru obsahujícímu výzvu (automaticky zjištěno)

### Detekce cesty k souboru

Hodnota je považována za cestu k souboru, pokud:

– Začíná na `./`, `../`, `/` nebo `~/`
– Začíná písmenem jednotky Windows (např. `C:\`)
– Končí na `.txt`, `.md` nebo `.prompt`
- Obsahuje oddělovače cest bez mezer

Jinak se s ním zachází jako s vloženým řetězcem.

### `--sys-prompt` (Kompletní výměna)

Pokud je k dispozici, **zcela nahradí** výchozí systémovou výzvu. Agent nenačte:

- Výchozí pokyny Autohand
- Pokyny k projektu AGENTS.md
- Uživatelské/projektové paměti
- Aktivní dovednosti
```bash
# Inline string
autohand --sys-prompt "You are a Python expert. Be concise." --prompt "Write hello world"

# From file
autohand --sys-prompt ./custom-prompt.txt --prompt "Explain this code"

# Home directory
autohand --sys-prompt ~/.autohand/prompts/python-expert.md --prompt "Debug this function"
```
**Ukázkový soubor vlastní výzvy (`custom-prompt.txt`):**
```
You are a specialized Python debugging assistant.

Rules:
- Focus only on Python code
- Always explain the root cause
- Suggest fixes with code examples
- Be concise and direct
```
### `--append-sys-prompt` (Přidat k výchozímu nastavení)

Pokud je k dispozici, **připojí** obsah k úplné výchozí systémové výzvě. Agent stále načte:

- Výchozí pokyny Autohand
- Pokyny k projektu AGENTS.md
- Uživatelské/projektové paměti
- Aktivní dovednosti

Přiložený obsah je přidán na úplný konec.
```bash
# Inline string
autohand --append-sys-prompt "Always use TypeScript instead of JavaScript" --prompt "Create a function"

# From file
autohand --append-sys-prompt ./team-guidelines.md --prompt "Add error handling"
```
**Ukázkový připojovací soubor (`team-guidelines.md`):**
```
## Team Guidelines

- Use 2-space indentation
- Prefer functional patterns
- Add JSDoc comments to public APIs
- Run tests before committing
```
### Přednost

Když jsou poskytnuty oba příznaky:

1. `--sys-prompt` má plnou přednost
2. Kód `--append-sys-prompt` je ignorován
```bash
# --append-sys-prompt is ignored in this case
autohand --sys-prompt "Custom only" --append-sys-prompt "This is ignored"
```
### Případy použití

| Případ použití | Doporučená vlajka |
| ---------------------------------- | ---------------------- |
| Osobní agent na zakázku | `--sys-prompt` |
| Minimální pokyny | `--sys-prompt` |
| Přidat pokyny pro tým | `--append-sys-prompt` |
| Přidat konvence projektu | `--append-sys-prompt` |
| Integrace s externími systémy | `--sys-prompt` |
| Specializované ladění | `--sys-prompt` |

### Zpracování chyb

| Scénář | Chování |
| ------------------ | ------------------------- |
| Prázdná hodnota | Chyba |
| Soubor nenalezen | Považováno za vložený řetězec |
| Prázdný soubor | Chyba |
| Soubor > 1 MB | Chyba |
| Povolení odepřeno | Chyba |
| Cesta k adresáři | Chyba |

### Příklady
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

## Podpora více adresářů

Autohand může pracovat s více adresáři mimo hlavní pracovní prostor. To je užitečné, když má váš projekt závislosti, sdílené knihovny nebo související projekty v různých adresářích.

### Vlajka CLI

Pomocí `--add-dir` přidejte další adresáře (lze použít vícekrát):
```bash
# Add a single additional directory
autohand --add-dir /path/to/shared-lib

# Add multiple directories
autohand --add-dir /path/to/lib1 --add-dir /path/to/lib2

# With unrestricted mode (auto-approve writes to all directories)
autohand --add-dir /path/to/shared-lib --unrestricted
```
### Interaktivní příkaz

Použijte `/add-dir` během interaktivní relace:
```
/add-dir              # Show current directories
/add-dir /path/to/dir # Add a new directory
```
### Bezpečnostní omezení

Nelze přidat následující adresáře:

– Domovský adresář (`~` nebo `$HOME`)
– kořenový adresář (`/`)
– Systémové adresáře (`/etc`, `/var`, `/usr`, `/bin`, `/sbin`)
- Systémové adresáře Windows (`C:\Windows`, `C:\Program Files`)
- Uživatelské adresáře systému Windows (`C:\Users\username`)
- WSL připojení Windows (`/mnt/c`, `/mnt/c/Windows`)
