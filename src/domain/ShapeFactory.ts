import type { Shape } from './Shape.js';
import type { ShapeProvider, SvgShapeData } from './ShapeProvider.js';

/** Dispatches through the injected catalog; providers own format-specific reconstruction. */
export class ShapeFactory {
  constructor(private readonly providers: ReadonlyMap<string, ShapeProvider>) {}

  create(type: string, id: string, parameters: readonly string[]): Shape {
    const shape = this.provider(type).create(id, parameters);
    if (shape.id !== id) throw new Error(`invalid shape provider result: ${type}`);
    return shape;
  }

  fromSvg(type: string, id: string, attributes: Readonly<Record<string, string>>, text: string,
    children: readonly Shape[] = []): Shape {
    const kind = attributes['data-kind'];
    const provider = this.provider(kind && this.providers.has(kind) ? kind : type);
    const data: SvgShapeData = { id, tag: type, attributes, text, children };
    const shape = provider.read(data);
    if (shape.id !== id) throw new Error(`invalid shape provider result: ${provider.name}`);
    return shape;
  }

  private provider(name: string): ShapeProvider {
    const provider = this.providers.get(name);
    if (!provider) throw new Error(`unknown shape type: ${name} (is the plugin loaded?)`);
    return provider;
  }
}
