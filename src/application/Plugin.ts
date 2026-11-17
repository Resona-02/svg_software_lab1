import type { ShapeProvider } from '../domain/ShapeProvider.js';
import type { CommandProvider } from './CommandProvider.js';
import type { AttributeHandler } from './AttributeHandler.js';
import type { TreeDecorator } from './TreeDecorator.js';

export interface ExtensionSet {
  readonly shapes: ReadonlyMap<string, ShapeProvider>;
  readonly commands: ReadonlyMap<string, CommandProvider>;
  readonly decorators: ReadonlyMap<string, TreeDecorator>;
  readonly attributes: ReadonlyMap<string, AttributeHandler>;
}
export interface PluginContext {
  registerShape(provider: ShapeProvider): void;
  registerCommand(provider: CommandProvider): void;
  registerDecorator(decorator: TreeDecorator): void;
  registerAttribute(handler: AttributeHandler): void;
}
export interface Plugin {
  activate(context: PluginContext, options?: unknown): void | Promise<void>;
}
export interface PluginManifest {
  readonly name: string;
  readonly contributes?: {
    readonly shapes?: readonly string[];
    readonly commands?: readonly string[];
    readonly decorators?: readonly string[];
    readonly attributes?: readonly string[];
  };
}
