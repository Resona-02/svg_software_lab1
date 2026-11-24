import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// All profile, package-manager, and Electron state stays in this disposable home.
const home = '/private/tmp/atlas-dsh-home';
const profile = 'code-atlas';
const userData = join(home, 'desktop-user-data');
const app = process.env.ATLAS_DSH_APP ?? '/Applications/DSH Desktop.app';
const executable = join(app, 'Contents/MacOS/DSH Desktop');
const resources = join(app, 'Contents/Resources/app');
const cli = join(resources, 'lib/desktop-cli.js');
const project = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const profileDir = join(home, 'profiles', profile);
const selection = join(userData, 'profile-selection/state.json');
const exists = path => access(path).then(() => true, () => false);
const env = { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' };
delete env.ELECTRON_RUN_AS_NODE;
// Native verification imports SDK modules in this process as well as children.
process.env.DSH_HOME = home;
process.env.DSH_TELEMETRY_DISABLED = '1';

function sanitized(line) {
  return line.replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/(https?:\/\/)[^\s/:@]+:[^\s@]+@/gi, '$1[redacted]@')
    .replace(/([?&](?:token|key|auth|access_token|secret)=)[^\s&]+/gi, '$1[redacted]')
    .replace(/(authorization\s*[:=]\s*)(?:Bearer\s+)?[^\s,}]+/gi, '$1[redacted]')
    .replace(/((?:"|')?(?:apiKey|api_key|accessToken|refreshToken|password|secret)(?:"|')?\s*[:=]\s*["'])[^"']*/gi, '$1[redacted]');
}
async function run(args, { environment = env, capture = false, log } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { env: environment, cwd: project,
      stdio: capture || log ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
    let stdout = '', stderr = '';
    if (capture) {
      child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
      child.stdout.on('data', chunk => stdout += chunk);
      child.stderr.on('data', chunk => stderr += chunk);
    }
    const output = log ? createWriteStream(log, { flags: 'w', mode: 0o600 }) : undefined;
    if (output) for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding('utf8');
      let remainder = '';
      const write = line => { const clean = sanitized(line); output.write(`${clean}\n`); process.stdout.write(`${clean}\n`); };
      stream.on('data', chunk => {
        const lines = (remainder + chunk).split('\n'); remainder = lines.pop() ?? '';
        lines.forEach(write);
      });
      stream.on('end', () => { if (remainder) write(remainder); });
    }
    child.on('error', reject);
    child.on('close', (code, terminationSignal) => {
      output?.end();
      if (code === 0) resolve(stdout);
      else reject(new Error(`DSH exited ${terminationSignal ?? code}${capture ? `: ${stderr.trim()}` : ''}`));
    });
  });
}
async function packagedCli(args, options = {}) {
  return run([cli, ...args], { ...options,
    environment: { ...(options.environment ?? env), ELECTRON_RUN_AS_NODE: '1' } });
}
async function validateInstallation() {
  await access(executable);
  const manifest = JSON.parse(await readFile(join(resources, 'node_modules/@deepseek-ai/dsh/package.json'), 'utf8'));
  if (manifest.version !== '0.2.0-rc.1') throw new Error(`This plugin targets DSH 0.2.0-rc.1; installed DSH is ${manifest.version}.`);
}
async function profileManager() {
  return import(pathToFileURL(join(resources, 'lib/profile-manager.js')).href);
}
async function init() {
  await mkdir(home, { recursive: true });
  if (!await exists(join(profileDir, 'package.json'))) {
    const composition = await packagedCli(['--profile', profile, '--from-default-profile', 'web', '--dump-default-config'], { capture: true });
    await writeFile(join(home, 'shipped-profile.yml'), composition);
  }
  const manager = await profileManager();
  const summary = manager.listDesktopProfiles(home).find(item => item.name === profile);
  if (!summary?.webCapable || summary.problem) throw new Error(`The isolated profile is not Desktop-capable: ${summary?.problem ?? 'missing base/web bundles'}`);
  // Use the Desktop's own validated, atomic selection-state writer.
  manager.selectDesktopProfile(selection, home, profile);
  console.log(`Prepared isolated Desktop profile: ${profileDir}`);
}
async function install(tarball) {
  if (!tarball || !tarball.endsWith('.tgz')) throw new Error('Usage: node scripts/local-desktop.mjs install /absolute/path/dsh-code-atlas-0.1.0.tgz');
  const archive = resolve(tarball);
  if (!(await stat(archive)).isFile()) throw new Error('The plugin archive must be a regular .tgz file.');
  await packageCommand(['add', archive]);
}
async function packageCommand(args) {
  await init();
  const runtimeModule = await import(pathToFileURL(join(resources, 'lib/desktop-runtime-environment.js')).href);
  const electronVersion = (await run(['-p', 'process.versions.electron'], { capture: true,
    environment: { ...env, ELECTRON_RUN_AS_NODE: '1' } })).trim();
  const packageEnv = { ...env, npm_config_userconfig: join(home, 'empty.npmrc'),
    npm_config_globalconfig: join(home, 'empty.npmrc'), npm_config_cache: join(home, 'npm-cache') };
  await writeFile(packageEnv.npm_config_userconfig, '');
  const runtime = runtimeModule.installDesktopPnpmRuntime({ platform: process.platform,
    appExecutable: executable, pnpmBinPath: join(resources, 'node_modules/pnpm/bin/pnpm.cjs'),
    electronVersion, stateDir: join(home, 'runtime-commands'), environment: packageEnv });
  try {
    await packagedCli(['plugin', '--profile', profile, ...args,
      `--store-dir=${join(home, 'pnpm-store')}`, `--config.cacheDir=${join(home, 'pnpm-cache')}`,
      '--registry=https://registry.npmjs.org', '--reporter=append-only'], { environment: packageEnv });
  } finally { runtime.dispose(); }
}
async function launch(workspace = project) {
  const cwd = resolve(workspace);
  if (!(await stat(cwd)).isDirectory()) throw new Error('Choose an existing workspace directory.');
  await init();
  console.log(`Launching isolated Desktop; data directory: ${userData}`);
  // Electron 44 applies this switch before its main script resolves userData:
  // https://github.com/electron/electron/blob/v44.0.0/shell/app/electron_main_delegate.cc#L233
  const args = [`--user-data-dir=${userData}`, `--dsh-desktop-workspace=${cwd}`];
  await writeFile(join(home, 'launch-record.json'), JSON.stringify({ home, profile, userData,
    workspace: cwd, executable, args, startedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
  await run(args, { log: join(home, 'launch-sanitized.log') });
}
async function verify(workspace = project) {
  await init();
  const requireProfile = createRequire(join(profileDir, 'package.json'));
  const requireDesktop = createRequire(join(resources, 'package.json'));
  const { installProfilePackageResolver } = await import(pathToFileURL(join(resources, 'lib/module-resolution.js')).href);
  const release = installProfilePackageResolver(pathToFileURL(join(profileDir, 'package.json')).href);
  const fibers = [];
  try {
    const packageEntry = requireProfile.resolve('dsh-code-atlas');
    const typescriptEntry = requireProfile.resolve('typescript/unstable/sync');
    if (!packageEntry.startsWith(`${profileDir}/`) || !typescriptEntry.startsWith(`${profileDir}/`)) throw new Error('Verification must use the installed profile package and TypeScript, outside the repository.');
    const sdk = name => import(pathToFileURL(requireDesktop.resolve(`@deepseek-ai/${name}`)).href);
    const [{ Context }, { LocalFileSystem }, { SessionStore }, { SystemPrompt }, { ToolRuntime }, { TypertRegistry }, { TypertGatewayService }, plugin, { TYPERT }] = await Promise.all([
      sdk('cordis'), sdk('dsh-fs-local'), sdk('dsh-session'), sdk('dsh-system-prompt'), sdk('dsh-tools'),
      sdk('dsh-typert-registry'), sdk('dsh-api-gateway'), import(pathToFileURL(packageEntry).href),
      import(pathToFileURL(requireProfile.resolve('dsh-code-atlas/typert')).href),
    ]);
    const ctx = new Context();
    for (const definition of [TypertRegistry, LocalFileSystem, SessionStore, SystemPrompt, ToolRuntime, TypertGatewayService]) fibers.push(await ctx.plugin(definition, {}));
    ctx.sessions.create('code-atlas-installed-verification', { meta: { cwd: resolve(workspace) } });
    fibers.push(await ctx.plugin({ inject: ['typert'], apply(ctx) { ctx.typert.register(TYPERT); } }));
    fibers.push(await ctx.plugin(plugin));
    const view = await ctx.typertGateway.invoke({ namespace: 'codeAtlas', method: 'scan', args: { sessionId: 'code-atlas-installed-verification' } });
    TYPERT.invocations.find(item => item.method === 'scan').result.create().parse(view);
    if (!view.snapshot.nodes.length || !view.svg.includes('<svg')) throw new Error('The installed native analyzer did not produce a source map.');
    const record = { packageEntry, typescriptEntry, desktopSdk: requireDesktop.resolve('@deepseek-ai/cordis'),
      workspace: resolve(workspace), nodes: view.snapshot.nodes.length, relations: view.snapshot.relations.length,
      nativeTools: ctx.tools.schemas().filter(item => item.name.startsWith('code_atlas_')).length,
      nativeRpc: ctx.typert.local.list().filter(item => item.namespace === 'codeAtlas').length,
      svg: true, verifiedAt: new Date().toISOString() };
    await writeFile(join(home, 'installed-verification.json'), JSON.stringify(record, null, 2), { mode: 0o600 });
    console.log(JSON.stringify(record, null, 2));
  } finally { for (const fiber of fibers.reverse()) await fiber.dispose(); release(); }
}
async function status() {
  const manager = await profileManager();
  console.log(JSON.stringify({ home, profile, userData,
    selected: manager.readDesktopProfileState(selection).active,
    profiles: manager.listDesktopProfiles(home).map(({ name, webCapable, problem }) => ({ name, webCapable, problem })) }, null, 2));
}
const [action = 'help', value] = process.argv.slice(2);
try {
  if (action === 'help') console.log('Isolated local DSH Desktop verification:\n  node scripts/local-desktop.mjs init\n  node scripts/local-desktop.mjs install <plugin.tgz>\n  node scripts/local-desktop.mjs uninstall\n  node scripts/local-desktop.mjs verify [workspace]\n  node scripts/local-desktop.mjs launch [workspace]\n  node scripts/local-desktop.mjs status');
  else {
    await validateInstallation();
    if (action === 'init') await init();
    else if (action === 'install') await install(value);
    else if (action === 'uninstall') await packageCommand(['remove', 'dsh-code-atlas']);
    else if (action === 'launch') await launch(value);
    else if (action === 'verify') await verify(value);
    else if (action === 'status') await status();
    else throw new Error(`Unknown action: ${action}`);
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
