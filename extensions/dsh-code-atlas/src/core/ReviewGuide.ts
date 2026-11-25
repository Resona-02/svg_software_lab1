import { z } from 'zod';
import { AtlasError } from './AtlasError.js';
import type { AnalysisSnapshot, ReadingGuide } from './types.js';

export const guideDraftSchema = z.object({
  title: z.string().min(1).max(160), summary: z.string().min(1).max(3000),
  steps: z.array(z.object({ id: z.string().min(1).max(40), title: z.string().min(1).max(160),
    explanation: z.string().min(1).max(3000), nodeIds: z.array(z.string()).min(1).max(6),
    next: z.array(z.string()).max(6), checks: z.array(z.string().max(500)).max(6),
  })).min(1).max(16), risks: z.array(z.string().max(1000)).max(12),
});

/** Accept only references into the exact snapshot read by the model. */
export function validateGuide(value: unknown, snapshot: AnalysisSnapshot, allowedIds?: ReadonlySet<string>): ReadingGuide {
  const draft = guideDraftSchema.parse(value);
  const known = new Set(snapshot.nodes.map(node => node.id));
  const steps = new Set(draft.steps.map(step => step.id));
  if (steps.size !== draft.steps.length) throw new AtlasError('导览步骤 ID 重复，请重新生成。', 'INVALID_GUIDE');
  for (const step of draft.steps) {
    if (step.nodeIds.some(id => !known.has(id) || allowedIds && !allowedIds.has(id))) throw new AtlasError('导览引用了未提供给模型的代码节点，请重新生成。', 'INVALID_GUIDE');
    if (step.next.some(id => !steps.has(id))) throw new AtlasError('导览含有不存在的下一步。', 'INVALID_GUIDE');
  }
  return { ...draft, snapshotId: snapshot.id, origin: 'model', scope: { providedSymbols: allowedIds?.size ?? new Set(draft.steps.flatMap(step => step.nodeIds)).size,
    totalSymbols: snapshot.nodes.filter(node => node.kind !== 'file').length } };
}
