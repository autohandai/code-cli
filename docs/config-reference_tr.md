# Autohand Yapılandırma Referansı

`~/.autohand/config.json` (veya `.toml`/`.yaml`/`.yml`) içindeki tüm yapılandırma seçenekleri için tam referans.

> **İpucu:** Aşağıdaki ayarların çoğu, dosyayı manuel olarak düzenlemek yerine `/settings` komutu kullanılarak etkileşimli olarak değiştirilebilir.

Yerelleştirilmiş referanslar:

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

## İçindekiler

- [Yapılandırma Dosyası Konumu](#configuration-file-location)
- [Ortam Değişkenleri](#environment-variables)
- [Çıplak Mod](#bare-mode)
- [Sağlayıcı Ayarları](#provider-settings)
- [Çalışma Alanı Ayarları](#workspace-settings)
- [Kullanıcı Arayüzü Ayarları](#ui-settings)
- [Temsilci Ayarları](#agent-settings)
- [İzin Ayarları](#permissions-settings)
- [Yama Modu](#patch-mode)
- [Ağ Ayarları](#network-settings)
- [Telemetri Ayarları](#telemetry-settings)
- [Harici Aracılar](#external-agents)
- [Beceri Sistemi](#skills-system)
- [API Ayarları](#api-settings)
- [Kimlik Doğrulama Ayarları](#authentication-settings)
- [Topluluk Becerileri Ayarları](#community-skills-settings)
- [Paylaşım Ayarları](#share-settings)
- [Ayar Senkronizasyonu](#settings-sync)
- [Kanca Ayarları](#hooks-settings)
- [MCP Ayarları](#mcp-settings)
- [Chrome Uzantı Ayarları](#chrome-extension-settings)
- [Örneğin Tamamı](#complete-example)

---

## Yapılandırma Dosyası Konumu

Autohand yapılandırmayı şu sırayla arar:

1. `AUTOHAND_CONFIG` ortam değişkeni (özel yol)
2. `~/.autohand/config.toml`
3. `~/.autohand/config.yaml`
4. `~/.autohand/config.yml`
5. `~/.autohand/config.json` (varsayılan)

Ayrıca temel dizini de geçersiz kılabilirsiniz:
```bash
export AUTOHAND_HOME=/custom/path  # Changes ~/.autohand to /custom/path
```
---

## Ortam Değişkenleri

| Değişken | Açıklama | Örnek |
| --------------------------------------- | ------------------------------------------------ | -------------------------------- |
| `AUTOHAND_HOME` | Tüm Autohand verileri için temel dizin | `/custom/path` |
| `AUTOHAND_CONFIG` | Özel yapılandırma dosyası yolu | `/path/to/config.toml` |
| `AUTOHAND_API_URL` | API uç noktası (yapılandırmayı geçersiz kılar) | `https://api.autohand.ai` |
| `AUTOHAND_SECRET` | Şirket/ekip gizli anahtarı | `sk-xxx` |
| `AUTOHAND_PERMISSION_CALLBACK_URL` | İzin geri çağırma URL'si (deneysel) | `http://localhost:3000/callback` |
| `AUTOHAND_PERMISSION_CALLBACK_TIMEOUT` | MS cinsinden izin geri aramasında zaman aşımı | `5000` |
| `AUTOHAND_NON_INTERACTIVE` | Etkileşimli olmayan modda çalıştırın | `1` |
| `AUTOHAND_YES` | Tüm istemleri otomatik olarak onayla | `1` |
| `AUTOHAND_NO_BANNER` | Başlangıç ​​banner'ını devre dışı bırak | `1` |
| `AUTOHAND_STREAM_TOOL_OUTPUT` | Araç çıktısını gerçek zamanlı olarak yayınlayın | `1` |
| `AUTOHAND_DEBUG` | Hata ayıklama günlüğünü etkinleştir | `1` |
| `AUTOHAND_THINKING_LEVEL` | Akıl yürütme derinlik düzeyini ayarlayın | `normal` |
| `AUTOHAND_CLIENT_NAME` | İstemci/düzenleyici tanımlayıcısı (ACP uzantıları tarafından belirlenir) | `zed` |
| `AUTOHAND_CLIENT_VERSION` | İstemci sürümü (ACP uzantıları tarafından ayarlanır) | `0.169.0` |
| `AUTOHAND_CODE` | Ortam algılama bayrağı (otomatik olarak ayarlanır) | `1` |
| `AUTOHAND_CODE_SIMPLE` | `--bare` kodunu geçmeden çıplak modu etkinleştirin | `1` |

### Düşünme Seviyesi

`AUTOHAND_THINKING_LEVEL` ortam değişkeni, modelin kullandığı muhakemenin derinliğini kontrol eder:

| Değer | Açıklama |
| ---------- | ------------------------------------------------------- |
| `none` | Görünür gerekçeler olmadan doğrudan yanıtlar |
| `normal` | Standart muhakeme derinliği (varsayılan) |
| `extended` | Karmaşık görevler için derin akıl yürütme, daha ayrıntılı düşünce sürecini gösterir |

Bu genellikle ACP istemci uzantıları (Zed gibi) tarafından yapılandırma açılır menüsü aracılığıyla ayarlanır.
```bash
# Example: Use extended thinking for complex tasks
AUTOHAND_THINKING_LEVEL=extended autohand --prompt "refactor this module"
```
---

## Çıplak Mod

Çıplak mod, Autohand öğesini yalnızca açıkça istenen bağlam ve çalışma zamanı entegrasyonlarıyla başlatır. Şunlardan biriyle etkinleştirin:
```bash
autohand --bare
AUTOHAND_CODE_SIMPLE=1 autohand
```
`--bare` iletildiğinde, Autohand ayrıca çalışan işlem için `AUTOHAND_CODE_SIMPLE=1` değerini de ayarlar.

Çıplak mod, otomatik başlatmayı ve etkileşimli entegrasyonları devre dışı bırakır:

- kancalar ve kanca bildirimleri
- LSP başlangıcı
- eklenti senkronizasyonu, eklenti otomatik yükleme ve meta araç otomatik yükleme
- ilişkilendirme, telemetri, oturum senkronizasyonu, otomatik raporlama ve arka plan ping'leri
- otomatik bellek/oturum önyükleme bağlamı
- arka planda bilgi istemi önerileri, güncelleme kontrolleri, özellik bayrağı getirmeleri ve model meta verilerinin önceden getirilmesi
- anahtarlık ve tarayıcı OAuth kimlik doğrulaması geri dönüşü
- otomatik `AGENTS.md` ve sağlayıcı talimatı keşfi
- istemde yazılan çıplak `/` dahil tüm eğik çizgi komutları

`/Users/alex/project/file.ts` gibi eğik çizgi şeklindeki mutlak dosya yolları hâlâ normal bilgi istemi metni olarak kabul edilir. `/help`, `/model` veya `/mcp` gibi komut şeklindeki eğik çizgi girişi, `Slash commands are disabled in bare mode.` yazdırır ve yürütülmez.

Çıplak modda kimlik doğrulama yalnızca açıktır. Autohand önce `AUTOHAND_API_KEY` okur, ardından yapılandırılmışsa `auth.apiKeyHelper` okur. Anahtarlık kimlik bilgilerini okumaz veya OAuth/tarayıcı oturum açma işlemini başlatmaz. Üçüncü taraf sağlayıcılar, sağlayıcıya özel API anahtarlarını ve yapılandırmalarını kullanmaya devam eder.

Bu açık girişler çıplak modda kullanılabilir durumda kalır:

| Giriş | Açıklama |
| ----------------------------- | -------------------------------------------------------------- |
| `--system-prompt <value>` | Sistem istemini satır içi metinle veya yol benzeri bir değerle değiştirin |
| `--system-prompt-file <path>` | Sistem istemini dosya içeriğiyle değiştirin |
| `--append-system-prompt <value>` | Sistem istemine satır içi metin veya yola benzer bir değer ekleyin |
| `--append-system-prompt-file <path>` | Dosya içeriğini sistem istemine ekleyin |
| `--add-dir <path...>` | Çalışma alanı kapsamına açık dizinler ekleme |
| `--mcp-config <path>` | Açık bir MCP yapılandırma dosyası yükleyin |
| `--settings` | Ayarları doğrudan CLI bayrağından açın |
| `--config <path>` | Açık bir Autohand yapılandırma dosyası kullanın |
| `--agents <json\|path>` | Açık satır içi aracılar JSON'u veya açık bir aracılar dizinini yükleyin |
| `--plugin-dir <path>` | Açık bir eklenti/meta araç dizini yükleyin |

---

## Sağlayıcı Ayarları

### `provider`

Kullanılacak aktif LLM sağlayıcısı.

| Değer | Açıklama |
| -------------- | ---------------------------- |
| `"openrouter"` | OpenRouter API'si (varsayılan) |
| `"ollama"` | Yerel Ollama örneği |
| `"llamacpp"` | Yerel lama.cpp sunucusu |
| `"openai"` | OpenAI API'sini doğrudan |
| `"mlx"` | Apple Silicon'da MLX (yerel) |
| `"llmgateway"` | Yüksek Lisans Ağ Geçidi birleştirilmiş API |
| `"deepseek"` | DeepSeek API'si |
| `"zai"` | Za.ai GLM API |
| `"sakana"` | Sakana.AI Fugu API'si |
| `"bedrock"` | AWS Ana Kayası |
| `"custom:<id>"` | `customProviders` adresinden kullanıcı tanımlı OpenAI uyumlu sağlayıcı |

### `openrouter`

OpenRouter sağlayıcı yapılandırması.
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
| Alan | Tür | Gerekli | Varsayılan | Açıklama |
| --------------- | ------ | -------- | ------------------------------ | ----------------------------------------------------------------- |
| `apiKey` | dize | Evet | - | OpenRouter API anahtarınız |
| `baseUrl` | dize | Hayır | `https://openrouter.ai/api/v1` | API uç noktası |
| `model` | dize | Evet | - | Model tanımlayıcı (ör. `your-modelcard-id-here`) |
| `contextWindow` | sayı | Hayır | Otomatik | Tam model bağlam penceresi. Autohand bilindiğinde bunu OpenRouter'dan doldurur. |

### `zai`

Z.ai sağlayıcı yapılandırması.
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
| Alan | Tür | Gerekli | Varsayılan | Açıklama |
| --------------- | ------ | -------- | ------------------------------ | ------------------------------------------------------------------ |
| `apiKey` | dize | Evet | - | Z.ai API anahtarınız |
| `baseUrl` | dize | Hayır | `https://api.z.ai/api/paas/v4` | API uç noktası |
| `model` | dize | Evet | `glm-5.2` | Model tanımlayıcı, örneğin `glm-5.2`, `glm-5.1` veya `glm-4.5` |
| `contextWindow` | sayı | Hayır | Otomatik | Tam model bağlam penceresi. Autohand, GLM-5.2 için 1 milyon ve GLM-5.1 için 200 bin anlamına gelir. |

### `sakana`

Sakana.AI sağlayıcı yapılandırması. API OpenAI uyumludur ve temel URL olarak `https://api.sakana.ai/v1` kullanır.
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
| Alan | Tür | Gerekli | Varsayılan | Açıklama |
| --------------- | ------ | -------- | ----------------------------- | ------------------------------------------------------------------ |
| `apiKey` | dize | Evet | - | Sakana API anahtarınız |
| `baseUrl` | dize | Hayır | `https://api.sakana.ai/v1` | API uç noktası |
| `model` | dize | Evet | `fugu` | Model tanımlayıcı, örneğin `fugu` veya `fugu-ultra` |
| `contextWindow` | sayı | Hayır | Otomatik | Tam model bağlam penceresi. Autohand Fugu modelleri için 1 milyon anlamına gelir.   |

### `customProviders`

Özel sağlayıcılar, kullanıcıların kod değişikliği veya yeni bir paket sağlayıcı olmadan OpenAI uyumlu bir uç nokta getirmesine olanak tanır. Sağlayıcıyı `customProviders` altına ekleyin ve ardından `provider: "custom:<id>"` ile seçin. Aynı akış `/model` adresinden **Yeni sağlayıcı...** ile mevcuttur. Kurulum sırasında Autohand, sağlayıcıyı kaydetmeden önce temel URL'yi, kimlik doğrulamayı ve seçilen modeli OpenAI uyumlu `/models` uç noktası aracılığıyla doğrular.
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
Kimlik doğrulama gerektirmeyen yerel OpenAI uyumlu sunucular için `apiKeyRequired` değerini `false` olarak ayarlayın ve `apiKey` atlayın.

| Alan | Tür | Gerekli | Varsayılan | Açıklama |
| ----------------- | ------- | -------- | ------- | ----------- |
| `id` | dize | Evet | - | Kararlı sağlayıcı kimliği. Nesne anahtarıyla eşleşmelidir ve `custom:<id>` olarak seçilir. |
| `displayName` | dize | Evet | - | `/model` ve sağlayıcı ayarlarında gösterilen ad. |
| `apiFormat` | dize | Evet | - | `openai-compatible` olmalıdır. |
| `baseUrl` | dize | Evet | - | `https://api.example.com/v1` gibi uç nokta kökü. Autohand, `/models`'yi doğruluyor ve `/chat/completions`'yi çağırıyor. |
| `apiKey` | dize | Koşullu | - | Barındırılan uç noktalar için taşıyıcı belirteci. `apiKeyRequired` doğru olduğunda gereklidir. |
| `apiKeyRequired` | boole | Hayır | `true` | Yerel veya zaten kimliği doğrulanmış ağ geçitleri için false değerini ayarlayın. |
| `model` | dize | Evet | - | Etkin model kimliği. |
| `contextWindow` | sayı | Hayır | Otomatik | Belirteç bütçeleme, durum, telemetri ve senkronizasyon meta verileri için tam bağlam penceresi. |
| `reasoningEffort` | dize | Hayır | - | İsteğe bağlı `none`, `low`, `medium`, `high` veya `xhigh`. Özel OpenAI uyumlu istekler için `reasoning_effort` olarak gönderildi. |
| `models` | dizi | Hayır | - | Model başına bağlam ve akıl yürütme meta verileriyle isteğe bağlı model seçici girişleri. |

### `ollama`

Ollama sağlayıcı yapılandırması.
```json
{
  "ollama": {
    "baseUrl": "http://localhost:11434",
    "port": 11434,
    "model": "llama3.2"
  }
}
```
| Alan | Tür | Gerekli | Varsayılan | Açıklama |
| --------- | ------ | -------- | ------------------------ | ------------------------------- |
| `baseUrl` | dize | Hayır | `http://localhost:11434` | Ollama sunucu URL'si |
| `port` | sayı | Hayır | `11434` | Sunucu bağlantı noktası (baseUrl'ye alternatif) |
| `model` | dize | Evet | - | Model adı (ör. `llama3.2`, `codellama`) |

### `llamacpp`

lama.cpp sunucu yapılandırması.
```json
{
  "llamacpp": {
    "baseUrl": "http://localhost:8080",
    "port": 8080,
    "model": "default"
  }
}
```
| Alan | Tür | Gerekli | Varsayılan | Açıklama |
| --------- | ------ | -------- | ----------------------- | -------------------- |
| `baseUrl` | dize | Hayır | `http://localhost:8080` | lama.cpp sunucu URL'si |
| `port` | sayı | Hayır | `8080` | Sunucu bağlantı noktası |
| `model` | dize | Evet | - | Model tanımlayıcı |

### `openai`

OpenAI API yapılandırması.
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
OpenAI ayrıca ChatGPT aboneliğinizi Autohand'nin yerleşik OpenAI oturum açma akışı aracılığıyla da kullanabilir:
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
| Alan | Tür | Gerekli | Varsayılan | Açıklama |
| --------------- | ------ | ----------------------- | ----------------- | -------------------------------------------------------------- |
| `authMode` | dize | Hayır | `api-key` | Kimlik doğrulama modu: `api-key` veya `chatgpt` |
| `apiKey` | dize | `api-key` modu için evet | - | OpenAI API anahtarı |
| `baseUrl` | dize | Hayır | `https://api.openai.com/v1` | API uç noktası |
| `model` | dize | Evet | - | Model adı (ör. `gpt-5.4`, `gpt-5.4-mini`) |
| `contextWindow` | sayı | Hayır | Otomatik | Tam model bağlam penceresi. Eski yerel varsayımları geçersiz kılmak için bunu ayarlayın. |
| `chatgptAuth` | nesne | `chatgpt` modu için evet | - | Saklanan ChatGPT/Codex kimlik doğrulama jetonları ve hesap kimliği |

### `mlx`

Apple Silicon Mac'ler için MLX sağlayıcısı (yerel çıkarım).
```json
{
  "mlx": {
    "baseUrl": "http://localhost:8080",
    "port": 8080,
    "model": "mlx-community/Llama-3.2-3B-Instruct-4bit"
  }
}
```
| Alan | Tür | Gerekli | Varsayılan | Açıklama |
| --------- | ------ | -------- | ----------------------- | -------------------- |
| `baseUrl` | dize | Hayır | `http://localhost:8080` | MLX sunucusu URL'si |
| `port` | sayı | Hayır | `8080` | Sunucu bağlantı noktası |
| `model` | dize | Evet | - | MLX model tanımlayıcı |

### `llmgateway`

LLM Ağ Geçidi birleştirilmiş API yapılandırması. Tek bir API aracılığıyla birden fazla LLM sağlayıcısına erişim sağlar.
```json
{
  "llmgateway": {
    "apiKey": "your-llmgateway-api-key",
    "baseUrl": "https://api.llmgateway.io/v1",
    "model": "gpt-4o"
  }
}
```
| Alan | Tür | Gerekli | Varsayılan | Açıklama |
| --------- | ------ | -------- | ------------------------------ | ---------------------------------------------- |
| `apiKey` | dize | Evet | - | Yüksek Lisans Ağ Geçidi API anahtarı |
| `baseUrl` | dize | Hayır | `https://api.llmgateway.io/v1` | API uç noktası |
| `model` | dize | Evet | - | Model adı (ör. `gpt-4o`, `claude-3-5-sonnet-20241022`) |

**API Anahtarı Alma:**
Bir hesap oluşturmak ve API anahtarınızı almak için [llmgateway.io/dashboard](https://llmgateway.io/dashboard) adresini ziyaret edin.

**Desteklenen Modeller:**
LLM Gateway, aşağıdakiler de dahil olmak üzere birden fazla sağlayıcının modellerini destekler:

- OpenAI: `gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo`
`claude-3-5-haiku-20241022`
- Google: `gemini-1.5-pro`, `gemini-1.5-flash`

### `deepseek`

DeepSeek sağlayıcı yapılandırması. API OpenAI uyumludur ve temel URL olarak `https://api.deepseek.com` kullanır.
```json
{
  "deepseek": {
    "apiKey": "your-deepseek-api-key",
    "baseUrl": "https://api.deepseek.com",
    "model": "deepseek-v4-flash"
  }
}
```
| Alan | Tür | Gerekli | Varsayılan | Açıklama |
| --------- | ------ | -------- | -------------------------- | -------------------------------------------------------------- |
| `apiKey` | dize | Evet | - | DeepSeek API anahtarı |
| `baseUrl` | dize | Hayır | `https://api.deepseek.com` | API uç noktası |
| `model` | dize | Evet | - | Model adı, örneğin `deepseek-v4-flash` veya `deepseek-v4-pro` |

### `bedrock`

AWS Bedrock sağlayıcı yapılandırması. `converse` varsayılan moddur ve AWS SDK kimlik bilgisi zincirini kullanır. OpenAI uyumlu modlar, Bedrock API anahtarlarını ve Bedrock OpenAI uyumlu uç noktaları kullanır.
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
| Alan | Tür | Gerekli | Varsayılan | Açıklama |
| ---------- | ------ | -------- | ------- | ----------- |
| `model` | dize | Evet | - | Ana kaya modeli kimliği, çıkarım profili kimliği veya ARN |
| `region` | dize | Evet | Kurulumda `AWS_REGION`, ardından `AWS_DEFAULT_REGION`, ardından `us-east-1` | AWS bölgesi |
| `apiMode` | dize | Hayır | `converse` | `converse`, `openai-chat` veya `openai-responses` |
| `authMode` | dize | Hayır | `converse` için `aws-credentials`, OpenAI uyumlu modlar için `bedrock-api-key` | Kimlik doğrulama modu |
| `profile` | dize | Hayır | - | Kimlik bilgisi zinciri kimlik doğrulaması için isteğe bağlı AWS profili |
| `endpoint` | dize | Hayır | Mod ve bölgeden türetilmiştir | Özel/özel Bedrock uç noktası |
| `apiKey` | dize | OpenAI uyumlu modlar için Evet | - | Temel kaya API anahtarı. OpenAI API anahtarlarını kullanmayın. |

Profil tabanlı AWS kimlik doğrulaması için `aws configure sso` komutunu çalıştırın veya `AWS_PROFILE=enterprise-prod autohand` değerini ayarlayın. IAM rolü, kapsayıcı ve örnek meta veri kimlik bilgileri AWS SDK tarafından desteklenir. Bir modeli kullanmadan önce AWS konsolunda model erişimini etkinleştirin.

---

## Çalışma Alanı Ayarları
```json
{
  "workspace": {
    "defaultRoot": "/path/to/projects",
    "allowDangerousOps": false
  }
}
```
| Alan | Tür | Varsayılan | Açıklama |
| ------------------- | ------- | ----------------- | -------------------------------------------------- |
| `defaultRoot` | dize | Geçerli dizin | Hiçbiri belirtilmediğinde varsayılan çalışma alanı |
| `allowDangerousOps` | boole | `false` | Onay olmadan yıkıcı işlemlere izin ver |

### Çalışma Alanı Güvenliği

Autohand kazara hasarı önlemek için tehlikeli dizinlerdeki işlemleri otomatik olarak engeller:

- **Dosya sistemi kökleri** (`/`, `C:\`, `D:\`, vb.)
- **Ana dizinler** (`~`, `/Users/<user>`, `/home/<user>`, `C:\Users\<user>`)
- **Sistem dizinleri** (`/etc`, `/var`, `/System`, `C:\Windows`, vb.)
- **WSL Windows bağlantıları** (`/mnt/c`, `/mnt/c/Users/<user>`)

Bu kontrol atlanamaz. autohand dosyasını tehlikeli bir dizinde çalıştırmayı denerseniz bir hata görürsünüz ve güvenli bir proje dizini belirtmeniz gerekir.
```bash
# This will be blocked
cd ~ && autohand
# Error: Unsafe Workspace Directory

# This works
cd ~/projects/my-app && autohand
```
Tüm ayrıntılar için [Çalışma Alanı Güvenliği](./workspace-safety.md) konusuna bakın.

---

## Kullanıcı Arayüzü Ayarları
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
| Alan | Tür | Varsayılan | Açıklama |
| ---------------------------- | ------ | ------- | ---------------------------------------------------------------------------------------------- |
| `theme` | dize | `"dark"` | Terminal çıkışı için renk teması. Yerleşikler arasında `dark`, `light`, `dracula`, `sandy`, `tui`, `github-dark`, `cappadocia`, `rio` ve `australia` bulunur. Eski `turkey` ve `brazil` değerleri hâlâ takma ad olarak yükleniyor. |
| `customThemes` | nesne | `{}` | Tema adına göre anahtarlanan satır içi özel tema tanımları. Birini kullanmak için `theme` değerini aynı tuşa ayarlayın.   |
| `autoConfirm` | boole | `false` | Güvenli işlemler için onay istemlerini atlayın |
| `readFileCharLimit` | sayı | `300` | Okuma/bulma aracı çıktısından görüntülenecek maksimum karakter (tam içerik hâlâ modele gönderilmektedir) |
| `silentToolOutput` | boole | `false` | Model/oturum için araç sonuçlarını korurken terminaldeki araç çıkış bloklarını gizleyin |
| `activityVerbs` | dize veya dize[] | yerleşik havuz | Çalışma göstergesi için özel etkinlik fiili veya fiil havuzu, `Verb...` olarak işlendi |
| `activityVerbsEnabled` | boole | `true` | Aracı çalışırken `Compiling...` gibi dönüşümlü etkinlik fiillerini göster |
| `activitySymbol` | dize | `"✳"` | Etkinlik göstergesi çıktısında etkinlik fiilinden önce gösterilen sembol |
| `statusLine.showProviderModel` | boole | `true` | Aktif sağlayıcıyı ve modeli besteci durum satırında göster |
| `statusLine.showContext` | boole | `true` | Besteci durum satırında bağlam yüzdesini göster |
| `statusLine.showCommandHint` | boole | `true` | Besteci durum satırında komut, bahsetme, beceri ve terminal girişi ipuçlarını göster |
| `statusLine.showPullRequest` | boole | `true` | İlişkili çekme isteği numarasını veya hiçbir PR ilişkilendirilmediğinde `PR #123` değerini gösterin |
| `statusLine.showSessionLines` | boole | `false` | Geçerli oturum sırasında eklenen ve kaldırılan satırları göster |
| `statusLine.showQueue` | boole | `true` | Sıraya alınan istek sayılarını durum satırında göster |
| `statusLine.showActiveStatus` | boole | `true` | Temsilci çalışırken etkin dönüş durumu metnini göster |
| `statusLine.showActiveMetrics` | boole | `true` | Temsilci çalışırken geçen süreyi ve belirteç ölçümlerini göster |
| `statusLine.showCancelHint` | boole | `true` | Temsilci çalışırken Esc iptal ipucunu göster |
| `completionReportEnabled` | boole | `true` | Tamamlanan eylem dönüşlerinden sonra modelden kısa bir tamamlanma raporu eklemesini isteyin |
| `showCompletionNotification` | boole | `true` | Görev tamamlandığında sistem bildirimini göster |
| `showThinking` | boole | `true` | Yüksek Lisans'ın muhakeme/düşünce sürecini görüntüleyin |
| `terminalBell` | boole | `true` | Görev tamamlandığında terminal zilini çalın (terminal sekmesinde/dock'ta rozeti gösterir) |
| `checkForUpdates` | boole | `true` | Başlangıçta CLI güncellemelerini kontrol edin |
| `updateCheckInterval` | sayı | `24` | Güncelleme kontrolleri arasındaki saatler (aralık dahilinde önbelleğe alınan sonucu kullanır) |

Özel temalar herhangi bir anlamsal renk belirtecini geçersiz kılabilir. Eksik jetonlar karanlık temadan alınmıştır:
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
Not: `readFileCharLimit` ve `silentToolOutput` yalnızca terminal ekranını etkiler. İçeriğin tamamı hâlâ modele gönderilmekte ve araç mesajlarında saklanmaktadır.

Dosyayı düzenlemeden sessiz araç çıktısını değiştirebilirsiniz:
```bash
autohand config set silent_tool_output true
autohand config set silent_tool_output false
```
Dosyayı düzenlemeden aktivite fiillerini dönüşümlü olarak değiştirebilirsiniz:
```bash
autohand config set verbs activity true
autohand config set verbs activity false
```
Sabit bir durum etiketi veya projeye özel küçük bir rotasyon istediğinizde, yapılandırma dosyasındaki fiilleri özelleştirin:
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
`activityVerbs` tek bir dizeyi veya boş olmayan bir dize dizisini kabul eder. `activityVerbsEnabled`, `false` olduğunda, Autohand, özel veya yerleşik fiiller arasında geçiş yapmak yerine `Working...` değerine geri döner.

Yapılandırılmış `SITREP` istemi de dahil olmak üzere tamamlama raporlarını dosyayı düzenlemeden değiştirebilirsiniz:
```bash
autohand config set sitrep true
autohand config set sitrep false
```
### Terminal Zili

`terminalBell` etkinleştirildiğinde (varsayılan), bir görev tamamlandığında Autohand terminal zilini (`\x07`) çalar. Bu şunları tetikler:

- **Terminal sekmesindeki rozet** - İşin tamamlandığını gösteren görsel bir gösterge gösterir
- **Dock simgesi geri dönüyor** - Terminal arka plandayken dikkatinizi çeker (macOS)
- **Ses** - Terminal ayarlarınızda terminal sesleri etkinleştirilmişse

Terminale özgü ayarlar:

- **macOS Terminali**: Tercihler > Profiller > Gelişmiş > Zil (Görsel/İşitsel)
- **iTerm2**: Tercihler > Profiller > Terminal > Bildirimler
- **VS Code Terminali**: Ayarlar > Terminal > Entegre: Zili Etkinleştir

Devre dışı bırakmak için:
```json
{
  "ui": {
    "terminalBell": false
  }
}
```
### Mürekkep Oluşturucu

Autohand etkileşimli terminaller için varsayılan olarak Ink 7 + React 19 oluşturucuyu kullanır. Eski `ui.useInkRenderer` yapılandırma alanı göz ardı edilir, böylece eski yapılandırma dosyaları düz terminal oluşturucuyu zorlayamaz. Mürekkep şunları sağlar:

- **Titreşimsiz çıktı**: Tüm kullanıcı arayüzü güncellemeleri React mutabakatı yoluyla toplu olarak gerçekleştirilir
- **Çalışma kuyruğu özelliği**: Temsilci çalışırken talimatları yazın
- **Daha iyi giriş işleme**: Okuma satırı işleyicileri arasında çakışma yok
- **Şekillendirilebilir kullanıcı arayüzü**: Gelecekteki gelişmiş kullanıcı arayüzü özelliklerinin temeli

Terminal uyumluluğu için acil durum geri dönüşü:
```bash
AUTOHAND_LEGACY_UI=1 autohand
```
Not: Bu özellik deneyseldir ve uç durumlara sahip olabilir. Varsayılan ora tabanlı kullanıcı arayüzü kararlı ve tamamen işlevsel kalır.

### Güncelleme Kontrolü

`checkForUpdates` etkinleştirildiğinde (varsayılan), Autohand başlangıçta yeni sürümleri kontrol eder:
```
> Autohand v0.6.8 (abc1234) ✓ Up to date
```
Bir güncelleme mevcutsa:
```
> Autohand v0.6.7 (abc1234) ⬆ Update available: v0.6.8
  ↳ Run: curl -fsSL https://autohand.ai/install.sh | sh
```
Nasıl çalışır:

- GitHub API'sinden en son sürümü getirir
- Önbellekler `~/.autohand/version-check.json` ile sonuçlanır
- Yalnızca `updateCheckInterval` saatte bir kez kontrol eder (varsayılan: 24)
- Engellemesiz: kontrol başarısız olsa bile başlatma devam eder

Devre dışı bırakmak için:
```json
{
  "ui": {
    "checkForUpdates": false
  }
}
```
Veya ortam değişkeni aracılığıyla:
```bash
export AUTOHAND_SKIP_UPDATE_CHECK=1
```
---

## Temsilci Ayarları

Kontrol aracısı davranışı ve yineleme sınırları.
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
| Alan | Tür | Varsayılan | Açıklama |
| -------------------- | ------- | ------- | ------------------------------------------------------------------------------ |
| `maxIterations` | sayı | `100` | Durdurmadan önce kullanıcı isteği başına maksimum araç yinelemesi |
| `enableRequestQueue` | boole | `true` | Aracı çalışırken kullanıcıların istekleri yazmasına ve sıraya koymasına izin ver |
| `toolSelectionCache` | boole | `true` | Eşdeğer takım seçimi girişi için tur başına yerel takım şeması seçimini önbelleğe alın |
| `autoMemory` | boole | `true` | Başarılı etkileşimli dönüşlerden sonra dayanıklı kullanıcı/proje anılarını çıkarın ve kaydedin |
| `idleLogoutEnabled` | boole | `true` | Boşta kalma zaman aşımından sonra kimliği doğrulanmış etkileşimli oturumlardan çıkış yapın |
| `debug` | boole | `false` | Ayrıntılı hata ayıklama çıktısını etkinleştirin (aracının dahili durumunu stderr'e kaydeder) |

### Araç Şeması Seçimi

Autohand her LLM isteğinde her araç şemasının tamamını göndermez. Sistem istemi, kompakt bir araç yetenek kataloğu içerir ve her istek, aşağıdakilerden seçilen yalnızca küçük bir dizi somut şemayı ortaya çıkarır:

- `tool_search`, `read_file`, `fff_find` ve `fff_grep` gibi temel keşif araçları
- Düzenleme, doğrulama, git, tarayıcı, web, bağımlılık veya proje izleme çalışmaları için amaca uygun araçlar
- Son `tool_search` çağrıları yoluyla talep edilen veya açıkça adı geçen araçlar

Bu, kullanıcının amacı bilinmeden önce tüm araç şemalarının gönderilmesinin getirdiği büyük ön bağlam maliyetini ortadan kaldırır. `toolSelectionCache` eşdeğer dönüşler için yalnızca yerel seçici önbelleğini kontrol eder; kullanıcı öncesi LLM ısınması gerçekleştirmez ve önbelleğe alınmış büyük bir bilgi istemi önekini zorlamaz.

Yerel seçici önbelleğini devre dışı bırakmak için:
```json
{
  "agent": {
    "toolSelectionCache": false
  }
}
```
Kimliği doğrulanmış, uzun süredir devam eden temsilci oturumlarını, iş için beklerken canlı tutmak için:
```json
{
  "agent": {
    "idleLogoutEnabled": false
  }
}
```
Tek bir işlem için `autohand --no-idle-logout` kullanın veya `AUTOHAND_NO_IDLE_LOGOUT=1` olarak ayarlayın.

### Hata Ayıklama Modu

Aracının dahili durumunun ayrıntılı günlüğünü görmek için hata ayıklama modunu etkinleştirin (tepki döngüsü yinelemeleri, bilgi istemi oluşturma, oturum ayrıntıları). Normal çıktıya müdahaleyi önlemek için çıktı stderr'e gider.

Hata ayıklama modunu etkinleştirmenin üç yolu (öncelik sırasına göre):

1. **CLI bayrağı**: `autohand -d` veya `autohand --debug`
2. **Ortam değişkeni**: `AUTOHAND_DEBUG=1`
3. **Yapılandırma dosyası**: `agent.debug: true` değerini ayarlayın

### İstek Sırası

`enableRequestQueue` etkinleştirildiğinde, aracı önceki bir isteği işlerken siz mesaj yazmaya devam edebilirsiniz. Geçerli görev tamamlandığında girişiniz sıraya alınacak ve otomatik olarak işlenecektir.

- Mesajınızı yazın ve sıraya eklemek için Enter'a basın
- Durum satırı kaç isteğin sıraya alındığını gösterir
- İstekler FIFO (ilk giren ilk çıkar) sırasına göre işlenir
- Maksimum kuyruk boyutu 10 istektir

---

## İzin Ayarları

Araç izinleri üzerinde ayrıntılı kontrol.
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

| Değer | Açıklama |
| ---------------- | --------------------------------------- |
| `"interactive"` | Tehlikeli işlemlerde onay istemi (varsayılan) |
| `"unrestricted"` | İstem yok, her şeye izin ver |
| `"restricted"` | Tüm tehlikeli işlemleri reddet |

### `whitelist`

Hiçbir zaman onay gerektirmeyen takım modelleri dizisi.
```json
["run_command:npm *", "run_command:bun test"]
```
### `blacklist`

Her zaman engellenen araç desenleri dizisi.
```json
["run_command:rm -rf /", "run_command:sudo *"]
```
### `rules`

İnce taneli izin kuralları.

| Alan | Tür | Açıklama |
| --------- | --------- | --------------------------------- | ---------- | -------------- |
| `tool` | dize | Eşleşecek araç adı |
| `pattern` | dize | Bağımsız değişkenlerle eşleşecek isteğe bağlı model |
| `action` | `"allow"` | `"deny"` | `"prompt"` | Yapılacak işlem |

### `rememberSession`

| Tür | Varsayılan | Açıklama |
| ------- | ------- | --------------------------------- |
| boole | `true` | Oturuma ilişkin onay kararlarını hatırlayın |

### Yerel Proje İzinleri

Her projenin genel yapılandırmayı geçersiz kılan kendi izin ayarları olabilir. Bunlar proje kökünüzde `.autohand/settings.local.json` dosyasında saklanır.

Bir dosya işlemini onayladığınızda (düzenleme, yazma, silme), otomatik olarak bu dosyaya kaydedilir, böylece bu projede aynı işlem için bir daha sizden istenmez.
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
**Nasıl çalışır:**

- Bir işlemi onayladığınızda `.autohand/settings.local.json` dizinine kaydedilir
- Bir dahaki sefere aynı işlem otomatik olarak onaylanacak
- Yerel proje ayarları genel ayarlarla birleştirilir (yerel önceliklidir)
- Kişisel ayarları gizli tutmak için `.gitignore`'ye `.autohand/settings.local.json` ekleyin

**Desen formatı:**

- `tool_name:path` - Dosya işlemleri için (ör. `apply_patch:src/file.ts`)
- `tool_name:command args` - Komutlar için (ör. `run_command:npm test`)

### İzinleri Görüntüleme

Mevcut izin ayarlarınızı iki şekilde görüntüleyebilirsiniz:

**CLI Bayrağı (Etkileşimsiz):**
```bash
autohand --permissions
```
Bu şunu görüntüler:

- Mevcut izin modu (etkileşimli, sınırsız, kısıtlı)
- Çalışma alanı ve yapılandırma dosyası yolları
- Onaylanan tüm modeller (beyaz liste)
- Reddedilen tüm kalıplar (kara liste)
- Özet istatistikler

**Etkileşimli Komut:**
```
/permissions
```
Etkileşimli modda, `/permissions` komutu aşağıdakilere aynı bilgileri ve seçenekleri sağlar:

- Beyaz listedeki öğeleri kaldırın
- Kara listedeki öğeleri kaldırın
- Kaydedilen tüm izinleri temizle

---

## Yama Modu

Yama modu, çalışma alanı dosyalarınızı değiştirmeden, paylaşılabilir, git uyumlu bir yama oluşturmanıza olanak tanır. Bu şu durumlarda faydalıdır:

- Değişiklikleri uygulamadan önce kodun gözden geçirilmesi
- Yapay zeka tarafından oluşturulan değişiklikleri ekip üyeleriyle paylaşma
- Tekrarlanabilir değişiklik setleri oluşturma
- Değişiklikleri uygulamadan yakalaması gereken CI/CD işlem hatları

### Kullanım
```bash
# Generate patch to stdout
autohand --prompt "add user authentication" --patch

# Save to file
autohand --prompt "add user authentication" --patch --output auth.patch

# Pipe to file (alternative)
autohand --prompt "refactor api handlers" --patch > refactor.patch
```
### Davranış

`--patch` belirtildiğinde:

- **Otomatik onayla**: Tüm onaylar otomatik olarak kabul edilir (`--yes` ima edilir)
- **İstem yok**: Onay istemi gösterilmez (`--unrestricted` ima edilir)
- **Yalnızca önizleme**: Değişiklikler yakalanır ancak diske YAZILMAZ
- **Güvenlik zorunlu**: Kara listeye alınan işlemler (`.env`, SSH anahtarları, tehlikeli komutlar) hâlâ engelleniyor

### Yamaların Uygulanması

Alıcılar yamayı standart git komutlarını kullanarak uygulayabilir:
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
### Yama Formatı

Oluşturulan yama, git'in birleştirilmiş fark biçimini takip eder:
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
### Çıkış Kodları

| Kod | Anlamı |
| ---- | --------------------------------------------------- |
| `0` | Başarılı, yama oluşturuldu |
| `1` | Hata (eksik `--prompt`, izin reddedildi vb.) |

### Diğer Bayraklarla Birleştirme
```bash
# Use specific model
autohand --prompt "optimize queries" --patch --model gpt-4o

# Specify workspace
autohand --prompt "add tests" --patch --path ./my-project

# Use custom config
autohand --prompt "refactor" --patch --config ~/.autohand/work.json
```
### Ekip İş Akışı Örneği
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

## Ağ Ayarları
```json
{
  "network": {
    "maxRetries": 3,
    "timeout": 30000,
    "retryDelay": 1000
  }
}
```
| Alan | Tür | Varsayılan | Maksimum | Açıklama |
| ------------ | ------ | ------- | --- | --------------------------------------- |
| `maxRetries` | sayı | `3` | `5` | Başarısız API istekleri için yeniden deneme girişimleri |
| `timeout` | sayı | `30000` | - | Milisaniye cinsinden zaman aşımı isteği |
| `retryDelay` | sayı | `1000` | - | Yeniden denemeler arasındaki milisaniye cinsinden gecikme |

---

## Telemetri Ayarları

Telemetri **varsayılan olarak devre dışıdır** (katılma seçeneği). Autohand'nin iyileştirilmesine yardımcı olmak için bunu etkinleştirin.
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
| Alan | Tür | Varsayılan | Açıklama |
| ------------------- | ------- | ------------------------- | --------------------------------------------- |
| `enabled` | boole | `false` | Telemetriyi etkinleştirme/devre dışı bırakma (katılma) |
| `apiBaseUrl` | dize | `https://api.autohand.ai` | Telemetri API uç noktası |
| `batchSize` | sayı | `20` | Otomatik temizlemeden önce toplu işlenecek olay sayısı |
| `flushIntervalMs` | sayı | `60000` | Milisaniye cinsinden yıkama aralığı (1 dakika) |
| `maxQueueSize` | sayı | `500` | Eski olayları bırakmadan önce maksimum kuyruk boyutu |
| `maxRetries` | sayı | `3` | Başarısız telemetri istekleri için yeniden deneme girişimleri |
| `enableSessionSync` | boole | `true` | Telemetri etkinleştirildiğinde ekip özellikleri için oturumları buluta senkronize edin |
| `companySecret` | dize | `""` | API kimlik doğrulaması için şirket sırrı |

Sağlayıcı/model telemetrisi, etkin sağlayıcı kimliğini, model kimliğini ve özel sağlayıcı görünen adı, API biçimi, akıl yürütme çabası ve bağlam penceresi gibi gizli olmayan mevcut meta verileri içerir. API anahtarları ve taşıyıcı belirteçleri hiçbir zaman dahil edilmez.

---

## Harici Aracılar

Özel aracı tanımlarını harici dizinlerden yükleyin.
```json
{
  "externalAgents": {
    "enabled": true,
    "paths": ["~/.autohand/agents", "/team/shared/agents"]
  }
}
```
| Alan | Tür | Varsayılan | Açıklama |
| --------- | -------- | ------- | ------------------------------- |
| `enabled` | boole | `false` | Harici aracı yüklemeyi etkinleştir |
| `paths` | dize[] | `[]` | Acentelerin yükleneceği dizinler |

---

## Beceri Sistemi

Beceriler, yapay zeka aracısına özel talimatlar sağlayan talimat paketleridir. Belirli görevler için etkinleştirilebilen isteğe bağlı `AGENTS.md` dosyaları gibi çalışırlar.

### Beceri Keşif Konumları

Beceriler birden fazla yerden keşfedilir ve daha sonraki kaynaklar önceliklidir:

| Konum | Kaynak Kimliği | Açıklama |
| ---------------------------------------- | ------------------ | ----------------------------------------- |
| `~/.codex/skills/**/SKILL.md` | `codex-user` | Kullanıcı düzeyinde Codex becerileri (özyinelemeli) |
| `~/.claude/skills/*/SKILL.md` | `claude-user` | Kullanıcı düzeyinde Claude becerileri (tek düzey) |
| `~/.autohand/skills/**/SKILL.md` | `autohand-user` | Kullanıcı düzeyinde Autohand beceriler (özyinelemeli) |
| `<project>/.claude/skills/*/SKILL.md` | `claude-project` | Proje düzeyinde Claude becerileri (tek düzey) |
| `<project>/.autohand/skills/**/SKILL.md` | `autohand-project` | Proje düzeyinde Autohand beceriler (özyinelemeli) |

### Otomatik Kopyalama Davranışı

Codex veya Claude konumlarından keşfedilen beceriler otomatik olarak ilgili Autohand konumuna kopyalanır:

- `~/.codex/skills/` ve `~/.claude/skills/` → `~/.autohand/skills/`
- `<project>/.claude/skills/` → `<project>/.autohand/skills/`

Autohand konumlarındaki mevcut becerilerin üzerine asla yazılmaz.

### SKILL.md Formatı

Beceriler YAML ön maddesini ve ardından işaretleme içeriğini kullanır:
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
| Alan | Gerekli | Maksimum Uzunluk | Açıklama |
| --------------- | -------- | ---------- | ------------------------------- |
| `name` | Evet | 64 karakter | Yalnızca kısa çizgi içeren küçük harfli alfanümerik |
| `description` | Evet | 1024 karakter | Yeteneğin kısa açıklaması |
| `license` | Hayır | - | Lisans tanımlayıcı (örn. MIT, Apache-2.0) |
| `compatibility` | Hayır | 500 karakter | Uyumluluk notları |
| `allowed-tools` | Hayır | - | İzin verilen araçların boşlukla ayrılmış listesi |
| `metadata` | Hayır | - | Ek anahtar/değer meta verileri |

### Giriş Önekleri

Autohand giriş isteminde özel önekleri destekler:

| Önek | Açıklama | Örnek |
| ------ | ------------------------------ | ---------------------------------- |
| `/` | Eğik çizgi komutları | __AH_KOD_7__, __AH_KOD_8__, __AH_KOD_9__, __AH_KOD_10__ |
| `@` | Dosyadan bahsediliyor (otomatik tamamlama) | `@src/index.ts` |
| `$` | Beceriden bahsedilenler (otomatik tamamlama) | `$frontend-design`, `$code-review` |
| `!` | Terminal komutlarını doğrudan çalıştırın | `! git status`, `! ls -la` |

**Beceri İfadeleri (`$`):**

- Otomatik tamamlama ile mevcut becerileri görmek için `$` ve ardından karakterleri yazın
- Sekme en iyi öneriyi kabul eder (ör. `$frontend-design`)
- `~/.autohand/skills/` ve `<project>/.autohand/skills/`'den beceriler keşfedildi
- Etkinleştirilen beceriler, mevcut oturum için özel talimatlar olarak komut istemine eklenir
- Önizleme paneli beceri meta verilerini gösterir (ad, açıklama, etkinleştirme durumu)

**Kabuk Komutları (`!`):**

- Komutlar mevcut çalışma dizininizde çalıştırılır
- Çıkış doğrudan terminalde görüntülenir
- Yüksek Lisans'a gitmiyor
- 30 saniyelik mola
- Yürütmeden sonra komut istemine geri döner

### Eğik Çizgi Komutları

#### `/skills` - Paket Yöneticisi

| Komut | Açıklama |
| ------------------------------- | ------------------------------- |
| `/skills` | Mevcut tüm becerileri listele |
| `/skills use <name>` | Geçerli oturum için bir beceriyi etkinleştirin |
| `/skills deactivate <name>` | Bir beceriyi devre dışı bırakma |
| `/skills info <name>` | Ayrıntılı beceri bilgilerini göster |
| `/skills install` | Topluluk kayıt defterine göz atın ve yükleyin |
| `/skills install @<slug>` | Slug ile bir topluluk becerisi yükleyin |
| `/skills search <query>` | Topluluk becerileri kayıt defterinde arama yapın |
| `/skills trending` | Trend olan topluluk becerilerini göster |
| `/skills remove <slug>` | Bir topluluk becerisini kaldırma |
| `/skills new` | Etkileşimli olarak yeni bir beceri yaratın |
| `/skills feedback <slug> <1-5>` | Bir topluluk becerisine puan verin |

#### `/learn` - Yüksek Lisans Destekli Beceri Danışmanı

| Komut | Açıklama |
| --------------- | -------------------------------------------------- |
| `/learn` | Projeyi analiz edin ve becerileri önerin (hızlı tarama) |
| `/learn deep` | Daha hedefe yönelik sonuçlar için projeyi derinlemesine tarayın (kaynak dosyaları okur) |
| `/learn update` | Projeyi yeniden analiz edin ve LLM tarafından oluşturulan eski becerileri yeniden oluşturun |

`/learn` iki aşamalı bir LLM akışı kullanır:

1. **Aşama 1 - Analiz + Sıralama + Denetim**: Proje yapınızı tarar, kurulu becerileri fazlalık/çatışmalara karşı denetler ve topluluk becerilerini alaka düzeyine göre sıralar (0-100).
2. **Aşama 2 - Oluşturma** (koşullu): 60'ın üzerinde topluluk becerisi puanı yoksa, projenize uygun özel bir beceri oluşturmayı teklif eder.
Oluşturulan beceriler meta verileri (`agentskill-source: llm-generated`, `agentskill-project-hash`) içerir, böylece `/learn update` kod tabanınızın ne zaman değiştiğini algılayabilir ve eski becerileri yeniden oluşturabilir.

### Otomatik Beceri Oluşturma (`--auto-skill`)

`--auto-skill` CLI bayrağı, etkileşimli danışman akışı olmadan beceriler üretir:
```bash
autohand --auto-skill
```
Bu:

1. Proje yapınızı analiz edin (package.json, gereksinimleri.txt vb.)
2. Dilleri, çerçeveleri ve kalıpları tespit edin
3. Yüksek Lisans'ı kullanarak 3 ilgili beceriyi oluşturun
4. Becerileri `<project>/.autohand/skills/`'ye kaydedin

Daha hedefe yönelik, etkileşimli bir deneyim için bunun yerine oturum içinde `/learn` kullanın.

Algılanan modeller şunları içerir:

- **Diller**: TypeScript, JavaScript, Python, Rust, Go
- **Çerçeveler**: React, Next.js, Vue, Express, Flask, Django
- **Desenler**: CLI araçları, test etme, monorepo, Docker, CI/CD

---

## API Ayarları

Ekip özellikleri için arka uç API yapılandırması.
```json
{
  "api": {
    "baseUrl": "https://api.autohand.ai",
    "companySecret": "sk-team-xxx"
  }
}
```
| Alan | Tür | Varsayılan | Açıklama |
| --------------- | ------ | ------------------------- | --------------------------------------- |
| `baseUrl` | dize | `https://api.autohand.ai` | API uç noktası |
| `companySecret` | dize | - | Paylaşılan özellikler için ekip/şirket sırrı |

Ortam değişkenleri aracılığıyla da ayarlanabilir:

- `AUTOHAND_API_URL` → `api.baseUrl`
- `AUTOHAND_SECRET` → `api.companySecret`

---

## Kimlik Doğrulama Ayarları

Kimlik doğrulama ve kullanıcı oturumu yapılandırması.
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
| Alan | Tür | Varsayılan | Açıklama |
| ------------- | ------ | ------- | --------------------------------- |
| `token` | dize | - | API erişimi için kimlik doğrulama belirteci |
| `user` | nesne | - | Kimliği doğrulanmış kullanıcı bilgileri |
| `user.id` | dize | - | Kullanıcı Kimliği |
| `user.email` | dize | - | Kullanıcı e-posta adresi |
| `user.name` | dize | - | Kullanıcının görünen adı |
| `user.avatar` | dize | - | Kullanıcı avatarı URL'si (isteğe bağlı) |
| `expiresAt` | dize | - | Belirtecin geçerlilik süresi zaman damgası (ISO 8601 biçimi) |

---

## Topluluk Becerileri Ayarları

Topluluk becerilerinin keşfi ve yönetimi için yapılandırma.
```json
{
  "communitySkills": {
    "enabled": true,
    "showSuggestionsOnStartup": true,
    "autoBackup": true
  }
}
```
| Alan | Tür | Varsayılan | Açıklama |
| -------------------------- | ------- | ------- | ------------------------------------------------------------- |
| `enabled` | boole | `true` | Topluluk becerileri özelliklerini etkinleştirin |
| `showSuggestionsOnStartup` | boole | `true` | Satıcı becerisi olmadığında başlangıçta beceri önerilerini göster |
| `autoBackup` | boole | `true` | Keşfedilen satıcı becerilerini otomatik olarak API'ye yedekleyin |

---

## Paylaşım Ayarları

`/share` komutu aracılığıyla oturum paylaşımına yönelik yapılandırma. Oturumlar [autohand.link](https://autohand.link) adresinde düzenlenmektedir.
```json
{
  "share": {
    "enabled": true
  }
}
```
| Alan | Tür | Varsayılan | Açıklama |
| --------- | ------- | ------- | ----------------------------------- |
| `enabled` | boole | `true` | `/share` komutunu etkinleştirme/devre dışı bırakma |

### YAML Formatı
```yaml
share:
  enabled: true
```
### Oturum Paylaşımını Devre Dışı Bırakma

Güvenlik veya gizlilik nedeniyle oturum paylaşımını devre dışı bırakmak istiyorsanız:
```json
{
  "share": {
    "enabled": false
  }
}
```
Devre dışı bırakıldığında, `/share` çalıştırıldığında şunu görüntülenecektir:
```
Session sharing is disabled.
To enable, set share.enabled: true in your config file.
```
---

## Ayarlar Senkronizasyonu

Autohand, oturum açmış kullanıcılar için yapılandırmanızı cihazlar arasında senkronize edebilir. Ayarlar Cloudflare R2'de güvenli bir şekilde saklanır ve yüklemeden önce şifrelenir.
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
| Alan | Tür | Varsayılan | Açıklama |
| ------------------ | -------- | --------------- | -------------------------------------------------- |
| `enabled` | boole | `true` (günlüğe kaydedildi) | Ayarların senkronizasyonunu etkinleştirme/devre dışı bırakma |
| `interval` | sayı | `300000` | Milisaniye cinsinden senkronizasyon aralığı (varsayılan: 5 dakika) |
| `exclude` | dize[] | `[]` | Senkronizasyondan hariç tutulacak küre desenleri |
| `includeTelemetry` | boole | `false` | Telemetri verilerini senkronize edin (kullanıcının iznini gerektirir) |
| `includeFeedback` | boole | `false` | Geri bildirim verilerini senkronize edin (kullanıcının iznini gerektirir) |

### CLI Bayrağı
```bash
# Disable sync for this session
autohand --sync-settings=false

# Enable sync (default for logged users)
autohand --sync-settings
```
### Neler Senkronize Edilir?

Varsayılan olarak bu öğeler oturum açmış kullanıcılar için senkronize edilir:

- **Yapılandırma** (`config.json`) - API anahtarları yüklemeden önce şifrelenir
- **Özel temsilciler** (`agents/`)
- **Topluluk becerileri** (`community-skills/`)
- **Kullanıcı kancaları** (`hooks/`)
- **Bellek** (`memory/`)
- **Proje bilgisi** (`projects/`)
- **Oturum geçmişi** (`sessions/`)
- **Paylaşılan içerik** (`share/`)
- **Özel beceriler** (`skills/`)

### Neler Senkronize Edilmez (Varsayılan Olarak)

- **Cihaz Kimliği** (`device-id`) - Cihaz başına benzersiz
- **Hata günlükleri** (`error.log`) - Yalnızca yerel
- **Sürüm önbelleği** (`version-*.json`) - Yerel önbellek dosyaları

### İzne Dayalı Senkronizasyon

Bu öğeler, yapılandırmanızda açıkça katılım gerektirir:

- **Telemetri verileri** - Senkronize etmek için `sync.includeTelemetry: true` değerini ayarlayın
- **Geri bildirim verileri** - Senkronize etmek için `sync.includeFeedback: true` değerini ayarlayın
```json
{
  "sync": {
    "enabled": true,
    "includeTelemetry": true,
    "includeFeedback": true
  }
}
```
### Uyuşmazlık Çözümü

Çakışma meydana geldiğinde (aynı dosya birden fazla cihazda değiştirildiğinde), **bulut sürümü kazanır**. Bu, yeni cihazlarda oturum açarken tutarlılık sağlar.

### Güvenlik

`config.json` içindeki API anahtarları ve diğer hassas veriler, yüklemeden önce kimlik doğrulama jetonunuz kullanılarak şifrelenir. Yalnızca kimlik bilgilerinizle şifreleri çözülebilir.

**Şifrelenenler:**

- `apiKey` adlı alanlar
- `Key`, `Token`, `Secret` ile biten alanlar
- `password` alanı

### Nasıl Çalışır?

1. **Başlangıçta**: Oturum açtıysanız senkronizasyon hizmeti otomatik olarak başlar
2. **Her 5 dakikada bir**: Ayarlar, bulut depolama alanıyla karşılaştırılır
3. **Bulut kazanır**: Önce uzaktan yapılan değişiklikler indirilir
4. **Yerel yüklemeler**: Yeni yerel değişiklikler yüklendi
5. **Çıkışta**: Senkronizasyon hizmeti sorunsuz bir şekilde durur

### Dosyaları Hariç Tutma

Belirli dosyaları veya kalıpları senkronizasyonun dışında bırakabilirsiniz:
```json
{
  "sync": {
    "enabled": true,
    "exclude": ["custom-local-config.json", "temp/*"]
  }
}
```
### YAML Formatı
```yaml
sync:
  enabled: true
  interval: 300000
  exclude: []
  includeTelemetry: false
  includeFeedback: false
```
---

## MCP Ayarları

MCP (Model Bağlam Protokolü) sunucularını, Autohand öğesini harici araçlarla genişletecek şekilde yapılandırın.
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

- **Tür**: `boolean`
- **Varsayılan**: `true`
- **Açıklama**: Tüm MCP desteğini etkinleştirin veya devre dışı bırakın. `false` olduğunda, başlangıçta hiçbir sunucu bağlı değildir ve MCP araçları kullanılamaz.

### `mcp.servers`

- **Tür**: `McpServerConfigEntry[]`
- **Varsayılan**: `[]`
- **Açıklama**: MCP sunucusu yapılandırmalarının dizisi.

### Sunucu Giriş Alanları

| Alan | Tür | Gerekli | Varsayılan | Açıklama |
| ------------- | -------------------------------- | -------------- | ------- | ------------------------------------------------------------- |
| `name` | `string` | Evet | - | Benzersiz sunucu tanımlayıcı |
| `transport` | `"stdio"` \| `"sse"` \| `"http"` | Evet | - | Taşıma türü |
| `command` | `string` | Evet (stdio) | - | Sunucu işlemini başlatma komutu |
| `args` | `string[]` | Hayır | `[]` | Komut için bağımsız değişkenler |
| `url` | `string` | Evet (sse/http) | - | Sunucu uç noktası URL'si |
| `headers` | `Record<string, string>` | Hayır | `{}` | http/sse aktarımı için özel HTTP üstbilgileri (ör. kimlik doğrulama belirteçleri) |
| `env` | `Record<string, string>` | Hayır | `{}` | Sunucuya aktarılan ortam değişkenleri |
| `autoConnect` | `boolean` | Hayır | `true` | Başlangıçta otomatik olarak bağlanılıp bağlanılmayacağı |

> Sunucular, başlatma sırasında istemi engellemeden arka planda eşzamansız olarak bağlanır. Sunucuları etkileşimli olarak yönetmek için `/mcp` kullanın veya topluluk kayıt defterine göz atmak veya özel sunucular eklemek için `/mcp add` kullanın.

> MCP belgelerinin tamamı için bkz. [docs/mcp.md](mcp.md).

---

## Kanca Ayarları

Aracı olaylarında kabuk komutlarını çalıştıran yaşam döngüsü kancalarına yönelik yapılandırma. Tüm ayrıntılar için [Hook Dokümantasyonu](./hooks.md) konusuna bakın.
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

| Alan | Tür | Varsayılan | Açıklama |
| --------- | ------- | ------- | ---------------------------------- |
| `enabled` | boole | `true` | Tüm kancaları genel olarak etkinleştirin/devre dışı bırakın |
| `hooks` | dizi | `[]` | Kanca tanımları dizisi |

### Kanca Tanımı

| Alan | Tür | Gerekli | Varsayılan | Açıklama |
| ------------- | ------- | -------- | ------- | -------------------------------- |
| `event` | dize | Evet | - | Bağlanılacak etkinlik |
| `command` | dize | Evet | - | Yürütülecek kabuk komutu |
| `description` | dize | Hayır | - | `/hooks` ekranının açıklaması |
| `enabled` | boole | Hayır | `true` | Kancanın aktif olup olmadığı |
| `timeout` | sayı | Hayır | `5000` | Milisaniye cinsinden zaman aşımı |
| `async` | boole | Hayır | `false` | Engellemeden çalıştırın |
| `filter` | nesne | Hayır | - | Araca veya yola göre filtrele |

### Kanca Etkinlikleri

| Etkinlik | Kovulduğunda |
| --------------- | ------------------------------------- |
| `pre-tool` | Herhangi bir araç çalıştırılmadan önce |
| `post-tool` | Araç tamamlandıktan sonra |
| `file-modified` | Dosya oluşturulduğunda/değiştirildiğinde/silindiğinde |
| `pre-prompt` | LLM'ye göndermeden önce |
| `post-response` | LLM yanıt verdikten sonra |
| `session-error` | Hata oluştuğunda |

### Ortam Değişkenleri

Kancalar çalıştırıldığında şu ortam değişkenleri kullanılabilir:

| Değişken | Açıklama |
| ---------------- | ----------------- |
| `HOOK_EVENT` | Etkinlik adı |
| `HOOK_WORKSPACE` | Çalışma alanı kök yolu |
| `HOOK_TOOL` | Araç adı (araç olayları) |
| `HOOK_ARGS` | JSON kodlu araç argümanları |
| `HOOK_SUCCESS` | doğru/yanlış (araç sonrası) |
| `HOOK_PATH` | Dosya yolu (dosya-değiştirilmiş) |
| `HOOK_TOKENS` | Kullanılan jetonlar (yanıt sonrası) |

---

## Chrome Uzantı Ayarları

Autohand Chrome uzantısı entegrasyonunu kontrol edin. Kılavuzun tamamına bakın: [Autohand Chrome'da](./autohand-in-chrome.md).
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
| Anahtar | Tür | Varsayılan | Açıklama |
| ------------------ | --------- | -------- | -------------------------------------------------------------- |
| `extensionId` | `string` | — | Doğrudan aktarım için yüklü Chrome uzantı kimliği |
| `enabledByDefault` | `boolean` | `false` | CLI ile tarayıcı köprüsünü otomatik olarak başlatın |
| `browser` | `string` | `"auto"` | Tercih edilen Chromium tarayıcısı: `auto`, `chrome`, `chromium`, `brave`, `edge` |
| `userDataDir` | `string` | — | Doğru profili hedeflemek için tarayıcı kullanıcı verileri dizini |
| `profileDirectory` | `string` | — | Tarayıcı profili dizini adı (ör. `"Default"`, `"Profile 1"`) |
| `installUrl` | `string` | — | Uzantı kimliği yapılandırılmadığında geri dönüş URL'si |

### CLI Bayrakları
```bash
autohand --chrome          # Start with browser bridge enabled
autohand --no-chrome       # Start with browser bridge disabled
```
### Eğik Çizgi Komutları
```
/chrome                    # Open Chrome integration panel
/chrome disconnect         # Close the browser bridge connection
```
---

## Tam Örnek

### JSON Formatı (`~/.autohand/config.json`)
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
### YAML Biçimi (`~/.autohand/config.yaml`)
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
### TOML Biçimi (`~/.autohand/config.toml`)
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

## Dizin Yapısı

Autohand, verileri `~/.autohand/` (veya `$AUTOHAND_HOME`) konumunda saklar:
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
**Proje düzeyinde dizin** (çalışma alanı kökünüzde):
```
<project>/.autohand/
├── settings.local.json  # Local project permissions (gitignore this)
├── memory/              # Project-specific memory
├── skills/              # Project-specific skills
└── tools/               # Project-specific meta-tools
```
---

## CLI Bayrakları (Yapılandırmayı Geçersiz Kıl)

Bu bayraklar yapılandırma dosyası ayarlarını geçersiz kılar:

### Çekirdek Bayrakları

| Bayrak | Açıklama |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `-v, --version` | Geçerli sürümün çıktısını alın |
| `-p, --prompt [text]` | Komut modunda tek bir talimatı çalıştırın |
| `--path <path>` | Çalışma alanı kökünü geçersiz kıl |
| `--config <path>` | Özel yapılandırma dosyasını kullan |
| `--model <model>` | Modeli geçersiz kıl |
| `--temperature <n>` | Örnekleme sıcaklığını ayarlayın (0-1) |
| `--thinking [level]` | Düşünme/akıl yürütme derinliğini ayarlayın (yok, normal, genişletilmiş) |
| `-y, --yes` | Otomatik onaylama istemleri |
| `--dry-run` | Çalıştırmadan önizleme |
| `-d, --debug` | Ayrıntılı hata ayıklama çıktısını etkinleştir |
| `--bare` | Minimum açık mod; ayrıca `AUTOHAND_CODE_SIMPLE=1` değerini ayarlar ve eğik çizgi komutlarını devre dışı bırakır |

### İzinler ve Güvenlik

| Bayrak | Açıklama |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `--unrestricted` | Onay istemi yok |
| `--restricted` | Tehlikeli işlemleri reddet |
| `--permissions` | Geçerli izin ayarlarını görüntüleyin ve çıkın |
| `--no-idle-logout` | Uzun süren temsilci oturumları için kimliği doğrulanmış boşta oturum kapatmayı devre dışı bırakın |
| `--yolo [pattern]` | Araç çağrılarını eşleştirme modelini otomatik olarak onaylama (ör. `allow:read,write` veya `deny:delete`) |
| `--timeout <seconds>` | Otomatik onaylama modu için saniye cinsinden zaman aşımı |

### Git ve Worktree

| Bayrak | Açıklama |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `--worktree [name]` | Oturumu yalıtılmış git çalışma ağacında çalıştırın (isteğe bağlı çalışma ağacı/dal adı) |
| `--tmux` | Özel bir tmux oturumunda başlat (`--worktree` anlamına gelir; `--no-worktree` ile kullanılamaz) |
| `--no-worktree` | Otomatik modda git çalışma ağacı izolasyonunu devre dışı bırakın |
| `-c, --auto-commit` | Görevleri tamamladıktan sonra değişiklikleri otomatik olarak uygula |
| `--patch` | Değişiklikleri uygulamadan git yamasını oluşturun |
| `--output <file>` | Yama için çıktı dosyası (--patch ile kullanılır) |

### Otomatik Mod
| Bayrak | Açıklama |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `--auto-mode [prompt]` | Etkileşimli otomatik modu etkinleştirin veya satır içi görevle bağımsız bir döngü başlatın |
| `--max-iterations <n>` | Maksimum otomatik mod yinelemesi (varsayılan: 50) |
| `--completion-promise <text>` | Tamamlama işaretçisi metni (varsayılan: "BİTTİ") |
| `--checkpoint-interval <n>` | Git her N yinelemeyi gerçekleştirir (varsayılan: 5) |
| `--max-runtime <m>` | Dakika cinsinden maksimum çalışma süresi (varsayılan: 120) |
| `--max-cost <d>` | Dolar cinsinden maksimum API maliyeti (varsayılan: 10) |
| `--interactive-on-complete` | Otomatik mod sona erdikten sonra doğrudan etkileşimli moda geçin (yalnızca TTY) |

### Beceriler ve Öğrenme

| Bayrak | Açıklama |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `--auto-skill` | Proje analizine dayalı becerileri otomatik olarak oluşturun (etkileşimli danışman için ayrıca bkz. `/learn`) |
| `--learn` | `/learn` beceri danışmanını etkileşimli olmayan bir şekilde çalıştırın (önerilen becerileri analiz edin ve yükleyin) |
| `--learn-update` | Projeyi yeniden analiz edin ve LLM tarafından oluşturulan eski becerileri etkileşimli olmayan bir şekilde yeniden oluşturun |
| `--skill-install [name]` | Bir topluluk becerisi yükleyin (ad belirtilmemişse tarayıcıyı açar) |
| `--project` | Beceriyi proje düzeyine yükleyin (--skill-install ile) |

### Kimlik Doğrulama ve Hesap

| Bayrak | Açıklama |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `--login` | Autohand hesabınızda oturum açın |
| `--logout` | Autohand hesabınızdan çıkış yapın |
| `--sync-settings` | Ayarların senkronizasyonunu etkinleştirme/devre dışı bırakma (varsayılan: oturum açmış kullanıcılar için doğru) |

### Kurulum ve Bilgi

| Bayrak | Açıklama |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `--setup` | Autohand | yapılandırmak veya yeniden yapılandırmak için kurulum sihirbazını çalıştırın.
| `--about` | Autohand hakkındaki bilgileri göster (sürüm, bağlantılar, katkı bilgileri) |
| `--feedback` | Autohand ekibine geri bildirim gönderin |
| `--settings` | Autohand ayarlarını yapılandırın (etkileşimli modda `/settings` ile aynı) |

### Çalışma Alanı ve Dizinler

| Bayrak | Açıklama |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `--add-dir <path...>` | Çalışma alanı kapsamına ek dizinler ekleyin (birden çok kez kullanılabilir) |

### Çalıştırma Modları

| Bayrak | Açıklama |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `--mode <mode>` | Çalıştırma modu: etkileşimli (varsayılan), rpc veya acp |
| `--acp` | --mode acp'nin kısaltması (stdio üzerinden Ajan İstemci Protokolü) |
| `--teammate-mode <mode>` | Takım görüntüleme modu: otomatik, işlem içi veya tmux |

### Kullanıcı Arayüzü ve Dil

| Bayrak | Açıklama |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `--display-language <locale>` | Görüntüleme dilini ayarlayın (ör. en, id, zh-cn, fr, de, ja) |
| `--search-engine <provider>` | Web arama sağlayıcısını ayarlayın (google, cesur, duckduckgo, paralel) |
| `--cc, --context-compact` | Bağlam sıkıştırmayı etkinleştir (varsayılan: açık) |
| `--no-cc, --no-context-compact` | Bağlam sıkıştırmayı devre dışı bırak |

### Chrome Entegrasyonu

| Bayrak | Açıklama |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `--chrome` | Chrome tarayıcı entegrasyonunu etkinleştirin (`/chrome` ile aynı) |
| `--no-chrome` | Chrome tarayıcı entegrasyonunu devre dışı bırakın |

### Sistem İstemi

| Bayrak | Açıklama |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `--sys-prompt <value>` | Tüm sistem istemini değiştirin (satır içi dize veya dosya yolu) |
| `--append-sys-prompt <value>` | Sistem istemine ekle (satır içi dize veya dosya yolu) |
| `--system-prompt <value>` | Tüm sistem istemini değiştirin (satır içi dize veya dosya yolu) |
| `--system-prompt-file <path>` | Tüm sistem istemini dosya içeriğiyle değiştirin |
| `--append-system-prompt <value>` | Sistem istemine ekle (satır içi dize veya dosya yolu) |
| `--append-system-prompt-file <path>` | Dosya içeriğini sistem istemine ekle |
| `--mcp-config <path>` | Açık bir MCP yapılandırma dosyası yükleyin |
| `--agents <json\|path>` | Açık satır içi aracıları JSON veya açık bir aracı dizinini yükleyin |
| `--plugin-dir <path>` | Açık bir eklenti/meta araç dizini yükleyin |

### Deney Anahtarı Komutları

| Komut | Açıklama |
| ------------------------------------- | ------------------------------------------------ |
| `autohand experiments list` | Yerel ve uzak özellik kimliklerini, kaynağı, yaşam döngüsü aşamasını ve durumu listeleyin |
| `autohand experiments status <feature>` | Bir özellik anahtarını, yapılandırma yolunu veya uzak meta verileri ve durumu gösterin |
| `autohand experiments refresh` | Uzak özellik işaretlerini Autohand API'sinden indirin |
| `autohand experiments enable <feature>` | Yapılandırma destekli özellik anahtarını etkinleştirin |
| `autohand experiments disable <feature>` | Yapılandırma destekli özellik anahtarını devre dışı bırakın |

Uzak özellik bayrakları `/v1/feature-flags/evaluate` adresinden alınır, `~/.autohand/feature-flags.json` konumunda önbelleğe alınır ve API tarafından sağlanan TTL'nin süresi dolduktan sonra yenilenir. Uzak bayrak ortamını seçmek için `features.environment` kullanın ve kullanıcı tarafından geçersiz kılınabilen uzak bayrakların yerel olarak devre dışı bırakılması için `features.remoteOverrides` kullanın.

`usage_v2`, `/usage` kontrol paneli ve geliştirilmiş `/status` Kullanım sekmesi için deneysel bir özellik anahtarıdır. `autohand experiments enable usage_v2` ile etkinleştirin.

`token_usage_status`, çalışma durum satırında gerçek zamanlı jeton kullanımını gösteren deneysel bir özellik anahtarıdır (yapılandırma yolu `features.tokenUsageStatus`, varsayılan olarak kapalıdır) — kümülatif jetonların yukarı (`↑`) ve aşağı (`↓`) artı bağlam penceresi doluluğunu, ör. `↑15.7k ↓3.2k · context: 6.0% (15.7k/262.1k)`. Bağlam penceresi, tüm sağlayıcılarda model başına çözümlenir. `autohand experiments enable token_usage_status` ile etkinleştirin.

---

## Eğik Çizgi Komutları

Autohand etkileşimli kullanım için zengin bir eğik çizgi komutları seti sağlar. Önerileri görmek için REPL'e `/` yazın.

### Oturum Yönetimi

| Komut | Açıklama |
| ------------- | --------------------------------------- |
| `/quit` | Geçerli oturumdan çık |
| `/exit` | Geçerli oturumdan çık |
| `/new` | Yeni bir konuşma başlatın (bellek çıkarmayla) |
| `/clear` | Otomatik hafıza çıkarma ile konuşmayı netleştirin |
| `/session` | Geçerli oturum ayrıntılarını göster |
| `/sessions` | Geçmiş oturumları listele |
| `/resume` | Önceki bir oturumu sürdürme |
| `/history` | Sayfalandırmayla oturum geçmişine göz atın |
| `/undo` | Git değişikliklerini geri alma ve son dönüş |
| `/export` | Oturumu markdown/JSON/HTML'ye aktar |
| `/share` | Geçerli oturumu paylaş |
| `/status` | Oturum durumunu göster |
| `/usage` | Modeli, sağlayıcıyı, içeriği ve kullanım sınırlarını göster |

### Model ve Sağlayıcı

| Komut | Açıklama |
| ------------- | --------------------------------------- |
| `/model` | LLM modelini değiştirin veya yapılandırın |
| `/cc` | İçeriği manuel olarak sıkıştırın |

### Proje Kurulumu

| Komut | Açıklama |
| ------------- | --------------------------------------- |
| `/init` | Geçerli dizinde `AGENTS.md` dosyası oluştur |
| `/setup` | Autohand | yapılandırmak için kurulum sihirbazını çalıştırın.
| `/add-dir` | Çalışma alanı kapsamına dizinler ekleyin |

### Temsilciler ve Ekipler

| Komut | Açıklama |
| ------------- | --------------------------------------- |
| `/agents` | Mevcut alt acenteleri listele |
| `/agents-new` | Sihirbaz aracılığıyla yeni bir temsilci oluşturun |
| `/squad` | Bağımsız Autohand Squad çalışma zamanını açın/yönetin |
| `/team` | Paralel çalışma için ekibi yönetin |
| `/tasks` | Ekipteki görevleri yönetme |
| `/message` | Takım arkadaşına mesaj gönder |

### Beceriler

| Komut | Açıklama |
| ---------------- | -------------------------------------------------- |
| `/skills` | Becerileri listeleyin ve yönetin |
| `/skills-new` | Yeni beceri oluştur |
| `/learn` | Önerilen becerileri öğrenin ve yükleyin |

### Bellek ve Ayarlar

| Komut | Açıklama |
| ------------- | --------------------------------------- |
| `/memory` | Saklanan anıları görüntüleyin ve yönetin |
| `/settings` | Autohand ayarlarını yapılandırın |
| `/statusline` | Besteci durum satırı alanlarını yapılandırma |
| `/experiments` | Deneysel özellik anahtarlarını değiştir |
| `/sync` | Ayarları cihazlar arasında senkronize edin |
| `/import` | Desteklenen aracılardan oturumları, ayarları, MCP'yi, belleği, becerileri ve kancaları içe aktarın |

### İzinler ve Kancalar

| Komut | Açıklama |
| ------------- | --------------------------------------- |
| `/permissions`| Araç izinlerini yönetin |
| `/hooks` | Yaşam döngüsü kancalarını yönetin |

### Kimlik Doğrulaması

| Komut | Açıklama |
| ------------- | --------------------------------------- |
| `/login` | Autohand API ile kimlik doğrulaması yapın |
| `/logout` | Autohand hesabından çıkış yapın |

### Araçlar ve Yardımcı Programlar

| Komut | Açıklama |
| ------------- | --------------------------------------- |
| `/search` | Web'de arama yapın |
| `/formatters` | Kullanılabilir kod formatlayıcılarını listeleyin |
| `/lint` | Mevcut kod linterlerini listeleyin |
| `/completion` | Kabuk tamamlama komut dosyaları oluşturun |
| `/plan` | Uygulama planı oluşturun |
| `/review` | Kod incelemesi gerçekleştirin |
| `/pr-review` | Çekme isteğini inceleyin |

### IDE Entegrasyonu

| Komut | Açıklama |
| ------------- | --------------------------------------- |
| `/ide` | Çalışan IDE'leri tespit edin ve onlara bağlanın |

### MCP (Model Bağlam Protokolü)

| Komut | Açıklama |
| ------------- | --------------------------------------- |
| `/mcp` | Etkileşimli MCP sunucu yöneticisi |

### Otomasyon

| Komut | Açıklama |
| ------------- | --------------------------------------- |
| `/automode` | Otonom kodlama modunu başlat |
| `/repeat` | Yinelenen işleri planlayın |
| `/yolo` | Yolo modunu değiştir (otomatik onaylama araçları) |

### Chrome Entegrasyonu

| Komut | Açıklama |
| ------------- | --------------------------------------- |
| `/chrome` | Chrome tarayıcı entegrasyonunu etkinleştirin |

### Kullanıcı Arayüzü ve Ekran

| Komut | Açıklama |
| ------------- | --------------------------------------- |
| `/help` | Mevcut eğik çizgi komutlarını ve ipuçlarını görüntüleyin |
| `/about` | Autohand hakkındaki bilgileri göster |
| `/theme` | Renk temasını değiştir |
| `/language` | Görüntüleme dilini değiştirin |
| `/feedback` | Autohand ekibine geri bildirim gönderin |

---

## Sistem İstemi Özelleştirmesi
Autohand, AI aracısı tarafından kullanılan sistem istemini özelleştirmenize olanak tanır. Bu, özelleştirilmiş iş akışları, özel talimatlar veya diğer sistemlerle entegrasyon için kullanışlıdır.

### CLI Bayrakları

| Bayrak | Açıklama |
| ----------------------------- | --------------------------------- |
| `--sys-prompt <value>` | Tüm sistem istemini değiştirin |
| `--append-sys-prompt <value>` | İçeriği varsayılan sistem istemine ekleyin |

Her iki bayrak da aşağıdakilerden birini kabul eder:

- **Satır içi dize**: Doğrudan metin içeriği
- **Dosya yolu**: İstemi içeren dosyanın yolu (otomatik olarak algılanır)

### Dosya Yolu Algılama

Bir değer şu durumlarda dosya yolu olarak kabul edilir:

- `./`, `../`, `/` veya `~/` ile başlar
- Windows sürücü harfiyle başlar (ör. `C:\`)
- `.txt`, `.md` veya `.prompt` ile biter
- Boşluksuz yol ayırıcıları içerir

Aksi takdirde satır içi dize olarak kabul edilir.

### `--sys-prompt` (Komple Değiştirme)

Sağlandığında, bu **tamamen varsayılan sistem isteminin yerine geçer**. Aracı aşağıdakileri YÜKLEMEZ:

- Varsayılan Autohand talimatları
- AGENTS.md proje talimatları
- Kullanıcı/proje hafızaları
- Aktif beceriler
```bash
# Inline string
autohand --sys-prompt "You are a Python expert. Be concise." --prompt "Write hello world"

# From file
autohand --sys-prompt ./custom-prompt.txt --prompt "Explain this code"

# Home directory
autohand --sys-prompt ~/.autohand/prompts/python-expert.md --prompt "Debug this function"
```
**Örnek özel bilgi istemi dosyası (`custom-prompt.txt`):**
```
You are a specialized Python debugging assistant.

Rules:
- Focus only on Python code
- Always explain the root cause
- Suggest fixes with code examples
- Be concise and direct
```
### `--append-sys-prompt` (Varsayılana Ekle)

Bu sağlandığında, içeriği tam varsayılan sistem istemine **ekler**. Aracı yine de yüklenecek:

- Varsayılan Autohand talimatları
- AGENTS.md proje talimatları
- Kullanıcı/proje hafızaları
- Aktif beceriler

Eklenen içerik en sona eklenir.
```bash
# Inline string
autohand --append-sys-prompt "Always use TypeScript instead of JavaScript" --prompt "Create a function"

# From file
autohand --append-sys-prompt ./team-guidelines.md --prompt "Add error handling"
```
**Örnek ekleme dosyası (`team-guidelines.md`):**
```
## Team Guidelines

- Use 2-space indentation
- Prefer functional patterns
- Add JSDoc comments to public APIs
- Run tests before committing
```
### Öncelik

Her iki bayrak da sağlandığında:

1. `--sys-prompt` tam öncelik taşır
2. `--append-sys-prompt` dikkate alınmaz
```bash
# --append-sys-prompt is ignored in this case
autohand --sys-prompt "Custom only" --append-sys-prompt "This is ignored"
```
### Kullanım Durumları

| Kullanım Örneği | Önerilen Bayrak |
| ---------------------------------- | --------------------- |
| Özel temsilci kişiliği | `--sys-prompt` |
| Minimal talimatlar | `--sys-prompt` |
| Ekip kuralları ekleyin | `--append-sys-prompt` |
| Proje kurallarını ekleyin | `--append-sys-prompt` |
| Harici sistemlerle entegrasyon | `--sys-prompt` |
| Uzmanlaşmış hata ayıklama | `--sys-prompt` |

### Hata İşleme

| Senaryo | Davranış |
| ----------------- | ------------------------ |
| Boş değer | Hata |
| Dosya bulunamadı | Satır içi dize olarak değerlendirilir |
| Boş dosya | Hata |
| Dosya > 1MB | Hata |
| İzin reddedildi | Hata |
| Dizin yolu | Hata |

### Örnekler
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

## Çoklu Dizin Desteği

Autohand ana çalışma alanının ötesinde birden fazla dizinle çalışabilir. Bu, projenizin farklı dizinlerde bağımlılıkları, paylaşılan kitaplıkları veya ilgili projeleri olduğunda kullanışlıdır.

### CLI Bayrağı

Ek dizinler eklemek için `--add-dir` kullanın (birden çok kez kullanılabilir):
```bash
# Add a single additional directory
autohand --add-dir /path/to/shared-lib

# Add multiple directories
autohand --add-dir /path/to/lib1 --add-dir /path/to/lib2

# With unrestricted mode (auto-approve writes to all directories)
autohand --add-dir /path/to/shared-lib --unrestricted
```
### Etkileşimli Komut

Etkileşimli bir oturum sırasında `/add-dir` kullanın:
```
/add-dir              # Show current directories
/add-dir /path/to/dir # Add a new directory
```
### Güvenlik Kısıtlamaları

Aşağıdaki dizinler eklenemez:

- Ana dizin (`~` veya `$HOME`)
- Kök dizin (`/`)
- Sistem dizinleri (`/etc`, `/var`, `/usr`, `/bin`, `/sbin`)
- Windows sistem dizinleri (`C:\Windows`, `C:\Program Files`)
- Windows kullanıcı dizinleri (`C:\Users\username`)
- WSL Windows bağlantıları (`/mnt/c`, `/mnt/c/Windows`)
