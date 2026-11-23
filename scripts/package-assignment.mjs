import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const commit = git('rev-parse', 'HEAD');
assert.equal(git('status', '--porcelain'), '', 'Commit the source and evidence before packaging the assignment.');
const vsix = resolve(root, 'extensions/vscode-svg/svg-software-lab-0.1.0.vsix');
const dsh = resolve(root, 'extensions/dsh-svg/artifacts/dsh-svg-workbench-0.1.0.tgz');
const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const vsixEvidence = JSON.parse(readFileSync(resolve(root, 'doc/vscode-vsix-evidence.json'), 'utf8'));
const dshEvidence = JSON.parse(readFileSync(resolve(root, 'doc/dsh-package-evidence.json'), 'utf8'));
assert.equal(vsixEvidence.passed, true, 'VSIX package verification must pass.');
assert.equal(vsixEvidence.packageSha256, sha256(vsix), 'VSIX changed; rerun its test:vsix before packaging.');
assert.equal(dshEvidence.passed, true, 'DSH package verification must pass.');
assert.equal(dshEvidence.packageSha256, sha256(dsh), 'DSH package changed; rerun verify:package before packaging.');
const artifacts = resolve(root, 'artifacts');
mkdirSync(artifacts, { recursive: true });
const output = join(artifacts, 'Lab1-Phase2-complete.zip');
const temporary = mkdtempSync(join(tmpdir(), 'svg-assignment-'));
try {
  const archive = join(temporary, 'source.zip');
  writeFileSync(archive, execFileSync('git', ['archive', '--format=zip', '--prefix=svg_software_lab1/', commit], { cwd: root, maxBuffer: 32 * 1024 * 1024 }));
  const manifest = {
    repository: 'https://github.com/Resona-02/svg_software_lab1',
    branch: 'phase2-complete', commit,
    source: 'Committed Git archive; excludes dependencies and generated development directories.',
    packages: {
      'svg-software-lab-0.1.0.vsix': sha256(vsix),
      'dsh-svg-workbench-0.1.0.tgz': sha256(dsh),
    },
  };
  const manifestPath = join(temporary, 'delivery.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  execFileSync(process.env.PYTHON || 'python3', ['-c', `
import shutil, sys, zipfile
source, output, vsix, dsh, manifest = sys.argv[1:]
shutil.copyfile(source, output)
with zipfile.ZipFile(output, 'a', compression=zipfile.ZIP_DEFLATED) as package:
    package.write(vsix, 'svg_software_lab1/artifacts/svg-software-lab-0.1.0.vsix')
    package.write(dsh, 'svg_software_lab1/artifacts/dsh-svg-workbench-0.1.0.tgz')
    package.write(manifest, 'svg_software_lab1/artifacts/delivery.json')
`, archive, output, vsix, dsh, manifestPath], { stdio: 'inherit' });
  console.log(`Assignment archive: ${output}`);
  console.log(`Source commit: ${commit}`);
  console.log(`SHA-256: ${sha256(output)}`);
} finally { rmSync(temporary, { recursive: true, force: true }); }
