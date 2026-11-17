import type { Plugin, PluginContext } from '../../src/api/index.js';
import { BoxProvider } from './BoxProvider.js';
import { BoxAttributes } from './BoxAttributes.js';
import { BoxTypeLabel } from './BoxTypeLabel.js';

export class BoxPlugin implements Plugin {
  activate(context: PluginContext, options?: unknown): void {
    let fill: string | undefined;
    if (options !== undefined) {
      if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('box options must be an object');
      const value = (options as Record<string, unknown>).fill;
      if (value !== undefined && typeof value !== 'string') throw new Error('box fill option must be a string');
      fill = value as string | undefined;
    }
    context.registerShape(new BoxProvider(fill));
    context.registerAttribute(new BoxAttributes());
    context.registerDecorator(new BoxTypeLabel());
  }
}
