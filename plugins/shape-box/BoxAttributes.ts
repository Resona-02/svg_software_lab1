import type { AttributeHandler, AttributeEdit, AttributeResult, Shape } from '../../src/api/index.js';
import { Box } from './Box.js';

/** The handler exposes box semantics while transaction bookkeeping stays in core. */
export class BoxAttributes implements AttributeHandler {
  readonly name = 'box-attributes';
  handles(shape: Shape, attribute: string): boolean {
    return shape instanceof Box && (attribute === 'fill' || attribute === 'label');
  }

  apply(shape: Shape, attribute: string, value: string, edit: AttributeEdit): AttributeResult {
    if (!(shape instanceof Box)) throw new Error(`not a box: ${shape.id}`);
    if (attribute === 'fill') {
      const old = shape.body.attributes().fill;
      edit.set(shape.body, 'fill', value);
      return {
        message: `box#${shape.id} fill propagated to ${shape.body.id}`,
        undone: () => `box#${shape.id} fill restored: ${old === undefined ? '(unset)' : JSON.stringify(old)}`,
      };
    }
    if (attribute === 'label') {
      const old = shape.title.text;
      edit.set(shape.title, 'text', value);
      return {
        message: `box#${shape.id} label updated: ${JSON.stringify(value)}`,
        undone: () => `box#${shape.id} label restored: ${JSON.stringify(old)}`,
      };
    }
    throw new Error(`unknown attribute: ${attribute}`);
  }
}
