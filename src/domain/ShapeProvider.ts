import type { Shape } from './Shape.js';

export interface SvgShapeData {
  readonly id: string;
  readonly tag: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly text: string;
  readonly children: readonly Shape[];
}

/** A provider owns creation and reconstruction of one logical shape type. */
export interface ShapeProvider {
  readonly name: string;
  create(id: string, parameters: readonly string[]): Shape;
  read(data: SvgShapeData): Shape;
}
