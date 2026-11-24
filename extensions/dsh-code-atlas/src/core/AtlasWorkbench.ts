import { AtlasError } from './AtlasError.js';
import { AtlasRegistry } from './AtlasRegistry.js';
import { AtlasSvgRenderer } from '../render/AtlasSvgRenderer.js';
import type { AnalysisSnapshot, AtlasView, CodeNode, CodeSource, LanguageProvider, ReadingDirection, SourcePreview } from './types.js';

interface ReadingState {
  readonly root: string;
  readonly snapshot: AnalysisSnapshot;
  selectedId: string;
  direction: ReadingDirection;
  depth: 1 | 2;
  publicApi: boolean;
  readonly readIds: Set<string>;
}

/** Source facts and reading state have separate lifetimes; publication is atomic. */
export class AtlasWorkbench {
  readonly extensions: AtlasRegistry;
  private readonly states = new Map<string, ReadingState>();
  private readonly listeners = new Map<string, Set<(view: AtlasView) => void>>();
  private readonly generations = new Map<string, number>();
  private readonly scans = new Map<string, Promise<AtlasView>>();
  private readonly rendererPromise = AtlasSvgRenderer.create();
  private renderer?: AtlasSvgRenderer;
  private disposed = false;

  constructor(private readonly source: CodeSource, private readonly provider: LanguageProvider) {
    this.extensions = new AtlasRegistry(provider);
  }
  async scan(sessionId: string, root: string, signal?: AbortSignal): Promise<AtlasView> {
    this.assertOpen();
    if (!sessionId) throw new AtlasError('Select a DSH conversation first.', 'SESSION_REQUIRED');
    const previousScan = this.scans.get(sessionId) ?? Promise.resolve(undefined);
    const generation = this.generations.get(sessionId) ?? 0;
    const task = previousScan.catch(() => undefined).then(async () => {
      signal?.throwIfAborted(); this.assertOpen();
      const files = await this.source.snapshot(root, signal);
      const snapshot = await this.extensions.language(this.provider.name).analyze(files);
      this.renderer = await this.rendererPromise;
      signal?.throwIfAborted(); this.assertOpen();
      if ((this.generations.get(sessionId) ?? 0) !== generation) throw new AtlasError('The reading session was closed.', 'SESSION_CLOSED');
      if (!snapshot.nodes.length) throw new AtlasError('No supported TS/JS source files were found in this workspace.', 'EMPTY_PROJECT');
      const stored = this.states.get(sessionId);
      const previous = stored?.root === root ? stored : undefined;
      const known = new Map(snapshot.nodes.map(node => [node.id, node]));
      const old = new Map(previous?.snapshot.nodes.map(node => [node.id, node]) ?? []);
      const readIds = new Set([...previous?.readIds ?? []].filter(id => known.get(id)?.location.fileHash === old.get(id)?.location.fileHash));
      const first = snapshot.nodes.find(node => node.kind === 'file' && /(?:^|\/)src\/main\.[cm]?[jt]s$/.test(node.file))
        ?? snapshot.nodes.find(node => node.kind === 'file') ?? snapshot.nodes[0]!;
      const selectedId = previous?.root === root && known.has(previous.selectedId) ? previous.selectedId : first.id;
      const next: ReadingState = { root, snapshot, selectedId, readIds,
        direction: previous?.direction ?? 'dependencies', depth: previous?.depth ?? 1, publicApi: previous?.publicApi ?? true };
      // Render before publishing: a failing extension cannot leave a half-published state.
      const view = this.buildView(next);
      this.states.set(sessionId, next);
      this.notify(sessionId, view);
      return view;
    });
    this.scans.set(sessionId, task);
    try { return await task; } finally { if (this.scans.get(sessionId) === task) this.scans.delete(sessionId); }
  }
  async inspect(sessionId: string, nodeId: string, signal?: AbortSignal): Promise<{ view: AtlasView; source: SourcePreview }> {
    const state = this.state(sessionId), node = this.node(state, nodeId);
    const file = await this.source.read(state.root, node.file, signal);
    signal?.throwIfAborted();
    if (this.states.get(sessionId) !== state || file.hash !== node.location.fileHash) {
      throw new AtlasError('Source has changed. Refresh the code map before navigating to these lines.', 'STALE_SOURCE');
    }
    const next = { ...state, selectedId: nodeId };
    const view = this.buildView(next);
    this.states.set(sessionId, next); this.notify(sessionId, view);
    return { view, source: { node, content: file.content, snapshotId: state.snapshot.id } };
  }
  route(sessionId: string, direction: ReadingDirection, depth: 1 | 2): AtlasView {
    if (!['dependencies', 'users'].includes(direction) || ![1, 2].includes(depth)) throw new AtlasError('Invalid reading direction or depth.', 'INVALID_ROUTE');
    const next = { ...this.state(sessionId), direction, depth };
    const view = this.buildView(next);
    this.states.set(sessionId, next); this.notify(sessionId, view);
    return view;
  }
  async markRead(sessionId: string, nodeId: string, read: boolean): Promise<AtlasView> {
    const state = this.state(sessionId), node = this.node(state, nodeId);
    const file = await this.source.read(state.root, node.file);
    if (this.states.get(sessionId) !== state || file.hash !== node.location.fileHash) throw new AtlasError('Source has changed. Refresh before marking this node.', 'STALE_SOURCE');
    const readIds = new Set(state.readIds);
    if (read) readIds.add(nodeId); else readIds.delete(nodeId);
    const next = { ...state, readIds };
    const view = this.buildView(next);
    this.states.set(sessionId, next); this.notify(sessionId, view);
    return view;
  }
  setPublicApiLabel(sessionId: string, enabled: boolean): AtlasView {
    const next = { ...this.state(sessionId), publicApi: enabled };
    const view = this.buildView(next);
    this.states.set(sessionId, next); this.notify(sessionId, view);
    return view;
  }
  view(sessionId: string): AtlasView { return this.buildView(this.state(sessionId)); }
  exportSVG(sessionId: string): { svg: string; filename: string } {
    return { svg: this.view(sessionId).svg, filename: 'code-atlas.svg' };
  }
  subscribe(sessionId: string, listener: (view: AtlasView) => void): () => void {
    this.assertOpen();
    let set = this.listeners.get(sessionId);
    if (!set) { set = new Set(); this.listeners.set(sessionId, set); }
    set.add(listener);
    return () => { set!.delete(listener); if (!set!.size) this.listeners.delete(sessionId); };
  }
  close(sessionId: string): void {
    this.generations.set(sessionId, (this.generations.get(sessionId) ?? 0) + 1);
    this.states.delete(sessionId); this.listeners.delete(sessionId);
  }
  dispose(): void {
    this.disposed = true; this.states.clear(); this.listeners.clear();
  }
  private state(sessionId: string): ReadingState {
    this.assertOpen();
    const value = this.states.get(sessionId);
    if (!value) throw new AtlasError('Scan this conversation’s workspace to open a code map.', 'SCAN_REQUIRED');
    return value;
  }
  private node(state: ReadingState, id: string): CodeNode {
    const node = state.snapshot.nodes.find(value => value.id === id);
    if (!node) throw new AtlasError('This node is no longer in the current snapshot. Refresh and select it again.', 'STALE_SOURCE');
    return node;
  }
  private buildView(state: ReadingState): AtlasView {
    const label = this.extensions.labels(state.publicApi);
    const labels = Object.fromEntries(state.snapshot.nodes.map(node => [node.id, label.label(node, state.readIds)]));
    const graph = this.extensions.strategy(state.direction).select(state.snapshot, state.selectedId, state.depth);
    return { snapshot: state.snapshot, selectedId: state.selectedId, direction: state.direction, depth: state.depth,
      readIds: [...state.readIds], publicApiLabel: state.publicApi, labels, graph, svg: this.renderer!.render(state.snapshot, graph, state.selectedId, labels) };
  }
  private notify(sessionId: string, view: AtlasView): void {
    // Display observers cannot roll back a successful publication or break other observers.
    for (const listener of [...this.listeners.get(sessionId) ?? []]) {
      try { listener(view); } catch { /* each view is independently disposable */ }
    }
  }
  private assertOpen(): void {
    if (this.disposed) throw new AtlasError('The Code Atlas plugin has been unloaded.', 'PLUGIN_CLOSED');
  }
}
