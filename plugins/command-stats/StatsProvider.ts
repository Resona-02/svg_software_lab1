import type { Command, CommandArguments, CommandProvider, EditorSession } from '../../src/api/index.js';
import { StatsCommand } from './StatsCommand.js';
import { StatsReceiver } from './StatsReceiver.js';

export class StatsProvider implements CommandProvider {
  readonly name = 'stats';
  readonly syntax = 'stats';

  create(args: CommandArguments, session: EditorSession): Command {
    args.expect(0);
    return new StatsCommand(new StatsReceiver(session));
  }
}
