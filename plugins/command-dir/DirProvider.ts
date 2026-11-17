import type { Command, CommandArguments, CommandProvider, EditorSession } from '../../src/api/index.js';
import type { DirectoryReader } from './DirectoryReader.js';
import { DirectoryReceiver } from './DirectoryReceiver.js';
import { DirCommand } from './DirCommand.js';

export class DirProvider implements CommandProvider {
  readonly name = 'dir';
  readonly syntax = 'dir';

  constructor(private readonly reader: DirectoryReader) {}

  create(args: CommandArguments, _session: EditorSession): Command {
    args.expect(0);
    return new DirCommand(new DirectoryReceiver(this.reader));
  }
}
