import type { Shape } from '../domain/Shape.js';
import type { SvgDocument } from '../domain/SvgDocument.js';

export interface TreeRow {
  readonly shape: Shape;
  readonly isRoot: boolean;
  readonly document: SvgDocument;
  readonly saved: SvgDocument | undefined;
}
export interface TreeDecorator {
  readonly name: string;
  /** 纯展示：返回不带前导空格的行尾标签，空字符串表示不标注。 */
  decorate(row: TreeRow): string;
}
