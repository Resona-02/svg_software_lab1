import type { Plugin, PluginContext } from '../../src/api/index.js';
import { DirProvider } from './DirProvider.js';
import { NodeDirectoryAdapter } from './NodeDirectoryAdapter.js';

export class DirPlugin implements Plugin {
  activate(context: PluginContext): void {
    context.registerCommand(new DirProvider(new NodeDirectoryAdapter()));
  }
}
