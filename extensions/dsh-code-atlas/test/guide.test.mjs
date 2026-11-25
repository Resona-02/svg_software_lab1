import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { AtlasWorkbench, validateGuide } from '../lib/core.js';
import { TypeScriptLanguageProvider } from '../lib/analysis.js';
import { DshGuideProvider } from '../lib/index.js';
const hash = source => createHash('sha256').update(source).digest('hex');
async function fixture() {
  const files = new Map([['main.ts', 'export function main(x: number) { if (x > 0) return save(x); throw new Error("bad"); } function save(x: number) { return x; }']]);
  const source = { async snapshot(root) { return { root, files: [...files].map(([path, content]) => ({ path, content, hash: hash(content) })) }; }, async read(root, path) { const content = files.get(path); return { path, content, hash: hash(content) }; } };
  const workbench = new AtlasWorkbench(source, new TypeScriptLanguageProvider());
  const view = await workbench.scan('s', '/project');
  const main = view.snapshot.nodes.find(node => node.name === 'main'); await workbench.inspect('s', main.id);
  const context = await workbench.reviewContext('s', 'main 保存失败');
  const draft = { title: '保存路径', summary: '先校验参数，再保存；不合法输入抛错。', steps: [{ id: 'entry', title: '入口', explanation: '检查 x 后调用 save。', nodeIds: [main.id], next: [], checks: ['失败时是否改变状态？'] }], risks: ['静态分析未执行函数。'] };
  return { workbench, files, view, context, draft };
}
test('task context contains bounded implementation bodies and call sites, and model references stay within the supplied snapshot', async () => {
  const { workbench, context, draft } = await fixture();
  assert(context.symbols.some(item => /if \(x > 0\)/.test(item.source)));
  assert(context.relations.some(edge => edge.kind === 'calls'));
  assert(context.symbols.reduce((sum, item) => sum + item.source.length, 0) <= 42000);
  const view = await workbench.publishGuide('s', context.snapshotId, draft, new Set(context.symbols.map(item => item.node.id)));
  assert.equal(view.guide.origin, 'model');
  assert.throws(() => validateGuide({ ...draft, steps: [{ ...draft.steps[0], nodeIds: ['invented'] }] }, view.snapshot), /INVALID_GUIDE|未提供/);
  assert.throws(() => validateGuide({ ...draft, steps: [{ ...draft.steps[0], next: ['missing'] }] }, view.snapshot), /不存在/);
  assert.throws(() => validateGuide({ ...draft, steps: [draft.steps[0], draft.steps[0]] }, view.snapshot), /重复/);
  workbench.dispose();
});
test('source edits during explanation reject publication; refreshing invalidates old guides atomically', async () => {
  const { workbench, files, context, draft } = await fixture();
  await workbench.publishGuide('s', context.snapshotId, draft);
  files.set('main.ts', files.get('main.ts') + '\n// changed');
  await assert.rejects(workbench.publishGuide('s', context.snapshotId, draft), error => error.code === 'STALE_SOURCE');
  assert.equal(workbench.view('s').guide.title, draft.title);
  await workbench.scan('s', '/project'); assert.equal(workbench.view('s').guide, undefined);
  await assert.rejects(workbench.publishGuide('s', context.snapshotId, draft), error => error.code === 'STALE_SOURCE');
  workbench.dispose();
});
test('native model adapter uses the host-selected route, accumulates text once, and refuses interrupted or invalid results', async () => {
  const { workbench, context, draft } = await fixture();
  let request, invocations = 0;
  const text = JSON.stringify(draft);
  const llm = { async *stream(options) { invocations++; request = options; yield { type: 'text-delta', index: 0, text: text.slice(0, 10) }; yield { type: 'text-delta', index: 0, text: text.slice(10) }; yield { type: 'block-end', index: 0, block: { type: 'text', text } }; yield { type: 'finish', reason: { kind: 'stop' } }; } };
  const provider = new DshGuideProvider(llm, { currentSelection: () => ({ provider: 'configured-provider', model: 'configured-model' }) });
  assert.deepEqual(await provider.generate(context), draft);
  assert.equal(request.model, 'configured-model'); assert.equal(request.provider, 'configured-provider');
  assert(!request.tools); assert.match(request.system, /不能编造/); assert.match(request.messages[0].content[0].text, /main/);
  const errorProvider = new DshGuideProvider({ async *stream() { yield { type: 'finish', reason: { kind: 'error', failure: { message: 'no credentials' } } }; } }, { currentSelection: () => ({ provider: 'p', model: 'm' }) });
  await assert.rejects(errorProvider.generate(context), /no credentials/);
  const interrupted = new DshGuideProvider({ async *stream() { yield { type: 'text-delta', index: 0, text: '{}' }; } }, { currentSelection: () => ({ provider: 'p', model: 'm' }) });
  await assert.rejects(interrupted.generate(context), /中断/);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(provider.generate(context, abort.signal), error => error.name === 'AbortError');
  assert.equal(invocations, 1, 'a pre-cancelled request must not start another model invocation');
  workbench.dispose();
});

test('high-fanout source bounds model relation metadata and reports the omitted positions', async () => {
  const content = `export function main() { ${'save();'.repeat(320)} } function save() { return 1; }`;
  const file = { path: 'main.ts', content, hash: hash(content) };
  const source = { async snapshot(root) { return { root, files: [file] }; }, async read() { return file; } };
  const workbench = new AtlasWorkbench(source, new TypeScriptLanguageProvider());
  const view = await workbench.scan('s', '/project');
  await workbench.inspect('s', view.snapshot.nodes.find(node => node.name === 'main').id);
  const context = await workbench.reviewContext('s', 'read main');
  assert.equal(context.relations.length, 240);
  assert.equal(context.omittedRelations, 80);
  assert(context.symbols.reduce((sum, item) => sum + item.source.length, 0) <= 42000);
  workbench.dispose();
});

test('a top-level entry file follows real call targets before unrelated entry-like names elsewhere', async () => {
  const contents = { 'main.ts': 'import { Host } from "./host.js"; new Host().run();', 'host.ts': 'export class Host { run() { return 1; } }', 'unrelated.ts': 'export function execute() { return "unrelated"; }' };
  const source = { async snapshot(root) { return { root, files: Object.entries(contents).map(([path, content]) => ({ path, content, hash: hash(content) })) }; }, async read(root, path) { return { path, content: contents[path], hash: hash(contents[path]) }; } };
  const workbench = new AtlasWorkbench(source, new TypeScriptLanguageProvider());
  await workbench.scan('s', '/project'); await workbench.inspect('s', 'file:main.ts');
  const context = await workbench.reviewContext('s', '梳理入口');
  assert(context.symbols.some(item => item.node.name === 'run' && item.node.file === 'host.ts'));
  assert(!context.symbols.some(item => item.node.file === 'unrelated.ts'));
  workbench.dispose();
});
