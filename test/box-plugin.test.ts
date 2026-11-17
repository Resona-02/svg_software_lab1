import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import {
  Circle, Group, Rect, ShapeFactory, SvgDocument, Text,
  type AttributeHandler, type DocumentStore, type PluginContext, type Shape,
  type ShapeProvider, type TreeDecorator,
} from '../src/api/index.js';
import boxPlugin, { manifest } from '../plugins/shape-box/index.js';
import { Box } from '../plugins/shape-box/Box.js';
import { BoxAttributes } from '../plugins/shape-box/BoxAttributes.js';
import { BoxPlugin } from '../plugins/shape-box/BoxPlugin.js';
import { BoxProvider } from '../plugins/shape-box/BoxProvider.js';
import { BoxTypeLabel } from '../plugins/shape-box/BoxTypeLabel.js';
import { CommandDispatcher } from '../src/cli/CommandDispatcher.js';
import { CommandFactory } from '../src/cli/CommandFactory.js';
import { SvgCodec } from '../src/infrastructure/SvgCodec.js';
import { EditorSession, TestExtensions } from './helpers/TestRuntime.js';

/** A standalone plugin context: no built-in plugin, registry, or host assembly. */
class BoxContext implements PluginContext {
  readonly shapes = new Map<string, ShapeProvider>();
  readonly attributes = new Map<string, AttributeHandler>();
  readonly decorators = new Map<string, TreeDecorator>();
  registerShape(value: ShapeProvider): void { this.shapes.set(value.name, value); }
  registerAttribute(value: AttributeHandler): void { this.attributes.set(value.name, value); }
  registerDecorator(value: TreeDecorator): void { this.decorators.set(value.name, value); }
  registerCommand(): void { assert.fail('box must not register a command'); }
}

/** Exercises actual encode/decode on read/save without depending on a disk path. */
class XmlStore implements DocumentStore {
  readonly files = new Map<string, string>();
  constructor(private readonly codec: SvgCodec) {}
  async read(path: string): Promise<{ document: SvgDocument; warnings: string[] }> {
    const xml = this.files.get(path);
    if (xml === undefined) throw new Error(`cannot read file: ${path}`);
    return this.codec.decode(xml);
  }
  async write(path: string, document: SvgDocument): Promise<void> {
    this.files.set(path, this.codec.encode(document));
  }
}

function runtime(enabled = true, options?: unknown) {
  const extensions = new TestExtensions();
  if (enabled) new BoxPlugin().activate(extensions, options);
  const codec = new SvgCodec(new ShapeFactory(extensions.shapes));
  const store = new XmlStore(codec);
  const session = new EditorSession(store, extensions);
  const cli = new CommandDispatcher(new CommandFactory(session), session.executor);
  return { extensions, codec, store, session, cli };
}

function snapshot(fixture: ReturnType<typeof runtime>) {
  const { session, codec } = fixture;
  return {
    document: session.document,
    xml: codec.encode(session.document),
    shapes: session.document.allShapes(),
    saved: session.saved,
    savedXml: session.saved && codec.encode(session.saved),
    undo: session.history.undoCount,
    redo: session.history.redoCount,
  };
}

function assertUnchanged(fixture: ReturnType<typeof runtime>, before: ReturnType<typeof snapshot>): void {
  const after = snapshot(fixture);
  assert.equal(after.document, before.document);
  assert.equal(after.saved, before.saved);
  assert.deepEqual(after, before);
  after.shapes.forEach((shape, index) => assert.equal(shape, before.shapes[index]));
}

async function run(cli: CommandDispatcher, ...lines: string[]): Promise<void> {
  for (const line of lines) assert.doesNotMatch(await cli.execute(line), /^error:/, line);
}

async function scene() {
  const fixture = runtime();
  await run(fixture.cli, 'init', 'create g scene', 'create box outer 10 20 100 50 "Outer" in scene',
    'create box inner 30 40 40 20 "Inner" in outer', 'create circle peer 2 3 4 in scene');
  return fixture;
}

test('box plugin independently registers three class-based extensions from the package manifest', async () => {
  const context = new BoxContext();
  boxPlugin.activate(context);
  assert.deepEqual([...context.shapes.keys()], ['box']);
  assert.deepEqual([...context.attributes.keys()], ['box-attributes']);
  assert.deepEqual([...context.decorators.keys()], ['box-type-label']);
  assert.ok(context.shapes.get('box') instanceof BoxProvider);
  assert.ok(context.attributes.get('box-attributes') instanceof BoxAttributes);
  assert.ok(context.decorators.get('box-type-label') instanceof BoxTypeLabel);
  assert.deepEqual(manifest.contributes, {
    shapes: [...context.shapes.keys()], attributes: [...context.attributes.keys()],
    decorators: [...context.decorators.keys()],
  });
  const packageJson = JSON.parse(await readFile(join(process.cwd(), 'plugins/shape-box/package.json'), 'utf8'));
  assert.deepEqual(manifest, packageJson);
  assert.equal(manifest.main, '../../dist/plugins/shape-box/index.js');
  const box = new ShapeFactory(context.shapes).create('box', 'n1', ['120', '100', '160', '60', '开始']);
  assert.ok(box instanceof Box);
  assert.equal(box.tag, 'g');
  assert.equal(box.kind, 'box');
  assert.equal(box.isContainer(), true);
  assert.deepEqual(box.children.map(child => [child.tag, child.id]), [['rect', 'n1-rect'], ['text', 'n1-label']]);
  assert.deepEqual(box.body.attributes(), { id: 'n1-rect', x: '120', y: '100', width: '160', height: '60', fill: '#4a90d9' });
  assert.deepEqual(box.title.attributes(), { id: 'n1-label', x: '140', y: '135' });
  assert.equal(box.title.text, '开始');
  assert.equal(box.attributes()['data-kind'], 'box');
});

test('box creation validates parameters and plugin options before registering any extensions', () => {
  const context = new BoxContext();
  new BoxPlugin().activate(context, { fill: '#123456' });
  const box = context.shapes.get('box')!.create('custom', ['0', '0', '10', '20', 'label']) as Box;
  assert.equal(box.body.attributes().fill, '#123456');
  for (const options of [null, false, 3, 'fill', [], { fill: 12 }]) {
    const invalid = new BoxContext();
    assert.throws(() => new BoxPlugin().activate(invalid, options), /box (?:options must be an object|fill option must be a string)/);
    assert.deepEqual([invalid.shapes.size, invalid.attributes.size, invalid.decorators.size], [0, 0, 0]);
  }
  const provider = new BoxProvider();
  for (const parameters of [[], ['1', '2', '3', '4'], ['1', '2', '3', '4', 'label', 'extra']]) {
    assert.throws(() => provider.create('bad', parameters), /invalid parameters for box/);
  }
  for (const parameters of [
    ['NaN', '0', '10', '20', 'label'], ['0', '0', '-1', '20', 'label'],
    ['0', '0', '10', '-1', 'label'], ['1e309', '0', '10', '20', 'label'],
  ]) assert.throws(() => provider.create('bad', parameters), /invalid number|must be non-negative/);
});

test('standalone box read and clone preserve imported data and own required components', () => {
  const provider = new BoxProvider('red');
  const rectangle = new Rect('b-rect', 1, 2, 3, 4, 'green');
  const label = new Text('b-label', 5, 6, 'Imported');
  const extra = new Group('extra');
  extra.insert(new Circle('c', 0, 0, 2));
  const box = provider.read({ id: 'b', tag: 'g', attributes: { 'data-kind': 'box', transform: 'translate(1 2)' }, text: '', children: [label, rectangle, extra] });
  assert.equal(box.body, rectangle);
  assert.equal(box.title, label);
  assert.deepEqual(box.children.map(shape => shape.id), ['b-label', 'b-rect', 'extra']);
  assert.equal(box.body.attributes().fill, 'green');
  assert.equal(box.attributes().transform, 'translate(1 2)');
  const clone = box.clone();
  assert.ok(clone instanceof Box);
  assert.notEqual(clone, box);
  assert.notEqual(clone.body, box.body);
  assert.notEqual(clone.title, box.title);
  assert.deepEqual(clone.attributes(), box.attributes());
  assert.deepEqual(clone.children.map(shape => shape.id), box.children.map(shape => shape.id));
  assert.equal(clone.body.parent, clone);
  clone.body.setAttribute('fill', 'blue');
  clone.title.setAttribute('text', 'Changed');
  assert.equal(box.body.attributes().fill, 'green');
  assert.equal(box.title.text, 'Imported');
});

test('standalone box reconstruction rejects a wrong element and missing or mistyped required parts', () => {
  const provider = new BoxProvider();
  const data = { id: 'b', tag: 'g', attributes: {}, text: '' };
  assert.throws(() => provider.read({ ...data, tag: 'rect', children: [] }), /expected <g>/);
  for (const children of [
    [], [new Rect('b-rect', 0, 0, 1, 1)], [new Text('b-label', 0, 0, '')],
    [new Circle('b-rect', 0, 0, 1), new Text('b-label', 0, 0, '')],
    [new Rect('b-rect', 0, 0, 1, 1), new Rect('b-label', 0, 0, 1, 1)],
  ]) assert.throws(() => provider.read({ ...data, children }), /invalid box structure: b/);
});

test('standalone attribute handler uses the edit port and type decorator recognizes only real boxes', () => {
  const context = new BoxContext();
  new BoxPlugin().activate(context);
  const box = context.shapes.get('box')!.create('b', ['0', '0', '10', '20', 'Old']) as Box;
  const ordinary = new Group('ordinary');
  ordinary.importAttributes({ 'data-kind': 'box' });
  const handler = context.attributes.get('box-attributes')!;
  const original = box.children.map(shape => ({ attributes: shape.attributes(), text: shape.text }));
  assert.equal(handler.handles(box, 'fill'), true);
  assert.equal(handler.handles(box, 'label'), true);
  assert.equal(handler.handles(box, 'stroke'), false);
  assert.equal(handler.handles(ordinary, 'label'), false);
  assert.deepEqual(box.children.map(shape => ({ attributes: shape.attributes(), text: shape.text })), original);
  const writes: Array<[Shape, string, string]> = [];
  const edit = { set(shape: Shape, attribute: string, value: string) { writes.push([shape, attribute, value]); shape.setAttribute(attribute, value); } };
  const fill = handler.apply(box, 'fill', 'orange', edit);
  assert.deepEqual(writes, [[box.body, 'fill', 'orange']]);
  assert.equal(fill.message, 'box#b fill propagated to b-rect');
  assert.equal(fill.undone(), 'box#b fill restored: "#4a90d9"');
  const label = handler.apply(box, 'label', 'New', edit);
  assert.deepEqual(writes[1], [box.title, 'text', 'New']);
  assert.equal(label.message, 'box#b label updated: "New"');
  assert.equal(label.undone(), 'box#b label restored: "Old"');
  assert.equal(box.attributes().fill, undefined);
  assert.equal(box.title.attributes().fill, undefined);
  assert.throws(() => handler.apply(ordinary, 'label', 'X', edit), /not a box: ordinary/);
  assert.throws(() => handler.apply(box, 'unknown', 'X', edit), /unknown attribute: unknown/);
  const document = new SvgDocument();
  document.add(box);
  const decorator = context.decorators.get('box-type-label')!;
  for (const [shape, expected] of [[box, '(box)'], [ordinary, ''], [box.body, ''], [document.root, '']] as const) {
    assert.equal(decorator.decorate({ shape, isRoot: shape === document.root, document, saved: undefined }), expected);
  }
});

test('box creation through CLI supports in, nested boxes, tree labels, and one-step creation undo', async () => {
  const fixture = await scene();
  const { session, cli } = fixture;
  const outer = session.document.find('outer');
  const inner = session.document.find('inner');
  assert.ok(outer instanceof Box);
  assert.ok(inner instanceof Box);
  assert.equal(outer.parent, session.document.find('scene'));
  assert.equal(inner.parent, outer);
  const tree = await cli.execute('tree');
  assert.match(tree, /g#outer \(box\)/);
  assert.match(tree, /g#inner \(box\)/);
  assert.equal(tree.split('\n').filter(line => line.endsWith('(box)')).length, 2);
  const before = fixture.codec.encode(session.document);
  const undoCount = session.history.undoCount;
  assert.equal(await cli.execute('create box last 0 0 10 20 "Last" in inner'),
    'box#last created (g#last + rect#last-rect + text#last-label) in g#inner');
  assert.equal(session.history.undoCount, undoCount + 1);
  assert.ok(session.document.find('last') instanceof Box);
  await run(cli, 'undo');
  assert.equal(fixture.codec.encode(session.document), before);
  for (const id of ['last', 'last-rect', 'last-label']) assert.throws(() => session.document.find(id), /no such shape/);
  await run(cli, 'redo');
  assert.equal(session.document.find('last').parent, inner);
});

test('box creation checks its own and all derived ids without residue, including SVG root ids', async t => {
  for (const collision of ['b', 'b-rect', 'b-label']) {
    for (const rootCollision of [false, true]) {
      await t.test(`${rootCollision ? 'root' : 'shape'} id ${collision}`, async () => {
        const fixture = runtime();
        const { cli, session, store } = fixture;
        if (rootCollision) {
          store.files.set('root.svg', `<svg id="${collision}" width="100" height="100"><rect id="existing" width="1" height="1"/></svg>`);
          await run(cli, 'read root.svg');
        } else await run(cli, 'init', `create rect ${collision} 0 0 1 1`);
        await run(cli, 'create circle pending 1 1 1', 'undo');
        const before = snapshot(fixture);
        assert.equal(await cli.execute('create box b 0 0 10 20 "B"'), `error: id already exists: ${collision}`);
        assertUnchanged(fixture, before);
        for (const id of ['b', 'b-rect', 'b-label'].filter(id => id !== collision)) {
          assert.throws(() => session.document.find(id), /no such shape/);
        }
        await run(cli, 'redo');
        assert.equal(session.document.find('pending').tag, 'circle');
      });
    }
  }
});

test('moving a nested box recursively moves all leaves and restores them in one undo', async () => {
  const fixture = await scene();
  const { session, cli, codec } = fixture;
  const before = codec.encode(session.document);
  const count = session.history.undoCount;
  assert.equal(await cli.execute('move outer 5 -3'), 'box#outer moved by (5,-3)');
  assert.equal(session.document.find('outer-rect').attributes().x, '15');
  assert.equal(session.document.find('outer-label').attributes().y, '52');
  assert.equal(session.document.find('inner-rect').attributes().x, '35');
  assert.equal(session.document.find('inner-label').attributes().y, '72');
  assert.equal(session.history.undoCount, count + 1);
  const moved = codec.encode(session.document);
  await run(cli, 'undo');
  assert.equal(codec.encode(session.document), before);
  await run(cli, 'redo');
  assert.equal(codec.encode(session.document), moved);
});

test('whole box grouping, reparenting, and deletion each preserve the subtree across undo and redo', async t => {
  for (const command of ['group bundle outer peer', 'addto scene inner', 'addto outer peer', 'delete outer']) {
    await t.test(command, async () => {
      const fixture = await scene();
      const { cli, session, codec } = fixture;
      const box = session.document.find('outer');
      const inner = session.document.find('inner');
      const before = codec.encode(session.document);
      const count = session.history.undoCount;
      await run(cli, command);
      assert.equal(session.history.undoCount, count + 1);
      const after = codec.encode(session.document);
      assert.notEqual(after, before);
      if (command === 'delete outer') {
        for (const id of ['outer', 'outer-rect', 'outer-label', 'inner', 'inner-rect', 'inner-label']) {
          assert.throws(() => session.document.find(id), /no such shape/);
        }
      }
      await run(cli, 'undo');
      assert.equal(codec.encode(session.document), before);
      assert.equal(session.document.find('outer'), box);
      assert.equal(session.document.find('inner'), inner);
      await run(cli, 'redo');
      assert.equal(codec.encode(session.document), after);
    });
  }
});

test('box fill and label each form exactly one reversible edit and leave unrelated parts unchanged', async t => {
  for (const [command, part, attribute, value] of [
    ['set outer fill #f5a623', 'outer-rect', 'fill', '#f5a623'],
    ['set outer label "处理数据 v2"', 'outer-label', 'text', '处理数据 v2'],
  ]) {
    await t.test(command, async () => {
      const fixture = await scene();
      const { cli, session, codec } = fixture;
      const before = codec.encode(session.document);
      const unaffected = session.document.allShapes().filter(shape => shape.id !== part)
        .map(shape => ({ id: shape.id, attributes: shape.attributes(), text: shape.text }));
      const count = session.history.undoCount;
      await run(cli, command!);
      assert.equal(session.history.undoCount, count + 1);
      const target = session.document.find(part!);
      assert.equal(attribute === 'text' ? target.text : target.attributes()[attribute!], value);
      assert.deepEqual(session.document.allShapes().filter(shape => shape.id !== part)
        .map(shape => ({ id: shape.id, attributes: shape.attributes(), text: shape.text })), unaffected);
      const after = codec.encode(session.document);
      await run(cli, 'undo');
      assert.equal(codec.encode(session.document), before);
      await run(cli, 'redo');
      assert.equal(codec.encode(session.document), after);
    });
  }
});

test('required box children cannot be deleted, reparented, grouped, or reordered and rejection preserves history', async t => {
  const commands = ['delete PART', 'addto scene PART', 'addto outer PART', 'group dismantled PART peer', 'front PART', 'back PART'];
  for (const part of ['outer-rect', 'outer-label']) {
    await t.test(part, async () => {
      const fixture = await scene();
      const { cli } = fixture;
      await run(cli, 'save baseline.svg', 'move outer 1 0', 'set outer label "Pending"', 'undo');
      const before = snapshot(fixture);
      assert.deepEqual([before.undo, before.redo], [1, 1]);
      for (const pattern of commands) {
        const command = pattern.replace('PART', part);
        assert.equal(await cli.execute(command), `error: cannot detach required component: ${part} (box: outer)`, command);
        assertUnchanged(fixture, before);
      }
      await run(cli, 'redo');
      assert.equal(fixture.session.document.find('outer-label').text, 'Pending');
    });
  }
});

test('ungroup rejects both nested and root boxes without changing document or pending redo', async () => {
  const fixture = await scene();
  await run(fixture.cli, 'create box rootBox 0 0 10 10 "Root"', 'move outer 1 0', 'undo');
  const before = snapshot(fixture);
  for (const id of ['outer', 'inner', 'rootBox']) {
    assert.equal(await fixture.cli.execute(`ungroup ${id}`), `error: cannot ungroup composite shape: ${id}`);
    assertUnchanged(fixture, before);
  }
  await run(fixture.cli, 'redo');
});

test('box SVG round trip restores plugin semantics and disabling the plugin degrades to ordinary groups', async () => {
  const source = await scene();
  await run(source.cli, 'set outer fill orange', 'set inner label "Nested & label"', 'save boxes.svg');
  const xml = source.store.files.get('boxes.svg')!;
  assert.match(xml, /<g(?=[^>]* id="outer")(?=[^>]* data-kind="box")[^>]*>/);
  assert.match(xml, /<g(?=[^>]* id="inner")(?=[^>]* data-kind="box")[^>]*>/);
  for (const enabled of [true, false]) {
    const target = runtime(enabled);
    target.store.files.set('boxes.svg', xml);
    await run(target.cli, 'read boxes.svg');
    assert.equal(target.codec.encode(target.session.document), xml);
    const outer = target.session.document.find('outer');
    const inner = target.session.document.find('inner');
    assert.equal(outer instanceof Box, enabled);
    assert.equal(inner instanceof Box, enabled);
    assert.equal(outer.isContainer(), true);
    assert.equal(inner.parent, outer);
    assert.equal(target.session.document.find('outer-rect').attributes().fill, 'orange');
    assert.equal(target.session.document.find('inner-label').text, 'Nested & label');
    const tree = await target.cli.execute('tree');
    assert.equal(tree.includes('(box)'), enabled);
    if (enabled) {
      await run(target.cli, 'set outer label "Restored behavior"');
      assert.equal(target.session.document.find('outer-label').text, 'Restored behavior');
    } else {
      assert.equal(await target.cli.execute('create box unavailable 0 0 10 20 "Disabled"'),
        'error: unknown shape type: box (is the plugin loaded?)');
      assert.equal(await target.cli.execute('set outer label "Unavailable"'), 'error: unknown attribute: label');
      await run(target.cli, 'move outer 1 1');
      assert.equal(target.session.document.find('outer-rect').attributes().x, '11');
    }
  }
});

test('invalid box XML reads retain the previous document, save baseline, and undo/redo history', async t => {
  const validRect = '<rect id="b-rect" x="0" y="0" width="10" height="20"/>';
  const validText = '<text id="b-label" x="1" y="2">Label</text>';
  const cases = [
    ['missing rectangle', `<g id="b" data-kind="box">${validText}</g>`, /invalid box structure: b/],
    ['missing label', `<g id="b" data-kind="box">${validRect}</g>`, /invalid box structure: b/],
    ['wrong rectangle type', `<g id="b" data-kind="box"><circle id="b-rect" r="1"/>${validText}</g>`, /invalid box structure: b/],
    ['wrong label type', `<g id="b" data-kind="box">${validRect}<rect id="b-label" width="1" height="1"/></g>`, /invalid box structure: b/],
    ['wrong container type', '<rect id="b" data-kind="box" width="1" height="1"/>', /invalid box structure: b/],
    ['duplicate component id', `<g id="b" data-kind="box">${validRect}${validText}${validText}</g>`, /id already exists: b-label/],
    ['root id collision', `<g id="b" data-kind="box">${validRect}${validText}</g>`, /id already exists: b-rect/],
  ] as const;
  for (const [name, children, expected] of cases) {
    await t.test(name, async () => {
      const fixture = await scene();
      const { cli, store } = fixture;
      await run(cli, 'save original.svg', 'move outer 2 0', 'set outer label "Pending"', 'undo');
      const before = snapshot(fixture);
      const rootId = name === 'root id collision' ? ' id="b-rect"' : '';
      store.files.set('invalid.svg', `<svg${rootId} width="100" height="100">${children}</svg>`);
      const output = await cli.execute('read invalid.svg');
      assert.match(output, /^error:/);
      assert.match(output, expected);
      assertUnchanged(fixture, before);
      await run(cli, 'redo');
      assert.equal(fixture.session.document.find('outer-label').text, 'Pending');
      assert.match(await cli.execute('save'), /^saved to original\.svg/);
    });
  }
});

test('box attribute and decorator extensions can be omitted independently after registering its shape', async () => {
  const fixture = runtime();
  fixture.extensions.attributes.clear();
  fixture.extensions.decorators.clear();
  await run(fixture.cli, 'init', 'create box b 0 0 10 20 "Label"');
  assert.doesNotMatch(await fixture.cli.execute('tree'), /\(box\)/);
  assert.equal(await fixture.cli.execute('set b label "No handler"'), 'error: unknown attribute: label');
  await run(fixture.cli, 'set b fill pink');
  assert.equal(fixture.session.document.find('b').attributes().fill, 'pink');
  assert.equal(fixture.session.document.find('b-rect').attributes().fill, '#4a90d9');
});
