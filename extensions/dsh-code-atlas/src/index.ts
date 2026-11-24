import type { Context } from '@deepseek-ai/cordis';
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools';
import type { AtlasView } from './core/types.js';
import { CodeAtlasService } from './host/CodeAtlasService.js';

export const name = 'dsh-code-atlas';
export const inject = ['tools', 'fs', 'sessions'];
const summary = { type: 'object', additionalProperties: false, properties: {
  snapshotId: { type: 'string', required: true }, selectedId: { type: 'string', required: true },
  nodeCount: { type: 'integer', required: true }, relationCount: { type: 'integer', required: true },
  labels: { type: 'string', required: true }, diagnostics: { type: 'string', required: true },
} } as const;
const summarize = (view: AtlasView) => ({ snapshotId: view.snapshot.id, selectedId: view.selectedId,
  nodeCount: view.snapshot.nodes.length, relationCount: view.snapshot.relations.length,
  labels: view.snapshot.nodes.slice(0, 100).map(node => `${node.id}: ${view.labels[node.id] ?? node.name}`).join('\n'),
  diagnostics: view.snapshot.diagnostics.map(item => `${item.file}${item.line ? `:${item.line}` : ''}: ${item.message}`).join('\n'),
});
const render = (_args: unknown, value: ReturnType<typeof summarize>) => [{ type: 'text' as const,
  text: `Code Atlas ${value.snapshotId}: ${value.nodeCount} nodes, ${value.relationCount} relations\nselected=${value.selectedId}\n${value.labels}${value.diagnostics ? `\nDiagnostics:\n${value.diagnostics}` : ''}` }];
const sessionId = (exec: ToolRunContext): string => {
  exec.signal.throwIfAborted();
  if (!exec.agent?.id) throw new Error('CODE_ATLAS_SESSION_REQUIRED: choose a DSH session with a project workspace');
  return String(exec.agent.id);
};

/** Register native tools; analysis and navigation are shared with the desktop panel. */
export async function apply(ctx: Context): Promise<void> {
  await ctx.plugin(CodeAtlasService);
  await ctx.inject(['tools', 'codeAtlas'], ctx => {
    ctx.tools.register(defineTool({
      name: 'code_atlas_scan', description: 'Read and index TS/JS in this session workspace, honoring source bounds and ignore rules. Does not execute or modify project code. Returns source-backed symbols and relationships; dynamic calls are not inferred.',
      parameters: {}, output: { schema: summary, render },
      execute: async (_args, exec) => summarize(await ctx.codeAtlas.scan(sessionId(exec), exec.signal)),
      presentCall: () => ({ card: 'generic', title: 'Index code workspace', kind: 'read' }),
    }));
    ctx.tools.register(defineTool({
      name: 'code_atlas_inspect', description: 'Inspect an indexed symbol or file by its real node ID. Source freshness is verified. Returns exact source text with file/line evidence; use scan first.',
      parameters: { nodeId: { type: 'string', required: true } },
      output: { schema: { ...summary, properties: { ...summary.properties,
        file: { type: 'string', required: true }, startLine: { type: 'integer', required: true }, source: { type: 'string', required: true },
      } }, render: (args, value) => [...render(args, value), { type: 'text', text: `${value.file}:${value.startLine}\n${value.source}` }] },
      execute: async (args, exec) => {
        const result = await ctx.codeAtlas.inspect(sessionId(exec), args.nodeId, exec.signal);
        const lines = result.source.content.split('\n');
        const start = Math.max(0, result.source.node.location.startLine - 4);
        return { ...summarize(result.view), file: result.source.node.file, startLine: start + 1,
          source: lines.slice(start, start + 160).join('\n') };
      },
      presentCall: args => ({ card: 'generic', title: 'Inspect source evidence', kind: 'read', rawInput: args.nodeId }),
    }));
    ctx.tools.register(defineTool({
      name: 'code_atlas_route', description: 'Change the reading route around the currently selected node: dependencies or users, one or two relationship steps. Only indexed, resolved source relations participate.',
      parameters: { direction: { type: 'string', enum: ['dependencies', 'users'], required: true }, depth: { type: 'integer', enum: [1, 2], required: true } },
      output: { schema: summary, render },
      execute: async (args, exec) => summarize(ctx.codeAtlas.route(sessionId(exec), args.direction, args.depth, exec.signal)),
      presentCall: () => ({ card: 'generic', title: 'Explore code relationships', kind: 'read' }),
    }));
    ctx.tools.register(defineTool({
      name: 'code_atlas_mark_read', description: 'Mark an indexed node as read or unread in this conversation. Reading annotations do not modify source files.',
      parameters: { nodeId: { type: 'string', required: true }, read: { type: 'boolean', required: true } }, output: { schema: summary, render },
      execute: async (args, exec) => summarize(await ctx.codeAtlas.markRead(sessionId(exec), args.nodeId, args.read, exec.signal)),
      presentCall: () => ({ card: 'generic', title: 'Update reading marker', kind: 'edit' }),
    }));
    ctx.tools.register(defineTool({
      name: 'code_atlas_export', description: 'Export the current code relationship map as SVG text. This does not write a file or execute imported content; use an existing host file tool to save it explicitly.',
      parameters: {}, output: { schema: { type: 'object', additionalProperties: false, properties: { svg: { type: 'string', required: true }, filename: { type: 'string', required: true } } },
        render: (_args, value) => [{ type: 'text', text: `${value.filename}\n${value.svg}` }] },
      execute: async (_args, exec) => ctx.codeAtlas.exportSVG(sessionId(exec), exec.signal),
      presentCall: () => ({ card: 'generic', title: 'Export code map SVG', kind: 'read' }),
    }));
  });
}

export { CodeAtlasService };
export { DshCodeSource } from './host/DshCodeSource.js';
