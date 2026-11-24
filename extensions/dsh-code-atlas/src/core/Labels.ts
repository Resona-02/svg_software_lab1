import type { CodeNode, NodeLabelProvider } from './types.js';

/** Component: a label's callers do not need to know whether it is decorated. */
export class BasicNodeLabel implements NodeLabelProvider {
  label(node: CodeNode, _readIds: ReadonlySet<string>): string { return node.name; }
}
/** Decorator: same interface, holds a component, delegates before adding a responsibility. */
export class PublicApiLabel implements NodeLabelProvider {
  constructor(private readonly inner: NodeLabelProvider) {}
  label(node: CodeNode, readIds: ReadonlySet<string>): string {
    return `${this.inner.label(node, readIds)}${node.exported && node.kind !== 'file' ? ' [公开 API]' : ''}`;
  }
}
export class ReadLabel implements NodeLabelProvider {
  constructor(private readonly inner: NodeLabelProvider) {}
  label(node: CodeNode, readIds: ReadonlySet<string>): string {
    return `${this.inner.label(node, readIds)}${readIds.has(node.id) ? ' [已读]' : ''}`;
  }
}
export interface LabelDecoratorFactory {
  readonly name: string;
  wrap(inner: NodeLabelProvider): NodeLabelProvider;
}
