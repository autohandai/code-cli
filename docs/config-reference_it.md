# Autohand Riferimento alla configurazione

Riferimento completo per tutte le opzioni di configurazione in `~/.autohand/config.json` (o `.toml`/`.yaml`/`.yml`).

> **Suggerimento:** la maggior parte delle impostazioni riportate di seguito possono essere modificate in modo interattivo utilizzando il comando `/settings` invece di modificare manualmente il file.

Riferimenti localizzati:

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

## Sommario

- [Posizione del file di configurazione](#configuration-file-location)
- [Variabili d'ambiente](#environment-variables)
- [Modalità semplice](#bare-mode)
- [Impostazioni fornitore](#provider-settings)
- [Impostazioni area di lavoro](#workspace-settings)
- [Impostazioni interfaccia utente](#ui-settings)
- [Impostazioni agente](#agent-settings)
- [Impostazioni autorizzazioni](#permissions-settings)
- [Modalità patch](#patch-mode)
- [Impostazioni di rete](#network-settings)
- [Impostazioni di telemetria](#telemetry-settings)
- [Agenti esterni](#external-agents)
- [Sistema di competenze](#skills-system)
- [Impostazioni API](#api-settings)
- [Impostazioni di autenticazione](#authentication-settings)
- [Impostazioni competenze della community](#community-skills-settings)
- [Impostazioni di condivisione](#share-settings)
- [Sincronizzazione delle impostazioni](#settings-sync)
- [Impostazioni ganci](#hooks-settings)
- [Impostazioni MCP](#mcp-settings)
- [Impostazioni estensione Chrome](#chrome-extension-settings)
- [Esempio completo](#complete-example)

---

## Posizione del file di configurazione

Autohand cerca la configurazione in questo ordine:

1. Variabile di ambiente `AUTOHAND_CONFIG` (percorso personalizzato)
2. `~/.autohand/config.toml`
3. `~/.autohand/config.yaml`
4. `~/.autohand/config.yml`
5. `~/.autohand/config.json` (predefinito)

Puoi anche sovrascrivere la directory di base:
```bash
export AUTOHAND_HOME=/custom/path  # Changes ~/.autohand to /custom/path
```
---

## Variabili d'ambiente

| Variabile | Descrizione | Esempio |
| -------------------------------------- | ------------------------------------------------ | -------------------------------- |
| `AUTOHAND_HOME` | Directory di base per tutti i dati Autohand | `/custom/path` |
| `AUTOHAND_CONFIG` | Percorso file di configurazione personalizzato | `/path/to/config.toml` |
| `AUTOHAND_API_URL` | Endpoint API (sostituisce la configurazione) | `https://api.autohand.ai` |
| `AUTOHAND_SECRET` | Chiave segreta azienda/team | `sk-xxx` |
| `AUTOHAND_PERMISSION_CALLBACK_URL` | URL per la richiamata dell'autorizzazione (sperimentale) | `http://localhost:3000/callback` |
| `AUTOHAND_PERMISSION_CALLBACK_TIMEOUT` | Timeout per la richiamata dell'autorizzazione in ms | `5000` |
| `AUTOHAND_NON_INTERACTIVE` | Esegui in modalità non interattiva | `1` |
| `AUTOHAND_YES` | Conferma automaticamente tutte le richieste | `1` |
| `AUTOHAND_NO_BANNER` | Disabilita banner di avvio | `1` |
| `AUTOHAND_STREAM_TOOL_OUTPUT` | Streaming dell'output dello strumento in tempo reale | `1` |
| `AUTOHAND_DEBUG` | Abilita la registrazione del debug | `1` |
| `AUTOHAND_THINKING_LEVEL` | Imposta il livello di profondità del ragionamento | `normal` |
| `AUTOHAND_CLIENT_NAME` | Identificativo client/editor (impostato dalle estensioni ACP) | `zed` |
| `AUTOHAND_CLIENT_VERSION` | Versione client (impostata dalle estensioni ACP) | `0.169.0` |
| `AUTOHAND_CODE` | Flag di rilevamento dell'ambiente (impostato automaticamente) | `1` |
| `AUTOHAND_CODE_SIMPLE` | Abilita la modalità bare senza passare `--bare` | `1` |

### Livello di pensiero

La variabile d'ambiente `AUTOHAND_THINKING_LEVEL` controlla la profondità del ragionamento utilizzato dal modello:

| Valore | Descrizione |
| ---------- | ---------------------------------------------------------------------- |
| `none` | Risposte dirette senza ragionamento visibile |
| `normal` | Profondità di ragionamento standard (predefinita) |
| `extended` | Ragionamento profondo per compiti complessi, mostra processi di pensiero più dettagliati |

Questo viene generalmente impostato dalle estensioni client ACP (come Zed) tramite il menu a discesa di configurazione.
```bash
# Example: Use extended thinking for complex tasks
AUTOHAND_THINKING_LEVEL=extended autohand --prompt "refactor this module"
```
---

## Modalità nuda

La modalità bare inizia Autohand solo con le integrazioni di contesto e runtime esplicitamente richieste. Abilitalo con:
```bash
autohand --bare
AUTOHAND_CODE_SIMPLE=1 autohand
```
Quando viene passato `--bare`, Autohand imposta anche `AUTOHAND_CODE_SIMPLE=1` per il processo in esecuzione.

La modalità Bare disabilita l'avvio automatico e le integrazioni interattive:

- hook e notifiche di hook
- Avvio dell'LSP
- Sincronizzazione dei plugin, caricamento automatico dei plugin e caricamento automatico dei meta-strumenti
- attribuzione, telemetria, sincronizzazione delle sessioni, reporting automatico e ping in background
- contesto di bootstrap automatico di memoria/sessione
- suggerimenti di prompt in background, controlli degli aggiornamenti, recuperi di flag di funzionalità e prelettura di metadati del modello
- fallback di autenticazione OAuth del portachiavi e del browser
- `AGENTS.md` automatico e rilevamento delle istruzioni del provider
- tutti i comandi barra, incluso un semplice `/` digitato nel prompt

I percorsi di file assoluti a forma di barra, come `/Users/alex/project/file.ts`, vengono comunque trattati come normale testo di prompt. L'input con barra a forma di comando, ad esempio `/help`, `/model` o `/mcp`, stampa `Slash commands are disabled in bare mode.` e non viene eseguito.

L'autenticazione in modalità bare è solo esplicita. Autohand legge prima `AUTOHAND_API_KEY`, poi `auth.apiKeyHelper` se configurato. Non legge le credenziali del portachiavi né avvia l'accesso OAuth/browser. I fornitori di terze parti continuano a utilizzare le chiavi API e la configurazione specifiche del fornitore.

Questi input espliciti rimangono disponibili in modalità bare:

| Ingresso | Descrizione |
| ----------------------- | ------------------------------------------------------------------------- |
| `--system-prompt <value>` | Sostituisci il prompt di sistema con testo in linea o un valore simile a un percorso |
| `--system-prompt-file <path>` | Sostituisci il prompt di sistema con il contenuto del file |
| `--append-system-prompt <value>` | Aggiunge testo in linea o un valore simile a un percorso al prompt di sistema |
| `--append-system-prompt-file <path>` | Aggiunge il contenuto del file al prompt del sistema |
| `--add-dir <path...>` | Aggiungi directory esplicite all'ambito dell'area di lavoro |
| `--mcp-config <path>` | Carica un file di configurazione MCP esplicito |
| `--settings` | Apri le impostazioni direttamente dal flag CLI |
| `--config <path>` | Utilizza un file di configurazione Autohand esplicito |
| `--agents <json\|path>` | Carica JSON di agenti in linea espliciti o una directory di agenti espliciti |
| `--plugin-dir <path>` | Carica una directory plugin/meta-tool esplicita |

---

## Impostazioni del fornitore

### `provider`

Provider LLM attivo da utilizzare.

| Valore | Descrizione |
| -------------- | ---------------------- |
| `"openrouter"` | API OpenRouter (impostazione predefinita) |
| `"ollama"` | Istanza locale di Ollama |
| `"llamacpp"` | Server locale lama.cpp |
| `"openai"` | API OpenAI direttamente |
| `"mlx"` | MLX su Apple Silicon (locale) |
| `"llmgateway"` | API unificata del gateway LLM |
| `"deepseek"` | API DeepSeek |
| `"zai"` | Z.ai GLM API |
| `"sakana"` | API Sakana.AI Fugu |
| `"bedrock"` | Base rocciosa dell'AWS |
| `"custom:<id>"` | Provider compatibile con OpenAI definito dall'utente da `customProviders` |

### `openrouter`

Configurazione del provider OpenRouter.
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
| Campo | Digitare | Obbligatorio | Predefinito | Descrizione |
| --------------- | ------ | -------- | ------------------------------- | ---------------------------------------------------------------------------- |
| `apiKey` | stringa | Sì | - | La tua chiave API OpenRouter |
| `baseUrl` | stringa | No | `https://openrouter.ai/api/v1` | Endpoint API |
| `model` | stringa | Sì | - | Identificatore del modello (ad esempio, `your-modelcard-id-here`) |
| `contextWindow` | numero | No | Automatico | Finestra di contesto del modello esatto. Autohand lo riempie da OpenRouter quando noto. |

### `zai`

Configurazione del fornitore Z.ai.
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
| Campo | Digitare | Obbligatorio | Predefinito | Descrizione |
| --------------- | ------ | -------- | ------------------------------- | -------------------------------------------------------------------------------- |
| `apiKey` | stringa | Sì | - | La tua chiave API Z.ai |
| `baseUrl` | stringa | No | `https://api.z.ai/api/paas/v4` | Endpoint API |
| `model` | stringa | Sì | `glm-5.2` | Identificatore del modello, ad esempio `glm-5.2`, `glm-5.1` o `glm-4.5` |
| `contextWindow` | numero | No | Automatico | Finestra di contesto del modello esatto. Autohand deduce 1 milione per GLM-5.2 e 200.000 per GLM-5.1. |

### `sakana`

Configurazione del provider Sakana.AI. L'API è compatibile con OpenAI e utilizza `https://api.sakana.ai/v1` come URL di base.
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
| Campo | Digitare | Obbligatorio | Predefinito | Descrizione |
| --------------- | ------ | -------- | ----------------------- | ----------------------------------------------------------------- |
| `apiKey` | stringa | Sì | - | La tua chiave API Sakana |
| `baseUrl` | stringa | No | `https://api.sakana.ai/v1` | Endpoint API |
| `model` | stringa | Sì | `fugu` | Identificatore del modello, ad esempio `fugu` o `fugu-ultra` |
| `contextWindow` | numero | No | Automatico | Finestra di contesto del modello esatto. Autohand deduce 1M per i modelli Fugu.   |

### `customProviders`

I provider personalizzati consentono agli utenti di portare un endpoint compatibile con OpenAI senza una modifica del codice o un nuovo provider in bundle. Aggiungi il provider in `customProviders`, quindi selezionalo con `provider: "custom:<id>"`. Lo stesso flusso è disponibile da `/model` con **Nuovo provider...**. Durante la configurazione, Autohand verifica l'URL di base, l'autenticazione e il modello selezionato tramite l'endpoint `/models` compatibile con OpenAI prima di salvare il provider.
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
Per i server locali compatibili con OpenAI che non richiedono l'autenticazione, imposta `apiKeyRequired` su `false` e ometti `apiKey`.

| Campo | Digitare | Obbligatorio | Predefinito | Descrizione |
| ----------------- | ------- | -------- | ------- | ----------- |
| `id` | stringa | Sì | - | ID fornitore stabile. Deve corrispondere alla chiave dell'oggetto ed è selezionato come `custom:<id>`. |
| `displayName` | stringa | Sì | - | Nome mostrato in `/model` e impostazioni del provider. |
| `apiFormat` | stringa | Sì | - | Deve essere `openai-compatible`. |
| `baseUrl` | stringa | Sì | - | Radice endpoint come `https://api.example.com/v1`. Autohand verifica `/models` e chiama `/chat/completions`. |
| `apiKey` | stringa | Condizionale | - | Token di connessione per endpoint ospitati. Obbligatorio quando `apiKeyRequired` è vero. |
| `apiKeyRequired` | booleano | No | `true` | Imposta false per gateway locali o già autenticati. |
| `model` | stringa | Sì | - | ID modello attivo. |
| `contextWindow` | numero | No | Automatico | Finestra di contesto esatto per budget, stato, telemetria e metadati di sincronizzazione dei token. |
| `reasoningEffort` | stringa | No | - | Facoltativo `none`, `low`, `medium`, `high` o `xhigh`. Inviato come `reasoning_effort` per richieste personalizzate compatibili con OpenAI. |
| `models` | matrice | No | - | Voci di selezione modello facoltative con contesto per modello e metadati di ragionamento. |

### `ollama`

Configurazione del provider Ollama.
```json
{
  "ollama": {
    "baseUrl": "http://localhost:11434",
    "port": 11434,
    "model": "llama3.2"
  }
}
```
| Campo | Digitare | Obbligatorio | Predefinito | Descrizione |
| --------- | ------ | -------- | ------------------------ | ----------------------------------- |
| `baseUrl` | stringa | No | `http://localhost:11434` | URL del server Ollama |
| `port` | numero | No | `11434` | Porta del server (alternativa a baseUrl) |
| `model` | stringa | Sì | - | Nome del modello (ad es. `llama3.2`, `codellama`) |

### `llamacpp`

Configurazione del server lama.cpp.
```json
{
  "llamacpp": {
    "baseUrl": "http://localhost:8080",
    "port": 8080,
    "model": "default"
  }
}
```
| Campo | Digitare | Obbligatorio | Predefinito | Descrizione |
| --------- | ------ | -------- | ----------------------- | -------------------- |
| `baseUrl` | stringa | No | `http://localhost:8080` | URL del server lama.cpp |
| `port` | numero | No | `8080` | Porta del server |
| `model` | stringa | Sì | - | Identificatore del modello |

### `openai`

Configurazione dell'API OpenAI.
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
OpenAI può anche utilizzare il tuo abbonamento ChatGPT tramite il flusso di accesso OpenAI integrato di Autohand:
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
| Campo | Digitare | Obbligatorio | Predefinito | Descrizione |
| --------------- | ------ | ---------------------- | --------------------- | ------------------------------------------------------------------------- |
| `authMode` | stringa | No | `api-key` | Modalità di autenticazione: `api-key` o `chatgpt` |
| `apiKey` | stringa | Sì per la modalità `api-key` | - | Chiave API OpenAI |
| `baseUrl` | stringa | No | `https://api.openai.com/v1` | Endpoint API |
| `model` | stringa | Sì | - | Nome del modello (ad es. `gpt-5.4`, `gpt-5.4-mini`) |
| `contextWindow` | numero | No | Automatico | Finestra di contesto del modello esatto. Impostalo per sovrascrivere i presupposti locali obsoleti. |
| `chatgptAuth` | oggetto | Sì per la modalità `chatgpt` | - | Token di autenticazione ChatGPT/Codex e ID account memorizzati |

### `mlx`

Provider MLX per Mac Apple Silicon (inferenza locale).
```json
{
  "mlx": {
    "baseUrl": "http://localhost:8080",
    "port": 8080,
    "model": "mlx-community/Llama-3.2-3B-Instruct-4bit"
  }
}
```
| Campo | Digitare | Obbligatorio | Predefinito | Descrizione |
| --------- | ------ | -------- | ----------------------- | -------------------- |
| `baseUrl` | stringa | No | `http://localhost:8080` | URL del server MLX |
| `port` | numero | No | `8080` | Porta del server |
| `model` | stringa | Sì | - | Identificatore del modello MLX |

### `llmgateway`

Configurazione API unificata del gateway LLM. Fornisce l'accesso a più provider LLM tramite un'unica API.
```json
{
  "llmgateway": {
    "apiKey": "your-llmgateway-api-key",
    "baseUrl": "https://api.llmgateway.io/v1",
    "model": "gpt-4o"
  }
}
```
| Campo | Digitare | Obbligatorio | Predefinito | Descrizione |
| --------- | ------ | -------- | ------------------------------- | --------------------------------------------------------------- |
| `apiKey` | stringa | Sì | - | Chiave API del gateway LLM |
| `baseUrl` | stringa | No | `https://api.llmgateway.io/v1` | Endpoint API |
| `model` | stringa | Sì | - | Nome del modello (ad es. `gpt-4o`, `claude-3-5-sonnet-20241022`) |

**Ottenere una chiave API:**
Visita [llmgateway.io/dashboard](https://llmgateway.io/dashboard) per creare un account e ottenere la chiave API.

**Modelli supportati:**
LLM Gateway supporta modelli di più fornitori, tra cui:

- OpenAI: `gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo`
`claude-3-5-haiku-20241022`
-Google: `gemini-1.5-pro`, `gemini-1.5-flash`

### `deepseek`

Configurazione del provider DeepSeek. L'API è compatibile con OpenAI e utilizza `https://api.deepseek.com` come URL di base.
```json
{
  "deepseek": {
    "apiKey": "your-deepseek-api-key",
    "baseUrl": "https://api.deepseek.com",
    "model": "deepseek-v4-flash"
  }
}
```
| Campo | Digitare | Obbligatorio | Predefinito | Descrizione |
| --------- | ------ | -------- | -------------------------- | --------------------------------------------------------------------- |
| `apiKey` | stringa | Sì | - | Chiave API DeepSeek |
| `baseUrl` | stringa | No | `https://api.deepseek.com` | Endpoint API |
| `model` | stringa | Sì | - | Nome del modello, ad esempio `deepseek-v4-flash` o `deepseek-v4-pro` |

### `bedrock`

Configurazione del fornitore AWS Bedrock. `converse` è la modalità predefinita e utilizza la catena di credenziali dell'SDK AWS. Le modalità compatibili con OpenAI utilizzano chiavi API Bedrock ed endpoint compatibili con Bedrock OpenAI.
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
| Campo | Digitare | Obbligatorio | Predefinito | Descrizione |
| ---------- | ------ | -------- | ------- | ----------- |
| `model` | stringa | Sì | - | ID modello Bedrock, ID profilo di inferenza o ARN |
| `region` | stringa | Sì | `AWS_REGION`, quindi `AWS_DEFAULT_REGION`, quindi `us-east-1` nelle impostazioni | Regione AWS |
| `apiMode` | stringa | No | `converse` | `converse`, `openai-chat` o `openai-responses` |
| `authMode` | stringa | No | `aws-credentials` per `converse`, `bedrock-api-key` per modalità compatibili con OpenAI | Modalità di autenticazione |
| `profile` | stringa | No | - | Profilo AWS facoltativo per l'autenticazione della catena di credenziali |
| `endpoint` | stringa | No | Derivato da modalità e regione | Endpoint Bedrock personalizzato/privato |
| `apiKey` | stringa | Sì per le modalità compatibili con OpenAI | - | Chiave API Bedrock. Non utilizzare chiavi API OpenAI. |

Esegui `aws configure sso` o imposta `AWS_PROFILE=enterprise-prod autohand` per l'autenticazione AWS basata sul profilo. Le credenziali del ruolo IAM, del contenitore e dei metadati dell'istanza sono supportate dall'SDK AWS. Abilita l'accesso al modello nella console AWS prima di utilizzare un modello.

---

## Impostazioni dell'area di lavoro
```json
{
  "workspace": {
    "defaultRoot": "/path/to/projects",
    "allowDangerousOps": false
  }
}
```
| Campo | Digitare | Predefinito | Descrizione |
| ------------------- | ------- | ----------------- | ------------------------------------------------- |
| `defaultRoot` | stringa | Directory corrente | Area di lavoro predefinita quando non ne è specificato nessuno |
| `allowDangerousOps` | booleano | `false` | Consenti operazioni distruttive senza conferma |

### Sicurezza sul lavoro

Autohand blocca automaticamente il funzionamento nelle directory pericolose per prevenire danni accidentali:

- **Radici del file system** (`/`, `C:\`, `D:\`, ecc.)
- **Directory home** (`~`, `/Users/<user>`, `/home/<user>`, `C:\Users\<user>`)
- **Directory di sistema** (`/etc`, `/var`, `/System`, `C:\Windows`, ecc.)
- **Supporti Windows WSL** (`/mnt/c`, `/mnt/c/Users/<user>`)

Questo controllo non può essere aggirato. Se provi a eseguire autohand in una directory pericolosa, vedrai un errore e dovrai specificare una directory di progetto sicura.
```bash
# This will be blocked
cd ~ && autohand
# Error: Unsafe Workspace Directory

# This works
cd ~/projects/my-app && autohand
```
Per i dettagli completi, consulta [Sicurezza sullo spazio di lavoro](./workspace-safety.md).

---

## Impostazioni dell'interfaccia utente
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
| Campo | Digitare | Predefinito | Descrizione |
| ---------------------- | ------ | ------- | ---------------------------------------------------------------------------------------- |
| `theme` | stringa | `"dark"` | Tema colore per l'output del terminale. Le funzionalità integrate includono `dark`, `light`, `dracula`, `sandy`, `tui`, `github-dark`, `cappadocia`, `rio` e `australia`. I valori legacy `turkey` e `brazil` vengono ancora caricati come alias. |
| `customThemes` | oggetto | `{}` | Definizioni di temi personalizzati incorporati con chiave in base al nome del tema. Imposta `theme` sulla stessa chiave per usarne uno.   |
| `autoConfirm` | booleano | `false` | Salta le richieste di conferma per operazioni sicure |
| `readFileCharLimit` | numero | `300` | Numero massimo di caratteri da visualizzare dall'output dello strumento di lettura/trova (il contenuto completo viene comunque inviato al modello) |
| `silentToolOutput` | booleano | `false` | Nascondi i blocchi di output dello strumento nel terminale preservando comunque i risultati dello strumento per il modello/sessione |
| `activityVerbs` | stringa o stringa[] | piscina integrata | Verbo di attività personalizzato o pool di verbi per l'indicatore di lavoro, reso come `Verb...` |
| `activityVerbsEnabled` | booleano | `true` | Mostra verbi di attività a rotazione come `Compiling...` mentre l'agente sta lavorando |
| `activitySymbol` | stringa | `"✳"` | Simbolo mostrato prima del verbo dell'attività nell'output dell'indicatore di attività |
| `statusLine.showProviderModel` | booleano | `true` | Mostra il fornitore e il modello attivi nella riga di stato del compositore |
| `statusLine.showContext` | booleano | `true` | Mostra la percentuale del contesto nella riga di stato del compositore |
| `statusLine.showCommandHint` | booleano | `true` | Mostra suggerimenti per comandi, menzioni, abilità e voci del terminale nella riga di stato del compositore |
| `statusLine.showPullRequest` | booleano | `true` | Mostra il numero della richiesta pull associata o `PR #123` quando non è associato alcun PR |
| `statusLine.showSessionLines` | booleano | `false` | Mostra le righe aggiunte e rimosse durante la sessione corrente |
| `statusLine.showQueue` | booleano | `true` | Mostra i conteggi delle richieste in coda nella riga di stato |
| `statusLine.showActiveStatus` | booleano | `true` | Mostra il testo dello stato del turno attivo mentre l'agente sta lavorando |
| `statusLine.showActiveMetrics` | booleano | `true` | Mostra il tempo trascorso e le metriche dei token mentre l'agente sta lavorando |
| `statusLine.showCancelHint` | booleano | `true` | Mostra il suggerimento di annullamento Esc mentre l'agente sta lavorando |
| `completionReportEnabled` | booleano | `true` | Chiedi al modello di includere un rapporto conciso sul completamento dopo i turni di azione completati |
| `showCompletionNotification` | booleano | `true` | Mostra la notifica di sistema al completamento dell'attività |
| `showThinking` | booleano | `true` | Visualizza il processo di ragionamento/pensiero di LLM |
| `terminalBell` | booleano | `true` | Suona il campanello del terminale al completamento dell'attività (mostra il badge sulla scheda/dock del terminale) |
| `checkForUpdates` | booleano | `true` | Controlla gli aggiornamenti della CLI all'avvio |
| `updateCheckInterval` | numero | `24` | Ore tra i controlli degli aggiornamenti (utilizza il risultato memorizzato nella cache nell'intervallo) |

I temi personalizzati possono sovrascrivere qualsiasi token di colore semantico. I token mancanti vengono ereditati dal tema scuro:
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
Nota: `readFileCharLimit` e `silentToolOutput` influiscono solo sulla visualizzazione del terminale. Il contenuto completo viene comunque inviato al modello e archiviato nei messaggi dello strumento.

Puoi attivare/disattivare l'output silenzioso dello strumento senza modificare il file:
```bash
autohand config set silent_tool_output true
autohand config set silent_tool_output false
```
Puoi attivare/disattivare la rotazione dei verbi di attività senza modificare il file:
```bash
autohand config set verbs activity true
autohand config set verbs activity false
```
Personalizza i verbi nel file di configurazione quando desideri un'etichetta di stato fissa o una piccola rotazione specifica del progetto:
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
`activityVerbs` accetta una singola stringa o un array di stringhe non vuoto. Quando `activityVerbsEnabled` è `false`, Autohand torna a `Working...` invece di ruotare tra verbi personalizzati o incorporati.

Puoi attivare/disattivare i report di completamento, incluso il prompt strutturato `SITREP`, senza modificare il file:
```bash
autohand config set sitrep true
autohand config set sitrep false
```
### Campanello del terminale

Quando `terminalBell` è abilitato (impostazione predefinita), Autohand suona il campanello del terminale (`\x07`) al completamento di un'attività. Ciò innesca:

- **Badge sulla scheda del terminale**: mostra un indicatore visivo che il lavoro è terminato
- **Rimbalzo dell'icona del Dock** - Attira la tua attenzione quando il terminale è in background (macOS)
- **Suono** - Se i suoni del terminale sono abilitati nelle impostazioni del terminale

Impostazioni specifiche del terminale:

- **Terminale macOS**: Preferenze > Profili > Avanzate > Campanello (visivo/uditivo)
- **iTerm2**: Preferenze > Profili > Terminale > Notifiche
- **Terminale VS Code**: Impostazioni > Terminale > Integrato: attiva campanello

Per disabilitare:
```json
{
  "ui": {
    "terminalBell": false
  }
}
```
### Rendering inchiostro

Autohand utilizza il renderer Ink 7 + React 19 per impostazione predefinita per i terminali interattivi. Il campo di configurazione legacy `ui.useInkRenderer` viene ignorato, quindi i vecchi file di configurazione non possono forzare il semplice compositore del terminale. L'inchiostro fornisce:

- **Output senza sfarfallio**: tutti gli aggiornamenti dell'interfaccia utente vengono raggruppati tramite la riconciliazione React
- **Funzione coda di lavoro**: digita le istruzioni mentre l'agente lavora
- **Migliore gestione dell'input**: nessun conflitto tra i gestori readline
- **Interfaccia utente componibile**: base per le future funzionalità avanzate dell'interfaccia utente

Fallback di emergenza per la compatibilità del terminale:
```bash
AUTOHAND_LEGACY_UI=1 autohand
```
Nota: questa funzionalità è sperimentale e potrebbe presentare casi limite. L'interfaccia utente predefinita basata su Ora rimane stabile e perfettamente funzionante.

### Controllo aggiornamenti

Quando `checkForUpdates` è abilitato (impostazione predefinita), Autohand verifica la presenza di nuove versioni all'avvio:
```
> Autohand v0.6.8 (abc1234) ✓ Up to date
```
Se è disponibile un aggiornamento:
```
> Autohand v0.6.7 (abc1234) ⬆ Update available: v0.6.8
  ↳ Run: curl -fsSL https://autohand.ai/install.sh | sh
```
Come funziona:

- Recupera l'ultima versione dall'API GitHub
- Il risultato delle cache è `~/.autohand/version-check.json`
- Controlla solo una volta ogni `updateCheckInterval` ore (impostazione predefinita: 24)
- Non bloccante: l'avvio continua anche se il controllo fallisce

Per disabilitare:
```json
{
  "ui": {
    "checkForUpdates": false
  }
}
```
Oppure tramite variabile d'ambiente:
```bash
export AUTOHAND_SKIP_UPDATE_CHECK=1
```
---

## Impostazioni dell'agente

Comportamento dell'agente di controllo e limiti di iterazione.
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
| Campo | Digitare | Predefinito | Descrizione |
| -------------------- | ------- | ------- | ------------------------------------------------------------------------ |
| `maxIterations` | numero | `100` | Numero massimo di iterazioni dello strumento per richiesta dell'utente prima dell'arresto |
| `enableRequestQueue` | booleano | `true` | Consenti agli utenti di digitare e accodare le richieste mentre l'agente sta lavorando |
| `toolSelectionCache` | booleano | `true` | Memorizza nella cache la selezione dello schema dello strumento locale per turno per l'input di selezione dello strumento equivalente |
| `autoMemory` | booleano | `true` | Estrai e salva ricordi durevoli di utenti/progetti dopo turni interattivi riusciti |
| `idleLogoutEnabled` | booleano | `true` | Disconnettersi dalle sessioni interattive autenticate dopo il timeout di inattività |
| `debug` | booleano | `false` | Abilita output di debug dettagliato (registra lo stato interno dell'agente su stderr) |

### Selezione dello schema degli strumenti

Autohand non invia tutti gli schemi completi degli strumenti su ogni richiesta LLM. Il prompt del sistema include un catalogo compatto delle funzionalità dello strumento e ogni richiesta espone solo un piccolo insieme di schemi concreti selezionati da:

- Strumenti di rilevamento principali come `tool_search`, `read_file`, `fff_find` e `fff_grep`
- Strumenti mirati per operazioni di modifica, verifica, git, browser, web, dipendenze o monitoraggio dei progetti
- Strumenti richiesti tramite recenti chiamate `tool_search` o menzionati esplicitamente per nome

Ciò evita il grande costo iniziale del contesto derivante dall'invio di tutti gli schemi degli strumenti prima che l'intento dell'utente sia noto. `toolSelectionCache` controlla solo la cache del selettore locale per turni equivalenti; non esegue un riscaldamento LLM pre-utente e non impone un prefisso di prompt memorizzato nella cache di grandi dimensioni.

Per disabilitare la cache del selettore locale:
```json
{
  "agent": {
    "toolSelectionCache": false
  }
}
```
Per mantenere attive le sessioni autenticate dell'agente di lunga durata mentre attendono il lavoro:
```json
{
  "agent": {
    "idleLogoutEnabled": false
  }
}
```
Per un singolo processo, utilizzare `autohand --no-idle-logout` o impostare `AUTOHAND_NO_IDLE_LOGOUT=1`.

### Modalità di debug

Abilita la modalità debug per visualizzare la registrazione dettagliata dello stato interno dell'agente (iterazioni del loop di reazione, creazione di prompt, dettagli della sessione). L'output va a stderr per evitare di interferire con l'output normale.

Tre modi per abilitare la modalità debug (in ordine di precedenza):

1. **Flag CLI**: `autohand -d` o `autohand --debug`
2. **Variabile d'ambiente**: `AUTOHAND_DEBUG=1`
3. **File di configurazione**: imposta `agent.debug: true`

### Richiedi coda

Quando `enableRequestQueue` è abilitato, puoi continuare a digitare messaggi mentre l'agente elabora una richiesta precedente. Il tuo input verrà messo in coda ed elaborato automaticamente al completamento dell'attività corrente.

- Digita il tuo messaggio e premi Invio per aggiungerlo alla coda
- La riga di stato mostra quante richieste sono in coda
- Le richieste vengono elaborate in ordine FIFO (first-in, first-out).
- La dimensione massima della coda è di 10 richieste

---

## Impostazioni delle autorizzazioni

Controllo minuzioso sulle autorizzazioni degli strumenti.
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

| Valore | Descrizione |
| ---------------- | ----------------------------------------------------- |
| `"interactive"` | Richiedi l'approvazione per operazioni pericolose (impostazione predefinita) |
| `"unrestricted"` | Nessuna richiesta, consenti tutto |
| `"restricted"` | Negare tutte le operazioni pericolose |

### `whitelist`

Serie di modelli di strumenti che non richiedono mai l'approvazione.
```json
["run_command:npm *", "run_command:bun test"]
```
### `blacklist`

Matrice di modelli di utensili sempre bloccati.
```json
["run_command:rm -rf /", "run_command:sudo *"]
```
### `rules`

Regole di autorizzazione dettagliate.

| Campo | Digitare | Descrizione |
| --------- | --------- | -------------------------------------------------- | ---------- | -------------- |
| `tool` | stringa | Nome dello strumento da abbinare |
| `pattern` | stringa | Modello facoltativo da confrontare con gli argomenti |
| `action` | `"allow"` | `"deny"` | `"prompt"` | Azioni da intraprendere |

### `rememberSession`

| Digitare | Predefinito | Descrizione |
| ------- | ------- | -------------------------------------------------- |
| booleano | `true` | Ricordare le decisioni di approvazione per la sessione |

### Autorizzazioni del progetto locale

Ogni progetto può avere le proprie impostazioni di autorizzazione che sovrascrivono la configurazione globale. Questi sono archiviati in `.autohand/settings.local.json` nella root del tuo progetto.

Quando approvi un'operazione su un file (modifica, scrittura, eliminazione), questa viene automaticamente salvata in questo file in modo che non ti venga richiesta nuovamente la stessa operazione in questo progetto.
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
**Come funziona:**

- Quando approvi un'operazione, viene salvata in `.autohand/settings.local.json`
- La prossima volta, la stessa operazione verrà approvata automaticamente
- Le impostazioni locali del progetto vengono unite alle impostazioni globali (il locale ha la priorità)
- Aggiungi `.autohand/settings.local.json` a `.gitignore` per mantenere private le impostazioni personali

**Formato modello:**

- `tool_name:path` - Per operazioni sui file (ad esempio, `apply_patch:src/file.ts`)
- `tool_name:command args` - Per i comandi (ad esempio, `run_command:npm test`)

### Autorizzazioni di visualizzazione

Puoi visualizzare le impostazioni attuali delle autorizzazioni in due modi:

**Flag CLI (non interattivo):**
```bash
autohand --permissions
```
Viene visualizzato:

- Modalità di autorizzazione corrente (interattiva, senza restrizioni, limitata)
- Area di lavoro e percorsi dei file di configurazione
- Tutti i modelli approvati (lista bianca)
- Tutti i modelli negati (lista nera)
- Statistiche riassuntive

**Comando interattivo:**
```
/permissions
```
In modalità interattiva, il comando `/permissions` fornisce le stesse informazioni più opzioni per:

- Rimuovere gli elementi dalla lista bianca
- Rimuovere gli elementi dalla lista nera
- Cancella tutte le autorizzazioni salvate

---

## Modalità patch

La modalità patch ti consente di generare una patch condivisibile compatibile con git senza modificare i file dell'area di lavoro. Questo è utile per:

- Revisione del codice prima di applicare le modifiche
- Condivisione delle modifiche generate dall'intelligenza artificiale con i membri del team
- Creazione di set di modifiche riproducibili
- Pipeline CI/CD che devono acquisire le modifiche senza applicarle

### Utilizzo
```bash
# Generate patch to stdout
autohand --prompt "add user authentication" --patch

# Save to file
autohand --prompt "add user authentication" --patch --output auth.patch

# Pipe to file (alternative)
autohand --prompt "refactor api handlers" --patch > refactor.patch
```
### Comportamento

Quando viene specificato `--patch`:

- **Conferma automatica**: tutte le conferme vengono accettate automaticamente (`--yes` implicito)
- **Nessuna richiesta**: non viene mostrata alcuna richiesta di approvazione (`--unrestricted` implicito)
- **Solo anteprima**: le modifiche vengono acquisite ma NON scritte su disco
- **Sicurezza applicata**: le operazioni nella lista nera (`.env`, chiavi SSH, comandi pericolosi) sono ancora bloccate

### Applicazione delle patch

I destinatari possono applicare la patch utilizzando i comandi git standard:
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
### Formato della patch

La patch generata segue il formato diff unificato di git:
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
### Codici di uscita

| Codice | Significato |
| ---- | --------------------------------------------------- |
| `0` | Successo, patch generata |
| `1` | Errore (`--prompt` mancante, autorizzazione negata, ecc.) |

### Combinazione con altri flag
```bash
# Use specific model
autohand --prompt "optimize queries" --patch --model gpt-4o

# Specify workspace
autohand --prompt "add tests" --patch --path ./my-project

# Use custom config
autohand --prompt "refactor" --patch --config ~/.autohand/work.json
```
### Esempio di flusso di lavoro del team
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

## Impostazioni di rete
```json
{
  "network": {
    "maxRetries": 3,
    "timeout": 30000,
    "retryDelay": 1000
  }
}
```
| Campo | Digitare | Predefinito | Massimo | Descrizione |
| ------------ | ------ | ------- | --- | -------------------------------------- |
| `maxRetries` | numero | `3` | `5` | Riprovare i tentativi per richieste API non riuscite |
| `timeout` | numero | `30000` | - | Richiedi timeout in millisecondi |
| `retryDelay` | numero | `1000` | - | Ritardo tra i tentativi in ​​millisecondi |

---

## Impostazioni di telemetria

La telemetria è **disabilitata per impostazione predefinita** (attivazione). Abilitalo per contribuire a migliorare Autohand.
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
| Campo | Digitare | Predefinito | Descrizione |
| ------------------- | ------- | ------------------------ | --------------------------------------------- |
| `enabled` | booleano | `false` | Abilita/disabilita la telemetria (attivazione) |
| `apiBaseUrl` | stringa | `https://api.autohand.ai` | Endpoint API di telemetria |
| `batchSize` | numero | `20` | Numero di eventi da raggruppare prima dello scaricamento automatico |
| `flushIntervalMs` | numero | `60000` | Intervallo di lavaggio in millisecondi (1 minuto) |
| `maxQueueSize` | numero | `500` | Dimensione massima della coda prima di eliminare i vecchi eventi |
| `maxRetries` | numero | `3` | Tentativi successivi per richieste di telemetria non riuscite |
| `enableSessionSync` | booleano | `true` | Sincronizza le sessioni sul cloud per le funzionalità del team quando la telemetria è abilitata |
| `companySecret` | stringa | `""` | Segreto aziendale per l'autenticazione API |

La telemetria del provider/modello include l'ID del provider attivo, l'ID del modello e i metadati non segreti disponibili come il nome visualizzato del provider personalizzato, il formato API, lo sforzo di ragionamento e la finestra di contesto. Le chiavi API e i token di connessione non sono mai inclusi.

---

## Agenti esterni

Carica le definizioni dell'agente personalizzato da directory esterne.
```json
{
  "externalAgents": {
    "enabled": true,
    "paths": ["~/.autohand/agents", "/team/shared/agents"]
  }
}
```
| Campo | Digitare | Predefinito | Descrizione |
| --------- | -------- | ------- | ------------------------------- |
| `enabled` | booleano | `false` | Abilita caricamento agente esterno |
| `paths` | stringa[] | `[]` | Directory da cui caricare gli agenti |

---

## Sistema di competenze

Le abilità sono pacchetti di istruzioni che forniscono istruzioni specializzate all'agente AI. Funzionano come file `AGENTS.md` su richiesta che possono essere attivati ​​per attività specifiche.

### Posizioni per la scoperta delle abilità

Le competenze vengono scoperte da più posizioni, con le fonti successive che hanno la precedenza:

| Posizione | ID fonte | Descrizione |
| --------------------------------------- | ------------------ | ----------------------------------------- |
| `~/.codex/skills/**/SKILL.md` | `codex-user` | Competenze del Codex a livello utente (ricorsivo) |
| `~/.claude/skills/*/SKILL.md` | `claude-user` | Competenze Claude a livello utente (un livello) |
| `~/.autohand/skills/**/SKILL.md` | `autohand-user` | Competenze Autohand a livello utente (ricorsive) |
| `<project>/.claude/skills/*/SKILL.md` | `claude-project` | Competenze Claude a livello di progetto (un livello) |
| `<project>/.autohand/skills/**/SKILL.md` | `autohand-project` | Competenze Autohand a livello di progetto (ricorsive) |

### Comportamento di copia automatica

Le abilità scoperte dalle posizioni Codex o Claude vengono automaticamente copiate nella posizione Autohand corrispondente:

- `~/.codex/skills/` e `~/.claude/skills/` → `~/.autohand/skills/`
- `<project>/.claude/skills/` → `<project>/.autohand/skills/`

Le competenze esistenti nelle sedi Autohand non verranno mai sovrascritte.

### Formato SKILL.md

Le competenze utilizzano il frontmatter YAML seguito dal contenuto di markdown:
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
| Campo | Obbligatorio | Lunghezza massima | Descrizione |
| --------------- | -------- | ---------- | ----------------------------------- |
| `name` | Sì | 64 caratteri | Alfanumerico minuscolo con solo trattini |
| `description` | Sì | 1024 caratteri | Breve descrizione dell'abilità |
| `license` | No | - | Identificativo della licenza (ad esempio, MIT, Apache-2.0) |
| `compatibility` | No | 500 caratteri | Note di compatibilità |
| `allowed-tools` | No | - | Elenco delimitato da spazi degli strumenti consentiti |
| `metadata` | No | - | Metadati valore-chiave aggiuntivi |

### Prefissi di input

Autohand supporta prefissi speciali nel prompt di input:

| Prefisso | Descrizione | Esempio |
| ------ | ------------------------------- | ---------------------------------- |
| `/` | Comandi barra | `/help`, `/model`, `/quit`, `/exit` |
| `@` | Menzioni di file (completamento automatico) | `@src/index.ts` |
| `$` | Menzioni di abilità (completamento automatico) | `$frontend-design`, `$code-review` |
| `!` | Esegui direttamente i comandi del terminale | `! git status`, `! ls -la` |

**Menzioni sulle abilità (`$`):**

- Digita `$` seguito da caratteri per vedere le competenze disponibili con il completamento automatico
- La scheda accetta il suggerimento principale (ad esempio, `$frontend-design`)
- Le abilità vengono scoperte da `~/.autohand/skills/` e `<project>/.autohand/skills/`
- Le abilità attivate sono allegate al prompt come istruzioni speciali per la sessione corrente
- Il pannello di anteprima mostra i metadati delle competenze (nome, descrizione, stato di attivazione)

**Comandi della shell (`!`):**

- I comandi vengono eseguiti nella directory di lavoro corrente
- L'output viene visualizzato direttamente nel terminale
- Non va al LLM
- Timeout di 30 secondi
- Ritorna al prompt dopo l'esecuzione

### Comandi barra

#### `/skills` - Gestore pacchetti

| Comando | Descrizione |
| ------------------------------- | ----------------------------------- |
| `/skills` | Elenca tutte le competenze disponibili |
| `/skills use <name>` | Attiva una competenza per la sessione corrente |
| `/skills deactivate <name>` | Disattivare un'abilità |
| `/skills info <name>` | Mostra informazioni dettagliate sulle competenze |
| `/skills install` | Sfoglia e installa dal registro della comunità |
| `/skills install @<slug>` | Installa una competenza della community tramite slug |
| `/skills search <query>` | Cerca nel registro delle competenze della comunità |
| `/skills trending` | Mostra le competenze di tendenza della community |
| `/skills remove <slug>` | Disinstallare una competenza della community |
| `/skills new` | Crea una nuova abilità in modo interattivo |
| `/skills feedback <slug> <1-5>` | Valuta una competenza della community |

#### `/learn` - Consulente di competenze basato su LLM

| Comando | Descrizione |
| --------------- | ---------------------------------------------------------------- |
| `/learn` | Analizza il progetto e consiglia le competenze (scansione rapida) |
| `/learn deep` | Progetto di scansione approfondita (legge i file sorgente) per risultati più mirati |
| `/learn update` | Rianalizzare il progetto e rigenerare le competenze obsolete generate dal LLM |

`/learn` utilizza un flusso LLM a due fasi:

1. **Fase 1 - Analizza + Classifica + Verifica**: analizza la struttura del progetto, verifica le competenze installate per verificare ridondanza/conflitti e classifica le competenze della comunità in base alla pertinenza (0-100).
2. **Fase 2 - Generazione** (condizionale): se nessuna competenza della community ottiene un punteggio superiore a 60, si offre di generare una competenza personalizzata su misura per il tuo progetto.
Le competenze generate includono metadati (`agentskill-source: llm-generated`, `agentskill-project-hash`) in modo che `/learn update` possa rilevare quando la base di codice cambia e rigenerare competenze obsolete.

### Generazione automatica delle abilità (`--auto-skill`)

Il flag `--auto-skill` CLI genera competenze senza il flusso dell'advisor interattivo:
```bash
autohand --auto-skill
```
Ciò:

1. Analizza la struttura del tuo progetto (package.json, requisiti.txt, ecc.)
2. Rileva linguaggi, strutture e modelli
3. Genera 3 competenze rilevanti utilizzando LLM
4. Salva le competenze in `<project>/.autohand/skills/`

Per un'esperienza più mirata e interattiva, utilizza invece `/learn` all'interno di una sessione.

I modelli rilevati includono:

- **Lingue**: TypeScript, JavaScript, Python, Rust, Go
- **Framework**: React, Next.js, Vue, Express, Flask, Django
- **Modelli**: strumenti CLI, test, monorepo, Docker, CI/CD

---

## Impostazioni API

Configurazione dell'API backend per le funzionalità del team.
```json
{
  "api": {
    "baseUrl": "https://api.autohand.ai",
    "companySecret": "sk-team-xxx"
  }
}
```
| Campo | Digitare | Predefinito | Descrizione |
| --------------- | ------ | ------------------------ | --------------------------------------- |
| `baseUrl` | stringa | `https://api.autohand.ai` | Endpoint API |
| `companySecret` | stringa | - | Segreto del team/azienda per le funzionalità condivise |

Può anche essere impostato tramite variabili di ambiente:

- `AUTOHAND_API_URL` → `api.baseUrl`
- `AUTOHAND_SECRET` → `api.companySecret`

---

## Impostazioni di autenticazione

Autenticazione e configurazione della sessione utente.
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
| Campo | Digitare | Predefinito | Descrizione |
| ------------- | ------ | ------- | -------------------------------------------- |
| `token` | stringa | - | Token di autenticazione per l'accesso API |
| `user` | oggetto | - | Informazioni utente autenticato |
| `user.id` | stringa | - | ID utente |
| `user.email` | stringa | - | Indirizzo e-mail dell'utente |
| `user.name` | stringa | - | Nome visualizzato dell'utente |
| `user.avatar` | stringa | - | URL avatar utente (facoltativo) |
| `expiresAt` | stringa | - | Timestamp di scadenza del token (formato ISO 8601) |

---

## Impostazioni delle competenze della community

Configurazione per la scoperta e la gestione delle competenze della comunità.
```json
{
  "communitySkills": {
    "enabled": true,
    "showSuggestionsOnStartup": true,
    "autoBackup": true
  }
}
```
| Campo | Digitare | Predefinito | Descrizione |
| -------------------------- | ------- | ------- | ------------------------------------------------------------- |
| `enabled` | booleano | `true` | Abilita le funzionalità delle competenze della community |
| `showSuggestionsOnStartup` | booleano | `true` | Mostra suggerimenti sulle competenze all'avvio quando non esistono competenze del fornitore |
| `autoBackup` | booleano | `true` | Esegui automaticamente il backup delle competenze dei fornitori rilevate nell'API |

---

## Impostazioni di condivisione

Configurazione per la condivisione della sessione tramite il comando `/share`. Le sessioni sono ospitate su [autohand.link](https://autohand.link).
```json
{
  "share": {
    "enabled": true
  }
}
```
| Campo | Digitare | Predefinito | Descrizione |
| --------- | ------- | ------- | ----------------------------------- |
| `enabled` | booleano | `true` | Abilita/disabilita il comando `/share` |

### Formato YAML
```yaml
share:
  enabled: true
```
### Disabilitare la condivisione della sessione

Se desideri disattivare la condivisione della sessione per motivi di sicurezza o privacy:
```json
{
  "share": {
    "enabled": false
  }
}
```
Se disabilitato, l'esecuzione di `/share` visualizzerà:
```
Session sharing is disabled.
To enable, set share.enabled: true in your config file.
```
---

## Sincronizzazione delle impostazioni

Autohand può sincronizzare la tua configurazione su tutti i dispositivi per gli utenti che hanno effettuato l'accesso. Le impostazioni vengono archiviate in modo sicuro in Cloudflare R2 e crittografate prima del caricamento.
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
| Campo | Digitare | Predefinito | Descrizione |
| ------------------ | -------- | --------------- | -------------------------------------------------- |
| `enabled` | booleano | `true` (registrato) | Abilita/disabilita la sincronizzazione delle impostazioni |
| `interval` | numero | `300000` | Intervallo di sincronizzazione in millisecondi (impostazione predefinita: 5 minuti) |
| `exclude` | stringa[] | `[]` | Modelli globali da escludere dalla sincronizzazione |
| `includeTelemetry` | booleano | `false` | Sincronizza i dati di telemetria (richiede il consenso dell'utente) |
| `includeFeedback` | booleano | `false` | Sincronizza i dati di feedback (richiede il consenso dell'utente) |

### Contrassegno CLI
```bash
# Disable sync for this session
autohand --sync-settings=false

# Enable sync (default for logged users)
autohand --sync-settings
```
### Cosa viene sincronizzato

Per impostazione predefinita, questi elementi vengono sincronizzati per gli utenti che hanno effettuato l'accesso:

- **Configurazione** (`config.json`) - Le chiavi API vengono crittografate prima del caricamento
- **Agenti personalizzati** (`agents/`)
- **Competenze della community** (`community-skills/`)
- **Hook utente** (`hooks/`)
- **Memoria** (`memory/`)
- **Conoscenza del progetto** (`projects/`)
- **Cronologia sessioni** (`sessions/`)
- **Contenuti condivisi** (`share/`)
- **Abilità personalizzate** (`skills/`)

### Cosa non si sincronizza (per impostazione predefinita)

- **ID dispositivo** (`device-id`) - Univoco per dispositivo
- **Log errori** (`error.log`) - Solo locale
- **Cache della versione** (`version-*.json`) - File della cache locale

### Sincronizzazione basata sul consenso

Questi elementi richiedono l'attivazione esplicita nella configurazione:

- **Dati di telemetria** - Imposta `sync.includeTelemetry: true` per la sincronizzazione
- **Dati feedback** - Imposta `sync.includeFeedback: true` per la sincronizzazione
```json
{
  "sync": {
    "enabled": true,
    "includeTelemetry": true,
    "includeFeedback": true
  }
}
```
### Risoluzione dei conflitti

Quando si verificano conflitti (stesso file modificato su più dispositivi), prevale la **versione cloud**. Ciò garantisce coerenza durante l'accesso su nuovi dispositivi.

### Sicurezza

Le chiavi API e altri dati sensibili in `config.json` vengono crittografati utilizzando il token di autenticazione prima del caricamento. Possono essere decrittografati solo con le tue credenziali.

I nomi dei file remoti sono accettati solo come percorsi POSIX relativi all’interno delle categorie di sincronizzazione abilitate. La sincronizzazione rifiuta l’attraversamento di directory, i percorsi assoluti o in stile Windows, i segmenti duplicati o vuoti e le destinazioni reindirizzate fuori da una radice abilitata tramite collegamenti simbolici.

Il token di accesso dell’applicazione viene inviato nell’intestazione `Authorization` solo agli URL di trasferimento con la stessa origine dell’API di sincronizzazione configurata. Gli URL HTTPS prefirmati tra origini diverse non ricevono mai il token; gli URL tra origini diverse non sicuri o non validi vengono rifiutati.

**Cosa è crittografato:**

- Campi denominati `apiKey`
- Campi che terminano con `Key`, `Token`, `Secret`
- Il campo `password`

### Come funziona

1. **All'avvio**: se hai effettuato l'accesso, il servizio di sincronizzazione si avvia automaticamente
2. **Ogni 5 minuti**: le impostazioni vengono confrontate con l'archiviazione nel cloud
3. **Il cloud vince**: le modifiche remote vengono scaricate per prime
4. **Caricamenti locali**: vengono caricate nuove modifiche locali
5. **All'uscita**: il servizio di sincronizzazione si interrompe normalmente

### File esclusi

Puoi escludere file o pattern specifici dalla sincronizzazione:
```json
{
  "sync": {
    "enabled": true,
    "exclude": ["custom-local-config.json", "temp/*"]
  }
}
```
### Formato YAML
```yaml
sync:
  enabled: true
  interval: 300000
  exclude: []
  includeTelemetry: false
  includeFeedback: false
```
---

## Impostazioni MCP

Configura i server MCP (Model Context Protocol) per estendere Autohand con strumenti esterni.
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

- **Digitare**: `boolean`
- **Predefinito**: `true`
- **Descrizione**: abilita o disabilita tutto il supporto MCP. Quando `false`, nessun server è connesso all'avvio e gli strumenti MCP non sono disponibili.

### `mcp.servers`

- **Digitare**: `McpServerConfigEntry[]`
- **Predefinito**: `[]`
- **Descrizione**: Array di configurazioni del server MCP.

### Campi di immissione del server

| Campo | Digitare | Obbligatorio | Predefinito | Descrizione |
| ------------- | -------------------------------- | -------------- | ------- | ------------------------------------------------------------- |
| `name` | `string` | Sì | - | Identificatore univoco del server |
| `transport` | `"stdio"` \| `"sse"` \| `"http"` | Sì | - | Tipo di trasporto |
| `command` | `string` | Sì (stdio) | - | Comando per avviare il processo del server |
| `args` | `string[]` | No | `[]` | Argomenti per il comando |
| `url` | `string` | Sì (sse/http) | - | URL dell'endpoint del server |
| `headers` | `Record<string, string>` | No | `{}` | Intestazioni HTTP personalizzate per il trasporto http/sse (ad esempio token di autenticazione) |
| `env` | `Record<string, string>` | No | `{}` | Variabili d'ambiente passate al server |
| `autoConnect` | `boolean` | No | `true` | Se connettersi automaticamente all'avvio |

> I server si connettono in modo asincrono in background durante l'avvio senza bloccare il prompt. Utilizza `/mcp` per gestire i server in modo interattivo o `/mcp add` per sfogliare il registro della comunità o aggiungere server personalizzati.

> Per la documentazione completa di MCP, vedere [docs/mcp.md](mcp.md).

---

## Impostazioni dei ganci

Configurazione per hook del ciclo di vita che eseguono comandi shell sugli eventi dell'agente. Consulta la [Documentazione sugli hook](./hooks.md) per i dettagli completi.
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

| Campo | Digitare | Predefinito | Descrizione |
| --------- | ------- | ------- | --------------------------------- |
| `enabled` | booleano | `true` | Abilita/disabilita tutti gli hook a livello globale |
| `hooks` | matrice | `[]` | Matrice di definizioni di hook |

### Definizione del gancio

| Campo | Digitare | Obbligatorio | Predefinito | Descrizione |
| ------------- | ------- | -------- | ------- | -------------------------------- |
| `event` | stringa | Sì | - | Evento a cui collegarsi |
| `command` | stringa | Sì | - | Comando della shell da eseguire |
| `description` | stringa | No | - | Descrizione per `/hooks` display |
| `enabled` | booleano | No | `true` | Se il gancio è attivo |
| `timeout` | numero | No | `5000` | Timeout in millisecondi |
| `async` | booleano | No | `false` | Esegui senza bloccare |
| `filter` | oggetto | No | - | Filtra per strumento o percorso |

### Aggancio eventi

| Evento | Quando licenziato |
| --------------- | ------------------------------------- |
| `pre-tool` | Prima che qualsiasi strumento esegua |
| `post-tool` | Una volta completato lo strumento |
| `file-modified` | Quando il file viene creato/modificato/eliminato |
| `pre-prompt` | Prima di inviare a LLM |
| `post-response` | Dopo che LLM risponde |
| `session-error` | Quando si verifica l'errore |

### Variabili d'ambiente

Quando gli hook vengono eseguiti, sono disponibili queste variabili di ambiente:

| Variabile | Descrizione |
| ---------------- | --------------------- |
| `HOOK_EVENT` | Nome dell'evento |
| `HOOK_WORKSPACE` | Percorso radice dell'area di lavoro |
| `HOOK_TOOL` | Nome dello strumento (eventi dello strumento) |
| `HOOK_ARGS` | Argomenti dello strumento con codifica JSON |
| `HOOK_SUCCESS` | vero/falso (post-tool) |
| `HOOK_PATH` | Percorso file (modificato dal file) |
| `HOOK_TOKENS` | Token utilizzati (post-risposta) |

---

## Impostazioni dell'estensione di Chrome

Controlla l'integrazione dell'estensione Autohand Chrome. Consulta la guida completa all'indirizzo [Autohand in Chrome](./autohand-in-chrome.md).
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
| Chiave | Digitare | Predefinito | Descrizione |
| ------------------ | --------- | -------- | ------------------------------------------------------------------------- |
| `extensionId` | `string` | — | ID estensione Chrome installato per il trasferimento diretto |
| `enabledByDefault` | `boolean` | `false` | Avvia automaticamente il bridge del browser con la CLI |
| `browser` | `string` | `"auto"` | Browser Chromium preferito: `auto`, `chrome`, `chromium`, `brave`, `edge` |
| `userDataDir` | `string` | — | Directory dei dati utente del browser per indirizzare il profilo corretto |
| `profileDirectory` | `string` | — | Nome della directory del profilo del browser (ad esempio, `"Default"`, `"Profile 1"`) |
| `installUrl` | `string` | — | URL di fallback quando l'ID estensione non è configurato |

### Flag CLI
```bash
autohand --chrome          # Start with browser bridge enabled
autohand --no-chrome       # Start with browser bridge disabled
```
### Comandi barra
```
/chrome                    # Open Chrome integration panel
/chrome disconnect         # Close the browser bridge connection
```
---

## Esempio completo

### Formato JSON (`~/.autohand/config.json`)
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
### Formato YAML (`~/.autohand/config.yaml`)
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
### Formato TOML (`~/.autohand/config.toml`)
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

## Struttura delle directory

Autohand memorizza i dati in `~/.autohand/` (o `$AUTOHAND_HOME`):
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
**Directory a livello di progetto** (nella root dell'area di lavoro):
```
<project>/.autohand/
├── settings.local.json  # Local project permissions (gitignore this)
├── memory/              # Project-specific memory
├── skills/              # Project-specific skills
└── tools/               # Project-specific meta-tools
```
---

## Flag CLI (sostituisci configurazione)

Questi flag sovrascrivono le impostazioni del file di configurazione:

### Flag principali

| Bandiera | Descrizione |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| `-v, --version` | Emetti la versione corrente |
| `-p, --prompt [text]` | Esegue una singola istruzione in modalità comando |
| `--path <path>` | Sostituisci la radice dell'area di lavoro |
| `--config <path>` | Utilizza il file di configurazione personalizzato |
| `--model <model>` | Sostituisci modello |
| `--temperature <n>` | Imposta la temperatura di campionamento (0-1) |
| `--thinking [level]` | Imposta la profondità di pensiero/ragionamento (nessuna, normale, estesa) |
| `-y, --yes` | Richieste di conferma automatica |
| `--dry-run` | Anteprima senza eseguire |
| `-d, --debug` | Abilita output di debug dettagliato |
| `--bare` | Modalità esplicita minima; imposta anche `AUTOHAND_CODE_SIMPLE=1` e disabilita i comandi slash |

### Autorizzazioni e sicurezza

| Bandiera | Descrizione |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| `--unrestricted` | Nessuna richiesta di approvazione |
| `--restricted` | Negare operazioni pericolose |
| `--permissions` | Visualizza le impostazioni di autorizzazione correnti ed esci |
| `--no-idle-logout` | Disattiva la disconnessione per inattività autenticata per le sessioni dell'agente di lunga durata |
| `--yolo [pattern]` | Lo strumento di approvazione automatica chiama il modello corrispondente (ad esempio, `allow:read,write` o `deny:delete`) |
| `--timeout <seconds>` | Timeout in secondi per la modalità di approvazione automatica |

### Git e Worktree

| Bandiera | Descrizione |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| `--worktree [name]` | Esegui la sessione in un albero di lavoro git isolato (nome albero di lavoro/ramo opzionale) |
| `--tmux` | Avvia in una sessione tmux dedicata (implica `--worktree`; non può essere utilizzato con `--no-worktree`) |
| `--no-worktree` | Disabilita l'isolamento di git worktree in modalità automatica |
| `-c, --auto-commit` | Effettua il commit automatico delle modifiche dopo aver completato le attività |
| `--patch` | Genera patch git senza applicare modifiche |
| `--output <file>` | File di output per la patch (usato con --patch) |

### Modalità automatica
| Bandiera | Descrizione |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| `--auto-mode [prompt]` | Abilita la modalità automatica interattiva o avvia un ciclo autonomo con un'attività in linea |
| `--max-iterations <n>` | Iterazioni massime in modalità automatica (impostazione predefinita: 50) |
| `--completion-promise <text>` | Testo dell'indicatore di completamento (predefinito: "FATTO") |
| `--checkpoint-interval <n>` | Git esegue il commit ogni N iterazioni (impostazione predefinita: 5) |
| `--max-runtime <m>` | Durata massima in minuti (impostazione predefinita: 120) |
| `--max-cost <d>` | Costo API massimo in dollari (impostazione predefinita: 10) |
| `--interactive-on-complete` | Al termine della modalità automatica, passare direttamente alla modalità interattiva (solo TTY) |

### Competenze e apprendimento

| Bandiera | Descrizione |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| `--auto-skill` | Genera automaticamente competenze in base all'analisi del progetto (vedi anche `/learn` per il consulente interattivo) |
| `--learn` | Esegui il consulente delle competenze `/learn` in modo non interattivo (analizza e installa le competenze consigliate) |
| `--learn-update` | Rianalizzare il progetto e rigenerare le competenze obsolete generate dal LLM in modo non interattivo |
| `--skill-install [name]` | Installa una competenza della community (apre il browser se non viene fornito alcun nome) |
| `--project` | Installa la competenza a livello di progetto (con --skill-install) |

### Autenticazione e account

| Bandiera | Descrizione |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| `--login` | Accedi al tuo account Autohand |
| `--logout` | Esci dal tuo account Autohand |
| `--sync-settings` | Abilita/disabilita la sincronizzazione delle impostazioni (impostazione predefinita: true per gli utenti registrati) |

### Configurazione e informazioni

| Bandiera | Descrizione |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| `--setup` | Eseguire la procedura guidata di installazione per configurare o riconfigurare Autohand |
| `--about` | Mostra informazioni su Autohand (versione, link, informazioni sul contributo) |
| `--feedback` | Invia feedback al team Autohand |
| `--settings` | Configura le impostazioni Autohand (come `/settings` in modalità interattiva) |

### Area di lavoro e directory

| Bandiera | Descrizione |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| `--add-dir <path...>` | Aggiungi directory aggiuntive all'ambito dello spazio di lavoro (può essere utilizzato più volte) |

### Modalità di esecuzione

| Bandiera | Descrizione |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| `--mode <mode>` | Modalità di esecuzione: interattiva (predefinita), rpc o acp |
| `--acp` | Abbreviazione di --mode acp (Agent Client Protocol over stdio) |
| `--teammate-mode <mode>` | Modalità di visualizzazione del team: automatica, in-process o tmux |

### Interfaccia utente e lingua

| Bandiera | Descrizione |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| `--display-language <locale>` | Imposta la lingua di visualizzazione (ad es. en, id, zh-cn, fr, de, ja) |
| `--search-engine <provider>` | Imposta il provider di ricerca web (google, brave, duckduckgo, parallel) |
| `--cc, --context-compact` | Abilita la compattazione del contesto (impostazione predefinita: attivata) |
| `--no-cc, --no-context-compact` | Disabilita compattazione del contesto |

### Integrazione con Chrome

| Bandiera | Descrizione |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| `--chrome` | Abilita l'integrazione del browser Chrome (come `/chrome`) |
| `--no-chrome` | Disattiva l'integrazione del browser Chrome |

### Richiesta di sistema

| Bandiera | Descrizione |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| `--sys-prompt <value>` | Sostituisci l'intero prompt del sistema (stringa in linea o percorso file) |
| `--append-sys-prompt <value>` | Aggiungi al prompt di sistema (stringa in linea o percorso file) |
| `--system-prompt <value>` | Sostituisci l'intero prompt del sistema (stringa in linea o percorso file) |
| `--system-prompt-file <path>` | Sostituisci l'intero prompt del sistema con il contenuto del file |
| `--append-system-prompt <value>` | Aggiungi al prompt di sistema (stringa in linea o percorso file) |
| `--append-system-prompt-file <path>` | Aggiungi il contenuto del file al prompt del sistema |
| `--mcp-config <path>` | Carica un file di configurazione MCP esplicito |
| `--agents <json\|path>` | Carica JSON di agenti in linea espliciti o una directory di agenti espliciti |
| `--plugin-dir <path>` | Carica una directory plugin/meta-tool esplicita |

### Comandi di cambio esperimento

| Comando | Descrizione |
| ------------------------------------- | ------------------------------------------------ |
| `autohand experiments list` | Elenca gli ID delle funzionalità locali e remote, l'origine, la fase del ciclo di vita e lo stato |
| `autohand experiments status <feature>` | Mostra un cambio di funzionalità, un percorso di configurazione o metadati remoti e lo stato |
| `autohand experiments refresh` | Scarica i flag delle funzionalità remote dall'API Autohand |
| `autohand experiments enable <feature>` | Abilita un'opzione di funzionalità supportata dalla configurazione |
| `autohand experiments disable <feature>` | Disabilitare un'opzione di funzionalità supportata dalla configurazione |

I flag delle funzionalità remote vengono recuperati da `/v1/feature-flags/evaluate`, memorizzati nella cache in `~/.autohand/feature-flags.json` e aggiornati dopo la scadenza del TTL fornito dall'API. Utilizzare `features.environment` per selezionare un ambiente di flag remoti e `features.remoteOverrides` per la disattivazione locale dei flag remoti sovrascrivibili dall'utente.

`usage_v2` è un'opzione di funzionalità sperimentale per il dashboard `/usage` e la scheda Utilizzo `/status` migliorata. Abilitalo con `autohand experiments enable usage_v2`.

`token_usage_status` è un'opzione di funzionalità sperimentale (percorso di configurazione `features.tokenUsageStatus`, disattivato per impostazione predefinita) che mostra l'utilizzo dei token in tempo reale nella riga di stato di lavoro: token cumulativi su (`↑`) e giù (`↓`) più occupazione della finestra di contesto, ad es. `↑15.7k ↓3.2k · context: 6.0% (15.7k/262.1k)`. La finestra di contesto viene risolta per modello in tutti i provider. Abilitalo con `autohand experiments enable token_usage_status`.

---

## Comandi barra

Autohand fornisce un ricco set di comandi slash per l'uso interattivo. Digita `/` nel REPL per visualizzare i suggerimenti.

### Gestione delle sessioni

| Comando | Descrizione |
| ------------- | ----------------------------------------------------- |
| `/quit` | Esci dalla sessione corrente |
| `/exit` | Esci dalla sessione corrente |
| `/new` | Inizia una nuova conversazione (con estrazione della memoria) |
| `/clear` | Conversazione chiara con estrazione automatica della memoria |
| `/session` | Mostra i dettagli della sessione corrente |
| `/sessions` | Elenca le sessioni passate |
| `/resume` | Riprendere una sessione precedente |
| `/history` | Sfoglia la cronologia delle sessioni con l'impaginazione |
| `/undo` | Ripristina le modifiche git e l'ultimo turno |
| `/export` | Esporta la sessione in markdown/JSON/HTML |
| `/share` | Condividi la sessione corrente |
| `/status` | Mostra lo stato della sessione |
| `/usage` | Mostra modello, fornitore, contesto e limiti di utilizzo |

### Modello e fornitore

| Comando | Descrizione |
| ------------- | ----------------------------------------------------- |
| `/model` | Cambia o configura il modello LLM |
| `/cc` | Contesto compatto manualmente |

### Impostazione del progetto

| Comando | Descrizione |
| ------------- | ----------------------------------------------------- |
| `/init` | Crea il file `AGENTS.md` nella directory corrente |
| `/setup` | Eseguire la procedura guidata di installazione per configurare Autohand |
| `/add-dir` | Aggiungi directory all'ambito dell'area di lavoro |

### Agenti e team

| Comando | Descrizione |
| ------------- | ----------------------------------------------------- |
| `/agents` | Elenco subagenti disponibili |
| `/agents-new` | Crea un nuovo agente tramite la procedura guidata |
| `/squad` | Apri/gestisci il runtime autonomo Autohand Squad |
| `/team` | Gestire il team per il lavoro parallelo |
| `/tasks` | Gestire le attività nel team |
| `/message` | Invia messaggio al compagno di squadra |

### Competenze

| Comando | Descrizione |
| ---------------- | -------------------------------------------------- |
| `/skills` | Elenca e gestisci le competenze |
| `/skills-new` | Crea nuova abilità |
| `/learn` | Impara e installa le competenze consigliate |

### Memoria e impostazioni

| Comando | Descrizione |
| ------------- | ----------------------------------------------------- |
| `/memory` | Visualizza e gestisci le memorie archiviate |
| `/settings` | Configura le impostazioni Autohand |
| `/statusline` | Configura i campi della riga di stato del compositore |
| `/experiments` | Attiva/disattiva gli interruttori delle funzionalità sperimentali |
| `/sync` | Sincronizza le impostazioni su tutti i dispositivi |
| `/import` | Importa sessioni, impostazioni, MCP, memoria, competenze e hook dagli agenti supportati |

### Autorizzazioni e hook

| Comando | Descrizione |
| ------------- | ----------------------------------------------------- |
| `/permissions`| Gestisci le autorizzazioni dello strumento |
| `/hooks` | Gestire gli hook del ciclo di vita |

### Autenticazione

| Comando | Descrizione |
| ------------- | ----------------------------------------------------- |
| `/login` | Autenticazione con Autohand API |
| `/logout` | Esci dall'account Autohand |

### Strumenti e utilità

| Comando | Descrizione |
| ------------- | ----------------------------------------------------- |
| `/search` | Cerca nel web |
| `/formatters` | Elenca i formattatori di codice disponibili |
| `/lint` | Elenca i linter di codice disponibili |
| `/completion` | Genera script di completamento della shell |
| `/plan` | Creare un piano di implementazione |
| `/review` | Eseguire la revisione del codice |
| `/pr-review` | Esaminare una richiesta pull |

### Integrazione con l'IDE

| Comando | Descrizione |
| ------------- | ----------------------------------------------------- |
| `/ide` | Rileva e connettiti agli IDE in esecuzione |

### MCP (Protocollo del contesto del modello)

| Comando | Descrizione |
| ------------- | ----------------------------------------------------- |
| `/mcp` | Gestore server MCP interattivo |

### Automazione

| Comando | Descrizione |
| ------------- | ----------------------------------------------------- |
| `/automode` | Avvia la modalità di codifica autonoma |
| `/repeat` | Pianifica lavori ricorrenti |
| `/yolo` | Attiva/disattiva la modalità yolo (strumenti di approvazione automatica) |

### Integrazione con Chrome

| Comando | Descrizione |
| ------------- | ----------------------------------------------------- |
| `/chrome` | Abilita l'integrazione del browser Chrome |

### Interfaccia utente e display

| Comando | Descrizione |
| ------------- | ----------------------------------------------------- |
| `/help` | Visualizza i comandi e i suggerimenti disponibili per la barra |
| `/about` | Mostra informazioni su Autohand |
| `/theme` | Cambia tema colore |
| `/language` | Cambia lingua di visualizzazione |
| `/feedback` | Invia feedback al team Autohand |

---

## Personalizzazione dei prompt del sistema
Autohand consente di personalizzare il prompt di sistema utilizzato dall'agente AI. Ciò è utile per flussi di lavoro specializzati, istruzioni personalizzate o integrazione con altri sistemi.

### Flag CLI

| Bandiera | Descrizione |
| ----------------------- | -------------------------------------------------- |
| `--sys-prompt <value>` | Sostituisci l'intero prompt del sistema |
| `--append-sys-prompt <value>` | Aggiungi contenuto al prompt di sistema predefinito |

Entrambi i flag accettano:

- **Stringa in linea**: contenuto testuale diretto
- **Percorso file**: percorso di un file contenente il prompt (rilevato automaticamente)

### Rilevamento del percorso del file

Un valore viene considerato come un percorso file se:

- Inizia con `./`, `../`, `/` o `~/`
- Inizia con la lettera dell'unità Windows (ad esempio, `C:\`)
- Termina con `.txt`, `.md` o `.prompt`
- Contiene separatori di percorso senza spazi

Altrimenti, viene trattata come una stringa in linea.

### `--sys-prompt` (Sostituzione completa)

Quando fornito, questo **sostituisce completamente** il prompt di sistema predefinito. L'agente NON caricherà:

- Istruzioni Autohand predefinite
- Istruzioni per il progetto AGENTS.md
- Memorie utente/progetto
- Competenze attive
```bash
# Inline string
autohand --sys-prompt "You are a Python expert. Be concise." --prompt "Write hello world"

# From file
autohand --sys-prompt ./custom-prompt.txt --prompt "Explain this code"

# Home directory
autohand --sys-prompt ~/.autohand/prompts/python-expert.md --prompt "Debug this function"
```
**Esempio di file di prompt personalizzato (`custom-prompt.txt`):**
```
You are a specialized Python debugging assistant.

Rules:
- Focus only on Python code
- Always explain the root cause
- Suggest fixes with code examples
- Be concise and direct
```
### `--append-sys-prompt` (Aggiungi a predefinito)

Quando fornito, **aggiunge** il contenuto al prompt di sistema predefinito completo. L'agente caricherà comunque:

- Istruzioni Autohand predefinite
- Istruzioni per il progetto AGENTS.md
- Memorie utente/progetto
- Competenze attive

Il contenuto aggiunto viene aggiunto alla fine.
```bash
# Inline string
autohand --append-sys-prompt "Always use TypeScript instead of JavaScript" --prompt "Create a function"

# From file
autohand --append-sys-prompt ./team-guidelines.md --prompt "Add error handling"
```
**File di aggiunta di esempio (`team-guidelines.md`):**
```
## Team Guidelines

- Use 2-space indentation
- Prefer functional patterns
- Add JSDoc comments to public APIs
- Run tests before committing
```
### Precedenza

Quando vengono forniti entrambi i flag:

1. `--sys-prompt` ha la piena precedenza
2. `--append-sys-prompt` viene ignorato
```bash
# --append-sys-prompt is ignored in this case
autohand --sys-prompt "Custom only" --append-sys-prompt "This is ignored"
```
### Casi d'uso

| Caso d'uso | Bandiera consigliata |
| --------------------------------- | --------------------- |
| Persona dell'agente personalizzato | `--sys-prompt` |
| Istruzioni minime | `--sys-prompt` |
| Aggiungi linee guida per il team | `--append-sys-prompt` |
| Aggiungi convenzioni di progetto | `--append-sys-prompt` |
| Integrazione con sistemi esterni | `--sys-prompt` |
| Debug specializzato | `--sys-prompt` |

### Gestione degli errori

| Scenario | Comportamento |
| ----------------- | ------------------------ |
| Valore vuoto | Errore |
| File non trovato | Trattata come stringa in linea |
| File vuoto | Errore |
| File > 1MB | Errore |
| Autorizzazione negata | Errore |
| Percorso della directory | Errore |

### Esempi
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

## Supporto multidirectory

Autohand può funzionare con più directory oltre l'area di lavoro principale. Ciò è utile quando il tuo progetto ha dipendenze, librerie condivise o progetti correlati in directory diverse.

### Contrassegno CLI

Utilizza `--add-dir` per aggiungere ulteriori directory (può essere utilizzato più volte):
```bash
# Add a single additional directory
autohand --add-dir /path/to/shared-lib

# Add multiple directories
autohand --add-dir /path/to/lib1 --add-dir /path/to/lib2

# With unrestricted mode (auto-approve writes to all directories)
autohand --add-dir /path/to/shared-lib --unrestricted
```
### Comando interattivo

Utilizza `/add-dir` durante una sessione interattiva:
```
/add-dir              # Show current directories
/add-dir /path/to/dir # Add a new directory
```
### Limitazioni di sicurezza

Non è possibile aggiungere le seguenti directory:

- Directory home (`~` o `$HOME`)
- Directory principale (`/`)
- Directory di sistema (`/etc`, `/var`, `/usr`, `/bin`, `/sbin`)
- Directory di sistema di Windows (`C:\Windows`, `C:\Program Files`)
- Directory utente di Windows (`C:\Users\username`)
- Supporti Windows WSL (`/mnt/c`, `/mnt/c/Windows`)
