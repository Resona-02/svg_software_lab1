import type { EditorSession } from '../../src/api/index.js';

/** Count the public tree in document order without modifying the session. */
export class StatsReceiver {
  constructor(private readonly source: Pick<EditorSession, 'document'>) {}

  count(): string {
    const counts = new Map<string, number>();
    let containers = 0;
    let total = 0;
    for (const shape of this.source.document.allShapes()) {
      if (shape.isContainer()) {
        containers++;
      } else {
        counts.set(shape.tag, (counts.get(shape.tag) ?? 0) + 1);
        total++;
      }
    }
    const leaves = [...counts].map(([type, count]) => `${type}: ${count}`);
    return [...leaves, `(total ${total}, containers ${containers})`].join('  ');
  }
}
