import type { ShapeProvider } from '../domain/ShapeProvider.js';
import type { CommandProvider } from './CommandProvider.js';
import type { AttributeHandler } from './AttributeHandler.js';
import type { TreeDecorator } from './TreeDecorator.js';
import type { ExtensionSet, Plugin, PluginContext, PluginManifest } from './Plugin.js';

/** One activation is a transaction: consumers only see successfully validated plugins. */
export class ExtensionRegistry implements ExtensionSet {
  private readonly shapeProviders = new Map<string, ShapeProvider>();
  private readonly commandProviders = new Map<string, CommandProvider>();
  private readonly treeDecorators = new Map<string, TreeDecorator>();
  private readonly attributeHandlers = new Map<string, AttributeHandler>();

  get shapes(): ReadonlyMap<string, ShapeProvider> { return this.shapeProviders; }
  get commands(): ReadonlyMap<string, CommandProvider> { return this.commandProviders; }
  get decorators(): ReadonlyMap<string, TreeDecorator> { return this.treeDecorators; }
  get attributes(): ReadonlyMap<string, AttributeHandler> { return this.attributeHandlers; }

  async activate(plugin: Plugin, manifest: PluginManifest, options?: unknown): Promise<void> {
    const pending = {
      shapes: new Map<string, ShapeProvider>(),
      commands: new Map<string, CommandProvider>(),
      decorators: new Map<string, TreeDecorator>(),
      attributes: new Map<string, AttributeHandler>(),
    };
    let open = true;
    let registrationError: Error | undefined;
    const register = <T extends { readonly name: string }>(
      category: keyof ExtensionSet, instance: T, staged: Map<string, T>,
      committed: ReadonlyMap<string, T>, methods: readonly string[],
    ): void => {
      if (!open) throw new Error('plugin registration is closed');
      try {
        this.validateRegistration(instance, methods);
        if (staged.has(instance.name) || committed.has(instance.name)) {
          throw new Error(`duplicate registration: ${category}/${instance.name}`);
        }
        staged.set(instance.name, instance);
      } catch (error) {
        // A plugin cannot turn a rejected registration into a partial successful activation.
        registrationError ??= error instanceof Error ? error : new Error(String(error));
        throw registrationError;
      }
    };
    const context: PluginContext = Object.freeze({
      registerShape: (provider: ShapeProvider) => register('shapes', provider, pending.shapes, this.shapes, ['create', 'read']),
      registerCommand: (provider: CommandProvider) => register('commands', provider, pending.commands, this.commands, ['create']),
      registerDecorator: (decorator: TreeDecorator) => register('decorators', decorator, pending.decorators, this.decorators, ['decorate']),
      registerAttribute: (handler: AttributeHandler) => register('attributes', handler, pending.attributes, this.attributes, ['handles', 'apply']),
    });

    try {
      this.validateManifest(manifest);
      if (!plugin || typeof plugin.activate !== 'function') throw new Error('default export must implement activate');
      await plugin.activate(context, options);
    } catch (error) {
      if (registrationError?.message.startsWith('duplicate registration: ')) throw registrationError;
      throw new Error(`plugin failed to activate: ${manifest?.name ?? '(unnamed)'} (${this.reason(error)})`);
    } finally {
      open = false;
    }
    if (registrationError) {
      if (registrationError.message.startsWith('duplicate registration: ')) throw registrationError;
      throw new Error(`plugin failed to activate: ${manifest.name} (${this.reason(registrationError)})`);
    }
    const declared = this.names(manifest.contributes ?? {});
    const registered = this.names({
      shapes: [...pending.shapes.keys()], commands: [...pending.commands.keys()],
      decorators: [...pending.decorators.keys()], attributes: [...pending.attributes.keys()],
    });
    if (declared !== registered) {
      throw new Error(`plugin manifest mismatch: ${manifest.name} (declared: ${declared}, registered: ${registered})`);
    }
    // Recheck after await: concurrent activations must not overwrite one another.
    for (const category of ['shapes', 'commands', 'decorators', 'attributes'] as const) {
      for (const name of pending[category].keys()) {
        if (this[category].has(name)) throw new Error(`duplicate registration: ${category}/${name}`);
      }
    }
    this.commit(pending.shapes, this.shapeProviders);
    this.commit(pending.commands, this.commandProviders);
    this.commit(pending.decorators, this.treeDecorators);
    this.commit(pending.attributes, this.attributeHandlers);
  }

  private validateRegistration(instance: unknown, methods: readonly string[]): void {
    if (!instance || typeof instance !== 'object') throw new Error('registration must be an object');
    const value = instance as Record<string, unknown>;
    if (typeof value.name !== 'string' || !value.name.trim()) throw new Error('registration requires a nonempty name');
    for (const method of methods) {
      if (typeof value[method] !== 'function') throw new Error(`registration ${value.name} requires ${method}`);
    }
    if (methods.includes('create') && !methods.includes('read') && typeof value.syntax !== 'string') {
      throw new Error(`registration ${value.name} requires syntax`);
    }
  }

  private validateManifest(manifest: PluginManifest): void {
    if (!manifest || typeof manifest.name !== 'string' || !manifest.name.trim()) throw new Error('invalid plugin manifest');
    const contributes = manifest.contributes;
    if (contributes === undefined) return;
    if (!contributes || typeof contributes !== 'object' || Array.isArray(contributes)) throw new Error('invalid plugin manifest');
    for (const category of ['shapes', 'commands', 'decorators', 'attributes'] as const) {
      const names = contributes[category];
      if (names !== undefined && (!Array.isArray(names) || names.some(name => typeof name !== 'string' || !name.trim()))) {
        throw new Error('invalid plugin manifest');
      }
    }
  }

  private names(contributes: NonNullable<PluginManifest['contributes']>): string {
    return JSON.stringify({
      shapes: [...new Set(contributes.shapes ?? [])].sort(),
      commands: [...new Set(contributes.commands ?? [])].sort(),
      decorators: [...new Set(contributes.decorators ?? [])].sort(),
      attributes: [...new Set(contributes.attributes ?? [])].sort(),
    });
  }

  private commit<T>(pending: ReadonlyMap<string, T>, target: Map<string, T>): void {
    for (const [name, instance] of pending) target.set(name, instance);
  }

  private reason(error: unknown): string {
    return (error instanceof Error ? error.message : String(error)).replace(/[\r\n]+/g, ' ');
  }
}
