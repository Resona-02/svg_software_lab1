import {
  EditorSession, CreateCommand, DeleteCommand, MoveCommand, ScaleCommand,
  SetCommand, GroupCommand, UngroupCommand, AddToCommand, FrontCommand, BackCommand,
  CommandArguments, ViewReceiver, InitCommand, ReadCommand, SaveCommand,
  CanvasCommand, UndoCommand, RedoCommand, TreeCommand, ShowCommand,
  HelpCommand, HelpReceiver,
  type Command, type Plugin, type PluginContext,
} from '../../src/api/index.js';
import { BuiltinCommandProvider } from './BuiltinCommandProvider.js';

/** 默认命令以同一注册协议装配，参数语义沿用 Phase 1。 */
export class BuiltinCommandsPlugin implements Plugin {
  activate(ctx: PluginContext): void {
    this.add(ctx, 'init', 'init [w] [h]', (args, session) => {
      args.expect(0, 2);
      return new InitCommand(session, args.length > 0 ? args.number(0) : 800, args.length > 1 ? args.number(1) : 600);
    });
    this.add(ctx, 'read', 'read <file.svg>', (args, session) => {
      args.expect(1);
      return new ReadCommand(session, args.string(0));
    });
    this.add(ctx, 'save', 'save [file.svg]', (args, session) => {
      args.expect(0, 1);
      return new SaveCommand(session, args.length ? args.string(0) : undefined);
    });
    this.add(ctx, 'canvas', 'canvas [w] [h]', (args, session) => {
      args.expect(0, 2);
      if (args.length === 1) args.invalidUsage();
      return args.length ? new CanvasCommand(session, args.number(0), args.number(1)) : new CanvasCommand(session);
    });
    this.add(ctx, 'create', 'create <type> <id> [params...] [in <containerId>]', (args, session) => {
      const { arguments: values, parentId } = args.creation();
      values.expect(2, Number.POSITIVE_INFINITY);
      return new CreateCommand(session.edits, values.string(0), values.string(1), values.strings(2), parentId);
    });
    this.add(ctx, 'delete', 'delete <id>', (args, session) => {
      args.expect(1);
      return new DeleteCommand(session.edits, args.string(0));
    });
    this.add(ctx, 'move', 'move <id> <dx> <dy>', (args, session) => {
      args.expect(3);
      return new MoveCommand(session.edits, args.string(0), args.number(1), args.number(2));
    });
    this.add(ctx, 'scale', 'scale <id> <factor>', (args, session) => {
      args.expect(2);
      return new ScaleCommand(session.edits, args.string(0), args.number(1));
    });
    this.add(ctx, 'set', 'set <id> <attr> <value>', (args, session) => {
      args.expect(3);
      return new SetCommand(session.edits, args.string(0), args.string(1), args.string(2));
    });
    this.add(ctx, 'group', 'group <newGid> <id1> [id2...]', (args, session) => {
      args.expect(2, Number.POSITIVE_INFINITY);
      return new GroupCommand(session.edits, args.string(0), args.strings(1));
    });
    this.add(ctx, 'ungroup', 'ungroup <gid>', (args, session) => {
      args.expect(1);
      return new UngroupCommand(session.edits, args.string(0));
    });
    this.add(ctx, 'addto', 'addto <gid> <id>', (args, session) => {
      args.expect(2);
      return new AddToCommand(session.edits, args.string(0), args.string(1));
    });
    this.add(ctx, 'front', 'front <id>', (args, session) => {
      args.expect(1);
      return new FrontCommand(session.edits, args.string(0));
    });
    this.add(ctx, 'back', 'back <id>', (args, session) => {
      args.expect(1);
      return new BackCommand(session.edits, args.string(0));
    });
    this.add(ctx, 'tree', 'tree [id]', (args, session) => {
      args.expect(0, 1);
      return new TreeCommand(new ViewReceiver(session), args.length ? args.string(0) : undefined);
    });
    this.add(ctx, 'show', 'show <id>', (args, session) => {
      args.expect(1);
      return new ShowCommand(new ViewReceiver(session), args.string(0));
    });
    this.add(ctx, 'help', 'help', (args, session) => {
      args.expect(0);
      return new HelpCommand(new HelpReceiver([...session.extensions.commands.values()].map(entry => entry.syntax)));
    });
    this.add(ctx, 'undo', 'undo', (args, session) => {
      args.expect(0);
      return new UndoCommand(session);
    });
    this.add(ctx, 'redo', 'redo', (args, session) => {
      args.expect(0);
      return new RedoCommand(session);
    });
  }

  private add(ctx: PluginContext, name: string, syntax: string,
    create: (args: CommandArguments, session: EditorSession) => Command): void {
    ctx.registerCommand(new BuiltinCommandProvider(name, syntax, create));
  }
}
