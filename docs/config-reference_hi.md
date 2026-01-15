# Autohand कॉन्फ़िगरेशन संदर्भ

`~/.autohand/config.json` (या `.yaml`/`.yml`) में सभी कॉन्फ़िगरेशन विकल्पों के लिए पूर्ण संदर्भ।

## विषय-सूची

- [कॉन्फ़िगरेशन फ़ाइल स्थान](#कॉन्फ़िगरेशन-फ़ाइल-स्थान)
- [एनवायरनमेंट वेरिएबल्स](#एनवायरनमेंट-वेरिएबल्स)
- [प्रोवाइडर सेटिंग्स](#प्रोवाइडर-सेटिंग्स)
- [वर्कस्पेस सेटिंग्स](#वर्कस्पेस-सेटिंग्स)
- [UI सेटिंग्स](#ui-सेटिंग्स)
- [एजेंट सेटिंग्स](#एजेंट-सेटिंग्स)
- [परमिशन सेटिंग्स](#परमिशन-सेटिंग्स)
- [नेटवर्क सेटिंग्स](#नेटवर्क-सेटिंग्स)
- [टेलीमेट्री सेटिंग्स](#टेलीमेट्री-सेटिंग्स)
- [एक्सटर्नल एजेंट्स](#एक्सटर्नल-एजेंट्स)
- [API सेटिंग्स](#api-सेटिंग्स)
- [पूर्ण उदाहरण](#पूर्ण-उदाहरण)

---

## कॉन्फ़िगरेशन फ़ाइल स्थान

Autohand इस क्रम में कॉन्फ़िगरेशन खोजता है:

1. `AUTOHAND_CONFIG` एनवायरनमेंट वेरिएबल (कस्टम पथ)
2. `~/.autohand/config.yaml`
3. `~/.autohand/config.yml`
4. `~/.autohand/config.json` (डिफ़ॉल्ट)

आप बेस डायरेक्टरी भी बदल सकते हैं:
```bash
export AUTOHAND_HOME=/custom/path  # ~/.autohand को /custom/path में बदलता है
```

---

## एनवायरनमेंट वेरिएबल्स

| वेरिएबल | विवरण | उदाहरण |
|---------|--------|--------|
| `AUTOHAND_HOME` | सभी Autohand डेटा के लिए बेस डायरेक्टरी | `/custom/path` |
| `AUTOHAND_CONFIG` | कस्टम कॉन्फ़िगरेशन फ़ाइल पथ | `/path/to/config.json` |
| `AUTOHAND_API_URL` | API एंडपॉइंट (कॉन्फ़िगरेशन ओवरराइड करता है) | `https://api.autohand.ai` |
| `AUTOHAND_SECRET` | कंपनी/टीम सीक्रेट की | `sk-xxx` |

---

## प्रोवाइडर सेटिंग्स

### `provider`
उपयोग करने के लिए सक्रिय LLM प्रोवाइडर।

| मान | विवरण |
|-----|--------|
| `"openrouter"` | OpenRouter API (डिफ़ॉल्ट) |
| `"ollama"` | लोकल Ollama इंस्टेंस |
| `"llamacpp"` | लोकल llama.cpp सर्वर |
| `"openai"` | सीधे OpenAI API |

### `openrouter`
OpenRouter प्रोवाइडर कॉन्फ़िगरेशन।

```json
{
  "openrouter": {
    "apiKey": "sk-or-v1-xxx",
    "baseUrl": "https://openrouter.ai/api/v1",
    "model": "anthropic/claude-sonnet-4"
  }
}
```

| फ़ील्ड | टाइप | आवश्यक | डिफ़ॉल्ट | विवरण |
|--------|------|--------|---------|--------|
| `apiKey` | string | हाँ | - | आपकी OpenRouter API की |
| `baseUrl` | string | नहीं | `https://openrouter.ai/api/v1` | API एंडपॉइंट |
| `model` | string | हाँ | - | मॉडल आइडेंटिफायर (जैसे `anthropic/claude-sonnet-4`) |

### `ollama`
Ollama प्रोवाइडर कॉन्फ़िगरेशन।

```json
{
  "ollama": {
    "baseUrl": "http://localhost:11434",
    "port": 11434,
    "model": "llama3.2"
  }
}
```

| फ़ील्ड | टाइप | आवश्यक | डिफ़ॉल्ट | विवरण |
|--------|------|--------|---------|--------|
| `baseUrl` | string | नहीं | `http://localhost:11434` | Ollama सर्वर URL |
| `port` | number | नहीं | `11434` | सर्वर पोर्ट (baseUrl का विकल्प) |
| `model` | string | हाँ | - | मॉडल नाम (जैसे `llama3.2`, `codellama`) |

### `llamacpp`
llama.cpp सर्वर कॉन्फ़िगरेशन।

```json
{
  "llamacpp": {
    "baseUrl": "http://localhost:8080",
    "port": 8080,
    "model": "default"
  }
}
```

| फ़ील्ड | टाइप | आवश्यक | डिफ़ॉल्ट | विवरण |
|--------|------|--------|---------|--------|
| `baseUrl` | string | नहीं | `http://localhost:8080` | llama.cpp सर्वर URL |
| `port` | number | नहीं | `8080` | सर्वर पोर्ट |
| `model` | string | हाँ | - | मॉडल आइडेंटिफायर |

### `openai`
OpenAI API कॉन्फ़िगरेशन।

```json
{
  "openai": {
    "apiKey": "sk-xxx",
    "baseUrl": "https://api.openai.com/v1",
    "model": "gpt-4o"
  }
}
```

| फ़ील्ड | टाइप | आवश्यक | डिफ़ॉल्ट | विवरण |
|--------|------|--------|---------|--------|
| `apiKey` | string | हाँ | - | OpenAI API की |
| `baseUrl` | string | नहीं | `https://api.openai.com/v1` | API एंडपॉइंट |
| `model` | string | हाँ | - | मॉडल नाम (जैसे `gpt-4o`, `gpt-4o-mini`) |

---

## वर्कस्पेस सेटिंग्स

```json
{
  "workspace": {
    "defaultRoot": "/path/to/projects",
    "allowDangerousOps": false
  }
}
```

| फ़ील्ड | टाइप | डिफ़ॉल्ट | विवरण |
|--------|------|---------|--------|
| `defaultRoot` | string | वर्तमान डायरेक्टरी | जब कोई निर्दिष्ट नहीं है तो डिफ़ॉल्ट वर्कस्पेस |
| `allowDangerousOps` | boolean | `false` | पुष्टि के बिना विनाशकारी ऑपरेशन की अनुमति दें |

---

## UI सेटिंग्स

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

| फ़ील्ड | टाइप | डिफ़ॉल्ट | विवरण |
|--------|------|---------|--------|
| `theme` | `"dark"` \| `"light"` | `"dark"` | टर्मिनल आउटपुट के लिए कलर थीम |
| `autoConfirm` | boolean | `false` | सुरक्षित ऑपरेशनों के लिए कन्फर्मेशन प्रॉम्प्ट स्किप करें |
| `readFileCharLimit` | number | `300` | रीड/सर्च टूल आउटपुट में दिखाए जाने वाले अधिकतम कैरेक्टर (पूरा कंटेंट अभी भी मॉडल को भेजा जाता है) |
| `showCompletionNotification` | boolean | `true` | टास्क पूरा होने पर सिस्टम नोटिफिकेशन दिखाएं |
| `showThinking` | boolean | `true` | LLM की रीज़निंग/थिंकिंग प्रोसेस दिखाएं |
| `useInkRenderer` | boolean | `false` | फ्लिकर-फ्री UI के लिए Ink-आधारित रेंडरर का उपयोग करें (प्रयोगात्मक) |
| `terminalBell` | boolean | `true` | टास्क पूरा होने पर टर्मिनल बेल बजाएं (टर्मिनल टैब/डॉक पर बैज दिखाता है) |
| `checkForUpdates` | boolean | `true` | स्टार्टअप पर CLI अपडेट की जांच करें |
| `updateCheckInterval` | number | `24` | अपडेट जांच के बीच घंटे (इंटरवल के भीतर कैश्ड रिजल्ट का उपयोग करता है) |

नोट: `readFileCharLimit` केवल `read_file`, `search`, और `search_with_context` के लिए टर्मिनल डिस्प्ले को प्रभावित करता है। पूरा कंटेंट अभी भी मॉडल को भेजा जाता है और टूल मैसेज में स्टोर किया जाता है।

### टर्मिनल बेल

जब `terminalBell` सक्षम होता है (डिफ़ॉल्ट), Autohand टास्क पूरा होने पर टर्मिनल बेल (`\x07`) बजाता है। यह ट्रिगर करता है:

- **टर्मिनल टैब पर बैज** - काम पूरा होने का विज़ुअल इंडिकेटर दिखाता है
- **डॉक आइकन बाउंस** - जब टर्मिनल बैकग्राउंड में हो तो आपका ध्यान खींचता है (macOS)
- **साउंड** - यदि टर्मिनल सेटिंग्स में साउंड सक्षम है

अक्षम करने के लिए:
```json
{
  "ui": {
    "terminalBell": false
  }
}
```

### Ink रेंडरर (प्रयोगात्मक)

जब `useInkRenderer` सक्षम होता है, Autohand पारंपरिक ora स्पिनर के बजाय React-आधारित टर्मिनल रेंडरिंग (Ink) का उपयोग करता है। यह प्रदान करता है:

- **फ्लिकर-फ्री आउटपुट**: सभी UI अपडेट React reconciliation के माध्यम से बैच किए जाते हैं
- **वर्किंग क्यू फीचर**: एजेंट काम करते समय इंस्ट्रक्शन टाइप करें
- **बेहतर इनपुट हैंडलिंग**: readline हैंडलर्स के बीच कोई कॉन्फ्लिक्ट नहीं
- **कंपोज़ेबल UI**: भविष्य के एडवांस्ड UI फीचर्स के लिए फाउंडेशन

सक्षम करने के लिए:
```json
{
  "ui": {
    "useInkRenderer": true
  }
}
```

नोट: यह फीचर प्रयोगात्मक है और इसमें एज केस हो सकते हैं। डिफ़ॉल्ट ora-आधारित UI स्थिर और पूर्ण रूप से कार्यात्मक है।

### अपडेट चेक

जब `checkForUpdates` सक्षम होता है (डिफ़ॉल्ट), Autohand स्टार्टअप पर नए रिलीज़ की जांच करता है:

```
> Autohand v0.6.8 (abc1234) ✓ Up to date
```

यदि अपडेट उपलब्ध है:
```
> Autohand v0.6.7 (abc1234) ⬆ Update available: v0.6.8
  ↳ Run: curl -fsSL https://autohand.ai/install.sh | sh
```

अक्षम करने के लिए:
```json
{
  "ui": {
    "checkForUpdates": false
  }
}
```

या एनवायरनमेंट वेरिएबल के माध्यम से:
```bash
export AUTOHAND_SKIP_UPDATE_CHECK=1
```

---

## एजेंट सेटिंग्स

एजेंट व्यवहार और इटरेशन लिमिट्स को नियंत्रित करें।

```json
{
  "agent": {
    "maxIterations": 100,
    "enableRequestQueue": true
  }
}
```

| फ़ील्ड | टाइप | डिफ़ॉल्ट | विवरण |
|--------|------|---------|--------|
| `maxIterations` | number | `100` | रुकने से पहले प्रति यूजर रिक्वेस्ट अधिकतम टूल इटरेशन |
| `enableRequestQueue` | boolean | `true` | एजेंट के काम करते समय यूजर्स को रिक्वेस्ट टाइप और क्यू करने की अनुमति दें |

### रिक्वेस्ट क्यू

जब `enableRequestQueue` सक्षम होता है, आप एजेंट के पिछली रिक्वेस्ट प्रोसेस करते समय मैसेज टाइप करना जारी रख सकते हैं। आपका इनपुट ऑटोमैटिकली क्यू हो जाएगा और वर्तमान टास्क पूरा होने पर प्रोसेस होगा।

- अपना मैसेज टाइप करें और क्यू में जोड़ने के लिए Enter दबाएं
- स्टेटस लाइन दिखाती है कि कितनी रिक्वेस्ट क्यू में हैं
- रिक्वेस्ट FIFO (first-in, first-out) क्रम में प्रोसेस होती हैं
- अधिकतम क्यू साइज़ 10 रिक्वेस्ट है

---

## परमिशन सेटिंग्स

टूल परमिशन पर बारीक नियंत्रण।

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

| मान | विवरण |
|-----|--------|
| `"interactive"` | खतरनाक ऑपरेशन पर अप्रूवल के लिए प्रॉम्प्ट करें (डिफ़ॉल्ट) |
| `"unrestricted"` | कोई प्रॉम्प्ट नहीं, सब कुछ अनुमति दें |
| `"restricted"` | सभी खतरनाक ऑपरेशन अस्वीकार करें |

### `whitelist`
टूल पैटर्न का एरे जिन्हें कभी अप्रूवल की आवश्यकता नहीं।

```json
["run_command:npm *", "run_command:bun test"]
```

### `blacklist`
टूल पैटर्न का एरे जो हमेशा ब्लॉक होते हैं।

```json
["run_command:rm -rf /", "run_command:sudo *"]
```

### `rules`
बारीक परमिशन रूल्स।

| फ़ील्ड | टाइप | विवरण |
|--------|------|--------|
| `tool` | string | मैच करने के लिए टूल नाम |
| `pattern` | string | आर्ग्युमेंट्स के खिलाफ मैच करने के लिए वैकल्पिक पैटर्न |
| `action` | `"allow"` \| `"deny"` \| `"prompt"` | लेने के लिए एक्शन |

### `rememberSession`
| टाइप | डिफ़ॉल्ट | विवरण |
|------|---------|--------|
| boolean | `true` | सेशन के लिए अप्रूवल डिसीजन याद रखें |

### लोकल प्रोजेक्ट परमिशन

प्रत्येक प्रोजेक्ट की अपनी परमिशन सेटिंग्स हो सकती हैं जो ग्लोबल कॉन्फिग को ओवरराइड करती हैं। ये आपके प्रोजेक्ट रूट में `.autohand/settings.local.json` में स्टोर होती हैं।

जब आप फाइल ऑपरेशन (एडिट, राइट, डिलीट) को अप्रूव करते हैं, यह ऑटोमैटिकली इस फाइल में सेव हो जाता है ताकि इस प्रोजेक्ट में उसी ऑपरेशन के लिए फिर से न पूछा जाए।

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

**यह कैसे काम करता है:**
- जब आप ऑपरेशन अप्रूव करते हैं, यह `.autohand/settings.local.json` में सेव होता है
- अगली बार, वही ऑपरेशन ऑटो-अप्रूव होगा
- लोकल प्रोजेक्ट सेटिंग्स ग्लोबल सेटिंग्स के साथ मर्ज होती हैं (लोकल प्रायोरिटी लेता है)
- पर्सनल सेटिंग्स प्राइवेट रखने के लिए `.autohand/settings.local.json` को `.gitignore` में जोड़ें

**पैटर्न फॉर्मेट:**
- `tool_name:path` - फाइल ऑपरेशन के लिए (जैसे `multi_file_edit:src/file.ts`)
- `tool_name:command args` - कमांड के लिए (जैसे `run_command:npm test`)

---

## नेटवर्क सेटिंग्स

```json
{
  "network": {
    "maxRetries": 3,
    "timeout": 30000,
    "retryDelay": 1000
  }
}
```

| फ़ील्ड | टाइप | डिफ़ॉल्ट | अधिकतम | विवरण |
|--------|------|---------|--------|--------|
| `maxRetries` | number | `3` | `5` | फेल API रिक्वेस्ट के लिए रिट्राई अटेम्प्ट्स |
| `timeout` | number | `30000` | - | मिलीसेकंड में रिक्वेस्ट टाइमआउट |
| `retryDelay` | number | `1000` | - | मिलीसेकंड में रिट्राई के बीच डिले |

---

## टेलीमेट्री सेटिंग्स

टेलीमेट्री **डिफ़ॉल्ट रूप से अक्षम** है (ऑप्ट-इन)। Autohand को बेहतर बनाने में मदद करने के लिए इसे सक्षम करें।

```json
{
  "telemetry": {
    "enabled": false,
    "apiBaseUrl": "https://api.autohand.ai",
    "enableSessionSync": false
  }
}
```

| फ़ील्ड | टाइप | डिफ़ॉल्ट | विवरण |
|--------|------|---------|--------|
| `enabled` | boolean | `false` | टेलीमेट्री सक्षम/अक्षम करें (ऑप्ट-इन) |
| `apiBaseUrl` | string | `https://api.autohand.ai` | टेलीमेट्री API एंडपॉइंट |
| `enableSessionSync` | boolean | `false` | टीम फीचर्स के लिए सेशन को क्लाउड में सिंक करें |

---

## एक्सटर्नल एजेंट्स

एक्सटर्नल डायरेक्टरी से कस्टम एजेंट डेफिनिशन लोड करें।

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

| फ़ील्ड | टाइप | डिफ़ॉल्ट | विवरण |
|--------|------|---------|--------|
| `enabled` | boolean | `false` | एक्सटर्नल एजेंट लोडिंग सक्षम करें |
| `paths` | string[] | `[]` | एजेंट लोड करने के लिए डायरेक्टरी |

---

## API सेटिंग्स

टीम फीचर्स के लिए बैकएंड API कॉन्फ़िगरेशन।

```json
{
  "api": {
    "baseUrl": "https://api.autohand.ai",
    "companySecret": "sk-team-xxx"
  }
}
```

| फ़ील्ड | टाइप | डिफ़ॉल्ट | विवरण |
|--------|------|---------|--------|
| `baseUrl` | string | `https://api.autohand.ai` | API एंडपॉइंट |
| `companySecret` | string | - | शेयर्ड फीचर्स के लिए टीम/कंपनी सीक्रेट |

एनवायरनमेंट वेरिएबल्स के माध्यम से भी सेट किया जा सकता है:
- `AUTOHAND_API_URL` → `api.baseUrl`
- `AUTOHAND_SECRET` → `api.companySecret`

---

## पूर्ण उदाहरण

### JSON फॉर्मेट (`~/.autohand/config.json`)

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

### YAML फॉर्मेट (`~/.autohand/config.yaml`)

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

## डायरेक्टरी स्ट्रक्चर

Autohand `~/.autohand/` (या `$AUTOHAND_HOME`) में डेटा स्टोर करता है:

```
~/.autohand/
├── config.json          # मुख्य कॉन्फ़िगरेशन
├── config.yaml          # वैकल्पिक YAML कॉन्फिग
├── device-id            # यूनिक डिवाइस आइडेंटिफायर
├── error.log            # एरर लॉग
├── feedback.log         # फीडबैक सबमिशन
├── sessions/            # सेशन हिस्ट्री
├── projects/            # प्रोजेक्ट नॉलेज बेस
├── memory/              # यूजर-लेवल मेमोरी
├── commands/            # कस्टम कमांड्स
├── agents/              # एजेंट डेफिनिशन
├── tools/               # कस्टम मेटा-टूल्स
├── feedback/            # फीडबैक स्टेट
└── telemetry/           # टेलीमेट्री डेटा
    ├── queue.json
    └── session-sync-queue.json
```

**प्रोजेक्ट-लेवल डायरेक्टरी** (आपके वर्कस्पेस रूट में):

```
<project>/.autohand/
├── settings.local.json  # लोकल प्रोजेक्ट परमिशन (gitignore में जोड़ें)
├── memory/              # प्रोजेक्ट-स्पेसिफिक मेमोरी
└── skills/              # प्रोजेक्ट-स्पेसिफिक स्किल्स
```

---

## CLI फ्लैग्स (कॉन्फ़िग ओवरराइड)

ये फ्लैग्स कॉन्फिग फाइल सेटिंग्स को ओवरराइड करते हैं:

| फ्लैग | विवरण |
|-------|--------|
| `--model <model>` | मॉडल ओवरराइड करें |
| `--path <path>` | वर्कस्पेस रूट ओवरराइड करें |
| `--add-dir <path>` | वर्कस्पेस स्कोप में अतिरिक्त डायरेक्टरी जोड़ें (कई बार उपयोग किया जा सकता है) |
| `--config <path>` | कस्टम कॉन्फिग फाइल का उपयोग करें |
| `--temperature <n>` | टेम्परेचर सेट करें (0-1) |
| `--yes` | प्रॉम्प्ट्स ऑटो-कन्फर्म करें |
| `--dry-run` | एक्जीक्यूट किए बिना प्रीव्यू करें |
| `--unrestricted` | कोई अप्रूवल प्रॉम्प्ट नहीं |
| `--restricted` | खतरनाक ऑपरेशन अस्वीकार करें |
| `--setup` | Autohand को कॉन्फ़िगर या रीकॉन्फ़िगर करने के लिए सेटअप विज़ार्ड चलाएं |

---

## मल्टी-डायरेक्टरी सपोर्ट

Autohand मुख्य वर्कस्पेस के अलावा कई डायरेक्टरी के साथ काम कर सकता है। यह तब उपयोगी है जब आपके प्रोजेक्ट में विभिन्न डायरेक्टरी में डिपेंडेंसी, शेयर्ड लाइब्रेरी, या संबंधित प्रोजेक्ट हैं।

### CLI फ्लैग

अतिरिक्त डायरेक्टरी जोड़ने के लिए `--add-dir` का उपयोग करें (कई बार उपयोग किया जा सकता है):

```bash
# एक अतिरिक्त डायरेक्टरी जोड़ें
autohand --add-dir /path/to/shared-lib

# कई डायरेक्टरी जोड़ें
autohand --add-dir /path/to/lib1 --add-dir /path/to/lib2

# अनरिस्ट्रिक्टेड मोड के साथ (सभी डायरेक्टरी में राइट ऑटो-अप्रूव करें)
autohand --add-dir /path/to/shared-lib --unrestricted
```

### इंटरैक्टिव कमांड

इंटरैक्टिव सेशन के दौरान `/add-dir` का उपयोग करें:

```
/add-dir              # वर्तमान डायरेक्टरी दिखाएं
/add-dir /path/to/dir # नई डायरेक्टरी जोड़ें
```

### सुरक्षा प्रतिबंध

निम्नलिखित डायरेक्टरी नहीं जोड़ी जा सकतीं:
- होम डायरेक्टरी (`~` या `$HOME`)
- रूट डायरेक्टरी (`/`)
- सिस्टम डायरेक्टरी (`/etc`, `/var`, `/usr`, `/bin`, `/sbin`)
- Windows सिस्टम डायरेक्टरी (`C:\Windows`, `C:\Program Files`)
- Windows यूजर डायरेक्टरी (`C:\Users\username`)
- WSL Windows माउंट (`/mnt/c`, `/mnt/c/Windows`)
