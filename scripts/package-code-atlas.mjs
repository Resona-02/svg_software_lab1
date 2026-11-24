import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
if (git(['status', '--porcelain'])) throw new Error('Commit source and acceptance records before packaging.');
const evidence = JSON.parse(await readFile(resolve(root, 'doc/code-atlas-verification.json'), 'utf8'));
if (!evidence.desktopAcceptance) throw new Error('Real Desktop acceptance must be recorded before delivery.');
const packagePath = resolve(root, 'extensions/dsh-code-atlas/artifacts/dsh-code-atlas-0.1.0.tgz');
const digest = createHash('sha256').update(await readFile(packagePath)).digest('hex');
if (digest !== evidence.packageSha256) throw new Error('Rebuilt package differs from the accepted archive. Repeat installed-package verification.');
const commit = git(['rev-parse', 'HEAD']);
const output = resolve(root, 'artifacts/code-atlas-v0.1.0.zip');
await mkdir(dirname(output), { recursive: true });
const staging = await mkdtemp(resolve(tmpdir(), 'code-atlas-delivery-'));
try {
  await writeFile(output, execFileSync('git', ['archive', '--format=zip', '--prefix=CodeAtlas/source/', commit], { cwd: root, maxBuffer: 64 * 1024 * 1024 }));
  const delivery = resolve(staging, 'CodeAtlas');
  await mkdir(resolve(delivery, 'packages'), { recursive: true });
  await cp(packagePath, resolve(delivery, 'packages/dsh-code-atlas-0.1.0.tgz'));
  await writeFile(resolve(delivery, 'manifest.json'), JSON.stringify({ version: '0.1.0', branch: 'feat/dsh-code-atlas',
    sourceCommit: commit, packageSha256: digest, desktop: '2.0.16', dsh: '0.2.0-rc.1', cordis: '4.0.4' }, null, 2) + '\n');
  await writeFile(resolve(delivery, 'START-HERE.md'), `# Code Atlas 交付包\n\n源码版本：${commit}\n\n安装包在 packages/，完整源码、截图、示例和验收记录在 source/。\n\n在本目录运行：\n\n\`\`\`sh\nnode source/extensions/dsh-code-atlas/scripts/local-desktop.mjs install packages/dsh-code-atlas-0.1.0.tgz\nnode source/extensions/dsh-code-atlas/scripts/local-desktop.mjs launch\n\`\`\`\n\n目标版本为 DSH Desktop 2.0.16；安装到独立 code-atlas 测试环境。用法与卸载步骤见 source/extensions/dsh-code-atlas/README.md，实际验收见 source/doc/code-atlas-verification.md。\n`);
  execFileSync('zip', ['-qr', output, 'CodeAtlas'], { cwd: staging });
  console.log(`Created ${output} from committed source ${commit}.`);
} finally { await rm(staging, { recursive: true, force: true }); }
