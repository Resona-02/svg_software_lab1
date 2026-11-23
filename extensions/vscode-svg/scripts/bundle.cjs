const { buildSync } = require('esbuild');
const { resolve } = require('node:path');
const root = resolve(__dirname, '..');
buildSync({
  entryPoints: [resolve(root, 'src/extension.ts')],
  outfile: resolve(root, 'dist/extension.cjs'),
  bundle: true,
  external: ['vscode'],
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  sourcemap: false,
  legalComments: 'eof',
});
