# Autohand Référence de configuration

Référence complète pour toutes les options de configuration dans `~/.autohand/config.json` (ou `.toml`/`.yaml`/`.yml`).

> **Conseil :** La plupart des paramètres ci-dessous peuvent être modifiés de manière interactive à l'aide de la commande `/settings` au lieu de modifier le fichier manuellement.

Références localisées :

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

## Table des matières

- [Emplacement du fichier de configuration](#configuration-file-location)
- [Variables d'environnement](#environment-variables)
- [Mode nu](#bare-mode)
- [Paramètres du fournisseur](#provider-settings)
- [Paramètres de l'espace de travail](#workspace-settings)
- [Paramètres de l'interface utilisateur](#ui-settings)
- [Paramètres de l'agent](#agent-settings)
- [Paramètres d'autorisations](#permissions-settings)
- [Mode Patch](#patch-mode)
- [Paramètres réseau](#network-settings)
- [Paramètres de télémétrie](#telemetry-settings)
- [Agents externes](#external-agents)
- [Système de compétences](#skills-system)
- [Paramètres API](#api-settings)
- [Paramètres d'authentification](#authentication-settings)
- [Paramètres des compétences de la communauté](#community-skills-settings)
- [Paramètres de partage](#share-settings)
- [Synchronisation des paramètres](#settings-sync)
- [Paramètres des crochets](#hooks-settings)
- [Paramètres MCP](#mcp-settings)
- [Paramètres des extensions Chrome](#chrome-extension-settings)
- [Exemple complet](#complete-example)

---

## Emplacement du fichier de configuration

Autohand recherche la configuration dans cet ordre :

1. Variable d'environnement `AUTOHAND_CONFIG` (chemin personnalisé)
2. `~/.autohand/config.toml`
3. `~/.autohand/config.yaml`
4. `~/.autohand/config.yml`
5. `~/.autohand/config.json` (par défaut)

Vous pouvez également remplacer le répertoire de base :
```bash
export AUTOHAND_HOME=/custom/path  # Changes ~/.autohand to /custom/path
```
---

## Variables d'environnement

| Variables | Descriptif | Exemple |
| -------------------------------------- | ------------------------------------------------ | -------------------------------- |
| `AUTOHAND_HOME` | Répertoire de base pour toutes les données Autohand | `/custom/path` |
| `AUTOHAND_CONFIG` | Chemin du fichier de configuration personnalisé | `/path/to/config.toml` |
| `AUTOHAND_API_URL` | Point de terminaison de l'API (remplace la configuration) | `https://api.autohand.ai` |
| `AUTOHAND_SECRET` | Clé secrète de l'entreprise/de l'équipe | `sk-xxx` |
| `AUTOHAND_PERMISSION_CALLBACK_URL` | URL de rappel d'autorisation (expérimental) | `http://localhost:3000/callback` |
| `AUTOHAND_PERMISSION_CALLBACK_TIMEOUT` | Délai d'expiration pour le rappel d'autorisation en ms | `5000` |
| `AUTOHAND_NON_INTERACTIVE` | Exécuter en mode non interactif | `1` |
| `AUTOHAND_YES` | Confirmer automatiquement toutes les invites | `1` |
| `AUTOHAND_NO_BANNER` | Désactiver la bannière de démarrage | `1` |
| `AUTOHAND_STREAM_TOOL_OUTPUT` | Flux de sortie de l'outil en temps réel | `1` |
| `AUTOHAND_DEBUG` | Activer la journalisation du débogage | `1` |
| `AUTOHAND_THINKING_LEVEL` | Définir le niveau de profondeur du raisonnement | `normal` |
| `AUTOHAND_CLIENT_NAME` | Identifiant client/éditeur (défini par les extensions ACP) | `zed` |
| `AUTOHAND_CLIENT_VERSION` | Version client (définie par les extensions ACP) | `0.169.0` |
| `AUTOHAND_CODE` | Indicateur de détection d'environnement (défini automatiquement) | `1` |
| `AUTOHAND_CODE_SIMPLE` | Activer le mode simple sans passer `--bare` | `1` |

### Niveau de réflexion

La variable d'environnement `AUTOHAND_THINKING_LEVEL` contrôle la profondeur du raisonnement utilisé par le modèle :

| Valeur | Descriptif |
| ---------- | --------------------------------------------------------------------- |
| `none` | Réponses directes sans raisonnement visible |
| `normal` | Profondeur de raisonnement standard (par défaut) |
| `extended` | Raisonnement approfondi pour des tâches complexes, montre un processus de réflexion plus détaillé |

Ceci est généralement défini par les extensions client ACP (comme Zed) via la liste déroulante de configuration.
```bash
# Example: Use extended thinking for complex tasks
AUTOHAND_THINKING_LEVEL=extended autohand --prompt "refactor this module"
```
---

## Mode nu

Le mode nu démarre Autohand avec uniquement les intégrations de contexte et d'exécution explicitement demandées. Activez-le avec soit :
```bash
autohand --bare
AUTOHAND_CODE_SIMPLE=1 autohand
```
Lorsque `--bare` est transmis, Autohand définit également `AUTOHAND_CODE_SIMPLE=1` pour le processus en cours.

Le mode nu désactive le démarrage automatique et les intégrations interactives :

- crochets et notifications de crochet
- Démarrage LSP
- synchronisation du plugin, chargement automatique du plugin et chargement automatique du méta-outil
- attribution, télémétrie, synchronisation de session, reporting automatique et pings en arrière-plan
- contexte d'amorçage automatique de la mémoire/session
- suggestions d'invites en arrière-plan, vérifications de mise à jour, récupérations d'indicateurs de fonctionnalités et prélecture de métadonnées de modèle
- secours pour l'authentification OAuth du trousseau et du navigateur
- découverte automatique du `AGENTS.md` et des instructions du fournisseur
- toutes les commandes slash, y compris un simple `/` tapé dans l'invite

Les chemins de fichiers absolus en forme de barre oblique, tels que `/Users/alex/project/file.ts`, sont toujours traités comme un texte d'invite normal. Une entrée de barre oblique en forme de commande, telle que `/help`, `/model` ou `/mcp`, imprime `Slash commands are disabled in bare mode.` et n'est pas exécutée.

L'authentification en mode simple est uniquement explicite. Autohand lit d'abord `AUTOHAND_API_KEY`, puis `auth.apiKeyHelper` s'il est configuré. Il ne lit pas les informations d'identification du trousseau et ne démarre pas la connexion OAuth/navigateur. Les fournisseurs tiers continuent d'utiliser leurs clés API et leur configuration spécifiques au fournisseur.

Ces entrées explicites restent disponibles en mode simple :

| Entrée | Descriptif |
| ----------------------------- | ------------------------------------------------------------------------- |
| `--system-prompt <value>` | Remplacez l'invite système par du texte en ligne ou une valeur de type chemin |
| `--system-prompt-file <path>` | Remplacez l'invite système par le contenu du fichier |
| `--append-system-prompt <value>` | Ajouter du texte en ligne ou une valeur semblable à un chemin à l'invite système |
| `--append-system-prompt-file <path>` | Ajouter le contenu du fichier à l'invite système |
| `--add-dir <path...>` | Ajouter des répertoires explicites à la portée de l'espace de travail |
| `--mcp-config <path>` | Charger un fichier de configuration MCP explicite |
| `--settings` | Ouvrez les paramètres directement à partir du drapeau CLI |
| `--config <path>` | Utiliser un fichier de configuration Autohand explicite |
| `--agents <json\|path>` | Charger des agents en ligne explicites JSON ou un répertoire d'agents explicites |
| `--plugin-dir <path>` | Charger un répertoire plugin/méta-outil explicite |

---

## Paramètres du fournisseur

### `provider`

Fournisseur LLM actif à utiliser.

| Valeur | Descriptif |
| ---------- | ---------------------------- |
| `"openrouter"` | API OpenRouter (par défaut) |
| `"ollama"` | Instance Ollama locale |
| `"llamacpp"` | Serveur local lama.cpp |
| `"openai"` | API OpenAI directement |
| `"mlx"` | MLX sur Apple Silicon (local) |
| `"llmgateway"` | API unifiée de la passerelle LLM |
| `"deepseek"` | API DeepSeek |
| `"zai"` | API Z.ai GLM |
| `"sakana"` | API Sakana.AI Fugu |
| `"bedrock"` | Socle AWS |
| `"custom:<id>"` | Fournisseur compatible OpenAI défini par l'utilisateur à partir de `customProviders` |

### `openrouter`

Configuration du fournisseur OpenRouter.
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
| Champ | Tapez | Obligatoire | Par défaut | Descriptif |
| --------------- | ------ | -------- | ------------------------------- | --------------------------------------------------------------------------- |
| `apiKey` | chaîne | Oui | - | Votre clé API OpenRouter |
| `baseUrl` | chaîne | Non | `https://openrouter.ai/api/v1` | Point de terminaison de l'API |
| `model` | chaîne | Oui | - | Identifiant du modèle (par exemple, `your-modelcard-id-here`) |
| `contextWindow` | numéro | Non | Automobile | Fenêtre contextuelle exacte du modèle. Autohand remplit cela depuis OpenRouter lorsqu'il est connu. |

### `zai`

Configuration du fournisseur Z.ai.
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
| Champ | Tapez | Obligatoire | Par défaut | Descriptif |
| --------------- | ------ | -------- | ------------------------------- | -------------------------------------------------------------------------------- |
| `apiKey` | chaîne | Oui | - | Votre clé API Z.ai |
| `baseUrl` | chaîne | Non | `https://api.z.ai/api/paas/v4` | Point de terminaison de l'API |
| `model` | chaîne | Oui | `glm-5.2` | Identificateur de modèle, par exemple `glm-5.2`, `glm-5.1` ou `glm-4.5` |
| `contextWindow` | numéro | Non | Automobile | Fenêtre contextuelle exacte du modèle. Autohand déduit 1M pour GLM-5.2 et 200K pour GLM-5.1. |

### `sakana`

Configuration du fournisseur Sakana.AI. L'API est compatible OpenAI et utilise `https://api.sakana.ai/v1` comme URL de base.
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
| Champ | Tapez | Obligatoire | Par défaut | Descriptif |
| --------------- | ------ | -------- | ----------------------------- | ----------------------------------------------------------------- |
| `apiKey` | chaîne | Oui | - | Votre clé API Sakana |
| `baseUrl` | chaîne | Non | `https://api.sakana.ai/v1` | Point de terminaison de l'API |
| `model` | chaîne | Oui | `fugu` | Identifiant du modèle, par exemple `fugu` ou `fugu-ultra` |
| `contextWindow` | numéro | Non | Automobile | Fenêtre contextuelle exacte du modèle. Autohand déduit 1M pour les modèles Fugu.   |

### `customProviders`

Les fournisseurs personnalisés permettent aux utilisateurs d'apporter un point de terminaison compatible OpenAI sans changement de code ni nouveau fournisseur intégré. Ajoutez le fournisseur sous `customProviders`, puis sélectionnez-le avec `provider: "custom:<id>"`. Le même flux est disponible à partir de `/model` avec **Nouveau fournisseur...**. Lors de la configuration, Autohand vérifie l'URL de base, l'authentification et le modèle sélectionné via le point de terminaison `/models` compatible OpenAI avant d'enregistrer le fournisseur.
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
Pour les serveurs locaux compatibles OpenAI qui ne nécessitent pas d'authentification, définissez `apiKeyRequired` sur `false` et omettez `apiKey`.

| Champ | Tapez | Obligatoire | Par défaut | Descriptif |
| ----------------- | ------- | -------- | ------- | ----------- |
| `id` | chaîne | Oui | - | Identifiant de fournisseur stable. Il doit correspondre à la clé de l'objet et est sélectionné comme `custom:<id>`. |
| `displayName` | chaîne | Oui | - | Nom affiché dans `/model` et paramètres du fournisseur. |
| `apiFormat` | chaîne | Oui | - | Doit être `openai-compatible`. |
| `baseUrl` | chaîne | Oui | - | Racine du point de terminaison telle que `https://api.example.com/v1`. Autohand vérifie `/models` et appelle `/chat/completions`. |
| `apiKey` | chaîne | Conditionnel | - | Jeton de porteur pour les points de terminaison hébergés. Obligatoire lorsque `apiKeyRequired` est vrai. |
| `apiKeyRequired` | booléen | Non | `true` | Définissez false pour les passerelles locales ou déjà authentifiées. |
| `model` | chaîne | Oui | - | Identifiant du modèle actif. |
| `contextWindow` | numéro | Non | Automobile | Fenêtre contextuelle exacte pour la budgétisation des jetons, le statut, la télémétrie et les métadonnées de synchronisation. |
| `reasoningEffort` | chaîne | Non | - | Facultatif `none`, `low`, `medium`, `high` ou `xhigh`. Envoyé sous le nom `reasoning_effort` pour les requêtes personnalisées compatibles OpenAI. |
| `models` | tableau | Non | - | Entrées facultatives du sélecteur de modèle avec contexte par modèle et métadonnées de raisonnement. |

### `ollama`

Configuration du fournisseur Ollama.
```json
{
  "ollama": {
    "baseUrl": "http://localhost:11434",
    "port": 11434,
    "model": "llama3.2"
  }
}
```
| Champ | Tapez | Obligatoire | Par défaut | Descriptif |
| --------- | ------ | -------- | -------------------- | ------------------------------------------ |
| `baseUrl` | chaîne | Non | `http://localhost:11434` | URL du serveur Ollama |
| `port` | numéro | Non | `11434` | Port du serveur (alternative à baseUrl) |
| `model` | chaîne | Oui | - | Nom du modèle (par exemple, `llama3.2`, `codellama`) |

### `llamacpp`

Configuration du serveur lama.cpp.
```json
{
  "llamacpp": {
    "baseUrl": "http://localhost:8080",
    "port": 8080,
    "model": "default"
  }
}
```
| Champ | Tapez | Obligatoire | Par défaut | Descriptif |
| --------- | ------ | -------- | ----------------------- | -------------------- |
| `baseUrl` | chaîne | Non | `http://localhost:8080` | URL du serveur lama.cpp |
| `port` | numéro | Non | `8080` | Port du serveur |
| `model` | chaîne | Oui | - | Identifiant du modèle |

### `openai`

Configuration de l'API OpenAI.
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
OpenAI peut également utiliser votre abonnement ChatGPT via le flux de connexion OpenAI intégré de Autohand :
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
| Champ | Tapez | Obligatoire | Par défaut | Descriptif |
| --------------- | ------ | ---------------------- | -------------------------------- | ------------------------------------------------------------------------- |
| `authMode` | chaîne | Non | `api-key` | Mode d'authentification : `api-key` ou `chatgpt` |
| `apiKey` | chaîne | Oui pour le mode `api-key` | - | Clé API OpenAI |
| `baseUrl` | chaîne | Non | `https://api.openai.com/v1` | Point de terminaison de l'API |
| `model` | chaîne | Oui | - | Nom du modèle (par exemple, `gpt-5.4`, `gpt-5.4-mini`) |
| `contextWindow` | numéro | Non | Automobile | Fenêtre contextuelle exacte du modèle. Définissez ceci pour remplacer les hypothèses locales obsolètes. |
| `chatgptAuth` | objet | Oui pour le mode `chatgpt` | - | Jetons d'authentification ChatGPT/Codex stockés et identifiant de compte |

### `mlx`

Fournisseur MLX pour les Mac Apple Silicon (inférence locale).
```json
{
  "mlx": {
    "baseUrl": "http://localhost:8080",
    "port": 8080,
    "model": "mlx-community/Llama-3.2-3B-Instruct-4bit"
  }
}
```
| Champ | Tapez | Obligatoire | Par défaut | Descriptif |
| --------- | ------ | -------- | ----------------------- | -------------------- |
| `baseUrl` | chaîne | Non | `http://localhost:8080` | URL du serveur MLX |
| `port` | numéro | Non | `8080` | Port du serveur |
| `model` | chaîne | Oui | - | Identifiant du modèle MLX |

### `llmgateway`

Configuration de l'API unifiée de la passerelle LLM. Fournit un accès à plusieurs fournisseurs LLM via une seule API.
```json
{
  "llmgateway": {
    "apiKey": "your-llmgateway-api-key",
    "baseUrl": "https://api.llmgateway.io/v1",
    "model": "gpt-4o"
  }
}
```
| Champ | Tapez | Obligatoire | Par défaut | Descriptif |
| --------- | ------ | -------- | ------------------------------- | --------------------------------------------------------- |
| `apiKey` | chaîne | Oui | - | Clé API de la passerelle LLM |
| `baseUrl` | chaîne | Non | `https://api.llmgateway.io/v1` | Point de terminaison de l'API |
| `model` | chaîne | Oui | - | Nom du modèle (par exemple, `gpt-4o`, `claude-3-5-sonnet-20241022`) |

**Obtention d'une clé API :**
Visitez [llmgateway.io/dashboard](https://llmgateway.io/dashboard) pour créer un compte et obtenir votre clé API.

**Modèles pris en charge :**
LLM Gateway prend en charge les modèles de plusieurs fournisseurs, notamment :

- OpenAI : `gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo`
`claude-3-5-haiku-20241022`
- Google : `gemini-1.5-pro`, `gemini-1.5-flash`

### `deepseek`

Configuration du fournisseur DeepSeek. L'API est compatible OpenAI et utilise `https://api.deepseek.com` comme URL de base.
```json
{
  "deepseek": {
    "apiKey": "your-deepseek-api-key",
    "baseUrl": "https://api.deepseek.com",
    "model": "deepseek-v4-flash"
  }
}
```
| Champ | Tapez | Obligatoire | Par défaut | Descriptif |
| --------- | ------ | -------- | -------------------------- | -------------------------------------------------------------- |
| `apiKey` | chaîne | Oui | - | Clé API DeepSeek |
| `baseUrl` | chaîne | Non | `https://api.deepseek.com` | Point de terminaison de l'API |
| `model` | chaîne | Oui | - | Nom du modèle, par exemple `deepseek-v4-flash` ou `deepseek-v4-pro` |

### `bedrock`

Configuration du fournisseur AWS Bedrock. `converse` est le mode par défaut et utilise la chaîne d'informations d'identification AWS SDK. Les modes compatibles OpenAI utilisent les clés API Bedrock et les points de terminaison compatibles Bedrock OpenAI.
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
| Champ | Tapez | Obligatoire | Par défaut | Descriptif |
| ---------- | ------ | -------- | ------- | ----------- |
| `model` | chaîne | Oui | - | ID de modèle de substrat rocheux, ID de profil d'inférence ou ARN |
| `region` | chaîne | Oui | `AWS_REGION`, puis `AWS_DEFAULT_REGION`, puis `us-east-1` dans la configuration | Région AWS |
| `apiMode` | chaîne | Non | `converse` | `converse`, `openai-chat` ou `openai-responses` |
| `authMode` | chaîne | Non | `aws-credentials` pour `converse`, `bedrock-api-key` pour les modes compatibles OpenAI | Mode d'authentification |
| `profile` | chaîne | Non | - | Profil AWS facultatif pour l'authentification par chaîne d'informations d'identification |
| `endpoint` | chaîne | Non | Dérivé du mode et de la région | Point de terminaison Bedrock personnalisé/privé |
| `apiKey` | chaîne | Oui pour les modes compatibles OpenAI | - | Clé API de base. N'utilisez pas de clés API OpenAI. |

Exécutez `aws configure sso` ou définissez `AWS_PROFILE=enterprise-prod autohand` pour l'authentification AWS basée sur le profil. Les informations d'identification du rôle IAM, du conteneur et des métadonnées d'instance sont prises en charge par le kit AWS SDK. Activez l'accès au modèle dans la console AWS avant d'utiliser un modèle.

---

## Paramètres de l'espace de travail
```json
{
  "workspace": {
    "defaultRoot": "/path/to/projects",
    "allowDangerousOps": false
  }
}
```
| Champ | Tapez | Par défaut | Descriptif |
| ------------------- | ------- | ----------------- | ------------------------------------------------- |
| `defaultRoot` | chaîne | Répertoire actuel | Espace de travail par défaut lorsqu'aucun n'est spécifié |
| `allowDangerousOps` | booléen | `false` | Autoriser les opérations destructrices sans confirmation |

### Sécurité de l'espace de travail

Autohand bloque automatiquement les opérations dans les répertoires dangereux pour éviter tout dommage accidentel :

- **Racines du système de fichiers** (`/`, `C:\`, `D:\`, etc.)
- **Répertoires personnels** (`~`, `/Users/<user>`, `/home/<user>`, `C:\Users\<user>`)
- **Répertoires système** (`/etc`, `/var`, `/System`, `C:\Windows`, etc.)
- **Montages WSL Windows** (`/mnt/c`, `/mnt/c/Users/<user>`)

Ce contrôle ne peut être contourné. Si vous essayez d'exécuter autohand dans un répertoire dangereux, vous verrez une erreur et devrez spécifier un répertoire de projet sûr.
```bash
# This will be blocked
cd ~ && autohand
# Error: Unsafe Workspace Directory

# This works
cd ~/projects/my-app && autohand
```
Voir [Sécurité de l'espace de travail](./workspace-safety.md) pour plus de détails.

---

## Paramètres de l'interface utilisateur
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
| Champ | Tapez | Par défaut | Descriptif |
| ---------------------------- | ------ | ------- | ------------------------------------------------------------------------------------------------------------- |
| `theme` | chaîne | `"dark"` | Thème de couleur pour la sortie du terminal. Les éléments intégrés incluent `dark`, `light`, `dracula`, `sandy`, `tui`, `github-dark`, `cappadocia`, `rio` et `australia`. Les anciennes valeurs `turkey` et `brazil` se chargent toujours en tant qu'alias. |
| `customThemes` | objet | `{}` | Définitions de thèmes personnalisées en ligne saisies par nom de thème. Définissez `theme` sur la même clé pour en utiliser une.   |
| `autoConfirm` | booléen | `false` | Ignorer les invites de confirmation pour des opérations sûres |
| `readFileCharLimit` | numéro | `300` | Nombre maximum de caractères à afficher à partir de la sortie de l'outil de lecture/recherche (le contenu complet est toujours envoyé au modèle) |
| `silentToolOutput` | booléen | `false` | Masquer les blocs de sortie d'outil dans le terminal tout en préservant les résultats d'outil pour le modèle/session |
| `activityVerbs` | chaîne ou chaîne[] | piscine intégrée | Verbe d'activité personnalisé ou pool de verbes pour l'indicateur de travail, rendu sous la forme `Verb...` |
| `activityVerbsEnabled` | booléen | `true` | Afficher les verbes d'activité en rotation comme `Compiling...` pendant que l'agent travaille |
| `activitySymbol` | chaîne | `"✳"` | Symbole affiché avant le verbe d'activité dans la sortie de l'indicateur d'activité |
| `statusLine.showProviderModel` | booléen | `true` | Afficher le fournisseur et le modèle actifs dans la ligne d'état du compositeur |
| `statusLine.showContext` | booléen | `true` | Afficher le pourcentage de contexte dans la ligne d'état du compositeur |
| `statusLine.showCommandHint` | booléen | `true` | Afficher les conseils de commande, de mention, de compétence et d'entrée dans le terminal dans la ligne d'état du compositeur |
| `statusLine.showPullRequest` | booléen | `true` | Afficher le numéro de demande d'extraction associé, ou `PR #123` lorsqu'aucun PR n'est associé |
| `statusLine.showSessionLines` | booléen | `false` | Afficher les lignes ajoutées et supprimées au cours de la session en cours |
| `statusLine.showQueue` | booléen | `true` | Afficher le nombre de demandes en file d'attente dans la ligne d'état |
| `statusLine.showActiveStatus` | booléen | `true` | Afficher le texte d'état du tour actif pendant que l'agent travaille |
| `statusLine.showActiveMetrics` | booléen | `true` | Afficher les mesures du temps écoulé et des jetons pendant que l'agent travaille |
| `statusLine.showCancelHint` | booléen | `true` | Afficher l'indice d'annulation Esc pendant que l'agent travaille |
| `completionReportEnabled` | booléen | `true` | Demandez au modèle d'inclure un rapport d'achèvement concis après les tours d'action terminés |
| `showCompletionNotification` | booléen | `true` | Afficher la notification du système lorsque la tâche est terminée |
| `showThinking` | booléen | `true` | Afficher le processus de raisonnement/de pensée du LLM |
| `terminalBell` | booléen | `true` | Faire sonner la cloche du terminal lorsque la tâche est terminée (affiche le badge sur l'onglet/le dock du terminal) |
| `checkForUpdates` | booléen | `true` | Rechercher les mises à jour CLI au démarrage |
| `updateCheckInterval` | numéro | `24` | Heures entre les vérifications de mise à jour (utilise le résultat mis en cache dans un intervalle) |

Les thèmes personnalisés peuvent remplacer n’importe quel jeton de couleur sémantique. Les jetons manquants sont hérités du thème sombre :
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
Remarque : `readFileCharLimit` et `silentToolOutput` affectent uniquement l'affichage du terminal. Le contenu complet est toujours envoyé au modèle et stocké dans les messages de l'outil.

Vous pouvez activer/désactiver la sortie silencieuse de l'outil sans modifier le fichier :
```bash
autohand config set silent_tool_output true
autohand config set silent_tool_output false
```
Vous pouvez alterner les verbes d'activité sans modifier le fichier :
```bash
autohand config set verbs activity true
autohand config set verbs activity false
```
Personnalisez les verbes dans le fichier de configuration lorsque vous souhaitez une étiquette de statut fixe ou une petite rotation spécifique au projet :
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
`activityVerbs` accepte soit une seule chaîne, soit un tableau de chaînes non vide. Lorsque `activityVerbsEnabled` est `false`, Autohand revient à `Working...` au lieu de passer par des verbes personnalisés ou intégrés.

Vous pouvez basculer entre les rapports d'achèvement, y compris l'invite structurée `SITREP`, sans modifier le fichier :
```bash
autohand config set sitrep true
autohand config set sitrep false
```
### Cloche du terminal

Lorsque `terminalBell` est activé (par défaut), Autohand fait sonner la cloche du terminal (`\x07`) lorsqu'une tâche est terminée. Cela déclenche :

- **Badge sur l'onglet du terminal** - Affiche un indicateur visuel indiquant que le travail est terminé
- **Rebond de l'icône du Dock** - Attire votre attention lorsque le terminal est en arrière-plan (macOS)
- **Son** - Si les sons du terminal sont activés dans les paramètres de votre terminal

Paramètres spécifiques au terminal :

- **Terminal macOS** : Préférences > Profils > Avancé > Bell (Visuel/Audible)
- **iTerm2** : Préférences > Profils > Terminal > Notifications
- **VS Code Terminal** : Paramètres > Terminal > Intégré : Activer Bell

Pour désactiver :
```json
{
  "ui": {
    "terminalBell": false
  }
}
```
### Rendu d'encre

Autohand utilise le moteur de rendu Ink 7 + React 19 par défaut pour les terminaux interactifs. L'ancien champ de configuration `ui.useInkRenderer` est ignoré, de sorte que les anciens fichiers de configuration ne peuvent pas forcer le compositeur du terminal simple. L'encre fournit :

- **Sortie sans scintillement** : toutes les mises à jour de l'interface utilisateur sont regroupées via la réconciliation React
- **Fonctionnalité de file d'attente de travail** : saisissez les instructions pendant que l'agent travaille
- **Meilleure gestion des entrées** : aucun conflit entre les gestionnaires de lignes de lecture
- **Interface utilisateur composable** : fondement des futures fonctionnalités avancées de l'interface utilisateur

Solution de secours d'urgence pour la compatibilité des terminaux :
```bash
AUTOHAND_LEGACY_UI=1 autohand
```
Remarque : Cette fonctionnalité est expérimentale et peut présenter des cas extrêmes. L'interface utilisateur par défaut basée sur ora reste stable et entièrement fonctionnelle.

### Vérification des mises à jour

Lorsque `checkForUpdates` est activé (par défaut), Autohand vérifie les nouvelles versions au démarrage :
```
> Autohand v0.6.8 (abc1234) ✓ Up to date
```
Si une mise à jour est disponible :
```
> Autohand v0.6.7 (abc1234) ⬆ Update available: v0.6.8
  ↳ Run: curl -fsSL https://autohand.ai/install.sh | sh
```
Comment ça marche :

- Récupère la dernière version de l'API GitHub
- Les caches génèrent `~/.autohand/version-check.json`
- Ne vérifie qu'une fois toutes les `updateCheckInterval` heures (par défaut : 24)
- Non bloquant : le démarrage continue même si la vérification échoue

Pour désactiver :
```json
{
  "ui": {
    "checkForUpdates": false
  }
}
```
Ou via une variable d'environnement :
```bash
export AUTOHAND_SKIP_UPDATE_CHECK=1
```
---

## Paramètres des agents

Contrôlez le comportement de l’agent et les limites d’itération.
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
| Champ | Tapez | Par défaut | Descriptif |
| -------------------- | ------- | ------- | ------------------------------------------------------------------------------ |
| `maxIterations` | numéro | `100` | Itérations maximales de l'outil par demande utilisateur avant l'arrêt |
| `enableRequestQueue` | booléen | `true` | Autoriser les utilisateurs à saisir et à mettre en file d'attente des demandes pendant que l'agent travaille |
| `toolSelectionCache` | booléen | `true` | Mettre en cache la sélection locale du schéma d'outil par tour pour une entrée de sélection d'outil équivalente |
| `autoMemory` | booléen | `true` | Extrayez et enregistrez des mémoires utilisateur/projet durables après des tours interactifs réussis |
| `idleLogoutEnabled` | booléen | `true` | Déconnectez-vous des sessions interactives authentifiées après le délai d'inactivité |
| `idleTimeoutMs` | numéro | `3600000` | Millisecondes d'inactivité avant la déconnexion d'une session authentifiée (60 minutes) |
| `debug` | booléen | `false` | Activer la sortie de débogage détaillée (enregistre l'état interne de l'agent dans stderr) |

### Sélection du schéma d'outil

Autohand n'envoie pas tous les schémas d'outils complets à chaque demande LLM. L'invite système comprend un catalogue compact de capacités d'outils, et chaque requête n'expose qu'un petit ensemble de schémas concrets sélectionnés parmi :

- Outils de découverte de base tels que `tool_search`, `read_file`, `fff_find` et `fff_grep`
- Outils adaptés à l'intention pour le travail d'édition, de vérification, de git, de navigateur, de Web, de dépendance ou de suivi de projet
- Outils demandés lors d'appels `tool_search` récents ou explicitement mentionnés par leur nom

Cela évite le coût contextuel initial important lié à l'envoi de tous les schémas d'outils avant que l'intention de l'utilisateur ne soit connue. `toolSelectionCache` contrôle uniquement le cache du sélecteur local pour des tours équivalents ; il n'effectue pas d'échauffement LLM pré-utilisateur et ne force pas un grand préfixe d'invite mis en cache.

Pour désactiver le cache du sélecteur local :
```json
{
  "agent": {
    "toolSelectionCache": false
  }
}
```
Pour maintenir actives les sessions d'agent authentifiées de longue durée pendant qu'ils attendent le travail :
```json
{
  "agent": {
    "idleLogoutEnabled": false
  }
}
```
Pour un seul processus, utilisez `autohand --no-idle-logout` ou définissez `AUTOHAND_NO_IDLE_LOGOUT=1`.

Définissez `idleTimeoutMs` sur une durée positive en millisecondes pour modifier la période d'inactivité. La valeur par défaut est `3600000` (60 minutes) ; les valeurs non valides utilisent la valeur par défaut.

### Mode débogage

Activez le mode débogage pour afficher la journalisation détaillée de l’état interne de l’agent (itérations de boucle de réaction, création d’invites, détails de la session). La sortie va vers stderr pour éviter d'interférer avec la sortie normale.

Trois façons d'activer le mode débogage (par ordre de priorité) :

1. **Drapeau CLI** : `autohand -d` ou `autohand --debug`
2. **Variable d'environnement** : `AUTOHAND_DEBUG=1`
3. **Fichier de configuration** : définissez `agent.debug: true`

### File d'attente des requêtes

Lorsque `enableRequestQueue` est activé, vous pouvez continuer à saisir des messages pendant que l'agent traite une demande précédente. Votre entrée sera mise en file d'attente et traitée automatiquement une fois la tâche en cours terminée.

- Tapez votre message et appuyez sur Entrée pour l'ajouter à la file d'attente
- La ligne d'état indique combien de demandes sont en file d'attente
- Les demandes sont traitées dans l'ordre FIFO (premier entré, premier sorti)
- La taille maximale de la file d'attente est de 10 requêtes

---

## Paramètres d'autorisations

Contrôle précis des autorisations des outils.
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

| Valeur | Descriptif |
| ---------------- | ----------------------------------------------------- |
| `"interactive"` | Demande d'approbation pour les opérations dangereuses (par défaut) |
| `"unrestricted"` | Aucune invite, autorisez tout |
| `"restricted"` | Refuser toutes les opérations dangereuses |

### `whitelist`

Gamme de modèles d'outils qui ne nécessitent jamais d'approbation.
```json
["run_command:npm *", "run_command:bun test"]
```
### `blacklist`

Tableau de modèles d'outils toujours bloqués.
```json
["run_command:rm -rf /", "run_command:sudo *"]
```
### `rules`

Règles d'autorisation précises.

| Champ | Tapez | Descriptif |
| --------- | --------- | ------------------------------------------------ | ---------- | ---------- |
| `tool` | chaîne | Nom de l'outil correspondant |
| `pattern` | chaîne | Modèle facultatif à comparer aux arguments |
| `action` | `"allow"` | `"deny"` | `"prompt"` | Action à entreprendre |

### `rememberSession`

| Tapez | Par défaut | Descriptif |
| ------- | ------- | ------------------------------------------------ |
| booléen | `true` | Mémoriser les décisions d'approbation pour la session |

### Autorisations de projet local

Chaque projet peut avoir ses propres paramètres d'autorisation qui remplacent la configuration globale. Ceux-ci sont stockés dans `.autohand/settings.local.json` à la racine de votre projet.

Lorsque vous approuvez une opération sur un fichier (modifier, écrire, supprimer), elle est automatiquement enregistrée dans ce fichier afin qu'il ne vous soit plus demandé d'effectuer la même opération dans ce projet.
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
**Comment ça marche :**

- Lorsque vous approuvez une opération, elle est enregistrée dans `.autohand/settings.local.json`
- La prochaine fois, la même opération sera automatiquement approuvée
- Les paramètres locaux du projet sont fusionnés avec les paramètres globaux (le local est prioritaire)
- Ajoutez `.autohand/settings.local.json` à `.gitignore` pour garder les paramètres personnels privés

**Format du motif :**

- `tool_name:path` - Pour les opérations sur les fichiers (par exemple, `apply_patch:src/file.ts`)
- `tool_name:command args` - Pour les commandes (par exemple, `run_command:npm test`)

### Afficher les autorisations

Vous pouvez afficher vos paramètres d'autorisation actuels de deux manières :

**Drapeau CLI (non interactif) :**
```bash
autohand --permissions
```
Ceci affiche :

- Mode d'autorisation actuel (interactif, illimité, restreint)
- Chemins d'accès à l'espace de travail et aux fichiers de configuration
- Tous les modèles approuvés (liste blanche)
- Tous les modèles refusés (liste noire)
- Statistiques récapitulatives

**Commande interactive :**
```
/permissions
```
En mode interactif, la commande `/permissions` fournit les mêmes informations ainsi que des options pour :

- Supprimer les éléments de la liste blanche
- Supprimer des éléments de la liste noire
- Effacer toutes les autorisations enregistrées

---

## Mode correctif

Le mode Patch vous permet de générer un correctif partageable compatible avec Git sans modifier les fichiers de votre espace de travail. Ceci est utile pour :

- Revue du code avant d'appliquer les modifications
- Partager les modifications générées par l'IA avec les membres de l'équipe
- Création d'ensembles de modifications reproductibles
- Pipelines CI/CD qui doivent capturer les modifications sans les appliquer

### Utilisation
```bash
# Generate patch to stdout
autohand --prompt "add user authentication" --patch

# Save to file
autohand --prompt "add user authentication" --patch --output auth.patch

# Pipe to file (alternative)
autohand --prompt "refactor api handlers" --patch > refactor.patch
```
### Comportement

Lorsque `--patch` est spécifié :

- **Confirmation automatique** : toutes les confirmations sont automatiquement acceptées (`--yes` implicite)
- **Aucune invite** : aucune invite d'approbation n'est affichée (`--unrestricted` implicite)
- **Aperçu uniquement** : les modifications sont capturées mais PAS écrites sur le disque
- **Sécurité renforcée** : les opérations sur liste noire (`.env`, clés SSH, commandes dangereuses) sont toujours bloquées

### Application de correctifs

Les destinataires peuvent appliquer le correctif à l'aide des commandes git standard :
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
### Format des correctifs

Le correctif généré suit le format de comparaison unifié de git :
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
### Codes de sortie

| Codes | Signification |
| ---- | --------------------------------------------------- |
| `0` | Succès, patch généré |
| `1` | Erreur (`--prompt` manquant, autorisation refusée, etc.) |

### Combinaison avec d'autres indicateurs
```bash
# Use specific model
autohand --prompt "optimize queries" --patch --model gpt-4o

# Specify workspace
autohand --prompt "add tests" --patch --path ./my-project

# Use custom config
autohand --prompt "refactor" --patch --config ~/.autohand/work.json
```
### Exemple de flux de travail d'équipe
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

## Paramètres réseau
```json
{
  "network": {
    "maxRetries": 3,
    "timeout": 30000,
    "retryDelay": 1000
  }
}
```
| Champ | Tapez | Par défaut | Max | Descriptif |
| ------------ | ------ | ------- | --- | -------------------------------------- |
| `maxRetries` | numéro | `3` | `5` | Nouvelles tentatives pour les requêtes API ayant échoué |
| `timeout` | numéro | `30000` | - | Délai d'expiration de la demande en millisecondes |
| `retryDelay` | numéro | `1000` | - | Délai entre les tentatives en millisecondes |

---

## Paramètres de télémétrie

La télémétrie est **désactivée par défaut** (opt-in). Activez-le pour contribuer à améliorer Autohand.
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
| Champ | Tapez | Par défaut | Descriptif |
| ------------------- | ------- | ------------------------- | --------------------------------------------- |
| `enabled` | booléen | `false` | Activer/désactiver la télémétrie (opt-in) |
| `apiBaseUrl` | chaîne | `https://api.autohand.ai` | Point de terminaison de l'API de télémétrie |
| `batchSize` | numéro | `20` | Nombre d'événements à regrouper avant le vidage automatique |
| `flushIntervalMs` | numéro | `60000` | Intervalle de rinçage en millisecondes (1 minute) |
| `maxQueueSize` | numéro | `500` | Taille maximale de la file d'attente avant de supprimer les anciens événements |
| `maxRetries` | numéro | `3` | Nouvelles tentatives pour les demandes de télémétrie ayant échoué |
| `enableSessionSync` | booléen | `true` | Synchronisez les sessions avec le cloud pour les fonctionnalités d'équipe lorsque la télémétrie est activée |
| `companySecret` | chaîne | `""` | Secret d'entreprise pour l'authentification API |

La télémétrie du fournisseur/modèle inclut l'identifiant du fournisseur actif, l'identifiant du modèle et les métadonnées non secrètes disponibles telles que le nom d'affichage du fournisseur personnalisé, le format API, l'effort de raisonnement et la fenêtre contextuelle. Les clés API et les jetons du porteur ne sont jamais inclus.

---

## Agents externes

Chargez des définitions d'agent personnalisées à partir de répertoires externes.
```json
{
  "externalAgents": {
    "enabled": true,
    "paths": ["~/.autohand/agents", "/team/shared/agents"]
  }
}
```
| Champ | Tapez | Par défaut | Descriptif |
| --------- | -------- | ------- | ------------------------------- |
| `enabled` | booléen | `false` | Activer le chargement des agents externes |
| `paths` | chaîne[] | `[]` | Répertoires à partir desquels charger les agents |

---

## Système de compétences

Les compétences sont des packages d'instructions qui fournissent des instructions spécialisées à l'agent IA. Ils fonctionnent comme des fichiers `AGENTS.md` à la demande qui peuvent être activés pour des tâches spécifiques.

### Lieux de découverte de compétences

Les compétences sont découvertes à partir de plusieurs endroits, les sources ultérieures étant prioritaires :

| Localisation | Identifiant de la source | Descriptif |
| --------------------------------------------- | ------------------ | ----------------------------------------- |
| `~/.codex/skills/**/SKILL.md` | `codex-user` | Compétences Codex au niveau de l'utilisateur (récursif) |
| `~/.claude/skills/*/SKILL.md` | `claude-user` | Compétences Claude au niveau utilisateur (un niveau) |
| `~/.autohand/skills/**/SKILL.md` | `autohand-user` | Compétences Autohand de niveau utilisateur (récursives) |
| `<project>/.claude/skills/*/SKILL.md` | `claude-project` | Compétences Claude au niveau du projet (un niveau) |
| `<project>/.autohand/skills/**/SKILL.md` | `autohand-project` | Compétences Autohand au niveau du projet (récursives) |

### Comportement de copie automatique

Les compétences découvertes dans les emplacements Codex ou Claude sont automatiquement copiées vers l'emplacement Autohand correspondant :

- `~/.codex/skills/` et `~/.claude/skills/` → `~/.autohand/skills/`
- `<project>/.claude/skills/` → `<project>/.autohand/skills/`

Les compétences existantes dans les emplacements Autohand ne sont jamais écrasées.

### Format SKILL.md

Les compétences utilisent le frontmatter YAML suivi du contenu markdown :
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
| Champ | Obligatoire | Longueur maximale | Descriptif |
| --------------- | -------- | ---------- | ------------------------------------------ |
| `name` | Oui | 64 caractères | Alphanumérique minuscule avec tirets uniquement |
| `description` | Oui | 1024 caractères | Brève description de la compétence |
| `license` | Non | - | Identifiant de licence (par exemple, MIT, Apache-2.0) |
| `compatibility` | Non | 500 caractères | Notes de compatibilité |
| `allowed-tools` | Non | - | Liste délimitée par des espaces des outils autorisés |
| `metadata` | Non | - | Métadonnées clé-valeur supplémentaires |

### Préfixes d'entrée

Autohand prend en charge les préfixes spéciaux dans l'invite de saisie :

| Préfixe | Descriptif | Exemple |
| ------ | ------------------------------- | ---------------------------------- |
| `/` | Commandes barre oblique | `/help`, `/model`, `/quit`, `/exit` |
| `@` | Mentions de fichiers (complétion automatique) | `@src/index.ts` |
| `$` | Mentions de compétences (complétion automatique) | `$frontend-design`, `$code-review` |
| `!` | Exécuter les commandes du terminal directement | `! git status`, `! ls -la` |

**Mentions de compétences (`$`) :**

- Tapez `$` suivi de caractères pour voir les compétences disponibles avec saisie semi-automatique
- L'onglet accepte la première suggestion (par exemple, `$frontend-design`)
- Les compétences sont découvertes à partir de `~/.autohand/skills/` et `<project>/.autohand/skills/`
- Les compétences activées sont attachées à l'invite sous forme d'instructions spéciales pour la session en cours
- Le panneau d'aperçu affiche les métadonnées des compétences (nom, description, état d'activation)

**Commandes Shell (`!`) :**

- Les commandes s'exécutent dans votre répertoire de travail actuel
- La sortie s'affiche directement dans le terminal
- Ne va pas au LLM
- Délai d'attente de 30 secondes
- Retourne à l'invite après l'exécution

### Commandes barre oblique

#### `/skills` - Gestionnaire de packages

| Commande | Descriptif |
| ------------------------------- | ------------------------------------------ |
| `/skills` | Liste toutes les compétences disponibles |
| `/skills use <name>` | Activer une compétence pour la session en cours |
| `/skills deactivate <name>` | Désactiver une compétence |
| `/skills info <name>` | Afficher des informations détaillées sur les compétences |
| `/skills install` | Parcourir et installer à partir du registre communautaire |
| `/skills install @<slug>` | Installer une compétence communautaire par slug |
| `/skills search <query>` | Rechercher dans le registre des compétences communautaires |
| `/skills trending` | Afficher les compétences communautaires tendances |
| `/skills remove <slug>` | Désinstaller une compétence communautaire |
| `/skills new` | Créer une nouvelle compétence de manière interactive |
| `/skills feedback <slug> <1-5>` | Évaluer une compétence communautaire |

#### `/learn` - Conseiller en compétences propulsé par LLM

| Commande | Descriptif |
| --------------- | ---------------------------------------------------------------- |
| `/learn` | Analyser le projet et recommander des compétences (analyse rapide) |
| `/learn deep` | Projet d'analyse approfondie (lit les fichiers sources) pour des résultats plus ciblés |
| `/learn update` | Réanalyser le projet et régénérer les compétences obsolètes générées par le LLM |

`/learn` utilise un flux LLM biphasé :

1. **Phase 1 - Analyser + Classement + Audit** : analyse la structure de votre projet, audite les compétences installées pour détecter les redondances/conflits et classe les compétences de la communauté par pertinence (0-100).
2. **Phase 2 - Générer** (conditionnel) : si aucune compétence communautaire n'obtient un score supérieur à 60, propose de générer une compétence personnalisée adaptée à votre projet.
Les compétences générées incluent des métadonnées (`agentskill-source: llm-generated`, `agentskill-project-hash`) afin que `/learn update` puisse détecter quand votre base de code change et régénérer les compétences obsolètes.

### Génération automatique de compétences (`--auto-skill`)

L'indicateur CLI `--auto-skill` génère des compétences sans le flux de conseiller interactif :
```bash
autohand --auto-skill
```
Cela va :

1. Analysez la structure de votre projet (package.json, conditions.txt, etc.)
2. Détecter les langages, les frameworks et les modèles
3. Générez 3 compétences pertinentes en utilisant le LLM
4. Enregistrez les compétences dans `<project>/.autohand/skills/`

Pour une expérience plus ciblée et interactive, utilisez plutôt `/learn` dans une session.

Les modèles détectés incluent :

- **Langues** : TypeScript, JavaScript, Python, Rust, Go
- **Frameworks** : React, Next.js, Vue, Express, Flask, Django
- **Modèles** : outils CLI, tests, monorepo, Docker, CI/CD

---

## Paramètres de l'API

Configuration de l'API backend pour les fonctionnalités de l'équipe.
```json
{
  "api": {
    "baseUrl": "https://api.autohand.ai",
    "companySecret": "sk-team-xxx"
  }
}
```
| Champ | Tapez | Par défaut | Descriptif |
| --------------- | ------ | ------------------------- | --------------------------------------- |
| `baseUrl` | chaîne | `https://api.autohand.ai` | Point de terminaison de l'API |
| `companySecret` | chaîne | - | Secret d'équipe/d'entreprise pour les fonctionnalités partagées |

Peut également être défini via des variables d'environnement :

- `AUTOHAND_API_URL` → `api.baseUrl`
- `AUTOHAND_SECRET` → `api.companySecret`

---

## Paramètres d'authentification

Authentification et configuration de la session utilisateur.
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
| Champ | Tapez | Par défaut | Descriptif |
| ------------- | ------ | ------- | -------------------------------------------- |
| `token` | chaîne | - | Jeton d'authentification pour l'accès à l'API |
| `user` | objet | - | Informations utilisateur authentifiées |
| `user.id` | chaîne | - | Identifiant utilisateur |
| `user.email` | chaîne | - | Adresse e-mail de l'utilisateur |
| `user.name` | chaîne | - | Nom d'affichage de l'utilisateur |
| `user.avatar` | chaîne | - | URL de l'avatar de l'utilisateur (facultatif) |
| `expiresAt` | chaîne | - | Horodatage d'expiration du jeton (format ISO 8601) |

---

## Paramètres de compétences de la communauté

Configuration pour la découverte et la gestion des compétences communautaires.
```json
{
  "communitySkills": {
    "enabled": true,
    "showSuggestionsOnStartup": true,
    "autoBackup": true
  }
}
```
| Champ | Tapez | Par défaut | Descriptif |
| -------------------------- | ------- | ------- | ------------------------------------------------------------- |
| `enabled` | booléen | `true` | Activer les fonctionnalités de compétences communautaires |
| `showSuggestionsOnStartup` | booléen | `true` | Afficher les suggestions de compétences au démarrage lorsqu'aucune compétence de fournisseur n'existe |
| `autoBackup` | booléen | `true` | Sauvegardez automatiquement les compétences des fournisseurs découvertes dans l'API |

---

## Paramètres de partage

Configuration du partage de session via la commande `/share`. Les sessions sont hébergées sur [autohand.link](https://autohand.link).
```json
{
  "share": {
    "enabled": true
  }
}
```
| Champ | Tapez | Par défaut | Descriptif |
| --------- | ------- | ------- | ----------------------------------- |
| `enabled` | booléen | `true` | Activer/désactiver la commande `/share` |

### Format YAML
```yaml
share:
  enabled: true
```
### Désactivation du partage de session

Si vous souhaitez désactiver le partage de session pour des raisons de sécurité ou de confidentialité :
```json
{
  "share": {
    "enabled": false
  }
}
```
Lorsqu'il est désactivé, l'exécution de `/share` affichera :
```
Session sharing is disabled.
To enable, set share.enabled: true in your config file.
```
---

## Synchronisation des paramètres

Autohand peut synchroniser votre configuration sur tous les appareils pour les utilisateurs connectés. Les paramètres sont stockés en toute sécurité dans Cloudflare R2 et cryptés avant le téléchargement.
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
| Champ | Tapez | Par défaut | Descriptif |
| ------------------ | -------- | --------------- | -------------------------------------------------- |
| `enabled` | booléen | `true` (enregistré) | Activer/désactiver la synchronisation des paramètres |
| `interval` | numéro | `300000` | Intervalle de synchronisation en millisecondes (par défaut : 5 minutes) |
| `exclude` | chaîne[] | `[]` | Modèles Glob à exclure de la synchronisation |
| `includeTelemetry` | booléen | `false` | Synchroniser les données de télémétrie (nécessite le consentement de l'utilisateur) |
| `includeFeedback` | booléen | `false` | Synchroniser les données des commentaires (nécessite le consentement de l'utilisateur) |

### Indicateur CLI
```bash
# Disable sync for this session
autohand --sync-settings=false

# Enable sync (default for logged users)
autohand --sync-settings
```
### Ce qui est synchronisé

Par défaut, ces éléments sont synchronisés pour les utilisateurs connectés :

- **Configuration** (`config.json`) - Les clés API sont cryptées avant le téléchargement
- **Agents personnalisés** (`agents/`)
- **Compétences communautaires** (`community-skills/`)
- **Hooks utilisateur** (`hooks/`)
- **Mémoire** (`memory/`)
- **Connaissance du projet** (`projects/`)
- **Historique des sessions** (`sessions/`)
- **Contenu partagé** (`share/`)
- **Compétences personnalisées** (`skills/`)

### Ce qui ne se synchronise pas (par défaut)

- **ID de l'appareil** (`device-id`) - Unique par appareil
- **Journaux d'erreurs** (`error.log`) - Local uniquement
- **Cache de version** (`version-*.json`) - Fichiers de cache local

### Synchronisation basée sur le consentement

Ces éléments nécessitent une inscription explicite dans votre configuration :

- **Données de télémétrie** - Définissez `sync.includeTelemetry: true` pour synchroniser
- **Données de retour** - Définissez `sync.includeFeedback: true` pour synchroniser
```json
{
  "sync": {
    "enabled": true,
    "includeTelemetry": true,
    "includeFeedback": true
  }
}
```
### Résolution des conflits

Lorsque des conflits surviennent (même fichier modifié sur plusieurs appareils), la **version cloud l'emporte**. Cela garantit la cohérence lors de la connexion sur de nouveaux appareils.

### Sécurité

Les clés API et autres données sensibles dans `config.json` sont chiffrées à l'aide de votre jeton d'authentification avant le téléchargement. Ils ne peuvent être déchiffrés qu’avec vos informations d’identification.

**Ce qui est crypté :**

- Champs nommés `apiKey`
- Champs se terminant par `Key`, `Token`, `Secret`
- Le champ `password`

### Comment ça marche

1. **Au démarrage** : si vous êtes connecté, le service de synchronisation démarre automatiquement
2. **Toutes les 5 minutes** : les paramètres sont comparés au stockage cloud
3. **Le cloud gagne** : les modifications à distance sont téléchargées en premier
4. **Téléchargements locaux** : les nouvelles modifications locales sont téléchargées
5. **À la sortie** : le service de synchronisation s'arrête normalement

### Exclusion de fichiers

Vous pouvez exclure des fichiers ou des modèles spécifiques de la synchronisation :
```json
{
  "sync": {
    "enabled": true,
    "exclude": ["custom-local-config.json", "temp/*"]
  }
}
```
### Format YAML
```yaml
sync:
  enabled: true
  interval: 300000
  exclude: []
  includeTelemetry: false
  includeFeedback: false
```
---

## Paramètres MCP

Configurez les serveurs MCP (Model Context Protocol) pour étendre Autohand avec des outils externes.
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

- **Tapez** : `boolean`
- **Par défaut** : `true`
- **Description** : activez ou désactivez toute la prise en charge MCP. Lorsque `false`, aucun serveur n'est connecté au démarrage et les outils MCP ne sont pas disponibles.

### `mcp.servers`

- **Tapez** : `McpServerConfigEntry[]`
- **Par défaut** : `[]`
- **Description** : Tableau de configurations de serveur MCP.

### Champs d'entrée du serveur

| Champ | Tapez | Obligatoire | Par défaut | Descriptif |
| ------------- | -------------------------------- | ---------- | ------- | ------------------------------------------------------------- |
| `name` | `string` | Oui | - | Identifiant unique du serveur |
| `transport` | `"stdio"` \| `"sse"` \| `"http"` | Oui | - | Type de transport |
| `command` | `string` | Oui (stdio) | - | Commande pour démarrer le processus serveur |
| `args` | `string[]` | Non | `[]` | Arguments pour la commande |
| `url` | `string` | Oui (sse/http) | - | URL du point de terminaison du serveur |
| `headers` | `Record<string, string>` | Non | `{}` | En-têtes HTTP personnalisés pour le transport http/sse (par exemple, jetons d'authentification) |
| `env` | `Record<string, string>` | Non | `{}` | Variables d'environnement transmises au serveur |
| `autoConnect` | `boolean` | Non | `true` | S'il faut se connecter automatiquement au démarrage |

> Les serveurs se connectent de manière asynchrone en arrière-plan lors du démarrage sans bloquer l'invite. Utilisez `/mcp` pour gérer les serveurs de manière interactive, ou `/mcp add` pour parcourir le registre de la communauté ou ajouter des serveurs personnalisés.

> Pour obtenir la documentation complète de MCP, voir [docs/mcp.md](mcp.md).

---

## Paramètres des crochets

Configuration des hooks de cycle de vie qui exécutent des commandes shell sur les événements d'agent. Voir [Documentation Hooks](./hooks.md) pour plus de détails.
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

| Champ | Tapez | Par défaut | Descriptif |
| --------- | ------- | ------- | --------------------------------- |
| `enabled` | booléen | `true` | Activer/désactiver tous les hooks globalement |
| `hooks` | tableau | `[]` | Tableau de définitions de crochets |

### Définition du crochet

| Champ | Tapez | Obligatoire | Par défaut | Descriptif |
| ------------- | ------- | -------- | ------- | -------------------------------- |
| `event` | chaîne | Oui | - | Événement auquel se connecter |
| `command` | chaîne | Oui | - | Commande Shell à exécuter |
| `description` | chaîne | Non | - | Description de l'affichage `/hooks` |
| `enabled` | booléen | Non | `true` | Si le hook est actif |
| `timeout` | numéro | Non | `5000` | Délai d'expiration en millisecondes |
| `async` | booléen | Non | `false` | Exécuter sans bloquer |
| `filter` | objet | Non | - | Filtrer par outil ou chemin |

### Événements de crochet

| Événement | Lorsqu'il est tiré |
| --------------- | ------------------------------------- |
| `pre-tool` | Avant qu'un outil ne s'exécute |
| `post-tool` | Une fois l'outil terminé |
| `file-modified` | Lorsque le fichier est créé/modifié/supprimé |
| `pre-prompt` | Avant d'envoyer en LLM |
| `post-response` | Après que LLM réponde |
| `session-error` | Lorsqu'une erreur se produit |

### Variables d'environnement

Lorsque les hooks s'exécutent, ces variables d'environnement sont disponibles :

| Variables | Descriptif |
| ---------------- | -------------------------------- |
| `HOOK_EVENT` | Nom de l'événement |
| `HOOK_WORKSPACE` | Chemin racine de l'espace de travail |
| `HOOK_TOOL` | Nom de l'outil (événements d'outil) |
| `HOOK_ARGS` | Arguments de l'outil codés en JSON |
| `HOOK_SUCCESS` | vrai/faux (post-outil) |
| `HOOK_PATH` | Chemin du fichier (fichier modifié) |
| `HOOK_TOKENS` | Jetons utilisés (post-réponse) |

---

## Paramètres des extensions Chrome

Contrôlez l'intégration de l'extension Autohand Chrome. Consultez le guide complet sur [Autohand dans Chrome](./autohand-in-chrome.md).
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
| Clé | Tapez | Par défaut | Descriptif |
| ------------------ | --------- | -------- | ------------------------------------------------------------------------- |
| `extensionId` | `string` | — | ID d'extension Chrome installé pour un transfert direct |
| `enabledByDefault` | `boolean` | `false` | Démarrez automatiquement le pont de navigateur avec la CLI |
| `browser` | `string` | `"auto"` | Navigateur Chromium préféré : `auto`, `chrome`, `chromium`, `brave`, `edge` |
| `userDataDir` | `string` | — | Répertoire de données utilisateur du navigateur pour cibler le bon profil |
| `profileDirectory` | `string` | — | Nom du répertoire du profil du navigateur (par exemple, `"Default"`, `"Profile 1"`) |
| `installUrl` | `string` | — | URL de secours lorsque l'ID d'extension n'est pas configuré |

### Indicateurs CLI
```bash
autohand --chrome          # Start with browser bridge enabled
autohand --no-chrome       # Start with browser bridge disabled
```
### Commandes barre oblique
```
/chrome                    # Open Chrome integration panel
/chrome disconnect         # Close the browser bridge connection
```
---

## Exemple complet

###Format JSON (`~/.autohand/config.json`)
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
###Format YAML (`~/.autohand/config.yaml`)
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
###Format TOML (`~/.autohand/config.toml`)
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

## Structure du répertoire

Autohand stocke les données dans `~/.autohand/` (ou `$AUTOHAND_HOME`) :
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
**Répertoire au niveau du projet** (à la racine de votre espace de travail) :
```
<project>/.autohand/
├── settings.local.json  # Local project permissions (gitignore this)
├── memory/              # Project-specific memory
├── skills/              # Project-specific skills
└── tools/               # Project-specific meta-tools
```
---

## Indicateurs CLI (remplacer la configuration)

Ces indicateurs remplacent les paramètres du fichier de configuration :

### Indicateurs de base

| Drapeau | Descriptif |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `-v, --version` | Afficher la version actuelle |
| `-p, --prompt [text]` | Exécuter une seule instruction en mode commande |
| `--path <path>` | Remplacer la racine de l'espace de travail |
| `--config <path>` | Utiliser le fichier de configuration personnalisé |
| `--model <model>` | Remplacer le modèle |
| `--temperature <n>` | Régler la température d'échantillonnage (0-1) |
| `--thinking [level]` | Définir la profondeur de la réflexion/du raisonnement (aucune, normale, étendue) |
| `-y, --yes` | Invites de confirmation automatique |
| `--dry-run` | Aperçu sans exécuter |
| `-d, --debug` | Activer la sortie de débogage détaillée |
| `--bare` | Mode explicite minimal ; définit également `AUTOHAND_CODE_SIMPLE=1` et désactive les commandes slash |

### Autorisations et sécurité

| Drapeau | Descriptif |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `--unrestricted` | Aucune invite d'approbation |
| `--restricted` | Refuser les opérations dangereuses |
| `--permissions` | Afficher les paramètres d'autorisation actuels et quitter |
| `--no-idle-logout` | Désactiver la déconnexion inactive authentifiée pour les sessions d'agent de longue durée |
| `--yolo [pattern]` | L'outil d'approbation automatique appelle le modèle correspondant (par exemple, `allow:read,write` ou `deny:delete`) |
| `--timeout <seconds>` | Délai d'expiration en secondes pour le mode d'approbation automatique |

### Git et arbre de travail

| Drapeau | Descriptif |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `--worktree [name]` | Exécuter la session dans un arbre de travail git isolé (nom de l'arbre de travail/de la branche facultatif) |
| `--tmux` | Lancer dans une session tmux dédiée (implique `--worktree` ; ne peut pas être utilisé avec `--no-worktree`) |
| `--no-worktree` | Désactiver l'isolation de git worktree en mode automatique |
| `-c, --auto-commit` | Valider automatiquement les modifications après avoir terminé les tâches |
| `--patch` | Générer le patch git sans appliquer les modifications |
| `--output <file>` | Fichier de sortie pour le patch (utilisé avec --patch) |

### Mode automatique
| Drapeau | Descriptif |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `--auto-mode [prompt]` | Activez le mode automatique interactif ou démarrez une boucle autonome avec une tâche en ligne |
| `--max-iterations <n>` | Itérations maximales en mode automatique (par défaut : 50) |
| `--completion-promise <text>` | Texte du marqueur d'achèvement (par défaut : "TERMINÉ") |
| `--checkpoint-interval <n>` | Git commit toutes les N itérations (par défaut : 5) |
| `--max-runtime <m>` | Durée d'exécution maximale en minutes (par défaut : 120) |
| `--max-cost <d>` | Coût maximum de l'API en dollars (par défaut : 10) |
| `--interactive-on-complete` | Une fois le mode automatique terminé, passez directement au mode interactif (ATS uniquement) |

### Compétences et apprentissage

| Drapeau | Descriptif |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `--auto-skill` | Générer automatiquement des compétences basées sur l'analyse du projet (voir également `/learn` pour le conseiller interactif) |
| `--learn` | Exécutez `/learn` Skill Advisor de manière non interactive (analysez et installez les compétences recommandées) |
| `--learn-update` | Réanalysez le projet et régénérez les compétences obsolètes générées par le LLM de manière non interactive |
| `--skill-install [name]` | Installer une compétence communautaire (ouvre le navigateur si aucun nom n'est fourni) |
| `--project` | Installer la compétence au niveau du projet (avec --skill-install) |

### Authentification et compte

| Drapeau | Descriptif |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `--login` | Connectez-vous à votre compte Autohand |
| `--logout` | Déconnectez-vous de votre compte Autohand |
| `--sync-settings` | Activer/désactiver la synchronisation des paramètres (par défaut : vrai pour les utilisateurs connectés) |

### Configuration et informations

| Drapeau | Descriptif |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `--setup` | Exécutez l'assistant de configuration pour configurer ou reconfigurer Autohand |
| `--about` | Afficher des informations sur Autohand (version, liens, informations de contribution) |
| `--feedback` | Soumettre vos commentaires à l'équipe Autohand |
| `--settings` | Configurer les paramètres Autohand (identiques à `/settings` en mode interactif) |

### Espace de travail et répertoires

| Drapeau | Descriptif |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `--add-dir <path...>` | Ajouter des répertoires supplémentaires à la portée de l'espace de travail (peut être utilisé plusieurs fois) |

### Modes d'exécution

| Drapeau | Descriptif |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `--mode <mode>` | Mode d'exécution : interactif (par défaut), rpc ou acp |
| `--acp` | Raccourci pour --mode acp (Agent Client Protocol sur stdio) |
| `--teammate-mode <mode>` | Mode d'affichage de l'équipe : auto, en cours ou tmux |

### Interface utilisateur et langue

| Drapeau | Descriptif |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `--display-language <locale>` | Définir la langue d'affichage (par exemple, en, id, zh-cn, fr, de, ja) |
| `--search-engine <provider>` | Définir le fournisseur de recherche Web (google, brave, duckduckgo, parallèle) |
| `--cc, --context-compact` | Activer le compactage du contexte (par défaut : activé) |
| `--no-cc, --no-context-compact` | Désactiver le compactage du contexte |

### Intégration de Chrome

| Drapeau | Descriptif |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `--chrome` | Activer l'intégration du navigateur Chrome (identique à `/chrome`) |
| `--no-chrome` | Désactiver l'intégration du navigateur Chrome |

### Invite système

| Drapeau | Descriptif |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `--sys-prompt <value>` | Remplacer l'intégralité de l'invite système (chaîne en ligne ou chemin de fichier) |
| `--append-sys-prompt <value>` | Ajouter à l'invite système (chaîne en ligne ou chemin de fichier) |
| `--system-prompt <value>` | Remplacer l'intégralité de l'invite système (chaîne en ligne ou chemin de fichier) |
| `--system-prompt-file <path>` | Remplacer l'intégralité de l'invite système par le contenu du fichier |
| `--append-system-prompt <value>` | Ajouter à l'invite système (chaîne en ligne ou chemin de fichier) |
| `--append-system-prompt-file <path>` | Ajouter le contenu du fichier à l'invite système |
| `--mcp-config <path>` | Charger un fichier de configuration MCP explicite |
| `--agents <json\|path>` | Charger des agents en ligne explicites JSON ou un répertoire d'agents explicites |
| `--plugin-dir <path>` | Charger un répertoire plugin/méta-outil explicite |

### Commandes de changement d'expérience

| Commande | Descriptif |
| ------------------------------------- | ------------------------------------------------ |
| `autohand experiments list` | Répertorier les identifiants de fonctionnalités locales et distantes, la source, l'étape du cycle de vie et l'état |
| `autohand experiments status <feature>` | Afficher un commutateur de fonctionnalité, un chemin de configuration ou des métadonnées distantes et un état |
| `autohand experiments refresh` | Téléchargez les indicateurs de fonctionnalités distantes à partir de l'API Autohand |
| `autohand experiments enable <feature>` | Activer un commutateur de fonctionnalités basé sur la configuration |
| `autohand experiments disable <feature>` | Désactiver un commutateur de fonctionnalité basé sur la configuration |

Les indicateurs de fonctionnalités distantes sont récupérés à partir de `/v1/feature-flags/evaluate`, mis en cache dans `~/.autohand/feature-flags.json` et actualisés après l'expiration de la durée de vie fournie par l'API. Utilisez `features.environment` pour sélectionner un environnement d'indicateurs distants et `features.remoteOverrides` pour les désinscriptions locales des indicateurs distants modifiables par l'utilisateur.

`usage_v2` est un commutateur de fonctionnalité expérimental pour le tableau de bord `/usage` et l'onglet d'utilisation amélioré de `/status`. Activez-le avec `autohand experiments enable usage_v2`.

`token_usage_status` est un commutateur de fonctionnalité expérimental (chemin de configuration `features.tokenUsageStatus`, désactivé par défaut) qui affiche l'utilisation des jetons en temps réel dans la ligne d'état de fonctionnement - jetons cumulés vers le haut (`↑`) et vers le bas (`↓`) plus l'occupation de la fenêtre contextuelle, par ex. `↑15.7k ↓3.2k · context: 6.0% (15.7k/262.1k)`. La fenêtre contextuelle est résolue par modèle pour tous les fournisseurs. Activez-le avec `autohand experiments enable token_usage_status`.

---

## Commandes barre oblique

Autohand fournit un riche ensemble de commandes slash pour une utilisation interactive. Tapez `/` dans le REPL pour voir les suggestions.

### Gestion des sessions

| Commande | Descriptif |
| ------------- | ----------------------------------------------------- |
| `/quit` | Quitter la session en cours |
| `/exit` | Quitter la session en cours |
| `/new` | Démarrer une nouvelle conversation (avec extraction de mémoire) |
| `/clear` | Conversation claire avec extraction automatique de la mémoire |
| `/session` | Afficher les détails de la session en cours |
| `/sessions` | Liste des sessions passées |
| `/resume` | Reprendre une session précédente |
| `/history` | Parcourir l'historique des sessions avec la pagination |
| `/undo` | Annuler les modifications de git et le dernier tour |
| `/export` | Exporter la session vers markdown/JSON/HTML |
| `/share` | Partager la session en cours |
| `/status` | Afficher l'état de la session |
| `/usage` | Afficher les limites du modèle, du fournisseur, du contexte et de l'utilisation |

### Modèle et fournisseur

| Commande | Descriptif |
| ------------- | ----------------------------------------------------- |
| `/model` | Changer ou configurer le modèle LLM |
| `/cc` | Compacter le contexte manuellement |

### Configuration du projet

| Commande | Descriptif |
| ------------- | ----------------------------------------------------- |
| `/init` | Créer le fichier `AGENTS.md` dans le répertoire actuel |
| `/setup` | Exécutez l'assistant d'installation pour configurer Autohand |
| `/add-dir` | Ajouter des répertoires à la portée de l'espace de travail |

### Agents et équipes

| Commande | Descriptif |
| ------------- | ----------------------------------------------------- |
| `/agents` | Liste des sous-agents disponibles |
| `/agents-new` | Créer un nouvel agent via l'assistant |
| `/squad` | Ouvrir/gérer le runtime autonome Autohand Squad |
| `/team` | Gérer une équipe pour un travail parallèle |
| `/tasks` | Gérer les tâches en équipe |
| `/message` | Envoyer un message à un coéquipier |

### Compétences

| Commande | Descriptif |
| ---------------- | -------------------------------------------------- |
| `/skills` | Répertorier et gérer les compétences |
| `/skills-new` | Créer une nouvelle compétence |
| `/learn` | Apprendre et installer les compétences recommandées |

### Mémoire et paramètres

| Commande | Descriptif |
| ------------- | ----------------------------------------------------- |
| `/memory` | Afficher et gérer les souvenirs stockés |
| `/settings` | Configurer les paramètres Autohand |
| `/statusline` | Configurer les champs de la ligne d'état du compositeur |
| `/experiments` | Basculer les commutateurs de fonctionnalités expérimentales |
| `/sync` | Synchroniser les paramètres sur tous les appareils |
| `/import` | Importez des sessions, des paramètres, du MCP, de la mémoire, des compétences et des hooks à partir d'agents pris en charge |

### Autorisations et crochets

| Commande | Descriptif |
| ------------- | ----------------------------------------------------- |
| `/permissions`| Gérer les autorisations des outils |
| `/hooks` | Gérer les hooks de cycle de vie |

### Authentification

| Commande | Descriptif |
| ------------- | ----------------------------------------------------- |
| `/login` | Authentifiez-vous avec l'API Autohand |
| `/logout` | Se déconnecter du compte Autohand |

### Outils et utilitaires

| Commande | Descriptif |
| ------------- | ----------------------------------------------------- |
| `/search` | Rechercher sur le Web |
| `/formatters` | Liste des formateurs de code disponibles |
| `/lint` | Liste des linters de code disponibles |
| `/completion` | Générer des scripts de complétion shell |
| `/plan` | Créer un plan de mise en œuvre |
| `/review` | Effectuer une révision du code |
| `/pr-review` | Examiner une pull request |

### Intégration de l'EDI

| Commande | Descriptif |
| ------------- | ----------------------------------------------------- |
| `/ide` | Détecter et se connecter aux IDE en cours d'exécution |

### MCP (Protocole de contexte de modèle)

| Commande | Descriptif |
| ------------- | ----------------------------------------------------- |
| `/mcp` | Gestionnaire de serveur MCP interactif |

### Automatisation

| Commande | Descriptif |
| ------------- | ----------------------------------------------------- |
| `/automode` | Démarrer le mode de codage autonome |
| `/repeat` | Planifier des tâches récurrentes |
| `/yolo` | Basculer le mode yolo (outils d'approbation automatique) |

### Intégration de Chrome

| Commande | Descriptif |
| ------------- | ----------------------------------------------------- |
| `/chrome` | Activer l'intégration du navigateur Chrome |

### Interface utilisateur et affichage

| Commande | Descriptif |
| ------------- | ----------------------------------------------------- |
| `/help` | Afficher les commandes slash et les astuces disponibles |
| `/about` | Afficher des informations sur Autohand |
| `/theme` | Changer le thème de couleur |
| `/language` | Changer la langue d'affichage |
| `/feedback` | Envoyer vos commentaires à l'équipe Autohand |

---

## Personnalisation de l'invite système
Autohand vous permet de personnaliser l'invite système utilisée par l'agent AI. Ceci est utile pour les flux de travail spécialisés, les instructions personnalisées ou l'intégration avec d'autres systèmes.

### Indicateurs CLI

| Drapeau | Descriptif |
| ----------------------------- | ------------------------------------------------ |
| `--sys-prompt <value>` | Remplacer l'intégralité de l'invite système |
| `--append-sys-prompt <value>` | Ajouter du contenu à l'invite système par défaut |

Les deux drapeaux acceptent soit :

- **Chaîne en ligne** : contenu de texte direct
- **Chemin du fichier** : chemin d'accès à un fichier contenant l'invite (détecté automatiquement)

### Détection du chemin du fichier

Une valeur est traitée comme un chemin de fichier si :

- Commence par `./`, `../`, `/` ou `~/`
- Commence par une lettre de lecteur Windows (par exemple, `C:\`)
- Se termine par `.txt`, `.md` ou `.prompt`
- Contient des séparateurs de chemin sans espaces

Sinon, elle est traitée comme une chaîne en ligne.

### `--sys-prompt` (Remplacement complet)

Lorsqu'il est fourni, cela **remplace complètement** l'invite système par défaut. L'agent ne chargera PAS :

- Instructions Autohand par défaut
- Instructions du projet AGENTS.md
- Mémoires utilisateur/projet
- Compétences actives
```bash
# Inline string
autohand --sys-prompt "You are a Python expert. Be concise." --prompt "Write hello world"

# From file
autohand --sys-prompt ./custom-prompt.txt --prompt "Explain this code"

# Home directory
autohand --sys-prompt ~/.autohand/prompts/python-expert.md --prompt "Debug this function"
```
**Exemple de fichier d'invite personnalisé (`custom-prompt.txt`) :**
```
You are a specialized Python debugging assistant.

Rules:
- Focus only on Python code
- Always explain the root cause
- Suggest fixes with code examples
- Be concise and direct
```
### `--append-sys-prompt` (Ajouter aux valeurs par défaut)

Lorsqu'il est fourni, cela **ajoute** le contenu à l'invite système complète par défaut. L'agent chargera toujours :

- Instructions Autohand par défaut
- Instructions du projet AGENTS.md
- Mémoires utilisateur/projet
- Compétences actives

Le contenu ajouté est ajouté à la toute fin.
```bash
# Inline string
autohand --append-sys-prompt "Always use TypeScript instead of JavaScript" --prompt "Create a function"

# From file
autohand --append-sys-prompt ./team-guidelines.md --prompt "Add error handling"
```
**Exemple de fichier à ajouter (`team-guidelines.md`) :**
```
## Team Guidelines

- Use 2-space indentation
- Prefer functional patterns
- Add JSDoc comments to public APIs
- Run tests before committing
```
### Priorité

Lorsque les deux drapeaux sont fournis :

1. `--sys-prompt` a la pleine priorité
2. `--append-sys-prompt` est ignoré
```bash
# --append-sys-prompt is ignored in this case
autohand --sys-prompt "Custom only" --append-sys-prompt "This is ignored"
```
### Cas d'utilisation

| Cas d'utilisation | Drapeau recommandé |
| --------------------------------- | ------------------------------------ |
| Personnalité d'agent personnalisée | `--sys-prompt` |
| Instructions minimales | `--sys-prompt` |
| Ajouter des directives d'équipe | `--append-sys-prompt` |
| Ajouter des conventions de projet | `--append-sys-prompt` |
| Intégration avec des systèmes externes | `--sys-prompt` |
| Débogage spécialisé | `--sys-prompt` |

### Gestion des erreurs

| Scénario | Comportement |
| ----------------- | -------------------- |
| Valeur vide | Erreur |
| Fichier introuvable | Traité comme une chaîne en ligne |
| Fichier vide | Erreur |
| Fichier > 1 Mo | Erreur |
| Autorisation refusée | Erreur |
| Chemin du répertoire | Erreur |

### Exemples
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

## Prise en charge multi-répertoire

Autohand peut fonctionner avec plusieurs répertoires au-delà de l'espace de travail principal. Ceci est utile lorsque votre projet comporte des dépendances, des bibliothèques partagées ou des projets associés dans différents répertoires.

### Indicateur CLI

Utilisez `--add-dir` pour ajouter des répertoires supplémentaires (peut être utilisé plusieurs fois) :
```bash
# Add a single additional directory
autohand --add-dir /path/to/shared-lib

# Add multiple directories
autohand --add-dir /path/to/lib1 --add-dir /path/to/lib2

# With unrestricted mode (auto-approve writes to all directories)
autohand --add-dir /path/to/shared-lib --unrestricted
```
### Commande interactive

Utilisez `/add-dir` lors d'une session interactive :
```
/add-dir              # Show current directories
/add-dir /path/to/dir # Add a new directory
```
### Restrictions de sécurité

Les répertoires suivants ne peuvent pas être ajoutés :

- Répertoire personnel (`~` ou `$HOME`)
- Répertoire racine (`/`)
- Répertoires système (`/etc`, `/var`, `/usr`, `/bin`, `/sbin`)
- Répertoires système Windows (`C:\Windows`, `C:\Program Files`)
- Répertoires des utilisateurs Windows (`C:\Users\username`)
- Montages WSL Windows (`/mnt/c`, `/mnt/c/Windows`)
