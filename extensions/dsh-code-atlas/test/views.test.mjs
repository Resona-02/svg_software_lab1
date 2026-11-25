import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import React from 'react';
import Renderer, { act } from 'react-test-renderer';

// Render the actual React components in memory. This is not Desktop visual acceptance.
const componentModule = { exports: {} };
const output = await build({ stdin: { contents: 'export { ProjectNavigator, ProjectOverview } from "./src/client/ProjectNavigator.tsx"; export { GuidePanel } from "./src/client/GuidePanel.tsx"; export { SourcePanel } from "./src/client/SourcePanel.tsx";', resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'tsx' }, bundle: true, format: 'cjs', platform: 'node', jsx: 'automatic', external: ['react', 'react/*'], write: false });
vm.runInNewContext(output.outputFiles[0].text, { module: componentModule, exports: componentModule.exports, require: createRequire(import.meta.url), console, setTimeout, clearTimeout });
const { ProjectNavigator, ProjectOverview, GuidePanel, SourcePanel } = componentModule.exports;
const loc = { file: 'src/feature/file-0.ts', start: 0, end: 1, startLine: 900, startColumn: 1, endLine: 905, endColumn: 1, fileHash: 'hash' };
const files = Array.from({ length: 1000 }, (_, i) => ({ id: `file:${i}`, name: `src/feature/file-${i}.ts`, file: `src/feature/file-${i}.ts`, kind: 'file', exported: false, location: loc }));
const symbol = { ...files[0], id: 'function:run', kind: 'function', name: 'run', qualifiedName: 'Host.run', location: loc };
function controller(extra = {}) {
  let state = { sessions: [], sessionId: 's', query: '', busy: false, sourceOpen: false, view: { snapshot: { id: 'snap', root: '/project', nodes: [...files, symbol], relations: [], diagnostics: [] }, labels: {}, selectedId: files[0].id, readIds: [], graph: { nodeIds: [], relationIds: [] } }, ...extra };
  const listeners = new Set(); const calls = [];
  return { calls, getSnapshot: () => state, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    setQuery(query) { state = { ...state, query }; for (const fn of listeners) fn(); },
    selectNode(...args) { calls.push(args); return Promise.resolve(); }, setSourceOpen() {}, changeGraphKind() {} };
}
test('large project navigation renders only the first file page and search can reach a later file', async () => {
  const c = controller(); let tree;
  await act(async () => { tree = Renderer.create(React.createElement(ProjectNavigator, { controller: c })); });
  const headings = () => tree.root.findAllByProps({ className: 'ca-file-heading' });
  assert.equal(headings().length, 50);
  await act(async () => { tree.root.findByProps({ 'aria-label': '搜索文件、类、接口、函数' }).props.onChange({ target: { value: 'file-999' } }); });
  assert.equal(headings().length, 1);
  assert.match(JSON.stringify(tree.toJSON()), /file-999.ts/);
  await act(async () => { tree.root.findByProps({ 'aria-label': '搜索文件、类、接口、函数' }).props.onChange({ target: { value: 'Host.run' } }); });
  assert.equal(headings().length, 1);
  assert.equal(tree.root.findAllByProps({ className: 'ca-symbol ' }).length, 1);
  await act(async () => tree.unmount());
});
test('module overview defers file buttons until expanded and then pages them', async () => {
  const c = controller(); let tree;
  await act(async () => { tree = Renderer.create(React.createElement(ProjectOverview, { controller: c })); });
  const buttons = () => tree.root.findAll(node => node.type === 'button' && node.props.title?.startsWith('src/feature/'));
  assert.equal(buttons().length, 0);
  await act(async () => tree.root.findByProps({ className: 'ca-module' }).props.onToggle({ currentTarget: { open: true } }));
  assert.equal(buttons().length, 50);
  await act(async () => tree.root.findAllByType('button').find(node => node.children.includes('再显示 50 个文件')).props.onClick());
  assert.equal(buttons().length, 100);
  await act(async () => tree.unmount());
});
test('long source renders a bounded context around the selected symbol with accurate line numbers', async () => {
  const c = controller({ source: { node: symbol, snapshotId: 'snap', content: Array.from({ length: 20000 }, (_, i) => `line ${i + 1}`).join('\n') } }); let tree;
  await act(async () => { tree = Renderer.create(React.createElement(SourcePanel, { controller: c, fontSize: 17, onFontSize() {} })); });
  const rows = tree.root.findAll(node => node.props['data-source-line']);
  assert.equal(rows.length, 180); assert(rows.some(node => node.props['data-source-line'] === 900));
  assert.match(JSON.stringify(tree.toJSON()), /line 900/); assert(!JSON.stringify(tree.toJSON()).includes('line 20000'));
  await act(async () => tree.unmount());
});
test('model guide presents bounded scope and opens actual source rather than embedding executable model markup', async () => {
  const c = controller(); const state = c.getSnapshot(); state.view.guide = { title: '<script>model text</script>', snapshotId: 'snap', origin: 'model', scope: { providedSymbols: 1, totalSymbols: 1000 }, summary: 'A reading suggestion', steps: [{ id: 'a', title: 'Read entry', explanation: 'Interpretation', nodeIds: [symbol.id], next: [], checks: ['Confirm errors'] }], risks: ['Not executed'] }; let tree;
  await act(async () => { tree = Renderer.create(React.createElement(GuidePanel, { controller: c })); });
  assert.equal(tree.root.findAllByType('script').length, 0);
  const link = tree.root.findByProps({ className: 'ca-source-links' }).findByType('button');
  await act(async () => link.props.onClick()); assert.equal(c.calls[0][0], symbol.id); assert.equal(c.calls[0][1].pane, 'guide'); assert.equal(c.calls[0][1].revealSource, true);
  assert.match(JSON.stringify(tree.toJSON()), /1000/);
  await act(async () => tree.unmount());
});
