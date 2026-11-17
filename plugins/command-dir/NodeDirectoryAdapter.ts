import type { Dirent } from 'node:fs';
import { readdir } from 'node:fs/promises';
import type { DirectoryEntry, DirectoryEntryKind, DirectoryReader } from './DirectoryReader.js';

/** Object adapter from Node's directory entries to the command's own contract. */
export class NodeDirectoryAdapter implements DirectoryReader {
  private readonly fileSystem = { readdir };

  async list(path: string): Promise<readonly DirectoryEntry[]> {
    const entries = await this.fileSystem.readdir(path, { withFileTypes: true });
    return entries.map(entry => ({ name: entry.name, kind: this.kind(entry) }));
  }

  private kind(entry: Dirent): DirectoryEntryKind {
    if (entry.isDirectory()) return 'directory';
    if (entry.isFile()) return 'file';
    if (entry.isSymbolicLink()) return 'link';
    return 'other';
  }
}
