import type { Shape, SvgDocument, TreeDecorator, TreeRow } from '../../src/api/index.js';

/** Compares content with the last successful save/read, including descendants. */
export class ModifiedStar implements TreeDecorator {
  readonly name = 'modified-star';
  private baseline?: SvgDocument;
  private readonly savedContent = new Map<string | null, string>();

  decorate(row: TreeRow): string {
    if (!row.saved) return '*';
    if (this.baseline !== row.saved) {
      this.savedContent.clear();
      this.index(row.saved.root, row.saved);
      this.baseline = row.saved;
    }
    return this.unchanged(row.shape, row.document) ? '' : '*';
  }

  private index(shape: Shape, document: SvgDocument): void {
    this.savedContent.set(shape === document.root ? null : shape.id, this.content(shape, document));
    for (const child of shape.children) this.index(child, document);
  }

  private unchanged(shape: Shape, document: SvgDocument): boolean {
    return this.savedContent.get(shape === document.root ? null : shape.id) === this.content(shape, document)
      && shape.children.every(child => this.unchanged(child, document));
  }

  private content(shape: Shape, document: SvgDocument): string {
    const attributes = shape === document.root ? document.rootAttributes() : shape.attributes();
    return JSON.stringify({
      kind: shape.kind,
      attributes: Object.keys(attributes).sort().map(name => [name, attributes[name]]),
      text: shape.text,
      parent: shape.parent === document.root ? null : shape.parent?.id,
      children: shape.children.map(child => child.id),
    });
  }
}
