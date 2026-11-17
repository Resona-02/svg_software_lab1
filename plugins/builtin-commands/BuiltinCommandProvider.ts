import type { CommandProvider, CommandArguments, EditorSession, Command } from '../../src/api/index.js';

/** 把内置命令的参数契约与构造方式作为注册实例提供。 */
export class BuiltinCommandProvider implements CommandProvider {
  constructor(
    readonly name: string,
    readonly syntax: string,
    private readonly factory: (args: CommandArguments, session: EditorSession) => Command,
  ) {}

  create(args: CommandArguments, session: EditorSession): Command {
    return this.factory(args, session);
  }
}
