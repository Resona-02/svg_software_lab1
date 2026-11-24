import type { AtlasView, ReadingDirection, SourcePreview, SourceLocation, CodeRelation } from '../core/types.js';

import type { AtlasSession, AtlasRemote } from '../typert.js';
export type { AtlasSession, AtlasRemote } from '../typert.js';

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
}

/** One observable instance synchronizes map, tree and source; stale requests cannot replace a newer session. */
export class AtlasController {
  private state: AtlasClientState = { sessions: [], sessionId: '', busy: false, query: '', publicApiLabel: true };
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
        const sessionId = sessions.some(item => item.id === this.state.sessionId) ? this.state.sessionId : sessions[0]?.id ?? '';
        this.update({ sessions, sessionId, ...(sessionId !== this.state.sessionId ? { view: undefined, source: undefined, highlight: undefined } : {}) });
        this.followSession(sessionId);
      }
    });
  }

  selectSession(sessionId: string): void {
    if (this.disposed || !this.state.sessions.some(item => item.id === sessionId)) return;
    this.generation++;
    this.update({ sessionId, view: undefined, source: undefined, highlight: undefined, error: undefined, notice: undefined, busy: false, publicApiLabel: true });
    this.followSession(sessionId);
  }

  setQuery(query: string): void { this.update({ query }); }

  async scan(): Promise<void> {
    const session = this.state.sessionId;
    if (!session) { this.update({ error: '请先选择有工作目录的 DSH 会话。' }); return; }
    await this.task(async current => {
      const view = await this.remote.scan(session);
      if (!current()) return;
      this.update({ view, source: undefined, notice: `已分析 ${view.snapshot.nodes.filter(node => node.kind === 'file').length} 个源码文件` });
      if (view.selectedId) {
        const selected = await this.remote.inspect(session, view.selectedId);
        if (current()) this.update({ ...selected, highlight: undefined });
      }
    }, true);
  }

  async selectNode(nodeId: string): Promise<void> {
    const session = this.state.sessionId;
    if (!session || !this.state.view) return;
    await this.task(async current => {
      const result = await this.remote.inspect(session, nodeId);
      if (current()) this.update({ ...result, highlight: undefined, notice: undefined });
    }, false, true);
  }

  async selectEvidence(relation: CodeRelation): Promise<void> {
    const session = this.state.sessionId;
    if (!session || !this.state.view) return;
    await this.task(async current => {
      const result = await this.remote.inspect(session, relation.from);
      if (current()) this.update({ ...result, highlight: relation.location, notice: undefined });
    }, false, true);
  }

  async changeRoute(direction: ReadingDirection, depth: 1 | 2): Promise<void> {
    const session = this.state.sessionId;
    if (!session || !this.state.view) return;
    await this.task(async current => {
      const view = await this.remote.route(session, direction, depth);
      if (current()) this.update({ view });
    });
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

  dispose(): void { this.disposed = true; this.generation++; this.stopFollowing(); this.listeners.clear(); }

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
