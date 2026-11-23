import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';

const edit = (f, operation, args, id) => f.run('svg_edit', { operation, args }, id);
const ok = result => { assert.equal(result.isError, false, JSON.stringify(result)); return result.value; };
const failed = (result, code, message) => {
  assert.equal(result.isError, true, JSON.stringify(result));
  if (code) assert.equal(result.error.info.code, code);
  if (message) assert.match(result.content.map(block => block.text ?? '').join('\n'), message);
};

async function withEditor(t) {
  const f = await fixture();
  t.after(f.dispose);
  ok(await f.run('svg_create'));
  return f;
}

test('real Cordis + DSH Tools + Native executor register seven model-visible tools and unload them', async t => {
  const f = await fixture(); t.after(f.dispose);
  const names = ['svg_create', 'svg_open', 'svg_inspect', 'svg_edit', 'svg_history', 'svg_export', 'svg_close'];
  assert.deepEqual(f.ctx.tools.schemas().map(tool => tool.name), names);
  const prompt = await f.ctx.systemPrompt.assemble();
  assert.deepEqual(prompt.tools.map(tool => tool.name).sort(), [...names].sort());
  assert.ok(f.ctx.tools.schemas().every(tool => !('execute' in tool)));
  await f.fiber.dispose();
  assert.equal(f.ctx.tools.schemas().length, 0);
  failed(await f.run('svg_create'), 'UNKNOWN_TOOL');
});

test('tools fail explicitly without an Agent instead of sharing a global canvas', async t => {
  const f = await fixture(); t.after(f.dispose);
  failed(await f.run('svg_create', {}, null), 'SVG_SESSION_REQUIRED');
  failed(await f.run('svg_close', {}, null), 'SVG_SESSION_REQUIRED');
});

test('official tool schema rejects malformed operations and non-string arguments before model edits', async t => {
  const f = await withEditor(t);
  const before = ok(await f.run('svg_inspect'));
  failed(await f.run('svg_edit', { operation: 'read', args: ['/private/file'] }), 'INVALID_ARGS');
  failed(await f.run('svg_edit', { operation: 'create', args: ['rect', 'x', 0] }), 'INVALID_ARGS');
  failed(await f.run('svg_create', { width: 'wide' }), 'INVALID_ARGS');
  assert.deepEqual(ok(await f.run('svg_inspect')), before);
});

test('create/edit/undo/redo reuse box semantics and local history through the real DSH pipeline', async t => {
  const f = await withEditor(t);
  assert.match(ok(await edit(f, 'create', ['box', 'n1', '120', '100', '160', '60', '开始'])).tree, /g#n1 \(box\) \*/);
  const before = ok(await f.run('svg_export'));
  const changed = ok(await edit(f, 'set', ['n1', 'label', '人工审批']));
  assert.equal(changed.undoCount, 2);
  assert.match(changed.tree, /人工审批/);
  ok(await f.run('svg_history', { action: 'undo' }));
  assert.equal(ok(await f.run('svg_export')).svg, before.svg);
  ok(await f.run('svg_history', { action: 'redo' }));
  assert.match(ok(await f.run('svg_export')).svg, /人工审批/);
  ok(await edit(f, 'set', ['n1', 'fill', '#f5a623']));
  assert.match(ok(await f.run('svg_export')).svg, /fill="#f5a623"/);
});

test('inspect returns actual attributes to both canonical data and model-facing content', async t => {
  const f = await withEditor(t);
  ok(await edit(f, 'create', ['rect', 'r', '1', '2', '30', '40', 'red']));
  const result = await f.run('svg_inspect', { id: 'r' });
  assert.match(ok(result).details, /fill=red/);
  assert.match(result.content[0].text, /fill=red/);
});

test('invalid domain edits and protected box component operations preserve document, revision and redo', async t => {
  const f = await withEditor(t);
  ok(await edit(f, 'create', ['box', 'n1', '0', '0', '160', '60', 'n1']));
  ok(await edit(f, 'move', ['n1', '10', '0']));
  ok(await f.run('svg_history', { action: 'undo' }));
  const before = ok(await f.run('svg_export'));
  for (const [operation, args, pattern] of [
    ['create', ['rect', 'n1-rect', '0', '0', '1', '1'], /id already exists/],
    ['set', ['n1-rect', 'label', 'bad'], /unknown attribute/],
    ['delete', ['n1-rect'], /required component/],
    ['ungroup', ['n1'], /composite shape/],
    ['move', ['missing', '1', '2'], /no such shape/],
    ['scale', ['n1', '0'], /positive/],
  ]) {
    failed(await edit(f, operation, args), 'SVG_EDIT_FAILED', pattern);
    assert.deepEqual(ok(await f.run('svg_export')), before);
  }
  ok(await f.run('svg_history', { action: 'redo' }));
  assert.match(ok(await f.run('svg_export')).svg, /x="10"/);
});

test('two Agent sessions keep their document and undo histories isolated', async t => {
  const f = await withEditor(t);
  ok(await edit(f, 'create', ['text', 'label', '1', '2', 'A']));
  ok(await f.run('svg_create', { width: 500, height: 400 }, 'conversation-b'));
  ok(await edit(f, 'create', ['text', 'label', '1', '2', 'B'], 'conversation-b'));
  assert.match(ok(await f.run('svg_export')).svg, />A<\/text>/);
  assert.match(ok(await f.run('svg_export', {}, 'conversation-b')).svg, />B<\/text>/);
  ok(await f.run('svg_history', { action: 'undo' }));
  assert.equal(ok(await f.run('svg_inspect')).elements, 0);
  assert.equal(ok(await f.run('svg_inspect', {}, 'conversation-b')).elements, 1);
});

test('same-session concurrent calls are serialized in admission order', async t => {
  const f = await withEditor(t);
  const results = await Promise.all([
    edit(f, 'create', ['rect', 'r', '0', '0', '10', '10']),
    edit(f, 'move', ['r', '5', '0']),
    edit(f, 'move', ['r', '7', '0']),
  ]);
  results.forEach(ok);
  const value = ok(await f.run('svg_export'));
  assert.match(value.svg, /x="12"/);
  assert.equal(value.undoCount, 3);
  assert.equal(value.revision, 4);
});

test('export and inspect preserve undo/redo and do not create a save barrier', async t => {
  const f = await withEditor(t);
  ok(await edit(f, 'create', ['rect', 'r', '0', '0', '10', '10']));
  ok(await edit(f, 'move', ['r', '5', '0']));
  ok(await f.run('svg_history', { action: 'undo' }));
  const before = ok(await f.run('svg_export'));
  for (let index = 0; index < 3; index++) {
    assert.deepEqual(ok(await f.run('svg_export')), before);
    assert.equal(ok(await f.run('svg_inspect')).revision, before.revision);
  }
  ok(await f.run('svg_history', { action: 'redo' }));
  assert.match(ok(await f.run('svg_export')).svg, /x="5"/);
});

test('open accepts generated SVG including box, then invalid or duplicate-id XML leaves session intact', async t => {
  const f = await withEditor(t);
  ok(await edit(f, 'create', ['box', 'n1', '0', '0', '100', '60', '中文 & < >']));
  const exported = ok(await f.run('svg_export'));
  ok(await f.run('svg_create', {}, 'conversation-b'));
  ok(await f.run('svg_open', { svg: exported.svg }, 'conversation-b'));
  const reopened = ok(await f.run('svg_export', {}, 'conversation-b'));
  assert.match(reopened.svg, /data-kind="box"/);
  assert.match(reopened.svg, /中文 &amp; &lt; &gt;/);
  assert.equal(reopened.elements, 3);
  const clean = ok(await f.run('svg_inspect', {}, 'conversation-b'));
  assert.doesNotMatch(clean.tree, / \*$/m);
  for (const svg of ['<svg><g>', '<svg><rect id="x"/><circle id="x"/></svg>', '<svg><g id="n1" data-kind="box"/></svg>']) {
    failed(await f.run('svg_open', { svg }, 'conversation-b'), 'SVG_EDIT_FAILED');
    assert.deepEqual(ok(await f.run('svg_inspect', {}, 'conversation-b')), clean);
  }
});

test('text is passed directly as arguments and never interpreted as a shell or CLI line', async t => {
  const f = await withEditor(t);
  const text = '中文 "in"\n$(touch /tmp/not-executed) <script>alert(1)</script>';
  ok(await edit(f, 'create', ['text', 't', '1', '2', text]));
  const result = await f.run('svg_export');
  assert.match(ok(result).svg, /&lt;script&gt;/);
  assert.ok(result.content.every(block => block.type === 'text'));
  assert.ok(f.ctx.tools.get('svg_export').presentCall({}).card === 'generic');
});

test('agent disposal and explicit close remove only that conversation; plugin reload starts empty', async t => {
  const f = await withEditor(t);
  ok(await edit(f, 'create', ['g', 'a']));
  ok(await f.run('svg_create', {}, 'conversation-b'));
  f.ctx.emit('agent/disposed', { agent: f.agent('conversation-a') });
  failed(await f.run('svg_inspect'), 'SVG_EDIT_FAILED', /no document/);
  assert.equal(ok(await f.run('svg_inspect', {}, 'conversation-b')).elements, 0);
  ok(await f.run('svg_close', {}, 'conversation-b'));
  failed(await f.run('svg_inspect', {}, 'conversation-b'), 'SVG_EDIT_FAILED', /no document/);
  await f.fiber.dispose();
  const plugin = await import('../lib/index.js');
  const second = f.ctx.plugin(plugin); await second;
  failed(await f.run('svg_inspect'), 'SVG_EDIT_FAILED', /no document/);
});

test('pre-aborted calls and invalid numeric dimensions leave an existing document intact', async t => {
  const f = await withEditor(t);
  ok(await edit(f, 'create', ['g', 'g']));
  const before = ok(await f.run('svg_export'));
  const controller = new AbortController(); controller.abort();
  const aborted = await f.run('svg_create', {}, 'conversation-a', controller.signal);
  assert.equal(aborted.isError, true);
  assert.match(aborted.error.info.code, /ABORTED/);
  failed(await f.run('svg_create', { width: -1, height: 20 }), 'SVG_EDIT_FAILED');
  assert.deepEqual(ok(await f.run('svg_export')), before);
});

test('large inputs are rejected before changing the active document or history', async t => {
  const f = await withEditor(t);
  const before = ok(await f.run('svg_export'));
  failed(await f.run('svg_open', { svg: 'x'.repeat(1_000_001) }), 'SVG_INPUT_LIMIT');
  failed(await edit(f, 'create', ['text', 't', '1', '2', 'x'.repeat(10_001)]), 'SVG_INPUT_LIMIT');
  assert.deepEqual(ok(await f.run('svg_export')), before);
});
