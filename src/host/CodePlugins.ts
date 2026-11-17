import box, { manifest as boxManifest } from '../../plugins/shape-box/index.js';
import type { CodePluginEntry } from './PluginLoader.js';
import stats, { manifest as statsManifest } from '../../plugins/command-stats/index.js';
import dir, { manifest as dirManifest } from '../../plugins/command-dir/index.js';

/** Method A: the only assembly file changed when adding optional plugins. */
export class CodePlugins {
  static readonly entries: readonly CodePluginEntry[] = [
    { plugin: stats, manifest: statsManifest },
    { plugin: dir, manifest: dirManifest },
    { plugin: box, manifest: boxManifest },
  ];
}
