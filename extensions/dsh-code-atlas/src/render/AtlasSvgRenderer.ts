import { Line, Text, ShapeFactory, SvgDocument } from '../../../../src/api/index.js';
import { ExtensionRegistry, SvgCodec } from '../../../../src/api/integration.js';
import builtin, { manifest as builtinManifest } from '../../../../plugins/builtin-shapes/index.js';
import box, { manifest as boxManifest } from '../../../../plugins/shape-box/index.js';
import type { AnalysisSnapshot } from '../core/types.js';
import { LayeredLayout } from './LayeredLayout.js';

/** SVG is a projection of source facts; existing boxes and lines own SVG encoding. */
export class AtlasSvgRenderer {
  private constructor(private readonly shapes: ShapeFactory, private readonly codec: SvgCodec) {}
  static async create(): Promise<AtlasSvgRenderer> {
    const registry = new ExtensionRegistry();
    await registry.activate(builtin, builtinManifest);
    await registry.activate(box, boxManifest);
    return new AtlasSvgRenderer(new ShapeFactory(registry.shapes), new SvgCodec(new ShapeFactory(registry.shapes)));
  }
  render(snapshot: AnalysisSnapshot, graph: { readonly nodeIds: readonly string[]; readonly relationIds: readonly string[] },
    selected: string, labels: Readonly<Record<string, string>>): string {
    const ids = new Set(graph.nodeIds), edgeIds = new Set(graph.relationIds);
    const nodes = snapshot.nodes.filter(node => ids.has(node.id));
    const relations = snapshot.relations.filter(edge => edgeIds.has(edge.id) && edge.to && ids.has(edge.from) && ids.has(edge.to));
    const positions = new LayeredLayout().layout(nodes, relations);
    const width = Math.max(640, ...[...positions.values()].map(p => p.x + p.width + 70));
    const height = Math.max(260, ...[...positions.values()].map(p => p.y + p.height + 40));
    const document = new SvgDocument(width, height);
    relations.forEach((relation, i) => {
      const from = positions.get(relation.from)!, to = positions.get(relation.to!)!;
      const sameColumn = from.x === to.x;
      const x1 = from.x + from.width, y1 = from.y + from.height / 2;
      const x2 = sameColumn ? to.x + to.width : to.x;
      const y2 = to.y + to.height / 2;
      // Route cycle edges outside boxes; self references get a visible loop too.
      const points = relation.from === relation.to
        ? [[x1, y1 - 14], [x1 + 28, y1 - 14], [x1 + 28, y1 + 14], [x1, y1 + 14]]
        : sameColumn ? [[x1, y1], [x1 + 28, y1], [x1 + 28, y2], [x2, y2]] : [[x1, y1], [x2, y2]];
      for (let segment = 1; segment < points.length; segment++) {
        const a = points[segment - 1]!, b = points[segment]!;
        const line = new Line(`edge-${i}-${segment}`, a[0]!, a[1]!, b[0]!, b[1]!, '#77849b');
        line.importAttributes({ 'data-relation-id': relation.id, 'stroke-width': '1.5' });
        document.add(line);
      }
      const before = points.at(-2)!, end = points.at(-1)!;
      const angle = Math.atan2(end[1]! - before[1]!, end[0]! - before[0]!);
      for (const [j, sign] of [-1, 1].entries()) document.add(new Line(`edge-${i}-arrow-${j}`, end[0]!, end[1]!,
        end[0]! - 9 * Math.cos(angle + sign * 0.42), end[1]! - 9 * Math.sin(angle + sign * 0.42), '#77849b'));
    });
    nodes.forEach((node, i) => {
      const p = positions.get(node.id)!;
      const text = [...(labels[node.id] ?? node.name)];
      const title = text.length > 32 ? `${text.slice(0, 31).join('')}…` : text.join('');
      const shape = this.shapes.create('box', `atlas-node-${i}`, [String(p.x), String(p.y), String(p.width), String(p.height), title]);
      shape.importAttributes({ 'data-node-id': node.id, 'role': 'button', 'tabindex': '0', 'aria-label': labels[node.id] ?? node.name });
      const body = shape.children.find(child => child.tag === 'rect')!;
      body.setAttribute('fill', node.id === selected ? '#dbeafe' : '#f8fafc');
      body.setAttribute('stroke', node.id === selected ? '#2563eb' : '#cbd5e1');
      const titleNode = shape.children.find(child => child.tag === 'text')!;
      titleNode.importAttributes({ 'fill': '#17243a', 'font-family': 'system-ui, sans-serif', 'font-size': '13' });
      document.add(shape);
      const subtitle = new Text(`atlas-note-${i}`, p.x + 20, p.y + 60, `${node.kind} · ${node.file}:${node.location.startLine}`);
      subtitle.importAttributes({ 'fill': '#526279', 'font-family': 'system-ui, sans-serif', 'font-size': '10', 'pointer-events': 'none' });
      document.add(subtitle);
    });
    return this.codec.encode(document);
  }
}
