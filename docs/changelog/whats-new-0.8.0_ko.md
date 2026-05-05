# Autohand 0.8.0 새로운 기능

Autohand 0.8.0은 조합 가능한 Unix 워크플로를 위한 파이프 모드, 확장 사고 제어, 세분화된 자동 승인(yolo 모드), MCP 클라이언트 지원, IDE 통합, 계획 모드 등을 포함하는 주요 릴리스입니다. 이 문서에서는 이번 릴리스에 포함된 모든 새로운 기능과 개선 사항을 다룹니다.

## 목차

- [파이프 모드](#파이프-모드)
- [확장 사고](#확장-사고)
- [세션 기록](#세션-기록)
- [세분화된 자동 승인 (Yolo 모드)](#세분화된-자동-승인-yolo-모드)
- [MCP 클라이언트 지원](#mcp-클라이언트-지원)
- [IDE 통합](#ide-통합)
- [Homebrew 설치](#homebrew-설치)
- [계획 모드](#계획-모드)
- [Web Repo 도구](#web-repo-도구)
- [자동 컨텍스트 압축](#자동-컨텍스트-압축)
- [사용자 정의 시스템 프롬프트](#사용자-정의-시스템-프롬프트)
- [새로운 CLI 플래그](#새로운-cli-플래그)
- [새로운 슬래시 명령어](#새로운-슬래시-명령어)
- [아키텍처 개선](#아키텍처-개선)
- [업그레이드 방법](#업그레이드-방법)

---

## 파이프 모드

Autohand는 이제 Unix 파이프라인의 일부로 원활하게 동작합니다. stdin이 TTY가 아닌 경우, Autohand는 **파이프 모드**로 진입합니다. 이는 조합 가능한 워크플로를 위해 설계된 비대화형 실행 경로입니다.

### 작동 방식

파이프 모드는 파이프된 콘텐츠를 사용자의 지시와 함께 LLM에 전송합니다. 최종 결과는 stdout에 기록되고, 오류와 진행 상황은 stderr로 전송됩니다. 이를 통해 다운스트림 소비자를 위해 출력 스트림이 깨끗하게 유지됩니다.

```bash
# diff 설명하기
git diff | autohand 'explain these changes'

# 파일에서 코드 리뷰하기
cat src/auth.ts | autohand 'review this code for security issues'

# 여러 도구 연결하기
git log --oneline -10 | autohand 'summarize recent changes' > changelog.txt
```

### 출력 라우팅

| 스트림 | 내용 |
|--------|------|
| **stdout** | 최종 결과만 (다운스트림 파이프에서 소비) |
| **stderr** | 오류 및 선택적 진행 메시지 |

### JSON 출력

프로그래밍 방식 소비에 이상적인 구조화된 ndjson 출력을 위해 `--json`을 사용합니다:

```bash
git diff | autohand 'review' --json
```

각 줄은 유효한 JSON 객체입니다:

```json
{"type": "result", "content": "diff는...을 보여줍니다"}
{"type": "error", "message": "속도 제한 초과"}
```

### 상세 진행 상황

`--verbose`를 사용하여 stdout을 깨끗하게 유지하면서 진행 메시지를 stderr로 전송합니다:

```bash
git diff | autohand 'review' --verbose 2>progress.log
```

### 조합 예제

```bash
# 파이프 체인: 테스트 생성 후 lint
autohand --prompt 'generate tests for auth.ts' | eslint --stdin

# xargs와 함께 사용
find src -name '*.ts' | xargs -I{} sh -c 'cat {} | autohand "review" > {}.review'

# CI 통합
git diff HEAD~1 | autohand 'check for breaking changes' --json | jq '.content'
```

---

## 확장 사고

`--thinking` 플래그로 LLM이 응답하기 전의 추론 깊이를 제어합니다. 속도와 철저함 사이의 균형을 조절하는 데 유용합니다.

### 사용법

```bash
# 복잡한 작업을 위한 확장 추론
autohand --thinking extended

# 표준 추론 (기본값)
autohand --thinking normal

# 보이는 추론 없이 직접 응답
autohand --thinking none

# 단축키: 값 없는 --thinking은 extended가 기본값
autohand --thinking
```

### 사고 수준

| 수준 | 설명 | 적합한 용도 |
|------|------|-------------|
| `extended` | 상세한 사고 과정을 포함한 깊은 추론 | 복잡한 리팩토링, 아키텍처 결정, 디버깅 |
| `normal` | 표준 추론 깊이 (기본값) | 일반적인 코딩 작업 |
| `none` | 보이는 추론 없이 직접 응답 | 간단한 질문, 빠른 편집 |

### 환경 변수

IDE 통합에 유용한 환경 변수로도 사고 수준을 설정할 수 있습니다:

```bash
AUTOHAND_THINKING_LEVEL=extended autohand --prompt "refactor this module"
```

---

## 세션 기록

새로운 `/history` 슬래시 명령어는 세션 기록의 페이지네이션 브라우징을 제공하여 과거 작업을 쉽게 찾고 재개할 수 있게 합니다.

### 사용법

```
/history          # 세션 기록의 첫 페이지 표시
/history 2        # 2페이지 표시
/history 3        # 3페이지 표시
```

### 표시 형식

각 항목에 표시되는 정보:

| 열 | 설명 |
|----|------|
| **ID** | 세션 식별자 (20자로 잘림) |
| **날짜** | 생성 날짜 및 시간 |
| **프로젝트** | 프로젝트 이름 |
| **모델** | 사용된 LLM 모델 (축약) |
| **메시지** | 총 메시지 수 |
| **상태** | 활성 세션 배지 (녹색 `[active]`) |

### 세션 재개

`/history`와 `/resume`을 결합하여 원활한 워크플로를 구현합니다:

```
/history            # 원하는 세션 찾기
/resume abc123...   # 재개하기
```

---

## 세분화된 자동 승인 (Yolo 모드)

Yolo 모드는 도구 호출의 패턴 기반 자동 승인을 제공하여, 에이전트가 프롬프트 없이 수행할 수 있는 작업에 대한 세밀한 제어를 가능하게 합니다. `--timeout`과 결합하여 시간 제한이 있는 자율 세션을 구현합니다.

### 사용법

```bash
# 모든 것을 자동 승인
autohand --yolo true

# 읽기와 쓰기 작업만 자동 승인
autohand --yolo 'allow:read_file,write_file,search'

# 삭제와 명령어 실행을 제외한 모든 것을 자동 승인
autohand --yolo 'deny:delete_path,run_command'

# 모든 작업 허용, 단 10분만
autohand --yolo true --timeout 600
```

### 패턴 구문

| 패턴 | 효과 |
|------|------|
| `true` | `allow:*`의 단축키 -- 모든 것을 승인 |
| `allow:*` | 모든 도구를 자동 승인 |
| `allow:read_file,write_file` | 나열된 도구만 자동 승인 |
| `deny:delete_path,run_command` | 나열된 도구를 거부하고 나머지를 자동 승인 |

### 작동 방식

1. Autohand는 `--yolo` 패턴을 `YoloPattern`(모드 + 도구 목록)으로 파싱합니다.
2. 도구 호출에 승인이 필요한 경우, Autohand는 도구 이름이 패턴과 일치하는지 확인합니다.
3. 일치하면(allow 모드) 또는 일치하지 않으면(deny 모드), 도구가 프롬프트 없이 실행됩니다.
4. 패턴이 도구를 자동 승인하지 않으면, 일반 권한 프롬프트가 표시됩니다.

### 타이머

`--timeout` 플래그는 남은 시간을 추적하는 `YoloTimer`를 생성합니다:

```bash
# 5분간 자동 승인, 이후 일반 프롬프트로 복귀
autohand --yolo true --timeout 300
```

- 타이머가 활성 상태인 동안, 일치하는 도구가 자동 승인됩니다.
- 타이머가 만료되면, 모든 도구 호출이 일반 권한 프롬프트로 복귀합니다.

### 보안

- Yolo 모드는 기존 권한 시스템과 통합됩니다.
- 블랙리스트 작업(`permissions.blacklist`)은 yolo 모드에서도 여전히 차단됩니다.
- `deny` 패턴을 통해 위험한 작업을 명시적으로 제외할 수 있습니다.

---

## MCP 클라이언트 지원

Autohand에는 이제 외부 MCP 서버에 연결할 수 있는 내장 MCP(Model Context Protocol) 클라이언트가 포함되어 있습니다. 이를 통해 데이터베이스, API 또는 MCP 호환 서비스의 사용자 정의 도구로 Autohand를 확장할 수 있습니다.

### 개요

MCP는 AI 에이전트를 외부 도구에 연결하는 업계 표준 프로토콜입니다. Autohand의 MCP 클라이언트는 다음을 지원합니다:

- **stdio 전송** -- 자식 프로세스를 생성하고 stdin/stdout의 JSON-RPC 2.0으로 통신
- **SSE 전송** -- Server-Sent Events를 사용하여 HTTP 서버에 연결
- **자동 도구 검색** -- `tools/list`를 조회하여 도구를 동적으로 등록
- **네임스페이스 도구** -- 충돌을 방지하기 위해 도구에 `mcp__<서버>__<도구>` 접두사 부여
- **서버 수명 주기 관리** -- 서버 시작, 중지, 재연결

### 구성

`~/.autohand/config.json`에 MCP 서버를 추가합니다:

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

### 서버 구성 필드

| 필드 | 타입 | 필수 | 기본값 | 설명 |
|------|------|------|--------|------|
| `name` | string | 예 | - | 서버 고유 이름 |
| `transport` | `"stdio"` 또는 `"sse"` | 예 | - | 연결 유형 |
| `command` | string | stdio만 | - | 서버를 시작하는 명령어 |
| `args` | string[] | 아니오 | `[]` | 명령어 인수 |
| `url` | string | sse만 | - | SSE 엔드포인트 URL |
| `env` | object | 아니오 | `{}` | 서버 프로세스 환경 변수 |
| `autoConnect` | boolean | 아니오 | `true` | 시작 시 자동 연결 |

### 도구 이름 지정

MCP 도구는 내장 도구와의 충돌을 방지하기 위해 네임스페이스를 사용합니다:

```
mcp__<서버이름>__<도구이름>
```

예를 들어, `database`라는 서버의 `query` 도구는 `mcp__database__query`가 됩니다.

---

## IDE 통합

`/ide` 명령어는 시스템에서 실행 중인 IDE를 감지하고 통합 기능을 활성화합니다. Autohand는 현재 워크스페이스를 편집 중인 IDE를 감지하고 관련 확장 프로그램을 제안할 수 있습니다.

### 지원 IDE

| IDE | 플랫폼 | 확장 프로그램 사용 가능 |
|-----|--------|------------------------|
| Visual Studio Code | macOS, Linux, Windows | 예 |
| Visual Studio Code Insiders | macOS, Linux, Windows | 예 |
| Cursor | macOS, Linux, Windows | 아니오 |
| Zed | macOS, Linux, Windows | 예 |
| Antigravity | macOS | 아니오 |

### 사용법

```
/ide
```

명령어는 다음 단계를 수행합니다:

1. 실행 중인 프로세스를 스캔하여 알려진 IDE 패턴 검색
2. IDE 저장소를 읽어 각 인스턴스가 열고 있는 워크스페이스 확인
3. 감지된 IDE를 현재 작업 디렉토리와 매칭
4. 일치하는 IDE에 대한 선택 모달 표시
5. 심화 통합을 위한 확장 프로그램 설치 제안

---

## Homebrew 설치

Autohand는 이제 macOS의 Homebrew를 통해 사용할 수 있습니다:

```bash
# 직접 설치
brew install autohand

# 또는 공식 tap을 통해
brew tap autohandai/tap && brew install autohand
```

### 상세 정보

- Node.js가 의존성으로 선언되어 필요 시 자동 설치됩니다
- 수식은 npm 레지스트리에서 설치됩니다
- 설치 후 `autohand --version`으로 버전이 확인됩니다
- `brew upgrade autohand`로 업데이트 가능합니다

---

## 계획 모드

계획 모드는 에이전트가 행동하기 전에 계획을 세울 수 있게 합니다. 활성화되면, 에이전트는 읽기 전용 도구만 사용하여 정보를 수집하고 계획을 수립합니다. 계획을 승인하면 실행이 시작됩니다.

### 활성화

**Shift+Tab**을 눌러 계획 모드를 켜고 끕니다. 상태 표시기가 현재 상태를 보여줍니다:

| 표시기 | 의미 |
|--------|------|
| `[PLAN]` | 계획 단계 -- 에이전트가 정보를 수집하고 계획 수립 중 |
| `[EXEC]` | 실행 단계 -- 에이전트가 승인된 계획을 실행 중 |
| *(없음)* | 계획 모드 꺼짐 -- 일반 작동 |

### 작동 방식

1. **활성화** -- Shift+Tab을 누릅니다. 프롬프트에 `[PLAN]`이 표시됩니다.
2. **계획 단계** -- 에이전트는 읽기 전용 도구만 사용 가능 (파일 읽기, 검색, git status, 웹 검색 등). 쓰기 작업은 차단됩니다.
3. **계획 제시** -- 에이전트가 단계별 구조화된 계획을 제시합니다.
4. **승인 옵션** -- 진행 방법 선택:
   - **컨텍스트를 지우고 편집 자동 승인** -- 최상의 계획 준수, 대화 기록 초기화
   - **수동 승인** -- 각 편집을 개별적으로 검토하고 승인
   - **자동 승인** -- 검토 없이 모든 편집 자동 승인
5. **실행** -- 표시기가 `[EXEC]`로 변경되고 에이전트가 계획을 실행합니다.

---

## Web Repo 도구

새로운 `web_repo` 도구는 `@owner/repo` 형식을 사용하여 GitHub 및 GitLab에서 저장소 정보를 가져옵니다. 이를 통해 에이전트가 터미널을 떠나지 않고도 외부 저장소에 대한 컨텍스트를 얻을 수 있습니다.

### 사용법

프롬프트에서 `@owner/repo` 구문을 사용하여 저장소를 언급합니다:

```
@vercel/next.js에 대해 알려주세요
```

에이전트는 `web_repo` 도구를 직접 호출하여 저장소 메타데이터, README 내용, 구조 정보를 가져올 수도 있습니다.

---

## 자동 컨텍스트 압축

Autohand는 이제 세션이 길어지면 대화 컨텍스트를 자동으로 압축합니다. 이는 컨텍스트 윈도우 고갈을 방지하고 장시간 세션 중에도 에이전트의 응답성을 유지합니다.

### 작동 방식

- 기본으로 활성화 (`--cc` 플래그)
- 모델의 컨텍스트 윈도우에 대한 대화 길이를 모니터링
- 대화가 한계에 가까워지면 오래된 메시지를 요약하고 압축
- 대화형 모드와 계획 모드 모두에서 작동
- 핵심 정보(파일 내용, 최근 도구 결과)는 보존

### 구성

```bash
# 컨텍스트 압축 활성화 (기본값)
autohand --cc

# 컨텍스트 압축 비활성화
autohand --no-cc
```

---

## 사용자 정의 시스템 프롬프트

전문화된 워크플로를 위해 기본 시스템 프롬프트를 재정의하거나 확장합니다.

### 전체 프롬프트 교체

```bash
# 인라인 문자열
autohand --sys-prompt "You are a Python expert. Be concise."

# 파일에서
autohand --sys-prompt ./custom-prompt.md
```

`--sys-prompt`를 사용하면 기본 Autohand 지침, AGENTS.md, 메모리, 스킬이 모두 교체됩니다.

### 기본 프롬프트에 추가

```bash
# 인라인 문자열
autohand --append-sys-prompt "Always use TypeScript instead of JavaScript"

# 파일에서
autohand --append-sys-prompt ./team-guidelines.md
```

`--append-sys-prompt`를 사용하면 내용이 전체 기본 프롬프트 끝에 추가됩니다. 모든 기본 동작이 보존됩니다.

---

## 새로운 CLI 플래그

| 플래그 | 설명 |
|--------|------|
| `--thinking [level]` | 추론 깊이 설정: `none`, `normal`, `extended` |
| `--yolo [pattern]` | 패턴과 일치하는 도구 호출 자동 승인 |
| `--timeout <seconds>` | yolo 모드 자동 승인의 시간 제한 |
| `--cc` / `--no-cc` | 자동 컨텍스트 압축 활성화/비활성화 |
| `--search-engine <provider>` | 웹 검색 제공자 설정 (`brave`, `duckduckgo`, `parallel`) |
| `--sys-prompt <value>` | 전체 시스템 프롬프트 교체 (인라인 또는 파일 경로) |
| `--append-sys-prompt <value>` | 기본 시스템 프롬프트에 추가 |
| `--display-language <locale>` | 표시 언어 설정 (예: `en`, `zh-cn`, `fr`, `de`, `ja`) |
| `--add-dir <path>` | 워크스페이스 범위에 추가 디렉토리 추가 |
| `--skill-install [name]` | 커뮤니티 스킬 설치 |
| `--project` | 프로젝트 수준에 스킬 설치 (`--skill-install`과 함께 사용) |

---

## 새로운 슬래시 명령어

| 명령어 | 설명 |
|--------|------|
| `/history` | 페이지네이션과 함께 세션 기록 탐색 |
| `/history <페이지>` | 특정 페이지의 세션 기록 보기 |
| `/ide` | 실행 중인 IDE 감지 및 통합 연결 |
| `/about` | Autohand 정보 표시 (버전, 링크) |
| `/feedback` | CLI에 대한 피드백 제출 |
| `/plan` | 계획 모드와 상호작용 |
| `/add-dir` | 워크스페이스 범위에 추가 디렉토리 추가 |
| `/language` | 표시 언어 변경 |
| `/formatters` | 사용 가능한 코드 포매터 목록 |
| `/lint` | 사용 가능한 코드 린터 목록 |
| `/completion` | 쉘 자동완성 스크립트 생성 (bash, zsh, fish) |
| `/export` | 세션을 markdown, JSON, HTML로 내보내기 |
| `/permissions` | 권한 설정 보기 및 관리 |
| `/hooks` | 수명 주기 훅 대화형 관리 |
| `/share` | autohand.link를 통해 세션 공유 |
| `/skills` | 스킬 목록 보기, 활성화, 비활성화 또는 생성 |

---

## 아키텍처 개선

### Modal 컴포넌트

`enquirer` 의존성이 Ink로 구축된 사용자 정의 `Modal` 컴포넌트로 교체되었습니다. 이를 통해 일관된 스타일링, 키보드 탐색, TUI의 나머지 부분과의 더 나은 통합을 제공합니다.

### 추출된 모듈

관심사 분리를 개선하기 위해 여러 내부 모듈이 추출되었습니다:

- **WorkspaceFileCollector** -- 30초 캐시와 함께 워크스페이스 파일 검색 처리
- **AgentFormatter** -- 터미널 표시를 위한 에이전트 출력 포맷팅
- **ProviderConfigManager** -- 제공자별 구성 로직 관리

### Ink UI 렌더링

실험적인 Ink 기반 렌더러(`ui.useInkRenderer`)가 다음 사항에 대해 최적화되었습니다:

- React 조정을 통한 깜빡임 없는 출력
- 작동 중인 요청 대기열 (에이전트가 작업하는 동안 입력 가능)
- readline 충돌 없는 더 나은 입력 처리

### 동적 도움말

`/help` 명령어는 이제 등록된 슬래시 명령어에서 동적으로 출력을 생성하여, 항상 현재 사용 가능한 명령어 세트를 반영합니다.

---

## 업그레이드 방법

### npm에서

```bash
npm update -g autohand-cli
```

### Homebrew에서

```bash
brew upgrade autohand
```

### 구성 호환성

기존 `~/.autohand/config.json`은 완전히 하위 호환됩니다. 마이그레이션이 필요하지 않습니다.

새로운 구성 섹션(`mcp.servers` 등)은 선택적이며 해당 기능을 사용하려는 경우에만 필요합니다. Autohand는 모든 새 설정에 합리적인 기본값을 사용합니다.

---

## 관련 문서

- [구성 참조](./config-reference_ko.md) -- 모든 구성 옵션
- [훅 시스템](./hooks.md) -- 수명 주기 훅
- [제공자 가이드](./providers.md) -- LLM 제공자 설정
- [자동 모드](./automode.md) -- 자율 개발 루프
- [RPC 프로토콜](./rpc-protocol.md) -- 프로그래밍 방식 제어
