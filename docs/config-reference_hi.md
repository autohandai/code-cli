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
- [पैच मोड](#पैच-मोड)
- [नेटवर्क सेटिंग्स](#नेटवर्क-सेटिंग्स)
- [टेलीमेट्री सेटिंग्स](#टेलीमेट्री-सेटिंग्स)
- [एक्सटर्नल एजेंट्स](#एक्सटर्नल-एजेंट्स)
- [API सेटिंग्स](#api-सेटिंग्स)
- [ऑथेंटिकेशन सेटिंग्स](#ऑथेंटिकेशन-सेटिंग्स)
- [कम्युनिटी स्किल्स सेटिंग्स](#कम्युनिटी-स्किल्स-सेटिंग्स)
- [शेयर सेटिंग्स](#शेयर-सेटिंग्स)
- [सेटिंग्स सिंक](#सेटिंग्स-सिंक)
- [हुक्स सेटिंग्स](#हुक्स-सेटिंग्स)
- [MCP सेटिंग्स](#mcp-सेटिंग्स)
- [क्रोम एक्सटेंशन सेटिंग्स](#क्रोम-एक्सटेंशन-सेटिंग्स)
- [स्किल सिस्टम](#स्किल-सिस्टम)
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

| वेरिएबल                               | विवरण                                      | उदाहरण                           |
| -------------------------------------- | ------------------------------------------- | -------------------------------- |
| `AUTOHAND_HOME`                        | सभी Autohand डेटा के लिए बेस डायरेक्टरी    | `/custom/path`                   |
| `AUTOHAND_CONFIG`                      | कस्टम कॉन्फ़िगरेशन फ़ाइल पथ                | `/path/to/config.json`           |
| `AUTOHAND_API_URL`                     | API एंडपॉइंट (कॉन्फ़िगरेशन ओवरराइड करता है) | `https://api.autohand.ai`        |
| `AUTOHAND_SECRET`                      | कंपनी/टीम सीक्रेट की                       | `sk-xxx`                         |
| `AUTOHAND_PERMISSION_CALLBACK_URL`     | अनुमति कॉलबैक URL (प्रयोगात्मक)             | `http://localhost:3000/callback` |
| `AUTOHAND_PERMISSION_CALLBACK_TIMEOUT` | अनुमति कॉलबैक टाइमआउट (ms)                 | `5000`                           |
| `AUTOHAND_NON_INTERACTIVE`             | नॉन-इंटरैक्टिव मोड में चलाएं                | `1`                              |
| `AUTOHAND_YES`                         | सभी प्रॉम्प्ट्स ऑटो-कन्फर्म करें           | `1`                              |
| `AUTOHAND_NO_BANNER`                   | स्टार्टअप बैनर डिसेबल करें                 | `1`                              |
| `AUTOHAND_STREAM_TOOL_OUTPUT`          | टूल आउटपुट रीयल-टाइम में स्ट्रीम करें     | `1`                              |
| `AUTOHAND_DEBUG`                       | डीबग लॉगिंग सक्षम करें                    | `1`                              |
| `AUTOHAND_THINKING_LEVEL`              | थिंकिंग लेवल सेट करें                     | `normal`                         |
| `AUTOHAND_CLIENT_NAME`                 | क्लाइंट/एडिटर आइडेंटिफायर (ACP एक्सटेंशन द्वारा सेट) | `zed`                            |
| `AUTOHAND_CLIENT_VERSION`              | क्लाइंट वर्जन (ACP एक्सटेंशन द्वारा सेट)    | `0.169.0`                        |

### थिंकिंग लेवल

`AUTOHAND_THINKING_LEVEL` एनवायरनमेंट वेरिएबल मॉडल की रीज़निंग गहराई को नियंत्रित करता है:

| मान       | विवरण                                                              |
| ---------- | ------------------------------------------------------------------- |
| `none`     | दृश्यमान रीज़निंग के बिना सीधे जवाब                                 |
| `normal`   | स्टैंडर्ड रीज़निंग गहराई (डिफ़ॉल्ट)                                  |
| `extended` | जटिल कार्यों के लिए गहन रीज़निंग, अधिक विस्तृत थिंकिंग प्रोसेस दिखाता है |

यह आमतौर पर ACP क्लाइंट एक्सटेंशन (जैसे Zed) द्वारा कॉन्फिगरेशन ड्रॉपडाउन के माध्यम से सेट किया जाता है।

```bash
# उदाहरण: जटिल कार्यों के लिए एक्सटेंडेड रीज़निंग का उपयोग करें
AUTOHAND_THINKING_LEVEL=extended autohand --prompt "इस मॉड्यूल को रिफैक्टर करें"
```

---

## प्रोवाइडर सेटिंग्स

### `provider`

उपयोग करने के लिए सक्रिय LLM प्रोवाइडर।

| मान            | विवरण                     |
| -------------- | ------------------------- |
| `"openrouter"` | OpenRouter API (डिफ़ॉल्ट) |
| `"ollama"`     | लोकल Ollama इंस्टेंस      |
| `"llamacpp"`   | लोकल llama.cpp सर्वर      |
| `"openai"`     | सीधे OpenAI API           |
| `"mlx"`        | Apple Silicon पर MLX (लोकल) |
| `"llmgateway"` | एकीकृत LLM Gateway API    |

### `openrouter`

OpenRouter प्रोवाइडर कॉन्फ़िगरेशन।

```json
{
  "openrouter": {
    "apiKey": "sk-or-v1-xxx",
    "baseUrl": "https://openrouter.ai/api/v1",
    "model": "your-modelcard-id-here"
  }
}
```

| फ़ील्ड    | टाइप   | आवश्यक | डिफ़ॉल्ट                       | विवरण                                            |
| --------- | ------ | ------ | ------------------------------ | ------------------------------------------------ |
| `apiKey`  | string | हाँ    | -                              | आपकी OpenRouter API की                           |
| `baseUrl` | string | नहीं   | `https://openrouter.ai/api/v1` | API एंडपॉइंट                                     |
| `model`   | string | हाँ    | -                              | मॉडल आइडेंटिफायर (जैसे `your-modelcard-id-here`) |

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

| फ़ील्ड    | टाइप   | आवश्यक | डिफ़ॉल्ट                 | विवरण                                   |
| --------- | ------ | ------ | ------------------------ | --------------------------------------- |
| `baseUrl` | string | नहीं   | `http://localhost:11434` | Ollama सर्वर URL                        |
| `port`    | number | नहीं   | `11434`                  | सर्वर पोर्ट (baseUrl का विकल्प)         |
| `model`   | string | हाँ    | -                        | मॉडल नाम (जैसे `llama3.2`, `codellama`) |

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

| फ़ील्ड    | टाइप   | आवश्यक | डिफ़ॉल्ट                | विवरण               |
| --------- | ------ | ------ | ----------------------- | ------------------- |
| `baseUrl` | string | नहीं   | `http://localhost:8080` | llama.cpp सर्वर URL |
| `port`    | number | नहीं   | `8080`                  | सर्वर पोर्ट         |
| `model`   | string | हाँ    | -                       | मॉडल आइडेंटिफायर    |

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

| फ़ील्ड    | टाइप   | आवश्यक | डिफ़ॉल्ट                    | विवरण                                   |
| --------- | ------ | ------ | --------------------------- | --------------------------------------- |
| `apiKey`  | string | हाँ    | -                           | OpenAI API की                           |
| `baseUrl` | string | नहीं   | `https://api.openai.com/v1` | API एंडपॉइंट                            |
| `model`   | string | हाँ    | -                           | मॉडल नाम (जैसे `gpt-4o`, `gpt-4o-mini`) |

### `mlx`

Apple Silicon Macs के लिए MLX प्रोवाइडर (लोकल इन्फेरेंस)।

```json
{
  "mlx": {
    "baseUrl": "http://localhost:8080",
    "port": 8080,
    "model": "mlx-community/Llama-3.2-3B-Instruct-4bit"
  }
}
```

| फ़ील्ड    | टाइप   | आवश्यक | डिफ़ॉल्ट                 | विवरण               |
| --------- | ------ | ------ | ------------------------ | ------------------- |
| `baseUrl` | string | नहीं   | `http://localhost:8080` | MLX सर्वर URL       |
| `port`    | number | नहीं   | `8080`                  | सर्वर पोर्ट          |
| `model`   | string | हाँ    | -                       | MLX मॉडल आइडेंटिफायर |

### `llmgateway`

एकीकृत LLM Gateway API कॉन्फ़िगरेशन। एकल API के माध्यम से कई LLM प्रोवाइडर्स तक पहुंच प्रदान करता है।

```json
{
  "llmgateway": {
    "apiKey": "your-llmgateway-api-key",
    "baseUrl": "https://api.llmgateway.io/v1",
    "model": "gpt-4o"
  }
}
```

| फ़ील्ड    | टाइप   | आवश्यक | डिफ़ॉल्ट                        | विवरण                                                          |
| --------- | ------ | ------ | -------------------------------- | ---------------------------------------------------------------- |
| `apiKey`  | string | हाँ    | -                                | LLM Gateway API की                                              |
| `baseUrl` | string | नहीं   | `https://api.llmgateway.io/v1` | API एंडपॉइंट                                                     |
| `model`   | string | हाँ    | -                                | मॉडल नाम (जैसे `gpt-4o`, `claude-3-5-sonnet-20241022`) |

**API Key प्राप्त करना:**
[llmgateway.io/dashboard](https://llmgateway.io/dashboard) पर विजिट करके अकाउंट बनाएं और API key प्राप्त करें।

**सपोर्टेड मॉडल्स:**
LLM Gateway कई प्रोवाइडर्स के मॉडल्स को सपोर्ट करता है:

- OpenAI: `gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo`
- Anthropic: `claude-3-5-sonnet-20241022`, `claude-3-5-haiku-20241022`
- Google: `gemini-1.5-pro`, `gemini-1.5-flash`

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

| फ़ील्ड              | टाइप    | डिफ़ॉल्ट           | विवरण                                          |
| ------------------- | ------- | ------------------ | ---------------------------------------------- |
| `defaultRoot`       | string  | वर्तमान डायरेक्टरी | जब कोई निर्दिष्ट नहीं है तो डिफ़ॉल्ट वर्कस्पेस |
| `allowDangerousOps` | boolean | `false`            | पुष्टि के बिना विनाशकारी ऑपरेशन की अनुमति दें  |

### वर्कस्पेस सेफ्टी

Autohand स्वचालित रूप से खतरनाक डायरेक्टरी में ऑपरेशन ब्लॉक करता है ताकि संयोग से नुकसान न हो:

- **फाइल सिस्टम रूट्स** (`/`, `C:\`, `D:\`, etc.)
- **होम डायरेक्टरीज़** (`~`, `/Users/<user>`, `/home/<user>`, `C:\Users\<user>`)
- **सिस्टम डायरेक्टरीज़** (`/etc`, `/var`, `/System`, `C:\Windows`, etc.)
- **Windows WSL माउंट्स** (`/mnt/c`, `/mnt/c/Users/<user>`)

इस चेक को ओवरराइड नहीं किया जा सकता। यदि आप किसी खतरनाक डायरेक्टरी से autohand चलाने की कोशिश करते हैं, तो आपको एक एरर मिलेगा और आपको एक सुरक्षित प्रोजेक्ट डायरेक्टरी निर्दिष्ट करनी होगी।

```bash
# यह ब्लॉक हो जाएगा
cd ~ && autohand
# Error: Unsafe Workspace Directory

# यह काम करेगा
cd ~/projects/my-app && autohand
```

पूर्ण विवरण के लिए [Workspace Safety](./workspace-safety.md) देखें।

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

| फ़ील्ड                       | टाइप                  | डिफ़ॉल्ट | विवरण                                                                                             |
| ---------------------------- | --------------------- | -------- | ------------------------------------------------------------------------------------------------- |
| `theme`                      | `"dark"` \| `"light"` | `"dark"` | टर्मिनल आउटपुट के लिए कलर थीम                                                                     |
| `autoConfirm`                | boolean               | `false`  | सुरक्षित ऑपरेशनों के लिए कन्फर्मेशन प्रॉम्प्ट स्किप करें                                          |
| `readFileCharLimit`          | number                | `300`    | रीड/सर्च टूल आउटपुट में दिखाए जाने वाले अधिकतम कैरेक्टर (पूरा कंटेंट अभी भी मॉडल को भेजा जाता है) |
| `showCompletionNotification` | boolean               | `true`   | टास्क पूरा होने पर सिस्टम नोटिफिकेशन दिखाएं                                                       |
| `showThinking`               | boolean               | `true`   | LLM की रीज़निंग/थिंकिंग प्रोसेस दिखाएं                                                            |
| `useInkRenderer`             | boolean               | `false`  | फ्लिकर-फ्री UI के लिए Ink-आधारित रेंडरर का उपयोग करें (प्रयोगात्मक)                               |
| `terminalBell`               | boolean               | `true`   | टास्क पूरा होने पर टर्मिनल बेल बजाएं (टर्मिनल टैब/डॉक पर बैज दिखाता है)                           |
| `checkForUpdates`            | boolean               | `true`   | स्टार्टअप पर CLI अपडेट की जांच करें                                                               |
| `updateCheckInterval`        | number                | `24`     | अपडेट जांच के बीच घंटे (इंटरवल के भीतर कैश्ड रिजल्ट का उपयोग करता है)                             |

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
    "enableRequestQueue": true,
    "debug": false
  }
}
```

| फ़ील्ड               | टाइप    | डिफ़ॉल्ट | विवरण                                                                     |
| -------------------- | ------- | -------- | ------------------------------------------------------------------------- |
| `maxIterations`      | number  | `100`    | रुकने से पहले प्रति यूजर रिक्वेस्ट अधिकतम टूल इटरेशन                      |
| `enableRequestQueue` | boolean | `true`   | एजेंट के काम करते समय यूजर्स को रिक्वेस्ट टाइप और क्यू करने की अनुमति दें |
| `debug`              | boolean | `false`  | विस्तृत डीबग आउटपुट सक्षम करें (एजेंट के इंटरनल स्टेट लॉग्स को stderr पर) |

### डीबग मोड

डीबग मोड सक्षम करें ताकि एजेंट के इंटरनल स्टेट का विस्तृत लॉगिंग देख सकें (react लूप इटरेशन, प्रॉम्प्ट बिल्डिंग, सेशन विवरण)। आउटपुट stderr पर जाता है ताकि सामान्य आउटपुट में हस्तक्षेप न हो।

डीबग मोड सक्षम करने के तीन तरीके (प्राथमिकता क्रम में):

1. **CLI फ्लैग**: `autohand -d` या `autohand --debug`
2. **एनवायरनमेंट वेरिएबल**: `AUTOHAND_DEBUG=1`
3. **कॉन्फ़िगरेशन फाइल**: `agent.debug: true` सेट करें

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

| मान              | विवरण                                                     |
| ---------------- | --------------------------------------------------------- |
| `"interactive"`  | खतरनाक ऑपरेशन पर अप्रूवल के लिए प्रॉम्प्ट करें (डिफ़ॉल्ट) |
| `"unrestricted"` | कोई प्रॉम्प्ट नहीं, सब कुछ अनुमति दें                     |
| `"restricted"`   | सभी खतरनाक ऑपरेशन अस्वीकार करें                           |

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

| फ़ील्ड    | टाइप                                | विवरण                                                  |
| --------- | ----------------------------------- | ------------------------------------------------------ |
| `tool`    | string                              | मैच करने के लिए टूल नाम                                |
| `pattern` | string                              | आर्ग्युमेंट्स के खिलाफ मैच करने के लिए वैकल्पिक पैटर्न |
| `action`  | `"allow"` \| `"deny"` \| `"prompt"` | लेने के लिए एक्शन                                      |

### `rememberSession`

| टाइप    | डिफ़ॉल्ट | विवरण                               |
| ------- | -------- | ----------------------------------- |
| boolean | `true`   | सेशन के लिए अप्रूवल डिसीजन याद रखें |

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

### अनुमतियां देखना

आप अपनी वर्तमान अनुमति कॉन्फ़िगरेशन को दो तरीकों से देख सकते हैं:

**CLI फ्लैग (नॉन-इंटरैक्टिव):**

```bash
autohand --permissions
```

यह दिखाता है:

- वर्तमान अनुमति मोड (interactive, unrestricted, restricted)
- वर्कस्पेस और कॉन्फ़िगरेशन फ़ाइल पाथ
- सभी अप्रूव्ड पैटर्न (whitelist)
- सभी डिनाइड पैटर्न (blacklist)
- सारांश आंकड़े

**इंटरैक्टिव कमांड:**

```
/permissions
```

इंटरैक्टिव मोड में, `/permissions` कमांड वही जानकारी देता है साथ ही:

- व्हाइटलिस्ट से आइटम हटाना
- ब्लैकलिस्ट से आइटम हटाना
- सभी सेव्ड अनुमतियां साफ करना

---

## पैच मोड

पैच मोड आपको बिना वर्कस्पेस फाइल्स बदले git-कंपैटिबल पैच जनरेट करने की अनुमति देता है। यह उपयोगी है:

- बदलाव लागू करने से पहले कोड रिव्यू के लिए
- टीम के सदस्यों के साथ AI-जनित बदलाव साझा करने के लिए
- दोहराया जा सकने वाला चेंजसेट बनाने के लिए
- ऐसे CI/CD पाइपलाइन के लिए जो बदलाव कैप्चर करने की जरूरत है बिना लागू किए

### उपयोग

```bash
# stdout पर पैच जनरेट करें
autohand --prompt "यूजर ऑथेंटिकेशन जोड़ें" --patch

# फाइल में सेव करें
autohand --prompt "यूजर ऑथेंटिकेशन जोड़ें" --patch --output auth.patch

# फाइल में पाइप करें (विकल्प)
autohand --prompt "api हैंडलर्स को रिफैक्टर करें" --patch > refactor.patch
```

### व्यवहार

जब `--patch` निर्दिष्ट होता है:

- **ऑटो-कन्फर्म**: सभी प्रॉम्प्ट्स ऑटोमैटिकली स्वीकार होते हैं (`--yes` इम्प्लाइड)
- **नो प्रॉम्प्ट्स**: कोई अप्रूवल प्रॉम्प्ट्स नहीं दिखते (`--unrestricted` इम्प्लाइड)
- **प्रीव्यू ओनली**: बदलाव कैप्चर होते हैं लेकिन डिस्क पर नहीं लिखे जाते
- **सेफ्टी लागू**: ब्लैकलिस्टेड ऑपरेशन (`.env`, SSH keys, खतरनाक कमांड्स) अभी भी ब्लॉक होते हैं

### पैच लागू करना

प्राप्तकर्ता स्टैंडर्ड git कमांड्स का उपयोग करके पैच लागू कर सकते हैं:

```bash
# जांचें क्या लागू होगा (dry-run)
git apply --check changes.patch

# पैच लागू करें
git apply changes.patch

# 3-way merge के साथ लागू करें (बेहतर कन्फ्लिक्ट हैंडलिंग)
git apply -3 changes.patch

# लागू करें और स्टेज करें
git apply --index changes.patch

# पैच रिवर्ट करें
git apply -R changes.patch
```

### पैच फॉर्मेट

जनरेट किया गया पैच git unified diff फॉर्मेट का पालन करता है:

```diff
diff --git a/src/auth.ts b/src/auth.ts
new file mode 100644
--- /dev/null
+++ b/src/auth.ts
@@ -0,0 +1,15 @@
+export function authenticate(user: string, password: string) {
+  // इम्प्लीमेंटेशन यहां
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

### एग्जिट कोड्स

| कोड | अर्थ                                              |
| ---- | ------------------------------------------------- |
| `0`  | सफल, पैच जनरेट हुआ                                |
| `1`  | एरर (`--prompt` नहीं, अनुमति अस्वीकार, आदि)         |

### अन्य फ्लैग्स के साथ कंबाइन करना

```bash
# विशेष मॉडल का उपयोग करें
autohand --prompt "क्वेरीज़ ऑप्टिमाइज़ करें" --patch --model gpt-4o

# वर्कस्पेस निर्दिष्ट करें
autohand --prompt "टेस्ट जोड़ें" --patch --path ./my-project

# कस्टम कॉन्फ़िगरेशन का उपयोग करें
autohand --prompt "रिफैक्टर करें" --patch --config ~/.autohand/work.json
```

### टीम वर्कफ़्लो उदाहरण

```bash
# डेवलपर A: फीचर के लिए पैच जनरेट करें
autohand --prompt "चार्ट्स के साथ यूजर डैशबोर्ड इम्प्लीमेंट करें" --patch --output dashboard.patch

# git के माध्यम से साझा करें (सिर्फ पैच फाइल के साथ PR बनाएं)
git checkout -b patch/dashboard
git add dashboard.patch
git commit -m "Add dashboard feature patch"
git push

# डेवलपर B: रिव्यू और लागू करें
git fetch origin patch/dashboard
git apply dashboard.patch
# टेस्ट चलाएं, कोड रिव्यू करें, फिर कमिट करें
git add -A && git commit -m "feat: add user dashboard with charts"
```

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

| फ़ील्ड       | टाइप   | डिफ़ॉल्ट | अधिकतम | विवरण                                       |
| ------------ | ------ | -------- | ------ | ------------------------------------------- |
| `maxRetries` | number | `3`      | `5`    | फेल API रिक्वेस्ट के लिए रिट्राई अटेम्प्ट्स |
| `timeout`    | number | `30000`  | -      | मिलीसेकंड में रिक्वेस्ट टाइमआउट             |
| `retryDelay` | number | `1000`   | -      | मिलीसेकंड में रिट्राई के बीच डिले           |

---

## टेलीमेट्री सेटिंग्स

टेलीमेट्री **डिफ़ॉल्ट रूप से अक्षम** है (ऑप्ट-इन)। Autohand को बेहतर बनाने में मदद करने के लिए इसे सक्षम करें।

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

| फ़ील्ड               | टाइप    | डिफ़ॉल्ट                  | विवरण                                           |
| ------------------- | ------- | ------------------------- | ---------------------------------------------- |
| `enabled`           | boolean | `false`                   | टेलीमेट्री सक्षम/अक्षम करें (ऑप्ट-इन)          |
| `apiBaseUrl`        | string  | `https://api.autohand.ai` | टेलीमेट्री API एंडपॉइंट                        |
| `batchSize`         | number  | `20`                      | ऑटो-फ्लश से पहले बैच में इवेंट्स की संख्या     |
| `flushIntervalMs`   | number  | `60000`                   | फ्लश इंटरवल मिलीसेकंड में (1 मिनट)            |
| `maxQueueSize`      | number  | `500`                     | पुराने इवेंट्स ड्रॉप करने से पहले क्यू का अधिकतम आकार |
| `maxRetries`        | number  | `3`                       | फेल टेलीमेट्री रिक्वेस्ट्स के लिए रिट्राई अटेम्प्ट्स |
| `enableSessionSync` | boolean | `false`                   | टीम फीचर्स के लिए सेशन को क्लाउड में सिंक करें |
| `companySecret`     | string  | `""`                      | API ऑथेंटिकेशन के लिए कंपनी सीक्रेट             |

---

## एक्सटर्नल एजेंट्स

एक्सटर्नल डायरेक्टरी से कस्टम एजेंट डेफिनिशन लोड करें।

```json
{
  "externalAgents": {
    "enabled": true,
    "paths": ["~/.autohand/agents", "/team/shared/agents"]
  }
}
```

| फ़ील्ड    | टाइप     | डिफ़ॉल्ट | विवरण                             |
| --------- | -------- | -------- | --------------------------------- |
| `enabled` | boolean  | `false`  | एक्सटर्नल एजेंट लोडिंग सक्षम करें |
| `paths`   | string[] | `[]`     | एजेंट लोड करने के लिए डायरेक्टरी  |

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

| फ़ील्ड          | टाइप   | डिफ़ॉल्ट                  | विवरण                                  |
| --------------- | ------ | ------------------------- | -------------------------------------- |
| `baseUrl`       | string | `https://api.autohand.ai` | API एंडपॉइंट                           |
| `companySecret` | string | -                         | शेयर्ड फीचर्स के लिए टीम/कंपनी सीक्रेट |

एनवायरनमेंट वेरिएबल्स के माध्यम से भी सेट किया जा सकता है:

- `AUTOHAND_API_URL` → `api.baseUrl`
- `AUTOHAND_SECRET` → `api.companySecret`

---

## ऑथेंटिकेशन सेटिंग्स

संरक्षित संसाधनों के लिए ऑथेंटिकेशन कॉन्फ़िगरेशन।

```json
{
  "auth": {
    "token": "your-auth-token",
    "refreshToken": "your-refresh-token",
    "expiresAt": "2024-12-31T23:59:59Z"
  }
}
```

| फ़ील्ड          | टाइप   | आवश्यक | विवरण                                    |
| --------------- | ------ | -------- | ---------------------------------------- |
| `token`         | string | हाँ     | वर्तमान एक्सेस टोकन                      |
| `refreshToken`  | string | नहीं    | एक्सेस टोकन रिन्यू करने के लिए टोकन    |
| `expiresAt`     | string | नहीं    | टोकन एक्सपायरी तिथि/समय (ISO फॉर्मेट)   |

---

## कम्युनिटी स्किल्स सेटिंग्स

कम्युनिटी स्किल रजिस्ट्री के लिए कॉन्फ़िगरेशन।

```json
{
  "communitySkills": {
    "registryUrl": "https://skills.autohand.ai",
    "cacheDuration": 3600,
    "autoUpdate": false
  }
}
```

| फ़ील्ड           | टाइप    | डिफ़ॉल्ट                      | विवरण                                            |
| --------------- | ------- | ------------------------------ | ------------------------------------------------ |
| `registryUrl`   | string  | `https://skills.autohand.ai` | स्किल रजिस्ट्री का बेस URL                       |
| `cacheDuration` | number  | `3600`                         | कैश अवधि सेकंड में                               |
| `autoUpdate`    | boolean | `false`                        | स्किल्स को ऑटोमैटिक अपडेट करें जब पुराने हों |

---

## शेयर सेटिंग्स

सेशन और वर्कस्पेस साझा करने को नियंत्रित करें।

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

| फ़ील्ड               | टाइप    | डिफ़ॉल्ट      | विवरण                                            |
| ------------------- | ------- | -------------- | ------------------------------------------------ |
| `enabled`           | boolean | `true`         | शेयरिंग फीचर्स सक्षम करें                       |
| `defaultVisibility` | string  | `"private"`    | डिफ़ॉल्ट विजिबिलिटी: `private`, `team`, `public` |
| `allowPublicLinks`  | boolean | `false`        | पब्लिक लिंक बनाने की अनुमति दें                 |
| `requireApproval`   | boolean | `true`         | शेयर करने से पहले अप्रूवल आवश्यक               |

---

## सेटिंग्स सिंक

अपनी सेटिंग्स को डिवाइसेस के बीच सिंक करें।

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

| फ़ील्ड                | टाइप    | डिफ़ॉल्ट      | विवरण                                            |
| -------------------- | ------- | -------------- | ------------------------------------------------ |
| `enabled`            | boolean | `false`        | सेटिंग्स सिंक सक्षम करें                        |
| `autoSync`           | boolean | `true`         | बदलाव होने पर ऑटोमैटिक सिंक करें                |
| `syncInterval`       | number  | `300`          | सेकंड में सिंक इंटरवल                            |
| `conflictResolution` | string  | `"ask"`        | कन्फ्लिक्ट रिज़ॉल्यूशन: `ask`, `local`, `remote` |

---

## हुक्स सेटिंग्स

Autohand इवेंट्स के लिए कस्टम हुक्स कॉन्फ़िगर करें।

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

| फ़ील्ड         | टाइप   | विवरण                                            |
| -------------- | ------ | ------------------------------------------------ |
| `preCommand`   | string | प्रत्येक कमांड से पहले निष्पादित स्क्रिप्ट       |
| `postCommand`  | string | प्रत्येक कमांड के बाद निष्पादित स्क्रिप्ट        |
| `onError`      | string | एरर होने पर निष्पादित स्क्रिप्ट                  |
| `onComplete`   | string | टास्क पूरा होने पर निष्पादित स्क्रिप्ट          |

हुक्स में उपलब्ध एनवायरनमेंट वेरिएबल्स:

- `AUTOHAND_HOOK_TYPE` - हुक का प्रकार (`preCommand`, `postCommand`, आदि)
- `AUTOHAND_COMMAND` - निष्पादित हो रहा कमांड
- `AUTOHAND_EXIT_CODE` - एग्जिट कोड (सिर्फ `postCommand` और `onError` के लिए)
- `AUTOHAND_SESSION_ID` - वर्तमान सेशन ID

---

## MCP सेटिंग्स

टूल सर्वर के साथ एकीकरण के लिए Model Context Protocol (MCP) कॉन्फ़िगरेशन।

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

| फ़ील्ड    | टाइप   | विवरण                                            |
| --------- | ------ | ------------------------------------------------ |
| `command` | string | MCP सर्वर शुरू करने के लिए कमांड                 |
| `args`    | array  | कमांड के लिए आर्गुमेंट्स                         |
| `env`     | object | अतिरिक्त एनवायरनमेंट वेरिएबल्स                   |

MCP सर्वर एजेंट द्वारा कॉल किए जा सकने वाले अतिरिक्त टूल प्रदान करते हैं। प्रत्येक सर्वर को एक अद्वितीय नाम से पहचाना जाता है और आवश्यकता होने पर ऑटोमैटिक रूप से शुरू होता है।

---

## क्रोम एक्सटेंशन सेटिंग्स

Autohand Chrome एक्सटेंशन के लिए सेटिंग्स।

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

| फ़ील्ड              | टाइप    | डिफ़ॉल्ट      | विवरण                                            |
| ------------------ | ------- | -------------- | ------------------------------------------------ |
| `extensionId`      | string  | -              | इंस्टॉल्ड Chrome एक्सटेंशन का ID                |
| `nativeMessaging`  | boolean | `true`         | नेटिव मेसेजिंग के माध्यम से संचार सक्षम करें    |
| `autoLaunch`       | boolean | `false`        | शुरुआत पर Chrome ऑटोमैटिक खोलें                  |
| `preferredBrowser` | string  | `"chrome"`     | प्रिफर्ड ब्राउज़र: `chrome`, `chromium`, `edge`, `brave` |

Chrome एक्सटेंशन वेब पेज के साथ इंटरैक्शन और ब्राउज़र ऑटोमेशन की अनुमति देता है। नेटिव मेसेजिंग CLI और एक्सटेंशन के बीच दोतरफा संचार की अनुमति देता है।

---

## स्किल सिस्टम

स्किल्स इंस्ट्रक्शन पैकेज हैं जो AI एजेंट को विशेषज्ञता निर्देश प्रदान करते हैं। ये ऑन-डिमांड `AGENTS.md` फाइल्स की तरह काम करते हैं जिन्हें विशिष्ट कार्यों के लिए सक्रिय किया जा सकता है।

### स्किल डिस्कवरी लोकेशन्स

स्किल्स कई लोकेशन्स से खोजे जाते हैं, बाद की स्रोतों में प्राथमिकता होती है:

| लोकेशन                                 | सोर्स ID           | विवरण                              |
| --------------------------------------- | ----------------- | ---------------------------------- |
| `~/.codex/skills/**/SKILL.md`          | `codex-user`      | Codex यूजर स्किल्स (रेकर्सिव)      |
| `~/.claude/skills/*/SKILL.md`          | `claude-user`     | Claude यूजर स्किल्स (वन-लेवल)      |
| `~/.autohand/skills/**/SKILL.md`      | `autohand-user`   | Autohand यूजर स्किल्स (रेकर्सिव)    |
| `<project>/.claude/skills/*/SKILL.md`  | `claude-project`  | Claude प्रोजेक्ट स्किल्स (वन-लेवल) |
| `<project>/.autohand/skills/**/SKILL.md` | `autohand-project` | Autohand प्रोजेक्ट स्किल्स (रेकर्सिव) |

### ऑटो-कॉपी व्यवहार

Codex या Claude लोकेशन्स से खोजे गए स्किल्स ऑटोमैटिकली संबंधित Autohand लोकेशन में कॉपी हो जाते हैं:

- `~/.codex/skills/` और `~/.claude/skills/` → `~/.autohand/skills/`
- `<project>/.claude/skills/` → `<project>/.autohand/skills/`

Autohand लोकेशन्स में मौजूदा स्किल्स कभी ओवरराइट नहीं होते।

### SKILL.md फॉर्मेट

स्किल्स YAML frontmatter के साथ markdown कंटेंट का उपयोग करते हैं:

```markdown
---
name: my-skill-name
description: स्किल की संक्षिप्त विवरण
license: MIT
compatibility: Node.js 18+ के साथ काम करता है
allowed-tools: read_file write_file run_command
metadata:
  author: your-name
  version: "1.0.0"
---

# My Skill

AI एजेंट के लिए विस्तृत निर्देश...
```

| फ़ील्ड          | आवश्यक | अधिकतम आकार | विवरण                                           |
| ---------------- | -------- | ------------ | ------------------------------------------------ |
| `name`           | हाँ     | 64 chars     | केवल लोअरकेस अल्फान्यूमेरिक डैश के साथ          |
| `description`    | हाँ     | 1024 chars   | स्किल की संक्षिप्त विवरण                         |
| `license`        | नहीं    | -            | लाइसेंस ID (जैसे MIT, Apache-2.0)                |
| `compatibility`  | नहीं    | 500 chars    | कम्पैटिबिलिटी नोट्स                              |
| `allowed-tools`  | नहीं    | -            | अनुमत टूल्स की स्पेस-सेपरेटेड लिस्ट              |
| `metadata`       | नहीं    | -            | अतिरिक्त की-वैल्यू मेटाडेटा                      |

### इनपुट प्रीफिक्सेस

Autohand प्रॉम्प्ट इनपुट में विशेष प्रीफिक्सेस का समर्थन करता है:

| प्रीफिक्स | विवरण                           | उदाहरण                            |
| ---------- | ------------------------------ | --------------------------------- |
| `/`        | स्लैश कमांड्स                   | `/help`, `/model`, `/quit`        |
| `@`        | फाइल मेंशन (ऑटो-कम्प्लीट)        | `@src/index.ts`                   |
| `$`        | स्किल मेंशन (ऑटो-कम्प्लीट)       | `$frontend-design`, `$code-review` |
| `!`        | टर्मिनल कमांड्स सीधे चलाएं        | `! git status`, `! ls -la`        |

**स्किल मेंशन (`$`):**

- ऑटो-कम्प्लीट देखने के लिए `$` के बाद टाइप करें
- Tab मुख्य सुझाव को स्वीकार करता है (जैसे `$frontend-design`)
- स्किल्स `~/.autohand/skills/` और `<project>/.autohand/skills/` से खोजे जाते हैं
- सक्रिय स्किल्स सत्र के लिए प्रॉम्प्ट में विशेष निर्देश के रूप में जोड़े जाते हैं
- प्रीव्यू पैनल स्किल मेटाडेटा दिखाता है (नाम, विवरण, सक्रियता स्थिति)

**शेल कमांड्स (`!`):**

- आपके वर्तमान वर्किंग डायरेक्टरी में निष्पादित
- आउटपुट सीधे टर्मिनल में दिखाया जाता है
- LLM को नहीं जाता
- 30 सेकंड का टाइमआउट
- निष्पादन के बाद प्रॉम्प्ट पर वापस

### स्लैश कमांड

#### `/skills` — पैकेज मैनेजर

| कमांड                           | विवरण                                          |
| ------------------------------- | ---------------------------------------------- |
| `/skills`                       | सभी उपलब्ध स्किल्स की सूची                     |
| `/skills use <name>`            | वर्तमान सत्र के लिए स्किल सक्रिय करें          |
| `/skills deactivate <name>`     | स्किल निष्क्रिय करें                           |
| `/skills info <name>`           | स्किल की विस्तृत जानकारी दिखाएं                |
| `/skills install`               | कम्युनिटी रजिस्ट्री से ब्राउज़ और इंस्टॉल करें |
| `/skills install @<slug>`       | स्लग द्वारा कम्युनिटी स्किल इंस्टॉल करें       |
| `/skills search <query>`        | कम्युनिटी स्किल रजिस्ट्री में खोजें            |
| `/skills trending`              | ट्रेंडिंग कम्युनिटी स्किल्स दिखाएं             |
| `/skills remove <slug>`         | कम्युनिटी स्किल अनइंस्टॉल करें                 |
| `/skills new`                   | इंटरैक्टिव रूप से नया स्किल बनाएं              |
| `/skills feedback <slug> <1-5>` | कम्युनिटी स्किल को रेट करें                    |

#### `/learn` — LLM-संचालित स्किल सलाहकार

| कमांड           | विवरण                                                                        |
| --------------- | ---------------------------------------------------------------------------- |
| `/learn`        | प्रोजेक्ट का विश्लेषण करें और स्किल्स की सिफारिश करें (त्वरित स्कैन)         |
| `/learn deep`   | अधिक सटीक परिणामों के लिए डीप-स्कैन (सोर्स फाइलें पढ़ता है)                  |
| `/learn update` | प्रोजेक्ट का पुनर्विश्लेषण करें और पुराने LLM-जनित स्किल्स को पुनर्जनित करें |

`/learn` दो-चरणीय LLM फ्लो का उपयोग करता है:

1. **चरण 1 — विश्लेषण + रैंकिंग + ऑडिट**: प्रोजेक्ट संरचना स्कैन करता है, इंस्टॉल किए गए स्किल्स की अतिरेक/विरोध के लिए ऑडिट करता है, और कम्युनिटी स्किल्स को प्रासंगिकता (0-100) के अनुसार रैंक करता है।
2. **चरण 2 — जनरेशन** (सशर्त): यदि कोई कम्युनिटी स्किल 60 से अधिक स्कोर नहीं करता, तो आपके प्रोजेक्ट के लिए अनुकूलित कस्टम स्किल जनरेट करने का प्रस्ताव देता है।

### स्वचालित स्किल जनरेशन (`--auto-skill`)

`--auto-skill` CLI फ्लैग इंटरैक्टिव सलाहकार फ्लो के बिना स्किल्स जनरेट करता है:

```bash
autohand --auto-skill
```

यह करेगा:

1. प्रोजेक्ट संरचना का विश्लेषण (package.json, requirements.txt, आदि)
2. भाषाओं, फ्रेमवर्क और पैटर्न का पता लगाना
3. LLM का उपयोग करके 3 प्रासंगिक स्किल्स जनरेट करना
4. स्किल्स को `<project>/.autohand/skills/` में सहेजना

अधिक सटीक इंटरैक्टिव अनुभव के लिए, सत्र के अंदर `/learn` का उपयोग करें।

---

## पूर्ण उदाहरण

### JSON फॉर्मेट (`~/.autohand/config.json`)

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
    "enableRequestQueue": true
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

| फ्लैग                       | विवरण                                                                                           |
| --------------------------- | ----------------------------------------------------------------------------------------------- |
| `--model <model>`           | मॉडल ओवरराइड करें                                                                               |
| `--path <path>`             | वर्कस्पेस रूट ओवरराइड करें                                                                      |
| `--worktree [name]`         | सेशन को अलग git worktree में चलाएँ (वैकल्पिक worktree/branch नाम)                               |
| `--tmux`                    | समर्पित tmux सेशन में शुरू करें (`--worktree` निहित; `--no-worktree` के साथ उपयोग नहीं कर सकते) |
| `--add-dir <path>`          | वर्कस्पेस स्कोप में अतिरिक्त डायरेक्टरी जोड़ें (कई बार उपयोग किया जा सकता है)                   |
| `--config <path>`           | कस्टम कॉन्फिग फाइल का उपयोग करें                                                                |
| `--temperature <n>`         | टेम्परेचर सेट करें (0-1)                                                                        |
| `--yes`                     | प्रॉम्प्ट्स ऑटो-कन्फर्म करें                                                                    |
| `--dry-run`                 | एक्जीक्यूट किए बिना प्रीव्यू करें                                                               |
| `--unrestricted`            | कोई अप्रूवल प्रॉम्प्ट नहीं                                                                      |
| `--restricted`              | खतरनाक ऑपरेशन अस्वीकार करें                                                                     |
| `--setup`                   | Autohand को कॉन्फ़िगर या रीकॉन्फ़िगर करने के लिए सेटअप विज़ार्ड चलाएं                           |
| `--auto-skill`              | प्रोजेक्ट विश्लेषण के आधार पर स्किल्स स्वचालित रूप से जनरेट करें (`/learn` भी देखें)            |
| `--sys-prompt <मान>`        | पूरे सिस्टम प्रॉम्प्ट को बदलें (इनलाइन स्ट्रिंग या फ़ाइल पथ)                                    |
| `--append-sys-prompt <मान>` | सिस्टम प्रॉम्प्ट में जोड़ें (इनलाइन स्ट्रिंग या फ़ाइल पथ)                                       |

---

## सिस्टम प्रॉम्प्ट कस्टमाइज़ेशन

Autohand AI एजेंट द्वारा उपयोग किए जाने वाले सिस्टम प्रॉम्प्ट को कस्टमाइज़ करने की अनुमति देता है। यह विशेष वर्कफ़्लो, कस्टम निर्देशों, या अन्य सिस्टम के साथ एकीकरण के लिए उपयोगी है।

### CLI फ्लैग्स

| फ्लैग                       | विवरण                                        |
| --------------------------- | -------------------------------------------- |
| `--sys-prompt <मान>`        | पूरे सिस्टम प्रॉम्प्ट को बदलें               |
| `--append-sys-prompt <मान>` | डिफ़ॉल्ट सिस्टम प्रॉम्प्ट में सामग्री जोड़ें |

दोनों फ्लैग्स स्वीकार करते हैं:

- **इनलाइन स्ट्रिंग**: सीधा टेक्स्ट कंटेंट
- **फ़ाइल पथ**: प्रॉम्प्ट वाली फ़ाइल का पथ (ऑटो-डिटेक्टेड)

### फ़ाइल पथ डिटेक्शन

एक मान फ़ाइल पथ के रूप में माना जाता है यदि:

- `./`, `../`, `/`, या `~/` से शुरू होता है
- Windows ड्राइव लेटर से शुरू होता है (जैसे, `C:\`)
- `.txt`, `.md`, या `.prompt` से समाप्त होता है
- बिना स्पेस के पथ सेपरेटर शामिल हैं

अन्यथा, इसे इनलाइन स्ट्रिंग के रूप में माना जाता है।

### `--sys-prompt` (पूर्ण प्रतिस्थापन)

जब प्रदान किया जाता है, यह डिफ़ॉल्ट सिस्टम प्रॉम्प्ट को **पूरी तरह से बदल** देता है। एजेंट लोड नहीं करेगा:

- Autohand डिफ़ॉल्ट निर्देश
- AGENTS.md प्रोजेक्ट निर्देश
- यूज़र/प्रोजेक्ट मेमोरी
- एक्टिव स्किल्स

```bash
# इनलाइन स्ट्रिंग
autohand --sys-prompt "आप एक Python विशेषज्ञ हैं। संक्षिप्त रहें।" --prompt "hello world लिखें"

# फ़ाइल से
autohand --sys-prompt ./custom-prompt.txt --prompt "इस कोड की व्याख्या करें"
```

### `--append-sys-prompt` (डिफ़ॉल्ट में जोड़ें)

जब प्रदान किया जाता है, यह पूर्ण डिफ़ॉल्ट सिस्टम प्रॉम्प्ट में सामग्री **जोड़ता** है। एजेंट सभी डिफ़ॉल्ट निर्देश लोड करना जारी रखेगा।

```bash
# इनलाइन स्ट्रिंग
autohand --append-sys-prompt "हमेशा JavaScript के बजाय TypeScript का उपयोग करें" --prompt "एक फ़ंक्शन बनाएं"

# फ़ाइल से
autohand --append-sys-prompt ./team-guidelines.md --prompt "एरर हैंडलिंग जोड़ें"
```

### प्राथमिकता

जब दोनों फ्लैग्स प्रदान किए जाते हैं:

1. `--sys-prompt` की पूर्ण प्राथमिकता है
2. `--append-sys-prompt` को अनदेखा किया जाता है

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
