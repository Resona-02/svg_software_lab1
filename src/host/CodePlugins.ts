import type { CodePluginEntry } from './PluginLoader.js';

/** Method A: the only assembly file changed when adding optional plugins. */
export class CodePlugins {
  static readonly entries: readonly CodePluginEntry[] = [];
}
