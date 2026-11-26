import assert from 'node:assert/strict';
import test from 'node:test';
import { AtlasController } from '../lib/client-controller.js';

const location = { file: 'src/contracts.ts', start: 0, end: 25, startLine: 1, startColumn: 1, endLine: 2, endColumn: 1, fileHash: 'file-hash' };
const contract = { id: 'interface:Handler', name: 'Handler', kind: 'interface', file: 'src/contracts.ts', exported: true, location };
const implementation = { ...contract, id: 'class:Box', name: 'Box', kind: 'class', file: 'src/box.ts', location: { ...location, file: 'src/box.ts' } };
const relation = { id: 'implements', kind: 'implements', from: implementation.id, to: contract.id, targetName: 'Handler', resolved: true, location: { ...implementation.location, startLine: 4, endLine: 4 } };
const base = { snapshot: { id: 'snapshot', root: '/workspace', nodes: [contract, implementation], relations: [relation], diagnostics: [] }, selectedId: contract.id, direction: 'dependencies', depth: 1, readIds: [], labels: {}, graph: { nodeIds: [contract.id, implementation.id], relationIds: [relation.id] }, svg: '<svg xmlns="http://www.w3.org/2000/svg" />' };

function fixture() {
  let value = structuredClone(base);
  const calls = [];
  const streams = [];
  const remote = {
    async sessions() { return [{ id: 'A', title: 'A', cwd: '/workspace' }, { id: 'B', title: 'B', cwd: '/other' }]; },
    watch(session) { const stream = viewStream(); streams.push({ session, stream }); return stream; },
    async scan(session) { calls.push(['scan', session]); return structuredClone(value); },
    async inspect(session, id) { calls.push(['inspect', session, id]); value = { ...value, selectedId: id }; return { view: structuredClone(value), source: { node: value.snapshot.nodes.find(node => node.id === id), content: 'export interface Handler {}\n', snapshotId: value.snapshot.id } }; },
    async route(session, direction, depth) { calls.push(['route', session, direction, depth]); value = { ...value, direction, depth }; return structuredClone(value); },
    async navigate(session, id, direction, depth, graphKind) { calls.push(['navigate', session, id, direction, depth, graphKind]); await remote.route(session, direction, depth); const result = await remote.inspect(session, id); value = { ...value, graphKind }; return { ...result, view: structuredClone(value) }; },
    async markRead(session, id, read) { calls.push(['mark', session, id, read]); value = { ...value, readIds: read ? [id] : [] }; return structuredClone(value); },
    async setPublicApiLabel(session, enabled) { calls.push(['label', session, enabled]); return structuredClone(value); },
    async exportSVG(session) { calls.push(['export', session]); return { svg: value.svg, filename: 'atlas.svg' }; },
  };
  return { remote, calls, streams, controller: new AtlasController(remote) };
}
function deferred() { let resolve; const promise = new Promise(accept => { resolve = accept; }); return { promise, resolve }; }
function viewStream() {
  const queue = [], waiting = [];
  let disposed = false;
  return {
    get disposed() { return disposed; },
    push(value) { if (disposed) return; const next = { value, done: false }; const waiter = waiting.shift(); if (waiter) waiter(next); else queue.push(next); },
    [Symbol.asyncIterator]() { return this; },
    next() { return disposed ? Promise.resolve({ done: true }) : queue.length ? Promise.resolve(queue.shift()) : new Promise(resolve => waiting.push(resolve)); },
    return() { this.dispose(); return Promise.resolve({ done: true }); },
    dispose() { disposed = true; for (const waiter of waiting.splice(0)) waiter({ done: true }); queue.length = 0; },
  };
}
const drainStream = () => new Promise(resolve => setImmediate(resolve));

test('one observable controller updates independent map and source subscribers, then disposes subscriptions', async () => {
  const { controller } = fixture();
  let map = 0, source = 0;
  const mapOff = controller.subscribe(() => map++);
  controller.subscribe(() => source++);
  await controller.loadSessions();
  await controller.scan();
  assert.equal(controller.getSnapshot().view.snapshot.id, 'snapshot');
  assert.equal(controller.getSnapshot().source.node.id, contract.id);
  assert.equal(map, source);
  assert(map > 2);
  mapOff();
  const previousMap = map, previousSource = source;
  controller.setQuery('Handler');
  assert.equal(map, previousMap);
  assert.equal(source, previousSource + 1);
  controller.dispose();
  controller.setQuery('ignored');
  assert.equal(source, previousSource + 1);
});

test('map and tree selection use the same inspection and source version verification path', async () => {
  const { controller, calls } = fixture();
  await controller.loadSessions(); await controller.scan();
  await controller.selectNode(implementation.id);
  assert.equal(controller.getSnapshot().view.selectedId, implementation.id);
  assert.equal(controller.getSnapshot().source.node.id, implementation.id);
  assert.deepEqual(calls.at(-1), ['inspect', 'A', implementation.id]);
});

test('source evidence highlights its exact range while retaining the host-verified source file', async () => {
  const { controller } = fixture();
  await controller.loadSessions(); await controller.scan();
  await controller.selectEvidence(relation);
  assert.equal(controller.getSnapshot().source.node.id, implementation.id);
  assert.deepEqual(controller.getSnapshot().highlight, relation.location);
  await controller.selectNode(contract.id);
  assert.equal(controller.getSnapshot().highlight, undefined);
});

test('reading direction, depth, read markers and public API labels go through their declared contracts', async () => {
  const { controller, calls } = fixture();
  await controller.loadSessions(); await controller.scan();
  await controller.changeRoute('users', 2);
  assert.equal(controller.getSnapshot().view.direction, 'users');
  assert.equal(controller.getSnapshot().view.depth, 2);
  await controller.markSelected(true);
  assert.deepEqual(controller.getSnapshot().view.readIds, [contract.id]);
  await controller.markSelected(false);
  assert.deepEqual(controller.getSnapshot().view.readIds, []);
  await controller.togglePublicApi(false);
  assert.equal(controller.getSnapshot().publicApiLabel, false);
  assert(calls.some(call => call[0] === 'label' && call[2] === false));
});

test('failed source verification clears previously visible code and asks for refresh', async () => {
  const { controller, remote } = fixture();
  await controller.loadSessions(); await controller.scan();
  remote.inspect = async () => { throw new Error('STALE_SOURCE: file changed'); };
  await controller.selectNode(implementation.id);
  assert.equal(controller.getSnapshot().source, undefined);
  assert.match(controller.getSnapshot().error, /请点击.*扫描.*刷新/);
  assert.equal(controller.getSnapshot().busy, false);
});

test('changing session invalidates pending inspection and clears the previous project and code', async () => {
  const { controller, remote } = fixture();
  await controller.loadSessions(); await controller.scan();
  const gate = deferred();
  remote.inspect = async () => gate.promise;
  const pending = controller.selectNode(implementation.id);
  controller.selectSession('B');
  gate.resolve({ view: structuredClone(base), source: { node: implementation, content: 'old source', snapshotId: 'snapshot' } });
  await pending;
  assert.equal(controller.getSnapshot().sessionId, 'B');
  assert.equal(controller.getSnapshot().view, undefined);
  assert.equal(controller.getSnapshot().source, undefined);
  assert.equal(controller.getSnapshot().busy, false);
});

test('disposing the browser plugin prevents late RPC results from notifying or repopulating state', async () => {
  const { controller, remote } = fixture();
  const gate = deferred();
  remote.sessions = () => gate.promise;
  let notifications = 0;
  controller.subscribe(() => notifications++);
  const pending = controller.loadSessions();
  controller.dispose();
  const count = notifications;
  gate.resolve([{ id: 'late', title: 'late', cwd: '/late' }]);
  await pending;
  assert.equal(notifications, count);
  assert.deepEqual(controller.getSnapshot().sessions, []);
});

test('export obtains only the current session generated SVG and delegates a download to the view boundary', async () => {
  const { controller, calls } = fixture();
  await controller.loadSessions(); await controller.scan();
  const downloads = [];
  await controller.exportSVG((svg, filename) => downloads.push({ svg, filename }));
  assert.deepEqual(downloads, [{ svg: base.svg, filename: 'atlas.svg' }]);
  assert.deepEqual(calls.at(-1), ['export', 'A']);
  assert.match(controller.getSnapshot().notice, /发起.*导出/);
  assert.doesNotMatch(controller.getSnapshot().notice, /已导出|下载目录/);
});

test('an empty session list has a usable empty state and scan does not invoke a nonexistent workspace', async () => {
  const { controller, remote, calls } = fixture();
  remote.sessions = async () => [];
  await controller.loadSessions(); await controller.scan();
  assert.equal(controller.getSnapshot().sessionId, '');
  assert.match(controller.getSnapshot().error, /请先选择/);
  assert.deepEqual(calls, []);
});

test('refreshing sessions cannot leave code from a deleted session beside a newly selected project', async () => {
  const { controller, remote } = fixture();
  await controller.loadSessions(); await controller.scan();
  remote.sessions = async () => [{ id: 'B', title: 'B', cwd: '/other' }];
  await controller.loadSessions();
  assert.equal(controller.getSnapshot().sessionId, 'B');
  assert.equal(controller.getSnapshot().view, undefined);
  assert.equal(controller.getSnapshot().source, undefined);
});

test('native tool changes update an open map and clear a different selection without recursively inspecting', async () => {
  const { controller, streams, calls } = fixture();
  await controller.loadSessions(); await controller.scan();
  const previousCalls = calls.length;
  const pushed = { ...structuredClone(base), selectedId: implementation.id, direction: 'users', depth: 2, readIds: [implementation.id], publicApiLabel: false };
  streams[0].stream.push(pushed);
  await drainStream();
  assert.deepEqual(controller.getSnapshot().view, pushed);
  assert.equal(controller.getSnapshot().source, undefined);
  assert.equal(controller.getSnapshot().publicApiLabel, false);
  assert.match(controller.getSnapshot().notice, /会话地图已同步/);
  assert.equal(calls.length, previousCalls);
  controller.dispose();
});

test('read and route pushes for the same verified selection retain its source, while a new snapshot clears it', async () => {
  const { controller, streams } = fixture();
  await controller.loadSessions(); await controller.scan();
  const source = controller.getSnapshot().source;
  streams[0].stream.push({ ...structuredClone(base), readIds: [contract.id] });
  await drainStream();
  assert.equal(controller.getSnapshot().source, source);
  const next = structuredClone(base);
  next.snapshot.id = 'refreshed';
  streams[0].stream.push(next);
  await drainStream();
  assert.equal(controller.getSnapshot().source, undefined);
  controller.dispose();
});

test('changing sessions and unloading dispose the native view streams and reject late previous-session updates', async () => {
  const { controller, streams } = fixture();
  await controller.loadSessions();
  assert.equal(streams[0].session, 'A');
  controller.selectSession('B');
  assert.equal(streams[0].stream.disposed, true);
  assert.equal(streams[1].session, 'B');
  streams[0].stream.push(structuredClone(base));
  await drainStream();
  assert.equal(controller.getSnapshot().view, undefined);
  streams[1].stream.push(structuredClone(base));
  await drainStream();
  assert.equal(controller.getSnapshot().view.snapshot.id, 'snapshot');
  controller.dispose();
  assert.equal(streams[1].stream.disposed, true);
});

test('back and forward restore selected source, route, search and source pane; a new branch removes forward history', async () => {
  const { controller } = fixture();
  await controller.loadSessions(); await controller.scan();
  controller.setQuery('Box'); controller.setSourceOpen(true);
  await controller.selectNode(implementation.id);
  await controller.changeRoute('users', 2);
  await controller.selectNode(contract.id);
  controller.setQuery('Attribute'); controller.setSourceOpen(false); controller.setPane('guide');
  await controller.navigate(-1);
  assert.equal(controller.getSnapshot().view.selectedId, implementation.id);
  assert.equal(controller.getSnapshot().source.node.id, implementation.id);
  assert.equal(controller.getSnapshot().view.direction, 'users');
  assert.equal(controller.getSnapshot().view.depth, 2);
  assert.equal(controller.getSnapshot().sourceOpen, true);
  assert.equal(controller.getSnapshot().query, 'Box');
  assert.equal(controller.getSnapshot().canForward, true);
  await controller.navigate(1); assert.equal(controller.getSnapshot().view.selectedId, contract.id);
  assert.equal(controller.getSnapshot().query, 'Attribute'); assert.equal(controller.getSnapshot().sourceOpen, false);
  assert.equal(controller.getSnapshot().pane, 'guide');
  await controller.navigate(-1); await controller.changeRoute('dependencies', 1);
  assert.equal(controller.getSnapshot().canForward, false);
  controller.dispose();
});
test('failed stale back navigation does not advance its history cursor or reveal cached source', async () => {
  const { controller, remote } = fixture();
  await controller.loadSessions(); await controller.scan(); await controller.selectNode(implementation.id);
  const inspect = remote.inspect;
  remote.inspect = async () => { throw new Error('STALE_SOURCE: changed'); };
  await controller.navigate(-1);
  assert.equal(controller.getSnapshot().view.selectedId, implementation.id);
  assert.equal(controller.getSnapshot().canBack, true); assert.equal(controller.getSnapshot().canForward, false);
  assert.equal(controller.getSnapshot().source, undefined);
  remote.inspect = inspect; await controller.navigate(-1);
  assert.equal(controller.getSnapshot().view.selectedId, contract.id);
  controller.dispose();
});
test('graph kind changes are part of navigation, with no cross-session history leakage', async () => {
  const { controller, remote, calls } = fixture();
  remote.graphKind = async (session, graphKind) => { calls.push(['graphKind', session, graphKind]); const value = await remote.scan(session); return { ...value, graphKind }; };
  await controller.loadSessions(); await controller.scan(); await controller.changeGraphKind('calls');
  await controller.navigate(-1);
  assert(calls.some(call => call[0] === 'navigate' && call[5] === 'structure'));
  controller.selectSession('B'); assert.equal(controller.getSnapshot().canBack, false); assert.deepEqual(controller.getSnapshot().trail, []);
  controller.dispose();
});
test('cancelled or previous-session model responses cannot repopulate the workbench', async () => {
  const { controller, remote } = fixture(); const gate = deferred();
  remote.generateGuide = async () => gate.promise; let cancelled = 0;
  remote.cancelGuide = async () => { cancelled++; return null; };
  await controller.loadSessions(); await controller.scan();
  const request = controller.generateGuide('review');
  assert.equal(controller.getSnapshot().guideBusy, true);
  await controller.cancelGuide(); gate.resolve(structuredClone(base)); await request;
  assert.equal(cancelled, 1); assert.equal(controller.getSnapshot().guideBusy, false);
  assert.equal(controller.getSnapshot().view.guide, undefined);
  controller.dispose();
});

test('workbench task intent reaches the native model boundary without mutating project code', async () => {
  const { controller, remote } = fixture(); const calls = [];
  remote.generateGuide = async (...args) => { calls.push(args); return structuredClone(base); };
  await controller.loadSessions(); await controller.scan();
  await controller.generateGuide('讨论模块边界', 'design');
  assert.equal(calls[0][1], '讨论模块边界'); assert.equal(calls[0][2], 'design');
  assert.equal(controller.getSnapshot().pane, 'guide');
  await controller.generateGuide('解释入口'); assert.equal(calls[1][2], 'flow');
  controller.dispose();
});
