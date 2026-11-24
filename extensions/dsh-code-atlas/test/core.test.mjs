import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { AtlasWorkbench, AtlasRegistry, BasicNodeLabel, PublicApiLabel, ReadLabel, DependenciesFirst, UsersFirst,
  LayeredLayout } from '../lib/core.js';

const hash = content => createHash('sha256').update(content).digest('hex');
const location = (file, content) => ({ file, start: 0, end: content.length, startLine: 1, startColumn: 1,
  endLine: 1, endColumn: content.length + 1, fileHash: hash(content) });
const fileNode = (id, file, content, kind = 'file', exported = false) => ({ id, name: id, kind, file, exported, location: location(file, content) });
class MemorySource {
  files = new Map([['a.ts', 'export interface A {}'], ['b.ts', 'export class B implements A {}'], ['c.ts', 'import B from "./b"']]);
  failure = false;
  async snapshot(root) {
    if (this.failure) throw new Error('read failed');
    return { root, files: [...this.files].map(([path, content]) => ({ path, content, hash: hash(content) })) };
  }
  async read(root, file) {
    const content = this.files.get(file);
    if (content === undefined) throw new Error('missing file');
    return { path: file, content, hash: hash(content) };
  }
}
class FixtureLanguage {
  name = 'fixture';
  async analyze(source) {
    const nodes = source.files.map(file => fileNode(file.path, file.path, file.content,
      file.path === 'a.ts' ? 'interface' : 'class', true));
    const edge = (id, from, to, kind = 'implements') => ({ id, from, to, targetName: to, resolved: true,
      kind, location: nodes.find(node => node.id === from).location });
    return { id: hash(source.files.map(file => file.hash).join('')), root: source.root, nodes,
      relations: [edge('ba', 'b.ts', 'a.ts'), edge('cb', 'c.ts', 'b.ts', 'imports')], diagnostics: [] };
  }
}
async function fixture() {
  const source = new MemorySource(), provider = new FixtureLanguage(), workbench = new AtlasWorkbench(source, provider);
  await workbench.scan('one', '/workspace');
  return { source, provider, workbench };
}

test('reading strategies distinguish dependencies/users and one/two hops, retaining cycle edges', () => {
  const a = fileNode('a', 'a.ts', ''), b = fileNode('b', 'b.ts', ''), c = fileNode('c', 'c.ts', '');
  const relation = (id, from, to) => ({ id, from, to, targetName: to, resolved: true, kind: 'imports', location: a.location });
  const snapshot = { id: 'v', root: '/x', nodes: [a, b, c], relations: [relation('ab', 'a', 'b'), relation('ba', 'b', 'a'), relation('bc', 'b', 'c')], diagnostics: [] };
  assert.deepEqual(new DependenciesFirst().select(snapshot, 'a', 1).nodeIds, ['a', 'b']);
  assert.deepEqual(new DependenciesFirst().select(snapshot, 'a', 2).nodeIds, ['a', 'b', 'c']);
  assert.deepEqual(new UsersFirst().select(snapshot, 'c', 2).nodeIds, ['c', 'b', 'a']);
  assert(new DependenciesFirst().select(snapshot, 'a', 1).relationIds.includes('ba'));
});

test('classic label decorators preserve delegation order and are independently composable', () => {
  const node = fileNode('api', 'a.ts', '', 'interface', true), read = new Set(['api']);
  const base = new BasicNodeLabel();
  assert.equal(base.label(node, read), 'api');
  assert.equal(new ReadLabel(new PublicApiLabel(base)).label(node, read), 'api [公开 API] [已读]');
  assert.equal(new PublicApiLabel(new ReadLabel(base)).label(node, read), 'api [已读] [公开 API]');
});

test('real SVG provider/codec render escaped labels, stable node metadata and arrows', async () => {
  const { workbench } = await fixture();
  const { view, source } = await workbench.inspect('one', 'b.ts');
  assert.match(view.svg, /data-kind="box"/);
  assert.match(view.svg, /data-node-id="b.ts"/);
  assert.match(view.svg, /data-relation-id="ba"/);
  assert.match(view.svg, /edge-0-arrow-0/);
  assert.equal(source.node.id, 'b.ts');
  assert.equal(source.content, 'export class B implements A {}');
  workbench.dispose();
});

test('read marks, source selection, routes and API labels update two observers without modifying source', async () => {
  const { source, workbench } = await fixture();
  const before = [...source.files];
  const first = [], second = [];
  const stopA = workbench.subscribe('one', view => first.push(view));
  const stopB = workbench.subscribe('one', view => second.push(view));
  await workbench.inspect('one', 'a.ts');
  const marked = await workbench.markRead('one', 'a.ts', true);
  assert.match(marked.labels['a.ts'], /公开 API.*已读/);
  assert.deepEqual(workbench.route('one', 'users', 2).graph.nodeIds, ['a.ts', 'b.ts', 'c.ts']);
  assert.doesNotMatch(workbench.setPublicApiLabel('one', false).labels['a.ts'], /公开 API/);
  assert.equal(first.length, 4); assert.equal(second.length, 4);
  stopA(); await workbench.markRead('one', 'a.ts', false);
  assert.equal(first.length, 4); assert.equal(second.length, 5);
  stopB(); workbench.route('one', 'dependencies', 1);
  assert.equal(second.length, 5);
  assert.deepEqual([...source.files], before);
  workbench.dispose();
});

test('changed source refuses stale navigation and marking; refresh clears only changed read marks', async () => {
  const { source, workbench } = await fixture();
  await workbench.markRead('one', 'a.ts', true); await workbench.markRead('one', 'b.ts', true);
  source.files.set('a.ts', 'export interface A { changed(): void }');
  await assert.rejects(workbench.inspect('one', 'a.ts'), error => error.code === 'STALE_SOURCE');
  await assert.rejects(workbench.markRead('one', 'a.ts', false), error => error.code === 'STALE_SOURCE');
  const refreshed = await workbench.scan('one', '/workspace');
  assert.deepEqual(refreshed.readIds, ['b.ts']);
  assert.equal((await workbench.inspect('one', 'a.ts')).source.content, source.files.get('a.ts'));
  workbench.dispose();
});

test('a failed refresh keeps the previous complete snapshot and reading state', async () => {
  const { source, workbench } = await fixture();
  await workbench.markRead('one', 'a.ts', true);
  const before = workbench.view('one'); source.failure = true;
  await assert.rejects(workbench.scan('one', '/workspace'), /read failed/);
  assert.deepEqual(workbench.view('one'), before);
  workbench.dispose();
});

test('moving a session to another workspace clears marks even when relative files and hashes match', async () => {
  const { workbench } = await fixture();
  await workbench.markRead('one', 'a.ts', true);
  workbench.setPublicApiLabel('one', false);
  const moved = await workbench.scan('one', '/other-project');
  assert.deepEqual(moved.readIds, []);
  assert.equal(moved.publicApiLabel, true);
  workbench.dispose();
});

test('cycle and self edges reach box boundaries through visible external segments', async () => {
  const source = new MemorySource(), provider = new FixtureLanguage();
  const analyze = provider.analyze.bind(provider);
  provider.analyze = async files => {
    const snapshot = await analyze(files);
    snapshot.relations.push({ ...snapshot.relations[0], id: 'self', from: 'a.ts', to: 'a.ts' });
    return snapshot;
  };
  const workbench = new AtlasWorkbench(source, provider);
  const view = await workbench.scan('one', '/workspace');
  assert.equal((view.svg.match(/data-relation-id="self"/g) ?? []).length, 3);
  assert.match(view.svg, /edge-0-arrow/);
  workbench.dispose();
});

test('sessions isolate state and close/unload prevent reads; one faulty observer cannot break another', async () => {
  const { workbench } = await fixture();
  await workbench.scan('two', '/workspace');
  await workbench.markRead('one', 'a.ts', true);
  assert.deepEqual(workbench.view('two').readIds, []);
  let seen = 0;
  workbench.subscribe('one', () => { throw new Error('view failed'); });
  workbench.subscribe('one', () => seen++);
  workbench.route('one', 'users', 1); assert.equal(seen, 1);
  workbench.close('one'); assert.throws(() => workbench.view('one'), error => error.code === 'SCAN_REQUIRED');
  assert(workbench.view('two'));
  workbench.dispose(); assert.throws(() => workbench.view('two'), error => error.code === 'PLUGIN_CLOSED');
});

test('registry rejects duplicate names and a new decorator changes labels without changing core/render code', async () => {
  const { workbench } = await fixture();
  const unregister = workbench.extensions.registerLabel({ name: 'example', wrap: inner => ({ label: (node, read) => `${inner.label(node, read)} [示例]` }) });
  assert.match(workbench.view('one').labels['a.ts'], /\[示例\]$/);
  assert.throws(() => workbench.extensions.registerLabel({ name: 'example', wrap: inner => inner }), /Duplicate extension/);
  unregister(); assert.doesNotMatch(workbench.view('one').labels['a.ts'], /示例/);
  workbench.dispose();
});

test('SCC layout is deterministic and a cycle occupies a shared column without overlapping boxes', () => {
  const nodes = ['a', 'b', 'c'].map(id => fileNode(id, `${id}.ts`, ''));
  const edge = (from, to) => ({ id: `${from}${to}`, from, to, resolved: true, kind: 'imports', targetName: to, location: nodes[0].location });
  const relations = [edge('a', 'b'), edge('b', 'a'), edge('b', 'c')];
  const layout = new LayeredLayout();
  const one = layout.layout(nodes, relations), two = layout.layout([...nodes].reverse(), [...relations].reverse());
  assert.deepEqual(one, two);
  assert.equal(one.get('a').component, one.get('b').component);
  assert.equal(one.get('a').x, one.get('b').x);
  assert.notEqual(one.get('a').y, one.get('b').y);
  assert(one.get('c').x > one.get('b').x);
});

test('close during an in-flight scan prevents late publication', async () => {
  const { source, provider } = await fixture();
  let release; const gate = new Promise(resolve => release = resolve);
  const analyze = provider.analyze.bind(provider);
  provider.analyze = async input => { await gate; return analyze(input); };
  const workbench = new AtlasWorkbench(source, provider);
  const scan = workbench.scan('late', '/workspace');
  await new Promise(resolve => setImmediate(resolve));
  workbench.close('late'); release();
  await assert.rejects(scan, error => error.code === 'SESSION_CLOSED');
  assert.throws(() => workbench.view('late'), error => error.code === 'SCAN_REQUIRED');
  workbench.dispose();
});
