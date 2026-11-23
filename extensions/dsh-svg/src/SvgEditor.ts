import { EditorSession, CommandArguments, ViewReceiver, ShapeFactory } from '../../../src/api/index.js';
import { ExtensionRegistry, SvgCodec } from '../../../src/api/integration.js';
import shapes, { manifest as shapesManifest } from '../../../plugins/builtin-shapes/index.js';
import commands, { manifest as commandsManifest } from '../../../plugins/builtin-commands/index.js';
import box, { manifest as boxManifest } from '../../../plugins/shape-box/index.js';
import star, { manifest as starManifest } from '../../../plugins/tree-star/index.js';
import { SvgMemoryStore } from './SvgMemoryStore.js';
import { SvgToolError } from './SvgToolError.js';

export const editOperations = ['create', 'delete', 'move', 'scale', 'set', 'group', 'ungroup', 'addto', 'front', 'back'] as const;
export type EditOperation = typeof editOperations[number];

/** DSH composition root reuses Phase 2 contracts, commands, codec and plugins. */
export class SvgEditor {
  private revision = 0;
  private constructor(readonly session: EditorSession, private readonly codec: SvgCodec,
    private readonly store: SvgMemoryStore) {}

  static async create(): Promise<SvgEditor> {
    const registry = new ExtensionRegistry();
    for (const [plugin, manifest] of [[shapes, shapesManifest], [commands, commandsManifest],
      [box, boxManifest], [star, starManifest]] as const) await registry.activate(plugin, manifest);
    const codec = new SvgCodec(new ShapeFactory(registry.shapes));
    const store = new SvgMemoryStore(codec);
    return new SvgEditor(new EditorSession(store, registry), codec, store);
  }

  async init(width: number, height: number) {
    const message = await this.session.init(width, height);
    this.revision++;
    return this.inspect(message);
  }

  async open(svg: string) {
    if (svg.length > 1_000_000) throw new SvgToolError('SVG source exceeds 1,000,000 characters', 'SVG_INPUT_LIMIT');
    this.store.import(svg);
    const message = await this.session.read('conversation.svg');
    this.revision++;
    return this.inspect(message);
  }

  async edit(operation: EditOperation, args: readonly string[]) {
    if (!(editOperations as readonly string[]).includes(operation)) throw new SvgToolError(`unsupported operation: ${operation}`, 'SVG_INVALID_OPERATION');
    if (args.length > 100 || args.some(value => value.length > 10_000)) throw new SvgToolError('Edit arguments exceed the documented size limits', 'SVG_INPUT_LIMIT');
    const provider = this.session.extensions.commands.get(operation)!;
    const command = provider.create(new CommandArguments(args.map(value => ({ value, quoted: false })), provider.syntax), this.session);
    const message = await this.session.executor.executeCommand(command);
    this.revision++;
    return this.inspect(message);
  }

  history(action: 'undo' | 'redo') {
    const message = action === 'undo' ? this.session.undo() : this.session.redo();
    this.revision++;
    return this.inspect(message);
  }

  inspect(message = 'SVG inspected', id?: string) {
    const view = new ViewReceiver(this.session);
    return {
      revision: this.revision, message,
      tree: view.tree(id),
      details: id === undefined ? '' : view.show(id),
      elements: this.session.document.count(),
      undoCount: this.session.history.undoCount,
      redoCount: this.session.history.redoCount,
    };
  }

  export() {
    return { ...this.inspect('SVG exported as text; use the host file tool to persist it'),
      svg: this.codec.encode(this.session.document), mimeType: 'image/svg+xml' as const };
  }
}
