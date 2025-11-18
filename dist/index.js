#!/usr/bin/env node
import {
  metadata as metadata8
} from "./chunk-VRI7EXV6.js";
import {
  metadata as metadata9
} from "./chunk-ZVBRD2JP.js";
import {
  metadata as metadata10
} from "./chunk-GSOEIEOU.js";
import {
  metadata as metadata11
} from "./chunk-PBBPGIXF.js";
import {
  metadata
} from "./chunk-WTNF5HST.js";
import {
  metadata as metadata2
} from "./chunk-3DFMXEII.js";
import {
  metadata as metadata3
} from "./chunk-CWBKZYJL.js";
import {
  metadata as metadata4
} from "./chunk-KZ7VMQTC.js";
import {
  metadata as metadata5
} from "./chunk-CV5GVS4W.js";
import {
  metadata as metadata6
} from "./chunk-TDCQRNIQ.js";
import {
  metadata as metadata7
} from "./chunk-KDA4BGOC.js";

// src/index.ts
import { Command } from "commander";
import chalk5 from "chalk";

// package.json
var package_default = {
  name: "autohand-cli",
  version: "0.1.0",
  description: "Autohand interactive coding agent CLI powered by LLMs.",
  type: "module",
  bin: {
    autohand: "dist/index.js"
  },
  main: "dist/index.js",
  files: [
    "dist"
  ],
  scripts: {
    build: "tsup src/index.ts --format esm,cjs --dts",
    dev: "tsx src/index.ts",
    typecheck: "tsc --noEmit",
    lint: "eslint .",
    test: "vitest run",
    start: "node dist/index.js"
  },
  keywords: [
    "cli",
    "llm",
    "agent",
    "autohand"
  ],
  engines: {
    node: ">=18.17.0"
  },
  dependencies: {
    chalk: "^5.6.2",
    commander: "^14.0.2",
    diff: "^8.0.2",
    enquirer: "^2.4.1",
    "fs-extra": "^11.3.2",
    ignore: "^5.3.1",
    ink: "^4.4.1",
    ora: "^9.0.0",
    react: "^18.2.0",
    "terminal-link": "^3.0.0"
  },
  devDependencies: {
    "@types/diff": "^8.0.0",
    "@types/fs-extra": "^11.0.4",
    "@types/node": "^24.10.1",
    "@types/react": "^18.3.3",
    "@types/terminal-link": "^1.2.0",
    tsup: "^8.5.1",
    tsx: "^4.20.6",
    typescript: "^5.9.3",
    vitest: "^1.6.0"
  }
};

// src/config.ts
import fs from "fs-extra";
import os from "os";
import path from "path";
var DEFAULT_CONFIG_PATH = path.join(os.homedir(), ".autohand-cli", "config.json");
var DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
async function loadConfig(customPath) {
  const envPath = process.env.AUTOHAND_CONFIG;
  const configPath = path.resolve(customPath ?? envPath ?? DEFAULT_CONFIG_PATH);
  await fs.ensureDir(path.dirname(configPath));
  if (!await fs.pathExists(configPath)) {
    const defaultConfig = {
      openrouter: {
        apiKey: "replace-me",
        baseUrl: "https://openrouter.ai/api/v1",
        model: "anthropic/claude-3.5-sonnet"
      },
      workspace: {
        defaultRoot: process.cwd(),
        allowDangerousOps: false
      },
      ui: {
        theme: "dark",
        autoConfirm: false
      }
    };
    await fs.writeJson(configPath, defaultConfig, { spaces: 2 });
    throw new Error(
      `Created default config at ${configPath}. Please update it with your OpenRouter credentials before rerunning.`
    );
  }
  let parsed;
  try {
    parsed = await fs.readJSON(configPath);
  } catch (error) {
    throw new Error(`Failed to parse config at ${configPath}: ${error.message}`);
  }
  const normalized = normalizeConfig(parsed);
  validateConfig(normalized, configPath);
  return { ...normalized, configPath };
}
function normalizeConfig(config) {
  if (isModernConfig(config)) {
    return config;
  }
  if (isLegacyConfig(config)) {
    return {
      openrouter: {
        apiKey: config.api_key ?? "replace-me",
        baseUrl: config.base_url ?? DEFAULT_BASE_URL,
        model: config.model ?? "anthropic/claude-3.5-sonnet"
      },
      workspace: {
        defaultRoot: process.cwd(),
        allowDangerousOps: false
      },
      ui: {
        autoConfirm: config.dry_run ?? false,
        theme: "dark"
      }
    };
  }
  return config;
}
function isModernConfig(config) {
  return typeof config.openrouter === "object" && config.openrouter !== null;
}
function isLegacyConfig(config) {
  return typeof config.api_key === "string";
}
function validateConfig(config, configPath) {
  if (!config.openrouter || typeof config.openrouter !== "object") {
    throw new Error(`Missing openrouter configuration in ${configPath}`);
  }
  const { apiKey, baseUrl, model } = config.openrouter;
  if (typeof apiKey !== "string" || !apiKey || apiKey === "replace-me") {
    throw new Error(`Set a valid openrouter.apiKey in ${configPath}`);
  }
  if (baseUrl !== void 0 && typeof baseUrl !== "string") {
    throw new Error(`openrouter.baseUrl must be a string in ${configPath}`);
  }
  if (typeof model !== "string" || !model) {
    throw new Error(`Set a default OpenRouter model in ${configPath}`);
  }
  if (config.workspace) {
    if (config.workspace.defaultRoot && typeof config.workspace.defaultRoot !== "string") {
      throw new Error(`workspace.defaultRoot must be a string in ${configPath}`);
    }
    if (config.workspace.allowDangerousOps !== void 0 && typeof config.workspace.allowDangerousOps !== "boolean") {
      throw new Error(`workspace.allowDangerousOps must be boolean in ${configPath}`);
    }
  }
  if (config.ui) {
    if (config.ui.theme && config.ui.theme !== "dark" && config.ui.theme !== "light") {
      throw new Error(`ui.theme must be 'dark' or 'light' in ${configPath}`);
    }
    if (config.ui.autoConfirm !== void 0 && typeof config.ui.autoConfirm !== "boolean") {
      throw new Error(`ui.autoConfirm must be boolean in ${configPath}`);
    }
  }
}
function resolveWorkspaceRoot(config, requestedPath) {
  const candidate = requestedPath ?? config.workspace?.defaultRoot ?? process.cwd();
  return path.resolve(candidate);
}
async function saveConfig(config) {
  const { configPath, ...data } = config;
  await fs.writeJson(configPath, data, { spaces: 2 });
}

// src/actions/filesystem.ts
import fs2 from "fs-extra";
import path2 from "path";
import { spawnSync } from "child_process";
import { applyPatch as applyUnifiedPatch } from "diff";
var FileActionManager = class {
  constructor(workspaceRoot) {
    this.undoStack = [];
    this.workspaceRoot = path2.resolve(workspaceRoot);
  }
  get root() {
    return this.workspaceRoot;
  }
  async readFile(target) {
    const filePath = this.resolvePath(target);
    const exists = await fs2.pathExists(filePath);
    if (!exists) {
      throw new Error(`File ${target} not found in workspace.`);
    }
    return fs2.readFile(filePath, "utf8");
  }
  async writeFile(target, contents) {
    const filePath = this.resolvePath(target);
    await fs2.ensureDir(path2.dirname(filePath));
    const previous = await fs2.pathExists(filePath) ? await fs2.readFile(filePath, "utf8") : "";
    this.undoStack.push({ absolutePath: filePath, previousContents: previous });
    await fs2.writeFile(filePath, contents, "utf8");
  }
  async appendFile(target, contents) {
    const current = await this.readFileSafe(target);
    await this.writeFile(target, `${current}${contents}`);
  }
  async applyPatch(target, patch) {
    const filePath = this.resolvePath(target);
    const current = await this.readFileSafe(target);
    const updated = applyUnifiedPatch(current, patch);
    if (updated === false) {
      throw new Error(`Failed to apply patch to ${target}`);
    }
    this.undoStack.push({ absolutePath: filePath, previousContents: current });
    await fs2.writeFile(filePath, updated, "utf8");
  }
  async undoLast() {
    const entry = this.undoStack.pop();
    if (!entry) {
      throw new Error("Undo stack is empty");
    }
    await fs2.writeFile(entry.absolutePath, entry.previousContents, "utf8");
  }
  search(query, relativePath) {
    const searchDir = this.resolvePath(relativePath ?? ".");
    const rgResult = spawnSync("rg", ["--line-number", "--color", "never", query, "."], {
      cwd: searchDir,
      encoding: "utf8"
    });
    if (rgResult.status === 0 && rgResult.stdout) {
      return rgResult.stdout.trim().split("\n").filter(Boolean).map((line) => {
        const [file, lineNo, ...rest] = line.split(":");
        return {
          file: path2.relative(this.workspaceRoot, path2.join(searchDir, file)),
          line: Number(lineNo),
          text: rest.join(":")
        };
      });
    }
    return this.walkFallback(query, searchDir);
  }
  searchWithContext(query, options = {}) {
    const limit = options.limit ?? 10;
    const contextLines = options.context ?? 2;
    const results = this.search(query, options.relativePath);
    return results.slice(0, limit).map((hit) => this.renderContext(hit, contextLines)).join("\n\n");
  }
  async readFileSafe(target) {
    const filePath = this.resolvePath(target);
    if (!await fs2.pathExists(filePath)) {
      return "";
    }
    return fs2.readFile(filePath, "utf8");
  }
  resolvePath(target) {
    const normalized = path2.isAbsolute(target) ? target : path2.join(this.workspaceRoot, target);
    const resolved = path2.resolve(normalized);
    const rootWithSep = this.workspaceRoot.endsWith(path2.sep) ? this.workspaceRoot : `${this.workspaceRoot}${path2.sep}`;
    if (resolved !== this.workspaceRoot && !resolved.startsWith(rootWithSep)) {
      throw new Error(`Path ${target} escapes the workspace root ${this.workspaceRoot}`);
    }
    return resolved;
  }
  walkFallback(query, baseDir) {
    const hits = [];
    const stack = [baseDir];
    while (stack.length) {
      const current = stack.pop();
      if (!current) {
        continue;
      }
      const relative = path2.relative(this.workspaceRoot, current);
      if (relative.includes("node_modules") || relative.startsWith(".git") || relative.startsWith("dist")) {
        continue;
      }
      const stats = fs2.statSync(current);
      if (stats.isDirectory()) {
        const entries = fs2.readdirSync(current);
        for (const entry of entries) {
          stack.push(path2.join(current, entry));
        }
      } else if (stats.isFile()) {
        const contents = fs2.readFileSync(current, "utf8");
        const lines = contents.split(/\r?\n/);
        lines.forEach((line, idx) => {
          if (line.includes(query)) {
            hits.push({
              file: path2.relative(this.workspaceRoot, current),
              line: idx + 1,
              text: line.trim()
            });
          }
        });
      }
    }
    return hits;
  }
  async createDirectory(relativePath) {
    const dirPath = this.resolvePath(relativePath);
    await fs2.ensureDir(dirPath);
  }
  async deletePath(relativePath) {
    const fullPath = this.resolvePath(relativePath);
    const exists = await fs2.pathExists(fullPath);
    if (!exists) {
      throw new Error(`${relativePath} does not exist.`);
    }
    const stats = await fs2.stat(fullPath);
    this.undoStack.push({
      absolutePath: fullPath,
      previousContents: stats.isFile() ? await fs2.readFile(fullPath, "utf8") : ""
    });
    await fs2.remove(fullPath);
  }
  async renamePath(from, to) {
    const fromPath = this.resolvePath(from);
    const toPath = this.resolvePath(to);
    await fs2.ensureDir(path2.dirname(toPath));
    await fs2.move(fromPath, toPath, { overwrite: true });
  }
  async copyPath(from, to) {
    const fromPath = this.resolvePath(from);
    const toPath = this.resolvePath(to);
    await fs2.copy(fromPath, toPath, { overwrite: true });
  }
  async replaceInFile(relativePath, searchValue, replaceValue) {
    const current = await this.readFile(relativePath);
    const updated = current.replace(searchValue, replaceValue);
    await this.writeFile(relativePath, updated);
  }
  async formatFile(relativePath, formatter) {
    const current = await this.readFile(relativePath);
    const formatted = await formatter(current, relativePath);
    await this.writeFile(relativePath, formatted);
  }
  renderContext(hit, contextLines) {
    const filePath = this.resolvePath(hit.file);
    if (!fs2.existsSync(filePath)) {
      return `${hit.file}:${hit.line}`;
    }
    const contents = fs2.readFileSync(filePath, "utf8");
    const lines = contents.split(/\r?\n/);
    const start = Math.max(0, hit.line - 1 - contextLines);
    const end = Math.min(lines.length, hit.line - 1 + contextLines + 1);
    const snippet = lines.slice(start, end).map((line, idx) => {
      const number = start + idx + 1;
      const marker = number === hit.line ? ">" : " ";
      return `${marker} ${number.toString().padStart(4, " ")} | ${line}`;
    });
    return `${hit.file}:${hit.line}
${snippet.join("\n")}`;
  }
};

// src/openrouter.ts
var DEFAULT_BASE_URL2 = "https://openrouter.ai/api/v1";
var OpenRouterClient = class {
  constructor(settings) {
    this.apiKey = settings.apiKey;
    this.baseUrl = settings.baseUrl ?? DEFAULT_BASE_URL2;
    this.defaultModel = settings.model;
  }
  setDefaultModel(model) {
    this.defaultModel = model;
  }
  async complete(request) {
    const payload = {
      model: request.model ?? this.defaultModel,
      messages: request.messages,
      temperature: request.temperature ?? 0.2,
      max_tokens: request.maxTokens ?? 1e3,
      stream: request.stream ?? false
    };
    let response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          "HTTP-Referer": "https://github.com/autohand/cli",
          "X-Title": "autohand-cli"
        },
        body: JSON.stringify(payload),
        signal: request.signal
      });
    } catch (error) {
      throw new Error(
        `Failed to reach OpenRouter (${error.message}). Check your network connection or base URL.`
      );
    }
    if (!response.ok) {
      const friendly = await this.buildErrorMessage(response);
      throw new Error(friendly);
    }
    const json = await response.json();
    const text = json?.choices?.[0]?.message?.content ?? "";
    return {
      id: json.id ?? "autohand-local",
      created: json.created ?? Date.now(),
      content: text,
      raw: json
    };
  }
  async buildErrorMessage(response) {
    const status = response.status;
    const text = await response.text();
    try {
      const data = JSON.parse(text);
      const error = data?.error ?? {};
      const code = error.code;
      const message = error.metadata?.raw ?? error.message ?? text;
      if (status === 429) {
        return "You hit the rate limit for this OpenRouter model. Please try again later or choose another model in ~/.autohand-cli/config.json.";
      }
      return `OpenRouter request failed (${status}${code ? ` / ${code}` : ""}): ${message}`;
    } catch {
      return `OpenRouter request failed (${status}): ${text}`;
    }
  }
};

// src/core/agent.ts
import chalk4 from "chalk";
import fs7 from "fs-extra";
import path7 from "path";
import { spawnSync as spawnSync3 } from "child_process";
import ora from "ora";
import enquirer from "enquirer";
import readline2 from "readline";

// src/ui/inputPrompt.ts
import chalk from "chalk";
import readline from "readline";

// src/ui/terminalResize.ts
var TerminalResizeWatcher = class {
  constructor(stream, callback) {
    this.disposed = false;
    this.stream = stream;
    this.handler = () => {
      if (this.disposed) {
        return;
      }
      callback();
    };
    if (this.stream && typeof this.stream.on === "function") {
      this.stream.on("resize", this.handler);
    }
  }
  dispose() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    if (this.stream && typeof this.stream.off === "function") {
      this.stream.off("resize", this.handler);
    }
  }
};

// src/ui/commandPalette.tsx
import { useMemo, useState } from "react";
import { Box, Text, useInput, render } from "ink";
import { jsx, jsxs } from "react/jsx-runtime";
async function showCommandPalette(commands, statusLine) {
  if (!process.stdout.isTTY) {
    return commands[0]?.command ?? null;
  }
  return new Promise((resolve) => {
    let unmounted = false;
    const instance = render(
      /* @__PURE__ */ jsx(
        CommandPalette,
        {
          commands,
          statusLine,
          onSubmit: (value) => {
            if (unmounted) {
              return;
            }
            unmounted = true;
            instance.unmount();
            resolve(value);
          }
        }
      ),
      { exitOnCtrlC: false }
    );
  });
}
function CommandPalette({ commands, statusLine, onSubmit }) {
  const [filter, setFilter] = useState("/");
  const [cursor, setCursor] = useState(0);
  const filtered = useMemo(() => {
    const seed = filter.replace(/^\//, "").toLowerCase();
    if (!seed) {
      return commands;
    }
    return commands.filter((cmd) => cmd.command.replace("/", "").toLowerCase().includes(seed));
  }, [commands, filter]);
  const visibleCursor = filtered.length ? Math.min(cursor, filtered.length - 1) : 0;
  useInput((input, key) => {
    if (key.escape) {
      onSubmit(null);
      return;
    }
    if (key.return) {
      const item = filtered[visibleCursor];
      onSubmit(item?.command ?? null);
      return;
    }
    if (key.downArrow) {
      if (!filtered.length) {
        return;
      }
      setCursor((prev) => (prev + 1) % filtered.length);
      return;
    }
    if (key.upArrow) {
      if (!filtered.length) {
        return;
      }
      setCursor((prev) => (prev - 1 + filtered.length) % filtered.length);
      return;
    }
    if (key.backspace || key.delete) {
      setFilter((prev) => prev.length > 1 ? prev.slice(0, -1) : "/");
      setCursor(0);
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      setFilter((prev) => prev + input);
      setCursor(0);
    }
  });
  return /* @__PURE__ */ jsxs(Box, { flexDirection: "column", paddingX: 1, children: [
    statusLine ? /* @__PURE__ */ jsx(Text, { color: "gray", children: statusLine }) : null,
    /* @__PURE__ */ jsx(Text, { color: "cyan", children: "Command palette" }),
    /* @__PURE__ */ jsxs(Text, { children: [
      /* @__PURE__ */ jsx(Text, { color: "magenta", children: "Command: " }),
      /* @__PURE__ */ jsx(Text, { children: filter })
    ] }),
    /* @__PURE__ */ jsxs(Box, { flexDirection: "column", marginTop: 1, children: [
      filtered.length === 0 && /* @__PURE__ */ jsx(Text, { color: "gray", children: "No matching commands." }),
      filtered.map((cmd, index) => /* @__PURE__ */ jsxs(Text, { color: index === visibleCursor ? "cyan" : void 0, children: [
        index === visibleCursor ? "\u25B8" : " ",
        " ",
        cmd.command,
        " ",
        /* @__PURE__ */ jsxs(Text, { color: "gray", children: [
          "\u2014 ",
          cmd.description
        ] })
      ] }, cmd.command))
    ] }),
    /* @__PURE__ */ jsx(Text, { color: "gray", children: "Type to filter \xB7 \u2191/\u2193 navigate \xB7 Enter to run \xB7 Esc cancel" })
  ] });
}

// src/ui/inputPrompt.ts
async function readInstruction(files, slashCommands, statusLine, io = {}) {
  const stdInput = io.input ?? process.stdin;
  const stdOutput = io.output ?? process.stdout;
  const rl = readline.createInterface({
    input: stdInput,
    output: stdOutput,
    prompt: `${chalk.gray("\u203A")} `,
    terminal: true,
    crlfDelay: Infinity,
    historySize: 100,
    tabSize: 2
  });
  const input = rl.input;
  const supportsRawMode = typeof input.setRawMode === "function";
  if (supportsRawMode && input.isTTY) {
    input.setRawMode(true);
  }
  input.resume();
  input.setEncoding("utf8");
  const mentionPreview = new MentionPreview(rl, files, slashCommands, stdOutput, statusLine);
  const resizeWatcher = new TerminalResizeWatcher(stdOutput, () => {
    mentionPreview.handleResize();
    renderPromptLine(rl, statusLine, stdOutput);
  });
  let ctrlCCount = 0;
  let aborted = false;
  let settled = false;
  let paletteOpen = false;
  const cleanup = () => {
    mentionPreview.dispose();
    resizeWatcher.dispose();
  };
  const line = await new Promise((resolve) => {
    const finish = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      stdOutput.write(RESET_BG);
      if (supportsRawMode && input.isTTY) {
        input.setRawMode(false);
      }
      input.pause();
      rl.close();
      resolve(value);
    };
    const openPalette = async () => {
      if (paletteOpen) {
        return;
      }
      paletteOpen = true;
      cleanup();
      if (supportsRawMode && input.isTTY) {
        input.setRawMode(false);
      }
      input.pause();
      rl.close();
      try {
        const selection = await showCommandPalette(slashCommands, statusLine);
        finish(selection);
      } catch (error) {
        console.error(chalk.red(`Command palette failed: ${error.message}`));
        finish(null);
      }
    };
    rl.setPrompt(`${chalk.gray("\u203A")} `);
    rl.prompt(true);
    rl.on("line", (value) => {
      stdOutput.write("\n");
      finish(value.trim());
    });
    rl.on("SIGINT", () => {
      if (ctrlCCount === 0) {
        ctrlCCount = 1;
        mentionPreview.reset();
        stdOutput.write(`
${chalk.gray("Press Ctrl+C again to exit.")}
`);
        renderPromptLine(rl, statusLine, stdOutput);
        return;
      }
      aborted = true;
      finish(null);
    });
    input.on("keypress", (str, key) => {
      if (key?.name === "c" && key.ctrl) {
        if (ctrlCCount === 0) {
          ctrlCCount = 1;
          mentionPreview.reset();
          stdOutput.write(`
${chalk.gray("Press Ctrl+C again to exit.")}
`);
          renderPromptLine(rl, statusLine, stdOutput);
          return;
        }
        aborted = true;
        finish(null);
        return;
      }
      if (!paletteOpen && rl.cursor === 1 && rl.line === "/") {
        void openPalette();
      }
    });
  });
  if (aborted) {
    process.exit(0);
  }
  return line || null;
}
var MentionPreview = class {
  constructor(rl, files, slashCommands, output, statusLine) {
    this.rl = rl;
    this.files = files;
    this.slashCommands = slashCommands;
    this.output = output;
    this.mentionLines = 0;
    this.keypressHandler = null;
    this.slashMatches = [];
    this.fileSuggestions = [];
    this.mode = null;
    this.activeIndex = 0;
    this.disposed = false;
    this.lastSuggestions = [];
    const input = rl.input;
    readline.emitKeypressEvents(input, rl);
    this.statusLine = statusLine ? chalk.gray(statusLine) : void 0;
    this.keypressHandler = this.handleKeypress.bind(this);
    input.on("keypress", this.keypressHandler);
    this.render([]);
  }
  dispose() {
    const input = this.rl.input;
    if (this.keypressHandler) {
      input.off("keypress", this.keypressHandler);
    }
    this.disposed = true;
    this.clear();
  }
  reset() {
    this.clear();
    if (this.statusLine) {
      this.render([]);
    }
  }
  handleKeypress(_str, key) {
    if (this.disposed) {
      return;
    }
    const beforeCursor = this.rl.line.slice(0, this.rl.cursor);
    if (key?.name === "tab") {
      if (this.mode === "file" && this.fileSuggestions.length) {
        this.insertFileSuggestion(beforeCursor, this.fileSuggestions[this.activeIndex]);
        return;
      }
      if (this.mode === "slash" && this.slashMatches.length) {
        this.insertSlashSuggestion(beforeCursor, this.slashMatches[this.activeIndex]);
        return;
      }
      if (this.mode) {
        return;
      }
    }
    if ((key?.name === "down" || key?.name === "up") && this.mode && this.lastSuggestions.length) {
      const delta = key.name === "down" ? 1 : -1;
      const length = this.lastSuggestions.length;
      this.activeIndex = (this.activeIndex + delta + length) % length;
      this.render(this.lastSuggestions);
      return;
    }
    if (beforeCursor.startsWith("/")) {
      const seed2 = beforeCursor.slice(1);
      const slashSuggestions = this.filterSlash(seed2);
      if (slashSuggestions.length) {
        this.mode = "slash";
        this.activeIndex = Math.min(this.activeIndex, slashSuggestions.length - 1);
      } else {
        this.mode = null;
      }
      this.render(slashSuggestions);
      return;
    }
    this.slashMatches = [];
    const match = /@([A-Za-z0-9_./\-]*)$/.exec(beforeCursor);
    if (!match) {
      this.mode = null;
      this.fileSuggestions = [];
      this.render([]);
      return;
    }
    const seed = match[1];
    const suggestions = this.filter(seed ?? "");
    if (suggestions.length) {
      this.mode = "file";
      this.fileSuggestions = suggestions;
      this.activeIndex = Math.min(this.activeIndex, suggestions.length - 1);
    } else {
      this.mode = null;
      this.fileSuggestions = [];
    }
    this.render(suggestions);
  }
  filter(seed) {
    if (!seed) {
      return this.files.slice(0, 8);
    }
    const normalized = seed.toLowerCase();
    const startsWithMatches = [];
    const containsMatches = [];
    const pathMatches = [];
    for (const file of this.files) {
      const fileLower = file.toLowerCase();
      const filename = file.split("/").pop() || "";
      const filenameLower = filename.toLowerCase();
      if (filenameLower.startsWith(normalized)) {
        startsWithMatches.push(file);
      } else if (filenameLower.includes(normalized)) {
        containsMatches.push(file);
      } else if (fileLower.includes(normalized)) {
        pathMatches.push(file);
      }
    }
    return [
      ...startsWithMatches,
      ...containsMatches,
      ...pathMatches
    ].slice(0, 8);
  }
  filterSlash(seed) {
    const normalized = seed.toLowerCase();
    this.slashMatches = this.slashCommands.filter((cmd) => cmd.command.replace("/", "").toLowerCase().includes(normalized)).slice(0, 5);
    return this.slashMatches.map((cmd) => {
      const detail = cmd.description ? chalk.gray(` \u2014 ${cmd.description}`) : "";
      return `${cmd.command}${detail}`;
    });
  }
  handleResize() {
    if (this.disposed || !this.mentionLines) {
      return;
    }
    this.clear(false);
    this.render(this.lastSuggestions);
  }
  render(suggestions) {
    if (this.disposed) {
      return;
    }
    const suggestionLines = suggestions.map((entry, idx) => {
      const isSelected = this.mode && idx === this.activeIndex;
      const pointer = isSelected ? chalk.cyan("\u25B8") : " ";
      if (this.mode === "file") {
        const parts = entry.split("/");
        const filename = parts.pop() || entry;
        const dir = parts.length ? parts.join("/") + "/" : "";
        if (isSelected) {
          const highlighted = chalk.cyan(filename);
          const path8 = dir ? chalk.gray(dir) : "";
          return `${pointer} ${path8}${highlighted}`;
        } else {
          const dimmedFilename = chalk.white(filename);
          const path8 = dir ? chalk.gray(dir) : "";
          return `${pointer} ${path8}${dimmedFilename}`;
        }
      }
      const text = isSelected ? chalk.cyan(entry) : entry;
      return `${pointer} ${text}`;
    });
    const lines = [
      ...suggestionLines,
      ...this.statusLine ? [this.statusLine] : []
    ];
    this.lastSuggestions = [...suggestions];
    this.clear();
    if (!lines.length) {
      return;
    }
    this.output.write("\n");
    for (const line of lines) {
      this.output.write(`${line}
`);
    }
    this.mentionLines = lines.length + 1;
    readline.moveCursor(this.output, 0, -this.mentionLines);
    readline.cursorTo(this.output, 0);
    this.output.write(`${chalk.gray("\u203A")} ${this.rl.line}`);
    readline.cursorTo(this.output, this.rl.cursor + 2);
  }
  clear(reprompt = true) {
    if (!this.mentionLines) {
      return;
    }
    readline.moveCursor(this.output, 0, 1);
    for (let i = 0; i < this.mentionLines; i++) {
      readline.clearLine(this.output, 0);
      if (i < this.mentionLines - 1) {
        readline.moveCursor(this.output, 0, 1);
      }
    }
    readline.moveCursor(this.output, 0, -this.mentionLines);
    this.mentionLines = 0;
    if (reprompt) {
      if (!this.disposed) {
        this.rl.prompt(true);
      }
    }
  }
  insertFileSuggestion(beforeCursor, file) {
    const match = /@([A-Za-z0-9_./\\-]*)$/.exec(beforeCursor);
    if (!match) {
      return;
    }
    const seed = match[1] ?? "";
    const start = match.index;
    const end = start + match[0].length;
    const afterCursor = this.rl.line.slice(this.rl.cursor);
    const prefix = this.rl.line.slice(0, start);
    const replacement = `@${file} `;
    const newLine = prefix + replacement + afterCursor;
    const newCursorPos = prefix.length + replacement.length;
    this.rl.line = newLine;
    this.rl.cursor = newCursorPos;
    this.mode = null;
    this.fileSuggestions = [];
    this.lastSuggestions = [];
    this.clear();
    if (typeof this.rl._refreshLine === "function") {
      this.rl._refreshLine();
    } else {
      readline.cursorTo(this.output, 0);
      this.output.write(`${chalk.gray("\u203A")} ${newLine}`);
      readline.cursorTo(this.output, newCursorPos + 2);
    }
  }
  insertSlashSuggestion(beforeCursor, command) {
    const seed = beforeCursor.slice(1);
    const completion = command.command.replace("/", "");
    const remainder = completion.slice(seed.length);
    this.rl.write(remainder);
    this.mode = null;
    this.render([]);
  }
};
var INPUT_BG = "\x1B[48;2;47;47;47m";
var RESET_BG = "\x1B[0m";
var STATUS_COLOR = "#6f6f6f";
function renderPromptLine(rl, statusLine, output) {
  const width = Math.max(20, output.columns || 80);
  const status = (statusLine ?? " ").padEnd(width);
  readline.cursorTo(output, 0);
  output.write(`${INPUT_BG}${" ".repeat(width)}${RESET_BG}
`);
  output.write(`${chalk.hex(STATUS_COLOR)(status)}
`);
  readline.moveCursor(output, 0, -2);
  readline.cursorTo(output, 0);
  output.write(INPUT_BG);
  rl.setPrompt(`${chalk.gray("\u203A")} `);
  rl.prompt(true);
}

// src/ui/filePalette.tsx
import { useMemo as useMemo2, useState as useState2 } from "react";
import { Box as Box2, Text as Text2, useInput as useInput2, render as render2 } from "ink";
import { jsx as jsx2, jsxs as jsxs2 } from "react/jsx-runtime";
async function showFilePalette(options) {
  const { files, statusLine, seed } = options;
  if (!files.length) {
    return null;
  }
  if (!process.stdout.isTTY) {
    return files[0];
  }
  return new Promise((resolve) => {
    let completed = false;
    const instance = render2(
      /* @__PURE__ */ jsx2(
        FilePalette,
        {
          files,
          statusLine,
          seed,
          onSubmit: (value) => {
            if (completed) {
              return;
            }
            completed = true;
            instance.unmount();
            resolve(value);
          }
        }
      ),
      { exitOnCtrlC: false }
    );
  });
}
function FilePalette({ files, statusLine, seed, onSubmit }) {
  const [value, setValue] = useState2(seed ?? "");
  const [cursor, setCursor] = useState2(0);
  const filtered = useMemo2(() => {
    const normalized = value.toLowerCase();
    if (!normalized) {
      return files;
    }
    return files.filter((file) => file.toLowerCase().includes(normalized));
  }, [files, value]);
  const cursorIndex = filtered.length ? Math.min(cursor, filtered.length - 1) : 0;
  useInput2((input, key) => {
    if (key.escape) {
      onSubmit(null);
      return;
    }
    if (key.return) {
      onSubmit(filtered[cursorIndex] ?? null);
      return;
    }
    if (key.downArrow) {
      if (!filtered.length) {
        return;
      }
      setCursor((prev) => (prev + 1) % filtered.length);
      return;
    }
    if (key.upArrow) {
      if (!filtered.length) {
        return;
      }
      setCursor((prev) => (prev - 1 + filtered.length) % filtered.length);
      return;
    }
    if (key.backspace || key.delete) {
      setValue((prev) => prev.slice(0, -1));
      setCursor(0);
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      setValue((prev) => prev + input);
      setCursor(0);
    }
  });
  return /* @__PURE__ */ jsxs2(Box2, { flexDirection: "column", paddingX: 1, children: [
    statusLine ? /* @__PURE__ */ jsx2(Text2, { color: "gray", children: statusLine }) : null,
    /* @__PURE__ */ jsx2(Text2, { color: "cyan", children: "Select a file" }),
    /* @__PURE__ */ jsxs2(Text2, { children: [
      /* @__PURE__ */ jsx2(Text2, { color: "magenta", children: "Filter: " }),
      /* @__PURE__ */ jsx2(Text2, { children: value || " " })
    ] }),
    /* @__PURE__ */ jsxs2(Box2, { flexDirection: "column", marginTop: 1, children: [
      filtered.length === 0 && /* @__PURE__ */ jsx2(Text2, { color: "gray", children: "No matching files. Keep typing\u2026" }),
      filtered.slice(0, 20).map((file, index) => /* @__PURE__ */ jsxs2(Text2, { color: index === cursorIndex ? "cyan" : void 0, children: [
        index === cursorIndex ? "\u25B8" : " ",
        " ",
        file
      ] }, file))
    ] }),
    /* @__PURE__ */ jsx2(Text2, { color: "gray", children: "Type to filter \xB7 \u2191/\u2193 navigate \xB7 Enter choose \xB7 Esc cancel" })
  ] });
}

// src/utils/context.ts
var MODEL_CONTEXT = {
  "anthropic/claude-3.5-sonnet": 2e5,
  "anthropic/claude-3-opus": 2e5,
  "anthropic/claude-3-haiku": 2e5,
  "openai/gpt-4o-mini": 128e3,
  "openai/gpt-4o": 128e3,
  "openai/gpt-4.1": 2e5,
  "google/gemini-pro": 128e3,
  "deepseek/deepseek-r1-0528-qwen3-8b:free": 8e3,
  "deepseek/deepseek-coder": 16e3
};
function getContextWindow(model) {
  const normalized = model.toLowerCase();
  if (MODEL_CONTEXT[normalized]) {
    return MODEL_CONTEXT[normalized];
  }
  const fuzzy = Object.entries(MODEL_CONTEXT).find(([name]) => normalized.startsWith(name));
  return fuzzy ? fuzzy[1] : 128e3;
}
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}
function estimateMessagesTokens(messages) {
  return messages.reduce((acc, message) => acc + estimateTokens(message.content ?? ""), 0);
}

// src/utils/gitIgnore.ts
import fs3 from "fs-extra";
import path3 from "path";
import ignore from "ignore";
var GitIgnoreParser = class {
  constructor(projectRoot, extraPatterns) {
    this.extraPatterns = extraPatterns;
    this.cache = /* @__PURE__ */ new Map();
    this.processedExtraPatterns = [];
    this.projectRoot = path3.resolve(projectRoot);
    if (this.extraPatterns?.length) {
      this.processedExtraPatterns = this.processPatterns(this.extraPatterns, ".");
    }
  }
  isIgnored(filePath) {
    if (!filePath) {
      return false;
    }
    const absoluteFilePath = path3.resolve(this.projectRoot, filePath);
    if (!absoluteFilePath.startsWith(this.projectRoot)) {
      return false;
    }
    const relativePath = path3.relative(this.projectRoot, absoluteFilePath);
    if (!relativePath || relativePath.startsWith("..")) {
      return false;
    }
    const normalizedPath = relativePath.replace(/\\/g, "/");
    const ig = ignore();
    ig.add(".git");
    if (this.globalPatterns === void 0) {
      const excludeFile = path3.join(this.projectRoot, ".git", "info", "exclude");
      this.globalPatterns = fs3.existsSync(excludeFile) ? this.loadPatternsForFile(excludeFile) : [];
    }
    ig.add(this.globalPatterns);
    const pathParts = relativePath.split(path3.sep);
    const dirsToVisit = [];
    let current = this.projectRoot;
    dirsToVisit.push(current);
    for (let i = 0; i < pathParts.length - 1; i++) {
      current = path3.join(current, pathParts[i]);
      dirsToVisit.push(current);
    }
    for (const dir of dirsToVisit) {
      const relativeDir = path3.relative(this.projectRoot, dir);
      if (relativeDir) {
        const normalizedDir = relativeDir.replace(/\\/g, "/");
        const igPlusExtras = ignore().add(ig).add(this.processedExtraPatterns);
        if (igPlusExtras.ignores(normalizedDir)) {
          break;
        }
      }
      if (this.cache.has(dir)) {
        ig.add(this.cache.get(dir) ?? []);
      } else {
        const gitignorePath = path3.join(dir, ".gitignore");
        if (fs3.existsSync(gitignorePath)) {
          const patterns = this.loadPatternsForFile(gitignorePath);
          this.cache.set(dir, patterns);
          ig.add(patterns);
        } else {
          this.cache.set(dir, []);
        }
      }
    }
    ig.add(this.processedExtraPatterns);
    return ig.ignores(normalizedPath);
  }
  loadPatternsForFile(patternsFilePath) {
    let content = "";
    try {
      content = fs3.readFileSync(patternsFilePath, "utf8");
    } catch {
      return [];
    }
    const isExcludeFile = patternsFilePath.endsWith(path3.join(".git", "info", "exclude"));
    const relativeBaseDir = isExcludeFile ? "." : path3.dirname(path3.relative(this.projectRoot, patternsFilePath)).split(path3.sep).join(path3.posix.sep);
    const rawPatterns = content.split("\n");
    return this.processPatterns(rawPatterns, relativeBaseDir);
  }
  processPatterns(rawPatterns, relativeBaseDir) {
    return rawPatterns.map((pattern) => pattern.trimStart()).filter((pattern) => pattern && !pattern.startsWith("#")).map((pattern) => this.normalizePattern(pattern, relativeBaseDir)).filter(Boolean);
  }
  normalizePattern(pattern, relativeBaseDir) {
    let p = pattern;
    const isNegative = p.startsWith("!");
    if (isNegative) {
      p = p.slice(1);
    }
    const isAnchored = p.startsWith("/");
    if (isAnchored) {
      p = p.slice(1);
    }
    if (!p) {
      return "";
    }
    let newPattern = p;
    if (relativeBaseDir && relativeBaseDir !== ".") {
      if (!isAnchored && !p.includes("/")) {
        newPattern = path3.posix.join("**", p);
      }
      newPattern = path3.posix.join(relativeBaseDir, newPattern);
      if (!newPattern.startsWith("/")) {
        newPattern = "/" + newPattern;
      }
    }
    if (isAnchored && !newPattern.startsWith("/")) {
      newPattern = "/" + newPattern;
    }
    if (isNegative) {
      newPattern = "!" + newPattern;
    }
    return newPattern;
  }
};

// src/core/slashCommands.ts
var SLASH_COMMANDS = [
  metadata,
  metadata10,
  metadata4,
  metadata5,
  metadata6,
  metadata7,
  metadata8,
  metadata9,
  metadata3,
  metadata2,
  metadata11
];

// src/core/conversationManager.ts
var _ConversationManager = class _ConversationManager {
  constructor() {
    this.messages = [];
    this.initialized = false;
  }
  static getInstance() {
    if (!_ConversationManager.instance) {
      _ConversationManager.instance = new _ConversationManager();
    }
    return _ConversationManager.instance;
  }
  reset(systemPrompt) {
    this.messages = [
      {
        role: "system",
        content: systemPrompt
      }
    ];
    this.initialized = true;
  }
  isInitialized() {
    return this.initialized;
  }
  addMessage(message) {
    if (!this.initialized) {
      throw new Error("ConversationManager must be initialized with a system prompt before adding messages.");
    }
    this.messages.push(message);
  }
  history() {
    return [...this.messages];
  }
  cropHistory(direction, amount) {
    if (!this.initialized || amount <= 0 || this.messages.length <= 1) {
      return [];
    }
    const lastUserIndex = this.findLastUserIndex();
    if (lastUserIndex <= 0) {
      return [];
    }
    if (direction === "top") {
      const removable = Math.max(0, lastUserIndex - 1);
      const removeCount = Math.min(removable, Math.floor(amount));
      if (!removeCount) {
        return [];
      }
      return this.messages.splice(1, removeCount);
    }
    const toRemove = [];
    for (let i = this.messages.length - 1; i >= 1 && toRemove.length < amount; i -= 1) {
      if (i === lastUserIndex) {
        continue;
      }
      toRemove.push(i);
    }
    if (!toRemove.length) {
      return [];
    }
    toRemove.sort((a, b) => a - b);
    const removed = [];
    for (let i = toRemove.length - 1; i >= 0; i -= 1) {
      const index = toRemove[i];
      const [message] = this.messages.splice(index, 1);
      removed.unshift(message);
    }
    return removed;
  }
  addSystemNote(content) {
    if (!this.initialized) {
      throw new Error("ConversationManager must be initialized before adding summaries.");
    }
    this.messages.push({ role: "system", content });
  }
  findLastUserIndex() {
    for (let i = this.messages.length - 1; i >= 0; i -= 1) {
      if (this.messages[i].role === "user") {
        return i;
      }
    }
    return -1;
  }
};
_ConversationManager.instance = null;
var ConversationManager = _ConversationManager;

// src/core/toolManager.ts
var DEFAULT_TOOL_DEFINITIONS = [
  {
    name: "delete_path",
    description: "Remove files or directories from the workspace",
    requiresApproval: true
  },
  {
    name: "run_command",
    description: "Execute arbitrary shell commands",
    requiresApproval: true,
    approvalMessage: "Allow the agent to run a shell command?"
  },
  {
    name: "git_apply_patch",
    description: "Apply a git patch to the working tree",
    requiresApproval: true
  },
  {
    name: "git_worktree_remove",
    description: "Remove a git worktree",
    requiresApproval: true
  },
  {
    name: "git_worktree_add",
    description: "Add a git worktree (may modify git state)",
    requiresApproval: true
  }
];
var ToolManager = class {
  constructor(options) {
    this.definitions = /* @__PURE__ */ new Map();
    this.executor = options.executor;
    this.confirmApproval = options.confirmApproval;
    const defs = options.definitions ?? DEFAULT_TOOL_DEFINITIONS;
    for (const def of defs) {
      this.register(def);
    }
  }
  register(definition) {
    this.definitions.set(definition.name, definition);
  }
  async execute(toolCalls) {
    const results = [];
    for (const call of toolCalls) {
      const definition = this.definitions.get(call.tool);
      if (definition?.requiresApproval) {
        const message = definition.approvalMessage ?? `Allow tool ${definition.name}? ${definition.description}`;
        const confirmed = await this.confirmApproval(message);
        if (!confirmed) {
          results.push({
            tool: call.tool,
            success: false,
            output: "Tool execution skipped by user."
          });
          continue;
        }
      }
      try {
        const action = this.toAction(call);
        const output = await this.executor(action);
        results.push({
          tool: call.tool,
          success: true,
          output
        });
      } catch (error) {
        results.push({
          tool: call.tool,
          success: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    return results;
  }
  toAction(call) {
    return {
      type: call.tool,
      ...call.args ?? {}
    };
  }
};

// src/core/actionExecutor.ts
import chalk2 from "chalk";
import { diffLines } from "diff";

// src/actions/dependencies.ts
import fs4 from "fs-extra";
import path4 from "path";
async function readPackageManifest(cwd) {
  const manifestPath = path4.join(cwd, "package.json");
  if (!await fs4.pathExists(manifestPath)) {
    return null;
  }
  return fs4.readJson(manifestPath);
}
async function addDependency(cwd, name, version, options = {}) {
  const manifest = await readPackageManifest(cwd) ?? {};
  if (options.dev) {
    manifest.devDependencies = manifest.devDependencies ?? {};
    manifest.devDependencies[name] = version;
  } else {
    manifest.dependencies = manifest.dependencies ?? {};
    manifest.dependencies[name] = version;
  }
  const manifestPath = path4.join(cwd, "package.json");
  await fs4.writeJson(manifestPath, manifest, { spaces: 2 });
}
async function removeDependency(cwd, name, options = {}) {
  const manifest = await readPackageManifest(cwd) ?? {};
  const targetKey = options.dev ? "devDependencies" : "dependencies";
  if (manifest[targetKey] && manifest[targetKey][name]) {
    delete manifest[targetKey][name];
    const manifestPath = path4.join(cwd, "package.json");
    await fs4.writeJson(manifestPath, manifest, { spaces: 2 });
  }
}

// src/actions/command.ts
import { spawn } from "child_process";
function runCommand(cmd, args, cwd, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, shell: false, ...options });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      resolve({ stdout, stderr, code });
    });
  });
}

// src/actions/metadata.ts
import crypto from "crypto";
import fs5 from "fs-extra";
import path5 from "path";
async function listDirectoryTree(root, options = {}) {
  const depth = options.depth ?? 2;
  const maxEntries = options.maxEntries ?? 200;
  const result = [];
  async function walk(current, prefix, currentDepth) {
    if (result.length >= maxEntries) {
      return;
    }
    const entries = await fs5.readdir(current);
    const slice = entries.slice(0, maxEntries - result.length);
    for (const entry of slice) {
      const full = path5.join(current, entry);
      const rel = path5.relative(root, full) || ".";
      const stats = await fs5.stat(full);
      result.push(`${prefix}${entry}${stats.isDirectory() ? "/" : ""}`);
      if (stats.isDirectory() && currentDepth < depth) {
        await walk(full, `${prefix}  `, currentDepth + 1);
      }
      if (result.length >= maxEntries) {
        break;
      }
    }
  }
  await walk(root, "", 0);
  return result;
}
async function fileStats(root, relativePath) {
  const fullPath = path5.join(root, relativePath);
  if (!await fs5.pathExists(fullPath)) {
    return null;
  }
  const stats = await fs5.stat(fullPath);
  return {
    size: stats.size,
    mtime: stats.mtime.toISOString(),
    isDirectory: stats.isDirectory()
  };
}
async function checksumFile(root, relativePath, algorithm = "sha256") {
  const fullPath = path5.join(root, relativePath);
  const exists = await fs5.pathExists(fullPath);
  if (!exists) {
    throw new Error(`${relativePath} does not exist.`);
  }
  const hash = crypto.createHash(algorithm);
  const stream = fs5.createReadStream(fullPath);
  return await new Promise((resolve, reject) => {
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

// src/actions/git.ts
import { spawnSync as spawnSync2 } from "child_process";
function applyGitPatch(cwd, patch) {
  const result = spawnSync2("git", ["apply", "-"], {
    cwd,
    input: patch,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || "git apply failed");
  }
  return result.stdout ?? "";
}
function diffFile(cwd, file) {
  const result = spawnSync2("git", ["diff", "--", file], { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || `git diff failed for ${file}`);
  }
  return result.stdout || "No diff";
}
function checkoutFile(cwd, file) {
  const result = spawnSync2("git", ["checkout", "--", file], { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || `git checkout failed for ${file}`);
  }
}
function gitStatus(cwd) {
  const result = spawnSync2("git", ["status", "-sb"], { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || "git status failed");
  }
  return result.stdout || "clean";
}
function gitListUntracked(cwd) {
  const result = spawnSync2("git", ["ls-files", "--others", "--exclude-standard"], { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || "git ls-files failed");
  }
  return result.stdout || "";
}
function gitDiffRange(cwd, options = {}) {
  const args = ["diff"];
  if (options.staged) {
    args.push("--staged");
  }
  if (options.range) {
    args.push(options.range);
  }
  if (options.paths?.length) {
    args.push("--", ...options.paths);
  }
  const result = spawnSync2("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || "git diff failed");
  }
  return result.stdout || "No diff output.";
}
function gitListWorktrees(cwd) {
  const result = spawnSync2("git", ["worktree", "list", "--porcelain"], { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || "git worktree list failed");
  }
  return result.stdout || "No worktrees.";
}
function gitAddWorktree(cwd, pathArg, ref) {
  const args = ["worktree", "add", pathArg];
  if (ref) {
    args.push(ref);
  }
  const result = spawnSync2("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || "git worktree add failed");
  }
  return result.stdout || `Added worktree at ${pathArg}`;
}
function gitRemoveWorktree(cwd, pathArg, force = false) {
  const args = ["worktree", "remove"];
  if (force) {
    args.push("--force");
  }
  args.push(pathArg);
  const result = spawnSync2("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || "git worktree remove failed");
  }
  return result.stdout || `Removed worktree ${pathArg}`;
}

// src/actions/formatters.ts
var builtinFormatters = {
  json: async (contents) => {
    const parsed = JSON.parse(contents);
    return JSON.stringify(parsed, null, 2) + "\n";
  },
  trim: async (contents) => contents.trim() + "\n"
};
async function applyFormatter(name, contents, file) {
  const formatter = builtinFormatters[name];
  if (!formatter) {
    throw new Error(`Formatter ${name} is not available.`);
  }
  return formatter(contents, file);
}

// src/core/customCommands.ts
import fs6 from "fs-extra";
import os2 from "os";
import path6 from "path";
var COMMANDS_DIR = path6.join(os2.homedir(), ".autohand-cli", "commands");
async function loadCustomCommand(name) {
  const filePath = path6.join(COMMANDS_DIR, `${sanitizeName(name)}.json`);
  if (!await fs6.pathExists(filePath)) {
    return null;
  }
  return fs6.readJson(filePath);
}
async function saveCustomCommand(definition) {
  await fs6.ensureDir(COMMANDS_DIR);
  const filePath = path6.join(COMMANDS_DIR, `${sanitizeName(definition.name)}.json`);
  await fs6.writeJson(filePath, definition, { spaces: 2 });
}
function sanitizeName(name) {
  return name.replace(/[^a-z0-9-_]/gi, "_");
}

// src/core/actionExecutor.ts
var ActionExecutor = class {
  constructor(deps) {
    this.deps = deps;
    this.runtime = deps.runtime;
    this.files = deps.files;
    this.resolveWorkspacePath = deps.resolveWorkspacePath;
    this.confirmDangerousAction = deps.confirmDangerousAction;
    this.logExploration = deps.onExploration;
  }
  async execute(action) {
    if (this.runtime.options.dryRun && action.type !== "search" && action.type !== "plan") {
      return "Dry-run mode: skipped mutation";
    }
    switch (action.type) {
      case "plan":
        return action.notes ?? "No plan notes provided";
      case "read_file": {
        const contents = await this.files.readFile(action.path);
        this.recordExploration("read", action.path);
        const charLimit = this.runtime.config.ui?.readFileCharLimit ?? 300;
        const lines = contents.split("\n");
        const fileSize = Buffer.byteLength(contents, "utf8");
        const fileSizeKB = (fileSize / 1024).toFixed(2);
        console.log(chalk2.cyan(`
\u{1F4C4} ${action.path}`));
        console.log(chalk2.gray(`   ${lines.length} lines \u2022 ${fileSizeKB} KB`));
        if (contents.length <= charLimit) {
          return contents;
        }
        console.log(chalk2.yellow(`   \u26A0\uFE0F  Showing first ${charLimit} characters`));
        return contents.slice(0, charLimit) + `

... (truncated, ${contents.length} total characters)`;
      }
      case "write_file": {
        const filePath = this.resolveWorkspacePath(action.path);
        const exists = await this.files.root && (await import("fs-extra")).pathExists(filePath);
        const oldContent = exists ? await this.files.readFile(action.path) : "";
        const newContent = this.pickText(action.contents, action.content) ?? "";
        if (exists && oldContent !== newContent) {
          console.log(chalk2.cyan(`
\u{1F4DD} ${action.path}:`));
          this.showDiff(oldContent, newContent);
        }
        await this.files.writeFile(action.path, newContent);
        return exists ? `Updated ${action.path}` : `Created ${action.path}`;
      }
      case "append_file": {
        const addition = this.pickText(action.contents, action.content) ?? "";
        const oldContent = await this.files.readFile(action.path).catch(() => "");
        const newContent = oldContent + addition;
        console.log(chalk2.cyan(`
\u{1F4DD} ${action.path}:`));
        this.showDiff(oldContent, newContent);
        await this.files.appendFile(action.path, addition);
        return `Appended to ${action.path}`;
      }
      case "apply_patch": {
        const oldContent = await this.files.readFile(action.path).catch(() => "");
        const patch = this.pickText(action.patch, action.diff);
        if (!patch) {
          throw new Error("apply_patch requires patch or diff content.");
        }
        console.log(chalk2.cyan(`
\u{1F527} ${action.path}:`));
        console.log(chalk2.gray("Applying patch..."));
        await this.files.applyPatch(action.path, patch);
        const newContent = await this.files.readFile(action.path);
        this.showDiff(oldContent, newContent);
        return `Patched ${action.path}`;
      }
      case "search": {
        const hits = this.files.search(action.query, action.path);
        this.recordExploration("search", action.query);
        return hits.slice(0, 10).map((hit) => `${hit.file}:${hit.line}: ${hit.text}`).join("\n");
      }
      case "search_with_context": {
        this.recordExploration("search", action.query);
        return this.files.searchWithContext(action.query, {
          limit: action.limit,
          context: action.context,
          relativePath: action.path
        });
      }
      case "create_directory": {
        await this.files.createDirectory(action.path);
        return `Created directory ${action.path}`;
      }
      case "delete_path": {
        const confirmed = await this.confirmDangerousAction(`Delete ${action.path}?`);
        if (!confirmed) {
          return `Skipped deleting ${action.path}`;
        }
        await this.files.deletePath(action.path);
        return `Deleted ${action.path}`;
      }
      case "rename_path": {
        await this.files.renamePath(action.from, action.to);
        return `Renamed ${action.from} -> ${action.to}`;
      }
      case "copy_path": {
        await this.files.copyPath(action.from, action.to);
        return `Copied ${action.from} -> ${action.to}`;
      }
      case "replace_in_file": {
        const oldContent = await this.files.readFile(action.path);
        const newContent = oldContent.replace(action.search, action.replace);
        if (oldContent !== newContent) {
          console.log(chalk2.cyan(`
\u{1F504} ${action.path}:`));
          this.showDiff(oldContent, newContent);
        }
        await this.files.replaceInFile(action.path, action.search, action.replace);
        return `Updated ${action.path}`;
      }
      case "format_file": {
        await this.files.formatFile(action.path, (contents, file) => applyFormatter(action.formatter, contents, file));
        return `Formatted ${action.path} (${action.formatter})`;
      }
      case "run_command": {
        const result = await runCommand(action.command, action.args ?? [], this.runtime.workspaceRoot);
        return [`$ ${action.command} ${(action.args ?? []).join(" ")}`, result.stdout, result.stderr].filter(Boolean).join("\n");
      }
      case "add_dependency": {
        await addDependency(this.runtime.workspaceRoot, action.name, action.version, { dev: action.dev });
        return `Added dependency ${action.name}@${action.version}${action.dev ? " (dev)" : ""}`;
      }
      case "remove_dependency": {
        await removeDependency(this.runtime.workspaceRoot, action.name, { dev: action.dev });
        return `Removed dependency ${action.name}${action.dev ? " (dev)" : ""}`;
      }
      case "list_tree": {
        const treeRoot = this.resolveWorkspacePath(action.path ?? ".");
        const lines = await listDirectoryTree(treeRoot, { depth: action.depth });
        this.recordExploration("list", action.path ?? ".");
        return lines.join("\n");
      }
      case "file_stats": {
        this.resolveWorkspacePath(action.path);
        const stats = await fileStats(this.runtime.workspaceRoot, action.path);
        return stats ? JSON.stringify(stats, null, 2) : `No stats for ${action.path}`;
      }
      case "checksum": {
        this.resolveWorkspacePath(action.path);
        const sum = await checksumFile(this.runtime.workspaceRoot, action.path, action.algorithm);
        return `${action.algorithm ?? "sha256"} ${action.path}: ${sum}`;
      }
      case "git_diff": {
        this.resolveWorkspacePath(action.path);
        return diffFile(this.runtime.workspaceRoot, action.path);
      }
      case "git_checkout": {
        this.resolveWorkspacePath(action.path);
        checkoutFile(this.runtime.workspaceRoot, action.path);
        return `Restored ${action.path} from git.`;
      }
      case "git_status":
        return gitStatus(this.runtime.workspaceRoot);
      case "git_list_untracked":
        return gitListUntracked(this.runtime.workspaceRoot) || "No untracked files.";
      case "git_diff_range": {
        return gitDiffRange(this.runtime.workspaceRoot, {
          range: action.range,
          staged: action.staged,
          paths: action.paths
        });
      }
      case "git_apply_patch": {
        const patch = this.pickText(action.patch, action.diff);
        if (!patch) {
          throw new Error("git_apply_patch requires patch or diff content.");
        }
        applyGitPatch(this.runtime.workspaceRoot, patch);
        return "Applied git patch.";
      }
      case "git_worktree_list":
        return gitListWorktrees(this.runtime.workspaceRoot);
      case "git_worktree_add": {
        const worktreePath = this.resolveWorkspacePath(action.path);
        return gitAddWorktree(this.runtime.workspaceRoot, worktreePath, action.ref);
      }
      case "git_worktree_remove": {
        const worktreePath = this.resolveWorkspacePath(action.path);
        return gitRemoveWorktree(this.runtime.workspaceRoot, worktreePath, action.force);
      }
      case "custom_command":
        return this.executeCustomCommand(action);
      case "multi_file_edit": {
        const oldContent = await this.files.readFile(action.file_path);
        let newContent = oldContent;
        console.log(chalk2.cyan(`
\u270F\uFE0F  ${action.file_path}:`));
        console.log(chalk2.gray(`Applying ${action.edits.length} edit(s)...`));
        for (const edit of action.edits) {
          if (edit.replace_all) {
            newContent = newContent.replaceAll(edit.old_string, edit.new_string);
          } else {
            const firstIndex = newContent.indexOf(edit.old_string);
            if (firstIndex === -1) {
              throw new Error(`Could not find text to replace: ${edit.old_string.substring(0, 50)}...`);
            }
            newContent = newContent.substring(0, firstIndex) + edit.new_string + newContent.substring(firstIndex + edit.old_string.length);
          }
        }
        if (oldContent !== newContent) {
          this.showDiff(oldContent, newContent);
          await this.files.writeFile(action.file_path, newContent);
        }
        return `Applied ${action.edits.length} edit(s) to ${action.file_path}`;
      }
      case "todo_write": {
        const todoPath = ".agent/todos.json";
        let existingTodos = [];
        try {
          const content = await this.files.readFile(todoPath);
          existingTodos = JSON.parse(content);
        } catch {
        }
        const todoMap = new Map(existingTodos.map((t) => [t.id, t]));
        for (const task of action.tasks) {
          todoMap.set(task.id, task);
        }
        const allTodos = Array.from(todoMap.values());
        await this.files.writeFile(todoPath, JSON.stringify(allTodos, null, 2));
        console.log(chalk2.cyan("\n\u{1F4CB} Task List Updated:"));
        const pending = allTodos.filter((t) => t.status === "pending").length;
        const inProgress = allTodos.filter((t) => t.status === "in_progress").length;
        const completed = allTodos.filter((t) => t.status === "completed").length;
        console.log(chalk2.gray(`  \u23F3 Pending: ${pending}`));
        console.log(chalk2.yellow(`  \u{1F504} In Progress: ${inProgress}`));
        console.log(chalk2.green(`  \u2705 Completed: ${completed}`));
        console.log();
        return `Updated task list: ${pending} pending, ${inProgress} in progress, ${completed} completed`;
      }
      default:
        throw new Error(`Unsupported action type ${action.type}`);
    }
  }
  pickText(...values) {
    for (const value of values) {
      if (typeof value === "string") {
        return value;
      }
    }
    return void 0;
  }
  recordExploration(kind, target) {
    if (!target) {
      return;
    }
    this.logExploration?.({ kind, target });
  }
  async executeCustomCommand(action) {
    const existing = await loadCustomCommand(action.name);
    let definition = existing ?? {
      name: action.name,
      command: action.command,
      args: action.args,
      description: action.description,
      dangerous: action.dangerous
    };
    if (!existing) {
      console.log(chalk2.cyan(`Custom command: ${definition.name}`));
      console.log(chalk2.gray(definition.description ?? "No description provided."));
      console.log(chalk2.gray(`Command: ${definition.command} ${(definition.args ?? []).join(" ")}`));
      if (this.isDestructiveCommand(definition.command)) {
        console.log(chalk2.red("Warning: command may be destructive."));
      }
      const answer = await this.confirmDangerousAction("Add and run this custom command?");
      if (!answer) {
        return "Custom command rejected by user.";
      }
      await saveCustomCommand(definition);
    }
    const result = await runCommand(definition.command, definition.args ?? [], this.runtime.workspaceRoot);
    return [`$ ${definition.command} ${(definition.args ?? []).join(" ")}`, result.stdout, result.stderr].filter(Boolean).join("\n");
  }
  isDestructiveCommand(command) {
    const lowered = command.toLowerCase();
    return lowered.includes("rm ") || lowered.includes("sudo ") || lowered.includes("dd ");
  }
  showDiff(oldContent, newContent) {
    const diff = diffLines(oldContent, newContent);
    let lineNumber = 0;
    for (const part of diff) {
      const lines = part.value.split("\n").filter((line, idx, arr) => {
        return idx < arr.length - 1 || line !== "";
      });
      for (const line of lines) {
        if (part.added) {
          console.log(chalk2.green(`+ ${line}`));
        } else if (part.removed) {
          console.log(chalk2.red(`- ${line}`));
        } else {
          lineNumber++;
          if (lines.length <= 3 || lines.indexOf(line) < 2 || lines.indexOf(line) >= lines.length - 2) {
            console.log(chalk2.gray(`  ${line}`));
          } else if (lines.indexOf(line) === 2) {
            console.log(chalk2.gray("  ..."));
          }
        }
      }
    }
    console.log();
  }
};

// src/core/slashCommandHandler.ts
import chalk3 from "chalk";
import terminalLink from "terminal-link";
var SlashCommandHandler = class {
  constructor(ctx, commands) {
    this.ctx = ctx;
    this.commandMap = /* @__PURE__ */ new Map();
    commands.forEach((cmd) => this.commandMap.set(cmd.command, cmd));
  }
  async handle(command) {
    const meta = this.commandMap.get(command);
    if (meta && !meta.implemented) {
      this.printUnimplemented(meta);
      return null;
    }
    try {
      switch (command) {
        case "/ls": {
          const { listFiles } = await import("./ls-XRBAHYZ3.js");
          return listFiles(this.ctx);
        }
        case "/diff": {
          const { diff } = await import("./diff-O3ND7XD7.js");
          return diff(this.ctx);
        }
        case "/undo": {
          const { undo } = await import("./undo-72KGQLJE.js");
          return undo(this.ctx);
        }
        case "/model": {
          const { model } = await import("./model-HKEFSH5E.js");
          return model(this.ctx);
        }
        case "/approvals": {
          const { approvals } = await import("./approvals-5OQ3TJBV.js");
          return approvals(this.ctx);
        }
        case "/review": {
          const { review } = await import("./review-V22RFOXY.js");
          return review();
        }
        case "/new": {
          const { newConversation } = await import("./new-VMTZXNGF.js");
          return newConversation(this.ctx);
        }
        case "/init": {
          const { init } = await import("./init-DML7AOII.js");
          return init(this.ctx);
        }
        case "/compact": {
          const { compact } = await import("./compact-QGLV5GB7.js");
          return compact();
        }
        case "/quit": {
          const { quit } = await import("./quit-RSYIERO5.js");
          return quit();
        }
        case "/help": {
          const { help } = await import("./help-7X4ICRDX.js");
          return help();
        }
        default:
          this.printUnsupported(command);
          return command;
      }
    } catch (error) {
      console.error(chalk3.red(`Error executing command ${command}:`), error);
      return null;
    }
  }
  printUnsupported(command) {
    const docLink = terminalLink("docs.autohand.ai", "https://docs.autohand.ai");
    console.log(
      chalk3.yellow(`Command ${command} is not supported. Please visit ${docLink} for supported actions or type -help.`)
    );
  }
  printUnimplemented(command) {
    console.log(chalk3.yellow(`Command ${command.command} is not implemented yet.`));
    if (command.prd) {
      console.log(chalk3.gray(`PRD: ${command.prd}`));
    }
  }
};

// src/core/agent.ts
var AutohandAgent = class {
  constructor(llm, files, runtime) {
    this.llm = llm;
    this.files = files;
    this.runtime = runtime;
    this.mentionContexts = [];
    this.contextPercentLeft = 100;
    this.workspaceFiles = [];
    this.isInstructionActive = false;
    this.hasPrintedExplorationHeader = false;
    const model = runtime.options.model ?? runtime.config.openrouter.model;
    this.contextWindow = getContextWindow(model);
    this.ignoreFilter = new GitIgnoreParser(runtime.workspaceRoot, []);
    this.conversation = ConversationManager.getInstance();
    this.resetConversationContext();
    this.actionExecutor = new ActionExecutor({
      runtime,
      files,
      resolveWorkspacePath: (relativePath) => this.resolveWorkspacePath(relativePath),
      confirmDangerousAction: (message) => this.confirmDangerousAction(message),
      onExploration: (entry) => this.recordExploration(entry)
    });
    this.toolManager = new ToolManager({
      executor: (action) => this.actionExecutor.execute(action),
      confirmApproval: (message) => this.confirmDangerousAction(message)
    });
    this.slashHandler = new SlashCommandHandler({
      listWorkspaceFiles: () => this.listWorkspaceFiles(),
      printGitDiff: () => this.printGitDiff(),
      undoLastMutation: () => this.undoLastMutation(),
      promptModelSelection: () => this.promptModelSelection(),
      promptApprovalMode: () => this.promptApprovalMode(),
      createAgentsFile: () => this.createAgentsFile(),
      resetConversation: () => this.resetConversationContext()
    }, SLASH_COMMANDS);
  }
  async runInteractive() {
    while (true) {
      const instruction = await this.promptForInstruction();
      if (!instruction) {
        continue;
      }
      if (instruction === "/exit" || instruction === "/quit") {
        console.log(chalk4.gray("Ending Autohand session."));
        return;
      }
      await this.runInstruction(instruction);
      console.log();
    }
  }
  async promptForInstruction() {
    this.workspaceFiles = await this.collectWorkspaceFiles();
    const statusLine = this.formatStatusLine();
    const input = await readInstruction(this.workspaceFiles, SLASH_COMMANDS, statusLine);
    if (input === null) {
      return null;
    }
    let normalized = input.trim();
    if (!normalized) {
      return null;
    }
    if (normalized === "/") {
      console.log(chalk4.gray("Type a slash command name (e.g. /diff) and press Enter."));
      return null;
    }
    if (normalized.startsWith("/")) {
      const handled = await this.slashHandler.handle(normalized);
      if (handled === null) {
        return null;
      }
      normalized = handled;
    }
    if (normalized) {
      normalized = await this.resolveMentions(normalized);
      return normalized;
    }
    return null;
  }
  async listWorkspaceFiles() {
    const entries = await fs7.readdir(this.runtime.workspaceRoot);
    const sorted = entries.sort((a, b) => a.localeCompare(b));
    console.log("\n" + chalk4.cyan("Workspace files:"));
    console.log(sorted.map((entry) => ` - ${entry}`).join("\n"));
    console.log();
  }
  async collectWorkspaceFiles() {
    const git = spawnSync3("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
      cwd: this.runtime.workspaceRoot,
      encoding: "utf8"
    });
    const files = [];
    const ignoreFilter = this.ignoreFilter;
    if (git.status === 0 && git.stdout) {
      git.stdout.split(/\r?\n/).map((file) => file.trim()).filter(Boolean).forEach((file) => {
        if (!ignoreFilter.isIgnored(file)) {
          files.push(file);
        }
      });
      return files;
    }
    await this.walkWorkspace(this.runtime.workspaceRoot, files);
    return files;
  }
  async walkWorkspace(current, acc) {
    const entries = await fs7.readdir(current);
    for (const entry of entries) {
      const full = path7.join(current, entry);
      const rel = path7.relative(this.runtime.workspaceRoot, full);
      if (rel === "" || this.shouldSkipPath(rel) || this.ignoreFilter.isIgnored(rel)) {
        continue;
      }
      const stats = await fs7.stat(full);
      if (stats.isDirectory()) {
        await this.walkWorkspace(full, acc);
      } else if (stats.isFile()) {
        acc.push(rel);
      }
    }
  }
  shouldSkipPath(relativePath) {
    const normalized = relativePath.replace(/\\/g, "/");
    return normalized.startsWith(".git") || normalized.startsWith("node_modules") || normalized.startsWith("dist") || normalized.startsWith("build") || normalized.startsWith(".next");
  }
  printGitDiff() {
    const status = spawnSync3("git", ["status", "-sb"], {
      cwd: this.runtime.workspaceRoot,
      encoding: "utf8"
    });
    if (status.status === 0 && status.stdout) {
      console.log("\n" + chalk4.cyan("Git status:"));
      console.log(status.stdout.trim() + "\n");
    }
    const diff = spawnSync3("git", ["diff", "--color=always"], {
      cwd: this.runtime.workspaceRoot,
      encoding: "utf8"
    });
    if (diff.status === 0) {
      console.log(chalk4.cyan("Git diff:"));
      console.log(diff.stdout || chalk4.gray("No diff."));
    } else {
      console.log(chalk4.yellow("Unable to compute git diff. Is this a git repository?"));
    }
  }
  async undoLastMutation() {
    try {
      await this.files.undoLast();
      console.log(chalk4.green("Reverted last mutation."));
    } catch (error) {
      console.log(chalk4.yellow(error.message));
    }
  }
  async promptModelSelection() {
    const current = this.runtime.options.model ?? this.runtime.config.openrouter.model;
    const answer = await enquirer.prompt([
      {
        type: "input",
        name: "model",
        message: "Enter the OpenRouter model ID to use",
        initial: current
      }
    ]);
    if (answer.model && answer.model !== current) {
      this.runtime.options.model = answer.model;
      this.runtime.config.openrouter.model = answer.model;
      this.llm.setDefaultModel(answer.model);
      await saveConfig(this.runtime.config);
      this.contextWindow = getContextWindow(answer.model);
      this.contextPercentLeft = 100;
      this.emitStatus();
      console.log(chalk4.green(`Using model ${answer.model} (persisted to config).`));
    } else {
      console.log(chalk4.gray("Model unchanged."));
    }
  }
  async promptApprovalMode() {
    const answer = await enquirer.prompt([
      {
        type: "select",
        name: "mode",
        message: "Choose confirmation mode",
        choices: [
          { name: "confirm", message: "Require approval before risky actions" },
          { name: "prompt", message: "Auto-confirm actions (dangerous)" }
        ],
        initial: this.runtime.options.yes ? "prompt" : "confirm"
      }
    ]);
    this.runtime.options.yes = answer.mode === "prompt";
    console.log(
      answer.mode === "prompt" ? chalk4.yellow("Auto-confirm enabled. Use responsibly.") : chalk4.green("Manual approvals required before risky writes.")
    );
  }
  async createAgentsFile() {
    const target = path7.join(this.runtime.workspaceRoot, "AGENTS.md");
    if (await fs7.pathExists(target)) {
      console.log(chalk4.gray("AGENTS.md already exists in this workspace."));
      return;
    }
    const template = `# Project Autopilot

Describe how Autohand should work in this repo. Include framework commands, testing requirements, and any constraints.
`;
    await fs7.writeFile(target, template, "utf8");
    console.log(chalk4.green("Created AGENTS.md template. Customize it to guide the agent."));
  }
  async runInstruction(instruction) {
    this.isInstructionActive = true;
    this.clearExplorationLog();
    const spinner = ora({
      text: "Gathering context...",
      spinner: "dots"
    }).start();
    this.runtime.spinner = spinner;
    const abortController = new AbortController();
    let canceledByUser = false;
    const cleanupEsc = this.setupEscListener(abortController, () => {
      if (!canceledByUser) {
        canceledByUser = true;
        spinner.stop();
        console.log("\n" + chalk4.yellow("Request canceled by user (ESC)."));
      }
    }, true);
    const stopPreparation = this.startPreparationStatus(instruction);
    try {
      const userMessage = await this.buildUserMessage(instruction);
      stopPreparation();
      spinner.text = "Reasoning with the AI (ReAct loop)...";
      this.conversation.addMessage({ role: "user", content: userMessage });
      this.updateContextUsage(this.conversation.history());
      await this.runReactLoop(abortController);
    } catch (error) {
      if (abortController.signal.aborted) {
        return;
      }
      spinner.fail("Session failed");
      if (error instanceof Error) {
        console.error(chalk4.red(error.message));
      } else {
        console.error(error);
      }
    } finally {
      cleanupEsc();
      stopPreparation();
      spinner.stop();
      this.isInstructionActive = false;
      this.clearExplorationLog();
    }
  }
  async runReactLoop(abortController) {
    const maxIterations = 8;
    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      this.runtime.spinner?.start("Awaiting assistant response...");
      const completion = await this.llm.complete({
        messages: this.conversation.history(),
        temperature: this.runtime.options.temperature ?? 0.2,
        model: this.runtime.options.model,
        signal: abortController.signal
      });
      const payload = this.parseAssistantReactPayload(completion.content);
      this.conversation.addMessage({ role: "assistant", content: completion.content });
      this.updateContextUsage(this.conversation.history());
      if (payload.toolCalls && payload.toolCalls.length > 0) {
        if (payload.thought) {
          this.runtime.spinner?.stop();
          console.log(chalk4.gray(`   ${payload.thought}`));
          console.log();
        }
        const cropCalls = payload.toolCalls.filter((call) => call.tool === "smart_context_cropper");
        const otherCalls = payload.toolCalls.filter((call) => call.tool !== "smart_context_cropper");
        if (cropCalls.length) {
          for (const call of cropCalls) {
            const content = await this.handleSmartContextCrop(call);
            this.conversation.addMessage({ role: "tool", name: "smart_context_cropper", content });
            this.updateContextUsage(this.conversation.history());
            console.log(`
${chalk4.cyan("\u2702 smart_context_cropper")}
${chalk4.gray(content)}`);
          }
        }
        if (otherCalls.length) {
          this.runtime.spinner?.start("Executing tools...");
          const results = await this.toolManager.execute(otherCalls);
          for (const result of results) {
            const content = result.success ? result.output ?? "(no output)" : result.error ?? result.output ?? "Tool failed without error message";
            this.conversation.addMessage({ role: "tool", name: result.tool, content });
            this.updateContextUsage(this.conversation.history());
            const icon = result.success ? chalk4.green("\u2714") : chalk4.red("\u2716");
            console.log(`
${icon} ${chalk4.bold(result.tool)}`);
            if (content) {
              console.log(chalk4.gray(content));
            }
          }
        }
        continue;
      }
      this.runtime.spinner?.stop();
      if (payload.thought) {
        console.log(chalk4.gray(`   ${payload.thought}`));
        console.log();
      }
      const response = (payload.finalResponse ?? payload.response ?? completion.content).trim();
      console.log(response);
      return;
    }
    throw new Error("Reached maximum recursion depth while orchestrating tool calls.");
  }
  parseAssistantReactPayload(raw) {
    const jsonBlock = this.extractJson(raw);
    if (!jsonBlock) {
      return { finalResponse: raw.trim() };
    }
    try {
      const parsed = JSON.parse(jsonBlock);
      return {
        thought: parsed.thought,
        toolCalls: this.normalizeToolCalls(parsed.toolCalls),
        finalResponse: parsed.finalResponse ?? parsed.response ?? void 0,
        response: parsed.response
      };
    } catch {
      return { finalResponse: raw.trim() };
    }
  }
  normalizeToolCalls(value) {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.map((entry) => this.toToolCall(entry)).filter((call) => Boolean(call));
  }
  toToolCall(entry) {
    if (!entry || typeof entry.tool !== "string") {
      return null;
    }
    const args = entry.args && typeof entry.args === "object" ? entry.args : void 0;
    return {
      tool: entry.tool,
      args
    };
  }
  async handleSmartContextCrop(call) {
    const args = call.args ?? {};
    const direction = typeof args.crop_direction === "string" ? args.crop_direction.toLowerCase() : "";
    if (direction !== "top" && direction !== "bottom") {
      return "smart_context_cropper skipped: invalid crop_direction";
    }
    const amount = Number(args.crop_amount ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      return "smart_context_cropper skipped: crop_amount must be positive";
    }
    const needApproval = Boolean(args.need_user_approve);
    if (needApproval) {
      const approved = await this.confirmDangerousAction(
        `Crop ${direction} ${Math.floor(amount)} message(s) from the conversation?`
      );
      if (!approved) {
        return "smart_context_cropper canceled by user.";
      }
    }
    const removed = this.conversation.cropHistory(direction, Math.floor(amount));
    if (!removed.length) {
      return "smart_context_cropper: no eligible messages to remove.";
    }
    const summary = typeof args.deleted_messages_summary === "string" ? args.deleted_messages_summary.trim() : "";
    if (summary) {
      this.conversation.addSystemNote(`Cropped summary: ${summary}`);
    }
    return `Cropped ${removed.length} message(s) from the ${direction}.`;
  }
  async buildUserMessage(instruction) {
    const context = await this.collectContextSummary();
    const userPromptParts = [
      `Workspace: ${context.workspaceRoot}`,
      context.gitStatus ? `Git status:
${context.gitStatus}` : "Git status: clean or unavailable.",
      `Recent files: ${context.recentFiles.join(", ") || "none"}`,
      this.runtime.options.path ? `Target path: ${this.runtime.options.path}` : void 0,
      `Options: dryRun=${this.runtime.options.dryRun ?? false}, yes=${this.runtime.options.yes ?? false}`,
      `Instruction: ${instruction}`
    ].filter(Boolean).map(String);
    const mentionContext = this.flushMentionContexts();
    if (mentionContext) {
      if (mentionContext.files.length) {
        this.recordExploration({ kind: "read", target: mentionContext.files.join(", ") });
      }
      userPromptParts.push(`Mentioned files context:
${mentionContext.block}`);
    }
    return userPromptParts.join("\n\n");
  }
  buildSystemPrompt() {
    const tools = [
      "read_file",
      "write_file",
      "append_file",
      "apply_patch",
      "search",
      "create_directory",
      "delete_path",
      "rename_path",
      "copy_path",
      "replace_in_file",
      "run_command",
      "add_dependency",
      "remove_dependency",
      "format_file",
      "search_with_context",
      "list_tree",
      "file_stats",
      "checksum",
      "git_diff",
      "git_checkout",
      "git_status",
      "git_list_untracked",
      "git_diff_range",
      "git_apply_patch",
      "git_worktree_list",
      "git_worktree_add",
      "git_worktree_remove",
      "custom_command"
    ].join(", ");
    return [
      "You are Autohand, a CLI-first coding assistant that must follow the ReAct (Reason + Act) pattern.",
      "Phases: think about the request, decide whether to call tools, execute them, interpret the results, and only then respond.",
      `Available tools: ${tools}. Use them exactly by name with structured args.`,
      'Always reply with JSON: {"thought":"string","toolCalls":[{"tool":"tool_name","args":{...}}],"finalResponse":"string"}.',
      "If no tools are required, set toolCalls to an empty array and provide the finalResponse.",
      "When tools are needed, omit finalResponse until tool outputs (role=tool) arrive, then continue reasoning.",
      "Respect workspace safety; destructive operations require explicit approval and should be clearly justified in your thought.",
      "Never include markdown fences around the JSON and never hallucinate tools that do not exist."
    ].join("\n");
  }
  async resolveMentions(instruction) {
    const mentionRegex = /@([A-Za-z0-9_./\\-]*)/g;
    const matches = [];
    let match;
    while ((match = mentionRegex.exec(instruction)) !== null) {
      const token = match[0];
      const seed = match[1] ?? "";
      const start = match.index ?? 0;
      const prevChar = start > 0 ? instruction[start - 1] : " ";
      if (prevChar && /[^\s\(\[]/.test(prevChar)) {
        continue;
      }
      matches.push({ start, end: start + token.length, token, seed });
    }
    if (!matches.length) {
      return instruction;
    }
    let result = "";
    let lastIndex = 0;
    for (const entry of matches) {
      if (entry.start < lastIndex) {
        continue;
      }
      result += instruction.slice(lastIndex, entry.start);
      const replacement = await this.resolveMentionToken(entry.token, entry.seed);
      if (replacement) {
        result += replacement;
      } else {
        result += instruction.slice(entry.start, entry.end);
      }
      lastIndex = entry.end;
    }
    result += instruction.slice(lastIndex);
    return result;
  }
  async resolveMentionToken(token, seed) {
    const normalizedSeed = seed.trim();
    if (normalizedSeed && await this.fileExists(normalizedSeed)) {
      await this.captureMentionContext(normalizedSeed);
      return normalizedSeed;
    }
    if (!this.workspaceFiles.length) {
      return normalizedSeed || null;
    }
    const selection = await showFilePalette({
      files: this.workspaceFiles,
      statusLine: this.formatStatusLine(),
      seed: normalizedSeed
    });
    if (selection) {
      await this.captureMentionContext(selection);
      return selection;
    }
    return normalizedSeed || null;
  }
  async fileExists(relativePath) {
    const fullPath = path7.resolve(this.runtime.workspaceRoot, relativePath);
    if (!fullPath.startsWith(this.runtime.workspaceRoot)) {
      return false;
    }
    const exists = await fs7.pathExists(fullPath);
    if (!exists) {
      return false;
    }
    try {
      const stats = await fs7.stat(fullPath);
      return stats.isFile();
    } catch {
      return false;
    }
  }
  async captureMentionContext(file) {
    try {
      const contents = await this.files.readFile(file);
      this.mentionContexts.push({ path: file, contents: this.trimContext(contents) });
    } catch (error) {
      console.log(chalk4.yellow(`Unable to read ${file} for context: ${error.message}`));
    }
  }
  trimContext(content) {
    const limit = 2e3;
    if (content.length > limit) {
      return content.slice(0, limit) + "\n...trimmed";
    }
    return content;
  }
  flushMentionContexts() {
    if (!this.mentionContexts.length) {
      return null;
    }
    const contexts = [...this.mentionContexts];
    const block = contexts.map((ctx) => `File: ${ctx.path}
${ctx.contents}`).join("\n\n");
    this.mentionContexts = [];
    return {
      block,
      files: contexts.map((ctx) => ctx.path)
    };
  }
  extractJson(raw) {
    const fenceMatch = raw.match(/```json\s*([\s\S]*?)```/i);
    if (fenceMatch) {
      return fenceMatch[1];
    }
    const braceIndex = raw.indexOf("{");
    if (braceIndex !== -1) {
      return raw.slice(braceIndex);
    }
    return null;
  }
  recordExploration(event) {
    if (!this.isInstructionActive) {
      return;
    }
    if (!this.hasPrintedExplorationHeader) {
      console.log("\n" + chalk4.bold("* Explored"));
      this.hasPrintedExplorationHeader = true;
    }
    const label = this.formatExplorationLabel(event.kind);
    console.log(`  ${chalk4.cyan(label)} ${event.target}`);
  }
  clearExplorationLog() {
    this.hasPrintedExplorationHeader = false;
  }
  formatExplorationLabel(kind) {
    switch (kind) {
      case "read":
        return "Read";
      case "search":
        return "Search";
      default:
        return "List";
    }
  }
  async collectContextSummary() {
    const git = spawnSync3("git", ["status", "-sb"], {
      cwd: this.runtime.workspaceRoot,
      encoding: "utf8"
    });
    const gitStatus2 = git.status === 0 ? git.stdout.trim() : void 0;
    const entries = await fs7.readdir(this.runtime.workspaceRoot);
    const recentFiles = entries.filter((entry) => !entry.startsWith(".git")).slice(0, 20);
    return {
      workspaceRoot: this.runtime.workspaceRoot,
      gitStatus: gitStatus2,
      recentFiles
    };
  }
  setupEscListener(controller, onCancel, ctrlCInterrupt = false) {
    const input = process.stdin;
    if (!input.isTTY) {
      return () => {
      };
    }
    readline2.emitKeypressEvents(input);
    const supportsRaw = typeof input.setRawMode === "function";
    const wasRaw = input.isRaw;
    if (!wasRaw && supportsRaw) {
      input.setRawMode(true);
    }
    let ctrlCCount = 0;
    const handler = (_str, key) => {
      if (controller.signal.aborted) {
        return;
      }
      if (key?.name === "escape") {
        controller.abort();
        onCancel();
        return;
      }
      if (ctrlCInterrupt && key?.name === "c" && key.ctrl) {
        ctrlCCount += 1;
        if (ctrlCCount >= 2) {
          controller.abort();
          onCancel();
        } else {
          console.log(chalk4.gray("Press Ctrl+C again to exit."));
        }
      }
    };
    input.on("keypress", handler);
    return () => {
      input.off("keypress", handler);
      if (!wasRaw && supportsRaw) {
        input.setRawMode(false);
      }
    };
  }
  startPreparationStatus(instruction) {
    const label = this.describeInstruction(instruction);
    const startedAt = Date.now();
    const update = () => {
      if (!this.runtime.spinner) {
        return;
      }
      const elapsed = this.formatElapsedTime(startedAt);
      this.runtime.spinner.text = `Preparing to ${label} (${elapsed} \u2022 esc to interrupt)`;
    };
    update();
    let stopped = false;
    const interval = setInterval(update, 1e3);
    return () => {
      if (stopped) {
        return;
      }
      clearInterval(interval);
      stopped = true;
    };
  }
  describeInstruction(instruction) {
    const normalized = instruction.trim().replace(/\s+/g, " ");
    if (!normalized) {
      return "work";
    }
    return normalized.length > 60 ? `${normalized.slice(0, 57)}\u2026` : normalized;
  }
  formatElapsedTime(startedAt) {
    const diff = Date.now() - startedAt;
    const minutes = Math.floor(diff / 6e4);
    const seconds = Math.floor(diff % 6e4 / 1e3);
    return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
  }
  updateContextUsage(messages) {
    if (!this.contextWindow) {
      return;
    }
    const usage = estimateMessagesTokens(messages);
    const percent = Math.max(0, Math.min(1 - usage / this.contextWindow, 1));
    this.contextPercentLeft = Math.round(percent * 100);
    this.emitStatus();
  }
  formatStatusLine() {
    const percent = Number.isFinite(this.contextPercentLeft) ? Math.max(0, Math.min(100, this.contextPercentLeft)) : 100;
    return `${percent}% context left \xB7 / for commands \xB7 @ to mention files`;
  }
  resetConversationContext() {
    this.conversation.reset(this.buildSystemPrompt());
    this.mentionContexts = [];
    this.updateContextUsage(this.conversation.history());
  }
  async confirmDangerousAction(message) {
    if (this.runtime.options.yes || this.runtime.config.ui?.autoConfirm) {
      return true;
    }
    const answer = await enquirer.prompt([
      {
        type: "confirm",
        name: "confirm",
        message,
        initial: false
      }
    ]);
    return answer.confirm;
  }
  resolveWorkspacePath(relativePath) {
    const resolved = path7.resolve(this.runtime.workspaceRoot, relativePath);
    if (!resolved.startsWith(this.runtime.workspaceRoot)) {
      throw new Error(`Path ${relativePath} escapes workspace root.`);
    }
    return resolved;
  }
  isDestructiveCommand(command) {
    const lowered = command.toLowerCase();
    return lowered.includes("rm ") || lowered.includes("sudo ") || lowered.includes("dd ");
  }
  setStatusListener(listener) {
    this.statusListener = listener;
    this.emitStatus();
  }
  emitStatus() {
    if (this.statusListener) {
      this.statusListener(this.getStatusSnapshot());
    }
  }
  getStatusSnapshot() {
    return {
      model: this.runtime.options.model ?? this.runtime.config.openrouter.model,
      workspace: this.runtime.workspaceRoot,
      contextPercent: this.contextPercentLeft
    };
  }
};

// src/index.ts
var ASCII_FRIEND = [
  "\u2880\u2874\u281B\u281B\u283B\u28F7\u2844\u2800\u28E0\u2876\u281F\u281B\u283B\u28F6\u2844\u2880\u28F4\u287E\u281B\u281B\u28BF\u28E6\u2800\u2880\u28F4\u281E\u281B\u281B\u2836\u2840",
  "\u284E\u2800\u28B0\u28F6\u2846\u2808\u28FF\u28F4\u28FF\u2801\u28F4\u28F6\u2844\u2818\u28FF\u28FE\u284F\u2880\u28F6\u28E6\u2800\u28BB\u2847\u28FF\u2803\u28A0\u28F6\u2846\u2800\u28B9",
  "\u28A7\u2800\u2818\u281B\u2803\u28A0\u287F\u2819\u28FF\u2840\u2819\u281B\u2803\u28F0\u287F\u28BB\u28E7\u2808\u281B\u281B\u2880\u28FE\u2807\u28BB\u28C6\u2808\u281B\u280B\u2800\u287C",
  "\u2808\u283B\u28B6\u28F6\u287E\u281F\u2801\u2800\u2818\u283F\u28B6\u28F6\u287E\u281F\u2801\u2800\u2819\u2837\u28F6\u28F6\u283F\u280B\u2800\u2808\u283B\u2837\u28F6\u2876\u281A\u2801",
  "\u2880\u28F4\u283F\u283F\u2837\u28E6\u2840\u2800\u28E0\u28F6\u283F\u283B\u28B7\u28E6\u2840\u2800\u28E0\u287E\u281F\u283F\u28F6\u28C4\u2800\u2880\u28F4\u287E\u283F\u283F\u28F6\u28C4",
  "\u287E\u2803\u28A0\u28E4\u2844\u2818\u28FF\u28E0\u28FF\u2801\u28E0\u28E4\u2844\u2839\u28F7\u28FC\u284F\u2880\u28E4\u28E4\u2808\u28BF\u2846\u28FE\u280F\u2880\u28E4\u28C4\u2808\u28BF",
  "\u28A7\u2840\u2838\u283F\u2807\u2880\u28FF\u283A\u28FF\u2840\u283B\u283F\u2803\u28B0\u28FF\u28BF\u28C7\u2808\u283F\u283F\u2800\u28FC\u2847\u28BF\u28C7\u2818\u283F\u2807\u2800\u28F8",
  "\u2808\u28BF\u28E6\u28E4\u28F4\u287F\u2803\u2800\u2819\u28B7\u28E6\u28E4\u28F6\u287F\u2801\u2808\u283B\u28F7\u28E4\u28E4\u287E\u281B\u2800\u2808\u28BF\u28E6\u28E4\u28E4\u2834\u2801"
].join("\n");
var program = new Command();
program.name("autohand").description("Autonomous LLM-powered coding agent CLI").option("-p, --prompt <text>", "Run a single instruction in command mode").option("--path <path>", "Workspace path to operate in").option("--yes", "Auto-confirm risky actions", false).option("--dry-run", "Preview actions without applying mutations", false).option("--model <model>", "Override the configured LLM model").option("--config <path>", "Path to config file (default ~/.autohand-cli/config.json)").option("--temperature <value>", "Sampling temperature", parseFloat).action(async (opts) => {
  await runCLI(opts);
});
async function runCLI(options) {
  let statusPanel = null;
  try {
    const config = await loadConfig(options.config);
    const workspaceRoot = resolveWorkspaceRoot(config, options.path);
    const runtime = {
      config,
      workspaceRoot,
      options
    };
    printBanner();
    printWelcome(runtime);
    const openRouter = new OpenRouterClient({
      ...config.openrouter,
      model: options.model ?? config.openrouter.model
    });
    const files = new FileActionManager(workspaceRoot);
    const agent = new AutohandAgent(openRouter, files, runtime);
    if (options.prompt) {
      await agent.runInstruction(options.prompt);
    } else {
      await agent.runInteractive();
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error(chalk5.red(error.message));
    } else {
      console.error(error);
    }
    process.exitCode = 1;
  } finally {
  }
}
function printBanner() {
  if (process.env.AUTOHAND_NO_BANNER === "1") {
    return;
  }
  if (process.stdout.isTTY) {
    console.log(chalk5.gray(ASCII_FRIEND));
  } else {
    console.log("autohand");
  }
}
function printWelcome(runtime) {
  if (!process.stdout.isTTY) {
    return;
  }
  const model = runtime.options.model ?? runtime.config.openrouter.model;
  const dir = runtime.workspaceRoot;
  console.log(`${chalk5.bold("> Autohand")} v${package_default.version}`);
  console.log(`${chalk5.gray("model:")} ${chalk5.cyan(model)}  ${chalk5.gray("| directory:")} ${chalk5.cyan(dir)}`);
  console.log();
  console.log(chalk5.gray("To get started, describe a task or try one of these commands:"));
  console.log(chalk5.cyan("/init ") + chalk5.gray("create an AGENTS.md file with instructions for Autohand"));
  console.log(chalk5.cyan("/help ") + chalk5.gray("review my current changes and find issues"));
  console.log();
}
program.parseAsync();
/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
