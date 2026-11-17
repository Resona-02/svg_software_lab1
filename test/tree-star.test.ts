import assert from 'node:assert/strict';
import test from 'node:test';
import { Group, Rect, SvgDocument, Text, type PluginContext, type Shape, type TreeDecorator } from '../src/api/index.js';
import { BoxPlugin } from '../plugins/shape-box/BoxPlugin.js';
import treeStarPlugin, { manifest } from '../plugins/tree-star/index.js';
import { ModifiedStar } from '../plugins/tree-star/ModifiedStar.js';
import { TreeStarPlugin } from '../plugins/tree-star/TreeStarPlugin.js';
import { CommandDispatcher } from '../src/cli/CommandDispatcher.js';
import { CommandFactory } from '../src/cli/CommandFactory.js';
import { EditorSession, SvgCodec, TestExtensions } from './helpers/TestRuntime.js';
import { MemoryDocumentStore } from './helpers/MemoryDocumentStore.js';

class DecoratorContext implements PluginContext {
  readonly decorators: TreeDecorator[] = [];
  registerDecorator(value: TreeDecorator): void { this.decorators.push(value); }
  registerShape(): void { assert.fail('unexpected shape registration'); }
  registerCommand(): void { assert.fail('unexpected command registration'); }
  registerAttribute(): void { assert.fail('unexpected attribute registration'); }
}

function mark(decorator: TreeDecorator, document: SvgDocument, saved: SvgDocument | undefined, shape: Shape = document.root): string {
  return decorator.decorate({ shape, isRoot: shape === document.root, document, saved });
}

function dirtyIds(decorator: TreeDecorator, document: SvgDocument, saved: SvgDocument | undefined): string[] {
  return document.allShapes().filter(shape => mark(decorator, document, saved, shape) === '*').map(shape => shape.id);
}

function documentFixture(): SvgDocument {
  const document = new SvgDocument(400, 300);
  document.add(new Group('scene'));
  document.add(new Group('nested'), 'scene');
  document.add(new Rect('r', 1, 2, 10, 20), 'nested');
  document.add(new Text('t', 3, 4, 'Title'), 'nested');
  document.add(new Group('destination'), 'scene');
  document.add(new Rect('unrelated', 0, 0, 1, 1));
  return document;
}

function runtime(order: readonly ('box' | 'star')[] = ['box', 'star']) {
  const extensions = new TestExtensions();
  for (const plugin of order) {
    if (plugin === 'box') new BoxPlugin().activate(extensions);
    else new TreeStarPlugin().activate(extensions);
  }
  const store = new MemoryDocumentStore();
  const session = new EditorSession(store, extensions);
  const cli = new CommandDispatcher(new CommandFactory(session), session.executor);
  return { extensions, store, session, cli };
}

async function run(cli: CommandDispatcher, ...lines: string[]): Promise<void> {
  for (const line of lines) assert.doesNotMatch(await cli.execute(line), /^error:/, line);
}

test('tree-star independently registers a fresh class instance on every activation', () => {
  const first = new DecoratorContext();
  const second = new DecoratorContext();
  treeStarPlugin.activate(first);
  treeStarPlugin.activate(second);
  assert.equal(first.decorators.length, 1);
  assert.equal(second.decorators.length, 1);
  assert.ok(first.decorators[0] instanceof ModifiedStar);
  assert.ok(second.decorators[0] instanceof ModifiedStar);
  assert.notEqual(first.decorators[0], second.decorators[0]);
  assert.deepEqual(manifest.contributes, { decorators: first.decorators.map(decorator => decorator.name) });
});

test('undefined save baseline immediately marks root, containers, and leaves including a new document', () => {
  const decorator = new ModifiedStar();
  const document = documentFixture();
  assert.equal(mark(decorator, document, undefined), '*');
  assert.deepEqual(dirtyIds(decorator, document, undefined), document.allShapes().map(shape => shape.id));
  assert.equal(mark(decorator, document, document.clone()), '');
  assert.equal(mark(decorator, document, undefined), '*');
  const empty = new SvgDocument();
  assert.equal(mark(decorator, empty, undefined), '*');
  assert.equal(mark(decorator, empty, empty.clone()), '');
});

test('standalone content comparison removes stars on undo to the saved state and restores them on redo', () => {
  const document = documentFixture();
  const decorator = new ModifiedStar();
  const saved = document.clone();
  const rectangle = document.find('r');
  const restore = rectangle.rememberAttribute('fill');
  assert.equal(mark(decorator, document, saved), '');
  assert.deepEqual(dirtyIds(decorator, document, saved), []);
  rectangle.setAttribute('fill', 'orange');
  assert.equal(mark(decorator, document, saved), '*');
  assert.deepEqual(dirtyIds(decorator, document, saved), ['scene', 'nested', 'r']);
  restore();
  assert.equal(mark(decorator, document, saved), '');
  assert.deepEqual(dirtyIds(decorator, document, saved), []);
  rectangle.setAttribute('fill', 'orange');
  assert.deepEqual(dirtyIds(decorator, document, saved), ['scene', 'nested', 'r']);
  const nextSaved = document.clone();
  assert.equal(mark(decorator, document, nextSaved), '');
  assert.deepEqual(dirtyIds(decorator, document, nextSaved), []);
  rectangle.setAttribute('fill', 'orange');
  assert.equal(mark(decorator, document, nextSaved), '');
});

test('deletion and addition mark surviving ancestors without marking unrelated siblings', () => {
  const document = documentFixture();
  const saved = document.clone();
  const decorator = new ModifiedStar();
  const removed = document.find('r');
  const parent = removed.parent!;
  document.delete('r');
  assert.equal(mark(decorator, document, saved), '*');
  assert.deepEqual(dirtyIds(decorator, document, saved), ['scene', 'nested']);
  parent.insert(removed, 0);
  assert.equal(mark(decorator, document, saved), '');
  document.add(new Text('added', 0, 0, 'New'), 'nested');
  assert.deepEqual(dirtyIds(decorator, document, saved), ['scene', 'nested', 'added']);
  document.delete('added');
  assert.deepEqual(dirtyIds(decorator, document, saved), []);
});

test('geometry movement marks descendant leaves and ancestors and restoring geometry clears the marks', () => {
  const document = documentFixture();
  const saved = document.clone();
  const decorator = new ModifiedStar();
  const nested = document.find('nested');
  const restore = nested.rememberPosition();
  nested.move(5, -2);
  assert.equal(mark(decorator, document, saved), '*');
  assert.deepEqual(dirtyIds(decorator, document, saved), ['scene', 'nested', 'r', 't']);
  restore();
  assert.equal(mark(decorator, document, saved), '');
  assert.deepEqual(dirtyIds(decorator, document, saved), []);
});

test('reparenting marks the moved node and both ancestors while ordering marks containers only', () => {
  const document = documentFixture();
  const saved = document.clone();
  const decorator = new ModifiedStar();
  document.addTo('destination', 'r');
  assert.equal(mark(decorator, document, saved), '*');
  assert.deepEqual(dirtyIds(decorator, document, saved), ['scene', 'nested', 'destination', 'r']);
  document.findContainer('nested').insert(document.find('r'), 0);
  assert.deepEqual(dirtyIds(decorator, document, saved), []);
  document.front('r');
  assert.deepEqual(document.find('nested').children.map(shape => shape.id), ['t', 'r']);
  assert.equal(mark(decorator, document, saved), '*');
  assert.deepEqual(dirtyIds(decorator, document, saved), ['scene', 'nested']);
  document.back('r');
  assert.equal(mark(decorator, document, saved), '');
});

test('canvas changes mark only the root and canvas restoration returns to the saved state', () => {
  const document = documentFixture();
  const saved = document.clone();
  const decorator = new ModifiedStar();
  document.resize(800, 600);
  assert.equal(mark(decorator, document, saved), '*');
  assert.deepEqual(dirtyIds(decorator, document, saved), []);
  document.resize(saved.width, saved.height);
  assert.equal(mark(decorator, document, saved), '');
});

test('two decorator instances keep independent baselines even with identical shape ids', () => {
  const first = documentFixture();
  const second = documentFixture();
  second.find('r').setAttribute('fill', 'blue');
  const firstSaved = first.clone();
  const secondSaved = second.clone();
  const a = new ModifiedStar();
  const b = new ModifiedStar();
  assert.equal(mark(a, first, firstSaved), '');
  assert.equal(mark(b, second, secondSaved), '');
  first.find('r').setAttribute('fill', 'red');
  assert.equal(mark(a, first, firstSaved), '*');
  assert.equal(mark(b, second, secondSaved), '');
  second.find('t').setAttribute('text', 'Changed');
  const replacement = first.clone();
  assert.equal(mark(a, first, replacement), '');
  assert.deepEqual(dirtyIds(b, second, secondSaved), ['scene', 'nested', 't']);
  assert.equal(mark(a, new SvgDocument(), undefined), '*');
  assert.deepEqual(dirtyIds(b, second, secondSaved), ['scene', 'nested', 't']);
});

test('a user container named __svg_root__ stays distinct from the implicit SVG root', () => {
  const document = new SvgDocument();
  const named = new Group('__svg_root__');
  named.insert(new Rect('r', 0, 0, 1, 1));
  document.add(named);
  const saved = document.clone();
  const decorator = new ModifiedStar();
  assert.equal(mark(decorator, document, saved), '');
  assert.equal(mark(decorator, document, saved, named), '');
  document.resize(900, 600);
  assert.equal(mark(decorator, document, saved), '*');
  assert.equal(mark(decorator, document, saved, named), '');
  document.resize(800, 600);
  const rectangle = document.find('r');
  document.root.insert(rectangle);
  assert.equal(mark(decorator, document, saved), '*');
  assert.equal(mark(decorator, document, saved, named), '*');
  assert.equal(mark(decorator, document, saved, rectangle), '*');
  named.insert(rectangle);
  assert.equal(mark(decorator, document, saved), '');
  assert.equal(mark(decorator, document, saved, named), '');
});

test('box and star labels coexist in plugin registration order without extra spaces', async t => {
  for (const order of [['box', 'star'], ['star', 'box']] as const) {
    await t.test(order.join(', '), async () => {
      const { cli } = runtime(order);
      await run(cli, 'init', 'create box b 0 0 100 50 "Title"');
      const expected = order[0] === 'box' ? 'g#b (box) *' : 'g#b * (box)';
      const lines = (await cli.execute('tree')).split('\n');
      assert.equal(lines[0], 'svg (800x600) *');
      assert.equal(lines[1], `└── ${expected}`);
      assert.equal(lines.filter(line => line.includes('(box)')).length, 1);
      assert.equal((await cli.execute('tree b')).split('\n')[0], expected);
      await run(cli, 'save box.svg');
      assert.equal((await cli.execute('tree b')).split('\n')[0], 'g#b (box)');
      assert.doesNotMatch(await cli.execute('tree'), /\*/);
    });
  }
});

test('CLI edit, save, edit, undo, and redo use content equality with the successful save baseline', async () => {
  const { cli, session } = runtime();
  await run(cli, 'init', 'create g scene', 'create box b 0 0 100 50 "Title" in scene', 'set b fill red');
  assert.match(await cli.execute('tree'), /g#b \(box\) \*/);
  assert.equal(session.saved, undefined);
  await run(cli, 'save baseline.svg');
  const saved = session.saved;
  const clean = await cli.execute('tree');
  assert.doesNotMatch(clean, /\*/);
  await run(cli, 'set b label "Changed"');
  const dirty = await cli.execute('tree');
  assert.match(dirty, /^svg \(800x600\) \*$/m);
  assert.match(dirty, /g#scene \*$/m);
  assert.match(dirty, /g#b \(box\) \*$/m);
  assert.match(dirty, /text#b-label .*"Changed" \*$/m);
  assert.doesNotMatch(dirty.split('\n').find(line => line.includes('rect#b-rect'))!, /\*$/);
  assert.deepEqual([session.history.undoCount, session.history.redoCount], [1, 0]);
  await run(cli, 'undo');
  assert.equal(await cli.execute('tree'), clean);
  assert.equal(session.saved, saved);
  await run(cli, 'redo');
  assert.equal(await cli.execute('tree'), dirty);
  assert.equal(session.saved, saved);
  assert.deepEqual([session.history.undoCount, session.history.redoCount], [1, 0]);
});

test('successful read and save replace the baseline and clear stars; init starts an unsaved baseline', async () => {
  const { cli, session, store } = runtime();
  await run(cli, 'init', 'create box b 0 0 100 50 "Title"', 'save source.svg');
  const firstSaved = session.saved;
  await run(cli, 'move b 3 4');
  assert.match(await cli.execute('tree'), /\*/);
  await run(cli, 'read source.svg');
  assert.notEqual(session.saved, firstSaved);
  assert.doesNotMatch(await cli.execute('tree'), /\*/);
  assert.equal(session.document.find('b-rect').attributes().x, '0');
  await run(cli, 'set b label "Saved title"');
  const readSaved = session.saved;
  assert.match(await cli.execute('tree'), /\*/);
  await run(cli, 'save second.svg');
  assert.notEqual(session.saved, readSaved);
  assert.doesNotMatch(await cli.execute('tree'), /\*/);
  assert.equal((await store.read('second.svg')).document.find('b-label').text, 'Saved title');
  await run(cli, 'init');
  assert.equal(session.saved, undefined);
  assert.equal(await cli.execute('tree'), 'svg (800x600) *');
});

test('failed save and read keep the original baseline, current content, history, and stars', async () => {
  const { cli, session, store } = runtime();
  await run(cli, 'init', 'create box b 0 0 100 50 "Title"', 'save baseline.svg',
    'move b 3 4', 'set b label "Pending"', 'undo');
  const saved = session.saved;
  const document = session.document;
  const codec = new SvgCodec();
  const savedXml = codec.encode(saved!);
  const currentXml = codec.encode(document);
  const dirty = await cli.execute('tree');
  assert.match(dirty, /\*/);
  assert.deepEqual([session.history.undoCount, session.history.redoCount], [1, 1]);
  store.rejectWrites(true);
  assert.equal(await cli.execute('save failed.svg'), 'error: cannot write file: failed.svg');
  assert.equal(await cli.execute('tree'), dirty);
  assert.equal(session.saved, saved);
  assert.equal(codec.encode(session.saved!), savedXml);
  assert.equal(session.document, document);
  assert.equal(codec.encode(session.document), currentXml);
  assert.deepEqual([session.history.undoCount, session.history.redoCount], [1, 1]);
  assert.equal(await cli.execute('read missing.svg'), 'error: cannot read file: missing.svg');
  assert.equal(await cli.execute('tree'), dirty);
  assert.equal(session.saved, saved);
  assert.equal(codec.encode(session.saved!), savedXml);
  assert.equal(session.document, document);
  assert.equal(codec.encode(session.document), currentXml);
  assert.deepEqual([session.history.undoCount, session.history.redoCount], [1, 1]);
  await run(cli, 'redo');
  assert.equal(session.document.find('b-label').text, 'Pending');
  await run(cli, 'undo', 'undo');
  assert.doesNotMatch(await cli.execute('tree'), /\*/);
  store.rejectWrites(false);
  assert.match(await cli.execute('save'), /^saved to baseline\.svg/);
});

test('without tree decorators Phase 1 tree output stays byte-for-byte unchanged', async () => {
  const { cli } = runtime([]);
  await run(cli, 'init', 'create g scene', 'create rect r 1 2 3 4 in scene', 'create text t 5 6 "Hello" in scene');
  const expected = 'svg (800x600)\n└── g#scene\n    ├── rect#r x=1 y=2 w=3 h=4\n    └── text#t (5,6) "Hello"';
  assert.equal(await cli.execute('tree'), expected);
  await run(cli, 'save baseline.svg', 'move r 1 0', 'undo');
  assert.equal(await cli.execute('tree'), expected);
  const boxed = runtime(['box']);
  await run(boxed.cli, 'init', 'create box b 0 0 100 50 "Title"');
  assert.match(await boxed.cli.execute('tree'), /g#b \(box\)$/m);
  assert.doesNotMatch(await boxed.cli.execute('tree'), /\*/);
});
