import { Rect, Text, Validator, type ShapeProvider, type SvgShapeData } from '../../src/api/index.js';
import { Box } from './Box.js';

/** Creates and reconstructs box through the shape-provider contract only. */
export class BoxProvider implements ShapeProvider {
  readonly name = 'box';
  constructor(private readonly fill = '#4a90d9') {}

  create(id: string, parameters: readonly string[]): Box {
    if (parameters.length !== 5) {
      throw new Error(`invalid parameters for box: expected 5, got ${parameters.length}`);
    }
    const [x, y, width, height] = parameters.slice(0, 4).map(value => Validator.number(value));
    return new Box(id, [
      new Rect(`${id}-rect`, x!, y!, width!, height!, this.fill),
      new Text(`${id}-label`, x! + 20, y! + 35, parameters[4]!),
    ]);
  }

  read(data: SvgShapeData): Box {
    if (data.tag !== 'g') throw new Error(`invalid box structure: ${data.id} (expected <g>)`);
    const box = new Box(data.id, data.children);
    box.importAttributes(data.attributes);
    return box;
  }
}
