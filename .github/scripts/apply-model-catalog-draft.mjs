#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag?.startsWith("--") || !value) throw new Error(`Invalid argument near ${flag ?? "end of input"}`);
    options[flag.slice(2)] = value;
  }
  for (const required of ["draft", "catalog", "source-sha"]) {
    if (!options[required]) throw new Error(`--${required} is required`);
  }
  return options;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const options = parseArgs(process.argv.slice(2));
const draft = JSON.parse(readFileSync(options.draft, "utf8"));
if (!isRecord(draft) || draft.schemaVersion !== 1 || !isRecord(draft.source) || !isRecord(draft.catalog)) {
  throw new Error("Invalid model catalog draft");
}
if (draft.source.sha !== options["source-sha"]) {
  throw new Error("Model catalog draft source SHA does not match the workflow input");
}
if (!isRecord(draft.catalog.providers)) {
  throw new Error("Model catalog draft has no providers object");
}
writeFileSync(options.catalog, `${JSON.stringify(draft.catalog, null, 2)}\n`);
