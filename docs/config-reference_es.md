# Referencia de Configuración de Autohand

Referencia completa de todas las opciones de configuración en `~/.autohand/config.json` (o `.yaml`/`.yml`).

## Tabla de Contenidos

- [Ubicación del Archivo de Configuración](#ubicación-del-archivo-de-configuración)
- [Variables de Entorno](#variables-de-entorno)
- [Configuración del Proveedor](#configuración-del-proveedor)
- [Configuración del Espacio de Trabajo](#configuración-del-espacio-de-trabajo)
- [Configuración de UI](#configuración-de-ui)
- [Configuración del Agente](#configuración-del-agente)
- [Configuración de Permisos](#configuración-de-permisos)
- [Configuración de Red](#configuración-de-red)
- [Configuración de Telemetría](#configuración-de-telemetría)
- [Agentes Externos](#agentes-externos)
- [Configuración de API](#configuración-de-api)
- [Ejemplo Completo](#ejemplo-completo)

---

## Ubicación del Archivo de Configuración

Autohand busca la configuración en este orden:

1. Variable de entorno `AUTOHAND_CONFIG` (ruta personalizada)
2. `~/.autohand/config.yaml`
3. `~/.autohand/config.yml`
4. `~/.autohand/config.json` (predeterminado)

También puede sobrescribir el directorio base:
```bash
export AUTOHAND_HOME=/ruta/personalizada  # Cambia ~/.autohand a /ruta/personalizada
```

---

## Variables de Entorno

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `AUTOHAND_HOME` | Directorio base para todos los datos de Autohand | `/ruta/personalizada` |
| `AUTOHAND_CONFIG` | Ruta del archivo de configuración personalizado | `/ruta/a/config.json` |
| `AUTOHAND_API_URL` | Endpoint de API (sobrescribe configuración) | `https://api.autohand.ai` |
| `AUTOHAND_SECRET` | Clave secreta de empresa/equipo | `sk-xxx` |

---

## Configuración del Proveedor

### `provider`
Proveedor LLM activo a usar.

| Valor | Descripción |
|-------|-------------|
| `"openrouter"` | API de OpenRouter (predeterminado) |
| `"ollama"` | Instancia local de Ollama |
| `"llamacpp"` | Servidor local de llama.cpp |
| `"openai"` | API de OpenAI directamente |

### `openrouter`
Configuración del proveedor OpenRouter.

```json
{
  "openrouter": {
    "apiKey": "sk-or-v1-xxx",
    "baseUrl": "https://openrouter.ai/api/v1",
    "model": "anthropic/claude-sonnet-4"
  }
}
```

| Campo | Tipo | Requerido | Predeterminado | Descripción |
|-------|------|-----------|----------------|-------------|
| `apiKey` | string | Sí | - | Tu clave de API de OpenRouter |
| `baseUrl` | string | No | `https://openrouter.ai/api/v1` | Endpoint de API |
| `model` | string | Sí | - | Identificador del modelo (ej. `anthropic/claude-sonnet-4`) |

### `ollama`
Configuración del proveedor Ollama.

```json
{
  "ollama": {
    "baseUrl": "http://localhost:11434",
    "port": 11434,
    "model": "llama3.2"
  }
}
```

| Campo | Tipo | Requerido | Predeterminado | Descripción |
|-------|------|-----------|----------------|-------------|
| `baseUrl` | string | No | `http://localhost:11434` | URL del servidor Ollama |
| `port` | number | No | `11434` | Puerto del servidor (alternativa a baseUrl) |
| `model` | string | Sí | - | Nombre del modelo (ej. `llama3.2`, `codellama`) |

### `llamacpp`
Configuración del servidor llama.cpp.

```json
{
  "llamacpp": {
    "baseUrl": "http://localhost:8080",
    "port": 8080,
    "model": "default"
  }
}
```

| Campo | Tipo | Requerido | Predeterminado | Descripción |
|-------|------|-----------|----------------|-------------|
| `baseUrl` | string | No | `http://localhost:8080` | URL del servidor llama.cpp |
| `port` | number | No | `8080` | Puerto del servidor |
| `model` | string | Sí | - | Identificador del modelo |

### `openai`
Configuración de API de OpenAI.

```json
{
  "openai": {
    "apiKey": "sk-xxx",
    "baseUrl": "https://api.openai.com/v1",
    "model": "gpt-4o"
  }
}
```

| Campo | Tipo | Requerido | Predeterminado | Descripción |
|-------|------|-----------|----------------|-------------|
| `apiKey` | string | Sí | - | Clave de API de OpenAI |
| `baseUrl` | string | No | `https://api.openai.com/v1` | Endpoint de API |
| `model` | string | Sí | - | Nombre del modelo (ej. `gpt-4o`, `gpt-4o-mini`) |

---

## Configuración del Espacio de Trabajo

```json
{
  "workspace": {
    "defaultRoot": "/ruta/a/proyectos",
    "allowDangerousOps": false
  }
}
```

| Campo | Tipo | Predeterminado | Descripción |
|-------|------|----------------|-------------|
| `defaultRoot` | string | Directorio actual | Espacio de trabajo predeterminado cuando no se especifica |
| `allowDangerousOps` | boolean | `false` | Permitir operaciones destructivas sin confirmación |

---

## Configuración de UI

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

| Campo | Tipo | Predeterminado | Descripción |
|-------|------|----------------|-------------|
| `theme` | `"dark"` \| `"light"` | `"dark"` | Tema de color para salida de terminal |
| `autoConfirm` | boolean | `false` | Omitir confirmaciones para operaciones seguras |
| `readFileCharLimit` | number | `300` | Máximo de caracteres mostrados en salida de herramientas de lectura/búsqueda (el contenido completo aún se envía al modelo) |
| `showCompletionNotification` | boolean | `true` | Mostrar notificación del sistema cuando la tarea termine |
| `showThinking` | boolean | `true` | Mostrar el razonamiento/proceso de pensamiento del LLM |
| `useInkRenderer` | boolean | `false` | Usar renderizador basado en Ink para UI sin parpadeo (experimental) |
| `terminalBell` | boolean | `true` | Sonar campana del terminal cuando la tarea termine (muestra insignia en pestaña/dock del terminal) |
| `checkForUpdates` | boolean | `true` | Verificar actualizaciones de CLI al iniciar |
| `updateCheckInterval` | number | `24` | Horas entre verificaciones de actualización (usa resultado en caché dentro del intervalo) |

Nota: `readFileCharLimit` solo afecta la visualización en terminal para `read_file`, `search` y `search_with_context`. El contenido completo aún se envía al modelo y se almacena en mensajes de herramientas.

### Campana del Terminal

Cuando `terminalBell` está habilitado (predeterminado), Autohand suena la campana del terminal (`\x07`) cuando una tarea se completa. Esto activa:

- **Insignia en pestaña del terminal** - Muestra un indicador visual de que el trabajo está hecho
- **Rebote del ícono del Dock** - Llama tu atención cuando el terminal está en segundo plano (macOS)
- **Sonido** - Si los sonidos del terminal están habilitados en la configuración de tu terminal

Para deshabilitar:
```json
{
  "ui": {
    "terminalBell": false
  }
}
```

### Renderizador Ink (Experimental)

Cuando `useInkRenderer` está habilitado, Autohand usa renderizado de terminal basado en React (Ink) en lugar del spinner ora tradicional. Esto proporciona:

- **Salida sin parpadeo**: Todas las actualizaciones de UI se agrupan a través de la reconciliación de React
- **Función de cola de trabajo**: Escribe instrucciones mientras el agente trabaja
- **Mejor manejo de entrada**: Sin conflictos entre manejadores de readline
- **UI componible**: Base para futuras características avanzadas de UI

Para habilitar:
```json
{
  "ui": {
    "useInkRenderer": true
  }
}
```

Nota: Esta característica es experimental y puede tener casos extremos. La UI predeterminada basada en ora permanece estable y completamente funcional.

### Verificación de Actualizaciones

Cuando `checkForUpdates` está habilitado (predeterminado), Autohand verifica nuevos lanzamientos al iniciar:

```
> Autohand v0.6.8 (abc1234) ✓ Up to date
```

Si hay una actualización disponible:
```
> Autohand v0.6.7 (abc1234) ⬆ Update available: v0.6.8
  ↳ Run: curl -fsSL https://autohand.ai/install.sh | sh
```

Para deshabilitar:
```json
{
  "ui": {
    "checkForUpdates": false
  }
}
```

O mediante variable de entorno:
```bash
export AUTOHAND_SKIP_UPDATE_CHECK=1
```

---

## Configuración del Agente

Controla el comportamiento del agente y límites de iteración.

```json
{
  "agent": {
    "maxIterations": 100,
    "enableRequestQueue": true
  }
}
```

| Campo | Tipo | Predeterminado | Descripción |
|-------|------|----------------|-------------|
| `maxIterations` | number | `100` | Máximo de iteraciones de herramientas por solicitud de usuario antes de detenerse |
| `enableRequestQueue` | boolean | `true` | Permitir a usuarios escribir y encolar solicitudes mientras el agente trabaja |

### Cola de Solicitudes

Cuando `enableRequestQueue` está habilitado, puedes continuar escribiendo mensajes mientras el agente procesa una solicitud anterior. Tu entrada se encolará automáticamente y se procesará cuando la tarea actual termine.

- Escribe tu mensaje y presiona Enter para agregar a la cola
- La línea de estado muestra cuántas solicitudes están encoladas
- Las solicitudes se procesan en orden FIFO (primero en entrar, primero en salir)
- El tamaño máximo de la cola es 10 solicitudes

---

## Configuración de Permisos

Control granular sobre permisos de herramientas.

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

| Valor | Descripción |
|-------|-------------|
| `"interactive"` | Solicitar aprobación en operaciones peligrosas (predeterminado) |
| `"unrestricted"` | Sin solicitudes, permitir todo |
| `"restricted"` | Denegar todas las operaciones peligrosas |

### `whitelist`
Array de patrones de herramientas que nunca requieren aprobación.

```json
["run_command:npm *", "run_command:bun test"]
```

### `blacklist`
Array de patrones de herramientas que siempre se bloquean.

```json
["run_command:rm -rf /", "run_command:sudo *"]
```

### `rules`
Reglas de permisos granulares.

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `tool` | string | Nombre de herramienta a coincidir |
| `pattern` | string | Patrón opcional para coincidir contra argumentos |
| `action` | `"allow"` \| `"deny"` \| `"prompt"` | Acción a tomar |

### `rememberSession`
| Tipo | Predeterminado | Descripción |
|------|----------------|-------------|
| boolean | `true` | Recordar decisiones de aprobación para la sesión |

### Permisos Locales del Proyecto

Cada proyecto puede tener su propia configuración de permisos que sobrescribe la configuración global. Estos se almacenan en `.autohand/settings.local.json` en la raíz de tu proyecto.

Cuando apruebas una operación de archivo (editar, escribir, eliminar), se guarda automáticamente en este archivo para que no te pregunten de nuevo por la misma operación en este proyecto.

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

**Cómo funciona:**
- Cuando apruebas una operación, se guarda en `.autohand/settings.local.json`
- La próxima vez, la misma operación será auto-aprobada
- La configuración local del proyecto se fusiona con la configuración global (local tiene prioridad)
- Agrega `.autohand/settings.local.json` a `.gitignore` para mantener la configuración personal privada

**Formato de patrón:**
- `nombre_herramienta:ruta` - Para operaciones de archivo (ej. `multi_file_edit:src/file.ts`)
- `nombre_herramienta:comando args` - Para comandos (ej. `run_command:npm test`)

---

## Configuración de Red

```json
{
  "network": {
    "maxRetries": 3,
    "timeout": 30000,
    "retryDelay": 1000
  }
}
```

| Campo | Tipo | Predeterminado | Máx | Descripción |
|-------|------|----------------|-----|-------------|
| `maxRetries` | number | `3` | `5` | Intentos de reintento para solicitudes de API fallidas |
| `timeout` | number | `30000` | - | Tiempo de espera de solicitud en milisegundos |
| `retryDelay` | number | `1000` | - | Retraso entre reintentos en milisegundos |

---

## Configuración de Telemetría

La telemetría está **deshabilitada por defecto** (opt-in). Habilítala para ayudar a mejorar Autohand.

```json
{
  "telemetry": {
    "enabled": false,
    "apiBaseUrl": "https://api.autohand.ai",
    "enableSessionSync": false
  }
}
```

| Campo | Tipo | Predeterminado | Descripción |
|-------|------|----------------|-------------|
| `enabled` | boolean | `false` | Habilitar/deshabilitar telemetría (opt-in) |
| `apiBaseUrl` | string | `https://api.autohand.ai` | Endpoint de API de telemetría |
| `enableSessionSync` | boolean | `false` | Sincronizar sesiones a la nube para características de equipo |

---

## Agentes Externos

Carga definiciones de agentes personalizados desde directorios externos.

```json
{
  "externalAgents": {
    "enabled": true,
    "paths": [
      "~/.autohand/agents",
      "/equipo/compartido/agents"
    ]
  }
}
```

| Campo | Tipo | Predeterminado | Descripción |
|-------|------|----------------|-------------|
| `enabled` | boolean | `false` | Habilitar carga de agentes externos |
| `paths` | string[] | `[]` | Directorios para cargar agentes |

---

## Configuración de API

Configuración de API backend para características de equipo.

```json
{
  "api": {
    "baseUrl": "https://api.autohand.ai",
    "companySecret": "sk-team-xxx"
  }
}
```

| Campo | Tipo | Predeterminado | Descripción |
|-------|------|----------------|-------------|
| `baseUrl` | string | `https://api.autohand.ai` | Endpoint de API |
| `companySecret` | string | - | Secreto de equipo/empresa para características compartidas |

También se puede configurar mediante variables de entorno:
- `AUTOHAND_API_URL` → `api.baseUrl`
- `AUTOHAND_SECRET` → `api.companySecret`

---

## Ejemplo Completo

### Formato JSON (`~/.autohand/config.json`)

```json
{
  "provider": "openrouter",
  "openrouter": {
    "apiKey": "sk-or-v1-tu-clave-aqui",
    "baseUrl": "https://openrouter.ai/api/v1",
    "model": "anthropic/claude-sonnet-4"
  },
  "ollama": {
    "baseUrl": "http://localhost:11434",
    "model": "llama3.2"
  },
  "workspace": {
    "defaultRoot": "~/proyectos",
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
  apiKey: sk-or-v1-tu-clave-aqui
  baseUrl: https://openrouter.ai/api/v1
  model: anthropic/claude-sonnet-4

ollama:
  baseUrl: http://localhost:11434
  model: llama3.2

workspace:
  defaultRoot: ~/proyectos
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

## Estructura de Directorios

Autohand almacena datos en `~/.autohand/` (o `$AUTOHAND_HOME`):

```
~/.autohand/
├── config.json          # Configuración principal
├── config.yaml          # Configuración YAML alternativa
├── device-id            # Identificador único de dispositivo
├── error.log            # Registro de errores
├── feedback.log         # Envíos de feedback
├── sessions/            # Historial de sesiones
├── projects/            # Base de conocimiento del proyecto
├── memory/              # Memoria a nivel de usuario
├── commands/            # Comandos personalizados
├── agents/              # Definiciones de agentes
├── tools/               # Meta-herramientas personalizadas
├── feedback/            # Estado de feedback
└── telemetry/           # Datos de telemetría
    ├── queue.json
    └── session-sync-queue.json
```

**Directorio a nivel de proyecto** (en la raíz de tu espacio de trabajo):

```
<proyecto>/.autohand/
├── settings.local.json  # Permisos locales del proyecto (agregar a gitignore)
├── memory/              # Memoria específica del proyecto
└── skills/              # Skills específicas del proyecto
```

---

## Flags de CLI (Sobrescribir Configuración)

Estos flags sobrescriben la configuración del archivo:

| Flag | Descripción |
|------|-------------|
| `--model <modelo>` | Sobrescribir modelo |
| `--path <ruta>` | Sobrescribir raíz del espacio de trabajo |
| `--config <ruta>` | Usar archivo de configuración personalizado |
| `--temperature <n>` | Establecer temperatura (0-1) |
| `--yes` | Auto-confirmar solicitudes |
| `--dry-run` | Vista previa sin ejecutar |
| `--unrestricted` | Sin solicitudes de aprobación |
| `--restricted` | Denegar operaciones peligrosas |
| `--setup` | Ejecutar el asistente de configuración para configurar o reconfigurar Autohand |
