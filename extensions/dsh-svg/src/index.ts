import type { Context } from '@deepseek-ai/cordis';
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools';
import { editOperations } from './SvgEditor.js';
import { SvgSessions } from './SvgSessions.js';
import { SvgToolError } from './SvgToolError.js';

export const name = 'dsh-svg-workbench';
export const inject = ['tools'];

const summarySchema = {
  type: 'object', additionalProperties: false,
  properties: {
    revision: { type: 'integer', required: true }, message: { type: 'string', required: true },
    tree: { type: 'string', required: true }, details: { type: 'string', required: true },
    elements: { type: 'integer', required: true }, undoCount: { type: 'integer', required: true },
    redoCount: { type: 'integer', required: true },
  },
} as const;
const render = (_args: unknown, result: { message: string; tree: string; revision: number; undoCount: number; redoCount: number; details: string }) => [
  { type: 'text' as const, text: `${result.message}\nrevision=${result.revision}; undo=${result.undoCount}; redo=${result.redoCount}\n${result.tree}${result.details ? `\n${result.details}` : ''}` },
];

/** Host adapter: Cordis owns registration lifetime; SVG core owns all editing rules. */
export function apply(ctx: Context): void {
  const sessions = new SvgSessions();
  ctx.effect(() => () => sessions.dispose());
  ctx.on('agent/disposed', ({ agent }) => sessions.close(agent.id));

  ctx.tools.register(defineTool({
    name: 'svg_create', description: 'Start or replace this conversation’s SVG canvas. This clears its undo history. Use svg_edit create to add shapes.',
    parameters: { width: { type: 'number' }, height: { type: 'number' } },
    output: { schema: summarySchema, render },
    execute: (args, exec) => sessions.run(exec, editor => editor.init(args.width ?? 800, args.height ?? 600)),
    presentCall: () => ({ card: 'generic', title: 'Create SVG canvas', kind: 'edit' }),
  }));
  ctx.tools.register(defineTool({
    name: 'svg_open', description: 'Open supported SVG XML text in this conversation. Successful import resets history; invalid XML preserves the active document. No filesystem access.',
    parameters: { svg: { type: 'string', required: true } },
    output: { schema: summarySchema, render },
    execute: (args, exec) => sessions.run(exec, editor => editor.open(args.svg)),
    presentCall: () => ({ card: 'generic', title: 'Open SVG text', kind: 'read' }),
  }));
  ctx.tools.register(defineTool({
    name: 'svg_inspect', description: 'Inspect the real active SVG tree and history before editing. Optional id limits the tree and adds attributes. Read-only; does not clear undo history.',
    parameters: { id: { type: 'string' } },
    output: { schema: summarySchema, render },
    execute: (args, exec) => sessions.run(exec, editor => editor.inspect('SVG inspected', args.id)),
    presentCall: args => ({ card: 'generic', title: 'Inspect SVG', kind: 'read', rawInput: args.id }),
  }));
  ctx.tools.register(defineTool({
    name: 'svg_edit',
    description: 'Apply exactly one SVG edit; one successful call is one undo unit. Arguments are strings, never shell code. create: [type,id,...geometry,label?,"in",parent?]; box geometry is x,y,w,h,label. move:[id,dx,dy]; scale:[id,factor]; set:[id,attr,value]; group:[newId,...ids]; ungroup/delete/front/back:[id]; addto:[parent,id]. Shapes: rect,circle,ellipse,line,text,g,box. Box supports fill and label. No batch transaction; inspect before editing.',
    parameters: {
      operation: { type: 'string', enum: editOperations, required: true },
      args: { type: 'array', items: { type: 'string' }, required: true },
    },
    output: { schema: summarySchema, render },
    execute: (args, exec) => sessions.run(exec, editor => editor.edit(args.operation, args.args)),
    presentCall: args => ({ card: 'generic', title: `SVG ${args.operation}`, kind: 'edit', rawInput: args.args }),
  }));
  ctx.tools.register(defineTool({
    name: 'svg_history', description: 'Undo or redo one successful SVG edit in this conversation. Failed edits and inspect/export never add history.',
    parameters: { action: { type: 'string', enum: ['undo', 'redo'], required: true } },
    output: { schema: summarySchema, render },
    execute: (args, exec) => sessions.run(exec, editor => editor.history(args.action)),
    presentCall: args => ({ card: 'generic', title: `SVG ${args.action}`, kind: 'edit' }),
  }));
  ctx.tools.register(defineTool({
    name: 'svg_export', description: 'Return current SVG XML as canonical data and text for saving with the host file tool. Does not write files, execute scripts, change dirty state, or clear undo. SVG is displayed as text; imported SVG is not executed as HTML.',
    parameters: {},
    output: {
      schema: { ...summarySchema, properties: { ...summarySchema.properties,
        svg: { type: 'string', required: true }, mimeType: { type: 'string', const: 'image/svg+xml', required: true } } },
      render: (args, value) => [...render(args, value), { type: 'text', text: value.svg }],
    },
    execute: (_args, exec) => sessions.run(exec, editor => editor.export()),
    presentCall: () => ({ card: 'generic', title: 'Export SVG text', kind: 'read' }),
  }));
  ctx.tools.register(defineTool({
    name: 'svg_close', description: 'Release the in-memory SVG and undo history belonging to this conversation. Export it first if needed. Other conversations are unaffected.',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(_args, exec: ToolRunContext) {
      exec.signal.throwIfAborted();
      const id = exec.agent?.id;
      if (!id) throw new SvgToolError('SVG tools require an active DSH Agent session', 'SVG_SESSION_REQUIRED');
      sessions.close(id);
      return 'SVG session closed';
    },
    presentCall: () => ({ card: 'generic', title: 'Close SVG session', kind: 'delete' }),
  }));
}
