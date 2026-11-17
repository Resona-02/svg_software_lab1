import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import type { CommandProvider, Plugin, PluginContext, PluginManifest } from '../src/api/index.js';
import { ExtensionRegistry } from '../src/application/ExtensionRegistry.js';
import { PluginLoader } from '../src/host/PluginLoader.js';
import { Runtime } from '../src/host/Runtime.js';

class NamedCommand implements CommandProvider {
  readonly syntax: string;
  constructor(readonly name: string, private readonly output = name) { this.syntax = name; }
  create() { return { execute: () => this.output }; }
}

class LoaderFixture {
  readonly registry = new ExtensionRegistry();
  readonly messages: string[] = [];
  readonly loader = new PluginLoader(this.registry, message => this.messages.push(message));
  private constructor(readonly path: string) {}

  static async create(t: TestContext): Promise<LoaderFixture> {
    const fixture = new LoaderFixture(await mkdtemp(join(tmpdir(), 'svg-plugins-')));
    t.after(() => rm(fixture.path, { recursive: true, force: true }));
    return fixture;
  }

  async plugin(directory: string, manifest: PluginManifest, source: string): Promise<string> {
    const path = join(this.path, directory);
    await mkdir(path, { recursive: true });
    await writeFile(join(path, 'package.json'), JSON.stringify({ ...manifest, type: 'module', main: './index.js' }));
    await writeFile(join(path, 'index.js'), source);
    return `./${directory}`;
  }

  async command(directory: string, name: string, body?: string): Promise<string> {
    return this.plugin(directory, { name: directory, contributes: { commands: [name] } }, `
      class Provider {
        name = ${JSON.stringify(name)};
        syntax = this.name;
        constructor(options) { this.options = options; }
        create() { return { execute: () => JSON.stringify(this.options) }; }
      }
      export default new class {
        async activate(ctx, options) {
          ${body ?? 'ctx.registerCommand(new Provider(options));'}
        }
      };
    `);
  }

  async config(plugins: unknown[]): Promise<string> {
    const path = join(this.path, 'plugins.config.json');
    await writeFile(path, JSON.stringify({ plugins }));
    return path;
  }
}

test('registry commits all four categories only after successful manifest verification', async () => {
  const registry = new ExtensionRegistry();
  let continued!: () => void;
  const pause = new Promise<void>(resolve => { continued = resolve; });
  let savedContext!: PluginContext;
  const activation = registry.activate({ async activate(context) {
    savedContext = context;
    context.registerShape({ name: 'custom', create() { throw new Error('unused'); }, read() { throw new Error('unused'); } });
    context.registerCommand(new NamedCommand('probe'));
    context.registerDecorator({ name: 'label', decorate: () => 'label' });
    context.registerAttribute({ name: 'attribute', handles: () => false, apply() { throw new Error('unused'); } });
    await pause;
  } }, { name: 'four', contributes: { shapes: ['custom'], commands: ['probe'], decorators: ['label'], attributes: ['attribute'] } });
  assert.equal(registry.shapes.size + registry.commands.size + registry.decorators.size + registry.attributes.size, 0);
  continued();
  await activation;
  assert.deepEqual([registry.shapes.size, registry.commands.size, registry.decorators.size, registry.attributes.size], [1, 1, 1, 1]);
  assert.throws(() => savedContext.registerCommand(new NamedCommand('late')), /plugin registration is closed/);
  assert.equal(registry.commands.has('late'), false);
});

test('manifest validation compares category/name sets and discards every staged category', async () => {
  const registry = new ExtensionRegistry();
  await registry.activate({ activate(context) {
    context.registerCommand(new NamedCommand('second'));
    context.registerCommand(new NamedCommand('first'));
  } }, { name: 'ordered', contributes: { commands: ['first', 'second'] } });
  assert.deepEqual([...registry.commands.keys()], ['second', 'first']);
  await assert.rejects(registry.activate({ activate(context) {
    context.registerDecorator({ name: 'wrong-category', decorate: () => '*' });
    context.registerCommand(new NamedCommand('extra'));
  } }, { name: 'mismatch', contributes: { commands: ['wrong-category'] } }), /plugin manifest mismatch: mismatch \(declared: .*registered:/);
  assert.equal(registry.decorators.size, 0);
  assert.deepEqual([...registry.commands.keys()], ['second', 'first']);
});

test('duplicates against committed or staged entries reject the whole activation even when caught by plugin', async () => {
  const registry = new ExtensionRegistry();
  await registry.activate({ activate: context => context.registerCommand(new NamedCommand('existing')) },
    { name: 'first', contributes: { commands: ['existing'] } });
  for (const duplicate of ['existing', 'new']) {
    await assert.rejects(registry.activate({ activate(context) {
      context.registerCommand(new NamedCommand('new'));
      try { context.registerCommand(new NamedCommand(duplicate)); } catch { /* Deliberately swallowed by plugin. */ }
    } }, { name: 'duplicate', contributes: { commands: ['new'] } }), new RegExp(`^Error: duplicate registration: commands/${duplicate}$`));
    assert.deepEqual([...registry.commands.keys()], ['existing']);
  }
});

test('throw after partial registration rolls back all categories and closes failed context', async () => {
  const registry = new ExtensionRegistry();
  let context!: PluginContext;
  await assert.rejects(registry.activate({ activate(ctx) {
    context = ctx;
    ctx.registerCommand(new NamedCommand('ghost'));
    ctx.registerDecorator({ name: 'ghost-label', decorate: () => '*' });
    throw new Error('broken\nactivation');
  } }, { name: 'throws' }), /^Error: plugin failed to activate: throws \(broken activation\)$/);
  assert.equal(registry.commands.size + registry.decorators.size, 0);
  assert.throws(() => context.registerCommand(new NamedCommand('late')), /registration is closed/);
});

test('concurrent activations cannot overwrite a registration committed during await', async () => {
  const registry = new ExtensionRegistry();
  let resume!: () => void;
  const pause = new Promise<void>(resolve => { resume = resolve; });
  const manifest = { name: 'slow', contributes: { commands: ['same'] } };
  const slow = registry.activate({ async activate(ctx) { ctx.registerCommand(new NamedCommand('same', 'slow')); await pause; } }, manifest);
  await registry.activate({ activate: ctx => ctx.registerCommand(new NamedCommand('same', 'fast')) }, manifest);
  resume();
  await assert.rejects(slow, /duplicate registration: commands\/same/);
  assert.equal(registry.commands.get('same')?.create(undefined!, undefined!).execute(), 'fast');
});

test('config resolves relative to its directory, preserves order/options and skips disabled modules entirely', async t => {
  const fixture = await LoaderFixture.create(t);
  const first = await fixture.command('first', 'first');
  const second = await fixture.command('nested/second', 'second');
  const config = await fixture.config([
    { module: first, options: { text: '你好', fill: '#123456' } },
    { module: './does-not-exist', enabled: false },
    { module: second, options: [1, false] },
  ]);
  await fixture.loader.loadConfig(config);
  assert.deepEqual(fixture.messages, []);
  assert.deepEqual([...fixture.registry.commands.keys()], ['first', 'second']);
  assert.equal(fixture.registry.commands.get('first')?.create(undefined!, undefined!).execute(), '{"text":"你好","fill":"#123456"}');
  assert.equal(fixture.registry.commands.get('second')?.create(undefined!, undefined!).execute(), '[1,false]');
});

test('bare package modules use Node resolution anchored at the config directory', async t => {
  const fixture = await LoaderFixture.create(t);
  await fixture.command('node_modules/@test/plugin', 'package-command');
  await fixture.loader.loadConfig(await fixture.config([{ module: '@test/plugin' }]));
  assert.deepEqual(fixture.messages, []);
  assert.equal(fixture.registry.commands.has('package-command'), true);
});

test('bare packages follow ESM import-only exports and prefer import over require conditions', async t => {
  const fixture = await LoaderFixture.create(t);
  for (const name of ['import-only', 'dual-mode']) {
    await fixture.command(`node_modules/@test/${name}`, name);
    const path = join(fixture.path, `node_modules/@test/${name}/package.json`);
    const manifest = JSON.parse(await readFile(path, 'utf8'));
    delete manifest.main;
    manifest.exports = name === 'import-only'
      ? { import: './index.js' }
      : { import: './index.js', require: './must-not-load.cjs' };
    await writeFile(path, JSON.stringify(manifest));
  }
  await fixture.loader.loadConfig(await fixture.config([
    { module: '@test/import-only', options: 'import-only-options' },
    { module: '@test/dual-mode', options: 'import-condition-options' },
  ]));
  assert.deepEqual(fixture.messages, []);
  assert.deepEqual([...fixture.registry.commands.keys()], ['import-only', 'dual-mode']);
  assert.equal(fixture.registry.commands.get('import-only')?.create(undefined!, undefined!).execute(), '"import-only-options"');
  assert.equal(fixture.registry.commands.get('dual-mode')?.create(undefined!, undefined!).execute(), '"import-condition-options"');
});

test('missing bare modules and missing relative files stay distinct from transitive import failures', async t => {
  const fixture = await LoaderFixture.create(t);
  await fixture.command('valid', 'valid');
  await fixture.plugin('broken', { name: 'broken-file' }, 'import "./missing-dependency.js"; export default { activate() {} };');
  await fixture.loader.loadConfig(await fixture.config([
    { module: '@test/no-such-package' },
    { module: './missing-file.js' },
    { module: './broken/index.js' },
    { module: './valid/index.js' },
  ]));
  assert.equal(fixture.messages[0], 'error: plugin not found: @test/no-such-package');
  assert.equal(fixture.messages[1], 'error: plugin not found: ./missing-file.js');
  assert.match(fixture.messages[2], /^error: plugin failed to activate: broken-file \(/);
  assert.equal(fixture.messages.length, 3);
  assert.equal(fixture.registry.commands.has('valid'), true);
});

test('all four load failure paths, duplicates and later recovery leave earlier plugins intact', async t => {
  const fixture = await LoaderFixture.create(t);
  const good = await fixture.command('good', 'retained');
  const noDefault = await fixture.plugin('no-default', { name: 'no-default' }, 'export const other = 1;');
  const mismatch = await fixture.plugin('mismatch', { name: 'mismatch', contributes: { commands: ['declared'] } }, `
    export default { activate(ctx) { ctx.registerCommand({ name: 'ghost', syntax: 'ghost', create() {} }); } };
  `);
  const throws = await fixture.command('throws', 'ghost-throw', 'ctx.registerCommand(new Provider(options)); throw new Error("boom");');
  const duplicate = await fixture.command('duplicate', 'retained');
  const later = await fixture.command('later', 'last');
  await fixture.loader.loadConfig(await fixture.config([
    { module: good }, { module: './missing' }, { module: noDefault }, { module: mismatch },
    { module: throws }, { module: duplicate }, { module: later },
  ]));
  assert.equal(fixture.messages.length, 5);
  assert.equal(fixture.messages[0], 'error: plugin not found: ./missing');
  assert.equal(fixture.messages[1], 'error: plugin has no default export: ./no-default');
  assert.match(fixture.messages[2], /^error: plugin manifest mismatch: mismatch \(declared: .*registered:/);
  assert.equal(fixture.messages[3], 'error: plugin failed to activate: throws (boom)');
  assert.equal(fixture.messages[4], 'error: duplicate registration: commands/retained');
  assert.deepEqual([...fixture.registry.commands.keys()], ['retained', 'last']);
});

test('module evaluation or missing internal dependency is not mistaken for a missing top-level plugin', async t => {
  const fixture = await LoaderFixture.create(t);
  const dependency = await fixture.plugin('dependency', { name: 'dependency' }, 'import "./missing.js"; export default { activate() {} };');
  const evaluation = await fixture.plugin('evaluation', { name: 'evaluation' }, 'throw new Error("evaluation failure"); export default { activate() {} };');
  await fixture.loader.loadConfig(await fixture.config([{ module: dependency }, { module: evaluation }]));
  assert.match(fixture.messages[0], /^error: plugin failed to activate: dependency \(/);
  assert.equal(fixture.messages[1], 'error: plugin failed to activate: evaluation (evaluation failure)');
  assert.ok(fixture.messages.every(message => !message.includes('plugin not found:')));
});

test('invalid config is validated before activation and Runtime retains builtin capabilities', async t => {
  const fixture = await LoaderFixture.create(t);
  const good = await fixture.command('good', 'must-not-load');
  for (const content of ['{', 'null', '[]', '{}', '{"plugins": {}}', JSON.stringify({ plugins: [{ module: good }, { module: 'x', enabled: 'false' }] })]) {
    const path = join(fixture.path, 'bad.json');
    await writeFile(path, content);
    const runtime = await Runtime.create();
    await runtime.loadConfig(path);
    assert.deepEqual(runtime.diagnostics, ['error: invalid plugin config']);
    assert.equal(runtime.registry.commands.has('must-not-load'), false);
    assert.equal(runtime.registry.shapes.size, 6);
    assert.equal(await runtime.dispatcher.execute('init 10 20'), 'canvas 10x20 created');
  }
});

test('code and config activation share manifest checks, rollback, and options behavior', async t => {
  const fixture = await LoaderFixture.create(t);
  const good = await fixture.command('good', 'probe');
  const manifest = JSON.parse(await readFile(join(fixture.path, 'good/package.json'), 'utf8')) as PluginManifest;
  const plugin = (await import(pathToFileURL(join(fixture.path, 'good/index.js')).href)).default as Plugin;
  const codeRegistry = new ExtensionRegistry();
  const codeMessages: string[] = [];
  const codeLoader = new PluginLoader(codeRegistry, message => codeMessages.push(message));
  await codeLoader.loadCode([{ plugin, manifest, options: { equal: true } }]);
  await fixture.loader.loadConfig(await fixture.config([{ module: good, options: { equal: true } }]));
  assert.equal(codeRegistry.commands.get('probe')?.create(undefined!, undefined!).execute(), fixture.registry.commands.get('probe')?.create(undefined!, undefined!).execute());
  await codeLoader.loadCode([{ plugin, manifest }]);
  await fixture.loader.loadConfig(await fixture.config([{ module: good }]));
  assert.deepEqual(codeMessages, fixture.messages);
  assert.equal(codeMessages[0], 'error: duplicate registration: commands/probe');
});

test('CLI continues with builtin commands after missing config and unknown startup arguments', () => {
  for (const args of [['--config', '/this-file-does-not-exist/plugins.json'], ['--unknown']]) {
    const result = spawnSync(process.execPath, ['dist/src/main.js', ...args], {
      input: 'init 10 20\ncreate circle c 1 2 3\ntree\n', encoding: 'utf8', timeout: 10000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.match(result.stdout, /^error:/);
    assert.match(result.stdout, /circle#c cx=1 cy=2 r=3/);
  }
});
