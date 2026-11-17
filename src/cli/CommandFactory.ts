import type { EditorSession } from '../application/EditorSession.js';
import type { Command } from '../application/Command.js';
import type { CommandSource } from './CommandSource.js';
import { Tokenizer } from './Tokenizer.js';
import { CommandArguments } from './CommandArguments.js';

/** Parses input against the registered providers without knowing concrete commands. */
export class CommandFactory implements CommandSource {
  private readonly tokenizer = new Tokenizer();
  constructor(private readonly session: EditorSession) {}

  parse(line: string): Command | undefined {
    const tokens = this.tokenizer.tokenize(line);
    if (!tokens.length) return undefined;
    const entry = this.session.extensions.commands.get(tokens[0].value);
    if (!entry) throw new Error(`unknown command: ${tokens[0].value}`);
    return entry.create(new CommandArguments(tokens.slice(1), entry.syntax), this.session);
  }
}
