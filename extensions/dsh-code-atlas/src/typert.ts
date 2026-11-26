import { z } from 'zod';
import type { AtlasView, SourcePreview, ReadingDirection, ReviewContext, ReviewIntent } from './core/types.js';
import { guideDraftSchema, reviewIntentSchema } from './core/ReviewGuide.js';

export interface AtlasSession { readonly id: string; readonly title: string; readonly cwd: string }
export interface AtlasWatch extends AsyncIterable<AtlasView> { dispose(): void }
export interface AtlasRemote {
  sessions(): Promise<readonly AtlasSession[]>;
  scan(sessionId: string): Promise<AtlasView>;
  inspect(sessionId: string, nodeId: string): Promise<{ view: AtlasView; source: SourcePreview }>;
  route(sessionId: string, direction: ReadingDirection, depth: 1 | 2): Promise<AtlasView>;
  markRead(sessionId: string, nodeId: string, read: boolean): Promise<AtlasView>;
  setPublicApiLabel(sessionId: string, enabled: boolean): Promise<AtlasView>;
  view(sessionId: string): Promise<AtlasView>;
  exportSVG(sessionId: string): Promise<{ svg: string; filename: string }>;
  close(sessionId: string): Promise<null>;
  watch(sessionId: string): AtlasWatch;
  graphKind(sessionId: string, kind: 'structure' | 'calls'): Promise<AtlasView>;
  guideStatus(): Promise<{ available: boolean; model: string; message: string }>;
  reviewContext(sessionId: string, task: string, intent?: ReviewIntent): Promise<ReviewContext>;
  generateGuide(sessionId: string, task: string, intent?: ReviewIntent): Promise<AtlasView>;
  cancelGuide(sessionId: string): Promise<null>;
  publishGuide(sessionId: string, snapshotId: string, draft: unknown): Promise<AtlasView>;
  navigate(sessionId: string, nodeId: string, direction: ReadingDirection, depth: 1 | 2, graphKind: 'structure' | 'calls'): Promise<{ view: AtlasView; source: SourcePreview }>;
}

const location = z.object({ file: z.string(), start: z.number(), end: z.number(), startLine: z.number(),
  startColumn: z.number(), endLine: z.number(), endColumn: z.number(), fileHash: z.string() });
const node = z.object({ id: z.string(), name: z.string(), kind: z.enum(['file', 'class', 'interface', 'function', 'method', 'namespace']),
  qualifiedName: z.string().optional(), file: z.string(), parentId: z.string().optional(), exported: z.boolean(), location });
const relation = z.object({ id: z.string(), kind: z.enum(['imports', 'reexports', 'extends', 'implements', 'calls', 'constructs']),
  from: z.string(), to: z.string().optional(), targetName: z.string(), resolved: z.boolean(), location,
  excerpt: z.string().optional(), dispatch: z.enum(['direct', 'declared', 'unknown']).optional() });
const changes = z.object({ baselineAvailable: z.boolean(), baselineSnapshotId: z.string().optional(),
  added: z.array(z.string()), modified: z.array(z.string()), deleted: z.array(z.string()) });
const view = z.object({
  snapshot: z.object({ id: z.string(), root: z.string(), nodes: z.array(node), relations: z.array(relation),
    diagnostics: z.array(z.object({ file: z.string(), message: z.string(), line: z.number().optional() })) }),
  selectedId: z.string(), direction: z.enum(['dependencies', 'users']), depth: z.union([z.literal(1), z.literal(2)]),
  readIds: z.array(z.string()), labels: z.record(z.string(), z.string()), publicApiLabel: z.boolean(),
  graphKind: z.enum(['structure', 'calls']), changes: changes.optional(), guide: guideDraftSchema.extend({ snapshotId: z.string(), origin: z.literal('model'), intent: reviewIntentSchema.optional(), scope: z.object({ providedSymbols: z.number(), totalSymbols: z.number() }) }).optional(),
  graph: z.object({ nodeIds: z.array(z.string()), relationIds: z.array(z.string()), truncated: z.boolean().optional() }),
  svg: z.string(),
});
const preview = z.object({ node, content: z.string(), snapshotId: z.string() });
const sessionId = z.string().min(1);
const codec = (name: string, schema: z.ZodType) => ({ mode: 'strict' as const, typeSymbol: `dsh-code-atlas#${name}`, create: () => schema });
const parameter = (name: string, schema: z.ZodType, acceptsUndefined = false) => ({ name, wire: name, source: 'json' as const,
  ...(acceptsUndefined ? { acceptsUndefined: true } : {}), codec: codec(name, schema) });
const methods = [
  { method: 'sessions', parameters: [], result: z.array(z.object({ id: z.string(), title: z.string(), cwd: z.string() })) },
  { method: 'scan', parameters: [parameter('sessionId', sessionId)], result: view },
  { method: 'inspect', parameters: [parameter('sessionId', sessionId), parameter('nodeId', z.string().min(1))], result: z.object({ view, source: preview }) },
  { method: 'route', parameters: [parameter('sessionId', sessionId), parameter('direction', z.enum(['dependencies', 'users'])), parameter('depth', z.union([z.literal(1), z.literal(2)]))], result: view },
  { method: 'markRead', parameters: [parameter('sessionId', sessionId), parameter('nodeId', z.string().min(1)), parameter('read', z.boolean())], result: view },
  { method: 'setPublicApiLabel', parameters: [parameter('sessionId', sessionId), parameter('enabled', z.boolean())], result: view },
  { method: 'view', parameters: [parameter('sessionId', sessionId)], result: view },
  { method: 'exportSVG', parameters: [parameter('sessionId', sessionId)], result: z.object({ svg: z.string(), filename: z.string() }) },
  { method: 'close', parameters: [parameter('sessionId', sessionId)], result: z.null() },
  { method: 'watch', mode: 'stream' as const, parameters: [parameter('sessionId', sessionId)], result: view },
  { method: 'graphKind', parameters: [parameter('sessionId', sessionId), parameter('kind', z.enum(['structure', 'calls']))], result: view },
  { method: 'guideStatus', parameters: [], result: z.object({ available: z.boolean(), model: z.string(), message: z.string() }) },
  { method: 'reviewContext', parameters: [parameter('sessionId', sessionId), parameter('task', z.string().min(1).max(2000)), parameter('intent', reviewIntentSchema.default('flow'), true)], result: z.object({
    snapshotId: z.string(), task: z.string(), intent: reviewIntentSchema.optional(), changes: changes.optional(), unavailableFiles: z.array(z.string()).optional(), symbols: z.array(z.object({ node, source: z.string(), sourceTruncated: z.boolean().optional() })), relations: z.array(relation), omittedSymbols: z.number(), omittedRelations: z.number().optional() }) },
  { method: 'generateGuide', parameters: [parameter('sessionId', sessionId), parameter('task', z.string().min(1).max(2000)), parameter('intent', reviewIntentSchema.default('flow'), true)], result: view },
  { method: 'cancelGuide', parameters: [parameter('sessionId', sessionId)], result: z.null() },
  { method: 'publishGuide', parameters: [parameter('sessionId', sessionId), parameter('snapshotId', z.string()), parameter('draft', guideDraftSchema)], result: view },
  { method: 'navigate', parameters: [parameter('sessionId', sessionId), parameter('nodeId', z.string()), parameter('direction', z.enum(['dependencies', 'users'])), parameter('depth', z.union([z.literal(1), z.literal(2)])), parameter('graphKind', z.enum(['structure', 'calls']))], result: z.object({ view, source: preview }) },
];
const invocations = methods.map(item => ({
  id: `dsh-code-atlas#codeAtlas/${item.method}`, service: 'codeAtlas', namespace: 'codeAtlas', method: item.method,
  ...('mode' in item ? { mode: item.mode } : {}),
  invocation: { kind: 'direct' as const }, parameters: item.parameters,
  cancellation: { parameter: 'signal' as const }, result: codec(`${item.method}:result`, item.result),
  sourceLocation: { file: 'src/host/CodeAtlasService.ts', line: 1, column: 1 },
}));

/** Hand-authored strict wire schemas use the native rc.1 Typert manifest contract. */
export const TYPERT = {
  package: 'dsh-code-atlas', face: 'host' as const, schemas: [], invocations,
  model: { services: [{ key: 'codeAtlas', exportName: 'CodeAtlasService', tags: [],
    summary: 'Source-backed code maps for live DSH session workspaces',
    members: methods.map(item => ({ kind: 'method', name: item.method, tags: [],
      signature: `${item.method}(${item.parameters.map(parameter => parameter.name).join(', ')})` })), types: [] }], events: [], objects: [] },
};
export const TYPERT_REMOTE = { package: 'dsh-code-atlas', descriptors: invocations };
