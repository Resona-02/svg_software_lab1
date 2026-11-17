import { readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Plugin, PluginManifest } from '../application/Plugin.js';
import { ExtensionRegistry } from '../application/ExtensionRegistry.js';

export interface CodePluginEntry {
  readonly plugin: Plugin;
  readonly manifest: PluginManifest;
  readonly options?: unknown;
}
interface ConfigPluginEntry {
  readonly module: string;
  readonly enabled?: boolean;
  readonly options?: unknown;
}

/** Resolves packages at the host boundary; it knows no concrete plugin or extension name. */
export class PluginLoader {
  constructor(private readonly registry: ExtensionRegistry, private readonly report: (message: string) => void) {}

  async loadCode(entries: readonly CodePluginEntry[]): Promise<void> {
    for (const entry of entries) await this.activate(entry);
  }

  async loadConfig(configPath: string): Promise<void> {
    let entries: readonly ConfigPluginEntry[];
    try {
      entries = this.parseConfig(JSON.parse(await readFile(configPath, 'utf8')));
    } catch {
      this.report('error: invalid plugin config');
      return;
    }
    const base = dirname(resolve(configPath));
    for (const entry of entries) {
      if (entry.enabled !== false) await this.loadModule(entry, base);
    }
  }

  private async activate(entry: CodePluginEntry): Promise<void> {
    try {
      await this.registry.activate(entry.plugin, entry.manifest, entry.options);
    } catch (error) {
      this.report(`error: ${this.reason(error)}`);
    }
  }

  private async loadModule(entry: ConfigPluginEntry, base: string): Promise<void> {
    // Only resolution errors identify a missing top-level module. Errors from import()
    // (including a missing transitive dependency) are reported as activation failures.
    let resolved: string;
    const resolver = createRequire(join(base, '__svg_plugin_host__.cjs'));
    try {
      resolved = resolver.resolve(entry.module);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND') {
        this.report(`error: plugin not found: ${entry.module}`);
      } else {
        this.report(`error: plugin failed to activate: ${entry.module} (${this.reason(error)})`);
      }
      return;
    }
    let manifest: PluginManifest;
    try {
      manifest = await this.readManifest(entry.module, resolved, base);
    } catch (error) {
      this.report(`error: plugin failed to activate: ${entry.module} (${this.reason(error)})`);
      return;
    }
    let imported: { default?: Plugin };
    try {
      imported = await import(pathToFileURL(resolved).href) as { default?: Plugin };
    } catch (error) {
      this.report(`error: plugin failed to activate: ${manifest?.name ?? entry.module} (${this.reason(error)})`);
      return;
    }
    if (!Object.hasOwn(imported, 'default')) {
      this.report(`error: plugin has no default export: ${entry.module}`);
      return;
    }
    await this.activate({ plugin: imported.default as Plugin, manifest, options: entry.options });
  }

  private parseConfig(value: unknown): readonly ConfigPluginEntry[] {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid config');
    const entries = (value as Record<string, unknown>).plugins;
    if (!Array.isArray(entries)) throw new Error('invalid config');
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)
        || typeof entry.module !== 'string' || !entry.module.trim()
        || (entry.enabled !== undefined && typeof entry.enabled !== 'boolean')) {
        throw new Error('invalid config');
      }
    }
    return entries as ConfigPluginEntry[];
  }

  private async readManifest(specifier: string, resolved: string, base: string): Promise<PluginManifest> {
    // A package may place its compiled entry outside its source directory. In that
    // case use the selected package's manifest, not an unrelated ancestor of dist/.
    if (specifier.startsWith('.') || isAbsolute(specifier)) {
      const requested = resolve(base, specifier);
      if ((await stat(requested).catch(() => undefined))?.isDirectory()) {
        return JSON.parse(await readFile(join(requested, 'package.json'), 'utf8')) as PluginManifest;
      }
    } else {
      const packageName = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
      const paths = createRequire(join(base, '__svg_plugin_host__.cjs')).resolve.paths(specifier) ?? [];
      for (const path of paths) {
        try {
          return JSON.parse(await readFile(join(path, packageName, 'package.json'), 'utf8')) as PluginManifest;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
    }
    let directory = dirname(resolved);
    for (;;) {
      try {
        return JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as PluginManifest;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      const parent = dirname(directory);
      if (parent === directory) throw new Error('package.json not found');
      directory = parent;
    }
  }

  private reason(error: unknown): string {
    return (error instanceof Error ? error.message : String(error)).replace(/[\r\n]+/g, ' ');
  }
}
