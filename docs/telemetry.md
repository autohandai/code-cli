# Telemetry Architecture & Key Decisions

> **Document Status**: Living Document
> **Last Updated**: December 2024
> **Owner**: Autohand Core Team

---

## Overview

Autohand CLI includes an optional telemetry system designed to help improve the product while respecting user privacy. This document outlines what data is collected, how it's handled, and how users can control their data.

**Guiding Principles:**
1. **Privacy First** - No personally identifiable information (PII) is ever collected
2. **Transparency** - Users know exactly what's collected
3. **User Control** - Easy opt-out, data deletion on request
4. **Offline Resilient** - Works without internet, syncs when available

---

## Data Collection Summary

### What We Collect

| Category | Data Points | Purpose |
|----------|-------------|---------|
| **Session** | Start/end time, duration, status | Understand usage patterns |
| **Tools** | Which tools used, success/failure, duration | Improve tool reliability |
| **Errors** | Error type, sanitized message | Fix bugs faster |
| **Commands** | Slash commands used | Prioritize feature development |
| **Environment** | OS, Node version, CLI version | Ensure compatibility |

### What We Do NOT Collect

- File contents or names
- User prompts or conversations
- API keys or credentials
- IP addresses (hashed on server)
- Usernames, emails, or any PII
- Code, diffs, or patches
- Workspace paths (sanitized)

---

## Event Types

### 1. `session_start`

Triggered when a user starts or resumes a session.

```typescript
{
  eventType: 'session_start',
  sessionId: 'uuid',
  deviceId: 'uuid',
  eventData: {
    model: 'claude-3.5-sonnet',
    provider: 'openrouter'
  },
  platform: 'darwin',
  cliVersion: '0.1.0',
  timestamp: 'ISO-8601'
}
```

**Frequency**: Once per session start

### 2. `session_end`

Triggered when a session ends (quit, crash, or abandoned).

```typescript
{
  eventType: 'session_end',
  eventData: {
    status: 'completed' | 'crashed' | 'abandoned',
    duration: 1234, // seconds
    model: 'claude-3.5-sonnet',
    provider: 'openrouter'
  },
  interactionCount: 15,
  toolsUsed: ['read_file', 'write_file', 'run_command'],
  errorsCount: 0
}
```

**Frequency**: Once per session end

### 3. `tool_use`

Triggered when any tool is executed.

```typescript
{
  eventType: 'tool_use',
  eventData: {
    tool: 'write_file',
    success: true,
    duration: 45 // milliseconds
  }
}
```

**Frequency**: Per tool execution (batched)

### 4. `error`

Triggered on unexpected errors.

```typescript
{
  eventType: 'error',
  eventData: {
    type: 'interactive_loop_error',
    message: 'Connection timeout',
    stack: '...sanitized...',
    context: 'Interactive loop'
  }
}
```

**Stack Trace Sanitization**:
- `/Users/<username>/` → `/Users/***/`
- `/home/<username>/` → `/home/***/`
- `C:\Users\<username>\` → `C:\Users\***\`

**Frequency**: Per error occurrence

### 5. `model_switch`

Triggered when user changes the AI model.

```typescript
{
  eventType: 'model_switch',
  eventData: {
    fromModel: 'gpt-4',
    toModel: 'claude-3.5-sonnet',
    provider: 'openrouter'
  }
}
```

**Frequency**: Per model change

### 6. `command_use`

Triggered when slash commands are used.

```typescript
{
  eventType: 'command_use',
  eventData: {
    command: '/model'
  }
}
```

**Frequency**: Per slash command

### 7. `heartbeat`

Periodic check-in for long sessions.

```typescript
{
  eventType: 'heartbeat',
  eventData: {
    uptime: 3600 // seconds
  }
}
```

**Frequency**: Every 5 minutes during active sessions

### 8. `session_sync`

Session data uploaded for cloud sync feature.

```typescript
{
  eventType: 'session_sync',
  eventData: {
    messageCount: 45,
    totalTokens: 12500
  }
}
```

**Frequency**: On session end (if enabled)

---

## Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Autohand CLI                            │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              TelemetryManager                        │    │
│  │  • Captures events                                   │    │
│  │  • Sanitizes data                                    │    │
│  │  • Manages session state                             │    │
│  └────────────────────┬────────────────────────────────┘    │
│                       │                                      │
│  ┌────────────────────▼────────────────────────────────┐    │
│  │              TelemetryClient                         │    │
│  │  • Batches events (max 20)                          │    │
│  │  • Persists queue to disk                           │    │
│  │  • Retries on failure (3 attempts)                  │    │
│  │  • Flushes every 60 seconds                         │    │
│  └────────────────────┬────────────────────────────────┘    │
│                       │                                      │
│  ┌────────────────────▼────────────────────────────────┐    │
│  │           ~/.autohand/telemetry/                 │    │
│  │  • queue.json (pending events)                      │    │
│  │  • session-sync-queue.json (pending sessions)       │    │
│  └────────────────────┬────────────────────────────────┘    │
└───────────────────────┼─────────────────────────────────────┘
                        │ HTTPS (when online)
                        ▼
┌─────────────────────────────────────────────────────────────┐
│              api.autohand.ai (Cloudflare Workers)            │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  POST /v1/telemetry/batch                           │    │
│  │  POST /v1/history/keeping                           │    │
│  └────────────────────┬────────────────────────────────┘    │
│                       │                                      │
│  ┌────────────────────▼────────────────────────────────┐    │
│  │              Data Storage                            │    │
│  │  • D1 (SQLite) - Structured metrics                 │    │
│  │  • R2 (Object) - Raw event data                     │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

---

## Frequency & Batching

### Event Batching

| Setting | Value | Configurable |
|---------|-------|--------------|
| Batch size | 20 events | No |
| Flush interval | 60 seconds | No |
| Max queue size | 500 events | No |
| Retry attempts | 3 | No |
| Retry backoff | 1s, 2s, 3s | No |

### Network Behavior

- **Online**: Events sent in batches every 60 seconds or when batch size reached
- **Offline**: Events queued to disk, synced when connection restored
- **Startup**: Attempts to flush any queued events from previous sessions

---

## Opt-In / Opt-Out

### Default Behavior

Telemetry is **enabled by default** but can be disabled at any time.

### How to Opt-Out

**Option 1: Config File**

Edit `~/.autohand/config.json`:

```json
{
  "telemetry": {
    "enabled": false
  }
}
```

**Option 2: Environment Variable**

```bash
AUTOHAND_TELEMETRY=false autohand
```

**Option 3: CLI Flag** (planned)

```bash
autohand --no-telemetry
```

### What Happens When Disabled

- No events are captured or sent
- Existing queue is preserved but not sent
- Session sync is disabled
- Local session files still created

### Partial Opt-Out

Disable only cloud session sync while keeping analytics:

```json
{
  "telemetry": {
    "enabled": true,
    "enableSessionSync": false
  }
}
```

---

## Device Identification

### Anonymous Device ID

- Generated on first run: `crypto.randomUUID()`
- Stored in `~/.autohand/device-id`
- Never changes unless manually deleted
- Not linked to any user account

### Session ID

- Generated per session: `crypto.randomUUID()`
- Links events within a single session
- Enables session resume from cloud

---

## Data Retention

### On-Device

| Data | Location | Retention |
|------|----------|-----------|
| Event queue | `~/.autohand/telemetry/queue.json` | Until synced |
| Session sync queue | `~/.autohand/telemetry/session-sync-queue.json` | Until synced (max 10) |
| Device ID | `~/.autohand/device-id` | Permanent |

### Server-Side

| Data | Storage | Retention |
|------|---------|-----------|
| Telemetry events | D1 + R2 | 90 days |
| Session data | R2 | 90 days |
| Aggregated metrics | D1 | Indefinite |

---

## Enterprise Features

### Standard (Free)

- All telemetry collection
- Opt-out capability
- Local session storage
- Cloud session sync

### Enterprise (Planned)

| Feature | Description |
|---------|-------------|
| **Private Telemetry Endpoint** | Self-hosted API for complete data control |
| **Data Residency** | Choose region for data storage (EU, US, APAC) |
| **Extended Retention** | Custom retention periods up to 2 years |
| **Audit Logs** | Detailed logs of all data access |
| **SSO Integration** | Link telemetry to enterprise identity |
| **Team Analytics** | Aggregated usage across team members |
| **Custom Dashboards** | Build custom analytics views |
| **Export API** | Programmatic access to raw telemetry |
| **Compliance Reports** | SOC2, GDPR, HIPAA compliance documentation |
| **Data Deletion API** | Programmatic GDPR deletion requests |

### Enterprise Configuration

```json
{
  "telemetry": {
    "enabled": true,
    "apiBaseUrl": "https://telemetry.your-company.com",
    "enableSessionSync": true,
    "enterprise": {
      "organizationId": "org_xxx",
      "apiKey": "ent_xxx",
      "dataResidency": "eu-west-1"
    }
  }
}
```

---

## Privacy & Compliance

### GDPR Compliance

- **Lawful Basis**: Legitimate interest (product improvement)
- **Data Minimization**: Only essential data collected
- **Right to Access**: Request data export via support
- **Right to Erasure**: Request deletion via support
- **Data Portability**: JSON export available

### Data Processing

| Role | Entity |
|------|--------|
| Data Controller | Autohand AI LLC |
| Data Processor | Cloudflare (hosting) |
| Sub-processors | None |

### Security Measures

- TLS 1.3 for all transmissions
- Data encrypted at rest (Cloudflare D1/R2)
- No logs contain PII
- Regular security audits
- IP addresses hashed with rotating salt

---

## Debugging & Transparency

### View Queued Events

```bash
cat ~/.autohand/telemetry/queue.json | jq
```

### View Device ID

```bash
cat ~/.autohand/device-id
```

### Clear All Telemetry Data

```bash
rm -rf ~/.autohand/telemetry/
rm ~/.autohand/device-id
```

### Verify Opt-Out

When telemetry is disabled, no network requests are made to `api.autohand.ai`. Verify with:

```bash
# macOS/Linux
sudo tcpdump -i any host api.autohand.ai
```

---

## Changelog

| Date | Change |
|------|--------|
| 2024-12 | Initial telemetry system implementation |
| 2024-12 | Added offline batching and sync |
| 2024-12 | Added session cloud sync |
| 2024-12 | Added enterprise feature planning |

---

## Questions & Contact

For telemetry-related questions or data requests:

- **Email**: privacy@autohand.ai
- **GitHub**: https://github.com/autohand/cli/issues

---

*This document is part of the Autohand CLI open-source project and is subject to the Apache-2.0 license.*
