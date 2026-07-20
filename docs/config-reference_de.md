# Autohand-Konfigurationsreferenz

Vollständige Referenz für alle Konfigurationsoptionen in `~/.autohand/config.json` (oder `.toml`/`.yaml`/`.yml`).

> **Tipp:** Die meisten unten aufgeführten Einstellungen können interaktiv über den Befehl `/settings` geändert werden, anstatt die Datei manuell zu bearbeiten.

Lokalisierte Referenzen:

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

## Inhaltsverzeichnis

- [Speicherort der Konfigurationsdatei](#speicherort-der-konfigurationsdatei)
- [Umgebungsvariablen](#umgebungsvariablen)
- [Bare-Modus](#bare-modus)
- [Anbieter-Einstellungen](#anbieter-einstellungen)
- [Arbeitsbereichs-Einstellungen](#arbeitsbereichs-einstellungen)
- [UI-Einstellungen](#ui-einstellungen)
- [Agenten-Einstellungen](#agenten-einstellungen)
- [Berechtigungseinstellungen](#berechtigungseinstellungen)
- [Patch-Modus](#patch-modus)
- [Netzwerkeinstellungen](#netzwerkeinstellungen)
- [Telemetrie-Einstellungen](#telemetrie-einstellungen)
- [Externe Agenten](#externe-agenten)
- [Skills-System](#skills-system)
- [API-Einstellungen](#api-einstellungen)
- [Authentifizierungseinstellungen](#authentifizierungseinstellungen)
- [Community-Skills-Einstellungen](#community-skills-einstellungen)
- [Teilen-Einstellungen](#teilen-einstellungen)
- [Einstellungen-Synchronisierung](#einstellungen-synchronisierung)
- [Hooks-Einstellungen](#hooks-einstellungen)
- [MCP-Einstellungen](#mcp-einstellungen)
- [Chrome-Erweiterungs-Einstellungen](#chrome-erweiterungs-einstellungen)
- [Vollständiges Beispiel](#vollständiges-beispiel)

---

## Speicherort der Konfigurationsdatei

Autohand sucht die Konfiguration in dieser Reihenfolge:

1. Umgebungsvariable `AUTOHAND_CONFIG` (benutzerdefinierter Pfad)
2. `~/.autohand/config.toml`
3. `~/.autohand/config.yaml`
4. `~/.autohand/config.yml`
5. `~/.autohand/config.json` (Standard)

Sie können auch das Basisverzeichnis überschreiben:

```bash
export AUTOHAND_HOME=/custom/path  # Ändert ~/.autohand zu /custom/path
```

---

## Umgebungsvariablen

| Variable                               | Beschreibung                                      | Beispiel                          |
| -------------------------------------- | ------------------------------------------------- | -------------------------------- |
| `AUTOHAND_HOME`                        | Basisverzeichnis für alle Autohand-Daten             | `/custom/path`                   |
| `AUTOHAND_CONFIG`                      | Benutzerdefinierter Konfigurationsdateipfad                          | `/path/to/config.toml`           |
| `AUTOHAND_API_URL`                     | API-Endpunkt (überschreibt Konfiguration)                  | `https://api.autohand.ai`        |
| `AUTOHAND_SECRET`                      | Firmen-/Team-Geheimschlüssel                          | `sk-xxx`                         |
| `AUTOHAND_PERMISSION_CALLBACK_URL`     | URL für Berechtigungsrückruf (experimentell)       | `http://localhost:3000/callback` |
| `AUTOHAND_PERMISSION_CALLBACK_TIMEOUT` | Zeitlimit für Berechtigungsrückruf in ms            | `5000`                           |
| `AUTOHAND_NON_INTERACTIVE`             | Im nicht-interaktiven Modus ausführen                      | `1`                              |
| `AUTOHAND_YES`                         | Alle Eingabeaufforderungen automatisch bestätigen                         | `1`                              |
| `AUTOHAND_NO_BANNER`                   | Startbanner deaktivieren                           | `1`                              |
| `AUTOHAND_STREAM_TOOL_OUTPUT`          | Tool-Ausgabe in Echtzeit streamen                  | `1`                              |
| `AUTOHAND_DEBUG`                       | Debug-Protokollierung aktivieren                             | `1`                              |
| `AUTOHAND_THINKING_LEVEL`              | Reasoning-Tiefenstufe festlegen                        | `normal`                         |
| `AUTOHAND_CLIENT_NAME`                 | Client-/Editor-Kennung (gesetzt von ACP-Erweiterungen) | `zed`                            |
| `AUTOHAND_CLIENT_VERSION`              | Client-Version (gesetzt von ACP-Erweiterungen)           | `0.169.0`                        |
| `AUTOHAND_CODE`                        | Umgebungserkennungsflag (automatisch gesetzt)   | `1`                              |
| `AUTOHAND_CODE_SIMPLE`                 | Bare-Modus aktivieren, ohne `--bare` zu übergeben        | `1`                              |

### Thinking Level

Die Umgebungsvariable `AUTOHAND_THINKING_LEVEL` steuert die Reasoning-Tiefe, die das Modell verwendet:

| Wert      | Beschreibung                                                           |
| ---------- | --------------------------------------------------------------------- |
| `none`     | Direkte Antworten ohne sichtbares Reasoning                            |
| `normal`   | Standard-Reasoning-Tiefe (Standard)                                    |
| `extended` | Tiefes Reasoning für komplexe Aufgaben, zeigt detaillierteren Gedankenprozess |

Dies wird typischerweise durch ACP-Client-Erweiterungen (wie Zed) über das Konfigurations-Dropdown gesetzt.

```bash
# Beispiel: Erweitertes Thinking für komplexe Aufgaben verwenden
AUTOHAND_THINKING_LEVEL=extended autohand --prompt "refactor this module"
```

---

## Bare-Modus

Der Bare-Modus startet Autohand nur mit explizit angefordertem Kontext und Runtime-Integrationen. Aktivieren Sie ihn mit einer der folgenden Optionen:

```bash
autohand --bare
AUTOHAND_CODE_SIMPLE=1 autohand
```

Wenn `--bare` übergeben wird, setzt Autohand außerdem `AUTOHAND_CODE_SIMPLE=1` für den laufenden Prozess.

Der Bare-Modus deaktiviert automatischen Start und interaktive Integrationen:

- Hooks und Hook-Benachrichtigungen
- LSP-Start
- Plugin-Synchronisierung, Plugin-Autoloading und Meta-Tool-Autoloading
- Attribution, Telemetrie, Sitzungssynchronisierung, automatische Berichterstattung und Hintergrund-Pings
- Automatischer Speicher-/Sitzungs-Bootstrap-Kontext
- Hintergrund-Prompt-Vorschläge, Update-Prüfungen, Feature-Flag-Abrufe und Model-Metadata-Prefetches
- Schlüsselbund- und Browser-OAuth-Authentifizierungs-Fallback
- Automatische `AGENTS.md`- und Provider-Instruction-Erkennung
- Alle Slash-Befehle, einschließlich eines bloßen `/` in der Eingabeaufforderung

Slash-förmige absolute Dateipfade wie `/Users/alex/project/file.ts` werden weiterhin als normaler Prompt-Text behandelt. Befehlsförmige Slash-Eingaben wie `/help`, `/model` oder `/mcp` geben `Slash commands are disabled in bare mode.` aus und werden nicht ausgeführt.

Die Authentifizierung im Bare-Modus erfolgt nur explizit. Autohand liest zuerst `AUTOHAND_API_KEY`, dann `auth.apiKeyHelper`, falls konfiguriert. Es werden keine Schlüsselbund-Anmeldeinformationen gelesen und kein OAuth-/Browser-Login gestartet. Drittanbieter-Provider verwenden weiterhin ihre providerspezifischen API-Schlüssel und Konfiguration.

Diese expliziten Eingaben bleiben im Bare-Modus verfügbar:

| Eingabe                         | Beschreibung                                                               |
| ----------------------------- | ------------------------------------------------------------------------- |
| `--system-prompt <value>`     | System-Prompt durch Inline-Text oder einen pfadähnlichen Wert ersetzen           |
| `--system-prompt-file <path>` | System-Prompt durch Dateiinhalte ersetzen                              |
| `--append-system-prompt <value>` | Inline-Text oder einen pfadähnlichen Wert an den System-Prompt anhängen           |
| `--append-system-prompt-file <path>` | Dateiinhalte an den System-Prompt anhängen                         |
| `--add-dir <path...>`         | Explizite Verzeichnisse zum Arbeitsbereich hinzufügen                               |
| `--mcp-config <path>`         | Eine explizite MCP-Konfigurationsdatei laden                                          |
| `--settings`                  | Einstellungen direkt über das CLI-Flag öffnen                                  |
| `--config <path>`             | Eine explizite Autohand-Konfigurationsdatei verwenden                                      |
| `--agents <json\|path>`       | Explizite Inline-Agenten-JSON oder ein explizites Agentenverzeichnis laden          |
| `--plugin-dir <path>`         | Ein explizites Plugin-/Meta-Tool-Verzeichnis laden                               |

---

## Anbieter-Einstellungen

### `provider`

Aktiver LLM-Anbieter.

| Wert          | Beschreibung                  |
| -------------- | ---------------------------- |
| `"openrouter"` | OpenRouter API (Standard)     |
| `"ollama"`     | Lokale Ollama-Instanz        |
| `"llamacpp"`   | Lokaler llama.cpp-Server       |
| `"openai"`     | OpenAI API direkt          |
| `"mlx"`        | MLX auf Apple Silicon (lokal) |
| `"llmgateway"` | LLM Gateway unified API      |
| `"deepseek"`   | DeepSeek API                 |
| `"zai"`        | Z.ai GLM API                 |
| `"sakana"`     | Sakana.AI Fugu API           |
| `"bedrock"`    | AWS Bedrock                  |
| `"custom:<id>"` | Benutzerdefinierter OpenAI-kompatibler Provider aus `customProviders` |

### `openrouter`

OpenRouter-Anbieterkonfiguration.

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

| Feld           | Typ   | Erforderlich | Standard                        | Beschreibung                                                                 |
| --------------- | ------ | -------- | ------------------------------ | --------------------------------------------------------------------------- |
| `apiKey`        | string | Ja      | -                              | Ihr OpenRouter API-Schlüssel                                                     |
| `baseUrl`       | string | Nein       | `https://openrouter.ai/api/v1` | API-Endpunkt                                                                |
| `model`         | string | Ja      | -                              | Modellkennung (z. B. `your-modelcard-id-here`)                           |
| `contextWindow` | number | Nein       | Auto                           | Exaktes Modell-Kontextfenster. Autohand füllt dies aus OpenRouter, wenn bekannt. |

### `zai`

Z.ai-Anbieterkonfiguration.

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

| Feld           | Typ   | Erforderlich | Standard                        | Beschreibung                                                                      |
| --------------- | ------ | -------- | ------------------------------ | -------------------------------------------------------------------------------- |
| `apiKey`        | string | Ja      | -                              | Ihr Z.ai API-Schlüssel                                                                |
| `baseUrl`       | string | Nein       | `https://api.z.ai/api/paas/v4` | API-Endpunkt                                                                     |
| `model`         | string | Ja      | `glm-5.2`                     | Modellkennung, zum Beispiel `glm-5.2`, `glm-5.1`, oder `glm-4.5`                 |
| `contextWindow` | number | Nein       | Auto                           | Exaktes Modell-Kontextfenster. Autohand schließt 1M für GLM-5.2 und 200K für GLM-5.1. |

### `sakana`

Sakana.AI-Anbieterkonfiguration. Die API ist OpenAI-kompatibel und verwendet `https://api.sakana.ai/v1` als Basis-URL.

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

| Feld           | Typ   | Erforderlich | Standard                       | Beschreibung                                                       |
| --------------- | ------ | -------- | ----------------------------- | ----------------------------------------------------------------- |
| `apiKey`        | string | Ja      | -                             | Ihr Sakana API-Schlüssel                                               |
| `baseUrl`       | string | Nein       | `https://api.sakana.ai/v1`    | API-Endpunkt                                                      |
| `model`         | string | Ja      | `fugu`                        | Modellkennung, zum Beispiel `fugu` oder `fugu-ultra`              |
| `contextWindow` | number | Nein       | Auto                          | Exaktes Modell-Kontextfenster. Autohand schließt 1M für Fugu-Modelle.   |

### `customProviders`

Benutzerdefinierte Anbieter ermöglichen es, einen OpenAI-kompatiblen Endpunkt ohne Codeänderung oder neuen gebündelten Anbieter hinzuzufügen. Fügen Sie den Anbieter unter `customProviders` hinzu und wählen Sie ihn mit `provider: "custom:<id>"`. Derselbe Ablauf ist über `/model` mit **New provider...** verfügbar. Während der Einrichtung überprüft Autohand die Basis-URL, Authentifizierung und das ausgewählte Modell über den OpenAI-kompatiblen `/models`-Endpunkt, bevor der Anbieter gespeichert wird.

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

Für lokale OpenAI-kompatible Server, die keine Authentifizierung erfordern, setzen Sie `apiKeyRequired` auf `false` und lassen Sie `apiKey` weg.

| Feld             | Typ    | Erforderlich | Standard | Beschreibung |
| ----------------- | ------- | -------- | ------- | ----------- |
| `id`              | string  | Ja      | -       | Stabile Anbieter-ID. Sie muss dem Objektschlüssel entsprechen und wird als `custom:<id>` ausgewählt. |
| `displayName`     | string  | Ja      | -       | Name, der in `/model` und den Anbietereinstellungen angezeigt wird. |
| `apiFormat`       | string  | Ja      | -       | Muss `openai-compatible` sein. |
| `baseUrl`         | string  | Ja      | -       | Endpunkt-Wurzel wie `https://api.example.com/v1`. Autohand überprüft `/models` und ruft `/chat/completions` auf. |
| `apiKey`          | string  | Bedingt | -    | Bearer-Token für gehostete Endpunkte. Erforderlich, wenn `apiKeyRequired` true ist. |
| `apiKeyRequired`  | boolean | Nein       | `true`  | Auf false setzen für lokale oder bereits authentifizierte Gateways. |
| `model`           | string  | Ja      | -       | Aktive Modell-ID. |
| `contextWindow`   | number  | Nein       | Auto    | Exaktes Kontextfenster für Token-Budgetierung, Status, Telemetrie und Sync-Metadaten. |
| `reasoningEffort` | string  | Nein       | -       | Optional `none`, `low`, `medium`, `high`, oder `xhigh`. Wird als `reasoning_effort` für benutzerdefinierte OpenAI-kompatible Anfragen gesendet. |
| `models`          | array   | Nein       | -       | Optionale Modellauswahl-Einträge mit kontext- und reasoning-spezifischen Metadaten pro Modell. |

### `ollama`

Ollama-Anbieterkonfiguration.

```json
{
  "ollama": {
    "baseUrl": "http://localhost:11434",
    "port": 11434,
    "model": "llama3.2"
  }
}
```

| Feld     | Typ   | Erforderlich | Standard                  | Beschreibung                                |
| --------- | ------ | -------- | ------------------------ | ------------------------------------------ |
| `baseUrl` | string | Nein       | `http://localhost:11434` | Ollama-Server-URL                          |
| `port`    | number | Nein       | `11434`                  | Serverport (Alternative zu baseUrl)       |
| `model`   | string | Ja      | -                        | Modellname (z. B. `llama3.2`, `codellama`) |

### `llamacpp`

llama.cpp-Serverkonfiguration.

```json
{
  "llamacpp": {
    "baseUrl": "http://localhost:8080",
    "port": 8080,
    "model": "default"
  }
}
```

| Feld     | Typ   | Erforderlich | Standard                 | Beschreibung          |
| --------- | ------ | -------- | ----------------------- | -------------------- |
| `baseUrl` | string | Nein       | `http://localhost:8080` | llama.cpp-Server-URL |
| `port`    | number | Nein       | `8080`                  | Serverport          |
| `model`   | string | Ja      | -                       | Modellkennung     |

### `openai`

OpenAI-API-Konfiguration.

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

OpenAI kann auch Ihr ChatGPT-Abonnement über Autohands integrierten OpenAI-Anmeldeflow nutzen:

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

| Feld           | Typ   | Erforderlich               | Standard                     | Beschreibung                                                               |
| --------------- | ------ | ---------------------- | --------------------------- | ------------------------------------------------------------------------- |
| `authMode`      | string | Nein                     | `api-key`                   | Authentifizierungsmodus: `api-key` oder `chatgpt`                               |
| `apiKey`        | string | Ja für `api-key`-Modus | -                           | OpenAI API-Schlüssel                                                            |
| `baseUrl`       | string | Nein                     | `https://api.openai.com/v1` | API-Endpunkt                                                              |
| `model`         | string | Ja                    | -                           | Modellname (z. B. `gpt-5.4`, `gpt-5.4-mini`)                              |
| `contextWindow` | number | Nein                     | Auto                        | Exaktes Modell-Kontextfenster. Setzen Sie dies, um veraltete lokale Annahmen zu überschreiben. |
| `chatgptAuth`   | object | Ja für `chatgpt`-Modus | -                           | Gespeicherte ChatGPT/Codex-Auth-Tokens und Account-ID                           |

### `mlx`

MLX-Anbieter für Apple Silicon Macs (lokale Inferenz).

```json
{
  "mlx": {
    "baseUrl": "http://localhost:8080",
    "port": 8080,
    "model": "mlx-community/Llama-3.2-3B-Instruct-4bit"
  }
}
```

| Feld     | Typ   | Erforderlich | Standard                 | Beschreibung          |
| --------- | ------ | -------- | ----------------------- | -------------------- |
| `baseUrl` | string | Nein       | `http://localhost:8080` | MLX-Server-URL       |
| `port`    | number | Nein       | `8080`                  | Serverport          |
| `model`   | string | Ja      | -                       | MLX-Modellkennung |

### `llmgateway`

LLM Gateway unified API-Konfiguration. Ermöglicht Zugriff auf mehrere LLM-Anbieter über eine einzelne API.

```json
{
  "llmgateway": {
    "apiKey": "your-llmgateway-api-key",
    "baseUrl": "https://api.llmgateway.io/v1",
    "model": "gpt-4o"
  }
}
```

| Feld     | Typ   | Erforderlich | Standard                        | Beschreibung                                               |
| --------- | ------ | -------- | ------------------------------ | --------------------------------------------------------- |
| `apiKey`  | string | Ja      | -                              | LLM Gateway API-Schlüssel                                       |
| `baseUrl` | string | Nein       | `https://api.llmgateway.io/v1` | API-Endpunkt                                              |
| `model`   | string | Ja      | -                              | Modellname (z. B. `gpt-4o`, `claude-3-5-sonnet-20241022`) |

**API-Schlüssel erhalten:**
Besuchen Sie [llmgateway.io/dashboard](https://llmgateway.io/dashboard), um ein Konto zu erstellen und Ihren API-Schlüssel zu erhalten.

**Unterstützte Modelle:**
LLM Gateway unterstützt Modelle von mehreren Anbietern, darunter:

- OpenAI: `gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo`
`claude-3-5-haiku-20241022`
- Google: `gemini-1.5-pro`, `gemini-1.5-flash`

### `deepseek`

DeepSeek-Anbieterkonfiguration. Die API ist OpenAI-kompatibel und verwendet `https://api.deepseek.com` als Basis-URL.

```json
{
  "deepseek": {
    "apiKey": "your-deepseek-api-key",
    "baseUrl": "https://api.deepseek.com",
    "model": "deepseek-v4-flash"
  }
}
```

| Feld     | Typ   | Erforderlich | Standard                    | Beschreibung                                                    |
| --------- | ------ | -------- | -------------------------- | -------------------------------------------------------------- |
| `apiKey`  | string | Ja      | -                          | DeepSeek API-Schlüssel                                               |
| `baseUrl` | string | Nein       | `https://api.deepseek.com` | API-Endpunkt                                                   |
| `model`   | string | Ja      | -                          | Modellname, zum Beispiel `deepseek-v4-flash` oder `deepseek-v4-pro` |

### `bedrock`

AWS Bedrock-Anbieterkonfiguration. `converse` ist der Standardmodus und verwendet die AWS SDK-Anmeldekette. OpenAI-kompatible Modi verwenden Bedrock API-Schlüssel und Bedrock OpenAI-kompatible Endpunkte.

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

| Feld      | Typ   | Erforderlich | Standard | Beschreibung |
| ---------- | ------ | -------- | ------- | ----------- |
| `model`    | string | Ja      | -       | Bedrock-Modell-ID, Inferenzprofil-ID oder ARN |
| `region`   | string | Ja      | `AWS_REGION`, dann `AWS_DEFAULT_REGION`, dann `us-east-1` in setup | AWS-Region |
| `apiMode`  | string | Nein       | `converse` | `converse`, `openai-chat`, oder `openai-responses` |
| `authMode` | string | Nein       | `aws-credentials` für `converse`, `bedrock-api-key` für OpenAI-kompatible Modi | Authentifizierungsmodus |
| `profile`  | string | Nein       | -       | Optionaler AWS-Profil für Anmeldekette-Auth |
| `endpoint` | string | Nein       | Abgeleitet aus Modus und Region | Benutzerdefinierter/privater Bedrock-Endpunkt |
| `apiKey`   | string | Ja für OpenAI-kompatible Modi | - | Bedrock API-Schlüssel. Verwenden Sie keine OpenAI API-Schlüssel. |

Führen Sie `aws configure sso` aus oder setzen Sie `AWS_PROFILE=enterprise-prod autohand` für profilbasierte AWS-Auth. IAM-Rollen-, Container- und Instanzmetadaten-Anmeldeinformationen werden vom AWS SDK unterstützt. Aktivieren Sie den Modellzugriff in der AWS-Konsole, bevor Sie ein Modell verwenden.

---

## Arbeitsbereichs-Einstellungen

```json
{
  "workspace": {
    "defaultRoot": "/path/to/projects",
    "allowDangerousOps": false
  }
}
```

| Feld               | Typ    | Standard           | Beschreibung                                       |
| ------------------- | ------- | ----------------- | ------------------------------------------------- |
| `defaultRoot`       | string  | Aktuelles Verzeichnis | Standard-Arbeitsbereich, wenn keiner angegeben             |
| `allowDangerousOps` | boolean | `false`           | Zerstörerische Operationen ohne Bestätigung erlauben |

### Arbeitsbereichssicherheit

Autohand blockiert automatisch Operationen in gefährlichen Verzeichnissen, um versehentliche Schäden zu vermeiden:

- **Dateisystemwurzeln** (`/`, `C:\`, `D:\`, usw.)
- **Home-Verzeichnisse** (`~`, `/Users/<user>`, `/home/<user>`, `C:\Users\<user>`)
- **Systemverzeichnisse** (`/etc`, `/var`, `/System`, `C:\Windows`, usw.)
- **WSL-Windows-Mounts** (`/mnt/c`, `/mnt/c/Users/<user>`)

Diese Prüfung kann nicht umgangen werden. Wenn Sie versuchen, autohand in einem gefährlichen Verzeichnis auszuführen, erhalten Sie einen Fehler und müssen ein sicheres Projektverzeichnis angeben.

```bash
# Dies wird blockiert
cd ~ && autohand
# Error: Unsafe Workspace Directory

# Dies funktioniert
cd ~/projects/my-app && autohand
```

Siehe [Workspace Safety](./workspace-safety.md) für alle Details.

---

## UI-Einstellungen

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

| Feld                        | Typ   | Standard | Beschreibung                                                                                    |
| ---------------------------- | ------ | ------- | ---------------------------------------------------------------------------------------------- |
| `theme`                      | string | `"dark"` | Farbschema für Terminal-Ausgabe. Eingebaute Schemas umfassen `dark`, `light`, `dracula`, `sandy`, `tui`, `github-dark`, `cappadocia`, `rio`, und `australia`. Legacy-Werte `turkey` und `brazil` werden weiterhin als Aliase geladen. |
| `customThemes`               | object | `{}`    | Inline-Definitionen benutzerdefinierter Farbschemas, nach Themenname indiziert. Setzen Sie `theme` auf denselben Schlüssel, um eines zu verwenden.   |
| `autoConfirm`                | boolean | `false` | Bestätigungsaufforderungen für sichere Operationen überspringen                                                  |
| `readFileCharLimit`          | number | `300`   | Maximale Anzahl Zeichen, die aus read/find-Tool-Ausgaben angezeigt werden (der vollständige Inhalt wird weiterhin an das Modell gesendet) |
| `silentToolOutput`           | boolean | `false` | Tool-Ausgabeblöcke im Terminal ausblenden, während Tool-Ergebnisse für das Modell/die Sitzung erhalten bleiben |
| `activityVerbs`              | string oder string[] | eingebauter Pool | Benutzerdefiniertes Aktivitätsverb oder Verb-Pool für den Arbeitsanzeiger, dargestellt als `Verb...` |
| `activityVerbsEnabled`       | boolean | `true`  | Rotierende Aktivitätsverben wie `Compiling...` anzeigen, während der Agent arbeitet |
| `activitySymbol`             | string | `"✳"`   | Symbol, das vor dem Aktivitätsverb in der Arbeitsanzeige angezeigt wird |
| `statusLine.showProviderModel` | boolean | `true`  | Aktiven Anbieter und das Modell in der Composer-Statuszeile anzeigen |
| `statusLine.showContext`       | boolean | `true`  | Kontextprozentsatz in der Composer-Statuszeile anzeigen |
| `statusLine.showCommandHint`   | boolean | `true`  | Befehls-, Mention-, Skill- und Terminal-Eingabe-Hinweise in der Composer-Statuszeile anzeigen |
| `statusLine.showPullRequest`   | boolean | `true`  | Zugehörige Pull-Request-Nummer anzeigen, oder `PR #123`, wenn keine PR zugeordnet ist |
| `statusLine.showSessionLines`  | boolean | `false` | Während der aktuellen Sitzung hinzugefügte und entfernte Zeilen anzeigen |
| `statusLine.showQueue`         | boolean | `true`  | Anzahl der eingereihten Anfragen in der Statuszeile anzeigen |
| `statusLine.showActiveStatus`  | boolean | `true`  | Aktiven Turn-Statustext anzeigen, während der Agent arbeitet |
| `statusLine.showActiveMetrics` | boolean | `true`  | Verstrichene Zeit und Token-Metriken anzeigen, während der Agent arbeitet |
| `statusLine.showCancelHint`    | boolean | `true`  | Den Esc-Abbruch-Hinweis anzeigen, während der Agent arbeitet |
| `completionReportEnabled`    | boolean | `true`  | Das Modell bitten, nach abgeschlossenen Action-Turns einen kurzen Abschlussbericht einzuschließen |
| `showCompletionNotification` | boolean | `true`  | Systembenachrichtigung anzeigen, wenn eine Aufgabe abgeschlossen ist                                                   |
| `showThinking`               | boolean | `true`  | Reasoning/Gedankenprozess des LLM anzeigen                                                        |
| `terminalBell`               | boolean | `true`  | Terminalglocke läuten, wenn Aufgabe abgeschlossen ist (zeigt Badge auf Terminal-Tab/Dock)                      |
| `checkForUpdates`            | boolean | `true`  | Beim Start auf CLI-Updates prüfen                                                               |
| `updateCheckInterval`        | number | `24`    | Stunden zwischen Update-Prüfungen (verwendet zwischengespeichertes Ergebnis innerhalb des Intervalls)                               |

Benutzerdefinierte Farbschemas können jedes semantische Farb-Token überschreiben. Fehlende Tokens werden vom Dark-Theme geerbt:

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

Hinweis: `readFileCharLimit` und `silentToolOutput` wirken sich nur auf die Terminal-Anzeige aus. Der vollständige Inhalt wird weiterhin an das Modell gesendet und in Tool-Nachrichten gespeichert.

Sie können stille Tool-Ausgabe ohne Bearbeitung der Datei umschalten:

```bash
autohand config set silent_tool_output true
autohand config set silent_tool_output false
```

Sie können rotierende Aktivitätsverben ohne Bearbeitung der Datei umschalten:

```bash
autohand config set verbs activity true
autohand config set verbs activity false
```

Passen Sie die Verben in der Konfigurationsdatei an, wenn Sie ein festes Statuslabel oder eine kleine projektspezifische Rotation wünschen:

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

`activityVerbs` akzeptiert entweder einen einzelnen String oder ein nicht-leeres String-Array. Wenn `activityVerbsEnabled` `false` ist, fällt Autohand auf `Working...` zurück, anstatt durch benutzerdefinierte oder eingebaute Verben zu rotieren.

Sie können Abschlussberichte, einschließlich des strukturierten `SITREP`-Prompts, ohne Bearbeitung der Datei umschalten:

```bash
autohand config set sitrep true
autohand config set sitrep false
```

### Terminalglocke

Wenn `terminalBell` aktiviert ist (Standard), läutet Autohand die Terminalglocke (`\x07`), wenn eine Aufgabe abgeschlossen ist. Dies löst Folgendes aus:

- **Badge auf Terminal-Tab** - Zeigt einen visuellen Indikator, dass die Arbeit erledigt ist
- **Dock-Icon-Bounce** - Zieht Ihre Aufmerksamkeit auf sich, wenn das Terminal im Hintergrund ist (macOS)
- **Ton** - Wenn Terminal-Töne in Ihren Terminal-Einstellungen aktiviert sind

Terminalspezifische Einstellungen:

- **macOS Terminal**: Einstellungen > Profile > Erweitert > Glocke (Visuell/Hörbar)
- **iTerm2**: Einstellungen > Profile > Terminal > Benachrichtigungen
- **VS Code Terminal**: Einstellungen > Terminal > Integrated: Enable Bell

So deaktivieren Sie es:

```json
{
  "ui": {
    "terminalBell": false
  }
}
```

### Ink Renderer

Autohand verwendet standardmäßig den Ink 7 + React 19 Renderer für interaktive Terminals. Das veraltete Konfigurationsfeld `ui.useInkRenderer` wird ignoriert, sodass alte Konfigurationsdateien den einfachen Terminal-Composer nicht erzwingen können. Ink bietet:

- **Flimmerfreie Ausgabe**: Alle UI-Updates werden durch React-Reconciliation gebündelt
- **Arbeitswarteschlangenfunktion**: Geben Sie Anweisungen ein, während der Agent arbeitet
- **Bessere Eingabeverarbeitung**: Keine Konflikte zwischen Readline-Handlern
- **Komponierbare UI**: Grundlage für zukünftige erweiterte UI-Funktionen

Notfall-Fallback für Terminal-Kompatibilität:

```bash
AUTOHAND_LEGACY_UI=1 autohand
```

Hinweis: Diese Funktion ist experimentell und kann Edge Cases haben. Die standardmäßige ora-basierte UI bleibt stabil und voll funktionsfähig.

### Update-Prüfung

Wenn `checkForUpdates` aktiviert ist (Standard), prüft Autohand beim Start auf neue Releases:

```
> Autohand v0.6.8 (abc1234) ✓ Up to date
```

Wenn ein Update verfügbar ist:

```
> Autohand v0.6.7 (abc1234) ⬆ Update available: v0.6.8
  ↳ Run: curl -fsSL https://autohand.ai/install.sh | sh
```

So funktioniert es:

- Ruft das neueste Release von der GitHub API ab
- Speichert das Ergebnis zwischen in `~/.autohand/version-check.json`
- Prüft nur einmal pro `updateCheckInterval` Stunden (Standard: 24)
- Nicht blockierend: Der Start läuft weiter, auch wenn die Prüfung fehlschlägt

So deaktivieren Sie es:

```json
{
  "ui": {
    "checkForUpdates": false
  }
}
```

Oder über Umgebungsvariable:

```bash
export AUTOHAND_SKIP_UPDATE_CHECK=1
```

---

## Agenten-Einstellungen

Steuern Sie das Agentenverhalten und die Iterationslimits.

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

| Feld                | Typ    | Standard | Beschreibung                                                                    |
| -------------------- | ------- | ------- | ------------------------------------------------------------------------------ |
| `maxIterations`      | number  | `100`   | Maximale Tool-Iterationen pro Benutzeranfrage, bevor gestoppt wird                       |
| `enableRequestQueue` | boolean | `true`  | Benutzern erlauben, Nachrichten einzugeben und in die Warteschlange zu stellen, während der Agent arbeitet                  |
| `toolSelectionCache` | boolean | `true`  | Lokale pro-Turn-Tool-Schema-Auswahl für gleichwertige Tool-Selection-Eingaben cachen |
| `autoMemory`         | boolean | `true`  | Langlebige Benutzer-/Projekt-Memories nach erfolgreichen interaktiven Turns extrahieren und speichern |
| `idleLogoutEnabled`  | boolean | `true`  | Authentifizierte interaktive Sitzungen nach der Leerlaufzeit abmelden              |
| `idleTimeoutMs`      | number  | `3600000` | Millisekunden Inaktivität vor der Abmeldung einer authentifizierten Sitzung (60 Minuten) |
| `debug`              | boolean | `false` | Ausführliche Debug-Ausgabe aktivieren (protokolliert internen Agentenstatus nach stderr)              |

### Tool-Schema-Auswahl

Autohand sendet nicht jedes vollständige Tool-Schema bei jeder LLM-Anfrage. Der System-Prompt enthält einen kompakten Tool-Fähigkeitenkatalog, und jede Anfrage legt nur eine kleine Menge konkreter Schemas offen, ausgewählt aus:

- Kern-Erkennungstools wie `tool_search`, `read_file`, `fff_find`, und `fff_grep`
- Absichtsübereinstimmende Tools für Bearbeitungs-, Verifizierungs-, Git-, Browser-, Web-, Abhängigkeits- oder Projekt-Tracking-Arbeit
- Tools, die über kürzliche `tool_search`-Aufrufe angefordert wurden oder explizit namentlich erwähnt wurden

Dies vermeidet die großen upfront-Kontextkosten, alle Tool-Schemas zu senden, bevor die Benutzerabsicht bekannt ist. `toolSelectionCache` steuert nur den lokalen Selector-Cache für gleichwertige Turns; es führt kein Pre-User-LLM-Warmup durch und erzwingt kein großes gecachtes Prompt-Präfix.

So deaktivieren Sie den lokalen Selector-Cache:

```json
{
  "agent": {
    "toolSelectionCache": false
  }
}
```

Um authentifizierte langlaufende Agentensitzungen am Leben zu erhalten, während sie auf Arbeit warten:

```json
{
  "agent": {
    "idleLogoutEnabled": false
  }
}
```

Für einen einzelnen Prozess verwenden Sie `autohand --no-idle-logout` oder setzen Sie `AUTOHAND_NO_IDLE_LOGOUT=1`.

Setzen Sie `idleTimeoutMs` auf eine positive Dauer in Millisekunden, um die Leerlaufzeit zu ändern. Der Standardwert ist `3600000` (60 Minuten); ungültige Werte verwenden den Standardwert.

### Debug-Modus

Aktivieren Sie den Debug-Modus, um ausführliche Protokolle des internen Agentenstatus zu sehen (React-Loop-Iterationen, Prompt-Aufbau, Sitzungsdetails). Die Ausgabe erfolgt nach stderr, um die normale Ausgabe nicht zu stören.

Drei Möglichkeiten, den Debug-Modus zu aktivieren (in Reihenfolge der Priorität):

1. **CLI-Flag**: `autohand -d` oder `autohand --debug`
2. **Umgebungsvariable**: `AUTOHAND_DEBUG=1`
3. **Konfigurationsdatei**: Setzen Sie `agent.debug: true`

### Anfragewarteschlange

Wenn `enableRequestQueue` aktiviert ist, können Sie weiterhin Nachrichten tippen, während der Agent eine vorherige Anfrage verarbeitet. Ihre Eingabe wird in die Warteschlange gestellt und automatisch verarbeitet, wenn die aktuelle Aufgabe abgeschlossen ist.

- Tippen Sie Ihre Nachricht und drücken Sie Enter, um sie der Warteschlange hinzuzufügen
- Die Statuszeile zeigt an, wie viele Anfragen in der Warteschlange sind
- Anfragen werden in FIFO-Reihenfolge (First-In-First-Out) verarbeitet
- Maximale Warteschlangengröße beträgt 10 Anfragen

---

## Berechtigungseinstellungen

Feingranulare Steuerung über Tool-Berechtigungen.

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

| Wert            | Beschreibung                                           |
| ---------------- | ----------------------------------------------------- |
| `"interactive"`  | Bei gefährlichen Operationen um Zustimmung bitten (Standard) |
| `"unrestricted"` | Keine Eingabeaufforderungen, alles erlauben                          |
| `"restricted"`   | Alle gefährlichen Operationen ablehnen                         |

### `whitelist`

Array von Tool-Mustern, die nie eine Genehmigung erfordern.

```json
["run_command:npm *", "run_command:bun test"]
```

### `blacklist`

Array von Tool-Mustern, die immer blockiert sind.

```json
["run_command:rm -rf /", "run_command:sudo *"]
```

### `rules`

Feingranulare Berechtigungsregeln.

| Feld     | Typ      | Beschreibung                                 |
| --------- | --------- | ------------------------------------------- | ---------- | -------------- |
| `tool`    | string    | Tool-Name zum Abgleich                          |
| `pattern` | string    | Optionales Muster zum Abgleich mit Argumenten |
| `action`  | `"allow"` | `"deny"`                                    | `"prompt"` | Auszuführende Aktion |

### `rememberSession`

| Typ    | Standard | Beschreibung                                 |
| ------- | ------- | ------------------------------------------- |
| boolean | `true`  | Genehmigungsentscheidungen für die Sitzung merken |

### Lokale Projektberechtigungen

Jedes Projekt kann eigene Berechtigungseinstellungen haben, die die globale Konfiguration überschreiben. Diese werden in `.autohand/settings.local.json` im Projektstamm gespeichert.

Wenn Sie einen Dateioperation genehmigen (Bearbeiten, Schreiben, Löschen), wird sie automatisch in dieser Datei gespeichert, damit Sie für dieselbe Operation in diesem Projekt nicht erneut gefragt werden.

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

**So funktioniert es:**

- Wenn Sie eine Operation genehmigen, wird sie in `.autohand/settings.local.json` gespeichert
- Beim nächsten Mal wird dieselbe Operation automatisch genehmigt
- Lokale Projekteinstellungen werden mit globalen Einstellungen zusammengeführt (lokale haben Vorrang)
- Fügen Sie `.autohand/settings.local.json` zu `.gitignore` hinzu, um persönliche Einstellungen privat zu halten

**Musterformat:**

- `tool_name:path` - Für Dateioperationen (z. B. `apply_patch:src/file.ts`)
- `tool_name:command args` - Für Befehle (z. B. `run_command:npm test`)

### Berechtigungen anzeigen

Sie können Ihre aktuellen Berechtigungseinstellungen auf zwei Arten anzeigen:

**CLI-Flag (Nicht-interaktiv):**

```bash
autohand --permissions
```

Dies zeigt an:

- Aktuellen Berechtigungsmodus (interactive, unrestricted, restricted)
- Arbeitsbereichs- und Konfigurationsdateipfade
- Alle genehmigten Muster (Whitelist)
- Alle abgelehnten Muster (Blacklist)
- Zusammenfassende Statistiken

**Interaktiver Befehl:**

```
/permissions
```

Im interaktiven Modus bietet der Befehl `/permissions` dieselben Informationen sowie Optionen zum:

- Entfernen von Einträgen aus der Whitelist
- Entfernen von Einträgen aus der Blacklist
- Löschen aller gespeicherten Berechtigungen

---

## Patch-Modus

Der Patch-Modus ermöglicht es, einen teilbaren git-kompatiblen Patch zu generieren, ohne die Arbeitsbereichsdateien zu verändern. Dies ist nützlich für:

- Code-Review vor dem Anwenden von Änderungen
- Teilen KI-generierter Änderungen mit Teammitgliedern
- Erstellen reproduzierbarer Änderungssätze
- CI/CD-Pipelines, die Änderungen erfassen müssen, ohne sie anzuwenden

### Verwendung

```bash
# Patch auf stdout ausgeben
autohand --prompt "add user authentication" --patch

# In Datei speichern
autohand --prompt "add user authentication" --patch --output auth.patch

# In Datei umleiten (Alternative)
autohand --prompt "refactor api handlers" --patch > refactor.patch
```

### Verhalten

Wenn `--patch` angegeben ist:

- **Auto-Bestätigung**: Alle Bestätigungen werden automatisch akzeptiert (`--yes` impliziert)
- **Keine Eingabeaufforderungen**: Es werden keine Genehmigungsaufforderungen angezeigt (`--unrestricted` impliziert)
- **Nur Vorschau**: Änderungen werden erfasst, aber NICHT auf die Festplatte geschrieben
- **Sicherheit erzwungen**: Blacklist-Operationen (`.env`, SSH-Schlüssel, gefährliche Befehle) werden weiterhin blockiert

### Patches anwenden

Empfänger können den Patch mit Standard-Git-Befehlen anwenden:

```bash
# Prüfen, was angewendet würde (Dry-Run)
git apply --check changes.patch

# Patch anwenden
git apply changes.patch

# Mit 3-Way-Merge anwenden (löst Konflikte besser)
git apply -3 changes.patch

# Anwenden und Änderungen stagen
git apply --index changes.patch

# Patch rückgängig machen
git apply -R changes.patch
```

### Patch-Format

Der generierte Patch folgt dem git unified-diff-Format:

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

### Exit-Codes

| Code | Bedeutung                                             |
| ---- | --------------------------------------------------- |
| `0`  | Erfolg, Patch generiert                            |
| `1`  | Fehler (fehlendes `--prompt`, Berechtigung verweigert, usw.) |

### Kombination mit anderen Flags

```bash
# Bestimmtes Modell verwenden
autohand --prompt "optimize queries" --patch --model gpt-4o

# Arbeitsbereich angeben
autohand --prompt "add tests" --patch --path ./my-project

# Benutzerdefinierte Konfiguration verwenden
autohand --prompt "refactor" --patch --config ~/.autohand/work.json
```

### Team-Workflow-Beispiel

```bash
# Entwickler A: Patch für ein Feature generieren
autohand --prompt "implement user dashboard with charts" --patch --output dashboard.patch

# Über git teilen (PR nur mit der Patch-Datei erstellen)
git checkout -b patch/dashboard
git add dashboard.patch
git commit -m "Add dashboard feature patch"
git push

# Entwickler B: Reviewen und anwenden
git fetch origin patch/dashboard
git apply dashboard.patch
# Tests ausführen, Code reviewen, dann committen
git add -A && git commit -m "feat: add user dashboard with charts"
```

---

## Netzwerkeinstellungen

```json
{
  "network": {
    "maxRetries": 3,
    "timeout": 30000,
    "retryDelay": 1000
  }
}
```

| Feld        | Typ   | Standard | Max | Beschreibung                            |
| ------------ | ------ | ------- | --- | -------------------------------------- |
| `maxRetries` | number | `3`     | `5` | Wiederholungsversuche für fehlgeschlagene API-Anfragen |
| `timeout`    | number | `30000` | -   | Anfrage-Timeout in Millisekunden        |
| `retryDelay` | number | `1000`  | -   | Verzögerung zwischen Wiederholungsversuchen in Millisekunden  |

---

## Telemetrie-Einstellungen

Telemetrie ist **standardmäßig deaktiviert** (Opt-in). Aktivieren Sie sie, um Autohand zu verbessern.

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

| Feld               | Typ    | Standard                   | Beschreibung                                   |
| ------------------- | ------- | ------------------------- | --------------------------------------------- |
| `enabled`           | boolean | `false`                   | Telemetrie aktivieren/deaktivieren (Opt-in)             |
| `apiBaseUrl`        | string  | `https://api.autohand.ai` | Telemetrie-API-Endpunkt                        |
| `batchSize`         | number  | `20`                      | Anzahl Ereignisse, die vor dem automatischen Flush gebündelt werden   |
| `flushIntervalMs`   | number  | `60000`                   | Flush-Intervall in Millisekunden (1 Minute)     |
| `maxQueueSize`      | number  | `500`                     | Maximale Warteschlangengröße, bevor alte Ereignisse verworfen werden |
| `maxRetries`        | number  | `3`                       | Wiederholungsversuche für fehlgeschlagene Telemetrieanfragen  |
| `enableSessionSync` | boolean | `true`                    | Sitzungen bei aktivierter Telemetrie mit der Cloud für Team-Features synchronisieren |
| `companySecret`     | string  | `""`                      | Firmengeheimnis für API-Authentifizierung         |

Provider-/Modell-Telemetrie umfasst die aktive Provider-ID, Modell-ID und verfügbare nicht-geheime Metadaten wie benutzerdefinierten Anzeigenamen, API-Format, Reasoning-Aufwand und Kontextfenster. API-Schlüssel und Bearer-Tokens werden niemals einbezogen.

---

## Externe Agenten

Benutzerdefinierte Agentendefinitionen aus externen Verzeichnissen laden.

```json
{
  "externalAgents": {
    "enabled": true,
    "paths": ["~/.autohand/agents", "/team/shared/agents"]
  }
}
```

| Feld     | Typ     | Standard | Beschreibung                     |
| --------- | -------- | ------- | ------------------------------- |
| `enabled` | boolean  | `false` | Laden externer Agenten aktivieren   |
| `paths`   | string[] | `[]`    | Verzeichnisse, aus denen Agenten geladen werden |

---

## Skills-System

Skills sind Instruktionspakete, die dem KI-Agenten spezialisierte Anweisungen bereitstellen. Sie funktionieren wie On-Demand-`AGENTS.md`-Dateien, die für bestimmte Aufgaben aktiviert werden können.

### Skill-Erkennungsorte

Skills werden an mehreren Orten erkannt, wobei spätere Quellen Vorrang haben:

| Ort                                 | Quellen-ID          | Beschreibung                               |
| ---------------------------------------- | ------------------ | ----------------------------------------- |
| `~/.codex/skills/**/SKILL.md`            | `codex-user`       | Benutzer-level Codex skills (rekursiv)       |
| `~/.claude/skills/*/SKILL.md`            | `claude-user`      | Benutzer-level Claude skills (eine Ebene)      |
| `~/.autohand/skills/**/SKILL.md`         | `autohand-user`    | Benutzer-level Autohand skills (rekursiv)    |
| `<project>/.claude/skills/*/SKILL.md`    | `claude-project`   | Projekt-level Claude skills (eine Ebene)   |
| `<project>/.autohand/skills/**/SKILL.md` | `autohand-project` | Projekt-level Autohand skills (rekursiv) |

### Auto-Copy-Verhalten

Von Codex- oder Claude-Orten erkannte Skills werden automatisch in den entsprechenden Autohand-Ordner kopiert:

- `~/.codex/skills/` und `~/.claude/skills/` → `~/.autohand/skills/`
- `<project>/.claude/skills/` → `<project>/.autohand/skills/`

Vorhandene Skills in Autohand-Ordnern werden niemals überschrieben.

### SKILL.md-Format

Skills verwenden YAML-Frontmatter gefolgt von Markdown-Inhalt:

```markdown
---
name: my-skill-name
description: Kurzbeschreibung des Skills
license: MIT
compatibility: Works with Node.js 18+
allowed-tools: read_file write_file run_command
metadata:
  author: your-name
  version: "1.0.0"
---

# My Skill

Detaillierte Anweisungen für den KI-Agenten...
```

| Feld           | Erforderlich | Max. Länge | Beschreibung                                |
| --------------- | -------- | ---------- | ------------------------------------------ |
| `name`          | Ja      | 64 Zeichen   | Kleinbuchstaben, alphanumerisch mit Bindestrichen   |
| `description`   | Ja      | 1024 Zeichen | Kurzbeschreibung des Skills             |
| `license`       | Nein       | -          | Lizenzkennung (z. B. MIT, Apache-2.0) |
| `compatibility` | Nein       | 500 Zeichen  | Kompatibilitätshinweise                        |
| `allowed-tools` | Nein       | -          | Leerzeichen-getrennte Liste erlaubter Tools      |
| `metadata`      | Nein       | -          | Zusätzliche Schlüssel-Wert-Metadaten              |

### Eingabe-Präfixe

Autohand unterstützt spezielle Präfixe im Eingabe-Prompt:

| Präfix | Beschreibung                    | Beispiel                            |
| ------ | ------------------------------ | ---------------------------------- |
| `/`    | Slash-Befehle                 | `/help`, `/model`, `/quit`, `/exit` |
| `@`    | Datei-Erwähnungen (Autovervollständigung)   | `@src/index.ts`                    |
| `$`    | Skill-Erwähnungen (Autovervollständigung)  | `$frontend-design`, `$code-review` |
| `!`    | Terminal-Befehle direkt ausführen | `! git status`, `! ls -la`         |

**Skill-Erwähnungen (`$`):**

- Tippen Sie `$` gefolgt von Zeichen, um verfügbare Skills mit Autovervollständigung zu sehen
- Tab akzeptiert den obersten Vorschlag (z. B. `$frontend-design`)
- Skills werden aus `~/.autohand/skills/` und `<project>/.autohand/skills/` erkannt
- Aktivierte Skills werden als spezielle Anweisungen für die aktuelle Sitzung an den Prompt angehängt
- Das Vorschaufenster zeigt Skill-Metadaten (Name, Beschreibung, Aktivierungsstatus)

**Shell-Befehle (`!`):**

- Befehle werden in Ihrem aktuellen Arbeitsverzeichnis ausgeführt
- Ausgabe wird direkt im Terminal angezeigt
- Geht nicht an das LLM
- 30-Sekunden-Timeout
- Kehrt nach Ausführung zum Prompt zurück

### Slash-Befehle

#### `/skills` - Paketmanager

| Befehl                         | Beschreibung                                |
| ------------------------------- | ------------------------------------------ |
| `/skills`                       | Alle verfügbaren Skills auflisten                  |
| `/skills use <name>`            | Einen Skill für die aktuelle Sitzung aktivieren   |
| `/skills deactivate <name>`     | Einen Skill deaktivieren                         |
| `/skills info <name>`           | Detaillierte Skill-Informationen anzeigen            |
| `/skills install`               | Community-Registry durchsuchen und installieren |
| `/skills install @<slug>`       | Community-Skill per Slug installieren          |
| `/skills search <query>`        | Community-Skills-Registry durchsuchen       |
| `/skills trending`              | Trendige Community-Skills anzeigen             |
| `/skills remove <slug>`         | Community-Skill deinstallieren                |
| `/skills new`                   | Interaktiv einen neuen Skill erstellen           |
| `/skills feedback <slug> <1-5>` | Einen Community-Skill bewerten                     |

#### `/learn` - LLM-gestützter Skill-Berater

| Befehl         | Beschreibung                                                      |
| --------------- | ---------------------------------------------------------------- |
| `/learn`        | Projekt analysieren und Skills empfehlen (schneller Scan)                |
| `/learn deep`   | Projekt tiefer scannen (liest Quelldateien) für gezieltere Ergebnisse |
| `/learn update` | Projekt erneut analysieren und veraltete LLM-generierte Skills neu generieren  |

`/learn` verwendet einen zweiphasigen LLM-Ablauf:

1. **Phase 1 - Analysieren + Rangordnen + Auditieren**: Scannt Ihre Projektstruktur, auditiert installierte Skills auf Redundanz/Konflikte und ordnet Community-Skills nach Relevanz (0-100).
2. **Phase 2 - Generieren** (bedingt): Wenn kein Community-Skill über 60 Punkte erreicht, bietet es an, einen maßgeschneiderten Skill für Ihr Projekt zu generieren.

Generierte Skills enthalten Metadaten (`agentskill-source: llm-generated`, `agentskill-project-hash`), sodass `/learn update` erkennen kann, wenn sich Ihre Codebasis ändert und veraltete Skills neu generiert.

### Auto-Skill-Generierung (`--auto-skill`)

Das `--auto-skill` CLI-Flag generiert Skills ohne den interaktiven Berater-Ablauf:

```bash
autohand --auto-skill
```

Dies wird:

1. Ihre Projektstruktur analysieren (package.json, requirements.txt, usw.)
2. Sprachen, Frameworks und Muster erkennen
3. 3 relevante Skills mit LLM generieren
4. Skills unter `<project>/.autohand/skills/` speichern

Für eine gezieltere, interaktive Erfahrung verwenden Sie stattdessen `/learn` innerhalb einer Sitzung.

Erkannte Muster umfassen:

- **Sprachen**: TypeScript, JavaScript, Python, Rust, Go
- **Frameworks**: React, Next.js, Vue, Express, Flask, Django
- **Muster**: CLI-Tools, Testing, Monorepo, Docker, CI/CD

---

## API-Einstellungen

Backend-API-Konfiguration für Team-Features.

```json
{
  "api": {
    "baseUrl": "https://api.autohand.ai",
    "companySecret": "sk-team-xxx"
  }
}
```

| Feld           | Typ   | Standard                   | Beschreibung                             |
| --------------- | ------ | ------------------------- | --------------------------------------- |
| `baseUrl`       | string | `https://api.autohand.ai` | API-Endpunkt                            |
| `companySecret` | string | -                         | Team-/Firmengeheimnis für gemeinsame Features |

Kann auch über Umgebungsvariablen gesetzt werden:

- `AUTOHAND_API_URL` → `api.baseUrl`
- `AUTOHAND_SECRET` → `api.companySecret`

---

## Authentifizierungseinstellungen

Authentifizierungs- und Benutzersitzungskonfiguration.

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

| Feld         | Typ   | Standard | Beschreibung                                  |
| ------------- | ------ | ------- | -------------------------------------------- |
| `token`       | string | -       | Authentifizierungstoken für API-Zugriff          |
| `user`        | object | -       | Authentifizierte Benutzerinformationen               |
| `user.id`     | string | -       | Benutzer-ID                                      |
| `user.email`  | string | -       | E-Mail-Adresse des Benutzers                           |
| `user.name`   | string | -       | Anzeigename des Benutzers                            |
| `user.avatar` | string | -       | Avatar-URL des Benutzers (optional)                   |
| `expiresAt`   | string | -       | Ablaufzeitstempel des Tokens (ISO-8601-Format) |

---

## Community-Skills-Einstellungen

Konfiguration für Community-Skills-Erkennung und -Verwaltung.

```json
{
  "communitySkills": {
    "enabled": true,
    "showSuggestionsOnStartup": true,
    "autoBackup": true
  }
}
```

| Feld                      | Typ    | Standard | Beschreibung                                                   |
| -------------------------- | ------- | ------- | ------------------------------------------------------------- |
| `enabled`                  | boolean | `true`  | Community-Skills-Features aktivieren                              |
| `showSuggestionsOnStartup` | boolean | `true`  | Skill-Vorschläge beim Start anzeigen, wenn keine Vendor-Skills existieren |
| `autoBackup`               | boolean | `true`  | Erkannte Vendor-Skills automatisch an API sichern          |

---

## Teilen-Einstellungen

Konfiguration für das Teilen von Sitzungen über den Befehl `/share`. Sitzungen werden unter [autohand.link](https://autohand.link) gehostet.

```json
{
  "share": {
    "enabled": true
  }
}
```

| Feld     | Typ    | Standard | Beschreibung                         |
| --------- | ------- | ------- | ----------------------------------- |
| `enabled` | boolean | `true`  | Den `/share`-Befehl aktivieren/deaktivieren |

### YAML-Format

```yaml
share:
  enabled: true
```

### Sitzungsteilen deaktivieren

Wenn Sie das Teilen von Sitzungen aus Sicherheits- oder Datenschutzgründen deaktivieren möchten:

```json
{
  "share": {
    "enabled": false
  }
}
```

Wenn deaktiviert, zeigt die Ausführung von `/share` an:

```
Session sharing is disabled.
To enable, set share.enabled: true in your config file.
```

---

## Einstellungen-Synchronisierung

Autohand kann Ihre Konfiguration über Geräte hinweg für angemeldete Benutzer synchronisieren. Einstellungen werden sicher in Cloudflare R2 gespeichert und vor dem Upload verschlüsselt.

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

| Feld              | Typ     | Standard         | Beschreibung                                        |
| ------------------ | -------- | --------------- | -------------------------------------------------- |
| `enabled`          | boolean  | `true` (angemeldet) | Einstellungs-Synchronisierung aktivieren/deaktivieren                       |
| `interval`         | number   | `300000`        | Synchronisierungsintervall in Millisekunden (Standard: 5 Minuten) |
| `exclude`          | string[] | `[]`            | Glob-Muster, die von der Synchronisierung ausgeschlossen werden                 |
| `includeTelemetry` | boolean  | `false`         | Telemetriedaten synchronisieren (erfordert Benutzereinwilligung)        |
| `includeFeedback`  | boolean  | `false`         | Feedbackdaten synchronisieren (erfordert Benutzereinwilligung)         |

### CLI-Flag

```bash
# Synchronisierung für diese Sitzung deaktivieren
autohand --sync-settings=false

# Synchronisierung aktivieren (Standard für angemeldete Benutzer)
autohand --sync-settings
```

### Was wird synchronisiert

Standardmäßig werden diese Elemente für angemeldete Benutzer synchronisiert:

- **Konfiguration** (`config.json`) - API-Schlüssel werden vor dem Upload verschlüsselt
- **Benutzerdefinierte Agenten** (`agents/`)
- **Community-Skills** (`community-skills/`)
- **Benutzer-Hooks** (`hooks/`)
- **Memory** (`memory/`)
- **Projektwissen** (`projects/`)
- **Sitzungsverlauf** (`sessions/`)
- **Geteilte Inhalte** (`share/`)
- **Benutzerdefinierte Skills** (`skills/`)

### Was nicht synchronisiert wird (standardmäßig)

- **Geräte-ID** (`device-id`) - Pro Gerät eindeutig
- **Fehlerprotokolle** (`error.log`) - Nur lokal
- **Versions-Cache** (`version-*.json`) - Lokale Cachedateien

### Einwilligungsbasierte Synchronisierung

Diese Elemente erfordern eine explizite Opt-in in Ihrer Konfiguration:

- **Telemetriedaten** - Setzen Sie `sync.includeTelemetry: true` zur Synchronisierung
- **Feedbackdaten** - Setzen Sie `sync.includeFeedback: true` zur Synchronisierung

```json
{
  "sync": {
    "enabled": true,
    "includeTelemetry": true,
    "includeFeedback": true
  }
}
```

### Konfliktlösung

Bei Konflikten ( dieselbe Datei auf mehreren Geräten geändert) gewinnt die **Cloud-Version**. Dies stellt Konsistenz beim Anmelden auf neuen Geräten sicher.

### Sicherheit

API-Schlüssel und andere sensible Daten in `config.json` werden mit Ihrem Authentifizierungstoken verschlüsselt, bevor sie hochgeladen werden. Sie können nur mit Ihren Anmeldedaten entschlüsselt werden.

**Was verschlüsselt wird:**

- Felder namens `apiKey`
- Felder, die mit `Key`, `Token`, `Secret` enden
- Das Feld `password`

### Wie es funktioniert

1. **Beim Start**: Wenn Sie angemeldet sind, startet der Synchronisierungsdienst automatisch
2. **Alle 5 Minuten**: Einstellungen werden mit dem Cloud-Speicher verglichen
3. **Cloud gewinnt**: Remote-Änderungen werden zuerst heruntergeladen
4. **Lokale Uploads**: Neue lokale Änderungen werden hochgeladen
5. **Beim Beenden**: Synchronisierungsdienst wird ordnungsgemäß beendet

### Dateien ausschließen

Sie können bestimmte Dateien oder Muster von der Synchronisierung ausschließen:

```json
{
  "sync": {
    "enabled": true,
    "exclude": ["custom-local-config.json", "temp/*"]
  }
}
```

### YAML-Format

```yaml
sync:
  enabled: true
  interval: 300000
  exclude: []
  includeTelemetry: false
  includeFeedback: false
```

---

## MCP-Einstellungen

Konfigurieren Sie MCP (Model Context Protocol)-Server, um Autohand mit externen Tools zu erweitern.

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
- **Standard**: `true`
- **Beschreibung**: Aktivieren oder deaktivieren Sie die gesamte MCP-Unterstützung. Wenn `false`, werden keine Server beim Start verbunden und MCP-Tools sind nicht verfügbar.

### `mcp.servers`

- **Typ**: `McpServerConfigEntry[]`
- **Standard**: `[]`
- **Beschreibung**: Array von MCP-Serverkonfigurationen.

### Server-Eintragsfelder

| Feld         | Typ                             | Erforderlich       | Standard | Beschreibung                                                   |
| ------------- | -------------------------------- | -------------- | ------- | ------------------------------------------------------------- |
| `name`        | `string`                         | Ja            | -       | Eindeutige Serverkennung                                      |
| `transport`   | `"stdio"` \| `"sse"` \| `"http"` | Ja            | -       | Transporttyp                                                |
| `command`     | `string`                         | Ja (stdio)    | -       | Befehl zum Starten des Serverprozesses                           |
| `args`        | `string[]`                       | Nein             | `[]`    | Argumente für den Befehl                                     |
| `url`         | `string`                         | Ja (sse/http) | -       | Server-Endpunkt-URL                                           |
| `headers`     | `Record<string, string>`         | Nein             | `{}`    | Benutzerdefinierte HTTP-Header für http/sse-Transport (z. B. Auth-Tokens) |
| `env`         | `Record<string, string>`         | Nein             | `{}`    | An den Server übergebene Umgebungsvariablen                    |
| `autoConnect` | `boolean`                        | Nein             | `true`  | Ob beim Start automatisch verbunden werden soll                            |

> Server verbinden sich asynchron im Hintergrund während des Starts, ohne den Prompt zu blockieren. Verwenden Sie `/mcp`, um Server interaktiv zu verwalten, oder `/mcp add`, um die Community-Registry zu durchsuchen oder benutzerdefinierte Server hinzuzufügen.

> Für die vollständige MCP-Dokumentation siehe [docs/mcp.md](mcp.md).

---

## Hooks-Einstellungen

Konfiguration für Lifecycle-Hooks, die Shell-Befehle bei Agenten-Ereignissen ausführen. Siehe [Hooks-Dokumentation](./hooks.md) für alle Details.

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

| Feld     | Typ    | Standard | Beschreibung                       |
| --------- | ------- | ------- | --------------------------------- |
| `enabled` | boolean | `true`  | Alle Hooks global aktivieren/deaktivieren |
| `hooks`   | array   | `[]`    | Array von Hook-Definitionen         |

### Hook-Definition

| Feld         | Typ    | Erforderlich | Standard | Beschreibung                      |
| ------------- | ------- | -------- | ------- | -------------------------------- |
| `event`       | string  | Ja      | -       | Ereignis, in das eingehakt wird               |
| `command`     | string  | Ja      | -       | Auszuführender Shell-Befehl         |
| `description` | string  | Nein       | -       | Beschreibung für die Anzeige in `/hooks` |
| `enabled`     | boolean | Nein       | `true`  | Ob der Hook aktiv ist           |
| `timeout`     | number  | Nein       | `5000`  | Timeout in Millisekunden          |
| `async`       | boolean | Nein       | `false` | Ohne Blockierung ausführen             |
| `filter`      | object  | Nein       | -       | Nach Tool oder Pfad filtern           |

### Hook-Ereignisse

| Ereignis           | Wann ausgelöst                            |
| --------------- | ------------------------------------- |
| `pre-tool`      | Bevor ein Tool ausgeführt wird              |
| `post-tool`     | Nachdem das Tool abgeschlossen ist                  |
| `file-modified` | Wenn eine Datei erstellt/bearbeitet/gelöscht wird |
| `pre-prompt`    | Bevor an das LLM gesendet wird                 |
| `post-response` | Nachdem das LLM geantwortet hat                    |
| `session-error` | Wenn ein Fehler auftritt                     |

### Umgebungsvariablen

Wenn Hooks ausgeführt werden, sind diese Umgebungsvariablen verfügbar:

| Variable         | Beschreibung                 |
| ---------------- | --------------------------- |
| `HOOK_EVENT`     | Ereignisname                  |
| `HOOK_WORKSPACE` | Arbeitsbereichs-Stammverzeichnis         |
| `HOOK_TOOL`      | Tool-Name (Tool-Ereignisse)     |
| `HOOK_ARGS`      | JSON-kodierte Tool-Argumente      |
| `HOOK_SUCCESS`   | true/false (post-tool)      |
| `HOOK_PATH`      | Dateipfad (file-modified)   |
| `HOOK_TOKENS`    | Verwendete Tokens (post-response) |

---

## Chrome-Erweiterungs-Einstellungen

Steuern Sie die Autohand Chrome-Erweiterungs-Integration. Siehe die vollständige Anleitung unter [Autohand in Chrome](./autohand-in-chrome.md).

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

| Schlüssel                | Typ      | Standard  | Beschreibung                                                               |
| ------------------ | --------- | -------- | ------------------------------------------------------------------------- |
| `extensionId`      | `string`  | —        | Installierte Chrome-Erweiterungs-ID für direkte Übergabe                          |
| `enabledByDefault` | `boolean` | `false`  | Browser-Bridge automatisch mit dem CLI starten                           |
| `browser`          | `string`  | `"auto"` | Bevorzugter Chromium-Browser: `auto`, `chrome`, `chromium`, `brave`, `edge` |
| `userDataDir`      | `string`  | —        | Browser-Benutzerdatenverzeichnis, um das richtige Profil anzusprechen                 |
| `profileDirectory` | `string`  | —        | Browser-Profilverzeichnisname (z. B. `"Default"`, `"Profile 1"`)         |
| `installUrl`       | `string`  | —        | Fallback-URL, wenn die Erweiterungs-ID nicht konfiguriert ist                      |

### CLI-Flags

```bash
autohand --chrome          # Mit aktivierter Browser-Bridge starten
autohand --no-chrome       # Mit deaktivierter Browser-Bridge starten
```

### Slash-Befehle

```
/browser                   # Chrome-Integrationspanel öffnen
/browser disconnect        # Browser-Bridge-Verbindung schließen
```

---

## Vollständiges Beispiel

### JSON-Format (`~/.autohand/config.json`)

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

### YAML-Format (`~/.autohand/config.yaml`)

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

### TOML-Format (`~/.autohand/config.toml`)

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

## Verzeichnisstruktur

Autohand speichert Daten in `~/.autohand/` (oder `$AUTOHAND_HOME`):

```
~/.autohand/
├── config.json          # Hauptkonfiguration
├── config.toml          # Alternative TOML-Konfiguration
├── config.yaml          # Alternative YAML-Konfiguration
├── device-id            # Eindeutige Gerätekennung
├── error.log            # Fehlerprotokoll
├── feedback.log         # Feedback-Einreichungen
├── sessions/            # Sitzungsverlauf
├── projects/            # Projektwissensdatenbank
├── memory/              # Benutzer-level Memory
├── commands/            # Benutzerdefinierte Befehle
├── agents/              # Agentendefinitionen
├── tools/               # Benutzerdefinierte Meta-Tools
├── feedback/            # Feedback-Status
└── telemetry/           # Telemetriedaten
    ├── queue.json
    └── session-sync-queue.json
```

**Projekt-level Verzeichnis** (im Stammverzeichnis Ihres Arbeitsbereichs):

```
<project>/.autohand/
├── settings.local.json  # Lokale Projektberechtigungen (in gitignore)
├── memory/              # Projektspezifisches Memory
├── skills/              # Projektspezifische Skills
└── tools/               # Projektspezifische Meta-Tools
```

---

## CLI-Flags (überschreiben Konfiguration)

Diese Flags überschreiben Konfigurationsdatei-Einstellungen:

### Kern-Flags

| Flag                          | Beschreibung                                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `-v, --version`               | Aktuelle Version ausgeben                                                                     |
| `-p, --prompt [text]`         | Einzelne Anweisung im Befehlsmodus ausführen                                                       |
| `--path <path>`               | Arbeitsbereichs-Stammverzeichnis überschreiben                                                                        |
| `--config <path>`             | Benutzerdefinierte Konfigurationsdatei verwenden                                                                         |
| `--model <model>`             | Modell überschreiben                                                                                 |
| `--temperature <n>`           | Sampling-Temperatur festlegen (0-1)                                                                  |
| `--thinking [level]`          | Thinking/Reasoning-Tiefe festlegen (none, normal, extended)                                          |
| `-y, --yes`                   | Eingabeaufforderungen automatisch bestätigen                                                                           |
| `--dry-run`                   | Vorschau ohne Ausführung                                                                      |
| `-d, --debug`                 | Ausführliche Debug-Ausgabe aktivieren                                                                    |
| `--bare`                      | Minimaler expliziter Modus; setzt außerdem `AUTOHAND_CODE_SIMPLE=1` und deaktiviert Slash-Befehle          |

### Berechtigungen & Sicherheit

| Flag                          | Beschreibung                                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `--unrestricted`              | Keine Genehmigungsaufforderungen                                                                            |
| `--restricted`                | Gefährliche Operationen ablehnen                                                                      |
| `--permissions`               | Aktuelle Berechtigungseinstellungen anzeigen und beenden                                                   |
| `--no-idle-logout`            | Authentifizierten Idle-Logout für langlaufende Agentensitzungen deaktivieren                              |
| `--yolo [pattern]`            | Tool-Aufrufe, die dem Muster entsprechen, automatisch genehmigen (z. B. `allow:read,write` oder `deny:delete`)           |
| `--timeout <seconds>`         | Timeout in Sekunden für den Auto-Genehmigungsmodus                                                       |

### Git & Worktree

| Flag                          | Beschreibung                                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `--worktree [name]`           | Sitzung in isoliertem Git-Worktree ausführen (optionaler Worktree-/Branch-Name)                           |
| `--tmux`                      | In dedizierter tmux-Sitzung starten (impliziert `--worktree`; kann nicht mit `--no-worktree` verwendet werden) |
| `--no-worktree`               | Git-Worktree-Isolierung im Auto-Modus deaktivieren                                                    |
| `-c, --auto-commit`           | Änderungen nach Abschluss der Aufgaben automatisch committen                                                     |
| `--patch`                     | Git-Patch generieren, ohne Änderungen anzuwenden                                                    |
| `--output <file>`             | Ausgabedatei für Patch (verwendet mit --patch)                                                      |

### Auto-Modus

| Flag                          | Beschreibung                                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `--auto-mode [prompt]`        | Interaktiven Auto-Modus aktivieren oder eigenständige Schleife mit Inline-Aufgabe starten                   |
| `--max-iterations <n>`        | Maximale Auto-Modus-Iterationen (Standard: 50)                                                         |
| `--completion-promise <text>` | Abschlussmarker-Text (Standard: "DONE")                                                       |
| `--checkpoint-interval <n>`   | Bei jeder N-ten Iteration committen (Standard: 5)                                                     |
| `--max-runtime <m>`           | Maximale Laufzeit in Minuten (Standard: 120)                                                          |
| `--max-cost <d>`              | Maximale API-Kosten in Dollar (Standard: 10)                                                          |
| `--interactive-on-complete`   | Nach Beenden des Auto-Modus direkt an den interaktiven Modus übergeben (nur TTY)                         |

### Skills & Lernen

| Flag                          | Beschreibung                                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `--auto-skill`                | Skills basierend auf Projektanalyse automatisch generieren (siehe auch `/learn` für interaktiven Berater)     |
| `--learn`                     | `/learn`-Skill-Berater nicht-interaktiv ausführen (empfohlene Skills analysieren und installieren)          |
| `--learn-update`              | Projekt erneut analysieren und veraltete LLM-generierte Skills nicht-interaktiv neu generieren              |
| `--skill-install [name]`      | Community-Skill installieren (öffnet Browser, wenn kein Name angegeben)                                  |
| `--project`                   | Skill auf Projektebene installieren (mit --skill-install)                                  |

### Authentifizierung & Konto

| Flag                          | Beschreibung                                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `--login`                     | Bei Ihrem Autohand-Konto anmelden                                                               |
| `--logout`                    | Von Ihrem Autohand-Konto abmelden                                                              |
| `--sync-settings`             | Einstellungssynchronisierung aktivieren/deaktivieren (Standard: true für angemeldete Benutzer)                                  |

### Einrichtung & Info

| Flag                          | Beschreibung                                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `--setup`                     | Einrichtungsassistenten ausführen, um Autohand zu konfigurieren oder neu zu konfigurieren                                      |
| `--about`                     | Informationen über Autohand anzeigen (Version, Links, Beitragsinfo)                            |
| `--feedback`                  | Feedback an das Autohand-Team senden                                                           |
| `--settings`                  | Autohand-Einstellungen konfigurieren (gleich wie `/settings` im interaktiven Modus)                          |

### Arbeitsbereich & Verzeichnisse

| Flag                          | Beschreibung                                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `--add-dir <path...>`         | Zusätzliche Verzeichnisse zum Arbeitsbereich hinzufügen (kann mehrmals verwendet werden)                     |

### Ausführungsmodi

| Flag                          | Beschreibung                                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `--mode <mode>`               | Ausführungsmodus: interactive (Standard), rpc, oder acp                                                   |
| `--acp`                       | Kurzform für --mode acp (Agent Client Protocol über stdio)                                    |
| `--teammate-mode <mode>`      | Team-Anzeigemodus: auto, in-process, oder tmux                                                   |

### UI & Sprache

| Flag                          | Beschreibung                                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `--display-language <locale>` | Anzeigesprache festlegen (z. B. en, id, zh-cn, fr, de, ja)                                         |
| `--search-engine <provider>`  | Web-Suchanbieter festlegen (google, brave, duckduckgo, parallel)                                  |
| `--cc, --context-compact`     | Kontextkomprimierung aktivieren (Standard: an)                                                        |
| `--no-cc, --no-context-compact` | Kontextkomprimierung deaktivieren                                                                    |

### Chrome-Integration

| Flag                          | Beschreibung                                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `--chrome`                    | Chrome-Browser-Integration aktivieren (gleich wie `/browser`)                                         |
| `--no-chrome`                 | Chrome-Browser-Integration deaktivieren                                                             |

### System-Prompt

| Flag                          | Beschreibung                                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `--sys-prompt <value>`        | Gesamten System-Prompt ersetzen (Inline-String oder Dateipfad)                                      |
| `--append-sys-prompt <value>` | An System-Prompt anhängen (Inline-String oder Dateipfad)                                           |
| `--system-prompt <value>`     | Gesamten System-Prompt ersetzen (Inline-String oder Dateipfad)                                      |
| `--system-prompt-file <path>` | Gesamten System-Prompt durch Dateiinhalte ersetzen                                                |
| `--append-system-prompt <value>` | An System-Prompt anhängen (Inline-String oder Dateipfad)                                        |
| `--append-system-prompt-file <path>` | Dateiinhalte an System-Prompt anhängen                                                  |
| `--mcp-config <path>`         | Explizite MCP-Konfigurationsdatei laden                                                               |
| `--agents <json\|path>`       | Explizite Inline-Agenten-JSON oder ein explizites Agentenverzeichnis laden                               |
| `--plugin-dir <path>`         | Explizites Plugin-/Meta-Tool-Verzeichnis laden                                                    |

### Experiment-Schalter-Befehle

| Befehl                               | Beschreibung                                      |
| ------------------------------------- | ------------------------------------------------ |
| `autohand experiments list`              | Lokale und entfernte Feature-IDs, Quelle, Lebenszyklusstadium und Status auflisten |
| `autohand experiments status <feature>`  | Einen Feature-Schalter, Konfigurationspfad oder Remote-Metadaten und Status anzeigen |
| `autohand experiments refresh`           | Entfernte Feature-Flags von der Autohand API herunterladen |
| `autohand experiments enable <feature>`  | Einen konfigurationsgestützten Feature-Schalter aktivieren            |
| `autohand experiments disable <feature>` | Einen konfigurationsgestützten Feature-Schalter deaktivieren           |

Entfernte Feature-Flags werden von `/v1/feature-flags/evaluate` abgerufen, in `~/.autohand/feature-flags.json` zwischengespeichert und nach Ablauf der von der API bereitgestellten TTL aktualisiert. Verwenden Sie `features.environment`, um eine entfernte Flag-Umgebung auszuwählen, und `features.remoteOverrides` für lokale Opt-outs von benutzerüberschreibbaren entfernten Flags.

`usage_v2` ist ein experimenteller Feature-Schalter für das `/usage`-Dashboard und die erweiterte Registerkarte `/status` Usage. Aktivieren Sie ihn mit `autohand experiments enable usage_v2`.

`token_usage_status` ist ein experimenteller Feature-Schalter (Konfigurationspfad `features.tokenUsageStatus`, standardmäßig aus), der die Echtzeit-Token-Nutzung in der Arbeitsstatuszeile anzeigt — kumulative Tokens hoch (`↑`) und runter (`↓`) plus Kontextfenster-Auslastung, z. B. `↑15.7k ↓3.2k · context: 6.0% (15.7k/262.1k)`. Das Kontextfenster wird pro Modell über alle Anbieter hinweg aufgelöst. Aktivieren Sie ihn mit `autohand experiments enable token_usage_status`.

---

## Slash-Befehle

Autohand bietet eine umfangreiche Reihe von Slash-Befehlen für die interaktive Nutzung. Tippen Sie `/` in der REPL, um Vorschläge zu sehen.

### Sitzungsverwaltung

| Befehl       | Beschreibung                                           |
| ------------- | ----------------------------------------------------- |
| `/quit`       | Aktuelle Sitzung beenden                              |
| `/exit`       | Aktuelle Sitzung beenden                              |
| `/new`        | Neue Konversation starten (mit Memory-Extraktion)     |
| `/clear`      | Konversation mit automatischer Memory-Extraktion löschen   |
| `/session`    | Aktuelle Sitzungsdetails anzeigen                          |
| `/sessions`   | Vergangene Sitzungen auflisten                                    |
| `/resume`     | Vorherige Sitzung fortsetzen                             |
| `/history`    | Sitzungsverlauf mit Paginierung durchsuchen                |
| `/undo`       | Git-Änderungen und letzten Turn rückgängig machen                      |
| `/export`     | Sitzung nach Markdown/JSON/HTML exportieren                  |
| `/share`      | Aktuelle Sitzung teilen                                 |
| `/status`     | Sitzungsstatus anzeigen                                   |
| `/usage`      | Modell, Anbieter, Kontext und Nutzungslimits anzeigen       |

### Modell & Anbieter

| Befehl       | Beschreibung                                           |
| ------------- | ----------------------------------------------------- |
| `/model`      | LLM-Modell wechseln oder konfigurieren                         |
| `/cc`         | Kontext manuell komprimieren                              |

### Projekt-Setup

| Befehl       | Beschreibung                                           |
| ------------- | ----------------------------------------------------- |
| `/init`       | `AGENTS.md`-Datei im aktuellen Verzeichnis erstellen          |
| `/setup`      | Einrichtungsassistenten ausführen, um Autohand zu konfigurieren            |
| `/add-dir`    | Verzeichnisse zum Arbeitsbereich hinzufügen                    |

### Agenten & Teams

| Befehl       | Beschreibung                                           |
| ------------- | ----------------------------------------------------- |
| `/agents`     | Verfügbare Sub-Agenten auflisten                             |
| `/agents-new` | Neuen Agenten über Assistenten erstellen                         |
| `/squad`      | Eigenständige Autohand Squad Runtime öffnen/verwalten     |
| `/team`       | Team für parallele Arbeit verwalten                         |
| `/tasks`      | Aufgaben im Team verwalten                                  |
| `/message`    | Nachricht an Teammitglied senden                              |

### Skills

| Befehl          | Beschreibung                                        |
| ---------------- | -------------------------------------------------- |
| `/skills`        | Skills auflisten und verwalten                             |
| `/skills-new`    | Neuen Skill erstellen                                   |
| `/learn`         | Empfohlene Skills lernen und installieren               |

### Memory & Einstellungen

| Befehl       | Beschreibung                                           |
| ------------- | ----------------------------------------------------- |
| `/memory`     | Gespeicherte Memories anzeigen und verwalten                       |
| `/settings`   | Autohand-Einstellungen konfigurieren                           |
| `/statusline` | Composer-Statuszeilenfelder konfigurieren                 |
| `/experiments` | Experimentelle Feature-Schalter umschalten                  |
| `/sync`       | Einstellungen über Geräte hinweg synchronisieren                          |
| `/import`     | Sitzungen, Einstellungen, MCP, Memory, Skills und Hooks von unterstützten Agenten importieren |

### Berechtigungen & Hooks

| Befehl       | Beschreibung                                           |
| ------------- | ----------------------------------------------------- |
| `/permissions`| Tool-Berechtigungen verwalten                               |
| `/hooks`      | Lifecycle-Hooks verwalten                                |

### Authentifizierung

| Befehl       | Beschreibung                                           |
| ------------- | ----------------------------------------------------- |
| `/login`      | Mit Autohand API authentifizieren                        |
| `/logout`     | Von Autohand-Konto abmelden                           |

### Tools & Dienstprogramme

| Befehl       | Beschreibung                                           |
| ------------- | ----------------------------------------------------- |
| `/search`     | Das Web durchsuchen                                        |
| `/formatters` | Verfügbare Code-Formatierer auflisten                        |
| `/lint`       | Verfügbare Code-Linter auflisten                          |
| `/completion` | Shell-Completion-Skripte generieren                     |
| `/plan`       | Implementierungsplan erstellen                            |
| `/review`     | Code-Review durchführen                            |
| `/pr-review`  | Einen Pull Request reviewen                                 |

### IDE-Integration

| Befehl       | Beschreibung                                           |
| ------------- | ----------------------------------------------------- |
| `/ide`        | Laufende IDEs erkennen und verbinden                    |

### MCP (Model Context Protocol)

| Befehl       | Beschreibung                                           |
| ------------- | ----------------------------------------------------- |
| `/mcp`        | Interaktiver MCP-Server-Manager                        |

### Automatisierung

| Befehl       | Beschreibung                                           |
| ------------- | ----------------------------------------------------- |
| `/automode`   | Autonomen Coding-Modus starten                          |
| `/repeat`     | Wiederkehrende Aufgaben planen                               |
| `/yolo`       | YOLO-Modus umschalten (Tools automatisch genehmigen)                 |

### Chrome-Integration

| Befehl       | Beschreibung                                           |
| ------------- | ----------------------------------------------------- |
| `/browser`    | Chrome-Browser-Integration aktivieren                     |

### UI & Anzeige

| Befehl       | Beschreibung                                           |
| ------------- | ----------------------------------------------------- |
| `/help`       | Verfügbare Slash-Befehle und Tipps anzeigen             |
| `/about`      | Informationen über Autohand anzeigen                       |
| `/theme`      | Farbschema ändern                                    |
| `/language`   | Anzeigesprache ändern                               |
| `/feedback`   | Feedback an das Autohand-Team senden                    |

---

## System-Prompt-Anpassung

Autohand ermöglicht es Ihnen, den vom KI-Agenten verwendeten System-Prompt anzupassen. Dies ist nützlich für spezialisierte Workflows, benutzerdefinierte Anweisungen oder die Integration mit anderen Systemen.

### CLI-Flags

| Flag                          | Beschreibung                                 |
| ----------------------------- | ------------------------------------------- |
| `--sys-prompt <value>`        | Gesamten System-Prompt ersetzen            |
| `--append-sys-prompt <value>` | Inhalt an den Standard-System-Prompt anhängen |

Beide Flags akzeptieren entweder:

- **Inline-String**: Direkter Textinhalt
- **Dateipfad**: Pfad zu einer Datei mit dem Prompt (automatisch erkannt)

### Dateipfad-Erkennung

Ein Wert wird als Dateipfad behandelt, wenn er:

- Mit `./`, `../`, `/`, oder `~/` beginnt
- Mit einem Windows-Laufwerksbuchstaben beginnt (z. B. `C:\`)
- Mit `.txt`, `.md`, oder `.prompt` endet
- Pfadtrennzeichen ohne Leerzeichen enthält

Andernfalls wird er als Inline-String behandelt.

### `--sys-prompt` (vollständiger Ersatz)

Wenn angegeben, **ersetzt dies vollständig** den Standard-System-Prompt. Der Agent lädt NICHT:

- Standard-Autohand-Anweisungen
- `AGENTS.md`-Projektanweisungen
- Benutzer-/Projekt-Memories
- Aktive Skills

```bash
# Inline-String
autohand --sys-prompt "You are a Python expert. Be concise." --prompt "Write hello world"

# Aus Datei
autohand --sys-prompt ./custom-prompt.txt --prompt "Explain this code"

# Home-Verzeichnis
autohand --sys-prompt ~/.autohand/prompts/python-expert.md --prompt "Debug this function"
```

**Beispiel für benutzerdefinierte Prompt-Datei (`custom-prompt.txt`):**

```
You are a specialized Python debugging assistant.

Rules:
- Focus only on Python code
- Always explain the root cause
- Suggest fixes with code examples
- Be concise and direct
```

### `--append-sys-prompt` (zum Standard hinzufügen)

Wenn angegeben, **hängt dies Inhalt an** den vollständigen Standard-System-Prompt an. Der Agent lädt weiterhin:

- Standard-Autohand-Anweisungen
- `AGENTS.md`-Projektanweisungen
- Benutzer-/Projekt-Memories
- Aktive Skills

Der angehängte Inhalt wird ganz am Ende hinzugefügt.

```bash
# Inline-String
autohand --append-sys-prompt "Always use TypeScript instead of JavaScript" --prompt "Create a function"

# Aus Datei
autohand --append-sys-prompt ./team-guidelines.md --prompt "Add error handling"
```

**Beispiel für Anhangsdatei (`team-guidelines.md`):**

```
## Team Guidelines

- Use 2-space indentation
- Prefer functional patterns
- Add JSDoc comments to public APIs
- Run tests before committing
```

### Priorität

Wenn beide Flags angegeben sind:

1. `--sys-prompt` hat volle Priorität
2. `--append-sys-prompt` wird ignoriert

```bash
# --append-sys-prompt wird in diesem Fall ignoriert
autohand --sys-prompt "Custom only" --append-sys-prompt "This is ignored"
```

### Anwendungsfälle

| Anwendungsfall                          | Empfohlenes Flag      |
| --------------------------------- | --------------------- |
| Benutzerdefinierte Agenten-Persona              | `--sys-prompt`        |
| Minimale Anweisungen              | `--sys-prompt`        |
| Team-Richtlinien hinzufügen               | `--append-sys-prompt` |
| Projekt-Konventionen hinzufügen           | `--append-sys-prompt` |
| Integration mit externen Systemen | `--sys-prompt`        |
| Spezialisiertes Debugging             | `--sys-prompt`        |

### Fehlerbehandlung

| Szenario          | Verhalten                 |
| ----------------- | ------------------------ |
| Leerer Wert       | Fehler                    |
| Datei nicht gefunden    | Wird als Inline-String behandelt |
| Leere Datei        | Fehler                    |
| Datei > 1MB        | Fehler                    |
| Berechtigung verweigert | Fehler                    |
| Verzeichnispfad    | Fehler                    |

### Beispiele

```bash
# Python-Expertenmodus
autohand --sys-prompt "You are a Python expert. Only write Python code." \
  --prompt "Create a web scraper"

# TypeScript-Durchsetzung
autohand --append-sys-prompt "Always use TypeScript, never JavaScript." \
  --prompt "Create a REST API"

# CI/CD-Integration (nicht-interaktiv)
autohand --sys-prompt ./ci-prompt.txt \
  --prompt "Fix the failing tests" \
  --unrestricted \
  --patch

# Benutzerdefinierter Team-Workflow
autohand --append-sys-prompt ~/.company/coding-standards.md \
  --prompt "Refactor this module"
```

---

## Multi-Directory-Unterstützung

Autohand kann mit mehreren Verzeichnissen über den Hauptarbeitsbereich hinaus arbeiten. Dies ist nützlich, wenn Ihr Projekt Abhängigkeiten, gemeinsame Bibliotheken oder verwandte Projekte in verschiedenen Verzeichnissen hat.

### CLI-Flag

Verwenden Sie `--add-dir`, um zusätzliche Verzeichnisse hinzuzufügen (kann mehrmals verwendet werden):

```bash
# Ein einzelnes zusätzliches Verzeichnis hinzufügen
autohand --add-dir /path/to/shared-lib

# Mehrere Verzeichnisse hinzufügen
autohand --add-dir /path/to/lib1 --add-dir /path/to/lib2

# Mit unrestricted-Modus (Schreibvorgänge in alle Verzeichnisse automatisch genehmigen)
autohand --add-dir /path/to/shared-lib --unrestricted
```

### Interaktiver Befehl

Verwenden Sie `/add-dir` während einer interaktiven Sitzung:

```
/add-dir              # Aktuelle Verzeichnisse anzeigen
/add-dir /path/to/dir # Neues Verzeichnis hinzufügen
```

### Sicherheitsbeschränkungen

Die folgenden Verzeichnisse können nicht hinzugefügt werden:

- Home-Verzeichnis (`~` oder `$HOME`)
- Stammverzeichnis (`/`)
- Systemverzeichnisse (`/etc`, `/var`, `/usr`, `/bin`, `/sbin`)
- Windows-Systemverzeichnisse (`C:\Windows`, `C:\Program Files`)
- Windows-Benutzerverzeichnisse (`C:\Users\username`)
- WSL-Windows-Mounts (`/mnt/c`, `/mnt/c/Windows`)
