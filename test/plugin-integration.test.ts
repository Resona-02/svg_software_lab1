import assert from 'node:assert/strict';
import test from 'node:test';
import { CommandArguments } from '../src/api/index.js';
import { CommandDispatcher } from '../src/cli/CommandDispatcher.js';
import { CommandFactory } from '../src/cli/CommandFactory.js';
import dirPlugin from '../plugins/command-dir/index.js';
import { DirProvider } from '../plugins/command-dir/DirProvider.js';
import type { DirectoryEntry, DirectoryReader } from '../plugins/command-dir/DirectoryReader.js';
import statsPlugin from '../plugins/command-stats/index.js';
import { EditorSession, SvgCodec, TestExtensions } from './helpers/TestRuntime.js';
import { MemoryDocumentStore } from './helpers/MemoryDocumentStore.js';

class TestDirectoryReader implements DirectoryReader {
  readonly paths: string[] = [];
  fail = false;

  async list(path: string): Promise<readonly DirectoryEntry[]> {
    this.paths.push(path);
    if (this.fail) throw new Error('EACCES');
    return [{ name: 'sample.svg', kind: 'file' }, { name: '.cache', kind: 'directory' }];
  }
}

function runtime(options: { stats?: boolean; dir?: boolean; reader?: DirectoryReader } = { stats: true, dir: true }) {
  const extensions = new TestExtensions();
  if (options.stats) statsPlugin.activate(extensions);
  if (options.dir) {
    dirPlugin.activate(extensions);
    if (options.reader) extensions.registerCommand(new DirProvider(options.reader));
  }
  const session = new EditorSession(new MemoryDocumentStore(), extensions);
  const cli = new CommandDispatcher(new CommandFactory(session), session.executor);
  return { extensions, session, cli };
}

function capture(session: EditorSession) {
  const codec = new SvgCodec();
  return {
    document: session.document,
    documentXml: codec.encode(session.document),
    shapes: session.document.allShapes(),
    saved: session.saved,
    savedXml: session.saved === undefined ? undefined : codec.encode(session.saved),
    undo: session.history.undoCount,
    redo: session.history.redoCount,
    cwd: process.cwd(),
  };
}

function assertUnchanged(session: EditorSession, before: ReturnType<typeof capture>): void {
  const after = capture(session);
  assert.equal(after.document, before.document);
  assert.equal(after.saved, before.saved);
  assert.deepEqual(after, before);
  after.shapes.forEach((shape, index) => assert.equal(shape, before.shapes[index]));
}

async function createScene(cli: CommandDispatcher): Promise<void> {
  for (const line of [
    'init',
    'create g scene',
    'create text title 0 0 "title" in scene',
    'create g nested in scene',
    'create rect frame 0 0 10 10 in nested',
    'create text label 1 1 "label" in nested',
    'create circle circle 1 1 2',
  ]) assert.doesNotMatch(await cli.execute(line), /^error:/);
}

test('command plugins work through the dispatcher before init: dir succeeds and stats reports no document', async () => {
  const reader = new TestDirectoryReader();
  const { cli, session } = runtime({ stats: true, dir: true, reader });
  assert.equal(await cli.execute('dir'), '[DIR]  .cache\n[FILE]  sample.svg');
  assert.equal(await cli.execute('stats'), "error: no document. use 'init' or 'read' first");
  assert.equal(await cli.execute('dir extra'), 'error: usage: dir');
  assert.equal(await cli.execute('stats extra'), 'error: usage: stats');
  assert.deepEqual(reader.paths, [process.cwd()]);
  assert.equal(session.saved, undefined);
  assert.deepEqual([session.history.undoCount, session.history.redoCount], [0, 0]);
  assert.doesNotMatch(await cli.execute('init'), /^error:/);
  assert.equal(await cli.execute('stats'), '(total 0, containers 0)');
});

test('stats and dir independently appear in help only when their plugins are enabled', async t => {
  for (const stats of [false, true]) {
    for (const dir of [false, true]) {
      await t.test(`stats=${stats}, dir=${dir}`, async () => {
        const { cli } = runtime({ stats, dir, reader: new TestDirectoryReader() });
        const lines = (await cli.execute('help')).split('\n');
        assert.equal(lines.includes('stats'), stats);
        assert.equal(lines.includes('dir'), dir);
        assert.equal(lines.filter(line => line === 'stats').length, stats ? 1 : 0);
        assert.equal(lines.filter(line => line === 'dir').length, dir ? 1 : 0);
        assert.equal(await cli.execute('stats'), stats
          ? "error: no document. use 'init' or 'read' first" : 'error: unknown command: stats');
        assert.equal(await cli.execute('dir'), dir
          ? '[DIR]  .cache\n[FILE]  sample.svg' : 'error: unknown command: dir');
        assert.doesNotMatch(await cli.execute('init'), /^error:/);
        assert.doesNotMatch(await cli.execute('create rect r 0 0 1 1'), /^error:/);
      });
    }
  }
});

test('successful and failed dir preserve unsaved documents, save baselines, and both history directions', async t => {
  for (const fail of [false, true]) {
    await t.test(fail ? 'failed directory read' : 'successful directory read', async () => {
      const reader = new TestDirectoryReader();
      const { cli, session } = runtime({ stats: true, dir: true, reader });
      await createScene(cli);
      reader.fail = fail;
      const expected = fail ? `error: cannot read directory: ${process.cwd()}` : '[DIR]  .cache\n[FILE]  sample.svg';
      const unsaved = capture(session);
      assert.equal(unsaved.saved, undefined);
      assert.equal(await cli.execute('dir'), expected);
      assertUnchanged(session, unsaved);

      assert.doesNotMatch(await cli.execute('save /different-svg-directory/drawing.svg'), /^error:/);
      const clean = capture(session);
      assert.equal(clean.documentXml, clean.savedXml);
      assert.equal(await cli.execute('dir'), expected);
      assertUnchanged(session, clean);

      assert.doesNotMatch(await cli.execute('move frame 5 0'), /^error:/);
      assert.doesNotMatch(await cli.execute('set label text "changed"'), /^error:/);
      assert.doesNotMatch(await cli.execute('undo'), /^error:/);
      const dirty = capture(session);
      assert.deepEqual([dirty.undo, dirty.redo], [1, 1]);
      assert.notEqual(dirty.documentXml, dirty.savedXml);
      assert.equal(await cli.execute('dir'), expected);
      assertUnchanged(session, dirty);
      assert.deepEqual(reader.paths, [dirty.cwd, dirty.cwd, dirty.cwd]);

      assert.doesNotMatch(await cli.execute('redo'), /^error:/);
      assert.equal(session.document.find('label').text, 'changed');
      assert.doesNotMatch(await cli.execute('undo'), /^error:/);
      assert.doesNotMatch(await cli.execute('undo'), /^error:/);
      assert.equal(new SvgCodec().encode(session.document), clean.savedXml);
      reader.fail = false;
      assert.equal(await cli.execute('dir'), '[DIR]  .cache\n[FILE]  sample.svg');
      assert.equal(await cli.execute('stats'), 'text: 2  rect: 1  circle: 1  (total 4, containers 2)');
    });
  }
});

test('stats uses container polymorphism and preserves unsaved, clean, and dirty sessions with pending redo', async () => {
  const { cli, session, extensions } = runtime({ stats: true });
  await createScene(cli);
  const expected = 'text: 2  rect: 1  circle: 1  (total 4, containers 2)';
  const unsaved = capture(session);
  assert.equal(await cli.execute('stats'), expected);
  assertUnchanged(session, unsaved);

  assert.doesNotMatch(await cli.execute('save stats.svg'), /^error:/);
  const clean = capture(session);
  assert.equal(await cli.execute('stats'), expected);
  assertUnchanged(session, clean);
  assert.doesNotMatch(await cli.execute('move frame 3 4'), /^error:/);
  assert.doesNotMatch(await cli.execute('set label text "changed"'), /^error:/);
  assert.doesNotMatch(await cli.execute('undo'), /^error:/);
  const dirty = capture(session);
  assert.deepEqual([dirty.undo, dirty.redo], [1, 1]);
  assert.notEqual(dirty.documentXml, dirty.savedXml);
  const provider = extensions.commands.get('stats')!;
  const command = provider.create(new CommandArguments([], provider.syntax), session);
  assert.equal(await session.executor.executeCommand(command), expected);
  assertUnchanged(session, dirty);
  assert.equal(await cli.execute('stats'), expected);
  assertUnchanged(session, dirty);

  assert.doesNotMatch(await cli.execute('redo'), /^error:/);
  assert.equal(session.document.find('label').text, 'changed');
  assert.doesNotMatch(await cli.execute('undo'), /^error:/);
  assert.doesNotMatch(await cli.execute('undo'), /^error:/);
  assert.equal(new SvgCodec().encode(session.document), clean.savedXml);
});

test('dir production plugin uses its Node adapter before a document exists', async () => {
  const { cli, session } = runtime({ dir: true });
  const original = process.cwd();
  const output = await cli.execute('dir');
  assert.doesNotMatch(output, /^error:/);
  assert.match(output, /^\[DIR\]  plugins$/m);
  assert.match(output, /^\[FILE\]  package\.json$/m);
  assert.equal(process.cwd(), original);
  assert.equal(session.saved, undefined);
  assert.deepEqual([session.history.undoCount, session.history.redoCount], [0, 0]);
});
