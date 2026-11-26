import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptNativeRemote, AtlasRemoteError } from '../lib/remote-adapter.js';
import { TYPERT_REMOTE } from '../lib/typert.host.js';

const cases = {
  navigate: ['s', 'n', 'users', 2, 'calls'], sessions: [], scan: ['s'], inspect: ['s', 'n'], route: ['s', 'users', 2], markRead: ['s', 'n', false],
  setPublicApiLabel: ['s', false], view: ['s'], exportSVG: ['s'], close: ['s'], graphKind: ['s', 'calls'],
  guideStatus: [], reviewContext: ['s', '梳理保存', 'design'], generateGuide: ['s', '梳理保存', 'refactor'], cancelGuide: ['s'],
  publishGuide: ['s', 'snapshot', { title: 'guide' }],
};
test('every native unary method unwraps its result and preserves receiver, argument order and false values', async () => {
  const calls = [];
  const native = {};
  for (const name of Object.keys(cases)) native[name] = async function (...args) { assert.equal(this, native); calls.push([name, ...args]); return { ok: true, value: name === 'close' ? null : { name } }; };
  const adapter = adaptNativeRemote(native);
  assert.deepEqual(new Set(Object.keys(cases)), new Set(TYPERT_REMOTE.descriptors.filter(item => item.mode !== 'stream').map(item => item.method)));
  for (const [name, args] of Object.entries(cases)) assert.deepEqual(await adapter[name](...args), name === 'close' ? null : { name });
  assert.deepEqual(calls, Object.entries(cases).map(([name, args]) => [name, ...args]));
});
test('native failures retain their machine code and details; thrown carrier errors stay unchanged', async () => {
  const detail = { snapshotId: 'old' };
  const adapter = adaptNativeRemote({ async inspect() { return { ok: false, error: { code: 'STALE_SOURCE', message: '源码已变化', details: detail } }; } });
  await assert.rejects(adapter.inspect('s', 'n'), error => error instanceof AtlasRemoteError && error.code === 'STALE_SOURCE' && error.details === detail && /源码已变化/.test(error.message));
  const failure = new Error('carrier disconnected');
  await assert.rejects(adaptNativeRemote({ async sessions() { throw failure; } }).sessions(), error => error === failure);
  await assert.rejects(adaptNativeRemote({ async sessions() { return []; } }).sessions(), error => error.code === 'REMOTE_FORMAT');
});
test('native stream handles are not wrapped or consumed early and release their original subscription', async () => {
  let disposed = 0;
  const handle = { async *[Symbol.asyncIterator]() { yield { snapshot: 'v' }; }, dispose() { disposed++; } };
  const adapter = adaptNativeRemote({ watch(session) { assert.equal(session, 's'); return handle; } });
  const stream = adapter.watch('s'); assert.equal(stream, handle);
  const values = []; for await (const value of stream) values.push(value);
  assert.deepEqual(values, [{ snapshot: 'v' }]); stream.dispose(); assert.equal(disposed, 1);
});
