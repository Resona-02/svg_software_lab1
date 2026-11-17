import type { Plugin, PluginContext } from '../../src/api/index.js';
import { StatsProvider } from './StatsProvider.js';

export class StatsPlugin implements Plugin {
  activate(context: PluginContext): void {
    context.registerCommand(new StatsProvider());
  }
}
