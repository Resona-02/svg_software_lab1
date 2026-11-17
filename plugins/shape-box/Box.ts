import { Group, type Shape } from '../../src/api/index.js';

/** A composite owns its required parts; ordinary tree operations cannot dismantle it. */
export class Box extends Group {
  private readonly rectangle: Shape;
  private readonly label: Shape;

  constructor(id: string, children: readonly Shape[]) {
    super(id);
    const rectangle = children.find(child => child.id === `${id}-rect`);
    const label = children.find(child => child.id === `${id}-label`);
    if (rectangle?.tag !== 'rect' || label?.tag !== 'text' || label.text === undefined) {
      throw new Error(`invalid box structure: ${id} (requires rect#${id}-rect and text#${id}-label)`);
    }
    this.rectangle = rectangle;
    this.label = label;
    for (const child of children) this.insert(child);
  }

  override get kind(): string { return 'box'; }
  get body(): Shape { return this.rectangle; }
  get title(): Shape { return this.label; }

  override attributes(): Readonly<Record<string, string>> {
    return { ...super.attributes(), 'data-kind': 'box' };
  }

  override creationMessage(parentId?: string): string {
    return `box#${this.id} created (g#${this.id} + rect#${this.body.id} + text#${this.title.id})${parentId ? ` in g#${parentId}` : ''}`;
  }

  override movementSummary(): string { return `box#${this.id}`; }

  override assertCanDetach(shape: Shape): void {
    if (shape === this.body || shape === this.title) {
      throw new Error(`cannot detach required component: ${shape.id} (box: ${this.id})`);
    }
  }

  override assertCanUngroup(): void {
    throw new Error(`cannot ungroup composite shape: ${this.id}`);
  }

  override clone(): Box {
    const copy = new Box(this.id, this.children.map(child => child.clone()));
    this.copyAttributesTo(copy);
    return copy;
  }
}
