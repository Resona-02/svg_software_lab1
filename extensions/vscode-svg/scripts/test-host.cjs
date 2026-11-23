const { runTests } = require('@vscode/test-electron');
const { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');

async function main() {
  const sourceExtension = resolve(__dirname, '..');
  const extension = process.env.SVG_LAB_EXTENSION_PATH
    ? resolve(process.env.SVG_LAB_EXTENSION_PATH) : sourceExtension;
  const temporary = mkdtempSync(join(tmpdir(), 'svg-vscode-host-'));
  const workspace = join(temporary, 'workspace');
  const profile = join(temporary, 'profile');
  const evidence = process.env.SVG_LAB_EVIDENCE || resolve(sourceExtension, '../../doc/vscode-host-evidence.json');
  cpSync(join(extension, 'examples'), workspace, { recursive: true });
  mkdirSync(join(profile, 'User'), { recursive: true });
  writeFileSync(join(profile, 'User', 'settings.json'), JSON.stringify({
    'workbench.startupEditor': 'none',
    'update.mode': 'none',
    'extensions.autoUpdate': false,
    'files.hotExit': 'off',
  }));
  const installedMac = [
    '/Applications/Visual Studio Code.app/Contents/MacOS/Code',
    '/Applications/Visual Studio Code.app/Contents/MacOS/Electron',
  ].find(existsSync);
  const vscodeExecutablePath = process.env.VSCODE_EXECUTABLE_PATH
    || (process.platform === 'darwin' ? installedMac : undefined);
  try {
    await runTests({
      version: process.env.VSCODE_VERSION || '1.146.0',
      ...(vscodeExecutablePath ? { vscodeExecutablePath } : {}),
      extensionDevelopmentPath: extension,
      extensionTestsPath: join(sourceExtension, 'dist/test/integration/index.js'),
      extensionTestsEnv: {
        SVG_LAB_EVIDENCE: evidence,
        SVG_LAB_EXPECTED_EXTENSION_PATH: extension,
        SVG_LAB_EXPECT_PACKAGED: process.env.SVG_LAB_EXPECT_PACKAGED || '',
        SVG_LAB_PACKAGE_SHA256: process.env.SVG_LAB_PACKAGE_SHA256 || '',
      },
      launchArgs: [
        workspace,
        '--user-data-dir', profile,
        '--extensions-dir', join(temporary, 'extensions'),
        '--skip-welcome', '--skip-release-notes',
        '--disable-updates',
      ],
    });
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error('SVG Extension Host verification failed:', error);
  process.exitCode = 1;
});
