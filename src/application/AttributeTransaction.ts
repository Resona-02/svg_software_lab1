import type { AttributeEdit } from './AttributeHandler.js';
import type { Shape } from '../domain/Shape.js';
import type { UndoState } from './UndoState.js';

/** 受限的属性事务：先登记补偿，再修改目标或后代；不复制整棵树。 */
export class AttributeTransaction implements AttributeEdit {
  private open = true;
  constructor(private readonly target: Shape, private readonly state: UndoState) {}

  close(): void { this.open = false; }

  set(shape: Shape, attribute: string, value: string): void {
    if (!this.open) throw new Error('attribute transaction is closed');
    let ancestor: Shape | null = shape;
    while (ancestor !== null && ancestor !== this.target) ancestor = ancestor.parent;
    if (ancestor === null) throw new Error(`attribute edit outside target: ${shape.id}`);
    this.state.record(shape.rememberAttribute(attribute));
    shape.setAttribute(attribute, value);
  }
}
