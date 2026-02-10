# MCP (Model Context Protocol) 지원

Autohand에는 외부 MCP 서버에 연결하는 내장 MCP 클라이언트가 포함되어 있어, 데이터베이스, API, 브라우저 및 모든 MCP 호환 서비스의 도구로 에이전트를 확장할 수 있습니다.

## 목차

- [개요](#개요)
- [빠른 시작](#빠른-시작)
- [설정](#설정)
- [슬래시 명령어](#슬래시-명령어)
- [커뮤니티 MCP 레지스트리](#커뮤니티-mcp-레지스트리)
- [도구 명명 규칙](#도구-명명-규칙)
- [논블로킹 시작](#논블로킹-시작)
- [문제 해결](#문제-해결)

---

## 개요

MCP는 AI 에이전트를 외부 도구에 연결하기 위한 오픈 프로토콜입니다. Autohand의 MCP 클라이언트는 다음을 지원합니다:

- **stdio 트랜스포트** -- 자식 프로세스를 생성하고 stdin/stdout을 통해 JSON-RPC 2.0으로 통신합니다
- **SSE 트랜스포트** -- Server-Sent Events를 사용하여 HTTP 서버에 연결합니다 (계획 중)
- **자동 도구 검색** -- 연결된 서버에서 도구를 검색하고 등록합니다
- **네임스페이스 도구** -- MCP 도구에는 내장 도구와의 충돌을 방지하기 위해 접두사가 붙습니다
- **논블로킹 시작** -- 서버가 프롬프트를 지연시키지 않고 백그라운드에서 연결됩니다
- **대화형 관리** -- `/mcp` 명령어로 서버를 켜고 끌 수 있습니다

---

## 빠른 시작

### 커뮤니티 레지스트리에서 설치

가장 빠르게 시작하는 방법은 커뮤니티 레지스트리에서 미리 구성된 서버를 설치하는 것입니다:

```bash
# Autohand REPL에서
/mcp install filesystem
```

이렇게 하면 서버가 설정에 추가되고 자동으로 연결됩니다. 전체 레지스트리를 둘러볼 수도 있습니다:

```bash
/mcp install
```

### 수동 설정

`~/.autohand/config.json`에 MCP 서버를 추가합니다:

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

Autohand를 재시작하면 서버가 백그라운드에서 자동으로 연결됩니다.

---

## 설정

### 설정 구조

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

### 서버 설정 필드

| 필드 | 타입 | 필수 | 설명 |
|-------|------|----------|-------------|
| `name` | string | 예 | 서버의 고유 식별자 |
| `transport` | `"stdio"` \| `"sse"` | 예 | 트랜스포트 유형 |
| `command` | string | 예 (stdio) | 서버 프로세스를 시작하는 명령어 |
| `args` | string[] | 아니오 | 명령어의 인수 |
| `url` | string | 예 (sse) | SSE 엔드포인트 URL |
| `env` | object | 아니오 | 서버에 전달되는 환경 변수 |
| `autoConnect` | boolean | 아니오 | 시작 시 자동 연결 (기본값: `true`) |

### 전역 설정

| 필드 | 타입 | 기본값 | 설명 |
|-------|------|---------|-------------|
| `mcp.enabled` | boolean | `true` | 모든 MCP 지원 활성화/비활성화 |
| `mcp.servers` | array | `[]` | 서버 설정 목록 |

---

## 슬래시 명령어

### `/mcp` -- 대화형 서버 관리자

인수 없이 `/mcp`를 실행하면 **대화형 토글 목록**이 열립니다:

```
MCP Servers
────────────────────────────────────────────────────────
▸ ● filesystem          enabled (5 tools)
  ○ github              disabled
  ● postgres            error
    Connection refused

↑↓ navigate  ⏎/space toggle  q/esc close
```

- **화살표 키**로 서버 간 이동
- **스페이스** 또는 **Enter**로 서버 켜기/끄기 (연결/연결 해제)
- **q** 또는 **ESC**로 목록 닫기
- 오류가 발생한 서버를 선택하면 오류 세부 정보가 표시됩니다

### `/mcp` 하위 명령어

| 명령어 | 설명 |
|---------|-------------|
| `/mcp` | 대화형 서버 토글 목록 |
| `/mcp connect <name>` | 특정 서버에 연결 |
| `/mcp disconnect <name>` | 서버 연결 해제 |
| `/mcp list` | 연결된 서버의 모든 도구 나열 |
| `/mcp tools` | `/mcp list`의 별칭 |
| `/mcp add <name> <cmd> [args]` | 설정에 서버를 추가하고 연결 |
| `/mcp remove <name>` | 설정에서 서버 제거 |

### 예시

```bash
# 서버를 수동으로 추가
/mcp add time npx -y @modelcontextprotocol/server-time

# 사용 가능한 모든 도구 보기
/mcp list

# 서버 연결 해제
/mcp disconnect time

# 서버를 영구적으로 제거
/mcp remove time
```

---

### `/mcp install` -- 커뮤니티 레지스트리 브라우저

커뮤니티 레지스트리에서 미리 구성된 MCP 서버를 찾아보고 설치합니다:

```bash
# 카테고리별로 전체 레지스트리 둘러보기
/mcp install

# 특정 서버를 바로 설치
/mcp install filesystem
```

대화형 브라우저에는 다음이 표시됩니다:

- **카테고리**: 개발 도구, 데이터 및 데이터베이스, 웹 및 API, 생산성, AI 및 추론
- **추천 서버** 및 평점
- 자동완성이 포함된 **검색**
- 설치 전 **서버 세부 정보** (설명, 필수 환경 변수, 필수 인수)

#### 사용 가능한 서버

| 서버 | 카테고리 | 설명 |
|--------|----------|-------------|
| filesystem | 개발 도구 | 파일 및 디렉토리 읽기, 쓰기, 관리 |
| github | 개발 도구 | GitHub 저장소, 이슈, 풀 리퀘스트 |
| everything | 개발 도구 | 테스트용 레퍼런스 MCP 서버 |
| time | 개발 도구 | 시간 및 시간대 도구 |
| postgres | 데이터 및 데이터베이스 | PostgreSQL 데이터베이스 쿼리 |
| sqlite | 데이터 및 데이터베이스 | SQLite 데이터베이스 작업 |
| brave-search | 웹 및 API | Brave 웹 검색 |
| fetch | 웹 및 API | 웹 페이지 가져오기 및 파싱 |
| puppeteer | 웹 및 API | Puppeteer를 사용한 브라우저 자동화 |
| slack | 생산성 | Slack 메시징 |
| memory | AI 및 추론 | 영구 지식 그래프 메모리 |
| sequential-thinking | AI 및 추론 | 단계별 추론 |

#### 환경 변수

일부 서버에는 환경 변수가 필요합니다. 설치 시 Autohand가 필요한 값을 입력하도록 요청합니다:

```bash
/mcp install slack
# 다음을 입력하라는 메시지가 표시됩니다:
#   SLACK_BOT_TOKEN: xoxb-your-token
#   SLACK_TEAM_ID: T0YOUR_TEAM_ID
```

#### 필수 인수

`filesystem`과 같은 서버에는 경로 인수가 필요합니다:

```bash
/mcp install filesystem
# 입력 요청: 허용된 디렉토리 경로
```

---

## 도구 명명 규칙

MCP 도구는 충돌을 방지하기 위해 네임스페이스 접두사와 함께 등록됩니다:

```
mcp__<server-name>__<tool-name>
```

예를 들어, filesystem 서버의 `read_file` 도구는 `mcp__filesystem__read_file`이 됩니다.

LLM이 MCP 도구 사용을 결정하면, Autohand가 자동으로 올바른 서버로 호출을 라우팅합니다.

---

## 논블로킹 시작

MCP 서버는 시작 시 **백그라운드에서 비동기적으로 연결**됩니다. 이는 다음을 의미합니다:

1. 프롬프트가 즉시 표시됩니다 -- 서버 연결을 기다릴 필요가 없습니다
2. 서버는 병렬로, 각각 독립적으로 연결됩니다
3. 서버 연결이 완료되면 도구를 사용할 수 있게 됩니다
4. 서버가 실패해도 다른 서버는 정상적으로 계속 작동합니다 (오류는 `/mcp`에서 표시됩니다)
5. LLM이 MCP 도구를 호출할 때 Autohand는 먼저 연결 완료를 기다립니다

이 동작은 Claude Code 및 유사한 도구가 MCP를 처리하는 방식과 동일합니다 -- 서버 시작이 느려도 사용자가 차단되지 않습니다.

---

## 문제 해결

### 서버가 연결되지 않음

```bash
# 상태 확인
/mcp

# 재연결 시도
/mcp disconnect <name>
/mcp connect <name>
```

### 일반적인 오류

| 오류 | 원인 | 해결 방법 |
|-------|-------|-----|
| `Command not found` | 패키지가 설치되지 않음 | 먼저 `npx` 명령어를 수동으로 실행하세요 |
| `Connection refused` | 서버가 실행되지 않음 (SSE) | URL과 서버 상태를 확인하세요 |
| `Request timed out` | 서버가 응답하지 않음 | 서버 로그를 확인하고 재시작하세요 |
| `SSE transport not yet implemented` | SSE가 아직 지원되지 않음 | stdio 트랜스포트를 사용하세요 |

### 서버 로그

MCP 서버의 stderr 출력은 내부적으로 캡처됩니다. 서버가 비정상적으로 동작하는 경우, Autohand 외부에서 해당 명령어가 정상적으로 작동하는지 확인하세요:

```bash
npx -y @modelcontextprotocol/server-filesystem /tmp
```

### MCP 비활성화

설정에서 `mcp.enabled`를 `false`로 설정하면 모든 MCP 지원이 비활성화됩니다:

```json
{
  "mcp": {
    "enabled": false
  }
}
```

또는 개별 서버를 자동 연결하지 않도록 설정합니다:

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
