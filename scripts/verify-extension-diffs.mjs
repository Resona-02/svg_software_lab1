import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, process.argv[2] ?? 'docs/metrics/extension-diffs.json');
assert(process.argv.length <= 3, 'usage: node scripts/verify-extension-diffs.mjs [output.json]');
const corePaths = ['src/domain', 'src/application', 'src/cli', 'src/infrastructure', 'src/api'];
const assembly = 'src/host/CodePlugins.ts';
const loader = 'src/host/PluginLoader.ts';
const renderer = 'src/application/ViewReceiver.ts';
const cases = [
  { name: 'box-code-A', ref: 'dfcbe29', plugin: 'plugins/shape-box', assemblyChanged: true, configChanged: false },
  { name: 'box-config-B', ref: '04b315b', plugin: 'plugins/shape-box', assemblyChanged: false, configChanged: true },
  { name: 'tree-star', ref: 'fdffd8d', plugin: 'plugins/tree-star', assemblyChanged: true, configChanged: true },
];
const snapshots = new Map();

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 });
}

function commit(ref) {
  const value = git('rev-parse', '--verify', `${ref}^{commit}`).trim();
  assert.match(value, /^[0-9a-f]{40}$/, `not a commit: ${ref}`);
  return value;
}

function pathType(revision, path, expected) {
  let actual;
  try { actual = git('cat-file', '-t', `${revision}:${path}`).trim(); }
  catch { throw new Error(`required Git path does not exist: ${revision}:${path}`); }
  assert.equal(actual, expected, `wrong Git object type: ${revision}:${path}`);
  return git('rev-parse', `${revision}:${path}`).trim();
}

function sourceDirectory(revision, path) {
  const key = `${revision}:${path}`;
  if (snapshots.has(key)) return snapshots.get(key);
  const treeOid = pathType(revision, path, 'tree');
  const files = git('ls-tree', '-r', '--name-only', '-z', revision, '--', path).split('\0')
    .filter(file => file.endsWith('.ts')).sort();
  assert(files.length > 0, `required directory has no TypeScript sources: ${key}`);
  const hash = createHash('sha256');
  for (const file of files) {
    // Read source blobs from the requested revision, never from the working tree.
    hash.update(file).update('\0').update(git('show', `${revision}:${file}`)).update('\0');
  }
  const result = { path, exists: true, objectType: 'tree', treeOid, sourceFileCount: files.length,
    sourceFiles: files, sourceSha256: hash.digest('hex') };
  snapshots.set(key, result);
  return result;
}

function sourceFile(revision, path) {
  const blobOid = pathType(revision, path, 'blob');
  const content = git('show', `${revision}:${path}`);
  assert(content.length > 0, `required source file is empty: ${revision}:${path}`);
  return { path, exists: true, objectType: 'blob', blobOid,
    sha256: createHash('sha256').update(content).digest('hex') };
}

function diffEvidence(parent, current, paths = []) {
  const command = ['git', 'diff', '--name-status', '--no-renames', parent, current, '--', ...paths];
  return { command, output: git(...command.slice(1)) };
}

function changedPaths(parent, current, paths = []) {
  return git('diff', '--name-only', '--no-renames', '-z', parent, current, '--', ...paths)
    .split('\0').filter(Boolean).sort();
}

function verify(item) {
  const current = commit(item.ref);
  const parent = commit(`${current}^`);
  pathType(parent, 'plugins', 'tree');
  pathType(current, 'plugins', 'tree');
  const existingPlugins = git('ls-tree', '-d', '--name-only', '-z', `${parent}:plugins`)
    .split('\0').filter(Boolean).map(name => `plugins/${name}`).sort();
  assert(existingPlugins.length > 0, `${parent} has no existing plugins to protect`);
  assert(!existingPlugins.includes(item.plugin), `plugin is not new at ${current}: ${item.plugin}`);
  assert.equal(git('ls-tree', '--name-only', parent, '--', item.plugin), '', `new plugin already exists at ${parent}`);
  const before = [...corePaths, ...existingPlugins].map(path => sourceDirectory(parent, path));
  const after = [...corePaths, ...existingPlugins].map(path => sourceDirectory(current, path));
  const addedPlugin = sourceDirectory(current, item.plugin);
  pathType(current, `${item.plugin}/package.json`, 'blob');
  const packageManifest = JSON.parse(git('show', `${current}:${item.plugin}/package.json`));
  const protectedFiles = [loader, renderer, assembly].map(path => ({
    path, before: sourceFile(parent, path), after: sourceFile(current, path),
  }));

  const full = diffEvidence(parent, current);
  const protectedDiff = diffEvidence(parent, current, [...corePaths, 'plugins', `:(exclude)${item.plugin}`]);
  assert.equal(protectedDiff.output, '', `${item.name}: core or existing plugins changed`);
  const loaderAndRenderer = diffEvidence(parent, current, [loader, renderer]);
  assert.equal(loaderAndRenderer.output, '', `${item.name}: loader or renderer changed`);
  const sourceDiff = diffEvidence(parent, current, ['src']);
  assert.deepEqual(changedPaths(parent, current, ['src']), item.assemblyChanged ? [assembly] : [],
    `${item.name}: existing runtime changes exceeded the assembly allowance`);
  const configDiff = diffEvidence(parent, current, ['plugins.config.json']);
  assert.equal(configDiff.output.length > 0, item.configChanged, `${item.name}: unexpected configuration change`);
  if (item.configChanged) {
    sourceFile(parent, 'plugins.config.json');
    sourceFile(current, 'plugins.config.json');
  }
  const addedPaths = changedPaths(parent, current, [item.plugin]);
  assert(addedPaths.length > 0, `${item.name}: no added plugin files`);
  const statuses = git('diff', '--name-status', '--no-renames', '-z', parent, current, '--', item.plugin).split('\0').filter(Boolean);
  for (let index = 0; index < statuses.length; index += 2) assert.equal(statuses[index], 'A', `plugin file was not added: ${statuses[index + 1]}`);

  const allChanges = changedPaths(parent, current);
  const supporting = allChanges.filter(path => !path.startsWith(`${item.plugin}/`) && path !== assembly && path !== 'plugins.config.json');
  for (const path of supporting) {
    assert(/^(?:test|tests|doc|docs)\//.test(path) || ['package.json', 'package-lock.json'].includes(path),
      `${item.name}: undeclared changed file outside plugin/assembly/config: ${path}`);
  }
  return {
    name: item.name, requestedRef: item.ref, commit: current, parent,
    policy: { newPlugin: item.plugin, allowedExistingSourceChanges: item.assemblyChanged ? [assembly] : [],
      configurationChanged: item.configChanged, protectedCorePaths: corePaths, protectedExistingPlugins: existingPlugins },
    pathExistence: { before, after, protectedFiles, newPlugin: { existsBefore: false, after: addedPlugin,
      manifestName: packageManifest.name, contributes: packageManifest.contributes } },
    evidence: { full, protectedCoreAndExistingPlugins: protectedDiff, loaderAndRenderer, sourceChanges: sourceDiff, configuration: configDiff },
    addedPluginFiles: addedPaths, supportingChanges: supporting,
    checks: { pathsExistAndContainSource: true, newPluginDidNotExistBefore: true,
      onlyNewPluginFilesAdded: true, coreAndExistingPluginsUnchanged: true, loaderAndRendererUnchanged: true,
      sourceChangeAllowanceSatisfied: true, configChangeAllowanceSatisfied: true, supportingChangesDeclared: true },
    passed: true,
  };
}

// Resolve and validate every revision and path before replacing the report. A missing
// ref/path, unexpected source edit or empty source tree makes the script fail.
const results = cases.map(verify);
const branch = commit('phase2-box-config');
assert.equal(branch, results.find(result => result.name === 'box-config-B').commit,
  'phase2-box-config no longer points to the verified B demonstration commit');
const report = {
  methodology: 'Committed Git trees only; validate real source paths before accepting empty C^..C diffs. No working-tree input or timestamp.',
  configDemonstrationBranch: { name: 'phase2-box-config', commit: branch },
  cases: results, passed: true,
};
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Extension diff verification passed: ${results.map(result => result.name).join(', ')}. Report: ${output}`);
