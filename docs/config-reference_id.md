# Referensi Konfigurasi Autohand

Referensi lengkap untuk semua opsi konfigurasi di `~/.autohand/config.json` (atau `.yaml`/`.yml`).

## Daftar Isi

- [Lokasi File Konfigurasi](#lokasi-file-konfigurasi)
- [Variabel Lingkungan](#variabel-lingkungan)
- [Pengaturan Provider](#pengaturan-provider)
- [Pengaturan Workspace](#pengaturan-workspace)
- [Pengaturan UI](#pengaturan-ui)
- [Pengaturan Agent](#pengaturan-agent)
- [Pengaturan Izin](#pengaturan-izin)
- [Pengaturan Jaringan](#pengaturan-jaringan)
- [Pengaturan Telemetri](#pengaturan-telemetri)
- [Agent Eksternal](#agent-eksternal)
- [Pengaturan API](#pengaturan-api)
- [Contoh Lengkap](#contoh-lengkap)

---

## Lokasi File Konfigurasi

Autohand mencari konfigurasi dalam urutan ini:

1. Variabel lingkungan `AUTOHAND_CONFIG` (path kustom)
2. `~/.autohand/config.yaml`
3. `~/.autohand/config.yml`
4. `~/.autohand/config.json` (default)

Anda juga dapat mengganti direktori dasar:
```bash
export AUTOHAND_HOME=/custom/path  # Mengubah ~/.autohand ke /custom/path
```

---

## Variabel Lingkungan

| Variabel | Deskripsi | Contoh |
|----------|-----------|--------|
| `AUTOHAND_HOME` | Direktori dasar untuk semua data Autohand | `/custom/path` |
| `AUTOHAND_CONFIG` | Path file konfigurasi kustom | `/path/to/config.json` |
| `AUTOHAND_API_URL` | Endpoint API (mengganti konfigurasi) | `https://api.autohand.ai` |
| `AUTOHAND_SECRET` | Kunci rahasia perusahaan/tim | `sk-xxx` |

---

## Pengaturan Provider

### `provider`
Provider LLM aktif yang akan digunakan.

| Nilai | Deskripsi |
|-------|-----------|
| `"openrouter"` | API OpenRouter (default) |
| `"ollama"` | Instance Ollama lokal |
| `"llamacpp"` | Server llama.cpp lokal |
| `"openai"` | API OpenAI secara langsung |

### `openrouter`
Konfigurasi provider OpenRouter.

```json
{
  "openrouter": {
    "apiKey": "sk-or-v1-xxx",
    "baseUrl": "https://openrouter.ai/api/v1",
    "model": "anthropic/claude-sonnet-4"
  }
}
```

| Field | Tipe | Wajib | Default | Deskripsi |
|-------|------|-------|---------|-----------|
| `apiKey` | string | Ya | - | Kunci API OpenRouter Anda |
| `baseUrl` | string | Tidak | `https://openrouter.ai/api/v1` | Endpoint API |
| `model` | string | Ya | - | Identifier model (mis. `anthropic/claude-sonnet-4`) |

### `ollama`
Konfigurasi provider Ollama.

```json
{
  "ollama": {
    "baseUrl": "http://localhost:11434",
    "port": 11434,
    "model": "llama3.2"
  }
}
```

| Field | Tipe | Wajib | Default | Deskripsi |
|-------|------|-------|---------|-----------|
| `baseUrl` | string | Tidak | `http://localhost:11434` | URL server Ollama |
| `port` | number | Tidak | `11434` | Port server (alternatif untuk baseUrl) |
| `model` | string | Ya | - | Nama model (mis. `llama3.2`, `codellama`) |

### `llamacpp`
Konfigurasi server llama.cpp.

```json
{
  "llamacpp": {
    "baseUrl": "http://localhost:8080",
    "port": 8080,
    "model": "default"
  }
}
```

| Field | Tipe | Wajib | Default | Deskripsi |
|-------|------|-------|---------|-----------|
| `baseUrl` | string | Tidak | `http://localhost:8080` | URL server llama.cpp |
| `port` | number | Tidak | `8080` | Port server |
| `model` | string | Ya | - | Identifier model |

### `openai`
Konfigurasi API OpenAI.

```json
{
  "openai": {
    "apiKey": "sk-xxx",
    "baseUrl": "https://api.openai.com/v1",
    "model": "gpt-4o"
  }
}
```

| Field | Tipe | Wajib | Default | Deskripsi |
|-------|------|-------|---------|-----------|
| `apiKey` | string | Ya | - | Kunci API OpenAI |
| `baseUrl` | string | Tidak | `https://api.openai.com/v1` | Endpoint API |
| `model` | string | Ya | - | Nama model (mis. `gpt-4o`, `gpt-4o-mini`) |

---

## Pengaturan Workspace

```json
{
  "workspace": {
    "defaultRoot": "/path/to/projects",
    "allowDangerousOps": false
  }
}
```

| Field | Tipe | Default | Deskripsi |
|-------|------|---------|-----------|
| `defaultRoot` | string | Direktori saat ini | Workspace default ketika tidak ditentukan |
| `allowDangerousOps` | boolean | `false` | Izinkan operasi destruktif tanpa konfirmasi |

---

## Pengaturan UI

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

| Field | Tipe | Default | Deskripsi |
|-------|------|---------|-----------|
| `theme` | `"dark"` \| `"light"` | `"dark"` | Tema warna untuk output terminal |
| `autoConfirm` | boolean | `false` | Lewati prompt konfirmasi untuk operasi aman |
| `readFileCharLimit` | number | `300` | Karakter maksimum yang ditampilkan dari output tool baca/cari (konten lengkap tetap dikirim ke model) |
| `showCompletionNotification` | boolean | `true` | Tampilkan notifikasi sistem saat tugas selesai |
| `showThinking` | boolean | `true` | Tampilkan proses penalaran/pemikiran LLM |
| `useInkRenderer` | boolean | `false` | Gunakan renderer berbasis Ink untuk UI tanpa kedipan (eksperimental) |
| `terminalBell` | boolean | `true` | Bunyikan bel terminal saat tugas selesai (menampilkan badge di tab/dock terminal) |
| `checkForUpdates` | boolean | `true` | Periksa pembaruan CLI saat startup |
| `updateCheckInterval` | number | `24` | Jam antara pemeriksaan pembaruan (gunakan hasil cache dalam interval) |

Catatan: `readFileCharLimit` hanya mempengaruhi tampilan terminal untuk `read_file`, `search`, dan `search_with_context`. Konten lengkap tetap dikirim ke model dan disimpan dalam pesan tool.

### Bel Terminal

Ketika `terminalBell` diaktifkan (default), Autohand membunyikan bel terminal (`\x07`) saat tugas selesai. Ini memicu:

- **Badge di tab terminal** - Menampilkan indikator visual bahwa pekerjaan selesai
- **Pantulan ikon Dock** - Menarik perhatian Anda saat terminal di background (macOS)
- **Suara** - Jika suara terminal diaktifkan di pengaturan terminal Anda

Untuk menonaktifkan:
```json
{
  "ui": {
    "terminalBell": false
  }
}
```

### Renderer Ink (Eksperimental)

Ketika `useInkRenderer` diaktifkan, Autohand menggunakan rendering terminal berbasis React (Ink) alih-alih spinner ora tradisional. Ini menyediakan:

- **Output tanpa kedipan**: Semua pembaruan UI di-batch melalui reconciliation React
- **Fitur antrian kerja**: Ketik instruksi saat agent bekerja
- **Penanganan input lebih baik**: Tidak ada konflik antara handler readline
- **UI yang dapat disusun**: Fondasi untuk fitur UI canggih di masa depan

Untuk mengaktifkan:
```json
{
  "ui": {
    "useInkRenderer": true
  }
}
```

Catatan: Fitur ini eksperimental dan mungkin memiliki kasus edge. UI default berbasis ora tetap stabil dan berfungsi penuh.

### Pemeriksaan Pembaruan

Ketika `checkForUpdates` diaktifkan (default), Autohand memeriksa rilis baru saat startup:

```
> Autohand v0.6.8 (abc1234) ✓ Up to date
```

Jika ada pembaruan:
```
> Autohand v0.6.7 (abc1234) ⬆ Update available: v0.6.8
  ↳ Run: curl -fsSL https://autohand.ai/install.sh | sh
```

Untuk menonaktifkan:
```json
{
  "ui": {
    "checkForUpdates": false
  }
}
```

Atau melalui variabel lingkungan:
```bash
export AUTOHAND_SKIP_UPDATE_CHECK=1
```

---

## Pengaturan Agent

Kontrol perilaku agent dan batas iterasi.

```json
{
  "agent": {
    "maxIterations": 100,
    "enableRequestQueue": true
  }
}
```

| Field | Tipe | Default | Deskripsi |
|-------|------|---------|-----------|
| `maxIterations` | number | `100` | Iterasi tool maksimum per permintaan pengguna sebelum berhenti |
| `enableRequestQueue` | boolean | `true` | Izinkan pengguna mengetik dan mengantri permintaan saat agent bekerja |

### Antrian Permintaan

Ketika `enableRequestQueue` diaktifkan, Anda dapat terus mengetik pesan saat agent memproses permintaan sebelumnya. Input Anda akan diantri secara otomatis dan diproses saat tugas saat ini selesai.

- Ketik pesan Anda dan tekan Enter untuk menambah ke antrian
- Baris status menunjukkan berapa banyak permintaan yang diantri
- Permintaan diproses dalam urutan FIFO (first-in, first-out)
- Ukuran antrian maksimum adalah 10 permintaan

---

## Pengaturan Izin

Kontrol granular atas izin tool.

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

| Nilai | Deskripsi |
|-------|-----------|
| `"interactive"` | Minta persetujuan untuk operasi berbahaya (default) |
| `"unrestricted"` | Tanpa prompt, izinkan semua |
| `"restricted"` | Tolak semua operasi berbahaya |

### `whitelist`
Array pola tool yang tidak pernah memerlukan persetujuan.

```json
["run_command:npm *", "run_command:bun test"]
```

### `blacklist`
Array pola tool yang selalu diblokir.

```json
["run_command:rm -rf /", "run_command:sudo *"]
```

### `rules`
Aturan izin granular.

| Field | Tipe | Deskripsi |
|-------|------|-----------|
| `tool` | string | Nama tool untuk dicocokkan |
| `pattern` | string | Pola opsional untuk dicocokkan dengan argumen |
| `action` | `"allow"` \| `"deny"` \| `"prompt"` | Tindakan yang diambil |

### `rememberSession`
| Tipe | Default | Deskripsi |
|------|---------|-----------|
| boolean | `true` | Ingat keputusan persetujuan untuk sesi |

### Izin Proyek Lokal

Setiap proyek dapat memiliki pengaturan izin sendiri yang mengganti konfigurasi global. Ini disimpan di `.autohand/settings.local.json` di root proyek Anda.

Ketika Anda menyetujui operasi file (edit, tulis, hapus), secara otomatis disimpan ke file ini sehingga Anda tidak akan ditanya lagi untuk operasi yang sama di proyek ini.

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

**Cara kerjanya:**
- Ketika Anda menyetujui operasi, itu disimpan ke `.autohand/settings.local.json`
- Lain kali, operasi yang sama akan disetujui otomatis
- Pengaturan proyek lokal digabung dengan pengaturan global (lokal diprioritaskan)
- Tambahkan `.autohand/settings.local.json` ke `.gitignore` untuk menjaga pengaturan pribadi tetap privat

**Format pola:**
- `nama_tool:path` - Untuk operasi file (mis. `multi_file_edit:src/file.ts`)
- `nama_tool:perintah args` - Untuk perintah (mis. `run_command:npm test`)

---

## Pengaturan Jaringan

```json
{
  "network": {
    "maxRetries": 3,
    "timeout": 30000,
    "retryDelay": 1000
  }
}
```

| Field | Tipe | Default | Maks | Deskripsi |
|-------|------|---------|------|-----------|
| `maxRetries` | number | `3` | `5` | Percobaan retry untuk permintaan API yang gagal |
| `timeout` | number | `30000` | - | Timeout permintaan dalam milidetik |
| `retryDelay` | number | `1000` | - | Jeda antara retry dalam milidetik |

---

## Pengaturan Telemetri

Telemetri **dinonaktifkan secara default** (opt-in). Aktifkan untuk membantu meningkatkan Autohand.

```json
{
  "telemetry": {
    "enabled": false,
    "apiBaseUrl": "https://api.autohand.ai",
    "enableSessionSync": false
  }
}
```

| Field | Tipe | Default | Deskripsi |
|-------|------|---------|-----------|
| `enabled` | boolean | `false` | Aktifkan/nonaktifkan telemetri (opt-in) |
| `apiBaseUrl` | string | `https://api.autohand.ai` | Endpoint API telemetri |
| `enableSessionSync` | boolean | `false` | Sinkronkan sesi ke cloud untuk fitur tim |

---

## Agent Eksternal

Muat definisi agent kustom dari direktori eksternal.

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

| Field | Tipe | Default | Deskripsi |
|-------|------|---------|-----------|
| `enabled` | boolean | `false` | Aktifkan pemuatan agent eksternal |
| `paths` | string[] | `[]` | Direktori untuk memuat agent |

---

## Pengaturan API

Konfigurasi API backend untuk fitur tim.

```json
{
  "api": {
    "baseUrl": "https://api.autohand.ai",
    "companySecret": "sk-team-xxx"
  }
}
```

| Field | Tipe | Default | Deskripsi |
|-------|------|---------|-----------|
| `baseUrl` | string | `https://api.autohand.ai` | Endpoint API |
| `companySecret` | string | - | Rahasia tim/perusahaan untuk fitur bersama |

Juga dapat diatur melalui variabel lingkungan:
- `AUTOHAND_API_URL` → `api.baseUrl`
- `AUTOHAND_SECRET` → `api.companySecret`

---

## Contoh Lengkap

### Format JSON (`~/.autohand/config.json`)

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

### Format YAML (`~/.autohand/config.yaml`)

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

## Struktur Direktori

Autohand menyimpan data di `~/.autohand/` (atau `$AUTOHAND_HOME`):

```
~/.autohand/
├── config.json          # Konfigurasi utama
├── config.yaml          # Konfigurasi YAML alternatif
├── device-id            # Identifier perangkat unik
├── error.log            # Log error
├── feedback.log         # Pengiriman feedback
├── sessions/            # Riwayat sesi
├── projects/            # Basis pengetahuan proyek
├── memory/              # Memori tingkat pengguna
├── commands/            # Perintah kustom
├── agents/              # Definisi agent
├── tools/               # Meta-tool kustom
├── feedback/            # Status feedback
└── telemetry/           # Data telemetri
    ├── queue.json
    └── session-sync-queue.json
```

**Direktori tingkat proyek** (di root workspace Anda):

```
<project>/.autohand/
├── settings.local.json  # Izin proyek lokal (tambahkan ke gitignore)
├── memory/              # Memori khusus proyek
└── skills/              # Skill khusus proyek
```

---

## Flag CLI (Mengganti Konfigurasi)

Flag-flag ini mengganti pengaturan file konfigurasi:

| Flag | Deskripsi |
|------|-----------|
| `--model <model>` | Ganti model |
| `--path <path>` | Ganti root workspace |
| `--add-dir <path>` | Tambahkan direktori tambahan ke lingkup workspace (dapat digunakan beberapa kali) |
| `--config <path>` | Gunakan file konfigurasi kustom |
| `--temperature <n>` | Atur temperature (0-1) |
| `--yes` | Konfirmasi otomatis prompt |
| `--dry-run` | Pratinjau tanpa eksekusi |
| `--unrestricted` | Tanpa prompt persetujuan |
| `--restricted` | Tolak operasi berbahaya |
| `--setup` | Jalankan wizard setup untuk mengkonfigurasi atau mengkonfigurasi ulang Autohand |

---

## Dukungan Multi-Direktori

Autohand dapat bekerja dengan beberapa direktori di luar workspace utama. Ini berguna ketika proyek Anda memiliki dependensi, library bersama, atau proyek terkait di direktori yang berbeda.

### Flag CLI

Gunakan `--add-dir` untuk menambahkan direktori tambahan (dapat digunakan beberapa kali):

```bash
# Tambahkan satu direktori tambahan
autohand --add-dir /path/to/shared-lib

# Tambahkan beberapa direktori
autohand --add-dir /path/to/lib1 --add-dir /path/to/lib2

# Dengan mode unrestricted (auto-approve penulisan ke semua direktori)
autohand --add-dir /path/to/shared-lib --unrestricted
```

### Perintah Interaktif

Gunakan `/add-dir` selama sesi interaktif:

```
/add-dir              # Tampilkan direktori saat ini
/add-dir /path/to/dir # Tambahkan direktori baru
```

### Pembatasan Keamanan

Direktori berikut tidak dapat ditambahkan:
- Direktori home (`~` atau `$HOME`)
- Direktori root (`/`)
- Direktori sistem (`/etc`, `/var`, `/usr`, `/bin`, `/sbin`)
- Direktori sistem Windows (`C:\Windows`, `C:\Program Files`)
- Direktori pengguna Windows (`C:\Users\username`)
- Mount WSL Windows (`/mnt/c`, `/mnt/c/Windows`)
