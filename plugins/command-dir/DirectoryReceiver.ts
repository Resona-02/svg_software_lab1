import type { DirectoryEntry, DirectoryEntryKind, DirectoryReader } from './DirectoryReader.js';

/** Owns display policy; the injected reader owns access to the external system. */
export class DirectoryReceiver {
  constructor(
    private readonly reader: DirectoryReader,
    private readonly workingDirectory: () => string = () => process.cwd(),
  ) {}

  async list(): Promise<string> {
    const path = this.workingDirectory();
    let entries: readonly DirectoryEntry[];
    try {
      entries = await this.reader.list(path);
    } catch {
      throw new Error(`cannot read directory: ${path}`);
    }
    const order: Record<DirectoryEntryKind, number> = { directory: 0, file: 1, link: 2, other: 3 };
    const labels: Record<DirectoryEntryKind, string> = {
      directory: '[DIR]', file: '[FILE]', link: '[LINK]', other: '[OTHER]',
    };
    const sorted = entries.filter(entry => entry.name !== '.' && entry.name !== '..').sort((left, right) => {
      const groupOrder = order[left.kind] - order[right.kind];
      if (groupOrder !== 0) return groupOrder;
      if (left.name < right.name) return -1;
      if (left.name > right.name) return 1;
      return 0;
    });
    if (sorted.length === 0) return '(empty directory)';
    return sorted.map(entry => `${labels[entry.kind]}  ${entry.name}`).join('\n');
  }
}
