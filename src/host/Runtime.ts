import builtinShapes, { manifest as shapesManifest } from '../../plugins/builtin-shapes/index.js';
import builtinCommands, { manifest as commandsManifest } from '../../plugins/builtin-commands/index.js';
import { EditorSession } from '../application/EditorSession.js';
import { ExtensionRegistry } from '../application/ExtensionRegistry.js';
import { ShapeFactory } from '../domain/ShapeFactory.js';
import { SvgCodec } from '../infrastructure/SvgCodec.js';
import { SvgFileStore } from '../infrastructure/SvgFileStore.js';
import { CommandFactory } from '../cli/CommandFactory.js';
import { CommandDispatcher } from '../cli/CommandDispatcher.js';
import { CodePlugins } from './CodePlugins.js';
import { PluginLoader } from './PluginLoader.js';

/** Composition root shared by the CLI and integration tests. */
export class Runtime {
  readonly registry = new ExtensionRegistry();
  readonly session: EditorSession;
  readonly dispatcher: CommandDispatcher;
  readonly diagnostics: string[] = [];
  private readonly loader: PluginLoader;

  private constructor(report?: (message: string) => void) {
    this.loader = new PluginLoader(this.registry, message => {
      this.diagnostics.push(message);
      report?.(message);
    });
    this.session = new EditorSession(new SvgFileStore(new SvgCodec(new ShapeFactory(this.registry.shapes))), this.registry);
    this.dispatcher = new CommandDispatcher(new CommandFactory(this.session), this.session.executor);
  }

  static async create(report?: (message: string) => void): Promise<Runtime> {
    const runtime = new Runtime(report);
    await runtime.loader.loadCode([
      { plugin: builtinShapes, manifest: shapesManifest },
      { plugin: builtinCommands, manifest: commandsManifest },
    ]);
    return runtime;
  }

  async loadCode(): Promise<void> { await this.loader.loadCode(CodePlugins.entries); }
  async loadConfig(path: string): Promise<void> { await this.loader.loadConfig(path); }
}
