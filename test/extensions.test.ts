import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorSession, TestExtensions, SvgCodec } from './helpers/TestRuntime.js';
import { MemoryDocumentStore } from './helpers/MemoryDocumentStore.js';
import { CommandDispatcher } from '../src/cli/CommandDispatcher.js';
import { CommandFactory } from '../src/cli/CommandFactory.js';
import type { AttributeHandler, AttributeEdit } from '../src/api/index.js';

async function fixture() {
  const extensions = new TestExtensions();
  const session = new EditorSession(new MemoryDocumentStore(), extensions);
  const cli = new CommandDispatcher(new CommandFactory(session), session.executor);
  for (const line of ['init', 'create g g', 'create rect a 0 0 10 10 in g', 'create rect b 20 0 10 10 in g']) {
    assert.doesNotMatch((await cli.execute(line))!, /^error:/);
  }
  return { extensions, session, cli };
}

test('one handler can change several descendants as one undo unit without document cloning', async t => {
  const { extensions, session, cli } = await fixture();
  extensions.registerAttribute({
    name: 'pair', handles: (shape, attr) => shape.id === 'g' && attr === 'pair',
    apply(shape, _attr, value, edit) {
      for (const child of shape.children) edit.set(child, 'fill', value);
      return { message: 'pair updated', undone: () => 'pair restored' };
    },
  });
  const before = new SvgCodec().encode(session.document);
  const identity = session.document.find('a');
  t.mock.method(session.document, 'clone', () => { throw new Error('no snapshots'); });
  const count = session.history.undoCount;
  assert.equal(await cli.execute('set g pair red'), 'pair updated');
  assert.equal(session.history.undoCount, count + 1);
  assert.equal(session.document.find('a'), identity);
  for (const id of ['a', 'b']) assert.equal(session.document.find(id).attributes().fill, 'red');
  assert.equal(await cli.execute('undo'), 'pair restored');
  assert.equal(new SvgCodec().encode(session.document), before);
  assert.equal(await cli.execute('redo'), 'pair updated');
});

test('partial handler failure restores repeated writes and preserves the pending redo stack', async () => {
  const { extensions, session, cli } = await fixture();
  await cli.execute('move a 1 0');
  await cli.execute('undo');
  const before = new SvgCodec().encode(session.document);
  const counts = [session.history.undoCount, session.history.redoCount];
  extensions.registerAttribute({
    name: 'broken', handles: (_shape, attr) => attr === 'fill',
    apply(shape, _attr, value, edit) {
      edit.set(shape.children[0]!, 'fill', value);
      edit.set(shape.children[0]!, 'fill', 'blue');
      edit.set(shape.children[1]!, 'x', '99');
      throw new Error('handler failed midway');
    },
  });
  assert.equal(await cli.execute('set g fill red'), 'error: handler failed midway');
  assert.equal(new SvgCodec().encode(session.document), before);
  assert.deepEqual([session.history.undoCount, session.history.redoCount], counts);
  assert.doesNotMatch((await cli.execute('redo'))!, /^error:/);
  assert.equal(session.document.find('a').attributes().x, '1');
});

test('ambiguous handlers are rejected before either runs; no match keeps the Phase 1 whitelist', async () => {
  const { extensions, session, cli } = await fixture();
  let applied = 0;
  const handler: AttributeHandler = {
    name: 'one', handles: (_shape, attr) => attr === 'label',
    apply() { applied++; return { message: '', undone: () => '' }; },
  };
  extensions.registerAttribute(handler);
  extensions.registerAttribute({ ...handler, name: 'two' });
  assert.equal(await cli.execute('set a label title'), 'error: ambiguous attribute handlers: label (one, two)');
  assert.equal(applied, 0);
  assert.match((await cli.execute('set a fill red'))!, /updated: fill/);
  assert.equal(session.document.find('a').attributes().fill, 'red');
  assert.equal(await cli.execute('set a undefined value'), 'error: unknown attribute: undefined');
});

test('attribute transactions reject writes outside the target and roll back invalid handler results', async () => {
  const { extensions, session, cli } = await fixture();
  const before = new SvgCodec().encode(session.document);
  extensions.registerAttribute({
    name: 'escape', handles: (_shape, attr) => attr === 'escape',
    apply(shape, _attr, value, edit) {
      edit.set(shape, 'fill', value);
      edit.set(session.document.find('b'), 'fill', value);
      return { message: 'bad', undone: () => 'bad' };
    },
  });
  assert.equal(await cli.execute('set a escape red'), 'error: attribute edit outside target: b');
  assert.equal(new SvgCodec().encode(session.document), before);
  extensions.registerAttribute({
    name: 'invalid', handles: (_shape, attr) => attr === 'invalid',
    apply(shape, _attr, value, edit) {
      edit.set(shape, 'fill', value);
      return undefined as never;
    },
  });
  assert.equal(await cli.execute('set a invalid red'), 'error: invalid attribute result: invalid');
  assert.equal(new SvgCodec().encode(session.document), before);
});

test('tree labels compose in registration order and absent labels preserve every byte', async () => {
  const { extensions, cli } = await fixture();
  const baseline = (await cli.execute('tree'))!;
  extensions.registerDecorator({ name: 'first', decorate: () => '[1]' });
  extensions.registerDecorator({ name: 'empty', decorate: () => '' });
  extensions.registerDecorator({ name: 'second', decorate: () => '[2]' });
  assert.equal(await cli.execute('tree'), baseline.split('\n').map(line => `${line} [1] [2]`).join('\n'));
  extensions.decorators.clear();
  assert.equal(await cli.execute('tree'), baseline);
});


test('a throwing undo-message provider fails inside the transaction rather than corrupting future undo', async () => {
  const { extensions, session, cli } = await fixture();
  await cli.execute('move a 1 0');
  await cli.execute('undo');
  const before = new SvgCodec().encode(session.document);
  const counts = [session.history.undoCount, session.history.redoCount];
  extensions.registerAttribute({
    name: 'feedback-failure', handles: (_shape, attr) => attr === 'feedback',
    apply(shape, _attr, value, edit) {
      edit.set(shape, 'fill', value);
      return { message: 'changed', undone: () => { throw new Error('feedback failed'); } };
    },
  });
  assert.equal(await cli.execute('set a feedback red'), 'error: feedback failed');
  assert.equal(new SvgCodec().encode(session.document), before);
  assert.deepEqual([session.history.undoCount, session.history.redoCount], counts);
  assert.doesNotMatch((await cli.execute('redo'))!, /^error:/);
});


test('retained attribute edit contexts close after success and failure', async () => {
  const { extensions, session, cli } = await fixture();
  let retained!: AttributeEdit;
  extensions.registerAttribute({
    name: 'retained', handles: (_shape, attr) => attr === 'retained',
    apply(shape, _attr, value, edit) {
      retained = edit;
      edit.set(shape, 'fill', value);
      if (value === 'fail') throw new Error('intentional failure');
      return { message: 'changed', undone: () => 'restored' };
    },
  });
  assert.equal(await cli.execute('set a retained red'), 'changed');
  assert.throws(() => retained.set(session.document.find('a'), 'fill', 'blue'), /transaction is closed/);
  assert.equal(await cli.execute('set a retained fail'), 'error: intentional failure');
  assert.throws(() => retained.set(session.document.find('a'), 'fill', 'blue'), /transaction is closed/);
  assert.equal(session.document.find('a').attributes().fill, 'red');
  assert.equal(await cli.execute('undo'), 'restored');
  assert.equal(session.document.find('a').attributes().fill, undefined);
});

test('an accidentally async handler rolls back and cannot write after its await', async () => {
  const { extensions, session, cli } = await fixture();
  const before = new SvgCodec().encode(session.document);
  extensions.registerAttribute({
    name: 'async', handles: (_shape, attr) => attr === 'async',
    apply: (async (...[shape, _attr, value, edit]: Parameters<AttributeHandler['apply']>) => {
      edit.set(shape, 'fill', value);
      await Promise.resolve();
      edit.set(shape, 'fill', 'blue');
      return { message: '', undone: () => '' };
    }) as unknown as AttributeHandler['apply'],
  });
  assert.equal(await cli.execute('set a async red'), 'error: attribute handler must be synchronous: async');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(new SvgCodec().encode(session.document), before);
});
