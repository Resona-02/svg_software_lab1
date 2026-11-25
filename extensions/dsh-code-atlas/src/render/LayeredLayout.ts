import type { CodeNode, CodeRelation } from '../core/types.js';

export interface NodePosition { readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly component: number }
/** Condense strongly connected components before assigning stable DAG columns. */
export class LayeredLayout {
  layout(nodes: readonly CodeNode[], relations: readonly CodeRelation[]): ReadonlyMap<string, NodePosition> {
    const ids = new Set(nodes.map(node => node.id));
    const outgoing = new Map(nodes.map(node => [node.id, [] as string[]]));
    for (const relation of relations) if (relation.to && ids.has(relation.from) && ids.has(relation.to)) outgoing.get(relation.from)!.push(relation.to);
    const index = new Map<string, number>(), low = new Map<string, number>();
    const stack: string[] = [], onStack = new Set<string>(), groups: string[][] = [];
    let nextIndex = 0;
    const visit = (id: string): void => {
      index.set(id, nextIndex); low.set(id, nextIndex++); stack.push(id); onStack.add(id);
      for (const target of outgoing.get(id)!) {
        if (!index.has(target)) { visit(target); low.set(id, Math.min(low.get(id)!, low.get(target)!)); }
        else if (onStack.has(target)) low.set(id, Math.min(low.get(id)!, index.get(target)!));
      }
      if (low.get(id) !== index.get(id)) return;
      const group: string[] = [];
      let member: string;
      do { member = stack.pop()!; onStack.delete(member); group.push(member); } while (member !== id);
      groups.push(group.sort());
    };
    for (const id of [...ids].sort()) if (!index.has(id)) visit(id);
    groups.sort((a, b) => a[0]! < b[0]! ? -1 : 1);
    const component = new Map<string, number>();
    groups.forEach((group, i) => group.forEach(id => component.set(id, i)));
    const successors = groups.map(() => new Set<number>()), indegrees = groups.map(() => 0), columns = groups.map(() => 0);
    for (const [from, targets] of outgoing) for (const target of targets) {
      const a = component.get(from)!, b = component.get(target)!;
      if (a !== b && !successors[a]!.has(b)) { successors[a]!.add(b); indegrees[b]!++; }
    }
    const ready = indegrees.map((degree, i) => degree === 0 ? i : -1).filter(i => i >= 0);
    while (ready.length) {
      const current = ready.shift()!;
      for (const target of [...successors[current]!].sort((a, b) => a - b)) {
        columns[target] = Math.max(columns[target]!, columns[current]! + 1);
        if (--indegrees[target]! === 0) ready.push(target);
      }
    }
    const rows = new Map<number, number>(), positions = new Map<string, NodePosition>();
    groups.forEach((group, i) => {
      const column = columns[i]!, start = rows.get(column) ?? 0;
      group.forEach((id, offset) => positions.set(id, { x: 32 + column * 400, y: 40 + (start + offset) * 132,
        width: 330, height: 96, component: i }));
      rows.set(column, start + group.length + (group.length > 1 ? 1 : 0));
    });
    return positions;
  }
}
