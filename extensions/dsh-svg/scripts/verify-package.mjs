import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { Context } from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import * as NativeExecutor from '@deepseek-ai/dsh-tool-executor-native';
import { executeModelToolFixture } from '@deepseek-ai/dsh-tool-testkit';

const root = resolve(import.meta.dirname, '..');
const archive = resolve(root, 'artifacts/dsh-svg-workbench-0.1.0.tgz');
const temp = await mkdtemp(join(tmpdir(), 'dsh-svg-package-'));
const ctx = new Context();
try {
  execFileSync('tar', ['-xzf', archive, '-C', temp]);
  const packageRoot = join(temp, 'package');
  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml');
  assert.equal(manifest.engines.dsh, '0.2.2-rc.5');
  const patch = await readFile(join(packageRoot, 'cordis.patch.yml'), 'utf8');
  assert.match(patch, /name: dsh-svg-workbench/);
  // SDK peers stand in for the host installation; the shared SVG implementation
  // must come from the package itself, not a link back to repository sources.
  await symlink(resolve(root, 'node_modules'), join(packageRoot, 'node_modules'), 'dir');
  const plugin = await import(pathToFileURL(join(packageRoot, manifest.main)).href);
  await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime); await ctx.plugin(NativeExecutor);
  const fiber = ctx.plugin(plugin); await fiber;
  let count = 0;
  const run = (name, args) => executeModelToolFixture(ctx, {
    callId: `package-${++count}`, name, arguments: args,
    signal: new AbortController().signal, agent: { id: 'package-check' },
  });
  for (const [name, args] of [['svg_create', {}],
    ['svg_edit', { operation: 'create', args: ['box', 'packed', '10', '20', '100', '60', '从安装包创建'] }]]) {
    assert.equal((await run(name, args)).isError, false);
  }
  const exported = await run('svg_export', {});
  assert.equal(exported.isError, false);
  assert.match(exported.value.svg, /从安装包创建/);
  assert.match(exported.value.svg, /data-kind="box"/);
  await fiber.dispose();
  assert.equal(ctx.tools.schemas().length, 0);
  await writeFile(resolve(root, '../../doc/dsh-package-evidence.json'), JSON.stringify({
    kind: 'real-dsh-packed-bundle',
    sdk: { cordis: '4.1.0', dsh: '0.2.2-rc.5' },
    packageSha256: createHash('sha256').update(await readFile(archive)).digest('hex'),
    isolation: 'Package extracted outside repository sources; host SDK peers supplied separately',
    checks: ['bundle manifest and patch', 'real host registration', 'create canvas', 'create box', 'export SVG text and composite marker', 'unload unregisters tools'],
    passed: true,
  }, null, 2) + '\n');
  console.log('Packed DSH bundle verified outside repository sources: register/create/box/export/unload passed.');
} finally { await ctx.fiber.dispose(); await rm(temp, { recursive: true, force: true }); }
