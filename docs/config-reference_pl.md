# Autohand Informacje o konfiguracji

Pełne odniesienia do wszystkich opcji konfiguracyjnych w `~/.autohand/config.json` (lub `.toml`/`.yaml`/`.yml`).

> **Wskazówka:** większość poniższych ustawień można zmienić interaktywnie za pomocą polecenia `/settings` zamiast ręcznej edycji pliku.

Zlokalizowane odniesienia:

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

## Spis treści

- [Lokalizacja pliku konfiguracyjnego](#configuration-file-location)
- [Zmienne środowiskowe](#environment-variables)
- [Tryb goły](#bare-mode)
- [Ustawienia dostawcy](#provider-settings)
- [Ustawienia obszaru roboczego](#workspace-settings)
- [Ustawienia interfejsu użytkownika](#ui-settings)
- [Ustawienia agenta](#agent-settings)
- [Ustawienia uprawnień](#permissions-settings)
- [Tryb poprawki](#patch-mode)
- [Ustawienia sieciowe](#network-settings)
- [Ustawienia telemetrii](#telemetry-settings)
- [Agenci zewnętrzni](#external-agents)
- [System umiejętności](#skills-system)
- [Ustawienia API](#api-settings)
- [Ustawienia uwierzytelniania](#authentication-settings)
- [Ustawienia umiejętności społeczności](#community-skills-settings)
- [Ustawienia udostępniania](#share-settings)
- [Synchronizacja ustawień](#settings-sync)
- [Ustawienia haków](#hooks-settings)
- [Ustawienia MCP](#mcp-settings)
- [Ustawienia rozszerzenia Chrome](#chrome-extension-settings)
- [Kompletny przykład](#complete-example)

---

## Lokalizacja pliku konfiguracyjnego

Autohand szuka konfiguracji w następującej kolejności:

1. `AUTOHAND_CONFIG` zmienna środowiskowa (ścieżka niestandardowa)
2. __AH_KOD_6__
3. __AH_KOD_7__
4. __AH_KOD_8__
5. `~/.autohand/config.json` (domyślnie)

Możesz także zastąpić katalog podstawowy:
```bash
export AUTOHAND_HOME=/custom/path  # Changes ~/.autohand to /custom/path
```
---

## Zmienne środowiskowe

| Zmienna | Opis | Przykład |
| -------------------------------------- | ------------------------------------------------ | -------------------------------- |
| __AH_KOD_0__ | Katalog bazowy dla wszystkich danych Autohand | __AH_KOD_1__ |
| __AH_KOD_2__ | Niestandardowa ścieżka pliku konfiguracyjnego | __AH_KOD_3__ |
| __AH_KOD_4__ | Punkt końcowy API (zastępuje konfigurację) | __AH_KOD_5__ |
| __AH_KOD_6__ | Tajny klucz firmy/zespołu | __AH_KOD_7__ |
| __AH_KOD_8__ | Adres URL wywołania zwrotnego pozwolenia (eksperymentalny) | __AH_KOD_9__ |
| __AH_KOD_10__ | Limit czasu dla wywołania zwrotnego pozwolenia w ms | __AH_KOD_11__ |
| __AH_KOD_12__ | Uruchom w trybie nieinteraktywnym | __AH_KOD_13__ |
| __AH_KOD_14__ | Automatyczne potwierdzanie wszystkich monitów | __AH_KOD_15__ |
| __AH_KOD_16__ | Wyłącz baner startowy | __AH_KOD_17__ |
| __AH_KOD_18__ | Przesyłaj strumieniowo dane wyjściowe narzędzia w czasie rzeczywistym | __AH_KOD_19__ |
| __AH_KOD_20__ | Włącz rejestrowanie debugowania | __AH_KOD_21__ |
| __AH_KOD_22__ | Ustaw poziom głębi rozumowania | __AH_KOD_23__ |
| __AH_KOD_24__ | Identyfikator klienta/edytora (ustawiony przez rozszerzenia ACP) | __AH_KOD_25__ |
| __AH_KOD_26__ | Wersja klienta (ustawiana przez rozszerzenia ACP) | __AH_KOD_27__ |
| __AH_KOD_28__ | Flaga wykrycia środowiska (ustawiana automatycznie) | __AH_KOD_29__ |
| __AH_KOD_30__ | Włącz tryb pusty bez przekazywania `--bare` | __AH_KOD_32__ |

### Poziom myślenia

Zmienna środowiskowa `AUTOHAND_THINKING_LEVEL` kontroluje głębokość rozumowania wykorzystywanego przez model:

| Wartość | Opis |
| ---------- | ---------------------------------------------------------------------------------- |
| __AH_KOD_34__ | Bezpośrednie odpowiedzi bez widocznego uzasadnienia |
| __AH_KOD_35__ | Standardowa głębokość rozumowania (domyślna) |
| __AH_KOD_36__ | Głębokie rozumowanie w przypadku złożonych zadań pokazuje bardziej szczegółowy proces myślowy |

Jest to zwykle ustawiane przez rozszerzenia klienta ACP (takie jak Zed) za pomocą menu rozwijanego konfiguracji.
```bash
# Example: Use extended thinking for complex tasks
AUTOHAND_THINKING_LEVEL=extended autohand --prompt "refactor this module"
```
---

## Tryb goły

Tryb Bare uruchamia się Autohand tylko z jawnie żądaną integracją kontekstu i środowiska wykonawczego. Włącz to za pomocą:
```bash
autohand --bare
AUTOHAND_CODE_SIMPLE=1 autohand
```
Po przekazaniu `--bare` Autohand ustawia również `AUTOHAND_CODE_SIMPLE=1` dla działającego procesu.

Tryb nagi wyłącza automatyczne uruchamianie i interaktywne integracje:

- haki i powiadomienia o hakach
- Uruchomienie LSP
- synchronizacja wtyczek, automatyczne ładowanie wtyczek i automatyczne ładowanie metanarzędzi
- atrybucja, telemetria, synchronizacja sesji, automatyczne raportowanie i pingi w tle
- kontekst automatycznego ładowania pamięci/sesji
- sugestie podpowiedzi w tle, sprawdzanie aktualizacji, pobieranie flag funkcji i wstępne pobieranie metadanych modelu
- rezerwowe uwierzytelnianie OAuth w pęku kluczy i przeglądarce
- automatyczne wykrywanie `AGENTS.md` i instrukcji dostawcy
- wszystkie polecenia ukośnikowe, łącznie z pustym `/` wpisanym w wierszu zachęty

Bezwzględne ścieżki plików w kształcie ukośnika, takie jak `/Users/alex/project/file.ts`, są nadal traktowane jako zwykły tekst zachęty. Dane wejściowe w postaci ukośnika w kształcie polecenia, takie jak `/help`, `/model` lub `/mcp`, wypisują `Slash commands are disabled in bare mode.` i nie są wykonywane.

Uwierzytelnianie w trybie czystym jest wyłącznie jawne. Autohand czyta najpierw `AUTOHAND_API_KEY`, a następnie `auth.apiKeyHelper`, jeśli jest skonfigurowany. Nie odczytuje danych uwierzytelniających pęku kluczy ani nie rozpoczyna logowania OAuth/przeglądarki. Dostawcy zewnętrzni w dalszym ciągu korzystają ze swoich kluczy API i konfiguracji specyficznych dla dostawcy.

Te jawne dane wejściowe pozostają dostępne w trybie prostym:

| Wejście | Opis |
| ------------------------------ | ---------------------------------------------------------------------------------- |
| __AH_KOD_11__ | Zastąp monit systemowy tekstem wbudowanym lub wartością przypominającą ścieżkę |
| __AH_KOD_12__ | Zastąp monit systemowy zawartością pliku |
| __AH_KOD_13__ | Dołącz tekst osadzony lub wartość przypominającą ścieżkę do znaku zachęty |
| __AH_KOD_14__ | Dołącz zawartość pliku do zachęty systemowej |
| __AH_KOD_15__ | Dodaj jawne katalogi do zakresu obszaru roboczego |
| __AH_KOD_16__ | Załaduj jawny plik konfiguracyjny MCP |
| __AH_KOD_17__ | Otwórz ustawienia bezpośrednio z flagi CLI |
| __AH_KOD_18__ | Użyj jawnego pliku konfiguracyjnego Autohand |
| __AH_KOD_19__ | Załaduj jawnych agentów wbudowanych JSON lub katalog jawnych agentów |
| __AH_KOD_20__ | Załaduj jawny katalog wtyczek/meta-narzędzi |

---

## Ustawienia dostawcy

### `provider`

Aktywny dostawca LLM do użycia.

| Wartość | Opis |
| -------------- | ---------------------------- |
| __AH_KOD_22__ | Interfejs API OpenRouter (domyślny) |
| __AH_KOD_23__ | Lokalna instancja Ollama |
| __AH_KOD_24__ | Lokalny serwer lama.cpp |
| __AH_KOD_25__ | Bezpośrednio API OpenAI |
| __AH_KOD_26__ | MLX na Apple Silicon (lokalnie) |
| __AH_KOD_27__ | Ujednolicony interfejs API bramy LLM |
| __AH_KOD_28__ | API DeepSeek |
| __AH_KOD_29__ | Z.ai GLM API |
| __AH_KOD_30__ | Sakana.AI Fugu API |
| __AH_KOD_31__ | Podstawa AWS |
| __AH_KOD_32__ | Zdefiniowany przez użytkownika dostawca zgodny z OpenAI z `customProviders` |

### `openrouter`

Konfiguracja dostawcy OpenRouter.
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
| Pole | Wpisz | Wymagane | Domyślne | Opis |
| --------------- | ------ | -------- | ------------------------------ | --------------------------------------------------------------------- |
| __AH_KOD_0__ | ciąg | Tak | - | Twój klucz API OpenRouter |
| __AH_KOD_1__ | ciąg | Nie | __AH_KOD_2__ | Punkt końcowy API |
| __AH_KOD_3__ | ciąg | Tak | - | Identyfikator modelu (np. `your-modelcard-id-here`) |
| __AH_KOD_5__ | numer | Nie | Automat | Dokładne okno kontekstowe modelu. Autohand wypełnia to z OpenRouter, jeśli jest znane. |

### __AH_KOD_6__

Konfiguracja dostawcy Z.ai.
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
| Pole | Wpisz | Wymagane | Domyślne | Opis |
| --------------- | ------ | -------- | ------------------------------ | -------------------------------------------------------------------------------- |
| __AH_KOD_0__ | ciąg | Tak | - | Twój klucz API Z.ai |
| __AH_KOD_1__ | ciąg | Nie | __AH_KOD_2__ | Punkt końcowy API |
| __AH_KOD_3__ | ciąg | Tak | __AH_KOD_4__ | Identyfikator modelu, na przykład `glm-5.2`, `glm-5.1` lub `glm-4.5` |
| __AH_KOD_8__ | numer | Nie | Automat | Dokładne okno kontekstowe modelu. Autohand zakłada 1M dla GLM-5.2 i 200K dla GLM-5.1. |

### __AH_KOD_9__

Konfiguracja dostawcy Sakana.AI. Interfejs API jest kompatybilny z OpenAI i używa `https://api.sakana.ai/v1` jako podstawowego adresu URL.
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
| Pole | Wpisz | Wymagane | Domyślne | Opis |
| --------------- | ------ | -------- | ------------------------------ | ------------------------------------------------------------------ |
| __AH_KOD_0__ | ciąg | Tak | - | Twój klucz API Sakana |
| __AH_KOD_1__ | ciąg | Nie | __AH_KOD_2__ | Punkt końcowy API |
| __AH_KOD_3__ | ciąg | Tak | __AH_KOD_4__ | Identyfikator modelu, na przykład `fugu` lub `fugu-ultra` |
| __AH_KOD_7__ | numer | Nie | Automat | Dokładne okno kontekstowe modelu. Autohand zakłada 1M dla modeli Fugu.   |

### __AH_KOD_8__

Dostawcy niestandardowi umożliwiają użytkownikom korzystanie z punktu końcowego zgodnego z OpenAI bez zmiany kodu lub nowego dostawcy pakietu. Dodaj dostawcę w obszarze `customProviders`, a następnie wybierz go za pomocą `provider: "custom:<id>"`. Ten sam przepływ jest dostępny od `/model` z **Nowym dostawcą...**. Podczas konfiguracji Autohand weryfikuje podstawowy adres URL, uwierzytelnianie i wybrany model za pośrednictwem punktu końcowego `/models` zgodnego z OpenAI przed zapisaniem dostawcy.
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
W przypadku lokalnych serwerów zgodnych z OpenAI, które nie wymagają uwierzytelniania, ustaw `apiKeyRequired` na `false` i pomiń `apiKey`.

| Pole | Wpisz | Wymagane | Domyślne | Opis |
| ------------------ | -------- | -------- | -------- | ----------- |
| __AH_KOD_3__ | ciąg | Tak | - | Stabilny identyfikator dostawcy. Musi pasować do klucza obiektu i jest wybrany jako `custom:<id>`. |
| __AH_KOD_5__ | ciąg | Tak | - | Nazwa wyświetlana w `/model` i ustawieniach dostawcy. |
| __AH_KOD_7__ | ciąg | Tak | - | Musi być `openai-compatible`. |
| __AH_KOD_9__ | ciąg | Tak | - | Główny punkt końcowy, taki jak `https://api.example.com/v1`. Autohand weryfikuje `/models` i wywołuje `/chat/completions`. |
| __AH_KOD_13__ | ciąg | Warunkowe | - | Token nośnika dla hostowanych punktów końcowych. Wymagane, gdy `apiKeyRequired` ma wartość true. |
| __AH_KOD_15__ | wartość logiczna | Nie | __AH_KOD_16__ | Ustaw wartość false dla bram lokalnych lub już uwierzytelnionych. |
| __AH_KOD_17__ | ciąg | Tak | - | Aktywny identyfikator modelu. |
| __AH_KOD_18__ | numer | Nie | Automat | Dokładne okno kontekstowe do budżetowania tokenów, stanu, telemetrii i synchronizowania metadanych. |
| __AH_KOD_19__ | ciąg | Nie | - | Opcjonalnie `none`, `low`, `medium`, `high` lub `xhigh`. Wysyłane jako `reasoning_effort` w przypadku niestandardowych żądań zgodnych z OpenAI. |
| __AH_KOD_26__ | tablica | Nie | - | Opcjonalne wpisy selektora modelu z kontekstem dla każdego modelu i metadanymi rozumowania. |

### `ollama`

Konfiguracja dostawcy Ollama.
```json
{
  "ollama": {
    "baseUrl": "http://localhost:11434",
    "port": 11434,
    "model": "llama3.2"
  }
}
```
| Pole | Wpisz | Wymagane | Domyślne | Opis |
| --------- | ------ | -------- | ------------------------ | ------------------------------------------ |
| __AH_KOD_0__ | ciąg | Nie | __AH_KOD_1__ | Adres URL serwera Ollama |
| __AH_KOD_2__ | numer | Nie | __AH_KOD_3__ | Port serwera (alternatywa dla baseUrl) |
| __AH_KOD_4__ | ciąg | Tak | - | Nazwa modelu (np. `llama3.2`, `codellama`) |

### __AH_KOD_7__

Konfiguracja serwera llama.cpp.
```json
{
  "llamacpp": {
    "baseUrl": "http://localhost:8080",
    "port": 8080,
    "model": "default"
  }
}
```
| Pole | Wpisz | Wymagane | Domyślne | Opis |
| --------- | ------ | -------- | ------------------------ | ---------------------------------- |
| __AH_KOD_0__ | ciąg | Nie | __AH_KOD_1__ | Adres URL serwera llama.cpp |
| __AH_KOD_2__ | numer | Nie | __AH_KOD_3__ | Port serwera |
| __AH_KOD_4__ | ciąg | Tak | - | Identyfikator modelu |

### __AH_KOD_5__

Konfiguracja API OpenAI.
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
OpenAI może także korzystać z Twojej subskrypcji ChatGPT poprzez wbudowany proces logowania OpenAI Autohand:
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
| Pole | Wpisz | Wymagane | Domyślne | Opis |
| --------------- | ------ | -------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------- |
| __AH_KOD_0__ | ciąg | Nie | __AH_KOD_1__ | Tryb uwierzytelniania: `api-key` lub `chatgpt` |
| __AH_KOD_4__ | ciąg | Tak dla trybu `api-key` | - | Klucz API OpenAI |
| __AH_KOD_6__ | ciąg | Nie | __AH_KOD_7__ | Punkt końcowy API |
| __AH_KOD_8__ | ciąg | Tak | - | Nazwa modelu (np. `gpt-5.4`, `gpt-5.4-mini`) |
| __AH_KOD_11__ | numer | Nie | Automat | Dokładne okno kontekstowe modelu. Ustaw tę opcję, aby zastąpić nieaktualne założenia lokalne. |
| __AH_KOD_12__ | obiekt | Tak dla trybu `chatgpt` | - | Przechowywane tokeny autoryzacji ChatGPT/Codex i identyfikator konta |

### `mlx`

Dostawca MLX dla komputerów Mac Apple Silicon (wnioskowanie lokalne).
```json
{
  "mlx": {
    "baseUrl": "http://localhost:8080",
    "port": 8080,
    "model": "mlx-community/Llama-3.2-3B-Instruct-4bit"
  }
}
```
| Pole | Wpisz | Wymagane | Domyślne | Opis |
| --------- | ------ | -------- | ------------------------ | ---------------------------------- |
| __AH_KOD_0__ | ciąg | Nie | __AH_KOD_1__ | Adres URL serwera MLX |
| __AH_KOD_2__ | numer | Nie | __AH_KOD_3__ | Port serwera |
| __AH_KOD_4__ | ciąg | Tak | - | Identyfikator modelu MLX |

### __AH_KOD_5__

Ujednolicona konfiguracja API LLM Gateway. Zapewnia dostęp do wielu dostawców LLM za pośrednictwem jednego interfejsu API.
```json
{
  "llmgateway": {
    "apiKey": "your-llmgateway-api-key",
    "baseUrl": "https://api.llmgateway.io/v1",
    "model": "gpt-4o"
  }
}
```
| Pole | Wpisz | Wymagane | Domyślne | Opis |
| --------- | ------ | -------- | ------------------------------ | ------------------------------------------------------------------ |
| __AH_KOD_0__ | ciąg | Tak | - | Klucz API bramy LLM |
| __AH_KOD_1__ | ciąg | Nie | __AH_KOD_2__ | Punkt końcowy API |
| __AH_KOD_3__ | ciąg | Tak | - | Nazwa modelu (np. `gpt-4o`, `claude-3-5-sonnet-20241022`) |

**Uzyskiwanie klucza API:**
Odwiedź [llmgateway.io/dashboard](https://llmgateway.io/dashboard), aby utworzyć konto i uzyskać klucz API.

**Obsługiwane modele:**
LLM Gateway obsługuje modele od wielu dostawców, w tym:

- OpenAI: `gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo`
__AH_KOD_9__
- Google: `gemini-1.5-pro`, `gemini-1.5-flash`

### `deepseek`

Konfiguracja dostawcy DeepSeek. Interfejs API jest kompatybilny z OpenAI i używa `https://api.deepseek.com` jako podstawowego adresu URL.
```json
{
  "deepseek": {
    "apiKey": "your-deepseek-api-key",
    "baseUrl": "https://api.deepseek.com",
    "model": "deepseek-v4-flash"
  }
}
```
| Pole | Wpisz | Wymagane | Domyślne | Opis |
| --------- | ------ | -------- | ------------------------------------ | -------------------------------------------------------------- |
| __AH_KOD_0__ | ciąg | Tak | - | Klucz API DeepSeek |
| __AH_KOD_1__ | ciąg | Nie | __AH_KOD_2__ | Punkt końcowy API |
| __AH_KOD_3__ | ciąg | Tak | - | Nazwa modelu, na przykład `deepseek-v4-flash` lub `deepseek-v4-pro` |

### __AH_KOD_6__

Konfiguracja dostawcy AWS Bedrock. `converse` jest trybem domyślnym i korzysta z łańcucha danych uwierzytelniających AWS SDK. Tryby kompatybilne z OpenAI wykorzystują klucze Bedrock API i punkty końcowe kompatybilne z Bedrock OpenAI.
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
| Pole | Wpisz | Wymagane | Domyślne | Opis |
| ---------- | ------ | -------- | -------- | ----------- |
| __AH_KOD_0__ | ciąg | Tak | - | Identyfikator modelu skały macierzystej, identyfikator profilu wnioskowania lub ARN |
| __AH_KOD_1__ | ciąg | Tak | `AWS_REGION`, następnie `AWS_DEFAULT_REGION`, następnie `us-east-1` w konfiguracji | Region AWS |
| __AH_KOD_5__ | ciąg | Nie | __AH_KOD_6__ | `converse`, `openai-chat` lub `openai-responses` |
| __AH_KOD_10__ | ciąg | Nie | `aws-credentials` dla `converse`, `bedrock-api-key` dla trybów kompatybilnych z OpenAI | Tryb uwierzytelniania |
| __AH_KOD_14__ | ciąg | Nie | - | Opcjonalny profil AWS do uwierzytelniania za pomocą łańcucha danych |
| __AH_KOD_15__ | ciąg | Nie | Pochodzi z trybu i regionu | Niestandardowy/prywatny punkt końcowy Bedrock |
| __AH_KOD_16__ | ciąg | Tak dla trybów zgodnych z OpenAI | - | Klucz API Bedrock. Nie używaj kluczy OpenAI API. |

Uruchom `aws configure sso` lub ustaw `AWS_PROFILE=enterprise-prod autohand` dla uwierzytelniania AWS opartego na profilu. Rola IAM, kontener i poświadczenia metadanych instancji są obsługiwane przez pakiet AWS SDK. Włącz dostęp do modelu w konsoli AWS przed użyciem modelu.

---

## Ustawienia obszaru roboczego
```json
{
  "workspace": {
    "defaultRoot": "/path/to/projects",
    "allowDangerousOps": false
  }
}
```
| Pole | Wpisz | Domyślne | Opis |
| ------------------- | -------- | ------------------ | -------------------------------------------------- |
| __AH_KOD_0__ | ciąg | Aktualny katalog | Domyślny obszar roboczy, gdy nie określono żadnego |
| __AH_KOD_1__ | wartość logiczna | __AH_KOD_2__ | Zezwalaj na destrukcyjne operacje bez potwierdzenia |

### Bezpieczeństwo miejsca pracy

Autohand automatycznie blokuje działanie w niebezpiecznych katalogach, aby zapobiec przypadkowym uszkodzeniom:

- **Podstawy systemu plików** (`/`, `C:\`, `D:\` itd.)
- **Katalogi domowe** (`~`, `/Users/<user>`, `/home/<user>`, `C:\Users\<user>`)
- **Katalogi systemowe** (`/etc`, `/var`, `/System`, `C:\Windows` itd.)
- **WSL Mocowania Windows** (`/mnt/c`, `/mnt/c/Users/<user>`)

Tej kontroli nie da się ominąć. Jeśli spróbujesz uruchomić autohand w niebezpiecznym katalogu, zobaczysz błąd i będziesz musiał określić bezpieczny katalog projektu.
```bash
# This will be blocked
cd ~ && autohand
# Error: Unsafe Workspace Directory

# This works
cd ~/projects/my-app && autohand
```
Aby uzyskać szczegółowe informacje, zobacz [Bezpieczeństwo miejsca pracy](./workspace-safety.md).

---

## Ustawienia interfejsu użytkownika
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
| Pole | Wpisz | Domyślne | Opis |
| ---------------------------- | ------ | -------- | -------------------------------------------------------------------------------------------------------- |
| __AH_KOD_0__ | ciąg | __AH_KOD_1__ | Motyw kolorystyczny dla wyjścia terminala. Wbudowane funkcje obejmują `dark`, `light`, `dracula`, `sandy`, `tui`, `github-dark`, `cappadocia`, `rio` i `australia`. Starsze wartości `turkey` i `brazil` nadal są ładowane jako aliasy. |
| __AH_KOD_13__ | obiekt | __AH_KOD_14__ | Wbudowane niestandardowe definicje motywów oznaczone nazwą motywu. Ustaw `theme` na ten sam klucz, aby go użyć.   |
| __AH_KOD_16__ | wartość logiczna | __AH_KOD_17__ | Pomiń monity o potwierdzenie bezpiecznych operacji |
| __AH_KOD_18__ | numer | __AH_KOD_19__ | Maksymalna liczba znaków do wyświetlenia z wyników narzędzia odczytu/wyszukiwania (pełna treść jest nadal wysyłana do modelu) |
| __AH_KOD_20__ | wartość logiczna | __AH_KOD_21__ | Ukryj bloki wyjściowe narzędzia w terminalu, zachowując jednocześnie wyniki narzędzia dla modelu/sesji |
| __AH_KOD_22__ | ciąg lub ciąg [] | wbudowany basen | Niestandardowy czasownik działania lub pula czasowników dla wskaźnika roboczego, renderowana jako `Verb...` |
| __AH_KOD_24__ | wartość logiczna | __AH_KOD_25__ | Wyświetlaj rotacyjne czasowniki czynności, takie jak `Compiling...`, gdy agent pracuje |
| __AH_KOD_27__ | ciąg | __AH_KOD_28__ | Symbol pokazany przed czasownikiem aktywności na wyjściu wskaźnika aktywności |
| __AH_KOD_29__ | wartość logiczna | __AH_KOD_30__ | Pokaż aktywnego dostawcę i model w linii statusu kompozytora |
| __AH_KOD_31__ | wartość logiczna | __AH_KOD_32__ | Pokaż procent kontekstu w linii statusu kompozytora |
| __AH_KOD_33__ | wartość logiczna | __AH_KOD_34__ | Pokaż polecenia, wzmianki, umiejętności i wskazówki dotyczące wejścia do terminala w linii statusu kompozytora |
| __AH_KOD_35__ | wartość logiczna | __AH_KOD_36__ | Pokaż powiązany numer żądania ściągnięcia lub `PR #123`, jeśli nie powiązano żadnego PR |
| __AH_KOD_38__ | wartość logiczna | __AH_KOD_39__ | Pokaż linie dodane i usunięte podczas bieżącej sesji |
| __AH_KOD_40__ | wartość logiczna | __AH_KOD_41__ | Pokaż liczbę żądań oczekujących w kolejce w wierszu stanu |
| __AH_KOD_42__ | wartość logiczna | __AH_KOD_43__ | Pokaż tekst statusu aktywnej tury, gdy agent pracuje |
| __AH_KOD_44__ | wartość logiczna | __AH_KOD_45__ | Pokaż czas, który upłynął i metryki tokenów, gdy agent pracował |
| __AH_KOD_46__ | wartość logiczna | __AH_KOD_47__ | Pokaż wskazówkę dotyczącą anulowania Esc, gdy agent pracuje |
| __AH_KOD_48__ | wartość logiczna | __AH_KOD_49__ | Poproś modela o dołączenie zwięzłego raportu o ukończeniu po ukończonych turach akcji |
| __AH_KOD_50__ | wartość logiczna | __AH_KOD_51__ | Pokaż powiadomienie systemowe po zakończeniu zadania |
| __AH_KOD_52__ | wartość logiczna | __AH_KOD_53__ | Wyświetl rozumowanie/proces myślowy LLM |
| __AH_KOD_54__ | wartość logiczna | __AH_KOD_55__ | Zadzwoń dzwonkiem terminala po zakończeniu zadania (pokazuje plakietkę na karcie terminala/doku) |
| __AH_KOD_56__ | wartość logiczna | __AH_KOD_57__ | Sprawdź aktualizacje CLI podczas uruchamiania |
| __AH_KOD_58__ | numer | __AH_KOD_59__ | Godziny pomiędzy sprawdzaniem aktualizacji (wykorzystuje wyniki z pamięci podręcznej w określonym przedziale czasu) |

Motywy niestandardowe mogą zastąpić dowolny semantyczny token koloru. Brakujące tokeny są dziedziczone z ciemnego motywu:
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
Uwaga: `readFileCharLimit` i `silentToolOutput` wpływają tylko na wyświetlanie terminala. Pełna treść jest nadal wysyłana do modelu i przechowywana w komunikatach narzędzi.

Możesz przełączać ciche wyjście narzędzia bez edytowania pliku:
```bash
autohand config set silent_tool_output true
autohand config set silent_tool_output false
```
Możesz przełączać czasowniki czynności rotacyjnych bez edytowania pliku:
```bash
autohand config set verbs activity true
autohand config set verbs activity false
```
Dostosuj czasowniki w pliku konfiguracyjnym, jeśli chcesz mieć stałą etykietę statusu lub małą rotację specyficzną dla projektu:
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
`activityVerbs` akceptuje pojedynczy ciąg znaków lub niepustą tablicę ciągów. Kiedy `activityVerbsEnabled` ma wartość `false`, Autohand powraca do `Working...` zamiast zmieniać czasowniki niestandardowe lub wbudowane.

Możesz przełączać raporty ukończenia, w tym ustrukturyzowany monit `SITREP`, bez edytowania pliku:
```bash
autohand config set sitrep true
autohand config set sitrep false
```
### Dzwonek terminala

Gdy `terminalBell` jest włączone (domyślnie), Autohand dzwoni dzwonkiem terminala (`\x07`) po zakończeniu zadania. To wyzwala:

- **Znak na karcie terminala** - Pokazuje wizualny wskaźnik zakończenia pracy
- **Odbicie ikony Docka** - Przyciąga Twoją uwagę, gdy terminal jest w tle (macOS)
- **Dźwięk** - Jeśli w ustawieniach terminala włączone są dźwięki terminala

Ustawienia specyficzne dla terminala:

- **Terminal macOS**: Preferencje > Profile > Zaawansowane > Dzwonek (wizualny/dźwiękowy)
- **iTerm2**: Preferencje > Profile > Terminal > Powiadomienia
- **Terminal VS Code**: Ustawienia > Terminal > Zintegrowany: Włącz dzwonek

Aby wyłączyć:
```json
{
  "ui": {
    "terminalBell": false
  }
}
```
### Moduł renderujący atrament

Autohand domyślnie używa modułu renderującego Ink 7 + React 19 dla terminali interaktywnych. Starsze pole konfiguracyjne `ui.useInkRenderer` jest ignorowane, więc stare pliki konfiguracyjne nie mogą wymusić zwykłego kompozytora terminala. Atrament zapewnia:

- **Wyjście wolne od migotania**: Wszystkie aktualizacje interfejsu użytkownika są grupowane w ramach uzgadniania React
- **Funkcja kolejki roboczej**: Wpisz instrukcje, gdy agent pracuje
- **Lepsza obsługa danych wejściowych**: Brak konfliktów pomiędzy procedurami obsługi readline
- **Komponowany interfejs użytkownika**: Podstawa przyszłych zaawansowanych funkcji interfejsu użytkownika

Awaryjne przywracanie zgodności terminala:
```bash
AUTOHAND_LEGACY_UI=1 autohand
```
Uwaga: ta funkcja jest eksperymentalna i może mieć przypadki Edge. Domyślny interfejs użytkownika oparty na ora pozostaje stabilny i w pełni funkcjonalny.

### Sprawdź aktualizację

Gdy `checkForUpdates` jest włączone (domyślnie), Autohand sprawdza dostępność nowych wersji podczas uruchamiania:
```
> Autohand v0.6.8 (abc1234) ✓ Up to date
```
Jeśli dostępna jest aktualizacja:
```
> Autohand v0.6.7 (abc1234) ⬆ Update available: v0.6.8
  ↳ Run: curl -fsSL https://autohand.ai/install.sh | sh
```
Jak to działa:

— Pobiera najnowszą wersję z interfejsu API GitHub
- Wyniki pamięci podręcznej to `~/.autohand/version-check.json`
- Sprawdza tylko raz na `updateCheckInterval` godzin (domyślnie: 24)
- Brak blokowania: uruchamianie jest kontynuowane nawet w przypadku niepowodzenia kontroli

Aby wyłączyć:
```json
{
  "ui": {
    "checkForUpdates": false
  }
}
```
Lub poprzez zmienną środowiskową:
```bash
export AUTOHAND_SKIP_UPDATE_CHECK=1
```
---

## Ustawienia agenta

Kontroluj zachowanie agenta i limity iteracji.
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
| Pole | Wpisz | Domyślne | Opis |
| ---------------------------------- | -------- | -------- | ---------------------------------------------------------------------------------------- |
| __AH_KOD_0__ | numer | __AH_KOD_1__ | Maksymalna liczba iteracji narzędzia na żądanie użytkownika przed zatrzymaniem |
| __AH_KOD_2__ | wartość logiczna | __AH_KOD_3__ | Zezwalaj użytkownikom na wpisywanie i kolejkowanie żądań podczas pracy agenta |
| __AH_KOD_4__ | wartość logiczna | __AH_KOD_5__ | Buforuj lokalny wybór schematu narzędzia na obrót dla równoważnych danych wejściowych dotyczących wyboru narzędzia |
| __AH_KOD_6__ | wartość logiczna | __AH_KOD_7__ | Wyodrębniaj i zapisuj trwałe wspomnienia użytkowników/projektów po udanych interaktywnych turach |
| __AH_KOD_8__ | wartość logiczna | __AH_KOD_9__ | Wyloguj uwierzytelnione sesje interaktywne po upływie limitu czasu bezczynności |
| __AH_KOD_10__ | wartość logiczna | __AH_KOD_11__ | Włącz szczegółowe dane wyjściowe debugowania (loguje stan wewnętrzny agenta na stderr) |

### Wybór schematu narzędzia

Autohand nie wysyła każdego pełnego schematu narzędzia na każde żądanie LLM. Podpowiedź systemowa zawiera kompaktowy katalog możliwości narzędzi, a każde żądanie udostępnia tylko niewielki zestaw konkretnych schematów wybranych spośród:

- Podstawowe narzędzia do wykrywania, takie jak `tool_search`, `read_file`, `fff_find` i `fff_grep`
- Dopasowane narzędzia do edycji, weryfikacji, git, przeglądarki, sieci, zależności lub śledzenia projektów
- Narzędzia wymagane w ramach ostatnich wywołań `tool_search` lub wyraźnie wymienione z nazwy

Pozwala to uniknąć dużych początkowych kosztów związanych z wysyłaniem wszystkich schematów narzędzi, zanim znane będą intencje użytkownika. `toolSelectionCache` kontroluje tylko lokalną pamięć podręczną selektora dla równoważnych obrotów; nie wykonuje rozgrzewki LLM przed użytkownikiem i nie wymusza dużego prefiksu monitu w pamięci podręcznej.

Aby wyłączyć lokalną pamięć podręczną selektora:
```json
{
  "agent": {
    "toolSelectionCache": false
  }
}
```
Aby utrzymać uwierzytelnione, długotrwałe sesje agentów podczas oczekiwania na pracę:
```json
{
  "agent": {
    "idleLogoutEnabled": false
  }
}
```
Dla pojedynczego procesu użyj `autohand --no-idle-logout` lub ustaw `AUTOHAND_NO_IDLE_LOGOUT=1`.

### Tryb debugowania

Włącz tryb debugowania, aby wyświetlić szczegółowe rejestrowanie wewnętrznego stanu agenta (iteracje pętli reakcji, budowanie podpowiedzi, szczegóły sesji). Dane wyjściowe trafiają na stderr, aby uniknąć zakłócania normalnego wyjścia.

Trzy sposoby włączania trybu debugowania (w kolejności ważności):

1. **Flaga CLI**: `autohand -d` lub `autohand --debug`
2. **Zmienna środowiskowa**: `AUTOHAND_DEBUG=1`
3. **Plik konfiguracyjny**: Ustaw `agent.debug: true`

### Kolejka żądań

Po włączeniu `enableRequestQueue` możesz kontynuować wpisywanie wiadomości, podczas gdy agent przetwarza poprzednie żądanie. Twoje dane wejściowe zostaną umieszczone w kolejce i przetworzone automatycznie po zakończeniu bieżącego zadania.

- Wpisz wiadomość i naciśnij klawisz Enter, aby dodać ją do kolejki
- Linia stanu pokazuje, ile żądań znajduje się w kolejce
- Żądania przetwarzane są w kolejności FIFO (pierwsze weszło, pierwsze wyszło).
- Maksymalny rozmiar kolejki to 10 żądań

---

## Ustawienia uprawnień

Szczegółowa kontrola nad uprawnieniami narzędzi.
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

| Wartość | Opis |
| ---------------- | -------------------------------------- |
| __AH_KOD_1__ | Monituj o zatwierdzenie niebezpiecznych operacji (domyślnie) |
| __AH_KOD_2__ | Brak podpowiedzi, zezwól na wszystko |
| __AH_KOD_3__ | Odmów wszystkim niebezpiecznym operacjom |

### __AH_KOD_4__

Szereg wzorów narzędzi, które nigdy nie wymagają zatwierdzenia.
```json
["run_command:npm *", "run_command:bun test"]
```
### `blacklist`

Tablica wzorów narzędzi, które są zawsze zablokowane.
```json
["run_command:rm -rf /", "run_command:sudo *"]
```
### `rules`

Szczegółowe zasady uprawnień.

| Pole | Wpisz | Opis |
| --------- | --------- | ------------------------------------------- | ---------- | -------------- |
| __AH_KOD_1__ | ciąg | Nazwa narzędzia pasująca |
| __AH_KOD_2__ | ciąg | Opcjonalny wzorzec dopasowywania do argumentów |
| __AH_KOD_3__ | __AH_KOD_4__ | __AH_KOD_5__ | __AH_KOD_6__ | Działania, które należy podjąć |

### __AH_KOD_7__

| Wpisz | Domyślne | Opis |
| -------- | -------- | ------------------------------------------- |
| wartość logiczna | __AH_KOD_8__ | Zapamiętaj decyzje zatwierdzające sesję |

### Lokalne uprawnienia projektu

Każdy projekt może mieć własne ustawienia uprawnień, które zastępują konfigurację globalną. Są one przechowywane w `.autohand/settings.local.json` w katalogu głównym projektu.

Kiedy zatwierdzisz operację na pliku (edycję, zapis, usunięcie), zostanie ona automatycznie zapisana w tym pliku, więc nie będziesz ponownie pytany o tę samą operację w tym projekcie.
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
**Jak to działa:**

- Po zatwierdzeniu operacji jest ona zapisywana w `.autohand/settings.local.json`
- Następnym razem ta sama operacja zostanie automatycznie zatwierdzona
- Lokalne ustawienia projektu są łączone z ustawieniami globalnymi (lokalne mają pierwszeństwo)
- Dodaj `.autohand/settings.local.json` do `.gitignore`, aby zachować prywatność ustawień osobistych

**Format wzoru:**

- `tool_name:path` - Do operacji na plikach (np. `apply_patch:src/file.ts`)
- `tool_name:command args` - Dla poleceń (np. `run_command:npm test`)

### Wyświetlanie uprawnień

Możesz wyświetlić swoje bieżące ustawienia uprawnień na dwa sposoby:

**Flaga CLI (nieinteraktywna):**
```bash
autohand --permissions
```
Wyświetla się:

- Aktualny tryb uprawnień (interaktywny, nieograniczony, ograniczony)
- Ścieżki plików roboczych i konfiguracyjnych
- Wszystkie zatwierdzone wzorce (biała lista)
- Wszystkie odrzucone wzorce (czarna lista)
- Statystyki podsumowujące

**Interaktywne polecenie:**
```
/permissions
```
W trybie interaktywnym komenda `/permissions` udostępnia te same informacje oraz opcje umożliwiające:

- Usuń elementy z białej listy
- Usuń elementy z czarnej listy
- Wyczyść wszystkie zapisane uprawnienia

---

## Tryb poprawki

Tryb łatek umożliwia wygenerowanie udostępnianej łatki kompatybilnej z git bez modyfikowania plików obszaru roboczego. Jest to przydatne dla:

- Przegląd kodu przed zastosowaniem zmian
- Udostępnianie zmian wygenerowanych przez sztuczną inteligencję członkom zespołu
- Tworzenie powtarzalnych zestawów zmian
- Potoki CI/CD, które muszą wychwytywać zmiany bez ich stosowania

### Użycie
```bash
# Generate patch to stdout
autohand --prompt "add user authentication" --patch

# Save to file
autohand --prompt "add user authentication" --patch --output auth.patch

# Pipe to file (alternative)
autohand --prompt "refactor api handlers" --patch > refactor.patch
```
### Zachowanie

Gdy określono `--patch`:

- **Automatyczne potwierdzenie**: Wszystkie potwierdzenia są akceptowane automatycznie (dorozumiany `--yes`)
- **Brak monitów**: nie są wyświetlane żadne monity o zatwierdzenie (dorozumiany `--unrestricted`)
- **Tylko podgląd**: Zmiany są przechwytywane, ale NIE zapisywane na dysku
- **Wymuszone bezpieczeństwo**: Operacje na czarnej liście (`.env`, klucze SSH, niebezpieczne polecenia) są nadal blokowane

### Stosowanie poprawek

Odbiorcy mogą zastosować łatkę za pomocą standardowych poleceń git:
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
### Format poprawki

Wygenerowana łatka jest zgodna z ujednoliconym formatem różnic gita:
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
### Kody wyjścia

| Kod | Znaczenie |
| ---- | --------------------------------------------------- |
| __AH_KOD_0__ | Sukces, wygenerowano łatkę |
| __AH_KOD_1__ | Błąd (brak `--prompt`, odmowa pozwolenia itp.) |

### Łączenie z innymi flagami
```bash
# Use specific model
autohand --prompt "optimize queries" --patch --model gpt-4o

# Specify workspace
autohand --prompt "add tests" --patch --path ./my-project

# Use custom config
autohand --prompt "refactor" --patch --config ~/.autohand/work.json
```
### Przykład przepływu pracy zespołu
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

## Ustawienia sieciowe
```json
{
  "network": {
    "maxRetries": 3,
    "timeout": 30000,
    "retryDelay": 1000
  }
}
```
| Pole | Wpisz | Domyślne | Maks | Opis |
| ------------ | ------ | -------- | --- | -------------------------------------- |
| __AH_KOD_0__ | numer | __AH_KOD_1__ | __AH_KOD_2__ | Ponów próbę w przypadku nieudanych żądań API |
| __AH_KOD_3__ | numer | __AH_KOD_4__ | - | Limit czasu żądania w milisekundach |
| __AH_KOD_5__ | numer | __AH_KOD_6__ | - | Opóźnienie między ponownymi próbami w milisekundach |

---

## Ustawienia telemetrii

Telemetria jest **domyślnie wyłączona** (opcja). Włącz ją, aby pomóc ulepszyć Autohand.
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
| Pole | Wpisz | Domyślne | Opis |
| ------------------- | -------- | ----------------------------------- | ---------------------------------------- |
| __AH_KOD_0__ | wartość logiczna | __AH_KOD_1__ | Włącz/wyłącz telemetrię (opcja) |
| __AH_KOD_2__ | ciąg | __AH_KOD_3__ | Punkt końcowy interfejsu API telemetrii |
| __AH_KOD_4__ | numer | __AH_KOD_5__ | Liczba zdarzeń do partii przed automatycznym płukaniem |
| __AH_KOD_6__ | numer | __AH_KOD_7__ | Interwał spłukiwania w milisekundach (1 minuta) |
| __AH_KOD_8__ | numer | __AH_KOD_9__ | Maksymalny rozmiar kolejki przed usunięciem starych wydarzeń |
| __AH_KOD_10__ | numer | __AH_KOD_11__ | Ponów próbę w przypadku nieudanych żądań telemetrycznych |
| __AH_KOD_12__ | wartość logiczna | __AH_KOD_13__ | Synchronizuj sesje z chmurą dla funkcji zespołu, gdy włączona jest telemetria |
| __AH_KOD_14__ | ciąg | __AH_KOD_15__ | Tajemnica firmowa dotycząca uwierzytelniania API |

Dane telemetryczne dostawcy/modelu obejmują identyfikator aktywnego dostawcy, identyfikator modelu i dostępne nietajne metadane, takie jak niestandardowa nazwa wyświetlana dostawcy, format interfejsu API, wysiłek wnioskowania i okno kontekstu. Klucze API i tokeny okaziciela nigdy nie są uwzględniane.

---

## Agenci zewnętrzni

Załaduj niestandardowe definicje agentów z katalogów zewnętrznych.
```json
{
  "externalAgents": {
    "enabled": true,
    "paths": ["~/.autohand/agents", "/team/shared/agents"]
  }
}
```
| Pole | Wpisz | Domyślne | Opis |
| --------- | -------- | -------- | ---------------------------------------- |
| __AH_KOD_0__ | wartość logiczna | __AH_KOD_1__ | Włącz ładowanie agenta zewnętrznego |
| __AH_KOD_2__ | ciąg[] | __AH_KOD_3__ | Katalogi do ładowania agentów z |

---

## System umiejętności

Umiejętności to pakiety instrukcji zawierające specjalistyczne instrukcje dla agenta AI. Działają jak pliki `AGENTS.md` na żądanie, które można aktywować do określonych zadań.

### Lokalizacje odkrywania umiejętności

Umiejętności są odkrywane w wielu miejscach, przy czym pierwszeństwo mają późniejsze źródła:

| Lokalizacja | Identyfikator źródła | Opis |
| ---------------------------------------- | ------------------ | ----------------------------------------- |
| __AH_KOD_5__ | __AH_KOD_6__ | Umiejętności Kodeksu na poziomie użytkownika (rekurencyjne) |
| __AH_KOD_7__ | __AH_KOD_8__ | Umiejętności Claude na poziomie użytkownika (jeden poziom) |
| __AH_KOD_9__ | __AH_KOD_10__ | Umiejętności Autohand na poziomie użytkownika (rekurencyjne) |
| __AH_KOD_11__ | __AH_KOD_12__ | Umiejętności Claude na poziomie projektu (jeden poziom) |
| __AH_KOD_13__ | __AH_KOD_14__ | Umiejętności Autohand na poziomie projektu (rekurencyjne) |

### Zachowanie automatycznego kopiowania

Umiejętności odkryte w lokalizacjach Codex lub Claude są automatycznie kopiowane do odpowiedniej lokalizacji Autohand:

- `~/.codex/skills/` i `~/.claude/skills/` → `~/.autohand/skills/`
- `<project>/.claude/skills/` → `<project>/.autohand/skills/`

Istniejące umiejętności w lokalizacjach Autohand nigdy nie są nadpisywane.

### SKILL.md Format

Umiejętności wykorzystują frontmaterię YAML, po której następuje treść przeceny:
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
| Pole | Wymagane | Maksymalna długość | Opis |
| --------------- | -------- | ---------- | ------------------------------------------ |
| __AH_KOD_0__ | Tak | 64 znaki | Małe litery alfanumeryczne, tylko z łącznikami |
| __AH_KOD_1__ | Tak | 1024 znaki | Krótki opis umiejętności |
| __AH_KOD_2__ | Nie | - | Identyfikator licencji (np. MIT, Apache-2.0) |
| __AH_KOD_3__ | Nie | 500 znaków | Uwagi dotyczące zgodności |
| __AH_KOD_4__ | Nie | - | Rozdzielana spacjami lista dozwolonych narzędzi |
| __AH_KOD_5__ | Nie | - | Dodatkowe metadane typu klucz-wartość |

### Przedrostki wejściowe

Autohand obsługuje specjalne przedrostki w wierszu poleceń:

| Przedrostek | Opis | Przykład |
| ------ | ------------------------------ | ---------------------------------- |
| __AH_KOD_6__ | Polecenia z ukośnikiem | `/help`, `/model`, `/quit`, `/exit` |
| __AH_KOD_11__ | Wzmianki o plikach (autouzupełnianie) | __AH_KOD_12__ |
| __AH_KOD_13__ | Wzmianki o umiejętnościach (autouzupełnianie) | `$frontend-design`, `$code-review` |
| __AH_KOD_16__ | Uruchom bezpośrednio polecenia terminala | `! git status`, `! ls -la` |

**Wzmianki o umiejętnościach (`$`):**

- Wpisz `$`, a następnie znaki, aby wyświetlić dostępne umiejętności z funkcją autouzupełniania
- Zakładka akceptuje górną sugestię (np. `$frontend-design`)
- Umiejętności są odkrywane z `~/.autohand/skills/` i `<project>/.autohand/skills/`
- Aktywowane umiejętności są dołączone do podpowiedzi jako specjalne instrukcje dla bieżącej sesji
- Panel podglądu pokazuje metadane umiejętności (nazwa, opis, stan aktywacji)

**Polecenia powłoki (`!`):**

- Polecenia uruchamiane są w bieżącym katalogu roboczym
- Dane wyjściowe są wyświetlane bezpośrednio w terminalu
- Nie idzie do LLM
- 30 sekund przerwy
- Powraca do monitu po wykonaniu

### Polecenia z ukośnikiem

#### `/skills` – Menedżer pakietów

| Polecenie | Opis |
| ---------------------------------------- | ------------------------------------------ |
| __AH_KOD_26__ | Lista wszystkich dostępnych umiejętności |
| __AH_KOD_27__ | Aktywuj umiejętność na bieżącą sesję |
| __AH_KOD_28__ | Dezaktywuj umiejętność |
| __AH_KOD_29__ | Pokaż szczegółowe informacje o umiejętnościach |
| __AH_KOD_30__ | Przeglądaj i instaluj z rejestru społeczności |
| __AH_KOD_31__ | Zainstaluj umiejętność społeczności według ślimaka |
| __AH_KOD_32__ | Przeszukaj rejestr umiejętności społeczności |
| __AH_KOD_33__ | Pokaż popularne umiejętności społeczności |
| __AH_KOD_34__ | Odinstaluj umiejętność społeczności |
| __AH_KOD_35__ | Utwórz nową umiejętność interaktywnie |
| __AH_KOD_36__ | Oceń umiejętność społeczności |

#### `/learn` — Doradca ds. umiejętności oparty na LLM

| Polecenie | Opis |
| --------------- | ---------------------------------------------------------------- |
| __AH_KOD_38__ | Przeanalizuj projekt i zarekomenduj umiejętności (szybki skan) |
| __AH_KOD_39__ | Dogłębne skanowanie projektu (odczytuje pliki źródłowe) w celu uzyskania bardziej ukierunkowanych wyników |
| __AH_KOD_40__ | Ponowna analiza projektu i regeneracja przestarzałych umiejętności wygenerowanych w ramach LLM |

`/learn` wykorzystuje dwufazowy przepływ LLM:

1. **Faza 1 — Analiza + Ranga + Audyt**: Skanuje strukturę projektu, sprawdza zainstalowane umiejętności pod kątem nadmiarowości/konfliktów i klasyfikuje umiejętności społeczności według trafności (0-100).
2. **Faza 2 – Generowanie** (warunkowo): Jeśli żadna umiejętność społeczności nie osiągnie wyniku powyżej 60, zaoferuje wygenerowanie niestandardowej umiejętności dostosowanej do Twojego projektu.
Wygenerowane umiejętności obejmują metadane (`agentskill-source: llm-generated`, `agentskill-project-hash`), dzięki czemu `/learn update` może wykryć zmiany w kodzie i zregenerować nieaktualne umiejętności.

### Generowanie umiejętności automatycznych (`--auto-skill`)

Flaga `--auto-skill` CLI generuje umiejętności bez przepływu interaktywnego doradcy:
```bash
autohand --auto-skill
```
To będzie:

1. Przeanalizuj strukturę swojego projektu (pakiet.json, wymagania.txt itp.)
2. Wykrywaj języki, struktury i wzorce
3. Wygeneruj 3 odpowiednie umiejętności, korzystając z LLM
4. Zapisz umiejętności w `<project>/.autohand/skills/`

Aby uzyskać bardziej ukierunkowane, interaktywne wrażenia, zamiast tego użyj `/learn` w sesji.

Wykryte wzorce obejmują:

- **Języki**: TypeScript, JavaScript, Python, Rust, Go
- **Frameworks**: React, Next.js, Vue, Express, Flask, Django
- **Wzorce**: narzędzia CLI, testowanie, monorepo, Docker, CI/CD

---

## Ustawienia API

Konfiguracja interfejsu API zaplecza dla funkcji zespołu.
```json
{
  "api": {
    "baseUrl": "https://api.autohand.ai",
    "companySecret": "sk-team-xxx"
  }
}
```
| Pole | Wpisz | Domyślne | Opis |
| --------------- | ------ | ----------------------------------- | ---------------------------------------- |
| __AH_KOD_0__ | ciąg | __AH_KOD_1__ | Punkt końcowy API |
| __AH_KOD_2__ | ciąg | - | Sekret zespołu/firmy dotyczący funkcji współdzielonych |

Można również ustawić za pomocą zmiennych środowiskowych:

- `AUTOHAND_API_URL` → `api.baseUrl`
- `AUTOHAND_SECRET` → `api.companySecret`

---

## Ustawienia uwierzytelniania

Uwierzytelnianie i konfiguracja sesji użytkownika.
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
| Pole | Wpisz | Domyślne | Opis |
| --------- | ------ | -------- | -------------------------------------------- |
| __AH_KOD_0__ | ciąg | - | Token uwierzytelniający dla dostępu API |
| __AH_KOD_1__ | obiekt | - | Uwierzytelnione informacje o użytkowniku |
| __AH_KOD_2__ | ciąg | - | Identyfikator użytkownika |
| __AH_KOD_3__ | ciąg | - | Adres e-mail użytkownika |
| __AH_KOD_4__ | ciąg | - | Wyświetlana nazwa użytkownika |
| __AH_KOD_5__ | ciąg | - | Adres URL awatara użytkownika (opcjonalnie) |
| __AH_KOD_6__ | ciąg | - | Znacznik czasu ważności tokena (format ISO 8601) |

---

## Ustawienia umiejętności społeczności

Konfiguracja wykrywania i zarządzania umiejętnościami społeczności.
```json
{
  "communitySkills": {
    "enabled": true,
    "showSuggestionsOnStartup": true,
    "autoBackup": true
  }
}
```
| Pole | Wpisz | Domyślne | Opis |
| ------------------------------------ | -------- | -------- | -------------------------------------------------------- |
| __AH_KOD_0__ | wartość logiczna | __AH_KOD_1__ | Włącz funkcje umiejętności społeczności |
| __AH_KOD_2__ | wartość logiczna | __AH_KOD_3__ | Pokaż sugestie dotyczące umiejętności przy uruchomieniu, gdy nie istnieją żadne umiejętności dostawcy |
| __AH_KOD_4__ | wartość logiczna | __AH_KOD_5__ | Automatycznie twórz kopie zapasowe odkrytych umiejętności dostawców w API |

---

## Ustawienia udostępniania

Konfiguracja udostępniania sesji za pomocą polecenia `/share`. Sesje są hostowane pod adresem [autohand.link](https://autohand.link).
```json
{
  "share": {
    "enabled": true
  }
}
```
| Pole | Wpisz | Domyślne | Opis |
| --------- | -------- | -------- | ----------------------------------- |
| __AH_KOD_0__ | wartość logiczna | __AH_KOD_1__ | Włącz/wyłącz polecenie `/share` |

### Format YAML
```yaml
share:
  enabled: true
```
### Wyłączanie udostępniania sesji

Jeśli chcesz wyłączyć udostępnianie sesji ze względów bezpieczeństwa lub prywatności:
```json
{
  "share": {
    "enabled": false
  }
}
```
Gdy wyłączone, uruchomienie `/share` wyświetli:
```
Session sharing is disabled.
To enable, set share.enabled: true in your config file.
```
---

## Synchronizacja ustawień

Autohand może zsynchronizować Twoją konfigurację na różnych urządzeniach dla zalogowanych użytkowników. Ustawienia są bezpiecznie przechowywane w Cloudflare R2 i szyfrowane przed przesłaniem.
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
| Pole | Wpisz | Domyślne | Opis |
| ------------------ | -------- | --------------- | -------------------------------------------------- |
| __AH_KOD_0__ | wartość logiczna | `true` (zalogowany) | Włącz/wyłącz synchronizację ustawień |
| __AH_KOD_2__ | numer | __AH_KOD_3__ | Interwał synchronizacji w milisekundach (domyślnie: 5 minut) |
| __AH_KOD_4__ | ciąg[] | __AH_KOD_5__ | Wzory globalne do wykluczenia z synchronizacji |
| __AH_KOD_6__ | wartość logiczna | __AH_KOD_7__ | Synchronizuj dane telemetryczne (wymaga zgody użytkownika) |
| __AH_KOD_8__ | wartość logiczna | __AH_KOD_9__ | Synchronizuj dane zwrotne (wymaga zgody użytkownika) |

### Flaga CLI
```bash
# Disable sync for this session
autohand --sync-settings=false

# Enable sync (default for logged users)
autohand --sync-settings
```
### Co jest synchronizowane

Domyślnie te elementy są synchronizowane dla zalogowanych użytkowników:

- **Konfiguracja** (`config.json`) – klucze API są szyfrowane przed przesłaniem
- **Agenci celni** (`agents/`)
- **Umiejętności społecznościowe** (`community-skills/`)
- **Haki użytkownika** (`hooks/`)
- **Pamięć** (`memory/`)
- **Wiedza projektowa** (`projects/`)
- **Historia sesji** (`sessions/`)
- **Udostępniona treść** (`share/`)
- **Umiejętności niestandardowe** (`skills/`)

### Czego nie synchronizuje się (domyślnie)

- **Identyfikator urządzenia** (`device-id`) - Unikalny dla każdego urządzenia
- **Dzienniki błędów** (`error.log`) - Tylko lokalnie
- **Pamięć podręczna wersji** (`version-*.json`) - Pliki lokalnej pamięci podręcznej

### Synchronizacja oparta na zgodzie

Te elementy wymagają wyraźnej zgody w konfiguracji:

- **Dane telemetryczne** - Ustaw `sync.includeTelemetry: true` na synchronizację
- **Dane zwrotne** - Ustaw `sync.includeFeedback: true` na synchronizację
```json
{
  "sync": {
    "enabled": true,
    "includeTelemetry": true,
    "includeFeedback": true
  }
}
```
### Rozwiązywanie konfliktów

W przypadku wystąpienia konfliktów (ten sam plik zmodyfikowany na wielu urządzeniach) **wersja w chmurze wygrywa**. Zapewnia to spójność podczas logowania na nowych urządzeniach.

### Bezpieczeństwo

Klucze API i inne wrażliwe dane w `config.json` są szyfrowane przy użyciu Twojego tokena uwierzytelniającego przed przesłaniem. Można je odszyfrować jedynie za pomocą danych uwierzytelniających.

**Co jest zaszyfrowane:**

- Pola o nazwach `apiKey`
- Pola kończące się na `Key`, `Token`, `Secret`
- Pole `password`

### Jak to działa

1. **Przy uruchomieniu**: Jeśli jesteś zalogowany, usługa synchronizacji uruchomi się automatycznie
2. **Co 5 minut**: Ustawienia są porównywane z danymi przechowywanymi w chmurze
3. **Chmura wygrywa**: Najpierw pobierane są zmiany zdalne
4. **Przesłanie lokalne**: Przesyłane są nowe zmiany lokalne
5. **Przy wyjściu**: Usługa synchronizacji zatrzymuje się płynnie

### Wykluczanie plików

Możesz wykluczyć określone pliki lub wzorce z synchronizacji:
```json
{
  "sync": {
    "enabled": true,
    "exclude": ["custom-local-config.json", "temp/*"]
  }
}
```
### Format YAML
```yaml
sync:
  enabled: true
  interval: 300000
  exclude: []
  includeTelemetry: false
  includeFeedback: false
```
---

## Ustawienia MCP

Skonfiguruj serwery MCP (Model Context Protocol), aby rozszerzyć Autohand za pomocą narzędzi zewnętrznych.
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
- **Domyślnie**: `true`
- **Opis**: Włącz lub wyłącz całą obsługę MCP. Gdy `false`, podczas uruchamiania nie są podłączone żadne serwery, a narzędzia MCP są niedostępne.

### __AH_KOD_4__

- **Typ**: `McpServerConfigEntry[]`
- **Domyślnie**: `[]`
- **Opis**: Tablica konfiguracji serwerów MCP.

### Pola wejściowe serwera

| Pole | Wpisz | Wymagane | Domyślne | Opis |
| --------- | -------------------------------- | -------------- | -------- | -------------------------------------------------------- |
| __AH_KOD_7__ | __AH_KOD_8__ | Tak | - | Unikalny identyfikator serwera |
| __AH_KOD_9__ | __AH_KOD_10__ \| __AH_KOD_11__ \| __AH_KOD_12__ | Tak | - | Rodzaj transportu |
| __AH_KOD_13__ | __AH_KOD_14__ | Tak (stdio) | - | Polecenie uruchomienia procesu serwera |
| __AH_KOD_15__ | __AH_KOD_16__ | Nie | __AH_KOD_17__ | Argumenty polecenia |
| __AH_KOD_18__ | __AH_KOD_19__ | Tak (sse/http) | - | Adres URL punktu końcowego serwera |
| __AH_KOD_20__ | __AH_KOD_21__ | Nie | __AH_KOD_22__ | Niestandardowe nagłówki HTTP dla transportu http/sse (np. tokeny uwierzytelniające) |
| __AH_KOD_23__ | __AH_KOD_24__ | Nie | __AH_KOD_25__ | Zmienne środowiskowe przekazane do serwera |
| __AH_KOD_26__ | __AH_KOD_27__ | Nie | __AH_KOD_28__ | Czy łączyć się automatycznie przy uruchomieniu |

> Serwery łączą się asynchronicznie w tle podczas uruchamiania, nie blokując monitu. Użyj `/mcp` do interaktywnego zarządzania serwerami lub `/mcp add` do przeglądania rejestru społeczności lub dodawania niestandardowych serwerów.

> Pełna dokumentacja MCP znajduje się w [docs/mcp.md](mcp.md).

---

## Ustawienia haków

Konfiguracja haków cyklu życia, które uruchamiają polecenia powłoki na zdarzeniach agenta. Aby uzyskać szczegółowe informacje, zobacz [Dokumentację Hooks](./hooks.md).
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

| Pole | Wpisz | Domyślne | Opis |
| --------- | -------- | -------- | ---------------------------------- |
| __AH_KOD_1__ | wartość logiczna | __AH_KOD_2__ | Włącz/wyłącz wszystkie hooki globalnie |
| __AH_KOD_3__ | tablica | __AH_KOD_4__ | Tablica definicji haków |

### Definicja haka

| Pole | Wpisz | Wymagane | Domyślne | Opis |
| --------- | -------- | -------- | -------- | -------------------------------- |
| __AH_KOD_5__ | ciąg | Tak | - | Wydarzenie, do którego można się podłączyć |
| __AH_KOD_6__ | ciąg | Tak | - | Polecenie powłoki do wykonania |
| __AH_KOD_7__ | ciąg | Nie | - | Opis wyświetlacza `/hooks` |
| __AH_KOD_9__ | wartość logiczna | Nie | __AH_KOD_10__ | Czy hak jest aktywny |
| __AH_KOD_11__ | numer | Nie | __AH_KOD_12__ | Limit czasu w milisekundach |
| __AH_KOD_13__ | wartość logiczna | Nie | __AH_KOD_14__ | Uruchom bez blokowania |
| __AH_KOD_15__ | obiekt | Nie | - | Filtruj według narzędzia lub ścieżki |

### Zdarzenia związane z hakami

| Wydarzenie | Kiedy zwolniony |
| --------------- | ------------------------------------- |
| __AH_KOD_16__ | Przed wykonaniem dowolnego narzędzia |
| __AH_KOD_17__ | Po zakończeniu działania narzędzia |
| __AH_KOD_18__ | Kiedy plik jest tworzony/modyfikowany/usunięty |
| __AH_KOD_19__ | Przed wysłaniem do LLM |
| __AH_KOD_20__ | Po odpowiedzi LLM |
| __AH_KOD_21__ | Kiedy wystąpi błąd |

### Zmienne środowiskowe

Po uruchomieniu hooków dostępne są następujące zmienne środowiskowe:

| Zmienna | Opis |
| ---------------- | ------------------------------------- |
| __AH_KOD_22__ | Nazwa wydarzenia |
| __AH_KOD_23__ | Ścieżka główna obszaru roboczego |
| __AH_KOD_24__ | Nazwa narzędzia (zdarzenia narzędzia) |
| __AH_KOD_25__ | Argumenty narzędzi zakodowane w formacie JSON |
| __AH_KOD_26__ | prawda/fałsz (narzędzie końcowe) |
| __AH_KOD_27__ | Ścieżka pliku (zmodyfikowany plik) |
| __AH_KOD_28__ | Wykorzystane tokeny (po odpowiedzi) |

---

## Ustawienia rozszerzenia Chrome

Kontroluj integrację rozszerzenia Autohand Chrome. Zobacz pełny przewodnik na stronie [Autohand w przeglądarce Chrome](./autohand-in-chrome.md).
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
| Klucz | Wpisz | Domyślne | Opis |
| ------------------ | --------- | -------- | ---------------------------------------------------------------------------------- |
| __AH_KOD_0__ | __AH_KOD_1__ | — | Zainstalowany identyfikator rozszerzenia Chrome do bezpośredniego przekazywania |
| __AH_KOD_2__ | __AH_KOD_3__ | __AH_KOD_4__ | Uruchom most przeglądarki automatycznie za pomocą interfejsu CLI |
| __AH_KOD_5__ | __AH_KOD_6__ | __AH_KOD_7__ | Preferowana przeglądarka Chromium: `auto`, `chrome`, `chromium`, `brave`, `edge` |
| __AH_KOD_13__ | __AH_KOD_14__ | — | Katalog danych użytkownika przeglądarki, aby wybrać odpowiedni profil |
| __AH_KOD_15__ | __AH_KOD_16__ | — | Nazwa katalogu profilu przeglądarki (np. `"Default"`, `"Profile 1"`) |
| __AH_KOD_19__ | __AH_KOD_20__ | — | Zastępczy adres URL, gdy identyfikator rozszerzenia nie jest skonfigurowany |

### Flagi CLI
```bash
autohand --chrome          # Start with browser bridge enabled
autohand --no-chrome       # Start with browser bridge disabled
```
### Polecenia z ukośnikiem
```
/chrome                    # Open Chrome integration panel
/chrome disconnect         # Close the browser bridge connection
```
---

## Kompletny przykład

### Format JSON (`~/.autohand/config.json`)
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
### Format YAML (`~/.autohand/config.yaml`)
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
### Format TOML (`~/.autohand/config.toml`)
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

## Struktura katalogów

Autohand przechowuje dane w `~/.autohand/` (lub `$AUTOHAND_HOME`):
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
**Katalog na poziomie projektu** (w katalogu głównym obszaru roboczego):
```
<project>/.autohand/
├── settings.local.json  # Local project permissions (gitignore this)
├── memory/              # Project-specific memory
├── skills/              # Project-specific skills
└── tools/               # Project-specific meta-tools
```
---

## Flagi CLI (zastąpienie konfiguracji)

Te flagi zastępują ustawienia pliku konfiguracyjnego:

### Flagi podstawowe

| Flaga | Opis |
| ------------------------------ | -------------------------------------------------------------------------------------------------------- |
| __AH_KOD_0__ | Wyprowadź bieżącą wersję |
| __AH_KOD_1__ | Uruchom pojedynczą instrukcję w trybie poleceń |
| __AH_KOD_2__ | Zastąp katalog główny obszaru roboczego |
| __AH_KOD_3__ | Użyj niestandardowego pliku konfiguracyjnego |
| __AH_KOD_4__ | Zastąp model |
| __AH_KOD_5__ | Ustaw temperaturę pobierania próbek (0-1) |
| __AH_KOD_6__ | Ustaw głębokość myślenia/rozumowania (brak, normalna, rozszerzona) |
| __AH_KOD_7__ | Monity automatycznego potwierdzenia |
| __AH_KOD_8__ | Podgląd bez wykonywania |
| __AH_KOD_9__ | Włącz szczegółowe wyniki debugowania |
| __AH_KOD_10__ | Minimalny tryb jawny; ustawia również `AUTOHAND_CODE_SIMPLE=1` i wyłącza polecenia ukośnika |

### Uprawnienia i bezpieczeństwo

| Flaga | Opis |
| ------------------------------ | -------------------------------------------------------------------------------------------------------- |
| __AH_KOD_12__ | Brak monitów o zatwierdzenie |
| __AH_KOD_13__ | Odmawiaj niebezpiecznych operacji |
| __AH_KOD_14__ | Wyświetl aktualne ustawienia uprawnień i wyjdź |
| __AH_KOD_15__ | Wyłącz uwierzytelnione wylogowywanie w stanie bezczynności dla długotrwałych sesji agenta |
| __AH_KOD_16__ | Automatyczne zatwierdzanie wywołań narzędzi pasujących do wzorca (np. `allow:read,write` lub `deny:delete`) |
| __AH_KOD_19__ | Limit czasu w sekundach dla trybu automatycznego zatwierdzania |

### Git i drzewo pracy

| Flaga | Opis |
| ------------------------------ | -------------------------------------------------------------------------------------------------------- |
| __AH_KOD_20__ | Uruchom sesję w izolowanym drzewie roboczym git (opcjonalna nazwa drzewa roboczego/oddziału) |
| __AH_KOD_21__ | Uruchom w dedykowanej sesji tmux (oznacza `--worktree`; nie można używać z `--no-worktree`) |
| __AH_KOD_24__ | Wyłącz izolację drzewa roboczego git w trybie automatycznym |
| __AH_KOD_25__ | Automatyczne zatwierdzanie zmian po ukończeniu zadań |
| __AH_KOD_26__ | Wygeneruj łatkę git bez stosowania zmian |
| __AH_KOD_27__ | Plik wyjściowy łatki (używany z --patch) |

### Tryb automatyczny
| Flaga | Opis |
| ------------------------------ | -------------------------------------------------------------------------------------------------------- |
| __AH_KOD_0__ | Włącz interaktywny tryb automatyczny lub rozpocznij samodzielną pętlę z wbudowanym zadaniem |
| __AH_KOD_1__ | Maksymalna liczba iteracji w trybie automatycznym (domyślnie: 50) |
| __AH_KOD_2__ | Tekst znacznika zakończenia (domyślnie: „GOTOWE”) |
| __AH_KOD_3__ | Git zatwierdza co N iteracji (domyślnie: 5) |
| __AH_KOD_4__ | Maksymalny czas działania w minutach (domyślnie: 120) |
| __AH_KOD_5__ | Maksymalny koszt API w dolarach (domyślnie: 10) |
| __AH_KOD_6__ | Po zakończeniu trybu automatycznego przejdź bezpośrednio do trybu interaktywnego (tylko TTY) |

### Umiejętności i nauka

| Flaga | Opis |
| ------------------------------ | -------------------------------------------------------------------------------------------------------- |
| __AH_KOD_7__ | Automatyczne generowanie umiejętności na podstawie analizy projektu (patrz także `/learn` dla interaktywnego doradcy) |
| __AH_KOD_9__ | Uruchom doradcę umiejętności `/learn` w sposób nieinteraktywny (przeanalizuj i zainstaluj zalecane umiejętności) |
| __AH_KOD_11__ | Ponowna analiza projektu i regeneracja przestarzałych umiejętności wygenerowanych przez LLM w sposób nieinteraktywny |
| __AH_KOD_12__ | Zainstaluj umiejętność społeczności (otwiera przeglądarkę, jeśli nie podano nazwy) |
| __AH_KOD_13__ | Zainstaluj umiejętność na poziomie projektu (za pomocą --skill-install) |

### Uwierzytelnianie i konto

| Flaga | Opis |
| ------------------------------ | -------------------------------------------------------------------------------------------------------- |
| __AH_KOD_14__ | Zaloguj się na swoje konto Autohand |
| __AH_KOD_15__ | Wyloguj się ze swojego konta Autohand |
| __AH_KOD_16__ | Włącz/wyłącz synchronizację ustawień (domyślnie: true dla zalogowanych użytkowników) |

### Konfiguracja i informacje

| Flaga | Opis |
| ------------------------------ | -------------------------------------------------------------------------------------------------------- |
| __AH_KOD_17__ | Uruchom kreatora instalacji, aby skonfigurować lub ponownie skonfigurować Autohand |
| __AH_KOD_18__ | Pokaż informacje o Autohand (wersja, linki, informacje o wkładzie) |
| __AH_KOD_19__ | Prześlij opinię zespołowi Autohand |
| __AH_KOD_20__ | Skonfiguruj ustawienia Autohand (tak samo jak `/settings` w trybie interaktywnym) |

### Obszar roboczy i katalogi

| Flaga | Opis |
| ------------------------------ | -------------------------------------------------------------------------------------------------------- |
| __AH_KOD_0__ | Dodaj dodatkowe katalogi do zakresu obszaru roboczego (można ich używać wielokrotnie) |

### Tryby pracy

| Flaga | Opis |
| ------------------------------ | -------------------------------------------------------------------------------------------------------- |
| __AH_KOD_1__ | Tryb uruchamiania: interaktywny (domyślny), rpc lub acp |
| __AH_KOD_2__ | Skrót od --mode acp (protokół klienta agenta przez stdio) |
| __AH_KOD_3__ | Tryb wyświetlania zespołu: automatyczny, w trakcie lub tmux |

### Interfejs użytkownika i język

| Flaga | Opis |
| ------------------------------ | -------------------------------------------------------------------------------------------------------- |
| __AH_KOD_4__ | Ustaw język wyświetlania (np. en, id, zh-cn, fr, de, ja) |
| __AH_KOD_5__ | Ustaw dostawcę wyszukiwania internetowego (google, odważny, duckduckgo, równoległy) |
| __AH_KOD_6__ | Włącz zagęszczanie kontekstu (domyślnie: włączone) |
| __AH_KOD_7__ | Wyłącz zagęszczanie kontekstu |

### Integracja z Chrome

| Flaga | Opis |
| ------------------------------ | -------------------------------------------------------------------------------------------------------- |
| __AH_KOD_8__ | Włącz integrację z przeglądarką Chrome (tak samo jak `/chrome`) |
| __AH_KOD_10__ | Wyłącz integrację przeglądarki Chrome |

### Monit systemowy

| Flaga | Opis |
| ------------------------------ | -------------------------------------------------------------------------------------------------------- |
| __AH_KOD_11__ | Zastąp cały monit systemowy (ciąg wbudowany lub ścieżkę pliku) |
| __AH_KOD_12__ | Dołącz do zachęty systemowej (ciąg wbudowany lub ścieżka pliku) |
| __AH_KOD_13__ | Zastąp cały monit systemowy (ciąg wbudowany lub ścieżkę pliku) |
| __AH_KOD_14__ | Zastąp cały monit systemowy zawartością pliku |
| __AH_KOD_15__ | Dołącz do zachęty systemowej (ciąg wbudowany lub ścieżka pliku) |
| __AH_KOD_16__ | Dołącz zawartość pliku do zachęty systemowej |
| __AH_KOD_17__ | Załaduj jawny plik konfiguracyjny MCP |
| __AH_KOD_18__ | Załaduj jawnych agentów wbudowanych JSON lub katalog jawnych agentów |
| __AH_KOD_19__ | Załaduj jawny katalog wtyczek/meta-narzędzi |

### Komendy przełączania eksperymentów

| Polecenie | Opis |
| ------------------------------------- | ------------------------------------------------ |
| __AH_KOD_20__ | Wyświetla identyfikatory funkcji lokalnych i zdalnych, źródło, etap cyklu życia i stan |
| __AH_KOD_0__ | Pokaż jeden przełącznik funkcji, ścieżkę konfiguracji lub zdalne metadane i stan |
| __AH_KOD_1__ | Pobierz flagi funkcji zdalnych z interfejsu API Autohand |
| __AH_KOD_2__ | Włącz przełącznik funkcji oparty na konfiguracji |
| __AH_KOD_3__ | Wyłącz przełącznik funkcji oparty na konfiguracji |

Zdalne flagi funkcji są pobierane z `/v1/feature-flags/evaluate`, buforowane w `~/.autohand/feature-flags.json` i odświeżane po wygaśnięciu TTL dostarczonego przez API. Użyj `features.environment`, aby wybrać zdalne środowisko flag i `features.remoteOverrides`, aby lokalnie zrezygnować ze zdalnych flag, które można zastąpić przez użytkownika.

`usage_v2` to eksperymentalny przełącznik funkcji dla pulpitu nawigacyjnego `/usage` i ulepszonej karty `/status` Użycie. Włącz to za pomocą `autohand experiments enable usage_v2`.

`token_usage_status` to eksperymentalny przełącznik funkcji (ścieżka konfiguracyjna `features.tokenUsageStatus`, domyślnie wyłączona), który pokazuje użycie tokena w czasie rzeczywistym w działającej linii stanu — skumulowane tokeny w górę (`↑`) i w dół (`↓`) plus zajętość okna kontekstowego, np. __AH_KOD_16__. Okno kontekstowe jest rozpoznawane według modelu u wszystkich dostawców. Włącz to za pomocą `autohand experiments enable token_usage_status`.

---

## Polecenia z ukośnikiem

Autohand zapewnia bogaty zestaw poleceń ukośnikowych do użytku interaktywnego. Wpisz `/` w REPL, aby zobaczyć sugestie.

### Zarządzanie sesją

| Polecenie | Opis |
| --------- | -------------------------------------- |
| __AH_KOD_19__ | Wyjdź z bieżącej sesji |
| __AH_KOD_20__ | Wyjdź z bieżącej sesji |
| __AH_KOD_21__ | Rozpocznij nową rozmowę (z ekstrakcją pamięci) |
| __AH_KOD_22__ | Wyczyść rozmowę dzięki automatycznemu wyodrębnianiu pamięci |
| __AH_KOD_23__ | Pokaż szczegóły bieżącej sesji |
| __AH_KOD_24__ | Lista poprzednich sesji |
| __AH_KOD_25__ | Wznów poprzednią sesję |
| __AH_KOD_26__ | Przeglądaj historię sesji z paginacją |
| __AH_KOD_27__ | Cofnij zmiany git i ostatnią turę |
| __AH_KOD_28__ | Eksportuj sesję do Markdown/JSON/HTML |
| __AH_KOD_29__ | Udostępnij bieżącą sesję |
| __AH_KOD_30__ | Pokaż status sesji |
| __AH_KOD_31__ | Pokaż model, dostawcę, kontekst i limity użytkowania |

### Model i dostawca

| Polecenie | Opis |
| --------- | -------------------------------------- |
| __AH_KOD_32__ | Przełącz lub skonfiguruj model LLM |
| __AH_KOD_33__ | Kompaktuj kontekst ręcznie |

### Konfiguracja projektu

| Polecenie | Opis |
| --------- | -------------------------------------- |
| __AH_KOD_34__ | Utwórz plik `AGENTS.md` w bieżącym katalogu |
| __AH_KOD_36__ | Uruchom kreatora instalacji, aby skonfigurować Autohand |
| __AH_KOD_37__ | Dodaj katalogi do zakresu obszaru roboczego |

### Agenci i zespoły

| Polecenie | Opis |
| --------- | -------------------------------------- |
| __AH_KOD_38__ | Lista dostępnych sub-agentów |
| __AH_KOD_39__ | Utwórz nowego agenta za pomocą kreatora |
| __AH_KOD_40__ | Otwórz/zarządzaj samodzielnym środowiskiem wykonawczym Autohand Squad |
| __AH_KOD_41__ | Zarządzaj zespołem do pracy równoległej |
| __AH_KOD_42__ | Zarządzaj zadaniami w zespole |
| __AH_KOD_43__ | Wyślij wiadomość do kolegi z drużyny |

### Umiejętności

| Polecenie | Opis |
| ---------------- | -------------------------------------------------- |
| __AH_KOD_0__ | Lista i zarządzanie umiejętnościami |
| __AH_KOD_1__ | Utwórz nową umiejętność |
| __AH_KOD_2__ | Naucz się i zainstaluj zalecane umiejętności |

### Pamięć i ustawienia

| Polecenie | Opis |
| --------- | -------------------------------------- |
| __AH_KOD_3__ | Przeglądaj i zarządzaj zapisanymi wspomnieniami |
| __AH_KOD_4__ | Skonfiguruj ustawienia Autohand |
| __AH_KOD_5__ | Skonfiguruj pola linii stanu kompozytora |
| __AH_KOD_6__ | Przełącz przełączniki funkcji eksperymentalnych |
| __AH_KOD_7__ | Synchronizuj ustawienia między urządzeniami |
| __AH_KOD_8__ | Importuj sesje, ustawienia, MCP, pamięć, umiejętności i zaczepy z obsługiwanych agentów |

### Uprawnienia i haki

| Polecenie | Opis |
| --------- | -------------------------------------- |
| __AH_KOD_9__| Zarządzaj uprawnieniami narzędzi |
| __AH_KOD_10__ | Zarządzaj hakami cyklu życia |

### Uwierzytelnianie

| Polecenie | Opis |
| --------- | -------------------------------------- |
| __AH_KOD_11__ | Uwierzytelnij się za pomocą API Autohand |
| __AH_KOD_12__ | Wyloguj się z konta Autohand |

### Narzędzia i narzędzia

| Polecenie | Opis |
| --------- | -------------------------------------- |
| __AH_KOD_13__ | Przeszukaj sieć |
| __AH_KOD_14__ | Lista dostępnych formaterów kodu |
| __AH_KOD_15__ | Lista dostępnych lintersów |
| __AH_KOD_16__ | Generuj skrypty uzupełniania powłoki |
| __AH_KOD_17__ | Utwórz plan wdrożenia |
| __AH_KOD_18__ | Wykonaj przegląd kodu |
| __AH_KOD_19__ | Przejrzyj żądanie ściągnięcia |

### Integracja IDE

| Polecenie | Opis |
| --------- | -------------------------------------- |
| __AH_KOD_20__ | Wykryj i połącz się z działającymi IDE |

### MCP (protokół kontekstu modelu)

| Polecenie | Opis |
| --------- | -------------------------------------- |
| __AH_KOD_21__ | Interaktywny menedżer serwerów MCP |

### Automatyzacja

| Polecenie | Opis |
| --------- | -------------------------------------- |
| __AH_KOD_22__ | Uruchom autonomiczny tryb kodowania |
| __AH_KOD_23__ | Zaplanuj powtarzające się zadania |
| __AH_KOD_24__ | Przełącz tryb yolo (narzędzia automatycznego zatwierdzania) |

### Integracja z Chrome

| Polecenie | Opis |
| --------- | -------------------------------------- |
| __AH_KOD_25__ | Włącz integrację przeglądarki Chrome |

### Interfejs użytkownika i wyświetlacz

| Polecenie | Opis |
| --------- | -------------------------------------- |
| __AH_KOD_26__ | Wyświetl dostępne polecenia i wskazówki ukośnika |
| __AH_KOD_27__ | Pokaż informacje o Autohand |
| __AH_KOD_28__ | Zmień motyw kolorystyczny |
| __AH_KOD_29__ | Zmień język wyświetlania |
| __AH_KOD_30__ | Wyślij opinię do zespołu Autohand |

---

## Dostosowywanie monitów systemowych
Autohand pozwala dostosować monit systemowy używany przez agenta AI. Jest to przydatne w przypadku specjalistycznych przepływów pracy, niestandardowych instrukcji lub integracji z innymi systemami.

### Flagi CLI

| Flaga | Opis |
| ------------------------------ | ------------------------------------------- |
| __AH_KOD_0__ | Zastąp cały monit systemowy |
| __AH_KOD_1__ | Dołącz treść do domyślnego monitu systemowego |

Obie flagi akceptują:

- **Ciąg wbudowany**: Bezpośrednia treść tekstowa
- **Ścieżka pliku**: Ścieżka do pliku zawierającego zachętę (wykrywana automatycznie)

### Wykrywanie ścieżki pliku

Wartość jest traktowana jako ścieżka pliku, jeśli:

- Zaczyna się od `./`, `../`, `/` lub `~/`
- Rozpoczyna się literą dysku systemu Windows (np. `C:\`)
- Kończy się na `.txt`, `.md` lub `.prompt`
- Zawiera separatory ścieżek bez spacji

W przeciwnym razie jest traktowany jako ciąg wbudowany.

### `--sys-prompt` (Całkowita wymiana)

Jeśli jest podany, **całkowicie zastępuje** domyślny monit systemowy. Agent NIE załaduje:

- Domyślne instrukcje Autohand
- Instrukcje projektu AGENTS.md
- Pamięci użytkowników/projektów
- Umiejętności aktywne
```bash
# Inline string
autohand --sys-prompt "You are a Python expert. Be concise." --prompt "Write hello world"

# From file
autohand --sys-prompt ./custom-prompt.txt --prompt "Explain this code"

# Home directory
autohand --sys-prompt ~/.autohand/prompts/python-expert.md --prompt "Debug this function"
```
**Przykładowy niestandardowy plik zachęty (`custom-prompt.txt`):**
```
You are a specialized Python debugging assistant.

Rules:
- Focus only on Python code
- Always explain the root cause
- Suggest fixes with code examples
- Be concise and direct
```
### `--append-sys-prompt` (Dodaj do domyślnych)

Jeśli jest podany, **dołącza** treść do pełnego domyślnego monitu systemowego. Agent nadal będzie ładować:

- Domyślne instrukcje Autohand
- Instrukcje projektu AGENTS.md
- Pamięci użytkowników/projektów
- Umiejętności aktywne

Dołączona treść jest dodawana na samym końcu.
```bash
# Inline string
autohand --append-sys-prompt "Always use TypeScript instead of JavaScript" --prompt "Create a function"

# From file
autohand --append-sys-prompt ./team-guidelines.md --prompt "Add error handling"
```
**Przykładowy plik dołączania (`team-guidelines.md`):**
```
## Team Guidelines

- Use 2-space indentation
- Prefer functional patterns
- Add JSDoc comments to public APIs
- Run tests before committing
```
### Pierwszeństwo

Gdy dostępne są obie flagi:

1. `--sys-prompt` ma pełne pierwszeństwo
2. `--append-sys-prompt` jest ignorowany
```bash
# --append-sys-prompt is ignored in this case
autohand --sys-prompt "Custom only" --append-sys-prompt "This is ignored"
```
### Przypadki użycia

| Przypadek użycia | Polecana flaga |
| ---------------------------------- | ----------------------------------- |
| Niestandardowa osobowość agenta | __AH_KOD_0__ |
| Minimalne instrukcje | __AH_KOD_1__ |
| Dodaj wytyczne zespołu | __AH_KOD_2__ |
| Dodaj konwencje projektu | __AH_KOD_3__ |
| Integracja z systemami zewnętrznymi | __AH_KOD_4__ |
| Specjalistyczne debugowanie | __AH_KOD_5__ |

### Obsługa błędów

| Scenariusz | Zachowanie |
| ------------------ | ------------------------ |
| Pusta wartość | Błąd |
| Nie znaleziono pliku | Traktowane jako ciąg znaków |
| Pusty plik | Błąd |
| Plik > 1 MB | Błąd |
| Odmowa pozwolenia | Błąd |
| Ścieżka katalogu | Błąd |

### Przykłady
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

## Obsługa wielu katalogów

Autohand może pracować z wieloma katalogami poza głównym obszarem roboczym. Jest to przydatne, gdy projekt ma zależności, biblioteki współdzielone lub powiązane projekty w różnych katalogach.

### Flaga CLI

Użyj `--add-dir`, aby dodać dodatkowe katalogi (można użyć wiele razy):
```bash
# Add a single additional directory
autohand --add-dir /path/to/shared-lib

# Add multiple directories
autohand --add-dir /path/to/lib1 --add-dir /path/to/lib2

# With unrestricted mode (auto-approve writes to all directories)
autohand --add-dir /path/to/shared-lib --unrestricted
```
### Interaktywne polecenie

Użyj `/add-dir` podczas sesji interaktywnej:
```
/add-dir              # Show current directories
/add-dir /path/to/dir # Add a new directory
```
### Ograniczenia bezpieczeństwa

Nie można dodać następujących katalogów:

- Katalog domowy (`~` lub `$HOME`)
- Katalog główny (`/`)
- Katalogi systemowe (`/etc`, `/var`, `/usr`, `/bin`, `/sbin`)
- Katalogi systemu Windows (`C:\Windows`, `C:\Program Files`)
- Katalogi użytkowników systemu Windows (`C:\Users\username`)
- Uchwyty WSL Windows (`/mnt/c`, `/mnt/c/Windows`)
