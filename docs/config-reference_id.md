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
- [Mode Patch](#mode-patch)
- [Pengaturan Jaringan](#pengaturan-jaringan)
- [Pengaturan Telemetri](#pengaturan-telemetri)
- [Agent Eksternal](#agent-eksternal)
- [Pengaturan API](#pengaturan-api)
- [Pengaturan Autentikasi](#pengaturan-autentikasi)
- [Pengaturan Skill Komunitas](#pengaturan-skill-komunitas)
- [Pengaturan Berbagi](#pengaturan-berbagi)
- [Sinkronisasi Pengaturan](#sinkronisasi-pengaturan)
- [Pengaturan Hook](#pengaturan-hook)
- [Pengaturan MCP](#pengaturan-mcp)
- [Pengaturan Ekstensi Chrome](#pengaturan-ekstensi-chrome)
- [Sistem Skill](#sistem-skill)
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

| Variabel           | Deskripsi                                 | Contoh                    |
| ------------------ | ----------------------------------------- | ------------------------- |
| `AUTOHAND_HOME`    | Direktori dasar untuk semua data Autohand | `/custom/path`            |
| `AUTOHAND_CONFIG`  | Path file konfigurasi kustom              | `/path/to/config.json`    |
| `AUTOHAND_API_URL` | Endpoint API (mengganti konfigurasi)      | `https://api.autohand.ai` |
| `AUTOHAND_CLIENT_VERSION`              | Versi klien (diatur oleh ekstensi ACP)          | `0.169.0`                        |
| `AUTOHAND_CODE`                        | Penanda deteksi lingkungan (diatur otomatis)   | `1`                              |
| `AUTOHAND_SECRET`  | Kunci rahasia perusahaan/tim              | `sk-xxx`                  |

---

## Pengaturan Provider

### `provider`

Provider LLM aktif yang akan digunakan.

| Nilai          | Deskripsi                  |
| -------------- | -------------------------- |
| `"openrouter"` | API OpenRouter (default)   |
| `"ollama"`     | Instance Ollama lokal      |
| `"llamacpp"`   | Server llama.cpp lokal     |
| `"openai"`     | API OpenAI secara langsung |

### `openrouter`

Konfigurasi provider OpenRouter.

```json
{
  "openrouter": {
    "apiKey": "sk-or-v1-xxx",
    "baseUrl": "https://openrouter.ai/api/v1",
    "model": "your-modelcard-id-here"
  }
}
```

| Field     | Tipe   | Wajib | Default                        | Deskripsi                                        |
| --------- | ------ | ----- | ------------------------------ | ------------------------------------------------ |
| `apiKey`  | string | Ya    | -                              | Kunci API OpenRouter Anda                        |
| `baseUrl` | string | Tidak | `https://openrouter.ai/api/v1` | Endpoint API                                     |
| `model`   | string | Ya    | -                              | Identifier model (mis. `your-modelcard-id-here`) |

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

| Field     | Tipe   | Wajib | Default                  | Deskripsi                                 |
| --------- | ------ | ----- | ------------------------ | ----------------------------------------- |
| `baseUrl` | string | Tidak | `http://localhost:11434` | URL server Ollama                         |
| `port`    | number | Tidak | `11434`                  | Port server (alternatif untuk baseUrl)    |
| `model`   | string | Ya    | -                        | Nama model (mis. `llama3.2`, `codellama`) |

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

| Field     | Tipe   | Wajib | Default                 | Deskripsi            |
| --------- | ------ | ----- | ----------------------- | -------------------- |
| `baseUrl` | string | Tidak | `http://localhost:8080` | URL server llama.cpp |
| `port`    | number | Tidak | `8080`                  | Port server          |
| `model`   | string | Ya    | -                       | Identifier model     |

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

| Field     | Tipe   | Wajib | Default                     | Deskripsi                                 |
| --------- | ------ | ----- | --------------------------- | ----------------------------------------- |
| `apiKey`  | string | Ya    | -                           | Kunci API OpenAI                          |
| `baseUrl` | string | Tidak | `https://api.openai.com/v1` | Endpoint API                              |
| `model`   | string | Ya    | -                           | Nama model (mis. `gpt-4o`, `gpt-4o-mini`) |

### `mlx`

Provider MLX untuk Mac Apple Silicon (inferensi lokal).

```json
{
  "mlx": {
    "baseUrl": "http://localhost:8080",
    "port": 8080,
    "model": "mlx-community/Llama-3.2-3B-Instruct-4bit"
  }
}
```

| Kolom     | Tipe   | Wajib | Default                 | Deskripsi               |
| --------- | ------ | ----- | ----------------------- | ----------------------- |
| `baseUrl` | string | Tidak | `http://localhost:8080` | URL server MLX          |
| `port`    | number | Tidak | `8080`                  | Port server             |
| `model`   | string | Ya    | -                       | Pengidentifikasi model MLX |

### `llmgateway`

Konfigurasi API Terpadu LLM Gateway. Memberikan akses ke beberapa penyedia LLM melalui satu API.

```json
{
  "llmgateway": {
    "apiKey": "your-llmgateway-api-key",
    "baseUrl": "https://api.llmgateway.io/v1",
    "model": "gpt-4o"
  }
}
```

| Kolom     | Tipe   | Wajib | Default                        | Deskripsi                                               |
| --------- | ------ | ----- | ------------------------------ | ------------------------------------------------------- |
| `apiKey`  | string | Ya    | -                              | Kunci API LLM Gateway                                   |
| `baseUrl` | string | Tidak | `https://api.llmgateway.io/v1` | Endpoint API                                            |
| `model`   | string | Ya    | -                              | Nama model (misal `gpt-4o`, `claude-3-5-sonnet-20241022`) |

**Mendapatkan Kunci API:**
Kunjungi [llmgateway.io/dashboard](https://llmgateway.io/dashboard) untuk membuat akun dan mendapatkan kunci API Anda.

**Model yang Didukung:**
LLM Gateway mendukung model dari berbagai penyedia termasuk:

- OpenAI: `gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo`
- Anthropic: `claude-3-5-sonnet-20241022`, `claude-3-5-haiku-20241022`
- Google: `gemini-1.5-pro`, `gemini-1.5-flash`

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

| Field               | Tipe    | Default            | Deskripsi                                   |
| ------------------- | ------- | ------------------ | ------------------------------------------- |
| `defaultRoot`       | string  | Direktori saat ini | Workspace default ketika tidak ditentukan   |
| `allowDangerousOps` | boolean | `false`            | Izinkan operasi destruktif tanpa konfirmasi |

### Keamanan Workspace

Autohand secara otomatis memblokir operasi di direktori berbahaya untuk mencegah kerusakan yang tidak disengaja:

- **Root sistem file** (`/`, `C:\`, `D:\`, dll.)
- **Direktori home** (`~`, `/Users/<user>`, `/home/<user>`, `C:\Users\<user>`)
- **Direktori sistem** (`/etc`, `/var`, `/System`, `C:\Windows`, dll.)
- **Mount WSL Windows** (`/mnt/c`, `/mnt/c/Users/<user>`)

Pemeriksaan ini tidak dapat ditimpa. Jika Anda mencoba menjalankan autohand dari direktori berbahaya, Anda akan mendapatkan kesalahan dan harus menentukan direktori proyek yang aman.

```bash
# Ini akan diblokir
cd ~ && autohand
# Error: Direktori Workspace Tidak Aman

# Ini berfungsi
cd ~/projects/my-app && autohand
```

Lihat [Keamanan Workspace](./workspace-safety.md) untuk detail lengkap.

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

| Field                        | Tipe                  | Default  | Deskripsi                                                                                             |
| ---------------------------- | --------------------- | -------- | ----------------------------------------------------------------------------------------------------- |
| `theme`                      | `"dark"` \| `"light"` | `"dark"` | Tema warna untuk output terminal                                                                      |
| `autoConfirm`                | boolean               | `false`  | Lewati prompt konfirmasi untuk operasi aman                                                           |
| `readFileCharLimit`          | number                | `300`    | Karakter maksimum yang ditampilkan dari output tool baca/cari (konten lengkap tetap dikirim ke model) |
| `showCompletionNotification` | boolean               | `true`   | Tampilkan notifikasi sistem saat tugas selesai                                                        |
| `showThinking`               | boolean               | `true`   | Tampilkan proses penalaran/pemikiran LLM                                                              |
| `useInkRenderer`             | boolean               | `false`  | Gunakan renderer berbasis Ink untuk UI tanpa kedipan (eksperimental)                                  |
| `terminalBell`               | boolean               | `true`   | Bunyikan bel terminal saat tugas selesai (menampilkan badge di tab/dock terminal)                     |
| `checkForUpdates`            | boolean               | `true`   | Periksa pembaruan CLI saat startup                                                                    |
| `updateCheckInterval`        | number                | `24`     | Jam antara pemeriksaan pembaruan (gunakan hasil cache dalam interval)                                 |

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
    "enableRequestQueue": true,
    "debug": false
  }
}

| Field               | Tipe    | Default | Deskripsi                                                              |
| ------------------- | ------- | ------- | ---------------------------------------------------------------------- |
| `maxIterations`      | number  | `100`   | Maksimum iterasi alat per permintaan pengguna sebelum berhenti         |
| `enableRequestQueue` | boolean | `true`  | Izinkan pengguna mengetik dan mengantre permintaan saat agent bekerja |
| `debug`              | boolean | `false` | Aktifkan output debug verbose (log status internal agent ke stderr)     |

### Mode Debug

Aktifkan mode debug untuk melihat logging verbose status internal agent (iterasi loop react, pembangunan prompt, detail sesi). Output masuk ke stderr agar tidak mengganggu output normal.

Tiga cara untuk mengaktifkan mode debug (dalam urutan prioritas):

1. **Flag CLI**: `autohand -d` atau `autohand --debug`
2. **Variabel Lingkungan**: `AUTOHAND_DEBUG=1`
3. **File Konfigurasi**: Atur `agent.debug: true`

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

| Nilai            | Deskripsi                                           |
| ---------------- | --------------------------------------------------- |
| `"interactive"`  | Minta persetujuan untuk operasi berbahaya (default) |
| `"unrestricted"` | Tanpa prompt, izinkan semua                         |
| `"restricted"`   | Tolak semua operasi berbahaya                       |

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

| Field     | Tipe                                | Deskripsi                                     |
| --------- | ----------------------------------- | --------------------------------------------- |
| `tool`    | string                              | Nama tool untuk dicocokkan                    |
| `pattern` | string                              | Pola opsional untuk dicocokkan dengan argumen |
| `action`  | `"allow"` \| `"deny"` \| `"prompt"` | Tindakan yang diambil                         |

### `rememberSession`

| Tipe    | Default | Deskripsi                              |
| ------- | ------- | -------------------------------------- |
| boolean | `true`  | Ingat keputusan persetujuan untuk sesi |

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

### Melihat Izin

Anda dapat melihat konfigurasi izin saat ini dengan dua cara:

**Flag CLI (Non-interaktif):**

```bash
autohand --permissions
```

Ini menampilkan:

- Mode izin saat ini (interactive, unrestricted, restricted)
- Path workspace dan file konfigurasi
- Semua pola yang disetujui (whitelist)
- Semua pola yang ditolak (blacklist)
- Statistik ringkasan

**Perintah Interaktif:**

```
/permissions
```

Dalam mode interaktif, perintah `/permissions` memberikan informasi yang sama ditambah opsi untuk:

- Menghapus item dari whitelist
- Menghapus item dari blacklist
- Membersihkan semua izin yang tersimpan

---

## Mode Patch

Mode patch memungkinkan Anda menghasilkan patch yang kompatibel dengan git tanpa memodifikasi file workspace Anda. Ini berguna untuk:

- Tinjauan kode sebelum menerapkan perubahan
- Berbagi perubahan yang dihasilkan AI dengan anggota tim
- Membuat set perubahan yang dapat direproduksi
- Pipeline CI/CD yang perlu menangkap perubahan tanpa menerapkannya

### Penggunaan

```bash
# Hasilkan patch ke stdout
autohand --prompt "tambahkan autentikasi pengguna" --patch

# Simpan ke file
autohand --prompt "tambahkan autentikasi pengguna" --patch --output auth.patch

# Pipe ke file (alternatif)
autohand --prompt "refactor handler api" --patch > refactor.patch
```

### Perilaku

Ketika `--patch` ditentukan:

- **Auto-konfirmasi**: Semua prompt secara otomatis diterima (`--yes` implisit)
- **Tanpa prompt**: Tidak ada prompt persetujuan yang ditampilkan (`--unrestricted` implisit)
- **Hanya pratinjau**: Perubahan ditangkap tetapi TIDAK ditulis ke disk
- **Keamanan diterapkan**: Operasi yang masuk daftar hitam (`.env`, kunci SSH, perintah berbahaya) tetap diblokir

### Menerapkan Patch

Penerima dapat menerapkan patch menggunakan perintah git standar:

```bash
# Periksa apa yang akan diterapkan (dry-run)
git apply --check changes.patch

# Terapkan patch
git apply changes.patch

# Terapkan dengan merge 3-way (penanganan konflik yang lebih baik)
git apply -3 changes.patch

# Terapkan dan stage perubahan
git apply --index changes.patch

# Kembalikan patch
git apply -R changes.patch
```

### Format Patch

Patch yang dihasilkan mengikuti format diff terpadu git:

```diff
diff --git a/src/auth.ts b/src/auth.ts
new file mode 100644
--- /dev/null
+++ b/src/auth.ts
@@ -0,0 +1,15 @@
+export function authenticate(user: string, password: string) {
+  // Implementasi di sini
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

### Kode Keluar

| Kode | Arti                                                |
| ---- | --------------------------------------------------- |
| `0`  | Sukses, patch dihasilkan                            |
| `1`  | Kesalahan (`--prompt` hilang, izin ditolak, dll.) |

### Menggabungkan dengan Flag Lain

```bash
# Gunakan model tertentu
autohand --prompt "optimalkan query" --patch --model gpt-4o

# Tentukan workspace
autohand --prompt "tambahkan test" --patch --path ./my-project

# Gunakan konfigurasi kustom
autohand --prompt "refactor" --patch --config ~/.autohand/work.json
```

### Contoh Alur Kerja Tim

```bash
# Developer A: Hasilkan patch untuk fitur
autohand --prompt "implementasikan dashboard pengguna dengan grafik" --patch --output dashboard.patch

# Bagikan melalui git (buat PR dengan hanya file patch)
git checkout -b patch/dashboard
git add dashboard.patch
git commit -m "Add dashboard feature patch"
git push

# Developer B: Tinjau dan terapkan
git fetch origin patch/dashboard
git apply dashboard.patch
# Jalankan test, tinjau kode, lalu commit
git add -A && git commit -m "feat: add user dashboard with charts"
```

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

| Field        | Tipe   | Default | Maks | Deskripsi                                       |
| ------------ | ------ | ------- | ---- | ----------------------------------------------- |
| `maxRetries` | number | `3`     | `5`  | Percobaan retry untuk permintaan API yang gagal |
| `timeout`    | number | `30000` | -    | Timeout permintaan dalam milidetik              |
| `retryDelay` | number | `1000`  | -    | Jeda antara retry dalam milidetik               |

---

## Pengaturan Telemetri

Telemetri **dinonaktifkan secara default** (opt-in). Aktifkan untuk membantu meningkatkan Autohand.

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

| Kolom               | Tipe    | Default                   | Deskripsi                                |
| ------------------- | ------- | ------------------------- | ---------------------------------------- |
| `enabled`           | boolean | `false`                   | Aktifkan/nonaktifkan telemetri (opt-in)  |
| `apiBaseUrl`        | string  | `https://api.autohand.ai` | Endpoint API telemetri                   |
| `batchSize`         | number  | `20`                      | Jumlah event untuk batch sebelum auto-flush |
| `flushIntervalMs`   | number  | `60000`                   | Interval flush dalam milidetik (1 menit) |
| `maxQueueSize`      | number  | `500`                     | Ukuran maksimum antrian sebelum event lama dihapus |
| `maxRetries`        | number  | `3`                       | Percobaan ulang untuk permintaan telemetri yang gagal |
| `enableSessionSync` | boolean | `false`                   | Sinkronkan sesi ke cloud untuk fitur tim |
| `companySecret`     | string  | `""`                      | Rahasia perusahaan untuk otentikasi API  |

---

## Agent Eksternal

Muat definisi agent kustom dari direktori eksternal.

```json
{
  "externalAgents": {
    "enabled": true,
    "paths": ["~/.autohand/agents", "/team/shared/agents"]
  }
}
```

| Field     | Tipe     | Default | Deskripsi                         |
| --------- | -------- | ------- | --------------------------------- |
| `enabled` | boolean  | `false` | Aktifkan pemuatan agent eksternal |
| `paths`   | string[] | `[]`    | Direktori untuk memuat agent      |

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

| Field           | Tipe   | Default                   | Deskripsi                                  |
| --------------- | ------ | ------------------------- | ------------------------------------------ |
| `baseUrl`       | string | `https://api.autohand.ai` | Endpoint API                               |
| `companySecret` | string | -                         | Rahasia tim/perusahaan untuk fitur bersama |

Juga dapat diatur melalui variabel lingkungan:

- `AUTOHAND_API_URL` → `api.baseUrl`
- `AUTOHAND_SECRET` → `api.companySecret`

---

## Pengaturan Autentikasi

Konfigurasi autentikasi untuk sumber daya yang dilindungi.

```json
{
  "auth": {
    "token": "your-auth-token",
    "refreshToken": "your-refresh-token",
    "expiresAt": "2024-12-31T23:59:59Z"
  }
}
```

| Kolom          | Tipe   | Wajib | Deskripsi                                    |
| -------------- | ------ | ----- | --------------------------------------------- |
| `token`        | string | Ya    | Token akses saat ini                          |
| `refreshToken` | string | Tidak | Token untuk memperbarui token akses          |
| `expiresAt`    | string | Tidak | Tanggal/waktu kedaluwarsa token (ISO format) |

---

## Pengaturan Skill Komunitas

Konfigurasi untuk registri skill komunitas.

```json
{
  "communitySkills": {
    "registryUrl": "https://skills.autohand.ai",
    "cacheDuration": 3600,
    "autoUpdate": false
  }
}
```

| Kolom           | Tipe    | Default                        | Deskripsi                                           |
| --------------- | ------- | ------------------------------ | ----------------------------------------------------- |
| `registryUrl`   | string  | `https://skills.autohand.ai` | URL dasar registri skill                              |
| `cacheDuration` | number  | `3600`                         | Durasi cache dalam detik                              |
| `autoUpdate`    | boolean | `false`                        | Perbarui skill secara otomatis saat usang             |

---

## Pengaturan Berbagi

Kontrol cara berbagi sesi dan workspace.

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

| Kolom               | Tipe    | Default       | Deskripsi                                           |
| ------------------- | ------- | -------------- | ----------------------------------------------------- |
| `enabled`           | boolean | `true`         | Aktifkan fitur berbagi                              |
| `defaultVisibility` | string  | `"private"`    | Visibilitas default: `private`, `team`, `public`    |
| `allowPublicLinks`  | boolean | `false`        | Izinkan pembuatan tautan publik                       |
| `requireApproval`   | boolean | `true`         | Memerlukan persetujuan sebelum berbagi              |

---

## Sinkronisasi Pengaturan

Sinkronkan pengaturan Anda antar perangkat.

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

| Kolom                | Tipe    | Default       | Deskripsi                                              |
| -------------------- | ------- | -------------- | -------------------------------------------------------- |
| `enabled`            | boolean | `false`        | Aktifkan sinkronisasi pengaturan                       |
| `autoSync`           | boolean | `true`         | Sinkronkan otomatis saat ada perubahan                |
| `syncInterval`       | number  | `300`          | Interval sinkronisasi dalam detik                       |
| `conflictResolution` | string  | `"ask"`        | Cara menyelesaikan konflik: `ask`, `local`, `remote`   |

---

## Pengaturan Hook

Konfigurasi hook kustom untuk peristiwa Autohand.

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

| Kolom         | Tipe   | Deskripsi                                           |
| -------------- | ------ | ----------------------------------------------------- |
| `preCommand`  | string | Skrip dijalankan sebelum setiap perintah             |
| `postCommand` | string | Skrip dijalankan setelah setiap perintah             |
| `onError`     | string | Skrip dijalankan saat terjadi kesalahan              |
| `onComplete`  | string | Skrip dijalankan saat tugas selesai                  |

Variabel lingkungan yang tersedia di hook:

- `AUTOHAND_HOOK_TYPE` - Tipe hook (`preCommand`, `postCommand`, dll.)
- `AUTOHAND_COMMAND` - Perintah yang sedang dijalankan
- `AUTOHAND_EXIT_CODE` - Kode keluar (hanya `postCommand` dan `onError`)
- `AUTOHAND_SESSION_ID` - ID sesi saat ini

---

## Pengaturan MCP

Konfigurasi Model Context Protocol (MCP) untuk integrasi dengan server alat.

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

| Kolom     | Tipe   | Deskripsi                                           |
| --------- | ------ | ----------------------------------------------------- |
| `command` | string | Perintah untuk memulai server MCP                     |
| `args`    | array  | Argumen untuk perintah                                 |
| `env`     | object | Variabel lingkungan tambahan                           |

Server MCP menyediakan alat tambahan yang dapat dipanggil oleh agent. Setiap server diidentifikasi dengan nama unik dan dimulai secara otomatis saat diperlukan.

---

## Pengaturan Ekstensi Chrome

Pengaturan untuk ekstensi Chrome Autohand.

```json
{
  "chrome": {
    "extensionId": "your-extension-id",
    "nativeMessaging": true,
    "autoLaunch": false,
    "preferredBrowser": "chrome"
  }
}
```

| Kolom              | Tipe    | Default       | Deskripsi                                           |
| ------------------ | ------- | -------------- | ----------------------------------------------------- |
| `extensionId`      | string  | -              | ID ekstensi Chrome yang terinstal                     |
| `nativeMessaging`  | boolean | `true`         | Aktifkan komunikasi melalui native messaging          |
| `autoLaunch`       | boolean | `false`        | Buka Chrome secara otomatis saat startup              |
| `preferredBrowser` | string  | `"chrome"`     | Browser pilihan: `chrome`, `chromium`, `edge`, `brave` |

Ekstensi Chrome memungkinkan interaksi dengan halaman web dan otomasi browser. Native messaging memungkinkan komunikasi dua arah antara CLI dan ekstensi.

---

## Sistem Skill

Skill adalah paket instruksi yang memberikan instruksi khusus ke agen AI. Mereka bekerja seperti file `AGENTS.md` sesuai permintaan yang dapat diaktifkan untuk tugas spesifik.

### Lokasi Penemuan Skill

Skill ditemukan dari beberapa lokasi, dengan sumber yang lebih baru memiliki prioritas:

| Lokasi                                  | ID Sumber        | Deskripsi                              |
| --------------------------------------- | ---------------- | --------------------------------------- |
| `~/.codex/skills/**/SKILL.md`          | `codex-user`     | Skill pengguna Codex (rekursif)        |
| `~/.claude/skills/*/SKILL.md`          | `claude-user`    | Skill pengguna Claude (satu level)     |
| `~/.autohand/skills/**/SKILL.md`      | `autohand-user`  | Skill pengguna Autohand (rekursif)     |
| `<proyek>/.claude/skills/*/SKILL.md`  | `claude-project` | Skill proyek Claude (satu level)       |
| `<proyek>/.autohand/skills/**/SKILL.md` | `autohand-project` | Skill proyek Autohand (rekursif)       |

### Perilaku Auto-Salin

Skill yang ditemukan dari lokasi Codex atau Claude secara otomatis disalin ke lokasi Autohand yang sesuai:

- `~/.codex/skills/` dan `~/.claude/skills/` → `~/.autohand/skills/`
- `<proyek>/.claude/skills/` → `<proyek>/.autohand/skills/`

Skill yang sudah ada di lokasi Autohand tidak pernah ditimpa.

### Format SKILL.md

Skill menggunakan frontmatter YAML diikuti dengan konten markdown:

```markdown
---
name: my-skill-name
description: Deskripsi singkat skill
license: MIT
compatibility: Berfungsi dengan Node.js 18+
allowed-tools: read_file write_file run_command
metadata:
  author: your-name
  version: "1.0.0"
---

# My Skill

Instruksi detail untuk agen AI...
```

| Kolom           | Wajib | Maks Ukuran | Deskripsi                                      |
| ---------------- | ------ | ----------- | ------------------------------------------------ |
| `name`           | Ya     | 64 chars    | Huruf kecil alfanumerik dengan tanda hubung saja |
| `description`    | Ya     | 1024 chars  | Deskripsi singkat skill                          |
| `license`        | Tidak  | -           | ID lisensi (misal MIT, Apache-2.0)               |
| `compatibility`  | Tidak  | 500 chars   | Catatan kompatibilitas                           |
| `allowed-tools`  | Tidak  | -           | Daftar alat yang diizinkan dipisahkan spasi     |
| `metadata`       | Tidak  | -           | Metadata tambahan kunci-nilai                    |

### Awalan Input

Autohand mendukung awalan khusus dalam input prompt:

| Awalan | Deskripsi                           | Contoh                            |
| ------- | ------------------------------ | ---------------------------------- |
| `/`     | Perintah slash                 | `/help`, `/model`, `/quit`         |
| `@`     | Penyebutan file (auto-complete) | `@src/index.ts`                   |
| `$`     | Penyebutan skill (auto-complete) | `$frontend-design`, `$code-review` |
| `!`     | Jalankan perintah terminal langsung | `! git status`, `! ls -la`        |

**Penyebutan Skill (`$`):**

- Ketik setelah `$` untuk melihat skill yang tersedia dengan auto-complete
- Tab menerima saran utama (misalnya `$frontend-design`)
- Skill ditemukan dari `~/.autohand/skills/` dan `<proyek>/.autohand/skills/`
- Skill yang diaktifkan ditambahkan ke prompt sebagai instruksi khusus untuk sesi saat ini
- Panel pratinjau menampilkan metadata skill (nama, deskripsi, status aktivasi)

**Perintah Shell (`!`):**

- Dijalankan di direktori kerja saat ini
- Output ditampilkan langsung di terminal
- Tidak masuk ke LLM
- Batas waktu 30 detik
- Kembali ke prompt setelah eksekusi

### Perintah Slash

#### `/skills` — Manajer Paket

| Perintah                        | Deskripsi                                   |
| ------------------------------- | ------------------------------------------- |
| `/skills`                       | Daftar semua skill yang tersedia            |
| `/skills use <nama>`            | Aktifkan skill untuk sesi saat ini          |
| `/skills deactivate <nama>`     | Nonaktifkan skill                           |
| `/skills info <nama>`           | Tampilkan informasi detail skill            |
| `/skills install`               | Jelajahi dan instal dari registri komunitas |
| `/skills install @<slug>`       | Instal skill komunitas berdasarkan slug     |
| `/skills search <kueri>`        | Cari di registri skill komunitas            |
| `/skills trending`              | Tampilkan skill komunitas yang sedang tren  |
| `/skills remove <slug>`         | Hapus instalasi skill komunitas             |
| `/skills new`                   | Buat skill baru secara interaktif           |
| `/skills feedback <slug> <1-5>` | Beri rating skill komunitas                 |

#### `/learn` — Penasihat Skill Berbasis LLM

| Perintah        | Deskripsi                                                          |
| --------------- | ------------------------------------------------------------------ |
| `/learn`        | Analisis proyek dan rekomendasikan skill (pemindaian cepat)        |
| `/learn deep`   | Pemindaian mendalam (membaca file sumber) untuk hasil lebih akurat |
| `/learn update` | Analisis ulang proyek dan regenerasi skill LLM yang sudah usang    |

`/learn` menggunakan alur LLM dua fase:

1. **Fase 1 — Analisis + Peringkat + Audit**: Memindai struktur proyek, mengaudit skill terinstal untuk redundansi/konflik, dan memberi peringkat skill komunitas berdasarkan relevansi (0-100).
2. **Fase 2 — Generasi** (kondisional): Jika tidak ada skill komunitas yang mendapat skor di atas 60, menawarkan untuk menghasilkan skill kustom yang disesuaikan dengan proyek Anda.

### Generasi Skill Otomatis (`--auto-skill`)

Flag `--auto-skill` menghasilkan skill tanpa alur penasihat interaktif:

```bash
autohand --auto-skill
```

Ini akan:

1. Menganalisis struktur proyek (package.json, requirements.txt, dll.)
2. Mendeteksi bahasa, framework, dan pola
3. Menghasilkan 3 skill relevan menggunakan LLM
4. Menyimpan skill ke `<proyek>/.autohand/skills/`

Untuk pengalaman interaktif yang lebih tepat, gunakan `/learn` dalam sesi.

---

## Contoh Lengkap

### Format JSON (`~/.autohand/config.json`)

```json
{
  "provider": "openrouter",
  "openrouter": {
    "apiKey": "sk-or-v1-your-key-here",
    "baseUrl": "https://openrouter.ai/api/v1",
    "model": "your-modelcard-id-here"
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
    "token": "your-auth-token",
    "refreshToken": "your-refresh-token"
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

### Format YAML (`~/.autohand/config.yaml`)

```yaml
provider: openrouter

openrouter:
  apiKey: sk-or-v1-your-key-here
  baseUrl: https://openrouter.ai/api/v1
  model: your-modelcard-id-here

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
  token: your-auth-token
  refreshToken: your-refresh-token

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

| Flag                          | Deskripsi                                                                                                  |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `--model <model>`             | Ganti model                                                                                                |
| `--path <path>`               | Ganti root workspace                                                                                       |
| `--worktree [nama]`           | Jalankan sesi di git worktree terisolasi (nama worktree/branch opsional)                                   |
| `--tmux`                      | Jalankan dalam sesi tmux khusus (mengimplikasikan `--worktree`; tidak bisa dipakai dengan `--no-worktree`) |
| `--add-dir <path>`            | Tambahkan direktori tambahan ke lingkup workspace (dapat digunakan beberapa kali)                          |
| `--config <path>`             | Gunakan file konfigurasi kustom                                                                            |
| `--temperature <n>`           | Atur temperature (0-1)                                                                                     |
| `--yes`                       | Konfirmasi otomatis prompt                                                                                 |
| `--dry-run`                   | Pratinjau tanpa eksekusi                                                                                   |
| `--unrestricted`              | Tanpa prompt persetujuan                                                                                   |
| `--restricted`                | Tolak operasi berbahaya                                                                                    |
| `--setup`                     | Jalankan wizard setup untuk mengkonfigurasi atau mengkonfigurasi ulang Autohand                            |
| `--sys-prompt <nilai>`        | Ganti seluruh system prompt (string inline atau path file)                                                 |
| `--append-sys-prompt <nilai>` | Tambahkan ke system prompt (string inline atau path file)                                                  |
| `--auto-skill`                | Otomatis menghasilkan skill berdasarkan analisis proyek (lihat juga `/learn` untuk penasihat interaktif)   |

---

## Kustomisasi System Prompt

Autohand memungkinkan Anda untuk menyesuaikan system prompt yang digunakan oleh agen AI. Ini berguna untuk alur kerja khusus, instruksi kustom, atau integrasi dengan sistem lain.

### Flag CLI

| Flag                          | Deskripsi                                 |
| ----------------------------- | ----------------------------------------- |
| `--sys-prompt <nilai>`        | Ganti seluruh system prompt               |
| `--append-sys-prompt <nilai>` | Tambahkan konten ke system prompt default |

Kedua flag menerima:

- **String inline**: Konten teks langsung
- **Path file**: Path ke file yang berisi prompt (auto-detected)

### Deteksi Path File

Sebuah nilai diperlakukan sebagai path file jika:

- Dimulai dengan `./`, `../`, `/`, atau `~/`
- Dimulai dengan huruf drive Windows (misalnya, `C:\`)
- Diakhiri dengan `.txt`, `.md`, atau `.prompt`
- Berisi pemisah path tanpa spasi

Jika tidak, diperlakukan sebagai string inline.

### `--sys-prompt` (Penggantian Lengkap)

Ketika disediakan, ini **sepenuhnya menggantikan** system prompt default. Agen TIDAK akan memuat:

- Instruksi default Autohand
- Instruksi proyek AGENTS.md
- Memori pengguna/proyek
- Skill aktif

```bash
# String inline
autohand --sys-prompt "Anda adalah ahli Python. Singkat dan jelas." --prompt "Tulis hello world"

# Dari file
autohand --sys-prompt ./custom-prompt.txt --prompt "Jelaskan kode ini"
```

### `--append-sys-prompt` (Tambahkan ke Default)

Ketika disediakan, ini **menambahkan** konten ke system prompt default lengkap. Agen akan tetap memuat semua instruksi default.

```bash
# String inline
autohand --append-sys-prompt "Selalu gunakan TypeScript daripada JavaScript" --prompt "Buat sebuah fungsi"

# Dari file
autohand --append-sys-prompt ./team-guidelines.md --prompt "Tambahkan penanganan error"
```

### Prioritas

Ketika kedua flag disediakan:

1. `--sys-prompt` memiliki prioritas penuh
2. `--append-sys-prompt` diabaikan

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
