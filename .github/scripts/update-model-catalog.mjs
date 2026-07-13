#!/usr/bin/env node

import {
  appendFileSync,
  readFileSync,
  writeFileSync,
} from "node:fs";

const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/+@-]{0,255}$/;
const REASONING_EFFORTS = new Set(["none", "low", "medium", "high", "xhigh"]);
const NO_RESPONSE_VALUES = new Set(["", "_No response_", "Not specified"]);

function parseArguments(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined) {
      throw new Error(`Invalid argument near ${flag ?? "end of input"}`);
    }
    options[flag.slice(2)] = value;
  }

  const required = [
    "catalog",
    "issue-body",
    "result",
    "pull-request-body",
    "issue-number",
  ];
  for (const name of required) {
    if (!options[name]) {
      throw new Error(`Missing required argument: --${name}`);
    }
  }

  if (!/^\d+$/.test(options["issue-number"])) {
    throw new Error("Issue number must be a positive integer");
  }

  return options;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseIssueFields(body) {
  const headings = [...body.matchAll(/^###\s+(.+?)\s*$/gm)];
  const fields = new Map();

  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    const label = heading[1].trim();
    const valueStart = heading.index + heading[0].length;
    const valueEnd = headings[index + 1]?.index ?? body.length;
    if (fields.has(label)) {
      throw new Error(`Duplicate issue field: ${label}`);
    }
    fields.set(label, body.slice(valueStart, valueEnd).trim());
  }

  return fields;
}

function optionalValue(value) {
  const normalized = value?.trim() ?? "";
  return NO_RESPONSE_VALUES.has(normalized) ? undefined : normalized;
}

function invalid(message) {
  return { status: "invalid", message };
}

function parseRequest(body, catalog) {
  const fields = parseIssueFields(body);
  const provider = fields.get("Provider")?.trim() ?? "";
  const modelId = fields.get("Model ID")?.trim() ?? "";

  if (!provider || /[\r\n]/.test(provider)) {
    return invalid("Provider is required");
  }
  if (!isRecord(catalog.providers) || !isRecord(catalog.providers[provider])) {
    return invalid(`Unsupported provider: ${provider}`);
  }
  if (!modelId) {
    return invalid("Model ID is required");
  }
  if (!MODEL_ID_PATTERN.test(modelId)) {
    return invalid("Model ID contains unsupported characters");
  }

  const displayName = optionalValue(fields.get("Display name"));
  if (displayName && (displayName.length > 120 || /[\r\n\u0000-\u001f]/.test(displayName))) {
    return invalid("Display name must be a single line of at most 120 characters");
  }

  const contextWindowValue = optionalValue(fields.get("Context window"));
  let contextWindow;
  if (contextWindowValue) {
    if (!/^\d+$/.test(contextWindowValue)) {
      return invalid("Context window must be a positive integer");
    }
    contextWindow = Number(contextWindowValue);
    if (!Number.isSafeInteger(contextWindow) || contextWindow < 1 || contextWindow > 100_000_000) {
      return invalid("Context window must be between 1 and 100000000");
    }
  }

  const reasoningEffort = optionalValue(fields.get("Reasoning effort"));
  if (reasoningEffort && !REASONING_EFFORTS.has(reasoningEffort)) {
    return invalid("Reasoning effort is not supported");
  }

  return {
    status: "valid",
    provider,
    modelId,
    displayName,
    contextWindow,
    reasoningEffort,
  };
}

function entryId(entry) {
  if (typeof entry === "string") {
    return entry;
  }
  return isRecord(entry) && typeof entry.id === "string" ? entry.id : undefined;
}

function buildEntry(request, models) {
  const hasMetadata = request.displayName !== undefined
    || request.contextWindow !== undefined
    || request.reasoningEffort !== undefined;
  const usesStructuredEntries = models.some((entry) => isRecord(entry));

  if (!hasMetadata && !usesStructuredEntries) {
    return request.modelId;
  }

  return {
    id: request.modelId,
    ...(request.displayName ? { displayName: request.displayName } : {}),
    ...(request.contextWindow ? { contextWindow: request.contextWindow } : {}),
    ...(request.reasoningEffort ? { reasoningEffort: request.reasoningEffort } : {}),
  };
}

function skipWhitespace(source, start) {
  let cursor = start;
  while (cursor < source.length && /\s/.test(source[cursor])) {
    cursor += 1;
  }
  return cursor;
}

function scanStringEnd(source, start) {
  if (source[start] !== '"') {
    throw new Error(`Expected JSON string at offset ${start}`);
  }

  for (let cursor = start + 1; cursor < source.length; cursor += 1) {
    if (source[cursor] === "\\") {
      cursor += 1;
    } else if (source[cursor] === '"') {
      return cursor + 1;
    }
  }

  throw new Error(`Unterminated JSON string at offset ${start}`);
}

function scanCompositeEnd(source, start) {
  const closingTokens = { "{": "}", "[": "]" };
  const stack = [closingTokens[source[start]]];

  if (!stack[0]) {
    throw new Error(`Expected JSON object or array at offset ${start}`);
  }

  for (let cursor = start + 1; cursor < source.length; cursor += 1) {
    const token = source[cursor];
    if (token === '"') {
      cursor = scanStringEnd(source, cursor) - 1;
    } else if (closingTokens[token]) {
      stack.push(closingTokens[token]);
    } else if (token === stack.at(-1)) {
      stack.pop();
      if (stack.length === 0) {
        return cursor + 1;
      }
    }
  }

  throw new Error(`Unterminated JSON value at offset ${start}`);
}

function scanValueEnd(source, start) {
  const cursor = skipWhitespace(source, start);
  if (source[cursor] === '"') {
    return scanStringEnd(source, cursor);
  }
  if (source[cursor] === "{" || source[cursor] === "[") {
    return scanCompositeEnd(source, cursor);
  }

  let end = cursor;
  while (end < source.length && !/[\s,\]}]/.test(source[end])) {
    end += 1;
  }
  if (end === cursor) {
    throw new Error(`Expected JSON value at offset ${cursor}`);
  }
  return end;
}

function findObjectProperty(source, objectStart, propertyName) {
  if (source[objectStart] !== "{") {
    throw new Error(`Expected JSON object at offset ${objectStart}`);
  }

  let cursor = skipWhitespace(source, objectStart + 1);
  while (source[cursor] !== "}") {
    const keyStart = cursor;
    const keyEnd = scanStringEnd(source, keyStart);
    const key = JSON.parse(source.slice(keyStart, keyEnd));
    cursor = skipWhitespace(source, keyEnd);
    if (source[cursor] !== ":") {
      throw new Error(`Expected property separator at offset ${cursor}`);
    }

    const valueStart = skipWhitespace(source, cursor + 1);
    const valueEnd = scanValueEnd(source, valueStart);
    if (key === propertyName) {
      return { start: valueStart, end: valueEnd };
    }

    cursor = skipWhitespace(source, valueEnd);
    if (source[cursor] === ",") {
      cursor = skipWhitespace(source, cursor + 1);
    } else if (source[cursor] !== "}") {
      throw new Error(`Expected property delimiter at offset ${cursor}`);
    }
  }

  throw new Error(`Property not found in catalog source: ${propertyName}`);
}

function formatModelEntry(entry) {
  if (typeof entry === "string") {
    return JSON.stringify(entry);
  }

  const fields = Object.entries(entry)
    .map(([name, value]) => `${JSON.stringify(name)}: ${JSON.stringify(value)}`);
  return `{ ${fields.join(", ")} }`;
}

function appendArrayEntry(source, range, entry) {
  const openIndex = range.start;
  const closeIndex = range.end - 1;
  if (source[openIndex] !== "[" || source[closeIndex] !== "]") {
    throw new Error("Catalog models value must be a JSON array");
  }

  const formattedEntry = formatModelEntry(entry);
  const content = source.slice(openIndex + 1, closeIndex);
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const closingNewline = source.lastIndexOf("\n", closeIndex - 1);
  const hasMultilineLayout = closingNewline > openIndex;

  if (content.trim() === "") {
    if (!hasMultilineLayout) {
      return `${source.slice(0, openIndex + 1)}${formattedEntry}${source.slice(closeIndex)}`;
    }

    const closingIndent = source.slice(closingNewline + 1, closeIndex);
    const insertionStart = newline === "\r\n" ? closingNewline - 1 : closingNewline;
    const replacement = `${newline}${closingIndent}  ${formattedEntry}`;
    return `${source.slice(0, insertionStart)}${replacement}${source.slice(insertionStart)}`;
  }

  if (!hasMultilineLayout) {
    return `${source.slice(0, closeIndex)}, ${formattedEntry}${source.slice(closeIndex)}`;
  }

  const insertionStart = newline === "\r\n" ? closingNewline - 1 : closingNewline;
  const previousLineStart = source.lastIndexOf("\n", insertionStart - 1) + 1;
  const previousLine = source.slice(previousLineStart, insertionStart);
  const itemIndent = previousLine.match(/^[ \t]*/)?.[0] ?? "";
  const insertion = `,${newline}${itemIndent}${formattedEntry}`;
  return `${source.slice(0, insertionStart)}${insertion}${source.slice(insertionStart)}`;
}

function appendModelEntry(source, provider, entry) {
  const rootStart = skipWhitespace(source, 0);
  const providers = findObjectProperty(source, rootStart, "providers");
  const providerCatalog = findObjectProperty(source, providers.start, provider);
  const models = findObjectProperty(source, providerCatalog.start, "models");
  const updatedSource = appendArrayEntry(source, models, entry);
  JSON.parse(updatedSource);
  return updatedSource;
}

function buildPullRequestBody(result, issueNumber) {
  const lines = [
    "## Automated model catalog update",
    "",
    `- Provider: \`${result.provider ?? "unknown"}\``,
    `- Model ID: \`${result.modelId ?? "unknown"}\``,
  ];

  if (result.displayName) {
    lines.push(`- Display name: ${result.displayName}`);
  }
  if (result.contextWindow) {
    lines.push(`- Context window: ${result.contextWindow}`);
  }
  if (result.reasoningEffort) {
    lines.push(`- Reasoning effort: \`${result.reasoningEffort}\``);
  }

  lines.push(
    "",
    `Closes #${issueNumber}`,
    "",
    "This pull request was generated from the model catalog issue form. It requires normal maintainer review and is not automatically approved or merged.",
    "",
  );
  return lines.join("\n");
}

function writeOutputs(outputPath, result) {
  if (!outputPath) {
    return;
  }

  const outputs = {
    status: result.status,
    provider: result.provider ?? "",
    model_id: result.modelId ?? "",
    message: result.message,
  };
  for (const [name, value] of Object.entries(outputs)) {
    appendFileSync(outputPath, `${name}=${String(value).replace(/[\r\n]/g, " ")}\n`);
  }
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const originalCatalog = readFileSync(options.catalog, "utf8");
  const catalog = JSON.parse(originalCatalog);
  const issueBody = readFileSync(options["issue-body"], "utf8");
  const request = parseRequest(issueBody, catalog);
  let result;

  if (request.status === "invalid") {
    result = request;
  } else {
    const providerCatalog = catalog.providers[request.provider];
    if (!Array.isArray(providerCatalog.models)) {
      result = invalid(`Provider catalog has no models array: ${request.provider}`);
    } else if (providerCatalog.models.some((entry) => entryId(entry) === request.modelId)) {
      result = {
        status: "duplicate",
        provider: request.provider,
        modelId: request.modelId,
        message: `Model ${request.modelId} already exists for ${request.provider}`,
      };
    } else {
      const entry = buildEntry(request, providerCatalog.models);
      writeFileSync(
        options.catalog,
        appendModelEntry(originalCatalog, request.provider, entry),
      );
      result = {
        status: "added",
        provider: request.provider,
        modelId: request.modelId,
        displayName: request.displayName,
        contextWindow: request.contextWindow,
        reasoningEffort: request.reasoningEffort,
        message: `Added ${request.modelId} to ${request.provider}`,
      };
    }
  }

  writeFileSync(options.result, `${JSON.stringify(result, null, 2)}\n`);
  writeFileSync(
    options["pull-request-body"],
    buildPullRequestBody(result, options["issue-number"]),
  );
  writeOutputs(options["github-output"], result);
}

main();
