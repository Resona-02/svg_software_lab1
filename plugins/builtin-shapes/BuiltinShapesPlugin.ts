import { Circle, Ellipse, Group, Line, Rect, Text, Validator, type Plugin, type PluginContext } from '../../src/api/index.js';
import { BuiltinShapeProvider } from './BuiltinShapeProvider.js';

export class BuiltinShapesPlugin implements Plugin {
  activate(context: PluginContext): void {
    const number = (value: string) => Validator.number(value);
    context.registerShape(new BuiltinShapeProvider('rect', ['x', 'y', 'width', 'height'],
      (id, p) => new Rect(id, number(p[0]!), number(p[1]!), number(p[2]!), number(p[3]!), p[4]), 'fill'));
    context.registerShape(new BuiltinShapeProvider('circle', ['cx', 'cy', 'r'],
      (id, p) => new Circle(id, number(p[0]!), number(p[1]!), number(p[2]!), p[3]), 'fill'));
    context.registerShape(new BuiltinShapeProvider('ellipse', ['cx', 'cy', 'rx', 'ry'],
      (id, p) => new Ellipse(id, number(p[0]!), number(p[1]!), number(p[2]!), number(p[3]!), p[4]), 'fill'));
    context.registerShape(new BuiltinShapeProvider('line', ['x1', 'y1', 'x2', 'y2'],
      (id, p) => new Line(id, number(p[0]!), number(p[1]!), number(p[2]!), number(p[3]!), p[4]), 'stroke'));
    context.registerShape(new BuiltinShapeProvider('text', ['x', 'y', 'text'],
      (id, p) => new Text(id, number(p[0]!), number(p[1]!), p[2]!)));
    context.registerShape(new BuiltinShapeProvider('g', [], id => new Group(id)));
  }
}
