#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag?.startsWith("--")) throw new Error(`Expected a flag starting with "--", found "${flag ?? "end of input"}"`);
    if (!value) throw new Error(`Value for ${flag} is empty or unset — check the corresponding environment variable/secret`);
    options[flag.slice(2)] = value;
  }
  for (const required of ["input", "bucket", "endpoint", "source-commit", "revision-prefix", "latest-key", "metadata-key"]) {
    if (!options[required]) throw new Error(`--${required} is required`);
  }
  return options;
}

function runAws(args) {
  const result = spawnSync("aws", args, {
    encoding: "utf8",
    env: {
      ...process.env,
      AWS_DEFAULT_REGION: process.env.AWS_DEFAULT_REGION || "auto",
      AWS_EC2_METADATA_DISABLED: "true",
    },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${result.stdout}\n${result.stderr}`.trim());
}

function upload(options, source, key, cacheControl, metadata) {
  const args = [
    "s3",
    "cp",
    source,
    `s3://${options.bucket}/${key}`,
    "--endpoint-url",
    options.endpoint,
    "--content-type",
    "application/json; charset=utf-8",
    "--cache-control",
    cacheControl,
  ];
  if (metadata) {
    args.push("--metadata", metadata);
  }
  args.push("--only-show-errors");
  runAws(args);
}

const options = parseArgs(process.argv.slice(2));
const bytes = readFileSync(options.input);
const catalog = JSON.parse(bytes.toString("utf8"));
const providerCount = Object.keys(catalog).length;
const modelCount = Object.values(catalog).reduce((total, provider) => total + Object.keys(provider).length, 0);
if (providerCount === 0 || modelCount === 0) throw new Error("Refusing to publish an empty model catalog");

const revision = `sha256-${createHash("sha256").update(bytes).digest("hex")}`;
const prefix = options["revision-prefix"].replace(/\/$/u, "");
const revisionKey = `${prefix}/${revision}/models.json`;
const publication = {
  schemaVersion: 1,
  revision,
  sourceCommit: options["source-commit"],
  publishedAt: new Date().toISOString(),
  providerCount,
  modelCount,
  objectKey: revisionKey,
};

const directory = mkdtempSync(join(tmpdir(), "autohand-model-publication-"));
try {
  const metadataPath = join(directory, "catalog.json");
  writeFileSync(metadataPath, `${JSON.stringify(publication, null, 2)}\n`);
  upload(options, options.input, revisionKey, "public, max-age=31536000, immutable", `revision=${revision}`);
  upload(options, metadataPath, `${prefix}/${revision}/catalog.json`, "public, max-age=31536000, immutable");
  upload(options, options.input, options["latest-key"], "public, max-age=300, stale-while-revalidate=86400", `revision=${revision}`);
  upload(options, metadataPath, options["metadata-key"], "no-store");
  console.log(JSON.stringify(publication));
} finally {
  rmSync(directory, { recursive: true, force: true });
}
