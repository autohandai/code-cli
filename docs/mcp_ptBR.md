# Suporte MCP (Model Context Protocol)

O Autohand inclui um cliente MCP integrado que se conecta a servidores MCP externos, estendendo seu agente com ferramentas de bancos de dados, APIs, navegadores e qualquer servico compativel com MCP.

## Sumario

- [Visao Geral](#visao-geral)
- [Inicio Rapido](#inicio-rapido)
- [Configuracao](#configuracao)
- [Comandos Slash](#comandos-slash)
- [Registro Comunitario MCP](#registro-comunitario-mcp)
- [Nomenclatura de Ferramentas](#nomenclatura-de-ferramentas)
- [Inicializacao Nao Bloqueante](#inicializacao-nao-bloqueante)
- [Solucao de Problemas](#solucao-de-problemas)

---

## Visao Geral

MCP e um protocolo aberto para conectar agentes de IA a ferramentas externas. O cliente MCP do Autohand suporta:

- **Transporte stdio** -- inicia um processo filho e se comunica via JSON-RPC 2.0 atraves de stdin/stdout
- **Transporte SSE** -- conecta-se a um servidor HTTP usando Server-Sent Events (planejado)
- **Descoberta automatica de ferramentas** -- descobre e registra ferramentas dos servidores conectados
- **Ferramentas com namespace** -- ferramentas MCP recebem um prefixo para evitar colisoes com ferramentas integradas
- **Inicializacao nao bloqueante** -- servidores conectam em segundo plano sem atrasar o prompt
- **Gerenciamento interativo** -- ative/desative servidores com o comando `/mcp`

---

## Inicio Rapido

### Instalar a partir do Registro Comunitario

A maneira mais rapida de comecar e instalando um servidor pre-configurado do registro comunitario:

```bash
# No REPL do Autohand
/mcp install filesystem
```

Isso adiciona o servidor a sua configuracao e o conecta automaticamente. Voce tambem pode explorar o registro completo:

```bash
/mcp install
```

### Configuracao Manual

Adicione um servidor MCP ao `~/.autohand/config.json`:

```json
{
  "mcp": {
    "servers": [
      {
        "name": "filesystem",
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/me/projects"]
      }
    ]
  }
}
```

Reinicie o Autohand e o servidor se conecta automaticamente em segundo plano.

---

## Configuracao

### Estrutura de Configuracao

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
      }
    ]
  }
}
```

### Campos de Configuracao do Servidor

| Campo | Tipo | Obrigatorio | Descricao |
|-------|------|-------------|-----------|
| `name` | string | Sim | Identificador unico do servidor |
| `transport` | `"stdio"` \| `"sse"` | Sim | Tipo de transporte |
| `command` | string | Sim (stdio) | Comando para iniciar o processo do servidor |
| `args` | string[] | Nao | Argumentos para o comando |
| `url` | string | Sim (sse) | URL do endpoint SSE |
| `env` | object | Nao | Variaveis de ambiente passadas ao servidor |
| `autoConnect` | boolean | Nao | Conexao automatica na inicializacao (padrao: `true`) |

### Configuracoes Globais

| Campo | Tipo | Padrao | Descricao |
|-------|------|--------|-----------|
| `mcp.enabled` | boolean | `true` | Habilitar/desabilitar todo o suporte MCP |
| `mcp.servers` | array | `[]` | Lista de configuracoes de servidores |

---

## Comandos Slash

### `/mcp` -- Gerenciador Interativo de Servidores

Executar `/mcp` sem argumentos abre uma **lista interativa de alternancia**:

```
MCP Servers
────────────────────────────────────────────────────────
▸ ● filesystem          enabled (5 tools)
  ○ github              disabled
  ● postgres            error
    Connection refused

↑↓ navigate  ⏎/space toggle  q/esc close
```

- **Teclas de seta** para navegar entre servidores
- **Espaco** ou **Enter** para alternar um servidor (conectar/desconectar)
- **q** ou **ESC** para fechar a lista
- Detalhes do erro sao exibidos quando um servidor com erro e selecionado

### Subcomandos do `/mcp`

| Comando | Descricao |
|---------|-----------|
| `/mcp` | Lista interativa de alternancia de servidores |
| `/mcp connect <name>` | Conectar a um servidor especifico |
| `/mcp disconnect <name>` | Desconectar de um servidor |
| `/mcp list` | Listar todas as ferramentas dos servidores conectados |
| `/mcp tools` | Alias para `/mcp list` |
| `/mcp add <name> <cmd> [args]` | Adicionar um servidor a configuracao e conectar |
| `/mcp remove <name>` | Remover um servidor da configuracao |

### Exemplos

```bash
# Adicionar um servidor manualmente
/mcp add time npx -y @modelcontextprotocol/server-time

# Ver todas as ferramentas disponiveis
/mcp list

# Desconectar um servidor
/mcp disconnect time

# Remover um servidor permanentemente
/mcp remove time
```

---

### `/mcp install` -- Explorador do Registro Comunitario

Explore e instale servidores MCP pre-configurados do registro comunitario:

```bash
# Explorar o registro completo com categorias
/mcp install

# Instalar um servidor especifico diretamente
/mcp install filesystem
```

O explorador interativo mostra:

- **Categorias**: Ferramentas de Desenvolvimento, Dados e Bancos de Dados, Web e APIs, Produtividade, IA e Raciocinio
- **Servidores em destaque** com avaliacoes
- **Busca** com autocompletar
- **Detalhes do servidor** antes da instalacao (descricao, variaveis de ambiente obrigatorias, argumentos obrigatorios)

#### Servidores Disponiveis

| Servidor | Categoria | Descricao |
|----------|-----------|-----------|
| filesystem | Ferramentas de Desenvolvimento | Ler, escrever e gerenciar arquivos e diretorios |
| github | Ferramentas de Desenvolvimento | Repositorios, issues e PRs do GitHub |
| everything | Ferramentas de Desenvolvimento | Servidor MCP de referencia para testes |
| time | Ferramentas de Desenvolvimento | Ferramentas de hora e fuso horario |
| postgres | Dados e Bancos de Dados | Consultas a bancos de dados PostgreSQL |
| sqlite | Dados e Bancos de Dados | Operacoes com bancos de dados SQLite |
| brave-search | Web e APIs | Busca web com Brave |
| fetch | Web e APIs | Buscar e analisar paginas web |
| puppeteer | Web e APIs | Automacao de navegador com Puppeteer |
| slack | Produtividade | Mensagens do Slack |
| memory | IA e Raciocinio | Memoria persistente com grafo de conhecimento |
| sequential-thinking | IA e Raciocinio | Raciocinio passo a passo |

#### Variaveis de Ambiente

Alguns servidores requerem variaveis de ambiente. Ao instalar, o Autohand solicita os valores obrigatorios:

```bash
/mcp install slack
# Solicita:
#   SLACK_BOT_TOKEN: xoxb-your-token
#   SLACK_TEAM_ID: T0YOUR_TEAM_ID
```

#### Argumentos Obrigatorios

Servidores como `filesystem` requerem argumentos de caminho:

```bash
/mcp install filesystem
# Solicita: caminho do diretorio permitido
```

---

## Nomenclatura de Ferramentas

As ferramentas MCP sao registradas com um prefixo de namespace para evitar colisoes:

```
mcp__<server-name>__<tool-name>
```

Por exemplo, a ferramenta `read_file` do servidor filesystem se torna `mcp__filesystem__read_file`.

Quando o LLM decide usar uma ferramenta MCP, o Autohand roteia automaticamente a chamada para o servidor correto.

---

## Inicializacao Nao Bloqueante

Os servidores MCP se conectam **de forma assincrona em segundo plano** durante a inicializacao. Isso significa:

1. O prompt aparece imediatamente -- sem esperar os servidores se conectarem
2. Os servidores se conectam em paralelo, cada um de forma independente
3. As ferramentas ficam disponiveis conforme os servidores terminam de se conectar
4. Se um servidor falhar, os outros continuam normalmente (erros sao exibidos com `/mcp`)
5. Quando o LLM invoca uma ferramenta MCP, o Autohand aguarda as conexoes serem concluidas primeiro

Esse comportamento e similar a como o Claude Code e ferramentas similares lidam com MCP -- o usuario nunca e bloqueado por uma inicializacao lenta do servidor.

---

## Solucao de Problemas

### O servidor nao conecta

```bash
# Verificar status
/mcp

# Tentar reconectar
/mcp disconnect <name>
/mcp connect <name>
```

### Erros comuns

| Erro | Causa | Solucao |
|------|-------|---------|
| `Command not found` | Pacote nao instalado | Execute o comando `npx` manualmente primeiro |
| `Connection refused` | Servidor nao esta em execucao (SSE) | Verifique a URL e o status do servidor |
| `Request timed out` | Servidor sem resposta | Verifique os logs do servidor, reinicie |
| `SSE transport not yet implemented` | SSE ainda nao suportado | Use o transporte stdio |

### Logs do servidor

A saida stderr do servidor MCP e capturada internamente. Se um servidor apresentar comportamento inesperado, verifique se o comando subjacente funciona fora do Autohand:

```bash
npx -y @modelcontextprotocol/server-filesystem /tmp
```

### Desabilitar MCP

Defina `mcp.enabled` como `false` na sua configuracao para desabilitar todo o suporte MCP:

```json
{
  "mcp": {
    "enabled": false
  }
}
```

Ou configure servidores individuais para nao se conectarem automaticamente:

```json
{
  "mcp": {
    "servers": [
      {
        "name": "filesystem",
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem"],
        "autoConnect": false
      }
    ]
  }
}
```
