const assert = require('node:assert/strict');
const { spawnSync, execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { existsSync, mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');

// Verify the artifact itself, not a development folder with dependencies beside it.
// Python's standard ZIP library avoids adding another extraction dependency.
const sourceExtension = resolve(__dirname, '..');
const packagePath = resolve(process.argv[2] || join(sourceExtension, 'svg-software-lab-0.1.0.vsix'));
assert(process.argv.length <= 3, 'usage: node scripts/verify-vsix.cjs [package.vsix]');
assert(existsSync(packagePath), `package does not exist: ${packagePath}; run npm run package first`);
const temporary = mkdtempSync(join(tmpdir(), 'svg-vsix-artifact-'));
try {
  execFileSync(process.env.PYTHON || 'python3', ['-c', `
import pathlib, stat, sys, zipfile
archive, target = sys.argv[1:]
with zipfile.ZipFile(archive) as package:
    for member in package.infolist():
        path = pathlib.PurePosixPath(member.filename)
        if path.is_absolute() or '..' in path.parts or '\\\\' in member.filename:
            raise ValueError('invalid archive path: ' + member.filename)
        if stat.S_ISLNK(member.external_attr >> 16):
            raise ValueError('archive symlinks are not supported')
        if member.filename.startswith('extension/node_modules/'):
            raise ValueError('package unexpectedly contains node_modules')
    package.extractall(target)
`, packagePath, temporary], { stdio: 'inherit' });
  const extension = join(temporary, 'extension');
  const manifest = JSON.parse(readFileSync(join(extension, 'package.json'), 'utf8'));
  assert.equal(manifest.main, './dist/extension.cjs');
  assert(existsSync(join(extension, 'dist/extension.cjs')), 'standalone extension bundle is required');
  assert(!existsSync(join(extension, 'node_modules')), 'artifact must run without a node_modules directory');
  assert(!existsSync(join(extension, 'dist/src')), 'compiled development sources must not be packaged');
  assert(!existsSync(join(extension, 'dist/test')), 'compiled tests must not be packaged');
  const result = spawnSync(process.execPath, [join(__dirname, 'test-host.cjs')], {
    cwd: sourceExtension,
    stdio: 'inherit',
    env: {
      ...process.env,
      SVG_LAB_EXTENSION_PATH: extension,
      SVG_LAB_EXPECT_PACKAGED: '1',
      SVG_LAB_PACKAGE_SHA256: createHash('sha256').update(readFileSync(packagePath)).digest('hex'),
      SVG_LAB_EVIDENCE: process.env.SVG_LAB_EVIDENCE
        || resolve(sourceExtension, '../../doc/vscode-vsix-evidence.json'),
    },
  });
  if (result.error) throw result.error;
  assert.equal(result.signal, null, `packaged host test terminated by ${result.signal}`);
  assert.equal(result.status, 0, `packaged host test exited with ${result.status}`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
