import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import React from 'react';
import Renderer, { act } from 'react-test-renderer';

const componentModule = { exports: {} };
const result = await build({ stdin: { contents: 'export { NewWorkbench } from "./src/client/NewWorkbench.tsx";', resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'tsx' }, bundle: true, format: 'cjs', platform: 'node', jsx: 'automatic', external: ['react', 'react/*'], write: false });
vm.runInNewContext(result.outputFiles[0].text, { module: componentModule, exports: componentModule.exports, require: createRequire(import.meta.url), console, setTimeout, clearTimeout });
const { NewWorkbench } = componentModule.exports;
const location = { file: 'src/a.ts', start: 0, end: 10, startLine: 1, startColumn: 1, endLine: 1, endColumn: 11, fileHash: 'hash' };
function fixture(changes, paths = ['src/a.ts']) {
  const nodes = paths.map(path => ({ id: `file:${path}`, file: path, name: path, kind: 'file', exported: false, location: { ...location, file: path } }));
  const state = { busy: false, view: { selectedId: nodes[0]?.id, snapshot: { id: 'snap', nodes, relations: [], diagnostics: [], root: '/project' }, changes } };
  const selections = [], tasks = [], intents = []; let modelCalls = 0, reveals = 0;
  const controller = { getSnapshot: () => state, subscribe: () => () => {}, selectNode(...args) { selections.push(args); }, generateGuide() { modelCalls++; } };
  const props = { controller, intent: 'flow', onIntent: value => intents.push(value), onTask: value => tasks.push(value), onBrowse() {}, onRevealSource() { reveals++; } };
  return { props, selections, tasks, intents, modelCalls: () => modelCalls, reveals: () => reveals, state };
}
test('task choices draft editable work and never launch a model or navigate the source', async () => {
  const f = fixture({ baselineAvailable: false, added: [], modified: [], deleted: [] }); let tree;
  await act(async () => { tree = Renderer.create(React.createElement(NewWorkbench, f.props)); });
  const choices = tree.root.findAll(node => node.type === 'button' && node.props.className?.includes('ca-intent-row'));
  assert.equal(choices.length, 4);
  await act(async () => { for (const choice of choices) choice.props.onClick(); });
  assert.deepEqual(f.intents, ['change-review', 'flow', 'design', 'refactor']);
  assert(f.tasks.some(task => task.includes('不引入模式')));
  assert(f.tasks.some(task => task.includes('回滚')));
  assert.equal(f.modelCalls(), 0); assert.equal(f.selections.length, 0);
  assert.match(JSON.stringify(tree.toJSON()), /没有可比较的前一份快照/);
  await act(async () => tree.unmount());
});
test('many changed files are paged; current files open verified source and deleted files cannot navigate stale positions', async () => {
  const paths = Array.from({ length: 65 }, (_, i) => `src/file-${String(i).padStart(2, '0')}.ts`);
  // Deliberately leave a stale-looking node for the deleted file: the view must
  // still withhold its navigation control based on the deletion fact.
  const f = fixture({ baselineAvailable: true, added: [], modified: paths, deleted: ['src/removed.ts'] }, [...paths, 'src/removed.ts']); let tree;
  await act(async () => { tree = Renderer.create(React.createElement(NewWorkbench, f.props)); });
  const rows = () => tree.root.findAll(node => node.type === 'li' && node.props.className === 'ca-change-row');
  assert.equal(rows().length, 30);
  await act(async () => rows()[0].findByType('button').props.onClick());
  assert.equal(f.selections[0][0], `file:${paths[0]}`); assert.equal(f.selections[0][1].revealSource, true); assert.equal(f.selections[0][1].pane, 'overview'); assert.equal(f.reveals(), 1);
  await act(async () => tree.root.findByProps({ className: 'ca-change-more' }).props.onClick());
  assert.equal(rows().length, 60);
  await act(async () => tree.root.findByProps({ className: 'ca-change-more' }).props.onClick());
  assert.equal(rows().length, 66);
  const deleted = tree.root.findByProps({ 'data-change-kind': 'deleted' });
  assert.equal(deleted.findAllByType('button').length, 0);
  assert.equal(deleted.findByType('small').children.join(''), '旧位置不可跳转');
  assert.equal(f.modelCalls(), 0);
  await act(async () => tree.unmount());
});
test('empty comparison and missing index remain distinct and do not claim tests or Git review have run', async () => {
  const f = fixture({ baselineAvailable: true, added: [], modified: [], deleted: [] }); let tree;
  await act(async () => { tree = Renderer.create(React.createElement(NewWorkbench, f.props)); });
  assert.match(JSON.stringify(tree.toJSON()), /这次没有发现源码变化/);
  assert.match(JSON.stringify(tree.toJSON()), /未读取 Git 差异，也未执行测试/);
  await act(async () => tree.unmount());
  f.state.view = undefined;
  await act(async () => { tree = Renderer.create(React.createElement(NewWorkbench, f.props)); });
  assert.match(JSON.stringify(tree.toJSON()), /先建立项目索引/);
  assert.equal(tree.root.findAllByType('button').find(button => button.children.includes('选择范围')).props.disabled, true);
  await act(async () => tree.unmount());
});
