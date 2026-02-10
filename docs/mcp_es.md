# Soporte MCP (Model Context Protocol)

Autohand incluye un cliente MCP integrado que se conecta a servidores MCP externos, ampliando tu agente con herramientas de bases de datos, APIs, navegadores y cualquier servicio compatible con MCP.

## Tabla de Contenidos

- [Descripcion General](#descripcion-general)
- [Inicio Rapido](#inicio-rapido)
- [Configuracion](#configuracion)
- [Comandos Slash](#comandos-slash)
- [Registro Comunitario de MCP](#registro-comunitario-de-mcp)
- [Nomenclatura de Herramientas](#nomenclatura-de-herramientas)
- [Inicio No Bloqueante](#inicio-no-bloqueante)
- [Solucion de Problemas](#solucion-de-problemas)

---

## Descripcion General

MCP es un protocolo abierto para conectar agentes de IA con herramientas externas. El cliente MCP de Autohand soporta:

- **Transporte stdio** -- genera un proceso hijo y se comunica via JSON-RPC 2.0 a traves de stdin/stdout
- **Transporte SSE** -- se conecta a un servidor HTTP usando Server-Sent Events (planeado)
- **Descubrimiento automatico de herramientas** -- descubre y registra herramientas de los servidores conectados
- **Herramientas con espacio de nombres** -- las herramientas MCP llevan un prefijo para evitar colisiones con las herramientas integradas
- **Inicio no bloqueante** -- los servidores se conectan en segundo plano sin retrasar el prompt
- **Gestion interactiva** -- activa/desactiva servidores con el comando `/mcp`

---

## Inicio Rapido

### Instalar desde el Registro Comunitario

La forma mas rapida de comenzar es instalando un servidor preconfigurado del registro comunitario:

```bash
# En el REPL de Autohand
/mcp install filesystem
```

Esto agrega el servidor a tu configuracion y lo conecta automaticamente. Tambien puedes explorar el registro completo:

```bash
/mcp install
```

### Configuracion Manual

Agrega un servidor MCP a `~/.autohand/config.json`:

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

Reinicia Autohand y el servidor se conecta automaticamente en segundo plano.

---

## Configuracion

### Estructura de Configuracion

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

### Campos de Configuracion del Servidor

| Campo | Tipo | Requerido | Descripcion |
|-------|------|-----------|-------------|
| `name` | string | Si | Identificador unico del servidor |
| `transport` | `"stdio"` \| `"sse"` | Si | Tipo de transporte |
| `command` | string | Si (stdio) | Comando para iniciar el proceso del servidor |
| `args` | string[] | No | Argumentos para el comando |
| `url` | string | Si (sse) | URL del endpoint SSE |
| `env` | object | No | Variables de entorno pasadas al servidor |
| `autoConnect` | boolean | No | Conexion automatica al iniciar (por defecto: `true`) |

### Configuracion Global

| Campo | Tipo | Por Defecto | Descripcion |
|-------|------|-------------|-------------|
| `mcp.enabled` | boolean | `true` | Habilitar/deshabilitar todo el soporte MCP |
| `mcp.servers` | array | `[]` | Lista de configuraciones de servidores |

---

## Comandos Slash

### `/mcp` -- Gestor Interactivo de Servidores

Ejecutar `/mcp` sin argumentos abre una **lista interactiva de alternancia**:

```
MCP Servers
────────────────────────────────────────────────────────
▸ ● filesystem          enabled (5 tools)
  ○ github              disabled
  ● postgres            error
    Connection refused

↑↓ navigate  ⏎/space toggle  q/esc close
```

- **Teclas de flecha** para navegar entre servidores
- **Espacio** o **Enter** para activar/desactivar un servidor (conectar/desconectar)
- **q** o **ESC** para cerrar la lista
- Los detalles de error se muestran cuando se selecciona un servidor con errores

### Subcomandos de `/mcp`

| Comando | Descripcion |
|---------|-------------|
| `/mcp` | Lista interactiva de alternancia de servidores |
| `/mcp connect <name>` | Conectar a un servidor especifico |
| `/mcp disconnect <name>` | Desconectar de un servidor |
| `/mcp list` | Listar todas las herramientas de los servidores conectados |
| `/mcp tools` | Alias de `/mcp list` |
| `/mcp add <name> <cmd> [args]` | Agregar un servidor a la configuracion y conectar |
| `/mcp remove <name>` | Eliminar un servidor de la configuracion |

### Ejemplos

```bash
# Agregar un servidor manualmente
/mcp add time npx -y @modelcontextprotocol/server-time

# Ver todas las herramientas disponibles
/mcp list

# Desconectar un servidor
/mcp disconnect time

# Eliminar un servidor permanentemente
/mcp remove time
```

---

### `/mcp install` -- Explorador del Registro Comunitario

Explora e instala servidores MCP preconfigurados del registro comunitario:

```bash
# Explorar el registro completo con categorias
/mcp install

# Instalar un servidor especifico directamente
/mcp install filesystem
```

El explorador interactivo muestra:

- **Categorias**: Herramientas de Desarrollo, Datos y Bases de Datos, Web y APIs, Productividad, IA y Razonamiento
- **Servidores destacados** con calificaciones
- **Busqueda** con autocompletado
- **Detalles del servidor** antes de instalar (descripcion, variables de entorno requeridas, argumentos requeridos)

#### Servidores Disponibles

| Servidor | Categoria | Descripcion |
|----------|-----------|-------------|
| filesystem | Herramientas de Desarrollo | Leer, escribir y gestionar archivos y directorios |
| github | Herramientas de Desarrollo | Repositorios, issues y PRs de GitHub |
| everything | Herramientas de Desarrollo | Servidor MCP de referencia para pruebas |
| time | Herramientas de Desarrollo | Herramientas de hora y zona horaria |
| postgres | Datos y Bases de Datos | Consultas a bases de datos PostgreSQL |
| sqlite | Datos y Bases de Datos | Operaciones con bases de datos SQLite |
| brave-search | Web y APIs | Busqueda web con Brave |
| fetch | Web y APIs | Obtener y analizar paginas web |
| puppeteer | Web y APIs | Automatizacion de navegador con Puppeteer |
| slack | Productividad | Mensajeria de Slack |
| memory | IA y Razonamiento | Memoria persistente con grafo de conocimiento |
| sequential-thinking | IA y Razonamiento | Razonamiento paso a paso |

#### Variables de Entorno

Algunos servidores requieren variables de entorno. Al instalar, Autohand solicita los valores requeridos:

```bash
/mcp install slack
# Solicita:
#   SLACK_BOT_TOKEN: xoxb-your-token
#   SLACK_TEAM_ID: T0YOUR_TEAM_ID
```

#### Argumentos Requeridos

Servidores como `filesystem` requieren argumentos de ruta:

```bash
/mcp install filesystem
# Solicita: ruta del directorio permitido
```

---

## Nomenclatura de Herramientas

Las herramientas MCP se registran con un prefijo de espacio de nombres para evitar colisiones:

```
mcp__<server-name>__<tool-name>
```

Por ejemplo, la herramienta `read_file` del servidor filesystem se convierte en `mcp__filesystem__read_file`.

Cuando el LLM decide usar una herramienta MCP, Autohand enruta automaticamente la llamada al servidor correcto.

---

## Inicio No Bloqueante

Los servidores MCP se conectan **de forma asincrona en segundo plano** durante el inicio. Esto significa:

1. El prompt aparece inmediatamente -- sin esperar a que los servidores se conecten
2. Los servidores se conectan en paralelo, cada uno de forma independiente
3. Las herramientas estan disponibles a medida que los servidores terminan de conectarse
4. Si un servidor falla, los demas continuan normalmente (los errores se muestran con `/mcp`)
5. Cuando el LLM invoca una herramienta MCP, Autohand espera a que las conexiones se completen primero

Este comportamiento coincide con la forma en que Claude Code y herramientas similares manejan MCP -- el usuario nunca se ve bloqueado por un inicio lento del servidor.

---

## Solucion de Problemas

### El servidor no se conecta

```bash
# Verificar estado
/mcp

# Intentar reconectar
/mcp disconnect <name>
/mcp connect <name>
```

### Errores comunes

| Error | Causa | Solucion |
|-------|-------|----------|
| `Command not found` | Paquete no instalado | Ejecuta el comando `npx` manualmente primero |
| `Connection refused` | Servidor no esta ejecutandose (SSE) | Verifica la URL y el estado del servidor |
| `Request timed out` | Servidor no responde | Revisa los logs del servidor, reinicia |
| `SSE transport not yet implemented` | SSE aun no soportado | Usa el transporte stdio |

### Logs del servidor

La salida stderr del servidor MCP se captura internamente. Si un servidor se comporta de forma inesperada, verifica si el comando subyacente funciona fuera de Autohand:

```bash
npx -y @modelcontextprotocol/server-filesystem /tmp
```

### Deshabilitar MCP

Establece `mcp.enabled` en `false` en tu configuracion para deshabilitar todo el soporte MCP:

```json
{
  "mcp": {
    "enabled": false
  }
}
```

O configura servidores individuales para que no se conecten automaticamente:

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
