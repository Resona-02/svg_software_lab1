import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await mkdir(resolve(root, 'lib'), { recursive: true });
await build({
  absWorkingDir: root, entryPoints: ['src/index.ts'], outfile: 'lib/index.js', bundle: true,
  platform: 'node', format: 'esm', target: 'node22', sourcemap: true,
  external: ['@deepseek-ai/*'],
  banner: { js: '// SVG workbench: shared Phase 2 implementation bundled; DSH services supplied by the host.' },
});
await writeFile(resolve(root, 'lib/index.d.ts'), `import type { Context } from '@deepseek-ai/cordis';\nexport declare const name = "dsh-svg-workbench";\nexport declare const inject: string[];\nexport declare function apply(ctx: Context): void;\n`);
console.log('Built lib/index.js (shared SVG core included, DSH services external).');
