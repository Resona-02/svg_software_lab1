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

test('methods named in a task are read before numerous nearby callbacks consume the context budget', async () => {
  const files = [
    { path: 'entry.ts', content: `declare function register(callback: () => void): void; export class Entry { run() { ${'register(() => {});'.repeat(35)} } }` },
    { path: 'executor.ts', content: 'export class CommandExecutor { executeCommand() { return "history"; } }' },
    { path: 'command.ts', content: 'export class CreateCommand { execute() { return "create"; } }' },
    { path: 'contract.ts', content: 'export interface Command { execute(): string; }' },
  ].map(file => ({ ...file, hash: hash(file.content) }));
  const source = { async snapshot(root) { return { root, files }; }, async read(root, path) { return files.find(file => file.path === path); } };
  const workbench = new AtlasWorkbench(source, new TypeScriptLanguageProvider());
  const view = await workbench.scan('s', '/project');
  await workbench.inspect('s', view.snapshot.nodes.find(node => node.qualifiedName === 'Entry.run').id);
  const context = await workbench.reviewContext('s', '从 CreateCommand.execute 查看创建，确认 CommandExecutor.executeCommand 何时登记历史');
  assert.deepEqual(context.symbols.slice(0, 3).map(item => item.node.qualifiedName), ['Entry.run', 'CreateCommand.execute', 'CommandExecutor.executeCommand']);
  assert(context.symbols.some(item => item.source.includes('return "history"')));
  assert(!context.symbols.some(item => item.node.qualifiedName === 'Command.execute'), 'CreateCommand.execute must not count as an explicit request for Command.execute');
  assert(context.symbols.length <= 24);
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

test('scan comparisons use consecutive successful session scans and reset across workspaces', async () => {
  const files = new Map([['main.ts', 'export function main() { return 1; }'], ['removed.ts', 'export function removed() {}']]);
  let failure = false;
  const source = { async snapshot(root) { if (failure) throw new Error('scan failed'); return { root, files: [...files].map(([path, content]) => ({ path, content, hash: hash(content) })) }; }, async read(root, path) { const content = files.get(path); return { path, content, hash: hash(content) }; } };
  const workbench = new AtlasWorkbench(source, new TypeScriptLanguageProvider());
  const first = await workbench.scan('s', '/project');
  assert.deepEqual(first.changes, { baselineAvailable: false, added: [], modified: [], deleted: [] });
  await assert.rejects(workbench.reviewContext('s', '核验变更', undefined, 'change-review'), error => error.code === 'CHANGE_BASELINE_REQUIRED');
  const same = await workbench.scan('s', '/project');
  assert.equal(same.changes.baselineAvailable, true);
  await assert.rejects(workbench.reviewContext('s', '核验变更', undefined, 'change-review'), error => error.code === 'NO_SOURCE_CHANGES');
  files.set('main.ts', 'export function main() { return 2; }'); files.delete('removed.ts'); files.set('new.ts', 'export function added() { return 3; }');
  const changed = await workbench.scan('s', '/project');
  assert.deepEqual(changed.changes, { baselineAvailable: true, baselineSnapshotId: same.snapshot.id, added: ['new.ts'], modified: ['main.ts'], deleted: ['removed.ts'] });
  const context = await workbench.reviewContext('s', '核验变更', undefined, 'change-review');
  assert.equal(context.intent, 'change-review'); assert.deepEqual(context.changes, changed.changes);
  assert(!context.symbols.some(item => item.node.file === 'removed.ts'));
  files.set('main.ts', 'export function main() { return 4; }'); failure = true;
  await assert.rejects(workbench.scan('s', '/project'), /scan failed/);
  assert.equal(workbench.view('s').snapshot.id, changed.snapshot.id); assert.deepEqual(workbench.view('s').changes, changed.changes);
  failure = false; const recovered = await workbench.scan('s', '/project');
  assert.equal(recovered.changes.baselineSnapshotId, changed.snapshot.id); assert.deepEqual(recovered.changes.modified, ['main.ts']);
  assert.equal((await workbench.scan('other', '/project')).changes.baselineAvailable, false);
  assert.equal((await workbench.scan('s', '/another-project')).changes.baselineAvailable, false);
  workbench.dispose();
});

test('change-review reads changed implementations ahead of the unchanged selected module and never reads deleted paths', async () => {
  const files = new Map([['main.ts', Array.from({ length: 40 }, (_, i) => `export function noise${i}() { return ${i}; }`).join('\n')], ['changed.ts', 'export function relevant() { return 1; }'], ['gone.ts', 'export function gone() {}']]);
  const reads = [];
  const source = { async snapshot(root) { return { root, files: [...files].map(([path, content]) => ({ path, content, hash: hash(content) })) }; }, async read(root, path) { reads.push(path); assert(files.has(path), 'deleted paths must not be read'); const content = files.get(path); return { path, content, hash: hash(content) }; } };
  const workbench = new AtlasWorkbench(source, new TypeScriptLanguageProvider());
  let view = await workbench.scan('s', '/project'); await workbench.inspect('s', view.snapshot.nodes.find(node => node.name === 'noise0').id);
  files.set('changed.ts', 'export function relevant() { return 2; }'); files.delete('gone.ts');
  await workbench.scan('s', '/project'); reads.length = 0;
  const context = await workbench.reviewContext('s', '核验本次修改', undefined, 'change-review');
  assert.equal(context.symbols[0].node.file, 'changed.ts');
  assert(!context.symbols.some(item => item.node.name.startsWith('noise')));
  assert(!reads.includes('gone.ts'));
  assert.deepEqual(context.changes.deleted, ['gone.ts']);
  // A subsequent deletion-only scan still describes the deletion and uses only surviving code.
  files.delete('changed.ts'); await workbench.scan('s', '/project'); reads.length = 0;
  const deletion = await workbench.reviewContext('s', '核验删除的影响', undefined, 'change-review');
  assert.deepEqual(deletion.changes.deleted, ['changed.ts']); assert(!reads.includes('changed.ts'));
  assert(deletion.symbols.every(item => item.node.file === 'main.ts'));
  workbench.dispose();
});

test('intent-specific model instructions distinguish design, safe refactoring and hash-based change review', async () => {
  const { workbench, context, draft } = await fixture(); const requests = [];
  const provider = new DshGuideProvider({ async *stream(request) { requests.push(request); yield { type: 'text-delta', index: 0, text: JSON.stringify({ ...draft, intent: 'flow' }) }; yield { type: 'finish', reason: { kind: 'stop' } }; } }, { currentSelection: () => ({ provider: 'fixture', model: 'no-network' }) });
  for (const intent of ['flow', 'design', 'refactor', 'change-review']) await provider.generate({ ...context, intent });
  assert.match(requests[0].system, /输入、关键处理、状态变化/);
  assert.match(requests[1].system, /保持简单\/不引入模式/); assert.match(requests[1].system, /Decorator/); assert.match(requests[1].system, /Observer/);
  assert.match(requests[2].system, /行为不变量/); assert.match(requests[2].system, /回滚方式/); assert.match(requests[2].system, /不声称已经修改文件/);
  assert.match(requests[3].system, /不是 Git diff/); assert.match(requests[3].system, /上一版正文/);
  const view = await workbench.publishGuide('s', context.snapshotId, { ...draft, intent: 'flow' }, new Set(context.symbols.map(item => item.node.id)), undefined, 'design');
  assert.equal(view.guide.intent, 'design', 'model output cannot override the trusted request intent');
  workbench.dispose();
});

test('a change-review cannot be published for an old comparison even if the current source hash stays unchanged', async () => {
  const { workbench, files, draft } = await fixture();
  files.set('main.ts', files.get('main.ts') + '\n// changed');
  await workbench.scan('s', '/project');
  const context = await workbench.reviewContext('s', '核验修改', undefined, 'change-review');
  const allowed = new Set(context.symbols.map(item => item.node.id));
  await workbench.publishGuide('s', context.snapshotId, draft, allowed, undefined, 'change-review', context.changes);
  assert.equal(workbench.view('s').guide.intent, 'change-review');
  const refreshed = await workbench.scan('s', '/project');
  assert.equal(refreshed.snapshot.id, context.snapshotId);
  assert.equal(refreshed.guide, undefined);
  await assert.rejects(workbench.verifyContext('s', context), error => error.code === 'STALE_SOURCE');
  await assert.rejects(workbench.publishGuide('s', context.snapshotId, draft, allowed, undefined, 'change-review', context.changes), error => error.code === 'STALE_SOURCE');
  workbench.dispose();
});

test('changed constants and styles without implementation symbols supply bounded real file fragments; unindexed config stays explicit', async () => {
  const files = new Map([['main.ts', 'export function entry() { return "unrelated"; }'], ['styles.ts', 'export const styles = "old";'], ['tsconfig.json', '{"compilerOptions":{"strict":false}}']]);
  const reads = [];
  const source = { async snapshot(root) { return { root, files: [...files].map(([path, content]) => ({ path, content, hash: hash(content) })) }; }, async read(root, path) { reads.push(path); const content = files.get(path); return { path, content, hash: hash(content) }; } };
  const workbench = new AtlasWorkbench(source, new TypeScriptLanguageProvider());
  await workbench.scan('s', '/project');
  files.set('styles.ts', `export const styles = "${'x'.repeat(6500)}";`); files.set('labels.ts', 'export const label = "new";');
  files.set('tsconfig.json', '{"compilerOptions":{"strict":true}}');
  const view = await workbench.scan('s', '/project'); reads.length = 0;
  const context = await workbench.reviewContext('s', '核验本次修改', undefined, 'change-review');
  assert.deepEqual(context.symbols.map(item => item.node.file).sort(), ['labels.ts', 'styles.ts']);
  const styles = context.symbols.find(item => item.node.file === 'styles.ts');
  assert.equal(styles.node.kind, 'file'); assert.equal(styles.node.id, 'file:styles.ts');
  assert.equal(styles.source.length, 5000); assert.equal(styles.sourceTruncated, true);
  assert(context.symbols.length <= 24); assert(context.symbols.reduce((sum, item) => sum + item.source.length, 0) <= 42000); assert(context.omittedSymbols >= 0);
  assert.deepEqual(context.unavailableFiles, ['tsconfig.json']); assert(!reads.includes('main.ts')); assert(!reads.includes('tsconfig.json'));
  const draft = { title: '样式核验', summary: '核对样式常量。', steps: [{ id: 'style', title: '查看样式', explanation: '读取当前文件片段。', nodeIds: [styles.node.id], next: [], checks: ['省略的正文是否还需阅读？'] }], risks: ['配置正文未提供。'] };
  const published = await workbench.publishGuide('s', view.snapshot.id, draft, new Set(context.symbols.map(item => item.node.id)), undefined, 'change-review', context.changes);
  assert.equal(published.guide.intent, 'change-review'); assert(published.guide.scope.totalSymbols >= published.guide.scope.providedSymbols);
  files.set('tsconfig.json', '{"compilerOptions":{"strict":true,"allowJs":true}}'); await workbench.scan('s', '/project');
  await assert.rejects(workbench.reviewContext('s', '核验本次修改', undefined, 'change-review'), error => error.code === 'EMPTY_CONTEXT' && /没有可引用/.test(error.message));
  assert.deepEqual(workbench.view('s').changes.modified, ['tsconfig.json']);
  workbench.dispose();
});
