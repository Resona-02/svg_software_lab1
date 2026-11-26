/** Editor-independent, immutable source facts. Lines/columns are 1-based; offsets are UTF-16. */
export interface SourceLocation {
  readonly file: string;
  readonly start: number;
  readonly end: number;
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
  readonly fileHash: string;
}
export interface SourceFile {
  readonly path: string;
  readonly content: string;
  readonly hash: string;
}
export interface SourceSnapshot { readonly root: string; readonly files: readonly SourceFile[] }
export type NodeKind = 'file' | 'class' | 'interface' | 'function' | 'method' | 'namespace';
export interface CodeNode {
  readonly id: string;
  readonly name: string;
  readonly qualifiedName?: string;
  readonly kind: NodeKind;
  readonly file: string;
  readonly parentId?: string;
  readonly exported: boolean;
  readonly location: SourceLocation;
}
export interface CodeRelation {
  readonly id: string;
  readonly kind: 'imports' | 'reexports' | 'extends' | 'implements' | 'calls' | 'constructs';
  readonly from: string;
  readonly to?: string;
  readonly targetName: string;
  readonly resolved: boolean;
  readonly location: SourceLocation;
  readonly excerpt?: string;
  readonly dispatch?: 'direct' | 'declared' | 'unknown';
}
export interface AtlasDiagnostic { readonly file: string; readonly message: string; readonly line?: number }
export interface AnalysisSnapshot {
  readonly id: string;
  readonly root: string;
  readonly nodes: readonly CodeNode[];
  readonly relations: readonly CodeRelation[];
  readonly diagnostics: readonly AtlasDiagnostic[];
}
export interface LanguageProvider { readonly name: string; analyze(source: SourceSnapshot): Promise<AnalysisSnapshot> }
export interface CodeSource {
  snapshot(root: string, signal?: AbortSignal): Promise<SourceSnapshot>;
  read(root: string, file: string, signal?: AbortSignal): Promise<SourceFile>;
}
export type ReadingDirection = 'dependencies' | 'users';
export interface ReadingStrategy {
  readonly name: ReadingDirection;
  select(snapshot: AnalysisSnapshot, nodeId: string, depth: 1 | 2): { readonly nodeIds: readonly string[]; readonly relationIds: readonly string[]; readonly truncated?: boolean };
}
export interface NodeLabelProvider { label(node: CodeNode, readIds: ReadonlySet<string>): string }
export interface AtlasView {
  readonly snapshot: AnalysisSnapshot;
  readonly selectedId: string;
  readonly direction: ReadingDirection;
  readonly depth: 1 | 2;
  readonly readIds: readonly string[];
  readonly publicApiLabel: boolean;
  readonly graphKind: 'structure' | 'calls';
  readonly guide?: ReadingGuide;
  readonly changes?: SnapshotChanges;
  readonly labels: Readonly<Record<string, string>>;
  readonly graph: { readonly nodeIds: readonly string[]; readonly relationIds: readonly string[]; readonly truncated?: boolean };
  readonly svg: string;
}
export interface SourcePreview { readonly node: CodeNode; readonly content: string; readonly snapshotId: string }

/** Model explanations refer to verified symbols; they never become compiler facts. */
export interface GuideStep {
  readonly id: string;
  readonly title: string;
  readonly explanation: string;
  readonly nodeIds: readonly string[];
  readonly next: readonly string[];
  readonly checks: readonly string[];
}
export interface ReadingGuide {
  readonly snapshotId: string;
  readonly title: string;
  readonly summary: string;
  readonly steps: readonly GuideStep[];
  readonly risks: readonly string[];
  readonly origin: 'model';
  readonly intent?: ReviewIntent;
  readonly scope: { readonly providedSymbols: number; readonly totalSymbols: number };
}
export interface ReviewContext {
  readonly snapshotId: string;
  readonly task: string;
  readonly intent?: ReviewIntent;
  readonly changes?: SnapshotChanges;
  /** Changed paths that have no current code node and cannot be cited as source evidence. */
  readonly unavailableFiles?: readonly string[];
  readonly symbols: readonly { readonly node: CodeNode; readonly source: string; readonly sourceTruncated?: boolean }[];
  readonly relations: readonly CodeRelation[];
  readonly omittedSymbols: number;
  readonly omittedRelations?: number;
}
export type ReviewIntent = 'flow' | 'design' | 'refactor' | 'change-review';
/** Difference between consecutive successful scans in one session/workspace, not Git history. */
export interface SnapshotChanges {
  readonly baselineAvailable: boolean;
  readonly baselineSnapshotId?: string;
  readonly added: readonly string[];
  readonly modified: readonly string[];
  readonly deleted: readonly string[];
}
export interface GuideProvider { generate(context: ReviewContext, signal?: AbortSignal): Promise<unknown> }
