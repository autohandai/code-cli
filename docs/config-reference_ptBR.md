# Referência de Configuração do Autohand

Referência completa de todas as opções de configuração em `~/.autohand/config.json` (ou `.yaml`/`.yml`).

## Índice

- [Localização do Arquivo de Configuração](#localização-do-arquivo-de-configuração)
- [Variáveis de Ambiente](#variáveis-de-ambiente)
- [Configurações do Provedor](#configurações-do-provedor)
- [Configurações do Workspace](#configurações-do-workspace)
- [Configurações da Interface](#configurações-da-interface)
- [Configurações do Agente](#configurações-do-agente)
- [Configurações de Permissões](#configurações-de-permissões)
- [Configurações de Rede](#configurações-de-rede)
- [Configurações de Telemetria](#configurações-de-telemetria)
- [Agentes Externos](#agentes-externos)
- [Configurações da API](#configurações-da-api)
- [Exemplo Completo](#exemplo-completo)

---

## Localização do Arquivo de Configuração

O Autohand procura a configuração nesta ordem:

1. Variável de ambiente `AUTOHAND_CONFIG` (caminho personalizado)
2. `~/.autohand/config.yaml`
3. `~/.autohand/config.yml`
4. `~/.autohand/config.json` (padrão)

Você também pode sobrescrever o diretório base:
```bash
export AUTOHAND_HOME=/caminho/personalizado  # Altera ~/.autohand para /caminho/personalizado
```

---

## Variáveis de Ambiente

| Variável | Descrição | Exemplo |
|----------|-----------|---------|
| `AUTOHAND_HOME` | Diretório base para todos os dados do Autohand | `/caminho/personalizado` |
| `AUTOHAND_CONFIG` | Caminho personalizado do arquivo de configuração | `/caminho/para/config.json` |
| `AUTOHAND_API_URL` | Endpoint da API (sobrescreve configuração) | `https://api.autohand.ai` |
| `AUTOHAND_SECRET` | Chave secreta da empresa/equipe | `sk-xxx` |

---

## Configurações do Provedor

### `provider`
Provedor LLM ativo a ser usado.

| Valor | Descrição |
|-------|-----------|
| `"openrouter"` | API OpenRouter (padrão) |
| `"ollama"` | Instância local do Ollama |
| `"llamacpp"` | Servidor local llama.cpp |
| `"openai"` | API OpenAI diretamente |

### `openrouter`
Configuração do provedor OpenRouter.

```json
{
  "openrouter": {
    "apiKey": "sk-or-v1-xxx",
    "baseUrl": "https://openrouter.ai/api/v1",
    "model": "anthropic/claude-sonnet-4"
  }
}
```

| Campo | Tipo | Obrigatório | Padrão | Descrição |
|-------|------|-------------|--------|-----------|
| `apiKey` | string | Sim | - | Sua chave de API do OpenRouter |
| `baseUrl` | string | Não | `https://openrouter.ai/api/v1` | Endpoint da API |
| `model` | string | Sim | - | Identificador do modelo (ex.: `anthropic/claude-sonnet-4`) |

### `ollama`
Configuração do provedor Ollama.

```json
{
  "ollama": {
    "baseUrl": "http://localhost:11434",
    "port": 11434,
    "model": "llama3.2"
  }
}
```

| Campo | Tipo | Obrigatório | Padrão | Descrição |
|-------|------|-------------|--------|-----------|
| `baseUrl` | string | Não | `http://localhost:11434` | URL do servidor Ollama |
| `port` | number | Não | `11434` | Porta do servidor (alternativa ao baseUrl) |
| `model` | string | Sim | - | Nome do modelo (ex.: `llama3.2`, `codellama`) |

### `llamacpp`
Configuração do servidor llama.cpp.

```json
{
  "llamacpp": {
    "baseUrl": "http://localhost:8080",
    "port": 8080,
    "model": "default"
  }
}
```

| Campo | Tipo | Obrigatório | Padrão | Descrição |
|-------|------|-------------|--------|-----------|
| `baseUrl` | string | Não | `http://localhost:8080` | URL do servidor llama.cpp |
| `port` | number | Não | `8080` | Porta do servidor |
| `model` | string | Sim | - | Identificador do modelo |

### `openai`
Configuração da API OpenAI.

```json
{
  "openai": {
    "apiKey": "sk-xxx",
    "baseUrl": "https://api.openai.com/v1",
    "model": "gpt-4o"
  }
}
```

| Campo | Tipo | Obrigatório | Padrão | Descrição |
|-------|------|-------------|--------|-----------|
| `apiKey` | string | Sim | - | Chave de API da OpenAI |
| `baseUrl` | string | Não | `https://api.openai.com/v1` | Endpoint da API |
| `model` | string | Sim | - | Nome do modelo (ex.: `gpt-4o`, `gpt-4o-mini`) |

---

## Configurações do Workspace

```json
{
  "workspace": {
    "defaultRoot": "/caminho/para/projetos",
    "allowDangerousOps": false
  }
}
```

| Campo | Tipo | Padrão | Descrição |
|-------|------|--------|-----------|
| `defaultRoot` | string | Diretório atual | Workspace padrão quando nenhum é especificado |
| `allowDangerousOps` | boolean | `false` | Permitir operações destrutivas sem confirmação |

---

## Configurações da Interface

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

| Campo | Tipo | Padrão | Descrição |
|-------|------|--------|-----------|
| `theme` | `"dark"` \| `"light"` | `"dark"` | Tema de cores para saída do terminal |
| `autoConfirm` | boolean | `false` | Pular prompts de confirmação para operações seguras |
| `readFileCharLimit` | number | `300` | Máximo de caracteres exibidos em tools de leitura/busca (o conteúdo completo ainda é enviado ao modelo) |
| `showCompletionNotification` | boolean | `true` | Mostrar notificação do sistema quando a tarefa terminar |
| `showThinking` | boolean | `true` | Exibir o raciocínio/processo de pensamento do LLM |
| `useInkRenderer` | boolean | `false` | Usar renderizador baseado em Ink para UI sem flicker (experimental) |
| `terminalBell` | boolean | `true` | Tocar sineta do terminal quando a tarefa terminar (mostra badge na aba/dock) |
| `checkForUpdates` | boolean | `true` | Verificar atualizações da CLI na inicialização |
| `updateCheckInterval` | number | `24` | Horas entre verificações de atualização (usa resultado em cache dentro do intervalo) |

Nota: `readFileCharLimit` afeta apenas a exibição no terminal para `read_file`, `search` e `search_with_context`. O conteúdo completo ainda é enviado ao modelo e armazenado nas mensagens de ferramentas.

### Sineta do Terminal

Quando `terminalBell` está habilitado (padrão), o Autohand toca a sineta do terminal (`\x07`) quando uma tarefa é concluída. Isso aciona:

- **Badge na aba do terminal** - Mostra um indicador visual de que o trabalho foi concluído
- **Bounce do ícone no Dock** - Chama sua atenção quando o terminal está em segundo plano (macOS)
- **Som** - Se os sons do terminal estiverem habilitados nas configurações do seu terminal

Configurações específicas por terminal:
- **macOS Terminal**: Preferências > Perfis > Avançado > Sineta (Visual/Audível)
- **iTerm2**: Preferências > Perfis > Terminal > Notificações
- **VS Code Terminal**: Configurações > Terminal > Integrated: Enable Bell

Para desabilitar:
```json
{
  "ui": {
    "terminalBell": false
  }
}
```

### Renderizador Ink (Experimental)

Quando `useInkRenderer` está habilitado, o Autohand usa renderização de terminal baseada em React (Ink) ao invés do spinner ora tradicional. Isso fornece:

- **Saída sem flicker**: Todas as atualizações de UI são agrupadas através da reconciliação do React
- **Recurso de fila de trabalho**: Digite instruções enquanto o agente trabalha
- **Melhor manipulação de entrada**: Sem conflitos entre handlers de readline
- **UI composável**: Base para recursos avançados de UI futuros

Para habilitar:
```json
{
  "ui": {
    "useInkRenderer": true
  }
}
```

Nota: Este recurso é experimental e pode ter casos extremos. A UI padrão baseada em ora permanece estável e totalmente funcional.

### Verificação de Atualização

Quando `checkForUpdates` está habilitado (padrão), o Autohand verifica novas versões na inicialização:

```
> Autohand v0.6.8 (abc1234) ✓ Up to date
```

Se uma atualização estiver disponível:
```
> Autohand v0.6.7 (abc1234) ⬆ Update available: v0.6.8
  ↳ Run: curl -fsSL https://autohand.ai/install.sh | sh
```

Como funciona:
- Busca a última versão na API do GitHub
- Armazena resultado em cache em `~/.autohand/version-check.json`
- Verifica apenas uma vez a cada `updateCheckInterval` horas (padrão: 24)
- Não-bloqueante: a inicialização continua mesmo se a verificação falhar

Para desabilitar:
```json
{
  "ui": {
    "checkForUpdates": false
  }
}
```

Ou via variável de ambiente:
```bash
export AUTOHAND_SKIP_UPDATE_CHECK=1
```

---

## Configurações do Agente

Controle o comportamento do agente e limites de iteração.

```json
{
  "agent": {
    "maxIterations": 100,
    "enableRequestQueue": true
  }
}
```

| Campo | Tipo | Padrão | Descrição |
|-------|------|--------|-----------|
| `maxIterations` | number | `100` | Máximo de iterações de ferramentas por solicitação do usuário antes de parar |
| `enableRequestQueue` | boolean | `true` | Permitir que usuários digitem e enfileirem solicitações enquanto o agente trabalha |

### Fila de Solicitações

Quando `enableRequestQueue` está habilitado, você pode continuar digitando mensagens enquanto o agente processa uma solicitação anterior. Sua entrada será enfileirada e processada automaticamente quando a tarefa atual for concluída.

- Digite sua mensagem e pressione Enter para adicionar à fila
- A linha de status mostra quantas solicitações estão enfileiradas
- As solicitações são processadas em ordem FIFO (primeiro a entrar, primeiro a sair)
- Tamanho máximo da fila é 10 solicitações

---

## Configurações de Permissões

Controle granular sobre permissões de ferramentas.

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

| Valor | Descrição |
|-------|-----------|
| `"interactive"` | Solicitar aprovação em operações perigosas (padrão) |
| `"unrestricted"` | Sem prompts, permitir tudo |
| `"restricted"` | Negar todas as operações perigosas |

### `whitelist`
Array de padrões de ferramentas que nunca requerem aprovação.

```json
["run_command:npm *", "run_command:bun test"]
```

### `blacklist`
Array de padrões de ferramentas que são sempre bloqueados.

```json
["run_command:rm -rf /", "run_command:sudo *"]
```

### `rules`
Regras de permissão granulares.

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `tool` | string | Nome da ferramenta para corresponder |
| `pattern` | string | Padrão opcional para corresponder contra argumentos |
| `action` | `"allow"` \| `"deny"` \| `"prompt"` | Ação a tomar |

### `rememberSession`
| Tipo | Padrão | Descrição |
|------|--------|-----------|
| boolean | `true` | Lembrar decisões de aprovação para a sessão |

### Permissões Locais do Projeto

Cada projeto pode ter suas próprias configurações de permissão que sobrescrevem a configuração global. Estas são armazenadas em `.autohand/settings.local.json` na raiz do seu projeto.

Quando você aprova uma operação de arquivo (editar, escrever, excluir), ela é automaticamente salva neste arquivo para que não seja perguntado novamente para a mesma operação neste projeto.

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

**Como funciona:**
- Quando você aprova uma operação, ela é salva em `.autohand/settings.local.json`
- Da próxima vez, a mesma operação será auto-aprovada
- Configurações locais do projeto são mescladas com configurações globais (local tem prioridade)
- Adicione `.autohand/settings.local.json` ao `.gitignore` para manter configurações pessoais privadas

**Formato do padrão:**
- `nome_ferramenta:caminho` - Para operações de arquivo (ex: `multi_file_edit:src/file.ts`)
- `nome_ferramenta:comando args` - Para comandos (ex: `run_command:npm test`)

---

## Configurações de Rede

```json
{
  "network": {
    "maxRetries": 3,
    "timeout": 30000,
    "retryDelay": 1000
  }
}
```

| Campo | Tipo | Padrão | Máx | Descrição |
|-------|------|--------|-----|-----------|
| `maxRetries` | number | `3` | `5` | Tentativas de retry para requisições de API falhas |
| `timeout` | number | `30000` | - | Timeout da requisição em milissegundos |
| `retryDelay` | number | `1000` | - | Atraso entre retries em milissegundos |

---

## Configurações de Telemetria

A telemetria está **desabilitada por padrão** (opt-in). Habilite para ajudar a melhorar o Autohand.

```json
{
  "telemetry": {
    "enabled": false,
    "apiBaseUrl": "https://api.autohand.ai",
    "enableSessionSync": false
  }
}
```

| Campo | Tipo | Padrão | Descrição |
|-------|------|--------|-----------|
| `enabled` | boolean | `false` | Habilitar/desabilitar telemetria (opt-in) |
| `apiBaseUrl` | string | `https://api.autohand.ai` | Endpoint da API de telemetria |
| `enableSessionSync` | boolean | `false` | Sincronizar sessões para a nuvem para recursos de equipe |

---

## Agentes Externos

Carregar definições de agentes personalizados de diretórios externos.

```json
{
  "externalAgents": {
    "enabled": true,
    "paths": [
      "~/.autohand/agents",
      "/equipe/compartilhado/agents"
    ]
  }
}
```

| Campo | Tipo | Padrão | Descrição |
|-------|------|--------|-----------|
| `enabled` | boolean | `false` | Habilitar carregamento de agentes externos |
| `paths` | string[] | `[]` | Diretórios para carregar agentes |

---

## Configurações da API

Configuração da API backend para recursos de equipe.

```json
{
  "api": {
    "baseUrl": "https://api.autohand.ai",
    "companySecret": "sk-team-xxx"
  }
}
```

| Campo | Tipo | Padrão | Descrição |
|-------|------|--------|-----------|
| `baseUrl` | string | `https://api.autohand.ai` | Endpoint da API |
| `companySecret` | string | - | Segredo da equipe/empresa para recursos compartilhados |

Também pode ser definido via variáveis de ambiente:
- `AUTOHAND_API_URL` → `api.baseUrl`
- `AUTOHAND_SECRET` → `api.companySecret`

---

## Exemplo Completo

### Formato JSON (`~/.autohand/config.json`)

```json
{
  "provider": "openrouter",
  "openrouter": {
    "apiKey": "sk-or-v1-sua-chave-aqui",
    "baseUrl": "https://openrouter.ai/api/v1",
    "model": "anthropic/claude-sonnet-4"
  },
  "ollama": {
    "baseUrl": "http://localhost:11434",
    "model": "llama3.2"
  },
  "workspace": {
    "defaultRoot": "~/projetos",
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

### Formato YAML (`~/.autohand/config.yaml`)

```yaml
provider: openrouter

openrouter:
  apiKey: sk-or-v1-sua-chave-aqui
  baseUrl: https://openrouter.ai/api/v1
  model: anthropic/claude-sonnet-4

ollama:
  baseUrl: http://localhost:11434
  model: llama3.2

workspace:
  defaultRoot: ~/projetos
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

## Estrutura de Diretórios

O Autohand armazena dados em `~/.autohand/` (ou `$AUTOHAND_HOME`):

```
~/.autohand/
├── config.json          # Configuração principal
├── config.yaml          # Configuração alternativa YAML
├── device-id            # Identificador único do dispositivo
├── error.log            # Log de erros
├── feedback.log         # Submissões de feedback
├── sessions/            # Histórico de sessões
├── projects/            # Base de conhecimento do projeto
├── memory/              # Memória do nível do usuário
├── commands/            # Comandos personalizados
├── agents/              # Definições de agentes
├── tools/               # Meta-ferramentas personalizadas
├── feedback/            # Estado do feedback
└── telemetry/           # Dados de telemetria
    ├── queue.json
    └── session-sync-queue.json
```

**Diretório a nível de projeto** (na raiz do seu workspace):

```
<projeto>/.autohand/
├── settings.local.json  # Permissões locais do projeto (adicione ao gitignore)
├── memory/              # Memória específica do projeto
└── skills/              # Skills específicas do projeto
```

---

## Flags da CLI (Sobrescrever Configuração)

Estas flags sobrescrevem as configurações do arquivo:

| Flag | Descrição |
|------|-----------|
| `--model <modelo>` | Sobrescrever modelo |
| `--path <caminho>` | Sobrescrever raiz do workspace |
| `--config <caminho>` | Usar arquivo de configuração personalizado |
| `--temperature <n>` | Definir temperatura (0-1) |
| `--yes` | Auto-confirmar prompts |
| `--dry-run` | Visualizar sem executar |
| `--unrestricted` | Sem prompts de aprovação |
| `--restricted` | Negar operações perigosas |
| `--setup` | Executar o assistente de configuração para configurar ou reconfigurar o Autohand |
