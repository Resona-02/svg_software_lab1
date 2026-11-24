import type { LabelDecoratorFactory } from '../core/Labels.js';
import type { CodeNode, NodeLabelProvider } from '../core/types.js';

/** Same-interface wrapper: test classification affects presentation, not source facts. */
export class TestFileLabel implements NodeLabelProvider {
  constructor(private readonly inner: NodeLabelProvider) {}

  label(node: CodeNode, readIds: ReadonlySet<string>): string {
    const label = this.inner.label(node, readIds);
    const file = node.file.replaceAll('\\', '/');
    const testFile = /(?:^|\/)(?:__tests__|tests?)(?:\/|$)/i.test(file)
      || /\.(?:test|spec)\.(?:[cm]?[jt]s|[jt]sx)$/i.test(file);
    return `${label}${testFile ? ' [测试文件]' : ''}`;
  }
}

/** The composition root registers this factory through the existing label contract. */
export const testFileLabel: LabelDecoratorFactory = {
  name: 'test-file',
  wrap: inner => new TestFileLabel(inner),
};
