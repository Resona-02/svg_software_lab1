import type { Command } from '../../src/api/index.js';
import type { StatsReceiver } from './StatsReceiver.js';

export class StatsCommand implements Command {
  constructor(private readonly receiver: StatsReceiver) {}

  execute(): string {
    return this.receiver.count();
  }
}
