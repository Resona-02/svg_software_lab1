import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const extension = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(extension, '../..');
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const baseline = git(['rev-parse', '7a5cfbf^{commit}']);
const extensionCommit = git(['rev-parse', '552a7e7^{commit}']);
const protectedPaths = [
  'extensions/dsh-code-atlas/src/analysis', 'extensions/dsh-code-atlas/src/core',
  'extensions/dsh-code-atlas/src/render', 'src', 'plugins',
];
for (const path of protectedPaths) assert.equal(git(['diff', '--numstat', baseline, extensionCommit, '--', path]), '', `${path} must be byte-identical`);
const changedFiles = git(['diff', '--name-only', baseline, extensionCommit]).split('\n');
assert(changedFiles.includes('extensions/dsh-code-atlas/src/plugins/test-file-label.ts'));
assert(changedFiles.includes('extensions/dsh-code-atlas/src/host/CodeAtlasService.ts'));
const record = { baseline, extensionCommit, plugin: 'test-file', changedFiles,
  protectedPaths, protectedSourceChanges: 0, protectedComplexityDelta: 0,
  explanation: 'Protected Git trees are byte-identical; only the new label implementation, composition, build entry, tests and docs change.' };
await mkdir(resolve(extension, 'examples'), { recursive: true });
await writeFile(resolve(extension, 'examples/extension-proof.json'), JSON.stringify(record, null, 2) + '\n');
console.log('Test-file label extension: analysis, workbench, renderer and existing SVG core have zero Git changes.');
