# Autohand 설정 참조

`~/.autohand/config.json` (또는 `.yaml`/`.yml`)의 모든 설정 옵션에 대한 완전한 참조 문서입니다.

## 목차

- [설정 파일 위치](#설정-파일-위치)
- [환경 변수](#환경-변수)
- [프로바이더 설정](#프로바이더-설정)
- [워크스페이스 설정](#워크스페이스-설정)
- [UI 설정](#ui-설정)
- [에이전트 설정](#에이전트-설정)
- [권한 설정](#권한-설정)
- [네트워크 설정](#네트워크-설정)
- [텔레메트리 설정](#텔레메트리-설정)
- [외부 에이전트](#외부-에이전트)
- [API 설정](#api-설정)
- [전체 예제](#전체-예제)

---

## 설정 파일 위치

Autohand는 다음 순서로 설정을 찾습니다:

1. `AUTOHAND_CONFIG` 환경 변수 (사용자 지정 경로)
2. `~/.autohand/config.yaml`
3. `~/.autohand/config.yml`
4. `~/.autohand/config.json` (기본값)

기본 디렉토리를 변경할 수도 있습니다:
```bash
export AUTOHAND_HOME=/custom/path  # ~/.autohand를 /custom/path로 변경
```

---

## 환경 변수

| 변수 | 설명 | 예시 |
|------|------|------|
| `AUTOHAND_HOME` | 모든 Autohand 데이터의 기본 디렉토리 | `/custom/path` |
| `AUTOHAND_CONFIG` | 사용자 지정 설정 파일 경로 | `/path/to/config.json` |
| `AUTOHAND_API_URL` | API 엔드포인트 (설정 덮어쓰기) | `https://api.autohand.ai` |
| `AUTOHAND_SECRET` | 회사/팀 비밀 키 | `sk-xxx` |

---

## 프로바이더 설정

### `provider`
사용할 활성 LLM 프로바이더입니다.

| 값 | 설명 |
|----|------|
| `"openrouter"` | OpenRouter API (기본값) |
| `"ollama"` | 로컬 Ollama 인스턴스 |
| `"llamacpp"` | 로컬 llama.cpp 서버 |
| `"openai"` | OpenAI API 직접 사용 |

### `openrouter`
OpenRouter 프로바이더 설정입니다.

```json
{
  "openrouter": {
    "apiKey": "sk-or-v1-xxx",
    "baseUrl": "https://openrouter.ai/api/v1",
    "model": "anthropic/claude-sonnet-4"
  }
}
```

| 필드 | 타입 | 필수 | 기본값 | 설명 |
|------|------|------|--------|------|
| `apiKey` | string | 예 | - | OpenRouter API 키 |
| `baseUrl` | string | 아니오 | `https://openrouter.ai/api/v1` | API 엔드포인트 |
| `model` | string | 예 | - | 모델 식별자 (예: `anthropic/claude-sonnet-4`) |

### `ollama`
Ollama 프로바이더 설정입니다.

```json
{
  "ollama": {
    "baseUrl": "http://localhost:11434",
    "port": 11434,
    "model": "llama3.2"
  }
}
```

| 필드 | 타입 | 필수 | 기본값 | 설명 |
|------|------|------|--------|------|
| `baseUrl` | string | 아니오 | `http://localhost:11434` | Ollama 서버 URL |
| `port` | number | 아니오 | `11434` | 서버 포트 (baseUrl 대안) |
| `model` | string | 예 | - | 모델 이름 (예: `llama3.2`, `codellama`) |

### `llamacpp`
llama.cpp 서버 설정입니다.

```json
{
  "llamacpp": {
    "baseUrl": "http://localhost:8080",
    "port": 8080,
    "model": "default"
  }
}
```

| 필드 | 타입 | 필수 | 기본값 | 설명 |
|------|------|------|--------|------|
| `baseUrl` | string | 아니오 | `http://localhost:8080` | llama.cpp 서버 URL |
| `port` | number | 아니오 | `8080` | 서버 포트 |
| `model` | string | 예 | - | 모델 식별자 |

### `openai`
OpenAI API 설정입니다.

```json
{
  "openai": {
    "apiKey": "sk-xxx",
    "baseUrl": "https://api.openai.com/v1",
    "model": "gpt-4o"
  }
}
```

| 필드 | 타입 | 필수 | 기본값 | 설명 |
|------|------|------|--------|------|
| `apiKey` | string | 예 | - | OpenAI API 키 |
| `baseUrl` | string | 아니오 | `https://api.openai.com/v1` | API 엔드포인트 |
| `model` | string | 예 | - | 모델 이름 (예: `gpt-4o`, `gpt-4o-mini`) |

---

## 워크스페이스 설정

```json
{
  "workspace": {
    "defaultRoot": "/path/to/projects",
    "allowDangerousOps": false
  }
}
```

| 필드 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `defaultRoot` | string | 현재 디렉토리 | 지정되지 않은 경우 기본 워크스페이스 |
| `allowDangerousOps` | boolean | `false` | 확인 없이 파괴적 작업 허용 |

---

## UI 설정

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

| 필드 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `theme` | `"dark"` \| `"light"` | `"dark"` | 터미널 출력 색상 테마 |
| `autoConfirm` | boolean | `false` | 안전한 작업에 대한 확인 프롬프트 건너뛰기 |
| `readFileCharLimit` | number | `300` | 읽기/검색 도구 출력에서 표시할 최대 문자 수 (전체 내용은 여전히 모델에 전송됨) |
| `showCompletionNotification` | boolean | `true` | 작업 완료 시 시스템 알림 표시 |
| `showThinking` | boolean | `true` | LLM의 추론/사고 과정 표시 |
| `useInkRenderer` | boolean | `false` | 깜빡임 없는 UI를 위한 Ink 기반 렌더러 사용 (실험적) |
| `terminalBell` | boolean | `true` | 작업 완료 시 터미널 벨 울림 (터미널 탭/독에 배지 표시) |
| `checkForUpdates` | boolean | `true` | 시작 시 CLI 업데이트 확인 |
| `updateCheckInterval` | number | `24` | 업데이트 확인 간격 시간 (간격 내에서 캐시된 결과 사용) |

참고: `readFileCharLimit`은 `read_file`, `search`, `search_with_context`의 터미널 표시에만 영향을 줍니다. 전체 내용은 여전히 모델에 전송되고 도구 메시지에 저장됩니다.

### 터미널 벨

`terminalBell`이 활성화되면 (기본값), Autohand는 작업 완료 시 터미널 벨 (`\x07`)을 울립니다. 이것은 다음을 트리거합니다:

- **터미널 탭 배지** - 작업 완료를 나타내는 시각적 표시기
- **독 아이콘 바운스** - 터미널이 백그라운드에 있을 때 주의 끌기 (macOS)
- **소리** - 터미널 설정에서 소리가 활성화된 경우

비활성화하려면:
```json
{
  "ui": {
    "terminalBell": false
  }
}
```

### Ink 렌더러 (실험적)

`useInkRenderer`가 활성화되면, Autohand는 전통적인 ora 스피너 대신 React 기반 터미널 렌더링 (Ink)을 사용합니다. 이것은 다음을 제공합니다:

- **깜빡임 없는 출력**: 모든 UI 업데이트가 React 조정을 통해 배치됨
- **작업 큐 기능**: 에이전트가 작업하는 동안 명령어 입력
- **더 나은 입력 처리**: readline 핸들러 간 충돌 없음
- **조합 가능한 UI**: 향후 고급 UI 기능의 기반

활성화하려면:
```json
{
  "ui": {
    "useInkRenderer": true
  }
}
```

참고: 이 기능은 실험적이며 일부 예외 케이스가 있을 수 있습니다. 기본 ora 기반 UI는 안정적이고 완전히 기능합니다.

### 업데이트 확인

`checkForUpdates`가 활성화되면 (기본값), Autohand는 시작 시 새 릴리스를 확인합니다:

```
> Autohand v0.6.8 (abc1234) ✓ Up to date
```

업데이트가 있으면:
```
> Autohand v0.6.7 (abc1234) ⬆ Update available: v0.6.8
  ↳ Run: curl -fsSL https://autohand.ai/install.sh | sh
```

비활성화하려면:
```json
{
  "ui": {
    "checkForUpdates": false
  }
}
```

또는 환경 변수로:
```bash
export AUTOHAND_SKIP_UPDATE_CHECK=1
```

---

## 에이전트 설정

에이전트 동작 및 반복 제한을 제어합니다.

```json
{
  "agent": {
    "maxIterations": 100,
    "enableRequestQueue": true
  }
}
```

| 필드 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `maxIterations` | number | `100` | 중지하기 전 사용자 요청당 최대 도구 반복 횟수 |
| `enableRequestQueue` | boolean | `true` | 에이전트 작업 중 요청 입력 및 대기열 허용 |

### 요청 대기열

`enableRequestQueue`가 활성화되면, 에이전트가 이전 요청을 처리하는 동안 계속 메시지를 입력할 수 있습니다. 입력은 자동으로 대기열에 추가되고 현재 작업이 완료되면 처리됩니다.

- 메시지를 입력하고 Enter를 눌러 대기열에 추가
- 상태 줄에 대기 중인 요청 수 표시
- 요청은 FIFO (선입선출) 순서로 처리됨
- 최대 대기열 크기는 10개 요청

---

## 권한 설정

도구 권한에 대한 세밀한 제어입니다.

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

| 값 | 설명 |
|----|------|
| `"interactive"` | 위험한 작업에 대해 승인 요청 (기본값) |
| `"unrestricted"` | 프롬프트 없음, 모두 허용 |
| `"restricted"` | 모든 위험한 작업 거부 |

### `whitelist`
승인이 필요 없는 도구 패턴 배열입니다.

```json
["run_command:npm *", "run_command:bun test"]
```

### `blacklist`
항상 차단되는 도구 패턴 배열입니다.

```json
["run_command:rm -rf /", "run_command:sudo *"]
```

### `rules`
세밀한 권한 규칙입니다.

| 필드 | 타입 | 설명 |
|------|------|------|
| `tool` | string | 일치시킬 도구 이름 |
| `pattern` | string | 인수와 일치시킬 선택적 패턴 |
| `action` | `"allow"` \| `"deny"` \| `"prompt"` | 취할 조치 |

### `rememberSession`
| 타입 | 기본값 | 설명 |
|------|--------|------|
| boolean | `true` | 세션 동안 승인 결정 기억 |

### 로컬 프로젝트 권한

각 프로젝트는 전역 설정을 덮어쓰는 자체 권한 설정을 가질 수 있습니다. 이는 프로젝트 루트의 `.autohand/settings.local.json`에 저장됩니다.

파일 작업 (편집, 쓰기, 삭제)을 승인하면 이 파일에 자동으로 저장되어 동일한 프로젝트에서 같은 작업에 대해 다시 묻지 않습니다.

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

**작동 방식:**
- 작업을 승인하면 `.autohand/settings.local.json`에 저장됨
- 다음 번에 동일한 작업이 자동 승인됨
- 로컬 프로젝트 설정은 전역 설정과 병합됨 (로컬이 우선)
- `.autohand/settings.local.json`을 `.gitignore`에 추가하여 개인 설정 비공개 유지

**패턴 형식:**
- `도구_이름:경로` - 파일 작업용 (예: `multi_file_edit:src/file.ts`)
- `도구_이름:명령 인수` - 명령어용 (예: `run_command:npm test`)

---

## 네트워크 설정

```json
{
  "network": {
    "maxRetries": 3,
    "timeout": 30000,
    "retryDelay": 1000
  }
}
```

| 필드 | 타입 | 기본값 | 최대 | 설명 |
|------|------|--------|------|------|
| `maxRetries` | number | `3` | `5` | 실패한 API 요청에 대한 재시도 횟수 |
| `timeout` | number | `30000` | - | 요청 타임아웃 (밀리초) |
| `retryDelay` | number | `1000` | - | 재시도 간 지연 시간 (밀리초) |

---

## 텔레메트리 설정

텔레메트리는 **기본적으로 비활성화**되어 있습니다 (옵트인). Autohand 개선을 위해 활성화하세요.

```json
{
  "telemetry": {
    "enabled": false,
    "apiBaseUrl": "https://api.autohand.ai",
    "enableSessionSync": false
  }
}
```

| 필드 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `enabled` | boolean | `false` | 텔레메트리 활성화/비활성화 (옵트인) |
| `apiBaseUrl` | string | `https://api.autohand.ai` | 텔레메트리 API 엔드포인트 |
| `enableSessionSync` | boolean | `false` | 팀 기능을 위해 세션을 클라우드에 동기화 |

---

## 외부 에이전트

외부 디렉토리에서 사용자 지정 에이전트 정의를 로드합니다.

```json
{
  "externalAgents": {
    "enabled": true,
    "paths": [
      "~/.autohand/agents",
      "/team/shared/agents"
    ]
  }
}
```

| 필드 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `enabled` | boolean | `false` | 외부 에이전트 로딩 활성화 |
| `paths` | string[] | `[]` | 에이전트를 로드할 디렉토리 |

---

## API 설정

팀 기능을 위한 백엔드 API 설정입니다.

```json
{
  "api": {
    "baseUrl": "https://api.autohand.ai",
    "companySecret": "sk-team-xxx"
  }
}
```

| 필드 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `baseUrl` | string | `https://api.autohand.ai` | API 엔드포인트 |
| `companySecret` | string | - | 공유 기능을 위한 팀/회사 비밀 |

환경 변수로도 설정 가능:
- `AUTOHAND_API_URL` → `api.baseUrl`
- `AUTOHAND_SECRET` → `api.companySecret`

---

## 전체 예제

### JSON 형식 (`~/.autohand/config.json`)

```json
{
  "provider": "openrouter",
  "openrouter": {
    "apiKey": "sk-or-v1-your-key-here",
    "baseUrl": "https://openrouter.ai/api/v1",
    "model": "anthropic/claude-sonnet-4"
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

### YAML 형식 (`~/.autohand/config.yaml`)

```yaml
provider: openrouter

openrouter:
  apiKey: sk-or-v1-your-key-here
  baseUrl: https://openrouter.ai/api/v1
  model: anthropic/claude-sonnet-4

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

## 디렉토리 구조

Autohand는 `~/.autohand/` (또는 `$AUTOHAND_HOME`)에 데이터를 저장합니다:

```
~/.autohand/
├── config.json          # 기본 설정
├── config.yaml          # 대체 YAML 설정
├── device-id            # 고유 장치 식별자
├── error.log            # 에러 로그
├── feedback.log         # 피드백 제출
├── sessions/            # 세션 기록
├── projects/            # 프로젝트 지식 베이스
├── memory/              # 사용자 수준 메모리
├── commands/            # 사용자 지정 명령어
├── agents/              # 에이전트 정의
├── tools/               # 사용자 지정 메타 도구
├── feedback/            # 피드백 상태
└── telemetry/           # 텔레메트리 데이터
    ├── queue.json
    └── session-sync-queue.json
```

**프로젝트 수준 디렉토리** (워크스페이스 루트에서):

```
<project>/.autohand/
├── settings.local.json  # 로컬 프로젝트 권한 (gitignore에 추가)
├── memory/              # 프로젝트 특정 메모리
└── skills/              # 프로젝트 특정 스킬
```

---

## CLI 플래그 (설정 덮어쓰기)

다음 플래그는 설정 파일 설정을 덮어씁니다:

| 플래그 | 설명 |
|--------|------|
| `--model <model>` | 모델 덮어쓰기 |
| `--path <path>` | 워크스페이스 루트 덮어쓰기 |
| `--config <path>` | 사용자 지정 설정 파일 사용 |
| `--temperature <n>` | 온도 설정 (0-1) |
| `--yes` | 프롬프트 자동 확인 |
| `--dry-run` | 실행 없이 미리보기 |
| `--unrestricted` | 승인 프롬프트 없음 |
| `--restricted` | 위험한 작업 거부 |
| `--setup` | 설정 마법사를 실행하여 Autohand 설정 또는 재설정 |
