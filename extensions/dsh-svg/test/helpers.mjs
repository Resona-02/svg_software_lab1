import { Context } from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import * as NativeExecutor from '@deepseek-ai/dsh-tool-executor-native';
import { executeModelToolFixture } from '@deepseek-ai/dsh-tool-testkit';
import * as plugin from '../lib/index.js';

export async function fixture() {
  const ctx = new Context();
  await ctx.plugin(SystemPrompt);
  await ctx.plugin(ToolRuntime);
  await ctx.plugin(NativeExecutor);
  const fiber = ctx.plugin(plugin);
  await fiber;
  let counter = 0;
  const agents = new Map();
  const agent = id => {
    if (!agents.has(id)) agents.set(id, { id });
    return agents.get(id);
  };
  const run = (name, args = {}, id = 'conversation-a', signal = new AbortController().signal) => executeModelToolFixture(ctx, {
    callId: `svg-call-${++counter}`, name, arguments: args, signal,
    ...(id === null ? {} : { agent: agent(id) }),
  });
  return { ctx, fiber, run, agent, dispose: () => ctx.fiber.dispose() };
}
