import type { Command } from '../../src/api/index.js';
import type { DirectoryReceiver } from './DirectoryReceiver.js';

export class DirCommand implements Command {
  constructor(private readonly receiver: DirectoryReceiver) {}

  execute(): Promise<string> {
    return this.receiver.list();
  }
}
