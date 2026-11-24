import assert from 'node:assert/strict';
import test from 'node:test';
import { AtlasRegistry, BasicNodeLabel, PublicApiLabel, ReadLabel } from '../lib/core.js';
import { TestFileLabel, testFileLabel } from '../lib/test-file-label.js';

const node = (file, kind = 'file') => ({ id: `node:${file}`, name: 'example', kind, file, exported: kind !== 'file',
  location: { file, start: 0, end: 1, startLine: 1, startColumn: 1, endLine: 1, endColumn: 2, fileHash: 'unchanged' } });

test('test-file plugin recognizes test/spec suffixes and exact test directory components', () => {
  const labels = testFileLabel.wrap(new BasicNodeLabel());
  assert.equal(testFileLabel.name, 'test-file');
  assert(labels instanceof TestFileLabel);
  for (const file of ['a.test.ts', 'src/a.spec.tsx', 'a.test.js', 'a.spec.jsx', 'a.test.mts', 'a.spec.cts',
    'a.test.mjs', 'a.spec.cjs', '__tests__/a.ts', 'src/__tests__/a.js', 'test/a.ts', 'src/tests/a.ts',
    'src\\tests\\a.ts', 'src/A.SPEC.TS']) {
    assert.equal(labels.label(node(file), new Set()), 'example [测试文件]', file);
  }
  for (const file of ['src/a.ts', 'src/test-utils.ts', 'src/contest/a.ts', 'src/latest/a.ts',
    'src/testing/a.ts', 'src/a.test-helper.ts', 'src/a.spec.ts.backup', 'src/a.test.json']) {
    assert.equal(labels.label(node(file), new Set()), 'example', file);
  }
});

test('same-interface test wrapper delegates exact inputs once and preserves inner decorators', () => {
  const selected = node('src/a.test.ts', 'function'), readIds = new Set([selected.id]);
  const before = structuredClone(selected), calls = [];
  const inner = { label(actual, read) { calls.push([actual, read]); return 'upstream'; } };
  assert.equal(new TestFileLabel(inner).label(selected, readIds), 'upstream [测试文件]');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], selected); assert.equal(calls[0][1], readIds);
  assert.equal(testFileLabel.wrap(new ReadLabel(new PublicApiLabel(new BasicNodeLabel())))
    .label(selected, readIds), 'example [公开 API] [已读] [测试文件]');
  assert.deepEqual(selected, before);
  assert.deepEqual([...readIds], [selected.id]);
});

test('existing registry registers and unregisters test-file without changing other label responsibilities', () => {
  const registry = new AtlasRegistry({ name: 'fixture', async analyze() { throw new Error('unused'); } });
  const selected = node('test/a.ts', 'class'), readIds = new Set([selected.id]);
  const unregister = registry.registerLabel(testFileLabel);
  assert.equal(registry.labels(true).label(selected, readIds), 'example [公开 API] [已读] [测试文件]');
  assert.equal(registry.labels(false).label(selected, readIds), 'example [已读] [测试文件]');
  unregister(); unregister();
  assert.equal(registry.labels(true).label(selected, readIds), 'example [公开 API] [已读]');
  const removeAgain = registry.registerLabel(testFileLabel);
  assert.equal(registry.labels(false).label(selected, new Set()), 'example [测试文件]');
  removeAgain();
});
