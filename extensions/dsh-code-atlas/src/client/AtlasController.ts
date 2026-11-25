import type { AtlasView, ReadingDirection, SourcePreview, SourceLocation, CodeRelation } from '../core/types.js';
import { NavigationHistory } from './NavigationHistory.js';

import type { AtlasSession, AtlasRemote } from '../typert.js';
export type { AtlasSession, AtlasRemote } from '../typert.js';
export type WorkspacePane = 'overview' | 'map' | 'guide';
interface Visit { nodeId: string; name: string; direction: ReadingDirection; depth: 1 | 2; graphKind: 'structure' | 'calls'; pane: WorkspacePane; query: string; sourceOpen: boolean; highlight?: SourceLocation }

export interface AtlasClientState {
  readonly sessions: readonly AtlasSession[];
  readonly sessionId: string;
  readonly view?: AtlasView;
  readonly source?: SourcePreview;
  readonly highlight?: SourceLocation;
  readonly busy: boolean;
  readonly query: string;
  readonly publicApiLabel: boolean;
  readonly error?: string;
  readonly notice?: string;
  readonly pane: WorkspacePane;
  readonly sourceOpen: boolean;
  readonly canBack: boolean;
  readonly canForward: boolean;
  readonly trail: readonly { nodeId: string; name: string }[];
  readonly guideBusy: boolean;
  readonly modelStatus?: { available: boolean; model: string; message: string };
}

/** One observable instance synchronizes map, tree and source; stale requests cannot replace a newer session. */
export class AtlasController {
  private state: AtlasClientState = { sessions: [], sessionId: '', busy: false, query: '', publicApiLabel: true,
    pane: 'overview', sourceOpen: false, canBack: false, canForward: false, trail: [], guideBusy: false };
  private readonly histories = new Map<string, { snapshotId: string; history: NavigationHistory<Visit> }>();
  private guideGeneration = 0;
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  private disposed = false;
  private liveSession = '';
  private liveView?: AsyncIterable<AtlasView> & { dispose(): void };
  constructor(private readonly remote: AtlasRemote) {}

  readonly getSnapshot = (): AtlasClientState => this.state;
  readonly subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  async loadSessions(): Promise<void> {
    await this.task(async current => {
      const sessions = await this.remote.sessions();
      if (current()) {
        for (const id of this.histories.keys()) if (!sessions.some(session => session.id === id)) this.histories.delete(id);
        const sessionId = sessions.some(item => item.id === this.state.sessionId) ? this.state.sessionId : sessions[0]?.id ?? '';
        this.update({ sessions, sessionId, ...(sessionId !== this.state.sessionId ? { view: undefined, source: undefined, highlight: undefined } : {}) });
        this.followSession(sessionId);
        if (this.remote.guideStatus) void this.remote.guideStatus().then(modelStatus => { if (!this.disposed) this.update({ modelStatus }); }, () => undefined);
      }
    });
  }

  selectSession(sessionId: string): void {
    if (this.disposed || !this.state.sessions.some(item => item.id === sessionId)) return;
    if (this.state.guideBusy) void this.remote.cancelGuide(this.state.sessionId).catch(() => undefined);
    this.generation++;
    this.guideGeneration++;
    this.update({ sessionId, view: undefined, source: undefined, highlight: undefined, error: undefined, notice: undefined, busy: false, publicApiLabel: true,
      pane: 'overview', sourceOpen: false, canBack: false, canForward: false, trail: [], guideBusy: false });
    this.followSession(sessionId);
  }

  setQuery(query: string): void { this.update({ query }); }
  setPane(pane: WorkspacePane): void { this.update({ pane }); }
  setSourceOpen(sourceOpen: boolean): void { this.update({ sourceOpen }); }

  async scan(): Promise<void> {
    const session = this.state.sessionId;
    if (!session) { this.update({ error: '请先选择有工作目录的 DSH 会话。' }); return; }
    await this.task(async current => {
      const view = await this.remote.scan(session);
      if (!current()) return;
      this.update({ view, source: undefined, notice: `已分析 ${view.snapshot.nodes.filter(node => node.kind === 'file').length} 个源码文件` });
      if (view.selectedId) {
        const selected = await this.remote.inspect(session, view.selectedId);
        if (current()) { this.update({ ...selected, highlight: undefined }); this.remember(selected.view); }
      }
    }, true);
  }

  async selectNode(nodeId: string, options: { pane?: WorkspacePane; revealSource?: boolean } = {}): Promise<void> {
    const session = this.state.sessionId;
    if (!session || !this.state.view) return;
    this.remember(this.state.view);
    await this.task(async current => {
      const result = await this.remote.inspect(session, nodeId);
      if (current()) {
        this.update({ ...result, highlight: undefined, notice: undefined,
          pane: options.pane ?? (this.state.pane === 'overview' ? 'map' : this.state.pane), sourceOpen: options.revealSource ?? this.state.sourceOpen });
        this.remember(result.view);
      }
    }, false, true);
  }

  async selectEvidence(relation: CodeRelation): Promise<void> {
    const session = this.state.sessionId;
    if (!session || !this.state.view) return;
    this.remember(this.state.view);
    await this.task(async current => {
      const result = await this.remote.inspect(session, relation.from);
      if (current()) { this.update({ ...result, highlight: relation.location, notice: undefined, sourceOpen: true }); this.remember(result.view); }
    }, false, true);
  }

  async changeRoute(direction: ReadingDirection, depth: 1 | 2): Promise<void> {
    const session = this.state.sessionId;
    if (!session || !this.state.view) return;
    this.remember(this.state.view);
    await this.task(async current => {
      const view = await this.remote.route(session, direction, depth);
      if (current()) { this.update({ view }); this.remember(view); }
    });
  }

  async changeGraphKind(kind: 'structure' | 'calls'): Promise<void> {
    if (!this.state.view) return;
    this.remember(this.state.view);
    await this.task(async current => {
      const view = await this.remote.graphKind(this.state.sessionId, kind);
      if (current()) { this.update({ view, pane: 'map' }); this.remember(view); }
    });
  }

  async navigate(offset: -1 | 1): Promise<void> {
    const session = this.state.sessionId;
    if (this.state.view) this.remember(this.state.view);
    const history = this.histories.get(session)?.history;
    const target = history?.target(offset);
    if (!target) return;
    await this.task(async current => {
      const visit = target.entry;
      const result = await this.remote.navigate(session, visit.nodeId, visit.direction, visit.depth, visit.graphKind);
      if (current()) {
        history!.commit(target.index);
        this.update({ ...result, pane: visit.pane, query: visit.query, sourceOpen: visit.sourceOpen, highlight: visit.highlight,
          canBack: history!.canBack, canForward: history!.canForward, trail: history!.trail() });
      }
    }, false, true);
  }

  async generateGuide(task: string): Promise<void> {
    const session = this.state.sessionId;
    if (!session || !this.state.view || !task.trim() || this.state.guideBusy) return;
    const generation = ++this.guideGeneration;
    this.update({ guideBusy: true, error: undefined });
    try {
      const view = await this.remote.generateGuide(session, task);
      if (!this.disposed && generation === this.guideGeneration && this.state.sessionId === session) this.update({ view, pane: 'guide' });
    } catch (error) {
      if (!this.disposed && generation === this.guideGeneration) this.update({ error: error instanceof Error ? error.message : String(error) });
    } finally { if (!this.disposed && generation === this.guideGeneration) this.update({ guideBusy: false }); }
  }
  async cancelGuide(): Promise<void> {
    const session = this.state.sessionId;
    this.guideGeneration++; this.update({ guideBusy: false });
    try { await this.remote.cancelGuide(session); } catch { /* cancellation is best effort after a session closes */ }
  }

  private remember(view: AtlasView): void {
    const session = this.state.sessionId;
    let item = this.histories.get(session);
    if (item?.snapshotId !== view.snapshot.id) {
      item = { snapshotId: view.snapshot.id, history: new NavigationHistory<Visit>((a, b) => a.nodeId === b.nodeId && a.direction === b.direction && a.depth === b.depth && a.graphKind === b.graphKind && a.highlight?.start === b.highlight?.start) };
      this.histories.set(session, item);
    }
    const node = view.snapshot.nodes.find(node => node.id === view.selectedId);
    const name = node?.qualifiedName ?? node?.name ?? view.selectedId;
    item.history.push({ nodeId: view.selectedId, name, direction: view.direction, depth: view.depth, graphKind: view.graphKind ?? 'structure',
      pane: this.state.pane, query: this.state.query, sourceOpen: this.state.sourceOpen, ...(this.state.highlight ? { highlight: this.state.highlight } : {}) });
    this.update({ canBack: item.history.canBack, canForward: item.history.canForward, trail: item.history.trail() });
  }

  async markSelected(read: boolean): Promise<void> {
    const { sessionId, view } = this.state;
    if (!sessionId || !view?.selectedId) return;
    await this.task(async current => {
      const next = await this.remote.markRead(sessionId, view.selectedId, read);
      if (current()) this.update({ view: next });
    });
  }

  async togglePublicApi(enabled: boolean): Promise<void> {
    const session = this.state.sessionId;
    if (!session || !this.state.view) { this.update({ publicApiLabel: enabled }); return; }
    await this.task(async current => {
      const view = await this.remote.setPublicApiLabel(session, enabled);
      if (current()) this.update({ view, publicApiLabel: enabled });
    });
  }

  async exportSVG(download: (svg: string, filename: string) => void): Promise<void> {
    const session = this.state.sessionId;
    if (!session || !this.state.view) return;
    await this.task(async current => {
      const exported = await this.remote.exportSVG(session);
      if (current()) { download(exported.svg, exported.filename); this.update({ notice: 'SVG 已导出，可在下载目录中查看。' }); }
    });
  }

  dispose(): void { this.disposed = true; this.generation++; this.guideGeneration++; this.stopFollowing(); this.listeners.clear(); this.histories.clear(); }

  /** Native Remote streams synchronize tool calls with the already-open page. */
  private followSession(sessionId: string): void {
    if (this.disposed || this.liveSession === sessionId && this.liveView) return;
    this.stopFollowing();
    if (!sessionId) return;
    try {
      const stream = this.remote.watch(sessionId);
      this.liveSession = sessionId;
      this.liveView = stream;
      void this.observeViews(sessionId, stream);
    } catch (error) { this.update({ error: `无法同步会话地图：${error instanceof Error ? error.message : String(error)}` }); }
  }

  private stopFollowing(): void {
    const stream = this.liveView;
    this.liveView = undefined;
    this.liveSession = '';
    stream?.dispose();
  }

  private async observeViews(sessionId: string, stream: AsyncIterable<AtlasView> & { dispose(): void }): Promise<void> {
    const current = () => !this.disposed && this.liveView === stream && this.state.sessionId === sessionId;
    try {
      for await (const view of stream) {
        if (!current()) break;
        const source = this.state.source;
        const selected = view.snapshot.nodes.find(node => node.id === view.selectedId);
        const sameSource = Boolean(source && source.snapshotId === view.snapshot.id && source.node.id === view.selectedId
          && source.node.location.fileHash === selected?.location.fileHash);
        const selectionChanged = this.state.view?.selectedId !== view.selectedId || this.state.view?.snapshot.id !== view.snapshot.id;
        this.update({ view, ...('publicApiLabel' in view && typeof view.publicApiLabel === 'boolean' ? { publicApiLabel: view.publicApiLabel } : {}),
          ...(!sameSource ? { source: undefined, highlight: undefined } : {}),
          ...(selectionChanged && !this.state.busy ? { notice: '会话地图已同步，点击选中节点查看源码。' } : {}),
        });
        if (selectionChanged && !this.state.busy) this.remember(view);
      }
    } catch (error) {
      if (current()) this.update({ error: `地图同步已中断，请刷新会话重连。${error instanceof Error ? error.message : String(error)}` });
    } finally {
      if (this.liveView === stream) { this.liveView = undefined; this.liveSession = ''; }
    }
  }

  private update(patch: Partial<AtlasClientState>): void {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  private async task(action: (current: () => boolean) => Promise<void>, clearView = false, clearSource = false): Promise<void> {
    if (this.disposed) return;
    const generation = ++this.generation;
    const current = () => !this.disposed && generation === this.generation;
    this.update({ busy: true, error: undefined, ...(clearView ? { view: undefined, source: undefined, highlight: undefined } : {}), ...(clearSource ? { source: undefined, highlight: undefined } : {}) });
    try { await action(current); }
    catch (error) {
      if (current()) {
        const message = error instanceof Error ? error.message : String(error);
        this.update({ error: /STALE_SOURCE|stale|changed|已变化/i.test(message) ? `源码已变化，请点击“扫描 / 刷新”后重试。${message}` : message, source: undefined, highlight: undefined });
      }
    } finally { if (current()) this.update({ busy: false }); }
  }
}
