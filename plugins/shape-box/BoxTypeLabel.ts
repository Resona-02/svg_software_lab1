import type { TreeDecorator, TreeRow } from '../../src/api/index.js';
import { Box } from './Box.js';

/** Independent type label; it neither inspects nor configures other decorators. */
export class BoxTypeLabel implements TreeDecorator {
  readonly name = 'box-type-label';
  decorate(row: TreeRow): string { return row.shape instanceof Box ? '(box)' : ''; }
}
