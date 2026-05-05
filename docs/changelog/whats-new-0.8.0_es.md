# Novedades en Autohand 0.8.0

Autohand 0.8.0 es una version mayor que trae el modo pipe para flujos de trabajo composables en Unix, controles de pensamiento extendido, auto-aprobacion granular (modo yolo), soporte de cliente MCP, integracion con IDEs, modo plan y mucho mas. Este documento cubre cada nueva funcionalidad y mejora incluida en esta version.

## Tabla de Contenidos

- [Modo Pipe](#modo-pipe)
- [Pensamiento Extendido](#pensamiento-extendido)
- [Historial de Sesiones](#historial-de-sesiones)
- [Auto-Aprobacion Granular (Modo Yolo)](#auto-aprobacion-granular-modo-yolo)
- [Soporte de Cliente MCP](#soporte-de-cliente-mcp)
- [Integracion con IDEs](#integracion-con-ides)
- [Instalacion via Homebrew](#instalacion-via-homebrew)
- [Modo Plan](#modo-plan)
- [Herramienta Web Repo](#herramienta-web-repo)
- [Compactacion Automatica de Contexto](#compactacion-automatica-de-contexto)
- [Prompt de Sistema Personalizado](#prompt-de-sistema-personalizado)
- [Nuevos Flags de CLI](#nuevos-flags-de-cli)
- [Nuevos Comandos Slash](#nuevos-comandos-slash)
- [Mejoras de Arquitectura](#mejoras-de-arquitectura)
- [Actualizacion](#actualizacion)

---

## Modo Pipe

Autohand ahora funciona perfectamente como parte de pipelines de Unix. Cuando stdin no es una TTY, Autohand entra en **modo pipe** -- una ruta de ejecucion no interactiva disenada para flujos de trabajo composables.

### Como Funciona

El modo pipe envia el contenido canalizado junto con tu instruccion al LLM. El resultado final se escribe en stdout, mientras que los errores y el progreso van a stderr. Esto mantiene el flujo de salida limpio para los consumidores posteriores.

```bash
# Explicar un diff
git diff | autohand 'explain these changes'

# Revisar codigo de un archivo
cat src/auth.ts | autohand 'review this code for security issues'

# Encadenar multiples herramientas
git log --oneline -10 | autohand 'summarize recent changes' > changelog.txt
```

### Enrutamiento de Salida

| Flujo | Contenido |
|-------|-----------|
| **stdout** | Solo el resultado final (consumido por pipes posteriores) |
| **stderr** | Errores y mensajes de progreso opcionales |

### Salida JSON

Usa `--json` para salida ndjson estructurada, ideal para consumo programatico:

```bash
git diff | autohand 'review' --json
```

Cada linea es un objeto JSON valido:

```json
{"type": "result", "content": "El diff muestra..."}
{"type": "error", "message": "Limite de tasa excedido"}
```

### Progreso Detallado

Usa `--verbose` para enviar mensajes de progreso a stderr mientras mantienes stdout limpio:

```bash
git diff | autohand 'review' --verbose 2>progress.log
```

### Ejemplos Composables

```bash
# Cadena de pipes: generar tests, luego lint
autohand --prompt 'generate tests for auth.ts' | eslint --stdin

# Usar con xargs
find src -name '*.ts' | xargs -I{} sh -c 'cat {} | autohand "review" > {}.review'

# Integracion CI
git diff HEAD~1 | autohand 'check for breaking changes' --json | jq '.content'
```

---

## Pensamiento Extendido

Controla la profundidad de razonamiento del LLM antes de responder con el flag `--thinking`. Es util para ajustar el balance entre velocidad y exhaustividad.

### Uso

```bash
# Razonamiento extendido para tareas complejas
autohand --thinking extended

# Razonamiento estandar (por defecto)
autohand --thinking normal

# Respuestas directas sin razonamiento visible
autohand --thinking none

# Atajo: --thinking sin valor equivale a extended
autohand --thinking
```

### Niveles de Pensamiento

| Nivel | Descripcion | Ideal Para |
|-------|-------------|------------|
| `extended` | Razonamiento profundo con proceso de pensamiento detallado | Refactorizaciones complejas, decisiones de arquitectura, depuracion |
| `normal` | Profundidad de razonamiento estandar (por defecto) | Tareas generales de programacion |
| `none` | Respuestas directas sin razonamiento visible | Preguntas simples, ediciones rapidas |

### Variable de Entorno

Tambien puedes establecer el nivel de pensamiento via variable de entorno, util para integraciones con IDEs:

```bash
AUTOHAND_THINKING_LEVEL=extended autohand --prompt "refactor this module"
```

---

## Historial de Sesiones

El nuevo comando slash `/history` proporciona navegacion paginada del historial de sesiones, facilitando encontrar y retomar trabajos anteriores.

### Uso

```
/history          # Mostrar primera pagina del historial
/history 2        # Mostrar pagina 2
/history 3        # Mostrar pagina 3
```

### Formato de Visualizacion

Cada entrada muestra:

| Columna | Descripcion |
|---------|-------------|
| **ID** | Identificador de sesion (truncado a 20 caracteres) |
| **Fecha** | Fecha y hora de creacion |
| **Proyecto** | Nombre del proyecto |
| **Modelo** | Modelo LLM utilizado (abreviado) |
| **Mensajes** | Conteo total de mensajes |
| **Estado** | Insignia de sesion activa (verde `[active]`) |

### Retomar Sesiones

Combina `/history` con `/resume` para un flujo de trabajo fluido:

```
/history            # Encuentra la sesion que deseas
/resume abc123...   # Retomala
```

---

## Auto-Aprobacion Granular (Modo Yolo)

El modo yolo proporciona auto-aprobacion basada en patrones para llamadas a herramientas, dandote control detallado sobre lo que el agente puede hacer sin preguntar. Combinalo con `--timeout` para sesiones autonomas con limite de tiempo.

### Uso

```bash
# Auto-aprobar todo
autohand --yolo true

# Auto-aprobar solo operaciones de lectura y escritura
autohand --yolo 'allow:read_file,write_file,search'

# Auto-aprobar todo excepto eliminar y ejecutar comandos
autohand --yolo 'deny:delete_path,run_command'

# Permitir todas las operaciones, pero solo por 10 minutos
autohand --yolo true --timeout 600
```

### Sintaxis de Patrones

| Patron | Efecto |
|--------|--------|
| `true` | Atajo para `allow:*` -- aprobar todo |
| `allow:*` | Auto-aprobar todas las herramientas |
| `allow:read_file,write_file` | Auto-aprobar solo las herramientas listadas |
| `deny:delete_path,run_command` | Denegar las herramientas listadas, auto-aprobar el resto |

### Como Funciona

1. Autohand analiza el patron `--yolo` en un `YoloPattern` (modo + lista de herramientas).
2. Cuando una llamada a herramienta requiere aprobacion, Autohand verifica si el nombre de la herramienta coincide con el patron.
3. Si coincide (en modo allow) o no coincide (en modo deny), la herramienta se ejecuta sin preguntar.
4. Si el patron no auto-aprueba la herramienta, se muestra el dialogo de permisos normal.

### Temporizador

El flag `--timeout` crea un `YoloTimer` que rastrea el tiempo restante:

```bash
# Auto-aprobar por 5 minutos, luego volver al dialogo normal
autohand --yolo true --timeout 300
```

- Mientras el temporizador esta activo, las herramientas que coinciden se auto-aprueban.
- Cuando el temporizador expira, todas las llamadas vuelven al dialogo de permisos normal.

### Seguridad

- El modo yolo se integra con el sistema de permisos existente.
- Las operaciones en la lista negra (`permissions.blacklist`) siguen bloqueadas incluso en modo yolo.
- El patron `deny` te permite excluir operaciones peligrosas explicitamente.

---

## Soporte de Cliente MCP

Autohand ahora incluye un cliente MCP (Model Context Protocol) integrado que puede conectarse a servidores MCP externos. Esto te permite extender Autohand con herramientas personalizadas de bases de datos, APIs o cualquier servicio compatible con MCP.

### Descripcion General

MCP es un protocolo estandar de la industria para conectar agentes de IA con herramientas externas. El cliente MCP de Autohand soporta:

- **Transporte stdio** -- lanza un proceso hijo y se comunica via JSON-RPC 2.0 sobre stdin/stdout
- **Transporte SSE** -- se conecta a un servidor HTTP usando Server-Sent Events
- **Descubrimiento automatico de herramientas** -- consulta `tools/list` y registra herramientas dinamicamente
- **Herramientas con namespace** -- las herramientas tienen el prefijo `mcp__<servidor>__<herramienta>` para evitar colisiones
- **Gestion del ciclo de vida del servidor** -- iniciar, detener y reconectar servidores

### Configuracion

Agrega servidores MCP a tu `~/.autohand/config.json`:

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

### Campos de Configuracion del Servidor

| Campo | Tipo | Requerido | Por Defecto | Descripcion |
|-------|------|-----------|-------------|-------------|
| `name` | string | Si | - | Nombre unico del servidor |
| `transport` | `"stdio"` o `"sse"` | Si | - | Tipo de conexion |
| `command` | string | solo stdio | - | Comando para iniciar el servidor |
| `args` | string[] | No | `[]` | Argumentos del comando |
| `url` | string | solo sse | - | URL del endpoint SSE |
| `env` | object | No | `{}` | Variables de entorno para el proceso del servidor |
| `autoConnect` | boolean | No | `true` | Conectar automaticamente al iniciar |

### Nomenclatura de Herramientas

Las herramientas MCP usan namespace para prevenir colisiones con herramientas integradas:

```
mcp__<nombre-servidor>__<nombre-herramienta>
```

Por ejemplo, una herramienta llamada `query` de un servidor llamado `database` se convierte en `mcp__database__query`.

---

## Integracion con IDEs

El comando `/ide` detecta IDEs en ejecucion en tu sistema y habilita funciones integradas. Autohand puede detectar que IDE esta editando tu workspace actual y sugerir extensiones relevantes.

### IDEs Soportados

| IDE | Plataformas | Extension Disponible |
|-----|-------------|----------------------|
| Visual Studio Code | macOS, Linux, Windows | Si |
| Visual Studio Code Insiders | macOS, Linux, Windows | Si |
| Cursor | macOS, Linux, Windows | No |
| Zed | macOS, Linux, Windows | Si |
| Antigravity | macOS | No |

### Uso

```
/ide
```

El comando realiza los siguientes pasos:

1. Escanea procesos en ejecucion buscando patrones de IDEs conocidos
2. Lee el almacenamiento del IDE para determinar que workspace tiene abierto cada instancia
3. Compara los IDEs detectados con tu directorio de trabajo actual
4. Presenta un modal de seleccion para los IDEs que coinciden
5. Sugiere instalaciones de extensiones para una integracion mas profunda

---

## Instalacion via Homebrew

Autohand ahora esta disponible via Homebrew en macOS:

```bash
# Instalar directamente
brew install autohand

# O via el tap oficial
brew tap autohandai/tap && brew install autohand
```

### Detalles

- Node.js se declara como dependencia y se instala automaticamente si es necesario
- La formula se instala desde el registro npm
- La version se verifica despues de la instalacion via `autohand --version`
- Las actualizaciones estan disponibles via `brew upgrade autohand`

---

## Modo Plan

El modo plan permite que el agente planifique antes de actuar. Cuando esta habilitado, el agente solo usa herramientas de solo lectura para recopilar informacion y formular un plan. Una vez que apruebas el plan, comienza la ejecucion.

### Activacion

Presiona **Shift+Tab** para alternar el modo plan. Un indicador de estado muestra el estado actual:

| Indicador | Significado |
|-----------|-------------|
| `[PLAN]` | Fase de planificacion -- el agente recopila informacion y formula un plan |
| `[EXEC]` | Fase de ejecucion -- el agente ejecuta el plan aprobado |
| *(ninguno)* | Modo plan desactivado -- operacion normal |

### Como Funciona

1. **Activar** -- presiona Shift+Tab. El prompt muestra `[PLAN]`.
2. **Fase de planificacion** -- el agente solo puede usar herramientas de solo lectura (lectura de archivos, busqueda, git status, busqueda web, etc.). Las operaciones de escritura estan bloqueadas.
3. **Presentacion del plan** -- el agente presenta un plan estructurado con pasos.
4. **Opciones de aceptacion** -- elige como proceder:
   - **Limpiar contexto y auto-aceptar ediciones** -- mejor adherencia al plan, limpia el historial de conversacion
   - **Aprobacion manual** -- revisa y aprueba cada edicion individualmente
   - **Auto-aceptar** -- auto-aceptar todas las ediciones sin revision
5. **Ejecucion** -- el indicador cambia a `[EXEC]` y el agente ejecuta el plan.

---

## Herramienta Web Repo

La nueva herramienta `web_repo` obtiene informacion de repositorios de GitHub y GitLab usando el formato `@owner/repo`. Esto le da al agente contexto sobre repositorios externos sin salir de la terminal.

### Uso

Menciona un repositorio en tu prompt usando la sintaxis `@owner/repo`:

```
Cuentame sobre @vercel/next.js
```

El agente tambien puede llamar a la herramienta `web_repo` directamente para obtener metadatos del repositorio, contenido del README e informacion de estructura.

---

## Compactacion Automatica de Contexto

Autohand ahora compacta automaticamente el contexto de la conversacion cuando las sesiones se alargan. Esto previene el agotamiento de la ventana de contexto y mantiene al agente receptivo durante sesiones extensas.

### Como Funciona

- Habilitado por defecto (flag `--cc`)
- Monitorea la longitud de la conversacion relativa a la ventana de contexto del modelo
- Cuando la conversacion se acerca al limite, los mensajes antiguos se resumen y compactan
- Funciona tanto en modo interactivo como en modo plan
- La informacion critica (contenido de archivos, resultados recientes de herramientas) se preserva

### Configuracion

```bash
# Habilitar compactacion de contexto (por defecto)
autohand --cc

# Deshabilitar compactacion de contexto
autohand --no-cc
```

---

## Prompt de Sistema Personalizado

Sobrescribe o extiende el prompt de sistema predeterminado para flujos de trabajo especializados.

### Reemplazar Prompt Completo

```bash
# Cadena en linea
autohand --sys-prompt "You are a Python expert. Be concise."

# Desde archivo
autohand --sys-prompt ./custom-prompt.md
```

Al usar `--sys-prompt`, las instrucciones predeterminadas de Autohand, AGENTS.md, memorias y skills se reemplazan completamente.

### Agregar al Prompt Predeterminado

```bash
# Cadena en linea
autohand --append-sys-prompt "Always use TypeScript instead of JavaScript"

# Desde archivo
autohand --append-sys-prompt ./team-guidelines.md
```

Al usar `--append-sys-prompt`, el contenido se agrega al final del prompt completo predeterminado. Todos los comportamientos por defecto se preservan.

---

## Nuevos Flags de CLI

| Flag | Descripcion |
|------|-------------|
| `--thinking [level]` | Establece la profundidad de razonamiento: `none`, `normal`, `extended` |
| `--yolo [pattern]` | Auto-aprobar llamadas a herramientas que coincidan con un patron |
| `--timeout <seconds>` | Limite de tiempo para auto-aprobacion en modo yolo |
| `--cc` / `--no-cc` | Habilitar/deshabilitar compactacion automatica de contexto |
| `--search-engine <provider>` | Establecer proveedor de busqueda web (`brave`, `duckduckgo`, `parallel`) |
| `--sys-prompt <value>` | Reemplazar el prompt de sistema completo (en linea o ruta de archivo) |
| `--append-sys-prompt <value>` | Agregar al prompt de sistema predeterminado |
| `--display-language <locale>` | Establecer idioma de visualizacion (ej., `en`, `zh-cn`, `fr`, `de`, `ja`) |
| `--add-dir <path>` | Agregar directorios adicionales al alcance del workspace |
| `--skill-install [name]` | Instalar un skill comunitario |
| `--project` | Instalar skill a nivel de proyecto (con `--skill-install`) |

---

## Nuevos Comandos Slash

| Comando | Descripcion |
|---------|-------------|
| `/history` | Navegar el historial de sesiones con paginacion |
| `/history <pagina>` | Ver una pagina especifica del historial |
| `/ide` | Detectar IDEs en ejecucion y conectar para integracion |
| `/about` | Mostrar informacion sobre Autohand (version, enlaces) |
| `/feedback` | Enviar comentarios sobre el CLI |
| `/plan` | Interactuar con el modo plan |
| `/add-dir` | Agregar directorios adicionales al alcance del workspace |
| `/language` | Cambiar idioma de visualizacion |
| `/formatters` | Listar formateadores de codigo disponibles |
| `/lint` | Listar linters de codigo disponibles |
| `/completion` | Generar scripts de completado de shell (bash, zsh, fish) |
| `/export` | Exportar sesion a markdown, JSON o HTML |
| `/permissions` | Ver y administrar configuracion de permisos |
| `/hooks` | Administrar hooks de ciclo de vida interactivamente |
| `/share` | Compartir una sesion via autohand.link |
| `/skills` | Listar, activar, desactivar o crear skills |

---

## Mejoras de Arquitectura

### Componente Modal

La dependencia `enquirer` ha sido reemplazada por un componente `Modal` personalizado construido con Ink. Esto proporciona estilos consistentes, navegacion por teclado y mejor integracion con el resto de la TUI.

### Modulos Extraidos

Varios modulos internos han sido extraidos para mejor separacion de responsabilidades:

- **WorkspaceFileCollector** -- maneja el descubrimiento de archivos del workspace con cache de 30 segundos
- **AgentFormatter** -- formatea la salida del agente para visualizacion en terminal
- **ProviderConfigManager** -- administra la logica de configuracion especifica de proveedores

### Renderizado UI con Ink

El renderizador experimental basado en Ink (`ui.useInkRenderer`) ha sido optimizado para:

- Salida sin parpadeo via reconciliacion de React
- Cola de solicitudes en funcionamiento (escribe mientras el agente trabaja)
- Mejor manejo de entrada sin conflictos de readline

### Ayuda Dinamica

El comando `/help` ahora genera su salida dinamicamente desde los comandos slash registrados, por lo que siempre refleja el conjunto actual de comandos disponibles.

---

## Actualizacion

### Desde npm

```bash
npm update -g autohand-cli
```

### Desde Homebrew

```bash
brew upgrade autohand
```

### Compatibilidad de Configuracion

Tu `~/.autohand/config.json` existente es completamente compatible hacia atras. No se necesita migracion.

Las nuevas secciones de configuracion (como `mcp.servers`) son opcionales y solo se requieren si deseas usar las funcionalidades correspondientes. Autohand usa valores predeterminados sensatos para todas las nuevas configuraciones.

---

## Documentacion Relacionada

- [Referencia de Configuracion](./config-reference_es.md) -- todas las opciones de configuracion
- [Sistema de Hooks](./hooks.md) -- hooks de ciclo de vida
- [Guia de Proveedores](./providers.md) -- configuracion de proveedores LLM
- [Modo Automatico](./automode.md) -- ciclos de desarrollo autonomo
- [Protocolo RPC](./rpc-protocol.md) -- control programatico
