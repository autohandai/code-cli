# Referência de Configuração do Autohand

Referência completa de todas as opções de configuração em `~/.autohand/config.json` (ou `.yaml`/`.yml`).

> **Dica:** A maioria das configurações abaixo pode ser alterada interativamente usando o comando `/settings` em vez de editar o arquivo manualmente.

Referências localizadas：

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

## Índice

- [Localização do Arquivo de Configuração](#localização-do-arquivo-de-configuração)
- [Variáveis de Ambiente](#variáveis-de-ambiente)
- [Configurações do Provedor](#configurações-do-provedor)
- [Configurações do Workspace](#configurações-do-workspace)
- [Configurações da Interface](#configurações-da-interface)
- [Configurações do Agente](#configurações-do-agente)
- [Configurações de Permissões](#configurações-de-permissões)
- [Modo Patch](#modo-patch)
- [Configurações de Rede](#configurações-de-rede)
- [Configurações de Telemetria](#configurações-de-telemetria)
- [Agentes Externos](#agentes-externos)
- [Sistema de Skills](#sistema-de-skills)
- [Configurações da API](#configurações-da-api)
- [Configurações de Autenticação](#configurações-de-autenticação)
- [Configurações de Skills Comunitárias](#configurações-de-skills-comunitárias)
- [Configurações de Compartilhamento](#configurações-de-compartilhamento)
- [Sincronização de Configurações](#sincronização-de-configurações)
- [Configurações de Hooks](#configurações-de-hooks)
- [Configurações MCP](#configurações-mcp)
- [Configurações da Extensão Chrome](#configurações-da-extensão-chrome)
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

| Variável                               | Descrição                                      | Exemplo                          |
| -------------------------------------- | ---------------------------------------------- | -------------------------------- |
| `AUTOHAND_HOME`                        | Diretório base para todos os dados do Autohand | `/caminho/personalizado`         |
| `AUTOHAND_CONFIG`                      | Caminho personalizado do arquivo de configuração | `/caminho/para/config.json`     |
| `AUTOHAND_API_URL`                     | Endpoint da API (sobrescreve configuração)     | `https://api.autohand.ai`        |
| `AUTOHAND_SECRET`                      | Chave secreta da empresa/equipe               | `sk-xxx`                         |
| `AUTOHAND_PERMISSION_CALLBACK_URL`     | URL para callback de permissão (experimental)  | `http://localhost:3000/callback` |
| `AUTOHAND_PERMISSION_CALLBACK_TIMEOUT` | Timeout para callback de permissão em ms       | `5000`                           |
| `AUTOHAND_NON_INTERACTIVE`             | Executar em modo não-interativo                | `1`                              |
| `AUTOHAND_YES`                         | Auto-confirmar todos os prompts                | `1`                              |
| `AUTOHAND_NO_BANNER`                   | Desabilitar banner de inicialização            | `1`                              |
| `AUTOHAND_STREAM_TOOL_OUTPUT`          | Stream output das ferramentas em tempo real    | `1`                              |
| `AUTOHAND_DEBUG`                       | Habilitar logging de debug                     | `1`                              |
| `AUTOHAND_THINKING_LEVEL`              | Definir nível de raciocínio                    | `normal`                         |
| `AUTOHAND_CLIENT_NAME`                 | Identificador do cliente/editor (definido por extensões ACP) | `zed`              |
| `AUTOHAND_CLIENT_VERSION`              | Versão do cliente (definido por extensões ACP) | `0.169.0`                        |

### Nível de Raciocínio

A variável de ambiente `AUTOHAND_THINKING_LEVEL` controla a profundidade do raciocínio que o modelo usa:

| Valor      | Descrição                                                         |
| ---------- | ----------------------------------------------------------------- |
| `none`     | Respostas diretas sem raciocínio visível                          |
| `normal`   | Profundidade de raciocínio padrão (padrão)                        |
| `extended` | Raciocínio profundo para tarefas complexas, mostra processo de pensamento mais detalhado |

Isso é tipicamente definido por extensões cliente ACP (como Zed) através do dropdown de configuração.

```bash
# Exemplo: Use raciocínio extendido para tarefas complexas
AUTOHAND_THINKING_LEVEL=extended autohand --prompt "refatore este módulo"
```

---

## Configurações do Provedor

### `provider`

Provedor LLM ativo a ser usado.

| Valor          | Descrição                    |
| -------------- | ---------------------------- |
| `"openrouter"` | API OpenRouter (padrão)      |
| `"ollama"`     | Instância local do Ollama    |
| `"llamacpp"`   | Servidor local llama.cpp     |
| `"openai"`     | API OpenAI diretamente       |
| `"mlx"`        | MLX em Apple Silicon (local) |
| `"llmgateway"` | API unificada LLM Gateway    |

### `openrouter`

Configuração do provedor OpenRouter.

```json
{
  "openrouter": {
    "apiKey": "sk-or-v1-xxx",
    "baseUrl": "https://openrouter.ai/api/v1",
    "model": "your-modelcard-id-here"
  }
}
```

| Campo     | Tipo   | Obrigatório | Padrão                         | Descrição                                               |
| --------- | ------ | ----------- | ------------------------------ | ------------------------------------------------------- |
| `apiKey`  | string | Sim         | -                              | Sua chave de API do OpenRouter                          |
| `baseUrl` | string | Não         | `https://openrouter.ai/api/v1` | Endpoint da API                                         |
| `model`   | string | Sim         | -                              | Identificador do modelo (ex.: `your-modelcard-id-here`) |

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

| Campo     | Tipo   | Obrigatório | Padrão                   | Descrição                                     |
| --------- | ------ | ----------- | ------------------------ | --------------------------------------------- |
| `baseUrl` | string | Não         | `http://localhost:11434` | URL do servidor Ollama                        |
| `port`    | number | Não         | `11434`                  | Porta do servidor (alternativa ao baseUrl)    |
| `model`   | string | Sim         | -                        | Nome do modelo (ex.: `llama3.2`, `codellama`) |

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

| Campo     | Tipo   | Obrigatório | Padrão                  | Descrição                 |
| --------- | ------ | ----------- | ----------------------- | ------------------------- |
| `baseUrl` | string | Não         | `http://localhost:8080` | URL do servidor llama.cpp |
| `port`    | number | Não         | `8080`                  | Porta do servidor         |
| `model`   | string | Sim         | -                       | Identificador do modelo   |

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

| Campo     | Tipo   | Obrigatório | Padrão                      | Descrição                                     |
| --------- | ------ | ----------- | --------------------------- | --------------------------------------------- |
| `apiKey`  | string | Sim         | -                           | Chave de API da OpenAI                        |
| `baseUrl` | string | Não         | `https://api.openai.com/v1` | Endpoint da API                               |
| `model`   | string | Sim         | -                           | Nome do modelo (ex.: `gpt-4o`, `gpt-4o-mini`) |

### `mlx`

Provedor MLX para Macs Apple Silicon (inferência local).

```json
{
  "mlx": {
    "baseUrl": "http://localhost:8080",
    "port": 8080,
    "model": "mlx-community/Llama-3.2-3B-Instruct-4bit"
  }
}
```

| Campo     | Tipo   | Obrigatório | Padrão                  | Descrição                 |
| --------- | ------ | ----------- | ----------------------- | ------------------------- |
| `baseUrl` | string | Não         | `http://localhost:8080` | URL do servidor MLX       |
| `port`    | number | Não         | `8080`                  | Porta do servidor         |
| `model`   | string | Sim         | -                       | Identificador do modelo MLX |

### `llmgateway`

Configuração da API unificada LLM Gateway. Fornece acesso a múltiplos provedores LLM através de uma única API.

```json
{
  "llmgateway": {
    "apiKey": "sua-chave-api-llmgateway",
    "baseUrl": "https://api.llmgateway.io/v1",
    "model": "gpt-4o"
  }
}
```

| Campo     | Tipo   | Obrigatório | Padrão                        | Descrição                                               |
| --------- | ------ | ----------- | ----------------------------- | ------------------------------------------------------- |
| `apiKey`  | string | Sim         | -                             | Chave de API do LLM Gateway                             |
| `baseUrl` | string | Não         | `https://api.llmgateway.io/v1` | Endpoint da API                                         |
| `model`   | string | Sim         | -                             | Nome do modelo (ex.: `gpt-4o`, `claude-3-5-sonnet-20241022`) |

**Obtendo uma Chave de API:**
Visite [llmgateway.io/dashboard](https://llmgateway.io/dashboard) para criar uma conta e obter sua chave de API.

**Modelos Suportados:**
O LLM Gateway suporta modelos de múltiplos provedores incluindo:

- OpenAI: `gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo`
- Anthropic: `claude-3-5-sonnet-20241022`, `claude-3-5-haiku-20241022`
- Google: `gemini-1.5-pro`, `gemini-1.5-flash`

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

| Campo               | Tipo    | Padrão          | Descrição                                      |
| ------------------- | ------- | --------------- | ---------------------------------------------- |
| `defaultRoot`       | string  | Diretório atual | Workspace padrão quando nenhum é especificado  |
| `allowDangerousOps` | boolean | `false`         | Permitir operações destrutivas sem confirmação |

### Segurança do Workspace

O Autohand bloqueia automaticamente operações em diretórios perigosos para prevenir danos acidentais:

- **Raízes de filesystem** (`/`, `C:\`, `D:\`, etc.)
- **Diretórios home** (`~`, `/Users/<user>`, `/home/<user>`, `C:\Users\<user>`)
- **Diretórios do sistema** (`/etc`, `/var`, `/System`, `C:\Windows`, etc.)
- **Montagens WSL do Windows** (`/mnt/c`, `/mnt/c/Users/<user>`)

Esta verificação não pode ser ignorada. Se você tentar executar o autohand em um diretório perigoso, verá um erro e deverá especificar um diretório de projeto seguro.

```bash
# Isto será bloqueado
cd ~ && autohand
# Erro: Diretório de Workspace Inseguro

# Isto funciona
cd ~/projetos/my-app && autohand
```

Veja [Segurança do Workspace](./workspace-safety.md) para detalhes completos.

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

| Campo                        | Tipo                  | Padrão   | Descrição                                                                                               |
| ---------------------------- | --------------------- | -------- | ------------------------------------------------------------------------------------------------------- |
| `theme`                      | `"dark"` \| `"light"` | `"dark"` | Tema de cores para saída do terminal                                                                    |
| `autoConfirm`                | boolean               | `false`  | Pular prompts de confirmação para operações seguras                                                     |
| `readFileCharLimit`          | number                | `300`    | Máximo de caracteres exibidos em tools de leitura/busca (o conteúdo completo ainda é enviado ao modelo) |
| `showCompletionNotification` | boolean               | `true`   | Mostrar notificação do sistema quando a tarefa terminar                                                 |
| `showThinking`               | boolean               | `true`   | Exibir o raciocínio/processo de pensamento do LLM                                                       |
| `useInkRenderer`             | boolean               | `false`  | Usar renderizador baseado em Ink para UI sem flicker (experimental)                                     |
| `terminalBell`               | boolean               | `true`   | Tocar sineta do terminal quando a tarefa terminar (mostra badge na aba/dock)                            |
| `checkForUpdates`            | boolean               | `true`   | Verificar atualizações da CLI na inicialização                                                          |
| `updateCheckInterval`        | number                | `24`     | Horas entre verificações de atualização (usa resultado em cache dentro do intervalo)                    |

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
    "enableRequestQueue": true,
    "debug": false
  }
}
```

| Campo                | Tipo    | Padrão  | Descrição                                                                          |
| -------------------- | ------- | ------- | ---------------------------------------------------------------------------------- |
| `maxIterations`      | number  | `100`   | Máximo de iterações de ferramentas por solicitação do usuário antes de parar       |
| `enableRequestQueue` | boolean | `true`  | Permitir que usuários digitem e enfileirem solicitações enquanto o agente trabalha |
| `debug`              | boolean | `false` | Habilitar output de debug detalhado (logs do estado interno do agente para stderr)   |

### Modo Debug

Habilite o modo debug para ver logging detalhado do estado interno do agente (iterações do loop react, construção de prompts, detalhes da sessão). O output vai para stderr para não interferir com o output normal.

Três formas de habilitar o modo debug (em ordem de precedência):

1. **Flag da CLI**: `autohand -d` ou `autohand --debug`
2. **Variável de ambiente**: `AUTOHAND_DEBUG=1`
3. **Arquivo de configuração**: Definir `agent.debug: true`

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

| Valor            | Descrição                                           |
| ---------------- | --------------------------------------------------- |
| `"interactive"`  | Solicitar aprovação em operações perigosas (padrão) |
| `"unrestricted"` | Sem prompts, permitir tudo                          |
| `"restricted"`   | Negar todas as operações perigosas                  |

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

| Campo     | Tipo                                | Descrição                                           |
| --------- | ----------------------------------- | --------------------------------------------------- |
| `tool`    | string                              | Nome da ferramenta para corresponder                |
| `pattern` | string                              | Padrão opcional para corresponder contra argumentos |
| `action`  | `"allow"` \| `"deny"` \| `"prompt"` | Ação a tomar                                        |

### `rememberSession`

| Tipo    | Padrão | Descrição                                   |
| ------- | ------ | ------------------------------------------- |
| boolean | `true` | Lembrar decisões de aprovação para a sessão |

### Permissões Locais do Projeto

Cada projeto pode ter suas próprias configurações de permissão que sobrescrevem a configuração global. Estas são armazenadas em `.autohand/settings.local.json` na raiz do seu projeto.

Quando você aprova uma operação de arquivo (editar, escrever, excluir), ela é automaticamente salva neste arquivo para que não seja perguntado novamente para a mesma operação neste projeto.

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

**Como funciona:**

- Quando você aprova uma operação, ela é salva em `.autohand/settings.local.json`
- Da próxima vez, a mesma operação será auto-aprovada
- Configurações locais do projeto são mescladas com configurações globais (local tem prioridade)
- Adicione `.autohand/settings.local.json` ao `.gitignore` para manter configurações pessoais privadas

**Formato do padrão:**

- `nome_ferramenta:caminho` - Para operações de arquivo (ex: `apply_patch:src/file.ts`)
- `nome_ferramenta:comando args` - Para comandos (ex: `run_command:npm test`)

### Visualizando Permissões

Você pode visualizar suas configurações de permissão atuais de duas formas:

**Flag da CLI (Não-interativo):**

```bash
autohand --permissions
```

Isso exibe:

- Modo de permissão atual (interactive, unrestricted, restricted)
- Caminhos do workspace e arquivo de configuração
- Todos os padrões aprovados (whitelist)
- Todos os padrões negados (blacklist)
- Estatísticas resumidas

**Comando Interativo:**

```
/permissions
```

Em modo interativo, o comando `/permissions` fornece as mesmas informações mais opções para:

- Remover itens da whitelist
- Remover itens da blacklist
- Limpar todas as permissões salvas

---

## Modo Patch

O modo patch permite gerar um patch compatível com git sem modificar seus arquivos de workspace. Isso é útil para:

- Revisão de código antes de aplicar mudanças
- Compartilhar mudanças geradas por IA com membros da equipe
- Criar conjuntos de mudanças reproduzíveis
- Pipelines CI/CD que precisam capturar mudanças sem aplicá-las

### Uso

```bash
# Gerar patch para stdout
autohand --prompt "adicionar autenticação de usuário" --patch

# Salvar em arquivo
autohand --prompt "adicionar autenticação de usuário" --patch --output auth.patch

# Pipe para arquivo (alternativa)
autohand --prompt "refatorar handlers de api" --patch > refactor.patch
```

### Comportamento

Quando `--patch` é especificado:

- **Auto-confirmar**: Todas as confirmações são automaticamente aceitas (`--yes` implícito)
- **Sem prompts**: Nenhum prompt de aprovação é mostrado (`--unrestricted` implícito)
- **Apenas visualização**: Mudanças são capturadas mas NÃO são escritas em disco
- **Segurança aplicada**: Operações na blacklist (`.env`, chaves SSH, comandos perigosos) ainda são bloqueadas

### Aplicando Patches

Destinatários podem aplicar o patch usando comandos git padrão:

```bash
# Verificar o que seria aplicado (dry-run)
git apply --check changes.patch

# Aplicar o patch
git apply changes.patch

# Aplicar com merge 3-way (lida melhor com conflitos)
git apply -3 changes.patch

# Aplicar e stagear mudanças
git apply --index changes.patch

# Reverter um patch
git apply -R changes.patch
```

### Formato do Patch

O patch gerado segue o formato de diff unificado do git:

```diff
diff --git a/src/auth.ts b/src/auth.ts
new file mode 100644
--- /dev/null
+++ b/src/auth.ts
@@ -0,0 +1,15 @@
+export function authenticate(user: string, password: string) {
+  // Implementação aqui
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

### Códigos de Saída

| Código | Significado                                         |
| ------ | --------------------------------------------------- |
| `0`    | Sucesso, patch gerado                               |
| `1`    | Erro (falta `--prompt`, permissão negada, etc.)     |

### Combinando com Outras Flags

```bash
# Usar modelo específico
autohand --prompt "otimizar queries" --patch --model gpt-4o

# Especificar workspace
autohand --prompt "adicionar testes" --patch --path ./meu-projeto

# Usar configuração personalizada
autohand --prompt "refatorar" --patch --config ~/.autohand/work.json
```

### Exemplo de Fluxo de Trabalho em Equipe

```bash
# Desenvolvedor A: Gerar patch para uma feature
autohand --prompt "implementar dashboard de usuário com gráficos" --patch --output dashboard.patch

# Compartilhar via git (criar PR com apenas o arquivo patch)
git checkout -b patch/dashboard
git add dashboard.patch
git commit -m "Add dashboard feature patch"
git push

# Desenvolvedor B: Revisar e aplicar
git fetch origin patch/dashboard
git apply dashboard.patch
# Executar testes, revisar código, então commitar
git add -A && git commit -m "feat: add user dashboard with charts"
```

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

| Campo        | Tipo   | Padrão  | Máx | Descrição                                          |
| ------------ | ------ | ------- | --- | -------------------------------------------------- |
| `maxRetries` | number | `3`     | `5` | Tentativas de retry para requisições de API falhas |
| `timeout`    | number | `30000` | -   | Timeout da requisição em milissegundos             |
| `retryDelay` | number | `1000`  | -   | Atraso entre retries em milissegundos              |

---

## Configurações de Telemetria

A telemetria está **desabilitada por padrão** (opt-in). Habilite para ajudar a melhorar o Autohand.

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

| Campo               | Tipo    | Padrão                    | Descrição                                                |
| ------------------- | ------- | ------------------------- | -------------------------------------------------------- |
| `enabled`           | boolean | `false`                   | Habilitar/desabilitar telemetria (opt-in)                |
| `apiBaseUrl`        | string  | `https://api.autohand.ai` | Endpoint da API de telemetria                            |
| `batchSize`         | number  | `20`                      | Número de eventos para agrupar antes do auto-flush     |
| `flushIntervalMs`   | number  | `60000`                   | Intervalo de flush em milissegundos (1 minuto)           |
| `maxQueueSize`      | number  | `500`                     | Tamanho máximo da fila antes de descartar eventos antigos|
| `maxRetries`        | number  | `3`                       | Tentativas de retry para requisições de telemetria falhas|
| `enableSessionSync` | boolean | `false`                   | Sincronizar sessões para a nuvem para recursos de equipe |
| `companySecret`     | string  | `""`                      | Segredo da empresa para autenticação da API              |

---

## Agentes Externos

Carregar definições de agentes personalizados de diretórios externos.

```json
{
  "externalAgents": {
    "enabled": true,
    "paths": ["~/.autohand/agents", "/equipe/compartilhado/agents"]
  }
}
```

| Campo     | Tipo     | Padrão  | Descrição                                  |
| --------- | -------- | ------- | ------------------------------------------ |
| `enabled` | boolean  | `false` | Habilitar carregamento de agentes externos |
| `paths`   | string[] | `[]`    | Diretórios para carregar agentes           |

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

| Campo           | Tipo   | Padrão                    | Descrição                                              |
| --------------- | ------ | ------------------------- | ------------------------------------------------------ |
| `baseUrl`       | string | `https://api.autohand.ai` | Endpoint da API                                        |
| `companySecret` | string | -                         | Segredo da equipe/empresa para recursos compartilhados |

Também pode ser definido via variáveis de ambiente:

- `AUTOHAND_API_URL` → `api.baseUrl`
- `AUTOHAND_SECRET` → `api.companySecret`

---

## Configurações de Autenticação

Configuração de autenticação para recursos protegidos.

```json
{
  "auth": {
    "token": "seu-token-de-autenticação",
    "refreshToken": "seu-refresh-token",
    "expiresAt": "2024-12-31T23:59:59Z"
  }
}
```

| Campo          | Tipo   | Obrigatório | Descrição                              |
| -------------- | ------ | ----------- | -------------------------------------- |
| `token`        | string | Sim         | Token de acesso atual                  |
| `refreshToken` | string | Não         | Token para renovar o token de acesso   |
| `expiresAt`    | string | Não         | Data/hora de expiração do token (ISO)  |

---

## Configurações de Skills Comunitárias

Configurações para o registro de skills comunitárias.

```json
{
  "communitySkills": {
    "registryUrl": "https://skills.autohand.ai",
    "cacheDuration": 3600,
    "autoUpdate": false
  }
}
```

| Campo           | Tipo    | Padrão                        | Descrição                                           |
| --------------- | ------- | ----------------------------- | --------------------------------------------------- |
| `registryUrl`   | string  | `https://skills.autohand.ai`  | URL base do registro de skills                      |
| `cacheDuration` | number  | `3600`                        | Duração do cache em segundos                        |
| `autoUpdate`    | boolean | `false`                       | Atualizar skills automaticamente quando desatualizados |

---

## Configurações de Compartilhamento

Controle como sessões e workspaces são compartilhados.

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

| Campo               | Tipo    | Padrão      | Descrição                                           |
| ------------------- | ------- | ----------- | --------------------------------------------------- |
| `enabled`           | boolean | `true`      | Habilitar recursos de compartilhamento              |
| `defaultVisibility` | string  | `"private"` | Visibilidade padrão: `private`, `team`, `public`  |
| `allowPublicLinks`  | boolean | `false`     | Permitir criação de links públicos                  |
| `requireApproval`   | boolean | `true`      | Requerer aprovação antes de compartilhar            |

---

## Sincronização de Configurações

Sincronize suas configurações entre dispositivos.

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

| Campo                | Tipo    | Padrão  | Descrição                                              |
| -------------------- | ------- | ------- | ------------------------------------------------------ |
| `enabled`            | boolean | `false` | Habilitar sincronização de configurações             |
| `autoSync`           | boolean | `true`  | Sincronizar automaticamente quando houver mudanças     |
| `syncInterval`       | number  | `300`   | Intervalo de sincronização em segundos                 |
| `conflictResolution` | string  | `"ask"` | Como resolver conflitos: `ask`, `local`, `remote`      |

### Segurança

Os nomes de arquivos remotos são aceitos apenas como caminhos POSIX relativos dentro das categorias de sincronização habilitadas. A sincronização rejeita travessia de diretórios, caminhos absolutos ou no estilo Windows, segmentos duplicados ou vazios e destinos redirecionados para fora de uma raiz habilitada por links simbólicos.

O token de login do aplicativo é enviado no cabeçalho `Authorization` apenas para URLs de transferência com a mesma origem da API de sincronização configurada. URLs HTTPS pré-assinadas de outra origem nunca recebem esse token; URLs entre origens inseguras ou malformadas são rejeitadas.

---

## Configurações de Hooks

Configure hooks personalizados para eventos do Autohand.

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

| Campo         | Tipo   | Descrição                                           |
| ------------- | ------ | --------------------------------------------------- |
| `preCommand`  | string | Script executado antes de cada comando              |
| `postCommand` | string | Script executado após cada comando                  |
| `onError`     | string | Script executado quando ocorre um erro              |
| `onComplete`  | string | Script executado quando uma tarefa é concluída      |

Variáveis de ambiente disponíveis nos hooks:

- `AUTOHAND_HOOK_TYPE` - Tipo do hook (`preCommand`, `postCommand`, etc.)
- `AUTOHAND_COMMAND` - Comando sendo executado
- `AUTOHAND_EXIT_CODE` - Código de saída (apenas `postCommand` e `onError`)
- `AUTOHAND_SESSION_ID` - ID da sessão atual

---

## Configurações MCP

Configuração do Model Context Protocol (MCP) para integração com servidores de ferramentas.

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

| Campo     | Tipo   | Descrição                                           |
| --------- | ------ | --------------------------------------------------- |
| `command` | string | Comando para iniciar o servidor MCP                 |
| `args`    | array  | Argumentos para o comando                           |
| `env`     | object | Variáveis de ambiente adicionais                    |

Os servidores MCP fornecem ferramentas adicionais que podem ser chamadas pelo agente. Cada servidor é identificado por um nome único e iniciado automaticamente quando necessário.

---

## Configurações da Extensão Chrome

Configurações para a extensão do Chrome do Autohand.

```json
{
  "chrome": {
    "extensionId": "seu-extension-id",
    "nativeMessaging": true,
    "autoLaunch": false,
    "preferredBrowser": "chrome"
  }
}
```

| Campo              | Tipo    | Padrão     | Descrição                                           |
| ------------------ | ------- | ---------- | --------------------------------------------------- |
| `extensionId`      | string  | -          | ID da extensão Chrome instalada                     |
| `nativeMessaging`  | boolean | `true`     | Habilitar comunicação via native messaging          |
| `autoLaunch`       | boolean | `false`    | Abrir Chrome automaticamente ao iniciar             |
| `preferredBrowser` | string  | `"chrome"` | Navegador preferido: `chrome`, `chromium`, `edge`, `brave` |

A extensão Chrome permite interação com páginas web e automação de browser. O native messaging permite comunicação bidirecional entre a CLI e a extensão.

---

## Sistema de Skills

Skills são pacotes de instruções que fornecem instruções especializadas ao agente de IA. Eles funcionam como arquivos `AGENTS.md` sob demanda que podem ser ativados para tarefas específicas.

### Locais de Descoberta de Skills

Skills são descobertos de múltiplos locais, com fontes posteriores tendo precedência:

| Local                                    | ID da Fonte        | Descrição                                    |
| ---------------------------------------- | ------------------ | -------------------------------------------- |
| `~/.codex/skills/**/SKILL.md`            | `codex-user`       | Skills de usuário Codex (recursivo)          |
| `~/.claude/skills/*/SKILL.md`            | `claude-user`      | Skills de usuário Claude (um nível)          |
| `~/.autohand/skills/**/SKILL.md`         | `autohand-user`    | Skills de usuário Autohand (recursivo)       |
| `<projeto>/.claude/skills/*/SKILL.md`   | `claude-project`   | Skills de projeto Claude (um nível)          |
| `<projeto>/.autohand/skills/**/SKILL.md`| `autohand-project` | Skills de projeto Autohand (recursivo)       |

### Comportamento de Auto-Cópia

Skills descobertos de locais Codex ou Claude são automaticamente copiados para o local Autohand correspondente:

- `~/.codex/skills/` e `~/.claude/skills/` → `~/.autohand/skills/`
- `<projeto>/.claude/skills/` → `<projeto>/.autohand/skills/`

Skills existentes em locais Autohand nunca são sobrescritos.

### Formato SKILL.md

Skills usam frontmatter YAML seguido de conteúdo markdown:

```markdown
---
name: my-skill-name
description: Breve descrição do skill
license: MIT
compatibility: Funciona com Node.js 18+
allowed-tools: read_file write_file run_command
metadata:
  author: your-name
  version: "1.0.0"
---

# My Skill

Instruções detalhadas para o agente de IA...
```

| Campo           | Obrigatório | Tamanho Máx | Descrição                                           |
| --------------- | ----------- | ----------- | --------------------------------------------------- |
| `name`          | Sim         | 64 chars    | Alfanumérico minúsculo com hífens apenas            |
| `description`   | Sim         | 1024 chars  | Breve descrição do skill                            |
| `license`       | Não         | -           | Identificador de licença (ex: MIT, Apache-2.0)      |
| `compatibility` | Não         | 500 chars   | Notas de compatibilidade                            |
| `allowed-tools` | Não         | -           | Lista separada por espaços de ferramentas permitidas|
| `metadata`      | Não         | -           | Metadados adicionais chave-valor                    |

### Prefixos de Entrada

O Autohand suporta prefixos especiais na entrada do prompt:

| Prefixo | Descrição                    | Exemplo                            |
| ------- | ------------------------------ | ---------------------------------- |
| `/`     | Comandos slash                 | `/help`, `/model`, `/quit`, `/exit` |
| `@`     | Menções de arquivo (autocomplete)| `@src/index.ts`                    |
| `$`     | Menções de skill (autocomplete)| `$frontend-design`, `$code-review` |
| `!`     | Executar comandos terminal diretamente | `! git status`, `! ls -la`   |

**Menções de Skills (`$`):**

- Digite `$` seguido de caracteres para ver skills disponíveis com autocomplete
- Tab aceita a sugestão principal (ex: `$frontend-design`)
- Skills são descobertos de `~/.autohand/skills/` e `<projeto>/.autohand/skills/`
- Skills ativados são anexados ao prompt como instruções especiais para a sessão atual
- Painel de preview mostra metadados do skill (nome, descrição, estado de ativação)

**Comandos Shell (`!`):**

- Comandos executam no seu diretório de trabalho atual
- Output exibido diretamente no terminal
- Não vai para o LLM
- Timeout de 30 segundos
- Retorna ao prompt após execução

### Comandos Slash

#### `/skills` — Gerenciador de Pacotes

| Comando                         | Descrição                                    |
| ------------------------------- | -------------------------------------------- |
| `/skills`                       | Listar todos os skills disponíveis           |
| `/skills use <nome>`            | Ativar um skill para a sessão atual          |
| `/skills deactivate <nome>`     | Desativar um skill                           |
| `/skills info <nome>`           | Mostrar informações detalhadas do skill      |
| `/skills install`               | Explorar e instalar do registro comunitário  |
| `/skills install @<slug>`       | Instalar um skill comunitário por slug       |
| `/skills search <consulta>`     | Pesquisar no registro de skills comunitários |
| `/skills trending`              | Mostrar skills comunitários em tendência     |
| `/skills remove <slug>`         | Desinstalar um skill comunitário             |
| `/skills new`                   | Criar um novo skill interativamente          |
| `/skills feedback <slug> <1-5>` | Avaliar um skill comunitário                 |

#### `/learn` — Consultor de Skills com LLM

| Comando         | Descrição                                                                          |
| --------------- | ---------------------------------------------------------------------------------- |
| `/learn`        | Analisar projeto e recomendar skills (escaneamento rápido)                         |
| `/learn deep`   | Escaneamento profundo do projeto (lê arquivos fonte) para resultados mais precisos |
| `/learn update` | Re-analisar projeto e regenerar skills LLM gerados desatualizados                  |

`/learn` utiliza um fluxo LLM em duas fases:

1. **Fase 1 — Análise + Ranking + Auditoria**: Escaneia a estrutura do projeto, audita skills instalados buscando redundâncias/conflitos, e classifica skills comunitários por relevância (0-100).
2. **Fase 2 — Geração** (condicional): Se nenhum skill comunitário pontuar acima de 60, oferece gerar um skill personalizado adaptado ao seu projeto.

Os skills gerados incluem metadados (`agentskill-source: llm-generated`, `agentskill-project-hash`) para que `/learn update` possa detectar mudanças no código e regenerar skills desatualizados.

### Geração Automática de Skills (`--auto-skill`)

O flag `--auto-skill` gera skills sem o fluxo interativo do consultor:

```bash
autohand --auto-skill
```

Isso irá:

1. Analisar a estrutura do projeto (package.json, requirements.txt, etc.)
2. Detectar linguagens, frameworks e padrões
3. Gerar 3 skills relevantes usando LLM
4. Salvar skills em `<projeto>/.autohand/skills/`

Para uma experiência interativa mais precisa, use `/learn` dentro de uma sessão.

---

## Exemplo Completo

### Formato JSON (`~/.autohand/config.json`)

```json
{
  "provider": "openrouter",
  "openrouter": {
    "apiKey": "sk-or-v1-sua-chave-aqui",
    "baseUrl": "https://openrouter.ai/api/v1",
    "model": "your-modelcard-id-here"
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
    "enableRequestQueue": true,
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
    "enableSessionSync": false,
    "companySecret": ""
  },
  "auth": {
    "token": "seu-token-de-autenticação",
    "refreshToken": "seu-refresh-token"
  },
  "communitySkills": {
    "registryUrl": "https://skills.autohand.ai",
    "cacheDuration": 3600,
    "autoUpdate": false
  },
  "share": {
    "enabled": true,
    "defaultVisibility": "private",
    "allowPublicLinks": false,
    "requireApproval": true
  },
  "sync": {
    "enabled": false,
    "autoSync": true,
    "syncInterval": 300,
    "conflictResolution": "ask"
  },
  "hooks": {
    "preCommand": "~/.autohand/hooks/pre-command.sh",
    "postCommand": "~/.autohand/hooks/post-command.sh",
    "onError": "~/.autohand/hooks/on-error.sh",
    "onComplete": "~/.autohand/hooks/on-complete.sh"
  },
  "mcp": {
    "servers": {}
  },
  "chrome": {
    "extensionId": "",
    "nativeMessaging": true,
    "autoLaunch": false,
    "preferredBrowser": "chrome"
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
  model: your-modelcard-id-here

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
  enableSessionSync: false
  companySecret: ""

auth:
  token: seu-token-de-autenticação
  refreshToken: seu-refresh-token

communitySkills:
  registryUrl: https://skills.autohand.ai
  cacheDuration: 3600
  autoUpdate: false

share:
  enabled: true
  defaultVisibility: private
  allowPublicLinks: false
  requireApproval: true

sync:
  enabled: false
  autoSync: true
  syncInterval: 300
  conflictResolution: ask

hooks:
  preCommand: ~/.autohand/hooks/pre-command.sh
  postCommand: ~/.autohand/hooks/post-command.sh
  onError: ~/.autohand/hooks/on-error.sh
  onComplete: ~/.autohand/hooks/on-complete.sh

mcp:
  servers: {}

chrome:
  extensionId: ""
  nativeMessaging: true
  autoLaunch: false
  preferredBrowser: chrome

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

| Flag                          | Descrição                                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `--model <modelo>`            | Sobrescrever modelo                                                                                          |
| `--path <caminho>`            | Sobrescrever raiz do workspace                                                                               |
| `--worktree [nome]`           | Executar sessão em git worktree isolado (nome opcional do worktree/branch)                                   |
| `--tmux`                      | Iniciar em uma sessão tmux dedicada (implica `--worktree`; não pode ser usado com `--no-worktree`)           |
| `--add-dir <caminho>`         | Adicionar diretórios adicionais ao escopo do workspace (pode ser usado múltiplas vezes)                      |
| `--config <caminho>`          | Usar arquivo de configuração personalizado                                                                   |
| `--temperature <n>`           | Definir temperatura (0-1)                                                                                    |
| `--yes`                       | Auto-confirmar prompts                                                                                       |
| `--dry-run`                   | Visualizar sem executar                                                                                      |
| `--unrestricted`              | Sem prompts de aprovação                                                                                     |
| `--restricted`                | Negar operações perigosas                                                                                    |
| `--auto-skill`                | Gerar skills automaticamente com base na análise do projeto (veja também `/learn` para consultor interativo) |
| `--setup`                     | Executar o assistente de configuração para configurar ou reconfigurar o Autohand                             |
| `--about`                     | Mostrar informações sobre o Autohand (versão, links, informações de contribuição)                            |
| `--sys-prompt <valor>`        | Substituir completamente o prompt do sistema (string inline ou caminho de arquivo)                           |
| `--append-sys-prompt <valor>` | Anexar ao prompt do sistema (string inline ou caminho de arquivo)                                            |

---

## Personalização do Prompt do Sistema

O Autohand permite personalizar o prompt do sistema usado pelo agente de IA. Isso é útil para fluxos de trabalho especializados, instruções personalizadas ou integração com outros sistemas.

### Flags da CLI

| Flag                          | Descrição                                    |
| ----------------------------- | -------------------------------------------- |
| `--sys-prompt <valor>`        | Substituir completamente o prompt do sistema |
| `--append-sys-prompt <valor>` | Anexar conteúdo ao prompt do sistema padrão  |

Ambas as flags aceitam:

- **String inline**: Conteúdo de texto direto
- **Caminho de arquivo**: Caminho para um arquivo contendo o prompt (auto-detectado)

### Detecção de Caminho de Arquivo

Um valor é tratado como caminho de arquivo se:

- Começa com `./`, `../`, `/`, ou `~/`
- Começa com uma letra de unidade do Windows (ex., `C:\`)
- Termina com `.txt`, `.md`, ou `.prompt`
- Contém separadores de caminho sem espaços

Caso contrário, é tratado como string inline.

### `--sys-prompt` (Substituição Completa)

Quando fornecido, **substitui completamente** o prompt do sistema padrão. O agente NÃO carregará:

- Instruções padrão do Autohand
- Instruções do projeto AGENTS.md
- Memórias de usuário/projeto
- Skills ativas

```bash
# String inline
autohand --sys-prompt "Você é um especialista em Python. Seja conciso." --prompt "Escreva hello world"

# De arquivo
autohand --sys-prompt ./prompt-personalizado.txt --prompt "Explique este código"
```

### `--append-sys-prompt` (Anexar ao Padrão)

Quando fornecido, **anexa** conteúdo ao prompt do sistema padrão completo. O agente continuará carregando todas as instruções padrão.

```bash
# String inline
autohand --append-sys-prompt "Sempre use TypeScript em vez de JavaScript" --prompt "Crie uma função"

# De arquivo
autohand --append-sys-prompt ./diretrizes-equipe.md --prompt "Adicione tratamento de erros"
```

### Precedência

Quando ambas as flags são fornecidas:

1. `--sys-prompt` tem precedência total
2. `--append-sys-prompt` é ignorado

---

## Suporte a Múltiplos Diretórios

O Autohand pode trabalhar com múltiplos diretórios além do workspace principal. Isso é útil quando seu projeto tem dependências, bibliotecas compartilhadas ou projetos relacionados em diretórios diferentes.

### Flag da CLI

Use `--add-dir` para adicionar diretórios adicionais (pode ser usado múltiplas vezes):

```bash
# Adicionar um único diretório adicional
autohand --add-dir /caminho/para/lib-compartilhada

# Adicionar múltiplos diretórios
autohand --add-dir /caminho/para/lib1 --add-dir /caminho/para/lib2

# Com modo irrestrito (auto-aprovar gravações em todos os diretórios)
autohand --add-dir /caminho/para/lib-compartilhada --unrestricted
```

### Comando Interativo

Use `/add-dir` durante uma sessão interativa:

```
/add-dir              # Mostrar diretórios atuais
/add-dir /caminho/dir # Adicionar um novo diretório
```

### Restrições de Segurança

Os seguintes diretórios não podem ser adicionados:

- Diretório home (`~` ou `$HOME`)
- Diretório raiz (`/`)
- Diretórios do sistema (`/etc`, `/var`, `/usr`, `/bin`, `/sbin`)
- Diretórios do sistema Windows (`C:\Windows`, `C:\Program Files`)
- Diretórios de usuário Windows (`C:\Users\username`)
- Montagens WSL do Windows (`/mnt/c`, `/mnt/c/Windows`)
