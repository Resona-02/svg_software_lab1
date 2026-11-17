import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  Circle, CommandArguments, CommandExecutor, EditCommand, Group, Rect, SvgDocument, Text,
  type CommandProvider, type EditorSession, type PluginContext,
} from '../src/api/index.js';
import statsPlugin, { manifest as statsManifest } from '../plugins/command-stats/index.js';
import { StatsCommand } from '../plugins/command-stats/StatsCommand.js';
import { StatsProvider } from '../plugins/command-stats/StatsProvider.js';
import { StatsReceiver } from '../plugins/command-stats/StatsReceiver.js';
import dirPlugin, { manifest as dirManifest } from '../plugins/command-dir/index.js';
import { DirCommand } from '../plugins/command-dir/DirCommand.js';
import { DirProvider } from '../plugins/command-dir/DirProvider.js';
import { DirectoryReceiver } from '../plugins/command-dir/DirectoryReceiver.js';
import type { DirectoryEntry, DirectoryReader } from '../plugins/command-dir/DirectoryReader.js';
import { NodeDirectoryAdapter } from '../plugins/command-dir/NodeDirectoryAdapter.js';

class FakeDirectoryReader implements DirectoryReader {
  readonly paths: string[] = [];
  failure?: Error;

  constructor(readonly entries: readonly DirectoryEntry[] = []) {}

  async list(path: string): Promise<readonly DirectoryEntry[]> {
    this.paths.push(path);
    if (this.failure) throw this.failure;
    return this.entries;
  }
}

function commandArguments(name: string, values: string[] = []): CommandArguments {
  return new CommandArguments(values.map(value => ({ value, quoted: false })), name);
}

// Any access fails, including document/history: dir has no session prerequisite.
function inaccessibleSession(): EditorSession {
  return new Proxy({} as EditorSession, {
    get(_target, property) { throw new Error(`unexpected session access: ${String(property)}`); },
  });
}

test('stats excludes the implicit root and prints the exact empty-document result', () => {
  const document = new SvgDocument();
  const command = new StatsCommand(new StatsReceiver({ document }));
  assert.equal(command.execute(), '(total 0, containers 0)');
  assert.equal(command instanceof EditCommand, false);
  document.add(new Group('empty'));
  assert.equal(command.execute(), '(total 0, containers 1)');
});

test('stats counts container descendants in DFS first-appearance order without changing the tree', () => {
  class CompositeFixture extends Group {
    override get tag(): string { return 'custom-composite'; }
  }
  const document = new SvgDocument();
  const group = new Group('outer');
  group.insert(new Text('first', 1, 2, 'first type'));
  const composite = new CompositeFixture('composite');
  composite.insert(new Rect('frame', 0, 0, 10, 10));
  composite.insert(new Text('label', 1, 2, 'second text'));
  group.insert(composite);
  group.insert(new Circle('circle', 0, 0, 2));
  document.add(group);
  document.add(new Rect('last', 0, 0, 1, 1));
  const before = document.allShapes().map(shape => ({
    shape, parent: shape.parent, attributes: shape.attributes(), children: shape.children,
  }));
  const command = new StatsCommand(new StatsReceiver({ document }));
  assert.equal(command.execute(), 'text: 2  rect: 2  circle: 1  (total 5, containers 2)');
  assert.deepEqual(document.allShapes().map(shape => ({
    shape, parent: shape.parent, attributes: shape.attributes(), children: shape.children,
  })), before);
  document.back('last');
  assert.equal(command.execute(), 'rect: 2  text: 2  circle: 1  (total 5, containers 2)');
});

test('stats provider validates arguments and reads the active document at execution time', () => {
  const provider = new StatsProvider();
  let current = new SvgDocument();
  const session = { get document() { return current; } } as EditorSession;
  const command = provider.create(commandArguments('stats'), session);
  current = new SvgDocument();
  current.add(new Circle('new', 0, 0, 1));
  assert.equal(command.execute(), 'circle: 1  (total 1, containers 0)');
  assert.throws(() => provider.create(commandArguments('stats', ['extra']), session), /^Error: usage: stats$/);
  assert.throws(() => provider.create(commandArguments('stats'), inaccessibleSession()).execute(),
    /unexpected session access: document/);
});

test('dir sorts each kind by name, includes hidden entries, and filters dot entries without mutating input', async () => {
  const entries: readonly DirectoryEntry[] = Object.freeze([
    { name: 'z.txt', kind: 'file' }, { name: 'b', kind: 'directory' },
    { name: '..', kind: 'directory' }, { name: '.hidden', kind: 'file' },
    { name: 'A.txt', kind: 'file' }, { name: '.cache', kind: 'directory' },
    { name: 'a', kind: 'directory' }, { name: 'a.txt', kind: 'file' },
    { name: '.', kind: 'directory' },
  ]);
  const before = [...entries];
  const reader = new FakeDirectoryReader(entries);
  const receiver = new DirectoryReceiver(reader, () => '/fixture');
  const expected = '[DIR]  .cache\n[DIR]  a\n[DIR]  b\n[FILE]  .hidden\n[FILE]  A.txt\n[FILE]  a.txt\n[FILE]  z.txt';
  assert.equal(await receiver.list(), expected);
  assert.equal(await receiver.list(), expected);
  assert.equal(await new DirectoryReceiver(new FakeDirectoryReader([...entries].reverse()), () => '/fixture').list(), expected);
  assert.deepEqual(reader.paths, ['/fixture', '/fixture']);
  assert.deepEqual(entries, before);
});

test('dir documents deterministic LINK and OTHER groups after ordinary files', async () => {
  const receiver = new DirectoryReceiver(new FakeDirectoryReader([
    { name: 'z-pipe', kind: 'other' }, { name: 'z-link', kind: 'link' },
    { name: 'a-pipe', kind: 'other' }, { name: 'file', kind: 'file' },
    { name: 'a-link', kind: 'link' }, { name: 'directory', kind: 'directory' },
  ]), () => '/fixture');
  assert.equal(await receiver.list(), '[DIR]  directory\n[FILE]  file\n[LINK]  a-link\n[LINK]  z-link\n[OTHER]  a-pipe\n[OTHER]  z-pipe');
});

test('dir handles empty input and a list containing only dot entries', async () => {
  for (const entries of [[], [{ name: '.', kind: 'directory' }, { name: '..', kind: 'directory' }]] as const) {
    const receiver = new DirectoryReceiver(new FakeDirectoryReader(entries), () => '/empty');
    assert.equal(await receiver.list(), '(empty directory)');
  }
});

test('dir normalizes filesystem failures and permits the executor to run the next command', async () => {
  const reader = new FakeDirectoryReader([{ name: 'ok.txt', kind: 'file' }]);
  reader.failure = new Error('EACCES: implementation-specific message');
  const command = new DirCommand(new DirectoryReceiver(reader, () => '/unreadable path'));
  const executor = new CommandExecutor();
  await assert.rejects(async () => executor.executeCommand(command), /^Error: cannot read directory: \/unreadable path$/);
  reader.failure = undefined;
  assert.equal(await executor.executeCommand(command), '[FILE]  ok.txt');
  assert.equal(command instanceof EditCommand, false);
});

test('dir provider validates arguments without accessing the document or session', async () => {
  const reader = new FakeDirectoryReader();
  const provider = new DirProvider(reader);
  const session = inaccessibleSession();
  assert.throws(() => provider.create(commandArguments('dir', ['path']), session), /^Error: usage: dir$/);
  assert.equal(await provider.create(commandArguments('dir'), session).execute(), '(empty directory)');
  assert.deepEqual(reader.paths, [process.cwd()]);
});

test('dir resolves the process working directory on every execution and does not change it', async () => {
  const original = process.cwd();
  const temporary = await mkdtemp(join(tmpdir(), 'svg-dir-cwd-'));
  try {
    const reader = new FakeDirectoryReader();
    const command = new DirProvider(reader).create(commandArguments('dir'), inaccessibleSession());
    await command.execute();
    assert.equal(process.cwd(), original);
    process.chdir(temporary);
    const changed = process.cwd();
    await command.execute();
    assert.equal(process.cwd(), changed);
    assert.deepEqual(reader.paths, [original, changed]);
  } finally {
    process.chdir(original);
    await rm(temporary, { recursive: true, force: true });
  }
});

test('dir command and Node adapter list real direct children including hidden files and symlinks', async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'svg-dir-adapter-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  await Promise.all([
    mkdir(join(temporary, 'z-directory')),
    mkdir(join(temporary, '.hidden-directory')),
    writeFile(join(temporary, 'z.svg'), '<svg/>'),
    writeFile(join(temporary, '.hidden-file'), ''),
    writeFile(join(temporary, 'a.txt'), ''),
  ]);
  await writeFile(join(temporary, 'z-directory', 'nested-file'), 'not a direct child');
  await symlink(join(temporary, 'z-directory'), join(temporary, 'directory-link'));
  await symlink(join(temporary, 'missing-target'), join(temporary, 'broken-link'));
  const command = new DirCommand(new DirectoryReceiver(new NodeDirectoryAdapter(), () => temporary));
  assert.equal(await command.execute(), '[DIR]  .hidden-directory\n[DIR]  z-directory\n[FILE]  .hidden-file\n[FILE]  a.txt\n[FILE]  z.svg\n[LINK]  broken-link\n[LINK]  directory-link');
});

test('real Node adapter handles an empty directory and a missing directory', async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'svg-dir-empty-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const reader = new NodeDirectoryAdapter();
  assert.equal(await new DirectoryReceiver(reader, () => temporary).list(), '(empty directory)');
  const missing = join(temporary, 'missing');
  await assert.rejects(new DirectoryReceiver(reader, () => missing).list(), {
    message: `cannot read directory: ${missing}`,
  });
});

test('stats and dir packages independently register class-based command providers matching their manifests', async () => {
  for (const [directory, plugin, manifest, Provider] of [
    ['command-stats', statsPlugin, statsManifest, StatsProvider],
    ['command-dir', dirPlugin, dirManifest, DirProvider],
  ] as const) {
    const registered: CommandProvider[] = [];
    const context: PluginContext = {
      registerCommand(provider) { registered.push(provider); },
      registerShape() { assert.fail('unexpected shape registration'); },
      registerDecorator() { assert.fail('unexpected decorator registration'); },
      registerAttribute() { assert.fail('unexpected attribute registration'); },
    };
    await plugin.activate(context);
    assert.equal(registered.length, 1);
    assert.ok(registered[0] instanceof Provider);
    assert.deepEqual(registered.map(provider => provider.name), manifest.contributes?.commands);
    assert.equal(registered[0]!.syntax, registered[0]!.name);
    const packageJson = JSON.parse(await readFile(join(process.cwd(), 'plugins', directory, 'package.json'), 'utf8'));
    assert.equal(packageJson.name, manifest.name);
    assert.deepEqual(packageJson.contributes, manifest.contributes);
    assert.equal(packageJson.main, `../../dist/plugins/${directory}/index.js`);
  }
});
