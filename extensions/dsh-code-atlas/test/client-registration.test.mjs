import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots';

// Evaluate the exact browser carrier; only its module loader is supplied by the test.
// Slot registration itself uses the real rc.1 registry, not a reimplementation.
test('the browser bundle registers the native keyed main page and sidebar row, and unload removes both', async () => {
  let factory;
  vm.runInNewContext(await readFile(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load(record) { assert.equal(record.id, 'dsh-code-atlas'); factory = record.factory; } } },
    console, setTimeout, clearTimeout,
  });
  assert.equal(typeof factory, 'function');
  const module = factory(createRequire(import.meta.url));
  assert.deepEqual(Array.from(module.inject), ['slots', 'layout', 'remote']);
  const slots = new SlotCore();
  const rootOff = slots.register({ name: 'root', children: { main: { kind: 'keyed', scope: 'root' }, 'sidebar.panellist': { kind: 'list', scope: 'root' } } }, () => null);
  const disposers = [];
  let mounted = false;
  let mountedManifest;
  const context = {
    remote: {
      async $mount(manifest) { mounted = true; mountedManifest = manifest; return () => { mounted = false; }; },
      codeAtlas: { async sessions() { return []; } },
    },
    slots: {
      inject(_name, action) { disposers.push(action()); },
      register: slots.register.bind(slots),
    },
    layout: { selectPanel() {}, panelInfo: { getSnapshot: () => ({ activePanelId: null }) } },
    effect(action) { disposers.push(action()); },
  };
  try {
    await module.apply(context);
    assert.equal(mounted, true);
    assert.equal(mountedManifest.package, 'dsh-code-atlas');
    const main = slots.entriesOfSlot('main');
    assert.equal(main.length, 1);
    assert.equal(main[0].options.key, 'code-atlas');
    const sidebar = slots.entriesOfSlot('sidebar.panellist');
    assert.equal(sidebar.length, 1);
    assert.equal(sidebar[0].options.id, 'code-atlas');
    assert.equal(sidebar[0].options.label(), '代码地图');
    const props = main[0].inject();
    assert.equal(typeof props.controller.subscribe, 'function');
    await props.controller.loadSessions();
    assert.equal(props.controller.getSnapshot().sessions.length, 0);
    for (const dispose of disposers.reverse()) dispose?.();
    assert.equal(slots.entriesOfSlot('main').length, 0);
    assert.equal(slots.entriesOfSlot('sidebar.panellist').length, 0);
    assert.equal(mounted, false);
  } finally { rootOff(); }
});
