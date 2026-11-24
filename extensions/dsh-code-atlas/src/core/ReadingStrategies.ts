import type { AnalysisSnapshot, ReadingDirection, ReadingStrategy } from './types.js';

/** Shared graph walk; the selected strategy owns the direction, not the UI. */
export class DirectionalReadingStrategy implements ReadingStrategy {
  constructor(readonly name: ReadingDirection) {}
  select(snapshot: AnalysisSnapshot, nodeId: string, depth: 1 | 2) {
    const known = new Set(snapshot.nodes.map(node => node.id));
    const nodes = new Set([nodeId]);
    const edges = new Set<string>();
    let frontier = new Set([nodeId]);
    let truncated = false;
    const relations = [...snapshot.relations].filter(relation => relation.resolved && relation.to)
      .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    for (let level = 0; level < depth; level++) {
      const next = new Set<string>();
      for (const relation of relations) {
        const from = this.name === 'dependencies' ? relation.from : relation.to!;
        const to = this.name === 'dependencies' ? relation.to! : relation.from;
        if (!frontier.has(from) || !known.has(to)) continue;
        if (!nodes.has(to) && nodes.size >= 120) { truncated = true; continue; }
        edges.add(relation.id);
        if (!nodes.has(to)) next.add(to);
        nodes.add(to);
      }
      frontier = next;
    }
    // Keep every relation between visible nodes, including the back edge of a cycle.
    for (const relation of relations) {
      if (nodes.has(relation.from) && nodes.has(relation.to!)) edges.add(relation.id);
    }
    return { nodeIds: [...nodes], relationIds: [...edges], truncated };
  }
}
export class DependenciesFirst extends DirectionalReadingStrategy {
  constructor() { super('dependencies'); }
}
export class UsersFirst extends DirectionalReadingStrategy {
  constructor() { super('users'); }
}
