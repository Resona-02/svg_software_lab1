import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { TypeScriptLanguageProvider } from '../lib/analysis.js';

const hash = content => createHash('sha256').update(content).digest('hex');
const snapshot = (files, root = '/atlas-fixture') => ({ root,
  files: Object.entries(files).map(([path, content]) => ({ path, content, hash: hash(content) })),
});
const analyze = files => new TypeScriptLanguageProvider().analyze(snapshot(files));
const named = (result, name, kind) => result.nodes.find(node => node.name === name && (!kind || node.kind === kind));
const targetNode = (result, relation) => result.nodes.find(node => node.id === relation.to);

test('file and nested namespace/class/interface/function/method facts have explicit parents', async () => {
  const result = await analyze({ 'model.ts': `
export namespace Drawing {
  export interface Handler { apply(value: string): void; }
  export class Canvas implements Handler {
    constructor() {}
    apply(value: string): void { function nested() {} }
    refresh = () => {};
  }
}
export const make = () => new Drawing.Canvas();
function local() {}
export { local as publicLocal };
` });
  assert.deepEqual(result.diagnostics, []);
  const file = named(result, 'model.ts', 'file');
  const namespace = named(result, 'Drawing', 'namespace');
  const canvas = named(result, 'Canvas', 'class');
  const handler = named(result, 'Handler', 'interface');
  assert.equal(file.id, 'file:model.ts');
  assert.equal(namespace.parentId, file.id);
  assert.equal(canvas.parentId, namespace.id);
  assert.equal(handler.parentId, namespace.id);
  assert.equal(named(result, 'refresh', 'method').parentId, canvas.id);
  assert.equal(named(result, 'constructor', 'method').parentId, canvas.id);
  const apply = result.nodes.find(node => node.name === 'apply' && node.parentId === canvas.id);
  assert.equal(named(result, 'nested').parentId, apply.id);
  assert.equal(named(result, 'make', 'function').exported, true);
  assert.equal(named(result, 'local', 'function').exported, true);
  assert.equal(canvas.exported, true);
  assert.equal(targetNode(result, result.relations.find(edge => edge.kind === 'implements')).id, handler.id);
  assert.doesNotThrow(() => structuredClone(result));
});

test('imports, reexports, renamed type imports and .js-to-.ts resolution use compiler symbols', async () => {
  const result = await analyze({
    'contracts.ts': 'export interface Handler { apply(value: string): void; }',
    'base.ts': 'export class Base {}',
    'barrel.ts': "export { Handler as PublicHandler } from './contracts.js';",
    'box.ts': "import type { PublicHandler as H } from './barrel.js'; import { Base as Parent } from './base.js'; export class Box extends Parent implements H { apply(value: string): void {} }",
  });
  assert.deepEqual(result.diagnostics, []);
  const box = named(result, 'Box', 'class');
  const dependencies = result.relations.filter(edge => edge.from === 'file:box.ts');
  assert.deepEqual(dependencies.map(edge => edge.to), ['file:barrel.ts', 'file:base.ts']);
  const reexport = result.relations.find(edge => edge.kind === 'reexports');
  assert.equal(reexport.to, 'file:contracts.ts');
  const implemented = result.relations.find(edge => edge.kind === 'implements');
  assert.equal(implemented.from, box.id);
  assert.equal(implemented.targetName, 'H');
  assert.equal(targetNode(result, implemented).name, 'Handler');
  const extended = result.relations.find(edge => edge.kind === 'extends');
  assert.equal(extended.targetName, 'Parent');
  assert.equal(targetNode(result, extended).name, 'Base');
  for (const edge of result.relations) assert.equal(edge.resolved, true);
});

test('root-local tsconfig extends and paths mappings resolve without exposing config as code nodes', async () => {
  const result = await analyze({
    'tsconfig.json': '// root config\n{ "extends": "./tsconfig.base.json" }',
    'tsconfig.base.json': '{ "compilerOptions": { "paths": { "@app/*": ["./src/*"] } } }',
    'src/api.ts': 'export interface API { run(): void }',
    'src/client.ts': "import type { API } from '@app/api.js'; export class Client implements API { run() {} }",
  });
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.nodes.some(node => node.file.endsWith('.json')), false);
  assert.equal(result.relations.find(edge => edge.kind === 'imports').to, 'file:src/api.ts');
  assert.equal(targetNode(result, result.relations.find(edge => edge.kind === 'implements')).name, 'API');
});

test('TSX, JSX, JavaScript, MJS and CTS parse as source without requiring React or executing source', async () => {
  const result = await analyze({
    'view.tsx': "export const Panel = () => <section><span>hello</span></section>;",
    'widget.jsx': 'export class Widget { render() { return <div />; } }',
    'plain.js': 'export function hello() { return 1; }',
    'esm.mjs': 'export function moduleEntry() {}',
    'module.cts': 'export class NativeModule {}',
  });
  assert.deepEqual(result.diagnostics, []);
  for (const name of ['Panel', 'Widget', 'render', 'hello', 'moduleEntry', 'NativeModule']) assert(named(result, name), name);
});

test('UTF-16 offsets and 1-based CRLF/Unicode source positions point at real declaration text', async () => {
  const content = '// 😀 中文\r\n  export class Canvas {\r\n    draw(): void {}\r\n  }\r\n';
  const result = await analyze({ 'unicode.ts': content });
  const canvas = named(result, 'Canvas');
  const draw = named(result, 'draw');
  assert.equal(canvas.location.start, content.indexOf('export class'));
  assert.equal(canvas.location.startLine, 2);
  assert.equal(canvas.location.startColumn, 3);
  assert.equal(draw.location.startLine, 3);
  assert.equal(draw.location.startColumn, 5);
  assert.equal(content.slice(draw.location.start, draw.location.end), 'draw(): void {}');
  assert.equal(draw.location.fileHash, hash(content));
  assert.equal(named(result, 'unicode.ts').location.endLine, 5);
  assert.equal(named(result, 'unicode.ts').location.endColumn, 1);
});

test('malformed source remains inspectable as a file with diagnostics and no invented symbols or outgoing relations', async () => {
  const result = await analyze({
    'broken.ts': "import { Base } from './valid.js'; export class Broken extends Base {",
    'valid.ts': 'export class Base {}',
  });
  assert(result.diagnostics.some(item => item.file === 'broken.ts' && item.line >= 1));
  assert.deepEqual(result.nodes.filter(node => node.file === 'broken.ts').map(node => node.kind), ['file']);
  assert.equal(result.relations.some(edge => edge.location.file === 'broken.ts'), false);
  assert(named(result, 'Base'));
});

test('unresolved modules, missing types and dynamic imports stay explicit without false target nodes', async () => {
  const result = await analyze({
    'unknown.ts': "import 'not-installed'; import './absent.js'; export { Missing } from './missing.js'; export class Uses implements Unknown {} const load = (name: string) => import(name);",
  });
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.relations.length, 5);
  for (const edge of result.relations) {
    assert.equal(edge.resolved, false);
    assert.equal(edge.to, undefined);
    assert(edge.location.start < edge.location.end);
  }
  assert(result.relations.some(edge => edge.targetName === 'name'));
});

test('module cycles produce finite deterministic relations rather than recursive expansion', async () => {
  const result = await analyze({
    'a.ts': "import { B } from './b.js'; export class A extends B {}",
    'b.ts': "import { A } from './a.js'; export class B extends A {}",
  });
  const imports = result.relations.filter(edge => edge.kind === 'imports');
  assert.deepEqual(imports.map(edge => [edge.from, edge.to]), [['file:a.ts', 'file:b.ts'], ['file:b.ts', 'file:a.ts']]);
  assert.equal(new Set(result.nodes.map(node => node.id)).size, result.nodes.length);
  assert.equal(new Set(result.relations.map(edge => edge.id)).size, result.relations.length);
});

test('snapshot digest is input-order independent, changes with content, and does not invalidate unrelated node IDs', async () => {
  const provider = new TypeScriptLanguageProvider();
  const files = { 'a.ts': 'export class A {}', 'b.ts': 'export class B {}' };
  const before = await provider.analyze(snapshot(files));
  const reordered = await provider.analyze(snapshot(Object.fromEntries(Object.entries(files).reverse())));
  assert.deepEqual(reordered, before);
  const changed = await provider.analyze(snapshot({ ...files, 'b.ts': '// changed\nexport class B {}' }));
  assert.notEqual(changed.id, before.id);
  assert.equal(named(changed, 'A').id, named(before, 'A').id);
  assert.notEqual(named(changed, 'B').id, named(before, 'B').id);
});

test('actual source content determines location hashes rather than trusting a stale supplied hash', async () => {
  const input = snapshot({ 'module.ts': 'export class Module {}' });
  input.files[0].hash = 'old-hash';
  const result = await new TypeScriptLanguageProvider().analyze(input);
  assert.equal(named(result, 'Module').location.fileHash, hash(input.files[0].content));
});

test('closed compiler filesystem cannot resolve a real file or extends config outside the supplied snapshot', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'atlas-analysis-closed-'));
  try {
    const project = join(temp, 'project');
    await mkdir(project);
    await writeFile(join(temp, 'secret.ts'), 'export interface Secret {}');
    await writeFile(join(temp, 'tsconfig.secret.json'), '{ "compilerOptions": { "paths": { "@secret": ["./secret.ts"] } } }');
    const input = snapshot({
      'tsconfig.json': '{ "extends": "../tsconfig.secret.json" }',
      'reader.ts': "import type { Secret } from '../secret.js'; export class Reader implements Secret {}",
    }, project);
    const result = await new TypeScriptLanguageProvider().analyze(input);
    assert.equal(result.nodes.some(node => node.name === 'Secret'), false);
    assert(result.diagnostics.some(item => item.message.includes('tsconfig.secret.json')));
    for (const edge of result.relations) assert.equal(edge.resolved, false);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('ambiguous merged interface declarations are not collapsed into a fabricated unique heritage target', async () => {
  const result = await analyze({ 'merge.ts': 'export interface Combined { a(): void } export interface Combined { b(): void } export class Uses implements Combined { a() {} b() {} }' });
  assert.equal(result.nodes.filter(node => node.name === 'Combined').length, 2);
  const relation = result.relations.find(edge => edge.kind === 'implements');
  assert.equal(relation.resolved, false);
  assert.equal(relation.to, undefined);
});

test('invalid source paths are diagnosed, duplicate normalized paths rejected, and metadata-only snapshots are empty', async () => {
  const provider = new TypeScriptLanguageProvider();
  const result = await provider.analyze(snapshot({ '../outside.ts': 'export class Outside {}', '/absolute.ts': 'export class Absolute {}', 'inside.ts': 'export class Inside {}' }));
  assert.equal(result.diagnostics.length, 2);
  assert.equal(result.nodes.some(node => ['Outside', 'Absolute'].includes(node.name)), false);
  assert(named(result, 'Inside'));
  await assert.rejects(provider.analyze(snapshot({ 'src/../same.ts': 'class One {}', 'same.ts': 'class Two {}' })), /duplicate source path/);
  const metadata = await provider.analyze(snapshot({ 'package.json': '{"name":"empty"}' }));
  assert.deepEqual(metadata.nodes, []);
  assert.deepEqual(metadata.relations, []);
});


test('assigned and nested class expressions retain their class identity, methods and direct heritage evidence', async () => {
  const result = await analyze({
    'base.ts': 'export interface Contract { work(): void } export const Base = class BaseInternal implements Contract { work() {} };',
    'child.ts': "import { Base } from './base.js'; export const Child = class extends Base { refresh() {} }; export function factory() { return class Nested { run() {} }; }",
  });
  assert.deepEqual(result.diagnostics, []);
  const base = named(result, 'Base', 'class');
  const child = named(result, 'Child', 'class');
  const nested = named(result, 'Nested', 'class');
  assert(base && child && nested);
  assert.equal(base.exported, true);
  assert.equal(child.exported, true);
  assert.equal(nested.parentId, named(result, 'factory', 'function').id);
  assert.equal(named(result, 'refresh', 'method').parentId, child.id);
  assert.equal(named(result, 'run', 'method').parentId, nested.id);
  const inherited = result.relations.find(edge => edge.kind === 'extends');
  assert.equal(inherited.from, child.id);
  assert.equal(inherited.to, base.id);
  assert.equal(result.relations.find(edge => edge.kind === 'implements').to, named(result, 'Contract').id);
});

test('static import types resolve while runtime dynamic import stays unresolved with separate source evidence', async () => {
  const content = "export type View = import('./types.js').View; export const load = () => import('./types.js');";
  const result = await analyze({ 'reader.ts': content, 'types.ts': 'export interface View { title: string }' });
  assert.deepEqual(result.diagnostics, []);
  const imports = result.relations.filter(edge => edge.kind === 'imports');
  assert.equal(imports.length, 2);
  assert.equal(imports[0].to, 'file:types.ts');
  assert.equal(imports[0].resolved, true);
  assert.equal(imports[1].to, undefined);
  assert.equal(imports[1].resolved, false);
  for (const edge of imports) {
    assert.equal(edge.targetName, './types.js');
    assert.equal(content.slice(edge.location.start, edge.location.end), "'./types.js'");
  }
  assert.notEqual(imports[0].id, imports[1].id);
});

test('static calls link imported functions, arrow values, constructors and method declarations with full call evidence', async () => {
  const result = await analyze({
    'service.ts': 'export function save(x: number) { return x; } export const validate = (x: number) => x > 0; export class Store { put(x: number) { return save(x); } }',
    'main.ts': 'import { save as persist, validate, Store } from "./service.js"; export function main(x: number) { if (validate(x)) { const db = new Store(); db.put(persist(x)); } }',
  });
  const main = named(result, 'main');
  const calls = result.relations.filter(edge => edge.from === main.id && (edge.kind === 'calls' || edge.kind === 'constructs'));
  assert.equal(calls.length, 4);
  assert(calls.every(edge => edge.resolved));
  assert.deepEqual(new Set(calls.map(edge => targetNode(result, edge).name)), new Set(['validate', 'Store', 'put', 'save']));
  assert.equal(calls.find(edge => edge.targetName === 'db.put').dispatch, 'declared');
  const persist = calls.find(edge => edge.targetName === 'persist');
  assert.equal(persist.excerpt, 'persist(x)');
  assert.equal(persist.location.file, 'main.ts');
  assert.equal(persist.dispatch, 'direct');
});

test('callback bodies have their own caller and unknown external calls remain explicit', async () => {
  const result = await analyze({ 'index.ts': 'function save() {} export function start() { unknownRegister(() => save()); unknownReceiver.method(); }' });
  const save = named(result, 'save'), start = named(result, 'start');
  const callback = result.nodes.find(node => node.name.startsWith('callback@'));
  assert(callback); assert.equal(callback.parentId, start.id);
  const edge = result.relations.find(edge => edge.to === save.id && edge.kind === 'calls');
  assert.equal(edge.from, callback.id);
  const unresolved = result.relations.find(edge => edge.targetName === 'unknownReceiver.method');
  assert.equal(unresolved.resolved, false); assert.equal(unresolved.dispatch, 'unknown');
});
