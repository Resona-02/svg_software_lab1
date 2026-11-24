import { build } from 'esbuild';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await mkdir(resolve(root, 'lib'), { recursive: true });
await mkdir(resolve(root, 'artifacts'), { recursive: true });
const entries = { 'client-controller': 'src/client/AtlasController.ts', core: 'src/core/index.ts', analysis: 'src/analysis/index.ts', index: 'src/index.ts',
  'typert.host': 'src/typert.ts', 'typert.remote-client': 'src/typert.remote-client.ts' };
for (const [name, path] of Object.entries(entries)) {
  if (!await access(resolve(root, path)).then(() => true, () => false)) continue;
  await build({ absWorkingDir: root, entryPoints: [path], outfile: `lib/${name}.js`, bundle: true,
    platform: 'node', format: 'esm', target: 'node22', sourcemap: true,
    external: ['@deepseek-ai/*', 'typescript', 'typescript/*', 'react', 'react/*'] });
}
if (await access(resolve(root, 'src/client/index.tsx')).then(() => true, () => false)) {
  await build({ absWorkingDir: root, entryPoints: ['src/client/index.tsx'], outfile: 'lib/client.js', bundle: true,
    platform: 'browser', format: 'cjs', target: 'es2022', jsx: 'automatic', sourcemap: true,
    external: ['@deepseek-ai/*', 'react', 'react/*'],
    banner: { js: 'window.__ModuleLoader__.load({id:"dsh-code-atlas",factory(require){const module={exports:{}};const exports=module.exports;' },
    footer: { js: 'return module.exports;}});' } });
}
await writeFile(resolve(root, 'lib/index.d.ts'), 'import type { Context } from "@deepseek-ai/cordis";\nexport declare const name: string;\nexport declare const inject: string[];\nexport declare function apply(ctx: Context): Promise<void>;\n');
console.log('Code Atlas bundles built (DSH/React/TypeScript supplied as runtime dependencies).');
