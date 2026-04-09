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
- [Modo Patch](#modo-patch)
- [Configuración de Red](#configuración-de-red)
- [Configuración de Telemetría](#configuración-de-telemetría)
- [Agentes Externos](#agentes-externos)
- [Configuración de API](#configuración-de-api)
- [Configuración de Autenticación](#configuración-de-autenticación)
- [Configuración de Skills Comunitarios](#configuración-de-skills-comunitarios)
- [Configuración de Compartir](#configuración-de-compartir)
- [Sincronización de Configuraciones](#sincronización-de-configuraciones)
- [Configuración de Hooks](#configuración-de-hooks)
- [Configuración de MCP](#configuración-de-mcp)
- [Configuración de Extensión de Chrome](#configuración-de-extensión-de-chrome)
- [Sistema de Skills](#sistema-de-skills)
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

| Variable                               | Descripción                                      | Ejemplo                          |
| -------------------------------------- | ------------------------------------------------ | -------------------------------- |
| `AUTOHAND_HOME`                        | Directorio base para todos los datos de Autohand | `/ruta/personalizada`            |
| `AUTOHAND_CONFIG`                      | Ruta del archivo de configuración personalizado  | `/ruta/a/config.json`            |
| `AUTOHAND_API_URL`                     | Endpoint de API (sobrescribe configuración)      | `https://api.autohand.ai`        |
| `AUTOHAND_SECRET`                      | Clave secreta de empresa/equipo                  | `sk-xxx`                         |
| `AUTOHAND_PERMISSION_CALLBACK_URL`     | URL para callback de permiso (experimental)      | `http://localhost:3000/callback` |
| `AUTOHAND_PERMISSION_CALLBACK_TIMEOUT` | Timeout para callback de permiso en ms           | `5000`                           |
| `AUTOHAND_NON_INTERACTIVE`             | Ejecutar en modo no interactivo                  | `1`                              |
| `AUTOHAND_YES`                         | Auto-confirmar todos los prompts                 | `1`                              |
| `AUTOHAND_NO_BANNER`                   | Deshabilitar banner de inicio                    | `1`                              |
| `AUTOHAND_STREAM_TOOL_OUTPUT`          | Transmitir output de herramientas en tiempo real | `1`                             |
| `AUTOHAND_DEBUG`                       | Habilitar logging de debug                       | `1`                              |
| `AUTOHAND_THINKING_LEVEL`              | Definir nivel de razonamiento                    | `normal`                         |
| `AUTOHAND_CLIENT_NAME`                 | Identificador de cliente/editor (definido por extensiones ACP) | `zed`                |
| `AUTOHAND_CLIENT_VERSION`              | Versión del cliente (definido por extensiones ACP) | `0.169.0`                      |

### Nivel de Razonamiento

La variable de entorno `AUTOHAND_THINKING_LEVEL` controla la profundidad del razonamiento que usa el modelo:

| Valor      | Descripción                                                         |
| ---------- | ------------------------------------------------------------------- |
| `none`     | Respuestas directas sin razonamiento visible                        |
| `normal`   | Profundidad de razonamiento estándar (predeterminado)             |
| `extended` | Razonamiento profundo para tareas complejas, muestra proceso de pensamiento más detallado |

Esto es típicamente configurado por extensiones cliente ACP (como Zed) a través del dropdown de configuración.

```bash
# Ejemplo: Usar razonamiento extendido para tareas complejas
AUTOHAND_THINKING_LEVEL=extended autohand --prompt "refactorizar este módulo"
```

---

## Configuración del Proveedor

### `provider`

Proveedor LLM activo a usar.

| Valor          | Descripción                        |
| -------------- | ---------------------------------- |
| `"openrouter"` | API de OpenRouter (predeterminado) |
| `"ollama"`     | Instancia local de Ollama          |
| `"llamacpp"`   | Servidor local de llama.cpp        |
| `"openai"`     | API de OpenAI directamente         |
| `"mlx"`        | MLX en Apple Silicon (local)       |
| `"llmgateway"` | API unificada LLM Gateway          |

### `openrouter`

Configuración del proveedor OpenRouter.

```json
{
  "openrouter": {
    "apiKey": "sk-or-v1-xxx",
    "baseUrl": "https://openrouter.ai/api/v1",
    "model": "your-modelcard-id-here"
  }
}
```

| Campo     | Tipo   | Requerido | Predeterminado                 | Descripción                                             |
| --------- | ------ | --------- | ------------------------------ | ------------------------------------------------------- |
| `apiKey`  | string | Sí        | -                              | Tu clave de API de OpenRouter                           |
| `baseUrl` | string | No        | `https://openrouter.ai/api/v1` | Endpoint de API                                         |
| `model`   | string | Sí        | -                              | Identificador del modelo (ej. `your-modelcard-id-here`) |

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

| Campo     | Tipo   | Requerido | Predeterminado           | Descripción                                     |
| --------- | ------ | --------- | ------------------------ | ----------------------------------------------- |
| `baseUrl` | string | No        | `http://localhost:11434` | URL del servidor Ollama                         |
| `port`    | number | No        | `11434`                  | Puerto del servidor (alternativa a baseUrl)     |
| `model`   | string | Sí        | -                        | Nombre del modelo (ej. `llama3.2`, `codellama`) |

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

| Campo     | Tipo   | Requerido | Predeterminado          | Descripción                |
| --------- | ------ | --------- | ----------------------- | -------------------------- |
| `baseUrl` | string | No        | `http://localhost:8080` | URL del servidor llama.cpp |
| `port`    | number | No        | `8080`                  | Puerto del servidor        |
| `model`   | string | Sí        | -                       | Identificador del modelo   |

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

| Campo     | Tipo   | Requerido | Predeterminado              | Descripción                                     |
| --------- | ------ | --------- | --------------------------- | ----------------------------------------------- |
| `apiKey`  | string | Sí        | -                           | Clave de API de OpenAI                          |
| `baseUrl` | string | No        | `https://api.openai.com/v1` | Endpoint de API                                 |
| `model`   | string | Sí        | -                           | Nombre del modelo (ej. `gpt-4o`, `gpt-4o-mini`) |

### `mlx`

Proveedor MLX para Macs Apple Silicon (inferencia local).

```json
{
  "mlx": {
    "baseUrl": "http://localhost:8080",
    "port": 8080,
    "model": "mlx-community/Llama-3.2-3B-Instruct-4bit"
  }
}
```

| Campo     | Tipo   | Requerido | Predeterminado          | Descripción                  |
| --------- | ------ | --------- | ----------------------- | ---------------------------- |
| `baseUrl` | string | No        | `http://localhost:8080` | URL del servidor MLX         |
| `port`    | number | No        | `8080`                  | Puerto del servidor          |
| `model`   | string | Sí        | -                       | Identificador del modelo MLX |

### `llmgateway`

Configuración de la API unificada LLM Gateway. Proporciona acceso a múltiples proveedores LLM a través de una única API.

```json
{
  "llmgateway": {
    "apiKey": "tu-api-key-llmgateway",
    "baseUrl": "https://api.llmgateway.io/v1",
    "model": "gpt-4o"
  }
}
```

| Campo     | Tipo   | Requerido | Predeterminado                 | Descripción                                               |
| --------- | ------ | --------- | ------------------------------ | --------------------------------------------------------- |
| `apiKey`  | string | Sí        | -                              | Clave de API de LLM Gateway                               |
| `baseUrl` | string | No        | `https://api.llmgateway.io/v1` | Endpoint de API                                           |
| `model`   | string | Sí        | -                              | Nombre del modelo (ej. `gpt-4o`, `claude-3-5-sonnet-20241022`) |

**Obtener una Clave de API:**
Visita [llmgateway.io/dashboard](https://llmgateway.io/dashboard) para crear una cuenta y obtener tu clave de API.

**Modelos Soportados:**
LLM Gateway soporta modelos de múltiples proveedores incluyendo:

- OpenAI: `gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo`
- Anthropic: `claude-3-5-sonnet-20241022`, `claude-3-5-haiku-20241022`
- Google: `gemini-1.5-pro`, `gemini-1.5-flash`

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

| Campo               | Tipo    | Predeterminado    | Descripción                                               |
| ------------------- | ------- | ----------------- | --------------------------------------------------------- |
| `defaultRoot`       | string  | Directorio actual | Espacio de trabajo predeterminado cuando no se especifica |
| `allowDangerousOps` | boolean | `false`           | Permitir operaciones destructivas sin confirmación        |

### Seguridad del Espacio de Trabajo

Autohand bloquea automáticamente operaciones en directorios peligrosos para prevenir daños accidentales:

- **Raíces del sistema de archivos** (`/`, `C:\`, `D:\`, etc.)
- **Directorios home** (`~`, `/Users/<user>`, `/home/<user>`, `C:\Users\<user>`)
- **Directorios del sistema** (`/etc`, `/var`, `/System`, `C:\Windows`, etc.)
- **Montajes WSL de Windows** (`/mnt/c`, `/mnt/c/Users/<user>`)

Esta verificación no puede ser ignorada. Si intentas ejecutar autohand en un directorio peligroso, verás un error y deberás especificar un directorio de proyecto seguro.

```bash
# Esto será bloqueado
cd ~ && autohand
# Error: Directorio de Espacio de Trabajo Inseguro

# Esto funciona
cd ~/proyectos/my-app && autohand
```

Ver [Seguridad del Espacio de Trabajo](./workspace-safety.md) para detalles completos.

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

| Campo                        | Tipo                  | Predeterminado | Descripción                                                                                                                 |
| ---------------------------- | --------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `theme`                      | `"dark"` \| `"light"` | `"dark"`       | Tema de color para salida de terminal                                                                                       |
| `autoConfirm`                | boolean               | `false`        | Omitir confirmaciones para operaciones seguras                                                                              |
| `readFileCharLimit`          | number                | `300`          | Máximo de caracteres mostrados en salida de herramientas de lectura/búsqueda (el contenido completo aún se envía al modelo) |
| `showCompletionNotification` | boolean               | `true`         | Mostrar notificación del sistema cuando la tarea termine                                                                    |
| `showThinking`               | boolean               | `true`         | Mostrar el razonamiento/proceso de pensamiento del LLM                                                                      |
| `useInkRenderer`             | boolean               | `false`        | Usar renderizador basado en Ink para UI sin parpadeo (experimental)                                                         |
| `terminalBell`               | boolean               | `true`         | Sonar campana del terminal cuando la tarea termine (muestra insignia en pestaña/dock del terminal)                          |
| `checkForUpdates`            | boolean               | `true`         | Verificar actualizaciones de CLI al iniciar                                                                                 |
| `updateCheckInterval`        | number                | `24`           | Horas entre verificaciones de actualización (usa resultado en caché dentro del intervalo)                                   |

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
    "enableRequestQueue": true,
    "debug": false
  }
}
```

| Campo                | Tipo    | Predeterminado | Descripción                                                                       |
| -------------------- | ------- | -------------- | --------------------------------------------------------------------------------- |
| `maxIterations`      | number  | `100`          | Máximo de iteraciones de herramientas por solicitud de usuario antes de detenerse |
| `enableRequestQueue` | boolean | `true`         | Permitir a usuarios escribir y encolar solicitudes mientras el agente trabaja     |
| `debug`              | boolean | `false`        | Habilitar output de debug detallado (logs del estado interno del agente a stderr) |

### Modo Debug

Habilita el modo debug para ver logging detallado del estado interno del agente (iteraciones del loop react, construcción de prompts, detalles de la sesión). El output va a stderr para no interferir con el output normal.

Tres formas de habilitar el modo debug (en orden de precedencia):

1. **Flag de CLI**: `autohand -d` o `autohand --debug`
2. **Variable de entorno**: `AUTOHAND_DEBUG=1`
3. **Archivo de configuración**: Establecer `agent.debug: true`

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

| Valor            | Descripción                                                     |
| ---------------- | --------------------------------------------------------------- |
| `"interactive"`  | Solicitar aprobación en operaciones peligrosas (predeterminado) |
| `"unrestricted"` | Sin solicitudes, permitir todo                                  |
| `"restricted"`   | Denegar todas las operaciones peligrosas                        |

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

| Campo     | Tipo                                | Descripción                                      |
| --------- | ----------------------------------- | ------------------------------------------------ |
| `tool`    | string                              | Nombre de herramienta a coincidir                |
| `pattern` | string                              | Patrón opcional para coincidir contra argumentos |
| `action`  | `"allow"` \| `"deny"` \| `"prompt"` | Acción a tomar                                   |

### `rememberSession`

| Tipo    | Predeterminado | Descripción                                      |
| ------- | -------------- | ------------------------------------------------ |
| boolean | `true`         | Recordar decisiones de aprobación para la sesión |

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

### Visualizando Permisos

Puedes ver tu configuración de permisos actual de dos formas:

**Flag de CLI (No interactivo):**

```bash
autohand --permissions
```

Esto muestra:

- Modo de permiso actual (interactive, unrestricted, restricted)
- Rutas del workspace y archivo de configuración
- Todos los patrones aprobados (whitelist)
- Todos los patrones denegados (blacklist)
- Estadísticas resumidas

**Comando Interactivo:**

```
/permissions
```

En modo interactivo, el comando `/permissions` proporciona la misma información más opciones para:

- Eliminar items de la whitelist
- Eliminar items de la blacklist
- Limpiar todos los permisos guardados

---

## Modo Patch

El modo patch permite generar un patch compatible con git sin modificar tus archivos de workspace. Esto es útil para:

- Revisión de código antes de aplicar cambios
- Compartir cambios generados por IA con miembros del equipo
- Crear conjuntos de cambios reproducibles
- Pipelines CI/CD que necesitan capturar cambios sin aplicarlos

### Uso

```bash
# Generar patch a stdout
autohand --prompt "agregar autenticación de usuario" --patch

# Guardar en archivo
autohand --prompt "agregar autenticación de usuario" --patch --output auth.patch

# Pipe a archivo (alternativa)
autohand --prompt "refactorizar handlers de api" --patch > refactor.patch
```

### Comportamiento

Cuando `--patch` se especifica:

- **Auto-confirmar**: Todos los prompts son automáticamente aceptados (`--yes` implícito)
- **Sin prompts**: No se muestran prompts de aprobación (`--unrestricted` implícito)
- **Solo vista previa**: Los cambios se capturan pero NO se escriben en disco
- **Seguridad aplicada**: Operaciones en la blacklist (`.env`, claves SSH, comandos peligrosos) aún son bloqueadas

### Aplicando Patches

Los destinatarios pueden aplicar el patch usando comandos git estándar:

```bash
# Verificar qué se aplicaría (dry-run)
git apply --check changes.patch

# Aplicar el patch
git apply changes.patch

# Aplicar con merge 3-way (maneja mejor conflictos)
git apply -3 changes.patch

# Aplicar y hacer stage de cambios
git apply --index changes.patch

# Revertir un patch
git apply -R changes.patch
```

### Formato del Patch

El patch generado sigue el formato diff unificado de git:

```diff
diff --git a/src/auth.ts b/src/auth.ts
new file mode 100644
--- /dev/null
+++ b/src/auth.ts
@@ -0,0 +1,15 @@
+export function authenticate(user: string, password: string) {
+  // Implementación aquí
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

### Códigos de Salida

| Código | Significado                                         |
| ------ | --------------------------------------------------- |
| `0`    | Éxito, patch generado                               |
| `1`    | Error (falta `--prompt`, permiso denegado, etc.)    |

### Combinando con Otras Flags

```bash
# Usar modelo específico
autohand --prompt "optimizar queries" --patch --model gpt-4o

# Especificar workspace
autohand --prompt "agregar tests" --patch --path ./mi-proyecto

# Usar configuración personalizada
autohand --prompt "refactorizar" --patch --config ~/.autohand/work.json
```

### Ejemplo de Flujo de Trabajo en Equipo

```bash
# Desarrollador A: Generar patch para una feature
autohand --prompt "implementar dashboard de usuario con gráficos" --patch --output dashboard.patch

# Compartir vía git (crear PR con solo el archivo patch)
git checkout -b patch/dashboard
git add dashboard.patch
git commit -m "Add dashboard feature patch"
git push

# Desarrollador B: Revisar y aplicar
git fetch origin patch/dashboard
git apply dashboard.patch
# Ejecutar tests, revisar código, luego hacer commit
git add -A && git commit -m "feat: add user dashboard with charts"
```

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

| Campo        | Tipo   | Predeterminado | Máx | Descripción                                            |
| ------------ | ------ | -------------- | --- | ------------------------------------------------------ |
| `maxRetries` | number | `3`            | `5` | Intentos de reintento para solicitudes de API fallidas |
| `timeout`    | number | `30000`        | -   | Tiempo de espera de solicitud en milisegundos          |
| `retryDelay` | number | `1000`         | -   | Retraso entre reintentos en milisegundos               |

---

## Configuración de Telemetría

La telemetría está **deshabilitada por defecto** (opt-in). Habilítala para ayudar a mejorar Autohand.

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

| Campo               | Tipo    | Predeterminado            | Descripción                                                   |
| ------------------- | ------- | ------------------------- | ------------------------------------------------------------- |
| `enabled`           | boolean | `false`                   | Habilitar/deshabilitar telemetría (opt-in)                    |
| `apiBaseUrl`        | string  | `https://api.autohand.ai` | Endpoint de API de telemetría                                 |
| `batchSize`         | number  | `20`                      | Número de eventos para agrupar antes del auto-flush           |
| `flushIntervalMs`   | number  | `60000`                   | Intervalo de flush en milisegundos (1 minuto)               |
| `maxQueueSize`      | number  | `500`                     | Tamaño máximo de la cola antes de descartar eventos antiguos  |
| `maxRetries`        | number  | `3`                       | Intentos de reintento para solicitudes de telemetría fallidas |
| `enableSessionSync` | boolean | `false`                   | Sincronizar sesiones a la nube para características de equipo |
| `companySecret`     | string  | `""`                      | Secreto de la empresa para autenticación de API               |

---

## Agentes Externos

Carga definiciones de agentes personalizados desde directorios externos.

```json
{
  "externalAgents": {
    "enabled": true,
    "paths": ["~/.autohand/agents", "/equipo/compartido/agents"]
  }
}
```

| Campo     | Tipo     | Predeterminado | Descripción                         |
| --------- | -------- | -------------- | ----------------------------------- |
| `enabled` | boolean  | `false`        | Habilitar carga de agentes externos |
| `paths`   | string[] | `[]`           | Directorios para cargar agentes     |

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

| Campo           | Tipo   | Predeterminado            | Descripción                                                |
| --------------- | ------ | ------------------------- | ---------------------------------------------------------- |
| `baseUrl`       | string | `https://api.autohand.ai` | Endpoint de API                                            |
| `companySecret` | string | -                         | Secreto de equipo/empresa para características compartidas |

También se puede configurar mediante variables de entorno:

- `AUTOHAND_API_URL` → `api.baseUrl`
- `AUTOHAND_SECRET` → `api.companySecret`

---

## Configuración de Autenticación

Configuración de autenticación para recursos protegidos.

```json
{
  "auth": {
    "token": "tu-token-de-autenticación",
    "refreshToken": "tu-refresh-token",
    "expiresAt": "2024-12-31T23:59:59Z"
  }
}
```

| Campo          | Tipo   | Requerido | Descripción                                    |
| -------------- | ------ | ----------- | ---------------------------------------------- |
| `token`        | string | Sí          | Token de acceso actual                         |
| `refreshToken` | string | No          | Token para renovar el token de acceso          |
| `expiresAt`    | string | No          | Fecha/hora de expiración del token (ISO)       |

---

## Configuración de Skills Comunitarios

Configuraciones para el registro de skills comunitarios.

```json
{
  "communitySkills": {
    "registryUrl": "https://skills.autohand.ai",
    "cacheDuration": 3600,
    "autoUpdate": false
  }
}
```

| Campo           | Tipo    | Predeterminado               | Descripción                                           |
| --------------- | ------- | ------------------------------ | ----------------------------------------------------- |
| `registryUrl`   | string  | `https://skills.autohand.ai` | URL base del registro de skills                       |
| `cacheDuration` | number  | `3600`                         | Duración del caché en segundos                        |
| `autoUpdate`    | boolean | `false`                        | Actualizar skills automáticamente cuando estén obsoletos |

---

## Configuración de Compartir

Controla cómo se comparten sesiones y workspaces.

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

| Campo               | Tipo    | Predeterminado | Descripción                                           |
| ------------------- | ------- | -------------- | ----------------------------------------------------- |
| `enabled`           | boolean | `true`         | Habilitar características de compartir                |
| `defaultVisibility` | string  | `"private"`    | Visibilidad por defecto: `private`, `team`, `public`  |
| `allowPublicLinks`  | boolean | `false`        | Permitir creación de enlaces públicos               |
| `requireApproval`   | boolean | `true`         | Requerir aprobación antes de compartir              |

---

## Sincronización de Configuraciones

Sincroniza tus configuraciones entre dispositivos.

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

| Campo                | Tipo    | Predeterminado | Descripción                                              |
| -------------------- | ------- | -------------- | -------------------------------------------------------- |
| `enabled`            | boolean | `false`        | Habilitar sincronización de configuraciones            |
| `autoSync`           | boolean | `true`         | Sincronizar automáticamente cuando haya cambios          |
| `syncInterval`       | number  | `300`          | Intervalo de sincronización en segundos                  |
| `conflictResolution` | string  | `"ask"`        | Cómo resolver conflictos: `ask`, `local`, `remote`       |

---

## Configuración de Hooks

Configura hooks personalizados para eventos de Autohand.

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

| Campo         | Tipo   | Descripción                                           |
| ------------- | ------ | ----------------------------------------------------- |
| `preCommand`  | string | Script ejecutado antes de cada comando                |
| `postCommand` | string | Script ejecutado después de cada comando              |
| `onError`     | string | Script ejecutado cuando ocurre un error               |
| `onComplete`  | string | Script ejecutado cuando una tarea se completa         |

Variables de entorno disponibles en los hooks:

- `AUTOHAND_HOOK_TYPE` - Tipo del hook (`preCommand`, `postCommand`, etc.)
- `AUTOHAND_COMMAND` - Comando siendo ejecutado
- `AUTOHAND_EXIT_CODE` - Código de salida (solo `postCommand` y `onError`)
- `AUTOHAND_SESSION_ID` - ID de la sesión actual

---

## Configuración de MCP

Configuración del Model Context Protocol (MCP) para integración con servidores de herramientas.

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

| Campo     | Tipo   | Descripción                                           |
| --------- | ------ | ----------------------------------------------------- |
| `command` | string | Comando para iniciar el servidor MCP                  |
| `args`    | array  | Argumentos para el comando                             |
| `env`     | object | Variables de entorno adicionales                       |

Los servidores MCP proporcionan herramientas adicionales que pueden ser llamadas por el agente. Cada servidor es identificado por un nombre único e iniciado automáticamente cuando sea necesario.

---

## Configuración de Extensión de Chrome

Configuraciones para la extensión de Chrome de Autohand.

```json
{
  "chrome": {
    "extensionId": "tu-extension-id",
    "nativeMessaging": true,
    "autoLaunch": false,
    "preferredBrowser": "chrome"
  }
}
```

| Campo              | Tipo    | Predeterminado | Descripción                                           |
| ------------------ | ------- | -------------- | ----------------------------------------------------- |
| `extensionId`      | string  | -              | ID de la extensión Chrome instalada                   |
| `nativeMessaging`  | boolean | `true`         | Habilitar comunicación vía native messaging           |
| `autoLaunch`       | boolean | `false`        | Abrir Chrome automáticamente al iniciar               |
| `preferredBrowser` | string  | `"chrome"`     | Navegador preferido: `chrome`, `chromium`, `edge`, `brave` |

La extensión Chrome permite interacción con páginas web y automatización de browser. El native messaging permite comunicación bidireccional entre la CLI y la extensión.

---

## Sistema de Skills

Los skills son paquetes de instrucciones que proporcionan instrucciones especializadas al agente de IA. Funcionan como archivos `AGENTS.md` bajo demanda que pueden ser activados para tareas específicas.

### Ubicaciones de Descubrimiento de Skills

Los skills son descubiertos desde múltiples ubicaciones, con fuentes posteriores teniendo precedencia:

| Ubicación                               | ID de Fuente       | Descripción                              |
| --------------------------------------- | ------------------ | ---------------------------------------- |
| `~/.codex/skills/**/SKILL.md`           | `codex-user`       | Skills de usuario Codex (recursivo)      |
| `~/.claude/skills/*/SKILL.md`           | `claude-user`      | Skills de usuario Claude (un nivel)      |
| `~/.autohand/skills/**/SKILL.md`       | `autohand-user`    | Skills de usuario Autohand (recursivo)   |
| `<proyecto>/.claude/skills/*/SKILL.md`  | `claude-project`   | Skills de proyecto Claude (un nivel)     |
| `<proyecto>/.autohand/skills/**/SKILL.md` | `autohand-project` | Skills de proyecto Autohand (recursivo)  |

### Comportamiento de Auto-Copia

Los skills descubiertos desde ubicaciones Codex o Claude son automáticamente copiados a la ubicación Autohand correspondiente:

- `~/.codex/skills/` y `~/.claude/skills/` → `~/.autohand/skills/`
- `<proyecto>/.claude/skills/` → `<proyecto>/.autohand/skills/`

Los skills existentes en ubicaciones Autohand nunca son sobrescritos.

### Formato SKILL.md

Los skills usan frontmatter YAML seguido de contenido markdown:

```markdown
---
name: my-skill-name
description: Breve descripción del skill
license: MIT
compatibility: Funciona con Node.js 18+
allowed-tools: read_file write_file run_command
metadata:
  author: your-name
  version: "1.0.0"
---

# My Skill

Instrucciones detalladas para el agente de IA...
```

| Campo           | Requerido | Tamaño Máx | Descripción                                      |
| --------------- | --------- | ---------- | ------------------------------------------------ |
| `name`          | Sí        | 64 chars   | Alfanumérico minúsculo con guiones solo          |
| `description`   | Sí        | 1024 chars | Breve descripción del skill                      |
| `license`       | No        | -          | Identificador de licencia (ej. MIT, Apache-2.0)   |
| `compatibility` | No        | 500 chars  | Notas de compatibilidad                          |
| `allowed-tools` | No        | -          | Lista separada por espacios de herramientas permitidas |
| `metadata`      | No        | -          | Metadatos adicionales clave-valor                |

### Prefijos de Entrada

Autohand soporta prefijos especiales en la entrada del prompt:

| Prefijo | Descripción                    | Ejemplo                            |
| ------- | ------------------------------ | ---------------------------------- |
| `/`     | Comandos slash                 | `/help`, `/model`, `/quit`         |
| `@`     | Menciones de archivo (autocompletar) | `@src/index.ts`              |
| `$`     | Menciones de skill (autocompletar) | `$frontend-design`, `$code-review` |
| `!`     | Ejecutar comandos de terminal directamente | `! git status`, `! ls -la` |

**Menciones de Skills (`$`):**

- Escribe `$` seguido de caracteres para ver skills disponibles con autocompletar
- Tab acepta la sugerencia principal (ej. `$frontend-design`)
- Los skills son descubiertos de `~/.autohand/skills/` y `<proyecto>/.autohand/skills/`
- Los skills activados son anexados al prompt como instrucciones especiales para la sesión actual
- El panel de preview muestra metadatos del skill (nombre, descripción, estado de activación)

**Comandos Shell (`!`):**

- Los comandos se ejecutan en tu directorio de trabajo actual
- El output se muestra directamente en el terminal
- No va al LLM
- Timeout de 30 segundos
- Retorna al prompt después de la ejecución

### Comandos Slash

#### `/skills` — Gestor de Paquetes

| Comando                         | Descripción                                  |
| ------------------------------- | -------------------------------------------- |
| `/skills`                       | Listar todos los skills disponibles          |
| `/skills use <nombre>`          | Activar un skill para la sesión actual       |
| `/skills deactivate <nombre>`   | Desactivar un skill                          |
| `/skills info <nombre>`         | Mostrar información detallada del skill      |
| `/skills install`               | Explorar e instalar del registro comunitario |
| `/skills install @<slug>`       | Instalar un skill comunitario por slug       |
| `/skills search <consulta>`     | Buscar en el registro de skills comunitarios |
| `/skills trending`              | Mostrar skills comunitarios en tendencia     |
| `/skills remove <slug>`         | Desinstalar un skill comunitario             |
| `/skills new`                   | Crear un nuevo skill interactivamente        |
| `/skills feedback <slug> <1-5>` | Calificar un skill comunitario               |

#### `/learn` — Asesor de Skills con LLM

| Comando         | Descripción                                                                      |
| --------------- | -------------------------------------------------------------------------------- |
| `/learn`        | Analizar proyecto y recomendar skills (escaneo rápido)                           |
| `/learn deep`   | Escaneo profundo del proyecto (lee archivos fuente) para resultados más precisos |
| `/learn update` | Re-analizar proyecto y regenerar skills LLM generados obsoletos                  |

`/learn` utiliza un flujo LLM de dos fases:

1. **Fase 1 — Análisis + Ranking + Auditoría**: Escanea la estructura del proyecto, audita skills instalados buscando redundancias/conflictos, y clasifica skills comunitarios por relevancia (0-100).
2. **Fase 2 — Generación** (condicional): Si ningún skill comunitario obtiene más de 60 puntos, ofrece generar un skill personalizado adaptado a su proyecto.

Los skills generados incluyen metadatos (`agentskill-source: llm-generated`, `agentskill-project-hash`) para que `/learn update` pueda detectar cambios en el código y regenerar skills obsoletos.

### Generación Automática de Skills (`--auto-skill`)

El flag `--auto-skill` genera skills sin el flujo interactivo del asesor:

```bash
autohand --auto-skill
```

Esto hará:

1. Analizar la estructura del proyecto (package.json, requirements.txt, etc.)
2. Detectar lenguajes, frameworks y patrones
3. Generar 3 skills relevantes usando LLM
4. Guardar skills en `<proyecto>/.autohand/skills/`

Para una experiencia interactiva más precisa, use `/learn` dentro de una sesión.

---

## Ejemplo Completo

### Formato JSON (`~/.autohand/config.json`)

```json
{
  "provider": "openrouter",
  "openrouter": {
    "apiKey": "sk-or-v1-tu-clave-aqui",
    "baseUrl": "https://openrouter.ai/api/v1",
    "model": "your-modelcard-id-here"
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
    "token": "tu-token-de-autenticación",
    "refreshToken": "tu-refresh-token"
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
  apiKey: sk-or-v1-tu-clave-aqui
  baseUrl: https://openrouter.ai/api/v1
  model: your-modelcard-id-here

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
  token: tu-token-de-autenticación
  refreshToken: tu-refresh-token

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

| Flag                          | Descripción                                                                                        |
| ----------------------------- | -------------------------------------------------------------------------------------------------- |
| `--model <modelo>`            | Sobrescribir modelo                                                                                |
| `--path <ruta>`               | Sobrescribir raíz del espacio de trabajo                                                           |
| `--worktree [nombre]`         | Ejecutar sesión en un git worktree aislado (nombre opcional de worktree/rama)                      |
| `--tmux`                      | Iniciar en una sesión tmux dedicada (implica `--worktree`; no se puede usar con `--no-worktree`)   |
| `--add-dir <ruta>`            | Agregar directorios adicionales al alcance del espacio de trabajo (se puede usar múltiples veces)  |
| `--config <ruta>`             | Usar archivo de configuración personalizado                                                        |
| `--temperature <n>`           | Establecer temperatura (0-1)                                                                       |
| `--yes`                       | Auto-confirmar solicitudes                                                                         |
| `--dry-run`                   | Vista previa sin ejecutar                                                                          |
| `--unrestricted`              | Sin solicitudes de aprobación                                                                      |
| `--restricted`                | Denegar operaciones peligrosas                                                                     |
| `--auto-skill`                | Auto-generar skills basado en análisis del proyecto (ver también `/learn` para asesor interactivo) |
| `--setup`                     | Ejecutar el asistente de configuración para configurar o reconfigurar Autohand                     |
| `--about`                     | Mostrar información sobre Autohand (versión, enlaces, información de contribución)                 |
| `--sys-prompt <valor>`        | Reemplazar completamente el prompt del sistema (cadena en línea o ruta de archivo)                 |
| `--append-sys-prompt <valor>` | Añadir al prompt del sistema (cadena en línea o ruta de archivo)                                   |

---

## Personalización del Prompt del Sistema

Autohand permite personalizar el prompt del sistema utilizado por el agente de IA. Esto es útil para flujos de trabajo especializados, instrucciones personalizadas o integración con otros sistemas.

### Flags de CLI

| Flag                          | Descripción                                           |
| ----------------------------- | ----------------------------------------------------- |
| `--sys-prompt <valor>`        | Reemplazar completamente el prompt del sistema        |
| `--append-sys-prompt <valor>` | Añadir contenido al prompt del sistema predeterminado |

Ambos flags aceptan:

- **Cadena en línea**: Contenido de texto directo
- **Ruta de archivo**: Ruta a un archivo que contiene el prompt (auto-detectado)

### Detección de Ruta de Archivo

Un valor se trata como ruta de archivo si:

- Comienza con `./`, `../`, `/`, o `~/`
- Comienza con una letra de unidad de Windows (ej., `C:\`)
- Termina con `.txt`, `.md`, o `.prompt`
- Contiene separadores de ruta sin espacios

De lo contrario, se trata como cadena en línea.

### `--sys-prompt` (Reemplazo Completo)

Cuando se proporciona, **reemplaza completamente** el prompt del sistema predeterminado. El agente NO cargará:

- Instrucciones predeterminadas de Autohand
- Instrucciones del proyecto AGENTS.md
- Memorias de usuario/proyecto
- Skills activas

```bash
# Cadena en línea
autohand --sys-prompt "Eres un experto en Python. Sé conciso." --prompt "Escribe hello world"

# Desde archivo
autohand --sys-prompt ./prompt-personalizado.txt --prompt "Explica este código"
```

### `--append-sys-prompt` (Añadir al Predeterminado)

Cuando se proporciona, **añade** contenido al prompt del sistema predeterminado completo. El agente seguirá cargando todas las instrucciones predeterminadas.

```bash
# Cadena en línea
autohand --append-sys-prompt "Siempre usa TypeScript en lugar de JavaScript" --prompt "Crea una función"

# Desde archivo
autohand --append-sys-prompt ./guias-equipo.md --prompt "Añade manejo de errores"
```

### Precedencia

Cuando se proporcionan ambos flags:

1. `--sys-prompt` tiene precedencia total
2. `--append-sys-prompt` se ignora

---

## Soporte Multi-Directorio

Autohand puede trabajar con múltiples directorios más allá del espacio de trabajo principal. Esto es útil cuando tu proyecto tiene dependencias, bibliotecas compartidas o proyectos relacionados en diferentes directorios.

### Flag de CLI

Usa `--add-dir` para agregar directorios adicionales (se puede usar múltiples veces):

```bash
# Agregar un solo directorio adicional
autohand --add-dir /ruta/a/lib-compartida

# Agregar múltiples directorios
autohand --add-dir /ruta/a/lib1 --add-dir /ruta/a/lib2

# Con modo sin restricciones (auto-aprobar escrituras en todos los directorios)
autohand --add-dir /ruta/a/lib-compartida --unrestricted
```

### Comando Interactivo

Usa `/add-dir` durante una sesión interactiva:

```
/add-dir              # Mostrar directorios actuales
/add-dir /ruta/al/dir # Agregar un nuevo directorio
```

### Restricciones de Seguridad

Los siguientes directorios no pueden agregarse:

- Directorio home (`~` o `$HOME`)
- Directorio raíz (`/`)
- Directorios del sistema (`/etc`, `/var`, `/usr`, `/bin`, `/sbin`)
- Directorios del sistema Windows (`C:\Windows`, `C:\Program Files`)
- Directorios de usuario Windows (`C:\Users\username`)
- Montajes WSL de Windows (`/mnt/c`, `/mnt/c/Windows`)
