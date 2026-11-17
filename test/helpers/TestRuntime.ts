import { EditorSession as CoreSession } from '../../src/application/EditorSession.js';
import { ShapeFactory as CoreFactory } from '../../src/domain/ShapeFactory.js';
import { SvgCodec as CoreCodec } from '../../src/infrastructure/SvgCodec.js';
import { SvgFileStore as CoreStore } from '../../src/infrastructure/SvgFileStore.js';
import type { DocumentStore, PluginContext, ExtensionSet, ShapeProvider, CommandProvider,
  TreeDecorator, AttributeHandler } from '../../src/api/index.js';
import { BuiltinShapesPlugin } from '../../plugins/builtin-shapes/BuiltinShapesPlugin.js';
import { BuiltinCommandsPlugin } from '../../plugins/builtin-commands/BuiltinCommandsPlugin.js';

/** 旧行为测试的组合根；默认能力不再隐藏在内核构造器里。 */
export class TestExtensions implements ExtensionSet, PluginContext {
  readonly shapes = new Map<string, ShapeProvider>();
  readonly commands = new Map<string, CommandProvider>();
  readonly decorators = new Map<string, TreeDecorator>();
  readonly attributes = new Map<string, AttributeHandler>();
  constructor() {
    new BuiltinShapesPlugin().activate(this);
    new BuiltinCommandsPlugin().activate(this);
  }
  registerShape(value: ShapeProvider): void { this.shapes.set(value.name, value); }
  registerCommand(value: CommandProvider): void { this.commands.set(value.name, value); }
  registerDecorator(value: TreeDecorator): void { this.decorators.set(value.name, value); }
  registerAttribute(value: AttributeHandler): void { this.attributes.set(value.name, value); }
}
export class EditorSession extends CoreSession {
  constructor(store: DocumentStore, extensions: ExtensionSet = new TestExtensions()) { super(store, extensions); }
}
export class ShapeFactory extends CoreFactory {
  constructor() { super(new TestExtensions().shapes); }
}
export class SvgCodec extends CoreCodec {
  constructor() { super(new ShapeFactory()); }
}
export class SvgFileStore extends CoreStore {
  constructor(codec: CoreCodec = new SvgCodec()) { super(codec); }
}
