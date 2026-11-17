export type DirectoryEntryKind = 'directory' | 'file' | 'link' | 'other';

export interface DirectoryEntry {
  readonly name: string;
  readonly kind: DirectoryEntryKind;
}

/** Target used by the command; filesystem-specific types stay in the adapter. */
export interface DirectoryReader {
  list(path: string): Promise<readonly DirectoryEntry[]>;
}
