import { readdir, readFile, writeFile } from 'node:fs/promises';

const directory = new URL('../src/agents/builtin/', import.meta.url);
const sources = {};
for (const name of (await readdir(directory)).filter(name => name.endsWith('.md')).sort()) {
  sources[name] = await readFile(new URL(name, directory), 'utf8');
}
await writeFile(new URL('../src/agents/builtinSources.json', import.meta.url),
  JSON.stringify(sources, null, 2) + '\n');
