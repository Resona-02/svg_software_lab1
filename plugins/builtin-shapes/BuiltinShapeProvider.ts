import type { Shape, ShapeProvider, SvgShapeData } from '../../src/api/index.js';

/** Each instance describes one built-in type through the same provider contract. */
export class BuiltinShapeProvider implements ShapeProvider {
  constructor(readonly name: string, private readonly parameters: readonly string[],
    private readonly construct: (id: string, parameters: readonly string[]) => Shape,
    private readonly optionalStyle?: string) {}

  create(id: string, parameters: readonly string[]): Shape {
    const minimum = this.parameters.length;
    const maximum = minimum + (this.optionalStyle === undefined ? 0 : 1);
    if (parameters.length < minimum || parameters.length > maximum) {
      throw new Error(`invalid parameters for ${this.name}: expected ${minimum === maximum ? minimum : `${minimum}-${maximum}`}, got ${parameters.length}`);
    }
    return this.construct(id, parameters);
  }

  read(data: SvgShapeData): Shape {
    const parameters = this.parameters.map(key => key === 'text' ? data.text : data.attributes[key] ?? '0');
    if (this.optionalStyle && data.attributes[this.optionalStyle] !== undefined) {
      parameters.push(data.attributes[this.optionalStyle]!);
    }
    const shape = this.create(data.id, parameters);
    shape.importAttributes(data.attributes);
    if (shape.isContainer()) {
      for (const child of data.children) shape.asContainer().insert(child);
    } else if (data.children.length) {
      throw new Error(`invalid SVG: unsupported child content in <${data.tag}>`);
    }
    return shape;
  }
}
