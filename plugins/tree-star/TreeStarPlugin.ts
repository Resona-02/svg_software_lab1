import type { Plugin, PluginContext } from '../../src/api/index.js';
import { ModifiedStar } from './ModifiedStar.js';

export class TreeStarPlugin implements Plugin {
  activate(context: PluginContext): void { context.registerDecorator(new ModifiedStar()); }
}
