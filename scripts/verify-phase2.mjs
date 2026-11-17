import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
for (const argument of args) {
  if (!['--update', '--baseline-only'].includes(argument)) throw new Error(`unknown argument: ${argument}`);
}
const record = args.has('--update');
const baselineOnly = args.has('--baseline-only');
const fixtures = resolve(root, 'doc/transcript/fixtures');
const expectedDirectory = resolve(root, 'doc/transcript/expected');
const temporary = mkdtempSync(resolve(tmpdir(), 'svg-phase2-'));
const checkout = resolve(temporary, 'final');
const work = resolve(temporary, 'workspace');
const logs = resolve(temporary, 'logs');
const sessions = [
  { name: 'cli-1', files: ['demo.svg'] },
  { name: 'cli-box', files: ['flowchart-box.svg'] },
  { name: 'cli-commands', files: ['snapshot.svg'] },
];
const recorded = new Map();
const checks = [];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function build(directory) {
  execFileSync(process.execPath, [resolve(root, 'node_modules/typescript/bin/tsc'), '-p', resolve(directory, 'tsconfig.json')], {
    cwd: directory, stdio: 'pipe', timeout: 120_000,
  });
}

function prepareWorkingDirectory() {
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  for (const directory of ['docs', 'plugins']) mkdirSync(resolve(work, directory));
  copyFileSync(resolve(fixtures, 'other.svg'), resolve(work, 'other.svg'));
  // Keep the same names throughout the stats/dir session, including during save.
  copyFileSync(resolve(fixtures, 'other.svg'), resolve(work, 'snapshot.svg'));
  writeFileSync(resolve(work, '.hidden'), 'hidden fixture\n');
  writeFileSync(resolve(work, 'package.json'), '{"name":"directory-fixture"}\n');
}

function run(label, entry, options, session) {
  prepareWorkingDirectory();
  const input = readFileSync(resolve(root, `doc/transcript/${session.name}.txt`));
  assert(!/^\s*svg>/m.test(input.toString()), 'session input must not contain prompts');
  const result = spawnSync(process.execPath, [entry, ...options], {
    cwd: work, input, timeout: 30_000, maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: '1' },
  });
  if (result.error) throw result.error;
  writeFileSync(resolve(logs, `${label}.stdout.txt`), result.stdout);
  writeFileSync(resolve(logs, `${label}.stderr.txt`), result.stderr);
  assert.equal(result.status, 0, `${label} failed: ${result.stderr.toString()}`);
  assert.equal(result.stderr.length, 0, `${label} wrote unexpected stderr`);
  const files = Object.fromEntries(session.files.map(name => [name, readFileSync(resolve(work, name))]));
  return { stdout: result.stdout, stderr: result.stderr, files };
}

function equivalent(label, left, right) {
  assert(left.stdout.equals(right.stdout), `${label}: stdout differs byte for byte; rerun with kept logs for diagnosis`);
  assert(left.stderr.equals(right.stderr), `${label}: stderr differs byte for byte`);
  for (const name of Object.keys(left.files)) assert(left.files[name].equals(right.files[name]), `${label}: ${name} differs byte for byte`);
  checks.push({ check: label, stdoutSha256: sha256(right.stdout), stdoutBytes: right.stdout.length,
    savedFiles: Object.fromEntries(Object.entries(right.files).map(([name, bytes]) => [name, sha256(bytes)])) });
}

function expected(label, result) {
  recorded.set(`${label}.txt`, result.stdout);
  if (!record) {
    const path = resolve(expectedDirectory, `${label}.txt`);
    assert(existsSync(path), `missing ${path}; use --update once after reviewing actual behavior`);
    assert(readFileSync(path).equals(result.stdout), `${label}: recorded output changed`);
  }
}

try {
  mkdirSync(checkout);
  mkdirSync(logs);
  const archive = execFileSync('git', ['archive', 'final'], { cwd: root, maxBuffer: 32 * 1024 * 1024 });
  execFileSync('tar', ['-x', '-C', checkout], { input: archive });
  symlinkSync(resolve(root, 'node_modules'), resolve(checkout, 'node_modules'), 'dir');
  build(checkout);
  const baseline = run('final-cli-1', resolve(checkout, 'dist/src/main.js'), [], sessions[0]);
  expected('final-cli-1', baseline);
  if (!baselineOnly) {
    build(root);
    const entry = resolve(root, 'dist/src/main.js');
    const builtinOnly = run('builtin-cli-1', entry, ['--builtin-only'], sessions[0]);
    equivalent('final vs builtin-only / cli-1', baseline, builtinOnly);
    for (const session of sessions) {
      const a = run(`a-${session.name}`, entry, [], session);
      const b = run(`b-${session.name}`, entry, ['--config', resolve(root, 'plugins.config.json')], session);
      equivalent(`A vs B / ${session.name}`, a, b);
      expected(`plugins-${session.name}`, a);
      if (session.name !== 'cli-1') assert(!/^error:/m.test(a.stdout.toString()), `${session.name}: unexpected command error`);
    }
    mkdirSync(resolve(root, 'docs/metrics'), { recursive: true });
    writeFileSync(resolve(root, 'docs/metrics/verification.json'), JSON.stringify({
      baseline: 'final', comparison: 'raw stdout/stderr and saved SVG bytes; no whitespace or line-ending normalization',
      workingDirectory: 'one temporary path reset to the same fixtures before each run; logs are outside it', checks,
    }, null, 2) + '\n');
  }
  if (record) {
    mkdirSync(expectedDirectory, { recursive: true });
    for (const [name, bytes] of recorded) writeFileSync(resolve(expectedDirectory, name), bytes);
  }
  console.log(baselineOnly ? 'Verified final historical baseline.' : `Phase 2 replay passed: ${checks.length} raw-byte comparisons; ${record ? 'captured expected outputs' : 'recorded outputs verified'}.`);
} catch (error) {
  // Preserve only logs outside the controlled cwd, then remove the checkout.
  const failedLogs = resolve(root, 'docs/metrics/failed-replay');
  mkdirSync(failedLogs, { recursive: true });
  for (const label of ['final-cli-1', 'builtin-cli-1', ...sessions.flatMap(session => [`a-${session.name}`, `b-${session.name}`])]) {
    for (const stream of ['stdout', 'stderr']) {
      const name = `${label}.${stream}.txt`;
      if (existsSync(resolve(logs, name))) copyFileSync(resolve(logs, name), resolve(failedLogs, name));
    }
  }
  console.error(`Replay failed; available logs: ${failedLogs}`);
  throw error;
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
