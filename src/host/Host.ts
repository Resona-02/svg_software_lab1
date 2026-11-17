import { Cli } from '../cli/Cli.js';
import { Runtime } from './Runtime.js';

/** Selects assembly mode before exposing the unchanged line-oriented CLI. */
export class Host {
  async run(args: readonly string[] = process.argv.slice(2)): Promise<void> {
    const runtime = await Runtime.create(message => process.stdout.write(`${message}\n`));
    if (args.length === 0) await runtime.loadCode();
    else if (args.length === 2 && args[0] === '--config') await runtime.loadConfig(args[1]);
    else if (!(args.length === 1 && args[0] === '--builtin-only')) {
      process.stdout.write('error: usage: svg-editor [--config <file.json> | --builtin-only]\n');
    }
    await new Cli(runtime.dispatcher).run();
  }
}
