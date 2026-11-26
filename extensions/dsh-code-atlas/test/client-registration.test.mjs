import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots';
import { Context, Service } from '@deepseek-ai/cordis';

const installedApp = '/Applications/DSH Desktop.app/Contents/Resources/app/package.json';

async function browserModule() {
  let factory;
  vm.runInNewContext(await readFile(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load(record) { assert.equal(record.id, 'dsh-code-atlas'); factory = record.factory; } } },
    console, setTimeout, clearTimeout,
  });
  assert.equal(typeof factory, 'function');
  return factory(createRequire(import.meta.url));
}

// Evaluate the exact browser carrier; only its module loader is supplied by the test.
// Slot registration itself uses the real rc.1 registry, not a reimplementation.
test('the browser bundle registers the native keyed main page and sidebar row, and unload removes both', async () => {
  const module = await browserModule();
  assert.deepEqual(Array.from(module.inject), ['slots', 'layout', 'remote']);
  const slots = new SlotCore();
  const rootOff = slots.register({ name: 'root', children: { main: { kind: 'keyed', scope: 'root' }, 'sidebar.panellist': { kind: 'list', scope: 'root' } } }, () => null);
  const disposers = [];
  let mounted = false;
  let mountedManifest;
  const context = {
    remote: {
      async $mount(manifest) { mounted = true; mountedManifest = manifest; return () => { mounted = false; }; },
      codeAtlas: { async sessions() { return { ok: true, value: [] }; } },
    },
    slots: {
      inject(_name, action) { disposers.push(action()); },
      register: slots.register.bind(slots),
    },
    layout: { selectPanel() {}, panelInfo: { getSnapshot: () => ({ activePanelId: null }) } },
    effect(action) { disposers.push(action()); },
    inject(services, action) { assert.deepEqual(Array.from(services), ['remote.codeAtlas']); return action(this); },
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
    assert.equal(sidebar[0].options.label(), '代码审阅');
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

test('the client mounts its namespace before accessing it under real Cordis 4 dependency tracing', async () => {
  const module = await browserModule();
  const root = new Context();
  const slots = new SlotCore();
  const rootOff = slots.register({ name: 'root', children: { main: { kind: 'keyed', scope: 'root' }, 'sidebar.panellist': { kind: 'list', scope: 'root' } } }, () => null);
  let namespaceFiber;
  class Slots extends Service {
    constructor(ctx) { super(ctx, 'slots'); }
    register(options, component) { return slots.register(options, component); }
    inject(_name, action) { return this.ctx.effect(action); }
  }
  class Remote extends Service {
    constructor(ctx) { super(ctx, 'remote'); this.owner = ctx; }
    async $mount() {
      namespaceFiber = this.owner.plugin({ name: 'test-code-atlas-namespace', apply(ctx) {
        const namespace = new Service(ctx, 'remote.codeAtlas');
        namespace.sessions = async () => ({ ok: true, value: [] });
      } });
      await namespaceFiber;
      return () => namespaceFiber.dispose();
    }
  }
  new Slots(root);
  new Service(root, 'layout');
  new Remote(root);
  const plugin = root.plugin(module);
  try {
    await plugin;
    assert.equal(plugin.state, 2);
    const main = slots.entriesOfSlot('main');
    assert.equal(main.length, 1);
    await main[0].inject().controller.loadSessions();
    assert.equal(main[0].inject().controller.getSnapshot().sessions.length, 0);
    await plugin.dispose();
    assert.equal(slots.entriesOfSlot('main').length, 0);
    assert.equal(slots.entriesOfSlot('sidebar.panellist').length, 0);
    assert.equal(namespaceFiber.state, 4);
  } finally { await plugin.dispose(); await root.fiber.dispose(); rootOff(); }
});

test('client roster injections name native rc.1 browser plugins with actual client carriers', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const injections = manifest.dsh.client.inject;
  assert(!injections.includes('@deepseek-ai/dsh-client-ui-slots'), 'ui-slots is a pure SDK and cannot be a client roster dependency');
  const local = createRequire(import.meta.url);
  const native = existsSync(installedApp) ? createRequire(installedApp) : undefined;
  for (const name of injections) {
    let packagePath;
    try { packagePath = local.resolve(`${name}/package.json`); }
    catch { packagePath = native?.resolve(`${name}/package.json`); }
    assert(packagePath, `${name} must be installed to verify its browser face`);
    const dependency = JSON.parse(await readFile(packagePath, 'utf8'));
    assert.equal(dependency.version, '0.2.0-rc.1', `${name} must match the native DSH version`);
    assert.equal(dependency.dsh?.client?.platform, 'web', `${name} must declare a web client plugin`);
    const client = dependency.exports?.['./client'];
    const entry = typeof client === 'string' ? client : client?.default;
    assert.equal(typeof entry, 'string', `${name} must export ./client`);
    const carrier = await readFile(resolve(dirname(packagePath), entry), 'utf8');
    assert.match(carrier, /window\.__ModuleLoader__\.load\(/, `${name} must publish the native browser carrier`);
  }
});

test('every browser bundle external is available from the installed Desktop React runtime', { skip: !existsSync(installedApp) }, async () => {
  const native = createRequire(installedApp);
  const carrier = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
  const externals = [...new Set([...carrier.matchAll(/\brequire\(["']([^"']+)["']\)/g)].map(match => match[1]))].sort();
  assert.deepEqual(externals, ['react', 'react/jsx-runtime']);
  assert.equal(native('react/package.json').version, '18.3.1');
  for (const external of externals) assert(native.resolve(external));
});
