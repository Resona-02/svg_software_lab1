import { createHash } from 'node:crypto';
import { isAbsolute, posix } from 'node:path';
import ignore, { type Ignore } from 'ignore';
import type { FileSystem } from '@deepseek-ai/dsh-fs';
import type { CodeSource, SourceFile, SourceSnapshot } from '../core/types.js';

type Target = Awaited<ReturnType<FileSystem['resolve']>>;
interface IgnoreRule { readonly base: string; readonly matcher: Ignore }

/** Adapts DSH's filesystem identity and containment rules to bounded source snapshots. */
export class DshCodeSource implements CodeSource {
  private readonly excluded = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', 'artifacts', '.vscode-test']);
  constructor(private readonly fs: FileSystem,
    private readonly limits = { files: 2000, fileBytes: 1024 * 1024, totalBytes: 32 * 1024 * 1024, directories: 10000 }) {}

  async snapshot(root: string, signal = new AbortController().signal): Promise<SourceSnapshot> {
    signal.throwIfAborted();
    const rootTarget = await this.root(root, signal);
    const files: SourceFile[] = [];
    const visited = new Set<string>();
    const directoryRules = new Map<string, readonly IgnoreRule[]>();
    let bytes = 0;
    const read = async (target: Target, path: string): Promise<string> => {
      const content = await this.content(rootTarget, target, path, signal);
      bytes += Buffer.byteLength(content, 'utf8');
      if (bytes > this.limits.totalBytes) throw new Error(`INPUT_LIMIT: source snapshot exceeds ${this.limits.totalBytes} bytes`);
      return content;
    };
    const walk = async (directory: Target, base: string, inherited: readonly IgnoreRule[]): Promise<void> => {
      signal.throwIfAborted();
      const key = String(directory.targetKey);
      if (visited.has(key)) return;
      visited.add(key);
      if (visited.size > this.limits.directories) throw new Error('INPUT_LIMIT: too many source directories');
      const entries = [...await this.fs.listDir(directory, signal)].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
      const rules = [...inherited];
      const gitignore = entries.find(entry => entry.name === '.gitignore' && entry.type === 'file');
      if (gitignore && this.fs.contains(rootTarget, gitignore.target)) {
        rules.push({ base, matcher: ignore().add(await read(gitignore.target, `${base}.gitignore`)) });
      }
      directoryRules.set(base, rules);
      for (const entry of entries) {
        signal.throwIfAborted();
        if (this.excluded.has(entry.name) || !this.fs.contains(rootTarget, entry.target)) continue;
        const path = `${base}${entry.name}`;
        // Keep one project-relative identity per file. Directory aliases can
        // otherwise bypass the ignore rules at their original source location.
        if ((await this.fs.lstat(path, { cwd: this.fs.processPath(rootTarget) }, signal))?.type === 'symlink') continue;
        // Aliases into ignored trees must not turn dependencies into source.
        const canonical = posix.relative(this.fs.processPath(rootTarget), this.fs.processPath(entry.target));
        if (canonical.split('/').some(part => this.excluded.has(part))) continue;
        const directory = entry.type === 'directory';
        if (this.ignored(path, directory, rules)) continue;
        if (directory) {
          await walk(entry.target, `${path}/`, rules);
        } else if (entry.type === 'file' && this.supported(entry.name)) {
          if (files.length >= this.limits.files) throw new Error(`INPUT_LIMIT: source snapshot exceeds ${this.limits.files} files`);
          const content = await read(entry.target, path);
          files.push(this.file(path, content));
        }
      }
    };
    await walk(rootTarget, '', []);
    // Config inheritance may reference a JSON file whose name is not tsconfig.*.
    // Include only project-local configuration: dependencies remain excluded.
    const byPath = new Map(files.map(file => [file.path, file]));
    const queue = files.filter(file => /^tsconfig.*\.json$/i.test(posix.basename(file.path)));
    const configs = new Set<string>();
    for (let index = 0; index < queue.length; index++) {
      const config = queue[index]!;
      if (configs.has(config.path)) continue;
      configs.add(config.path);
      for (const value of this.configBases(config.content)) {
        if (typeof value !== 'string' || !(value.startsWith('.') || isAbsolute(value))) continue;
        const raw = isAbsolute(value) ? posix.relative(this.fs.processPath(rootTarget), value) : posix.join(posix.dirname(config.path), value);
        const path = posix.normalize(raw);
        if (path === '..' || path.startsWith('../') || path.split('/').some(part => this.excluded.has(part))) continue;
        for (const candidate of path.endsWith('.json') ? [path] : [path, `${path}.json`]) {
          const rules = directoryRules.get(`${posix.dirname(candidate)}/`) ?? directoryRules.get('') ?? [];
          if (this.ignored(candidate, false, rules)) break;
          const target = await this.fs.resolve(candidate, { cwd: this.fs.processPath(rootTarget), signal });
          if (!this.fs.contains(rootTarget, target) || (await this.fs.stat(target, signal))?.type !== 'file') continue;
          const canonical = posix.relative(this.fs.processPath(rootTarget), this.fs.processPath(target));
          if (canonical.split('/').some(part => this.excluded.has(part))) continue;
          const canonicalRules = directoryRules.get(`${posix.dirname(canonical)}/`) ?? directoryRules.get('') ?? [];
          if (this.ignored(canonical, false, canonicalRules)) continue;
          let file = byPath.get(candidate);
          if (!file) {
            if (files.length >= this.limits.files) throw new Error(`INPUT_LIMIT: source snapshot exceeds ${this.limits.files} files`);
            file = this.file(candidate, await read(target, candidate));
            files.push(file); byPath.set(candidate, file);
          }
          queue.push(file);
          break;
        }
      }
    }
    return { root: this.fs.processPath(rootTarget), files };
  }

  async read(root: string, file: string, signal = new AbortController().signal): Promise<SourceFile> {
    signal.throwIfAborted();
    if (!file || isAbsolute(file) || file.includes('\\') || file.split('/').includes('..') || posix.normalize(file) !== file) {
      throw new Error('SOURCE_OUTSIDE_WORKSPACE: source path must be a normalized project-relative path');
    }
    const rootTarget = await this.root(root, signal);
    const target = await this.fs.resolve(file, { cwd: this.fs.processPath(rootTarget), signal });
    return this.file(file, await this.content(rootTarget, target, file, signal));
  }

  private async root(path: string, signal: AbortSignal): Promise<Target> {
    if (!isAbsolute(path)) throw new Error('SOURCE_ROOT_REQUIRED: session workspace must be an absolute directory');
    const target = await this.fs.resolve(path, { signal });
    if ((await this.fs.stat(target, signal))?.type !== 'directory') throw new Error('SOURCE_ROOT_REQUIRED: session workspace is not a directory');
    return target;
  }

  private async content(root: Target, target: Target, path: string, signal: AbortSignal): Promise<string> {
    if (!this.fs.contains(root, target)) throw new Error(`SOURCE_OUTSIDE_WORKSPACE: ${path}`);
    const info = await this.fs.stat(target, signal);
    if (info?.type !== 'file') throw new Error(`SOURCE_NOT_FOUND: ${path}`);
    if (info.size !== undefined && info.size > this.limits.fileBytes) throw new Error(`INPUT_LIMIT: ${path} exceeds ${this.limits.fileBytes} bytes`);
    let content: string;
    try {
      // The provider caps the complete byte read even if a file grows after stat.
      const bytes = await this.fs.readBytes(target, signal, this.limits.fileBytes);
      if (bytes.includes(0)) throw new Error('binary source');
      content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (error) {
      if ((error as { code?: string }).code === 'FS_TOO_LARGE') throw new Error(`INPUT_LIMIT: ${path} exceeds ${this.limits.fileBytes} bytes`);
      if (error instanceof TypeError || (error instanceof Error && error.message === 'binary source')) throw new Error(`SOURCE_NOT_TEXT: ${path} is not UTF-8 source text`);
      throw error;
    }
    // Re-resolve after reading so a renamed symlink cannot silently change project membership.
    const current = await this.fs.resolve(path, { cwd: this.fs.processPath(root), signal });
    if (!this.fs.contains(root, current) || current.targetKey !== target.targetKey) throw new Error(`SOURCE_CHANGED: ${path}; refresh the project`);
    return content;
  }

  private supported(name: string): boolean {
    return /\.(?:[cm]?[jt]sx?)$/i.test(name) || /^tsconfig.*\.json$/i.test(name) || name === 'package.json';
  }

  private configBases(content: string): unknown[] {
    // Match quoted strings before comments/commas so URLs and escape sequences
    // inside valid JSON strings are preserved. The compiler reports syntax errors.
    const strings = '"(?:\\\\.|[^"\\\\])*"';
    const uncommented = content.replace(new RegExp(`${strings}|//[^\\n]*|/\\*[\\s\\S]*?\\*/`, 'g'), token =>
      token.startsWith('"') ? token : token.replace(/[^\n]/g, ' '));
    const json = uncommented.replace(new RegExp(`(${strings})|,\\s*([}\\]])`, 'g'), (_token, string: string | undefined, close: string) => string ?? close);
    try {
      const value = (JSON.parse(json) as { extends?: unknown } | null)?.extends;
      return Array.isArray(value) ? value : [value];
    } catch { return []; }
  }

  private ignored(path: string, directory: boolean, rules: readonly IgnoreRule[]): boolean {
    let ignored = false;
    for (const rule of rules) {
      const local = path.slice(rule.base.length) + (directory ? '/' : '');
      const result = rule.matcher.test(local);
      if (result.unignored) ignored = false;
      else if (result.ignored) ignored = true;
    }
    return ignored;
  }

  private file(path: string, content: string): SourceFile {
    return { path, content, hash: createHash('sha256').update(content).digest('hex') };
  }
}
