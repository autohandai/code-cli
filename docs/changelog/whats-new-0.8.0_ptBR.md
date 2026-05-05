# Novidades no Autohand 0.8.0

O Autohand 0.8.0 e uma versao principal que traz o modo pipe para fluxos de trabalho composiveis no Unix, controles de pensamento estendido, auto-aprovacao granular (modo yolo), suporte a cliente MCP, integracao com IDEs, modo plano e muito mais. Este documento cobre cada nova funcionalidade e melhoria incluida nesta versao.

## Indice

- [Modo Pipe](#modo-pipe)
- [Pensamento Estendido](#pensamento-estendido)
- [Historico de Sessoes](#historico-de-sessoes)
- [Auto-Aprovacao Granular (Modo Yolo)](#auto-aprovacao-granular-modo-yolo)
- [Suporte a Cliente MCP](#suporte-a-cliente-mcp)
- [Integracao com IDEs](#integracao-com-ides)
- [Instalacao via Homebrew](#instalacao-via-homebrew)
- [Modo Plano](#modo-plano)
- [Ferramenta Web Repo](#ferramenta-web-repo)
- [Compactacao Automatica de Contexto](#compactacao-automatica-de-contexto)
- [Prompt de Sistema Personalizado](#prompt-de-sistema-personalizado)
- [Novos Flags de CLI](#novos-flags-de-cli)
- [Novos Comandos Slash](#novos-comandos-slash)
- [Melhorias de Arquitetura](#melhorias-de-arquitetura)
- [Atualizacao](#atualizacao)

---

## Modo Pipe

O Autohand agora funciona perfeitamente como parte de pipelines Unix. Quando stdin nao e uma TTY, o Autohand entra no **modo pipe** -- um caminho de execucao nao interativo projetado para fluxos de trabalho composiveis.

### Como Funciona

O modo pipe envia o conteudo canalizado junto com sua instrucao para o LLM. O resultado final e escrito em stdout, enquanto erros e progresso vao para stderr. Isso mantem o fluxo de saida limpo para consumidores posteriores.

```bash
# Explicar um diff
git diff | autohand 'explain these changes'

# Revisar codigo de um arquivo
cat src/auth.ts | autohand 'review this code for security issues'

# Encadear multiplas ferramentas
git log --oneline -10 | autohand 'summarize recent changes' > changelog.txt
```

### Roteamento de Saida

| Fluxo | Conteudo |
|-------|----------|
| **stdout** | Apenas o resultado final (consumido por pipes posteriores) |
| **stderr** | Erros e mensagens de progresso opcionais |

### Saida JSON

Use `--json` para saida ndjson estruturada, ideal para consumo programatico:

```bash
git diff | autohand 'review' --json
```

Cada linha e um objeto JSON valido:

```json
{"type": "result", "content": "O diff mostra..."}
{"type": "error", "message": "Limite de taxa excedido"}
```

### Progresso Detalhado

Use `--verbose` para enviar mensagens de progresso para stderr enquanto mantem stdout limpo:

```bash
git diff | autohand 'review' --verbose 2>progress.log
```

### Exemplos Composiveis

```bash
# Cadeia de pipes: gerar testes, depois lint
autohand --prompt 'generate tests for auth.ts' | eslint --stdin

# Usar com xargs
find src -name '*.ts' | xargs -I{} sh -c 'cat {} | autohand "review" > {}.review'

# Integracao CI
git diff HEAD~1 | autohand 'check for breaking changes' --json | jq '.content'
```

---

## Pensamento Estendido

Controle a profundidade de raciocinio do LLM antes de responder com o flag `--thinking`. Isso e util para ajustar o equilibrio entre velocidade e minuciosidade.

### Uso

```bash
# Raciocinio estendido para tarefas complexas
autohand --thinking extended

# Raciocinio padrao (default)
autohand --thinking normal

# Respostas diretas sem raciocinio visivel
autohand --thinking none

# Atalho: --thinking sem valor equivale a extended
autohand --thinking
```

### Niveis de Pensamento

| Nivel | Descricao | Ideal Para |
|-------|-----------|------------|
| `extended` | Raciocinio profundo com processo de pensamento detalhado | Refatoracoes complexas, decisoes de arquitetura, depuracao |
| `normal` | Profundidade de raciocinio padrao (default) | Tarefas gerais de programacao |
| `none` | Respostas diretas sem raciocinio visivel | Perguntas simples, edicoes rapidas |

### Variavel de Ambiente

Voce tambem pode definir o nivel de pensamento via variavel de ambiente, util para integracoes com IDEs:

```bash
AUTOHAND_THINKING_LEVEL=extended autohand --prompt "refactor this module"
```

---

## Historico de Sessoes

O novo comando slash `/history` fornece navegacao paginada do historico de sessoes, facilitando encontrar e retomar trabalhos anteriores.

### Uso

```
/history          # Mostrar primeira pagina do historico
/history 2        # Mostrar pagina 2
/history 3        # Mostrar pagina 3
```

### Formato de Exibicao

Cada entrada mostra:

| Coluna | Descricao |
|--------|-----------|
| **ID** | Identificador da sessao (truncado em 20 caracteres) |
| **Data** | Data e hora de criacao |
| **Projeto** | Nome do projeto |
| **Modelo** | Modelo LLM utilizado (abreviado) |
| **Mensagens** | Contagem total de mensagens |
| **Status** | Badge de sessao ativa (verde `[active]`) |

### Retomar Sessoes

Combine `/history` com `/resume` para um fluxo de trabalho fluido:

```
/history            # Encontre a sessao desejada
/resume abc123...   # Retome-a
```

---

## Auto-Aprovacao Granular (Modo Yolo)

O modo yolo fornece auto-aprovacao baseada em padroes para chamadas de ferramentas, dando a voce controle detalhado sobre o que o agente pode fazer sem perguntar. Combine com `--timeout` para sessoes autonomas com limite de tempo.

### Uso

```bash
# Auto-aprovar tudo
autohand --yolo true

# Auto-aprovar apenas operacoes de leitura e escrita
autohand --yolo 'allow:read_file,write_file,search'

# Auto-aprovar tudo exceto excluir e executar comandos
autohand --yolo 'deny:delete_path,run_command'

# Permitir todas as operacoes, mas apenas por 10 minutos
autohand --yolo true --timeout 600
```

### Sintaxe de Padroes

| Padrao | Efeito |
|--------|--------|
| `true` | Atalho para `allow:*` -- aprovar tudo |
| `allow:*` | Auto-aprovar todas as ferramentas |
| `allow:read_file,write_file` | Auto-aprovar apenas as ferramentas listadas |
| `deny:delete_path,run_command` | Negar as ferramentas listadas, auto-aprovar o restante |

### Como Funciona

1. O Autohand analisa o padrao `--yolo` em um `YoloPattern` (modo + lista de ferramentas).
2. Quando uma chamada de ferramenta requer aprovacao, o Autohand verifica se o nome da ferramenta corresponde ao padrao.
3. Se corresponder (em modo allow) ou nao corresponder (em modo deny), a ferramenta executa sem perguntar.
4. Se o padrao nao auto-aprovar a ferramenta, o dialogo de permissoes normal e exibido.

### Temporizador

O flag `--timeout` cria um `YoloTimer` que rastreia o tempo restante:

```bash
# Auto-aprovar por 5 minutos, depois voltar ao dialogo normal
autohand --yolo true --timeout 300
```

- Enquanto o temporizador esta ativo, ferramentas correspondentes sao auto-aprovadas.
- Quando o temporizador expira, todas as chamadas voltam ao dialogo de permissoes normal.

### Seguranca

- O modo yolo se integra com o sistema de permissoes existente.
- Operacoes na lista negra (`permissions.blacklist`) continuam bloqueadas mesmo no modo yolo.
- O padrao `deny` permite excluir operacoes perigosas explicitamente.

---

## Suporte a Cliente MCP

O Autohand agora inclui um cliente MCP (Model Context Protocol) integrado que pode se conectar a servidores MCP externos. Isso permite estender o Autohand com ferramentas personalizadas de bancos de dados, APIs ou qualquer servico compativel com MCP.

### Visao Geral

MCP e um protocolo padrao da industria para conectar agentes de IA a ferramentas externas. O cliente MCP do Autohand suporta:

- **Transporte stdio** -- inicia um processo filho e se comunica via JSON-RPC 2.0 sobre stdin/stdout
- **Transporte SSE** -- conecta a um servidor HTTP usando Server-Sent Events
- **Descoberta automatica de ferramentas** -- consulta `tools/list` e registra ferramentas dinamicamente
- **Ferramentas com namespace** -- ferramentas tem prefixo `mcp__<servidor>__<ferramenta>` para evitar colisoes
- **Gerenciamento do ciclo de vida do servidor** -- iniciar, parar e reconectar servidores

### Configuracao

Adicione servidores MCP ao seu `~/.autohand/config.json`:

```json
{
  "mcp": {
    "servers": [
      {
        "name": "database",
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-postgres"],
        "env": {
          "DATABASE_URL": "postgresql://localhost/mydb"
        },
        "autoConnect": true
      },
      {
        "name": "custom-api",
        "transport": "sse",
        "url": "http://localhost:3001/mcp",
        "autoConnect": true
      }
    ]
  }
}
```

### Campos de Configuracao do Servidor

| Campo | Tipo | Obrigatorio | Padrao | Descricao |
|-------|------|-------------|--------|-----------|
| `name` | string | Sim | - | Nome unico do servidor |
| `transport` | `"stdio"` ou `"sse"` | Sim | - | Tipo de conexao |
| `command` | string | apenas stdio | - | Comando para iniciar o servidor |
| `args` | string[] | Nao | `[]` | Argumentos do comando |
| `url` | string | apenas sse | - | URL do endpoint SSE |
| `env` | object | Nao | `{}` | Variaveis de ambiente para o processo do servidor |
| `autoConnect` | boolean | Nao | `true` | Conectar automaticamente ao iniciar |

### Nomenclatura de Ferramentas

Ferramentas MCP usam namespace para prevenir colisoes com ferramentas integradas:

```
mcp__<nome-servidor>__<nome-ferramenta>
```

Por exemplo, uma ferramenta chamada `query` de um servidor chamado `database` se torna `mcp__database__query`.

---

## Integracao com IDEs

O comando `/ide` detecta IDEs em execucao no seu sistema e habilita funcionalidades integradas. O Autohand pode detectar qual IDE esta editando seu workspace atual e sugerir extensoes relevantes.

### IDEs Suportados

| IDE | Plataformas | Extensao Disponivel |
|-----|-------------|---------------------|
| Visual Studio Code | macOS, Linux, Windows | Sim |
| Visual Studio Code Insiders | macOS, Linux, Windows | Sim |
| Cursor | macOS, Linux, Windows | Nao |
| Zed | macOS, Linux, Windows | Sim |
| Antigravity | macOS | Nao |

### Uso

```
/ide
```

O comando realiza os seguintes passos:

1. Escaneia processos em execucao buscando padroes de IDEs conhecidos
2. Le o armazenamento do IDE para determinar qual workspace cada instancia tem aberto
3. Compara os IDEs detectados com seu diretorio de trabalho atual
4. Apresenta um modal de selecao para os IDEs que correspondem
5. Sugere instalacoes de extensoes para integracao mais profunda

---

## Instalacao via Homebrew

O Autohand agora esta disponivel via Homebrew no macOS:

```bash
# Instalar diretamente
brew install autohand

# Ou via o tap oficial
brew tap autohandai/tap && brew install autohand
```

### Detalhes

- Node.js e declarado como dependencia e instalado automaticamente se necessario
- A formula instala a partir do registro npm
- A versao e verificada apos a instalacao via `autohand --version`
- Atualizacoes estao disponiveis via `brew upgrade autohand`

---

## Modo Plano

O modo plano permite que o agente planeje antes de agir. Quando habilitado, o agente usa apenas ferramentas somente leitura para coletar informacoes e formular um plano. Uma vez que voce aprova o plano, a execucao comeca.

### Ativacao

Pressione **Shift+Tab** para alternar o modo plano. Um indicador de status mostra o estado atual:

| Indicador | Significado |
|-----------|-------------|
| `[PLAN]` | Fase de planejamento -- o agente coleta informacoes e formula um plano |
| `[EXEC]` | Fase de execucao -- o agente executa o plano aprovado |
| *(nenhum)* | Modo plano desativado -- operacao normal |

### Como Funciona

1. **Ativar** -- pressione Shift+Tab. O prompt mostra `[PLAN]`.
2. **Fase de planejamento** -- o agente so pode usar ferramentas somente leitura (leitura de arquivos, busca, git status, busca web, etc.). Operacoes de escrita sao bloqueadas.
3. **Apresentacao do plano** -- o agente apresenta um plano estruturado com etapas.
4. **Opcoes de aceitacao** -- escolha como prosseguir:
   - **Limpar contexto e auto-aceitar edicoes** -- melhor aderencia ao plano, limpa o historico de conversacao
   - **Aprovacao manual** -- revise e aprove cada edicao individualmente
   - **Auto-aceitar** -- auto-aceitar todas as edicoes sem revisao
5. **Execucao** -- o indicador muda para `[EXEC]` e o agente executa o plano.

---

## Ferramenta Web Repo

A nova ferramenta `web_repo` obtem informacoes de repositorios do GitHub e GitLab usando o formato `@owner/repo`. Isso da ao agente contexto sobre repositorios externos sem sair do terminal.

### Uso

Mencione um repositorio no seu prompt usando a sintaxe `@owner/repo`:

```
Me conte sobre @vercel/next.js
```

O agente tambem pode chamar a ferramenta `web_repo` diretamente para obter metadados do repositorio, conteudo do README e informacoes de estrutura.

---

## Compactacao Automatica de Contexto

O Autohand agora compacta automaticamente o contexto da conversacao quando as sessoes ficam longas. Isso previne o esgotamento da janela de contexto e mantem o agente responsivo durante sessoes extensas.

### Como Funciona

- Habilitado por padrao (flag `--cc`)
- Monitora o comprimento da conversacao relativo a janela de contexto do modelo
- Quando a conversacao se aproxima do limite, mensagens antigas sao resumidas e compactadas
- Funciona tanto no modo interativo quanto no modo plano
- Informacoes criticas (conteudo de arquivos, resultados recentes de ferramentas) sao preservadas

### Configuracao

```bash
# Habilitar compactacao de contexto (padrao)
autohand --cc

# Desabilitar compactacao de contexto
autohand --no-cc
```

---

## Prompt de Sistema Personalizado

Substitua ou estenda o prompt de sistema padrao para fluxos de trabalho especializados.

### Substituir Prompt Completo

```bash
# String inline
autohand --sys-prompt "You are a Python expert. Be concise."

# A partir de arquivo
autohand --sys-prompt ./custom-prompt.md
```

Ao usar `--sys-prompt`, as instrucoes padrao do Autohand, AGENTS.md, memorias e skills sao todas substituidas.

### Adicionar ao Prompt Padrao

```bash
# String inline
autohand --append-sys-prompt "Always use TypeScript instead of JavaScript"

# A partir de arquivo
autohand --append-sys-prompt ./team-guidelines.md
```

Ao usar `--append-sys-prompt`, o conteudo e adicionado ao final do prompt completo padrao. Todos os comportamentos padrao sao preservados.

---

## Novos Flags de CLI

| Flag | Descricao |
|------|-----------|
| `--thinking [level]` | Define a profundidade de raciocinio: `none`, `normal`, `extended` |
| `--yolo [pattern]` | Auto-aprovar chamadas de ferramentas que correspondam a um padrao |
| `--timeout <seconds>` | Limite de tempo para auto-aprovacao no modo yolo |
| `--cc` / `--no-cc` | Habilitar/desabilitar compactacao automatica de contexto |
| `--search-engine <provider>` | Definir provedor de busca web (`brave`, `duckduckgo`, `parallel`) |
| `--sys-prompt <value>` | Substituir o prompt de sistema completo (inline ou caminho de arquivo) |
| `--append-sys-prompt <value>` | Adicionar ao prompt de sistema padrao |
| `--display-language <locale>` | Definir idioma de exibicao (ex., `en`, `zh-cn`, `fr`, `de`, `ja`) |
| `--add-dir <path>` | Adicionar diretorios adicionais ao escopo do workspace |
| `--skill-install [name]` | Instalar um skill comunitario |
| `--project` | Instalar skill no nivel do projeto (com `--skill-install`) |

---

## Novos Comandos Slash

| Comando | Descricao |
|---------|-----------|
| `/history` | Navegar pelo historico de sessoes com paginacao |
| `/history <pagina>` | Ver uma pagina especifica do historico |
| `/ide` | Detectar IDEs em execucao e conectar para integracao |
| `/about` | Mostrar informacoes sobre o Autohand (versao, links) |
| `/feedback` | Enviar feedback sobre o CLI |
| `/plan` | Interagir com o modo plano |
| `/add-dir` | Adicionar diretorios adicionais ao escopo do workspace |
| `/language` | Alterar idioma de exibicao |
| `/formatters` | Listar formatadores de codigo disponiveis |
| `/lint` | Listar linters de codigo disponiveis |
| `/completion` | Gerar scripts de completacao de shell (bash, zsh, fish) |
| `/export` | Exportar sessao para markdown, JSON ou HTML |
| `/permissions` | Ver e gerenciar configuracoes de permissoes |
| `/hooks` | Gerenciar hooks de ciclo de vida interativamente |
| `/share` | Compartilhar uma sessao via autohand.link |
| `/skills` | Listar, ativar, desativar ou criar skills |

---

## Melhorias de Arquitetura

### Componente Modal

A dependencia `enquirer` foi substituida por um componente `Modal` personalizado construido com Ink. Isso fornece estilos consistentes, navegacao por teclado e melhor integracao com o restante da TUI.

### Modulos Extraidos

Varios modulos internos foram extraidos para melhor separacao de responsabilidades:

- **WorkspaceFileCollector** -- gerencia a descoberta de arquivos do workspace com cache de 30 segundos
- **AgentFormatter** -- formata a saida do agente para exibicao no terminal
- **ProviderConfigManager** -- gerencia a logica de configuracao especifica de provedores

### Renderizacao UI com Ink

O renderizador experimental baseado em Ink (`ui.useInkRenderer`) foi otimizado para:

- Saida sem tremulacao via reconciliacao do React
- Fila de solicitacoes em funcionamento (digite enquanto o agente trabalha)
- Melhor tratamento de entrada sem conflitos de readline

### Ajuda Dinamica

O comando `/help` agora gera sua saida dinamicamente a partir dos comandos slash registrados, refletindo sempre o conjunto atual de comandos disponiveis.

---

## Atualizacao

### Via npm

```bash
npm update -g autohand-cli
```

### Via Homebrew

```bash
brew upgrade autohand
```

### Compatibilidade de Configuracao

Seu `~/.autohand/config.json` existente e totalmente compativel. Nenhuma migracao e necessaria.

As novas secoes de configuracao (como `mcp.servers`) sao opcionais e necessarias apenas se voce quiser usar as funcionalidades correspondentes. O Autohand usa padroes sensiveis para todas as novas configuracoes.

---

## Documentacao Relacionada

- [Referencia de Configuracao](./config-reference_ptBR.md) -- todas as opcoes de configuracao
- [Sistema de Hooks](./hooks.md) -- hooks de ciclo de vida
- [Guia de Provedores](./providers.md) -- configuracao de provedores LLM
- [Modo Automatico](./automode.md) -- ciclos de desenvolvimento autonomo
- [Protocolo RPC](./rpc-protocol.md) -- controle programatico
