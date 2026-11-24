import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, symlink, rm, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Context } from '@deepseek-ai/cordis';
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local';
import { SessionStore } from '@deepseek-ai/dsh-session';
import { SessionId } from '@deepseek-ai/dsh-session/types';
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import { TypertRegistry } from '@deepseek-ai/dsh-typert-registry';
import { TypertGatewayService } from '@deepseek-ai/dsh-api-gateway';
import * as atlasPlugin from '../lib/index.js';
import { TYPERT, TYPERT_REMOTE } from '../lib/typert.host.js';

const { DshCodeSource } = atlasPlugin;
const signal = () => new AbortController().signal;
async function workspace(t, entries = {}) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'dsh-code-atlas-host-')));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = join(base, 'project'); await mkdir(root);
  for (const [file, content] of Object.entries(entries)) {
    await mkdir(join(root, file, '..'), { recursive: true });
    await writeFile(join(root, file), content);
  }
  return { base, root };
}
async function filesystem(t) {
  const ctx = new Context();
  const fiber = await ctx.plugin(LocalFileSystem, {});
  t.after(() => fiber.dispose());
  return ctx.fs;
}
async function nativeHost(t, root) {
  const ctx = new Context();
  const owner = await ctx.plugin({ name: 'atlas-native-test-host', async apply(ctx) {
    await ctx.plugin(TypertRegistry);
    await ctx.plugin(LocalFileSystem, {});
    await ctx.plugin(SessionStore);
    await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false });
    await ctx.plugin(ToolRuntime, { mode: 'native' });
    await ctx.plugin(TypertGatewayService, {});
  } });
  t.after(() => owner.dispose());
  const host = ctx;
  const one = host.sessions.create(SessionId('atlas-one'), { meta: { cwd: root } });
  const two = host.sessions.create(SessionId('atlas-two'), { meta: { cwd: root } });
  host.sessions.create(SessionId('without-workspace'));
  const contribution = await host.plugin({ name: 'atlas-test-manifest', inject: ['typert'], apply(ctx) { ctx.typert.register(TYPERT); } });
  const plugin = await host.plugin(atlasPlugin);
  const invoke = async (method, args = {}, callerSignal) => {
    const value = await host.typertGateway.invoke({ namespace: 'codeAtlas', method, args, signal: callerSignal });
    // The consumer validates unary results with this exact shared companion.
    const descriptor = TYPERT_REMOTE.descriptors.find(item => item.method === method);
    descriptor.result.create().parse(value);
    return value;
  };
  let call = 0;
  const execute = (name, args, session = one, callerSignal = signal()) => host.tools.execute({
    name, arguments: args, callId: `atlas-call-${++call}`, signal: callerSignal,
    // Agent is a public structural execution handle. The native pipeline gets a
    // real session and Context; no model or network request is needed.
    agent: { id: session.id, session, ctx: host },
  });
  return { host, one, two, plugin, contribution, invoke, execute };
}

test('native filesystem snapshot respects ignores, local config inheritance, and symlink containment', async t => {
  const { base, root } = await workspace(t, {
    '.gitignore': 'ignored.ts\ngenerated/\n',
    'a.ts': 'export class A {}', 'lib/real-source.ts': 'export interface Real {}',
    'src/a.mts': 'export const a = 1;', 'src/b.cts': 'export const b = 1;',
    'src/c.mjs': 'export const c = 1;', 'src/d.cjs': 'exports.d = 1;',
    'src/e.tsx': 'export const e = <div/>;', 'src/f.jsx': 'export const f = <div/>;',
    'src/g.js': 'export const g = 1;',
    'ignored.ts': 'never read', 'generated/skip.ts': 'never read',
    'nested/.gitignore': 'private.ts\n', 'nested/private.ts': 'never read',
    'nested/public.ts': 'export const yes = 1;',
    'node_modules/dependency/index.ts': 'never read', 'dist/index.ts': 'never read',
    'tsconfig.json': '{ // JSONC comments\n "extends": "./configs/base", "compilerOptions": {}, }',
    'configs/base.json': '{ "extends": "./deep/settings.json", "url": "https://example.test/", }',
    'configs/deep/settings.json': '{ "compilerOptions": { "baseUrl": "../.." } }',
    'package.json': '{"name":"fixture"}', 'data.json': '{"not":"config"}',
  });
  const outside = join(base, 'outside'); await mkdir(outside); await writeFile(join(outside, 'secret.ts'), 'private outside source');
  await symlink(outside, join(root, 'outside-link'));
  await symlink(join(outside, 'secret.ts'), join(root, 'outside.ts'));
  await symlink(join(root, 'node_modules'), join(root, 'dependency-alias'));
  const source = new DshCodeSource(await filesystem(t));
  const snapshot = await source.snapshot(root);
  const paths = snapshot.files.map(file => file.path).sort();
  assert.deepEqual(paths, ['a.ts', 'configs/base.json', 'configs/deep/settings.json', 'lib/real-source.ts',
    'nested/public.ts', 'package.json', 'src/a.mts', 'src/b.cts', 'src/c.mjs', 'src/d.cjs', 'src/e.tsx',
    'src/f.jsx', 'src/g.js', 'tsconfig.json'].sort());
  assert(snapshot.files.every(file => /^[a-f0-9]{64}$/.test(file.hash)));
  await assert.rejects(source.read(root, '../outside/secret.ts'), /SOURCE_OUTSIDE_WORKSPACE/);
  await assert.rejects(source.read(root, join(outside, 'secret.ts')), /SOURCE_OUTSIDE_WORKSPACE/);
  await assert.rejects(source.read(root, 'outside-link/secret.ts'), /SOURCE_OUTSIDE_WORKSPACE/);
  assert.equal((await source.read(root, 'lib/real-source.ts')).content, 'export interface Real {}');
});

test('source limits fail clearly without returning partial snapshots, and cancellation stops reads', async t => {
  const { root } = await workspace(t, { 'a.ts': '12345', 'b.ts': '67890' });
  const fs = await filesystem(t);
  const limits = { files: 1, fileBytes: 100, totalBytes: 100, directories: 100 };
  await assert.rejects(new DshCodeSource(fs, limits).snapshot(root), /INPUT_LIMIT.*1 files/);
  await assert.rejects(new DshCodeSource(fs, { ...limits, files: 100, fileBytes: 4 }).snapshot(root), /INPUT_LIMIT.*a.ts/);
  await assert.rejects(new DshCodeSource(fs, { ...limits, files: 100, totalBytes: 9 }).snapshot(root), /INPUT_LIMIT.*9 bytes/);
  const aborted = new AbortController(); aborted.abort(new Error('stop source'));
  await assert.rejects(new DshCodeSource(fs).snapshot(root, aborted.signal), /stop source/);
  await writeFile(join(root, 'binary.ts'), Buffer.from([0, 1, 2]));
  await assert.rejects(new DshCodeSource(fs).snapshot(root), /SOURCE_NOT_TEXT.*binary.ts/);
});

test('real rc.1 Gateway accepts the manifest, exact wire shapes, existing sessions and state isolation', async t => {
  const { root } = await workspace(t, {
    'a.ts': 'export interface A { run(): void }\n',
    'b.ts': 'import type { A } from "./a.js";\nexport class B implements A { run() {} }\n',
  });
  const { host, one, two, invoke } = await nativeHost(t, root);
  assert.equal(host.codeAtlas.typertRemote.namespace, 'codeAtlas');
  assert.equal(TYPERT_REMOTE.descriptors.length, 10);
  assert.equal(host.typert.local.list().filter(item => item.namespace === 'codeAtlas').length, 10);
  const sessions = await invoke('sessions');
  assert.deepEqual(sessions.map(session => session.id), ['atlas-one', 'atlas-two']);
  assert(sessions.every(session => session.cwd === root && session.title));
  await assert.rejects(invoke('scan', { sessionId: 'missing' }), error => error.code === 'session/not-found');
  await assert.rejects(invoke('scan', { sessionId: 'without-workspace' }), error => error.code === 'gateway/bad-request');
  await assert.rejects(invoke('scan', { sessionId: one.id, root: '/arbitrary' }), error => error.code === 'gateway/arguments-invalid');
  const initial = await invoke('scan', { sessionId: one.id });
  await invoke('scan', { sessionId: two.id });
  const node = initial.snapshot.nodes.find(node => node.name === 'B' && node.kind === 'class'); assert(node);
  const inspected = await invoke('inspect', { sessionId: one.id, nodeId: node.id });
  assert.equal(inspected.source.node.file, 'b.ts'); assert.match(inspected.source.content, /class B implements A/);
  const route = await invoke('route', { sessionId: one.id, direction: 'dependencies', depth: 2 });
  assert(route.graph.nodeIds.includes(node.id));
  await assert.rejects(invoke('route', { sessionId: one.id, direction: 'dependencies', depth: 3 }), error => error.code === 'gateway/input-invalid');
  const marked = await invoke('markRead', { sessionId: one.id, nodeId: node.id, read: true });
  assert(marked.readIds.includes(node.id));
  assert.deepEqual((await invoke('view', { sessionId: two.id })).readIds, []);
  const unlabeled = await invoke('setPublicApiLabel', { sessionId: one.id, enabled: false });
  assert.doesNotMatch(unlabeled.labels[node.id], /公开 API/);
  const exported = await invoke('exportSVG', { sessionId: one.id });
  assert.equal(exported.filename, 'code-atlas.svg'); assert.match(exported.svg, /<svg/);
  assert.equal(await invoke('close', { sessionId: one.id }), null);
  await assert.rejects(invoke('view', { sessionId: one.id }), error => error.code === 'SCAN_REQUIRED');
  assert.equal((await invoke('view', { sessionId: two.id })).snapshot.id, initial.snapshot.id);
  const ephemeral = await host.plugin({ inject: ['sessions'], apply(ctx) {
    ctx.sessions.create(SessionId('atlas-ephemeral'), { meta: { cwd: root } });
  } });
  await invoke('scan', { sessionId: 'atlas-ephemeral' });
  await ephemeral.dispose();
  assert.throws(() => host.codeAtlas.workbench.view('atlas-ephemeral'), error => error.code === 'SCAN_REQUIRED');
  await assert.rejects(invoke('view', { sessionId: 'atlas-ephemeral' }), error => error.code === 'session/not-found');
});

test('real native tool execution validates schemas, shares panel state, refuses forged roots, and unloads cleanly', async t => {
  const { root } = await workspace(t, { 'index.ts': 'export function hello() { return "hi"; }\n' });
  const { host, one, two, plugin, execute, invoke } = await nativeHost(t, root);
  let publications = 0;
  const unsubscribe = host.codeAtlas.workbench.subscribe(one.id, () => publications++);
  assert.equal(host.tools.schemas().filter(tool => tool.name.startsWith('code_atlas_')).length, 5);
  const scan = await execute('code_atlas_scan', { root: '/arbitrary-root-ignored-by-tool' });
  assert.equal(scan.isError, false); assert(scan.value.snapshotId);
  assert.equal((await invoke('view', { sessionId: one.id })).snapshot.root, root);
  const view = await invoke('view', { sessionId: one.id });
  const node = view.snapshot.nodes.find(node => node.name === 'hello'); assert(node);
  const inspect = await execute('code_atlas_inspect', { nodeId: node.id });
  assert.equal(inspect.isError, false); assert.match(inspect.value.source, /function hello/);
  assert.match(inspect.content.map(item => item.text ?? '').join('\n'), /index.ts:1/);
  const marked = await execute('code_atlas_mark_read', { nodeId: node.id, read: true });
  assert.equal(marked.isError, false);
  assert((await invoke('view', { sessionId: one.id })).readIds.includes(node.id));
  const invalid = await execute('code_atlas_route', { direction: 'dependencies', depth: 99 });
  assert.equal(invalid.isError, true); assert.equal(invalid.error.info.code, 'INVALID_ARGS');
  const other = await execute('code_atlas_export', {}, two);
  assert.equal(other.isError, true); assert.match(other.error.message, /Scan/);
  const exported = await execute('code_atlas_export', {});
  assert.equal(exported.isError, false); assert.match(exported.value.svg, /<svg/);
  assert(publications >= 3);
  unsubscribe();
  await writeFile(join(root, 'index.ts'), 'export function hello() { return "changed"; }\n');
  const stale = await execute('code_atlas_inspect', { nodeId: node.id });
  assert.equal(stale.isError, true); assert.match(stale.error.message, /Source has changed/);
  assert.equal((await execute('code_atlas_scan', {})).isError, false);
  assert.deepEqual((await invoke('view', { sessionId: one.id })).readIds, []);
  const aborted = new AbortController(); aborted.abort();
  const cancelled = await execute('code_atlas_scan', {}, one, aborted.signal);
  assert.equal(cancelled.isError, true); assert.equal(cancelled.error.info.code, 'ABORTED_BEFORE_DISPATCH');
  const old = host.codeAtlas.workbench;
  await plugin.dispose();
  assert.equal(host.tools.schemas().filter(tool => tool.name.startsWith('code_atlas_')).length, 0);
  assert.throws(() => old.view(one.id), error => error.code === 'PLUGIN_CLOSED');
  await assert.rejects(invoke('view', { sessionId: one.id }), error => error.code === 'gateway/service-unavailable');
});

test('native Typert watch streams tool publications with bounded latest-state delivery and cancellation', async t => {
  const { root } = await workspace(t, { 'index.ts': 'export function watched() { return 1; }\n' });
  const { host, one, plugin, execute, invoke } = await nativeHost(t, root);
  const abort = new AbortController();
  const stream = await host.typertGateway.stream({ namespace: 'codeAtlas', method: 'watch', args: { sessionId: one.id }, signal: abort.signal });
  const iterator = stream[Symbol.asyncIterator]();
  const waiting = iterator.next();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await execute('code_atlas_scan', {})).isError, false);
  const first = (await waiting).value;
  const codec = TYPERT_REMOTE.descriptors.find(item => item.method === 'watch').result.create();
  codec.parse(first); assert.equal(first.publicApiLabel, true);
  const node = first.snapshot.nodes.find(node => node.name === 'watched'); assert(node);
  await execute('code_atlas_mark_read', { nodeId: node.id, read: true });
  await invoke('setPublicApiLabel', { sessionId: one.id, enabled: false });
  await invoke('route', { sessionId: one.id, direction: 'users', depth: 2 });
  // No unbounded backlog: the next item reflects every intervening change.
  const latest = (await iterator.next()).value;
  codec.parse(latest); assert.equal(latest.direction, 'users'); assert.equal(latest.publicApiLabel, false);
  assert(latest.readIds.includes(node.id));
  const cancelled = iterator.next(); abort.abort(new Error('cancel watch'));
  await assert.rejects(cancelled, /Remote invocation .* was aborted/);

  const secondAbort = new AbortController();
  const second = (await host.typertGateway.stream({ namespace: 'codeAtlas', method: 'watch', args: { sessionId: one.id }, signal: secondAbort.signal }))[Symbol.asyncIterator]();
  assert.equal((await second.next()).value.selectedId, latest.selectedId);
  const closing = second.next();
  await invoke('close', { sessionId: one.id });
  await assert.rejects(closing, /reading session was closed/);

  const finalAbort = new AbortController();
  const final = (await host.typertGateway.stream({ namespace: 'codeAtlas', method: 'watch', args: { sessionId: one.id }, signal: finalAbort.signal }))[Symbol.asyncIterator]();
  const unloading = final.next();
  await new Promise(resolve => setImmediate(resolve));
  await plugin.dispose();
  await assert.rejects(unloading, /plugin has been unloaded/);
});
