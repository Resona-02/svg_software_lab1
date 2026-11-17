import type { Command } from './Command.js';
import type { EditorSession } from './EditorSession.js';
import type { CommandArguments } from './CommandArguments.js';

export interface CommandProvider {
  readonly name: string;
  readonly syntax: string;
  create(args: CommandArguments, session: EditorSession): Command;
}
