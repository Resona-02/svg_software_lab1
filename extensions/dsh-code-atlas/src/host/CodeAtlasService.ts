import { basename } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import { RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { SessionId } from '@deepseek-ai/dsh-session/types';
import type {} from '@deepseek-ai/dsh-session';
import type {} from '@deepseek-ai/dsh-fs';
import type { AtlasSession } from '../typert.js';
import type { AtlasView, ReadingDirection, GuideProvider, ReviewContext, ReviewIntent } from '../core/types.js';
import { DshGuideProvider, type LlmPort, type ModelSelectionPort } from './DshGuideProvider.js';
import { AtlasWorkbench } from '../core/AtlasWorkbench.js';
import { TypeScriptLanguageProvider } from '../analysis/index.js';
import { testFileLabel } from '../plugins/test-file-label.js';
import { DshCodeSource } from './DshCodeSource.js';

declare module '@deepseek-ai/cordis' { interface Context { codeAtlas: CodeAtlasService } }

/** Native RPC service: callers select an existing session, never a filesystem root. */
export class CodeAtlasService extends TypertRemoteService {
  static inject = ['fs', 'sessions'];
  readonly workbench: AtlasWorkbench;
  private readonly lifetime = new AbortController();
  private readonly watches = new Map<string, Set<AbortController>>();
  private guideProvider?: GuideProvider;
  private modelSelection?: ModelSelectionPort;
  private readonly generating = new Map<string, AbortController>();
  private readonly reviewContexts = new Map<string, ReviewContext>();

  constructor(ctx: Context) {
    super(ctx, 'codeAtlas');
    this.workbench = new AtlasWorkbench(new DshCodeSource(ctx.fs), new TypeScriptLanguageProvider());
    const unregisterTestFileLabel = this.workbench.extensions.registerLabel(testFileLabel);
    // Optional native capability: structural reading remains available without a model.
    void ctx.inject(['llm', 'agentDefaultModel'], scope => {
      const ports = scope as Context & { llm: LlmPort; agentDefaultModel: ModelSelectionPort };
      this.modelSelection = ports.agentDefaultModel;
      const provider = new DshGuideProvider(ports.llm, ports.agentDefaultModel);
      this.guideProvider = provider;
      scope.effect(() => () => { if (this.guideProvider === provider) { this.guideProvider = undefined; this.modelSelection = undefined; } });
    });
    ctx.effect(() => () => {
      unregisterTestFileLabel();
      this.lifetime.abort(new Error('The Code Atlas plugin has been unloaded.'));
      this.reviewContexts.clear(); this.generating.clear();
      this.watches.clear(); this.workbench.dispose();
    });
    ctx.on('agent/disposed', ({ agent }) => this.closeState(agent.id));
    ctx.on('session/disposed', session => this.closeState(session.id));
  }

  sessions(signal?: AbortSignal): readonly AtlasSession[] {
    signal?.throwIfAborted();
    return this.ctx.sessions.list().filter(session => !!session.header.cwd).map(session => ({
      id: String(session.id), cwd: session.header.cwd!,
      title: `${basename(session.header.cwd!)} · ${String(session.id).slice(0, 8)}`,
    }));
  }

  async scan(sessionId: string, signal?: AbortSignal) {
    const session = this.session(sessionId, signal);
    return this.workbench.scan(sessionId, session.header.cwd!, signal);
  }
  async inspect(sessionId: string, nodeId: string, signal?: AbortSignal) {
    this.session(sessionId, signal);
    return this.workbench.inspect(sessionId, nodeId, signal);
  }
  route(sessionId: string, direction: ReadingDirection, depth: 1 | 2, signal?: AbortSignal) {
    this.session(sessionId, signal);
    if (!['dependencies', 'users'].includes(direction) || ![1, 2].includes(depth)) throw new RemoteError('gateway/bad-request', 'Unsupported reading direction or depth', {});
    return this.workbench.route(sessionId, direction, depth);
  }
  markRead(sessionId: string, nodeId: string, read: boolean, signal?: AbortSignal) {
    this.session(sessionId, signal);
    if (typeof read !== 'boolean') throw new RemoteError('gateway/bad-request', 'read must be a boolean', {});
    return this.workbench.markRead(sessionId, nodeId, read);
  }
  setPublicApiLabel(sessionId: string, enabled: boolean, signal?: AbortSignal) {
    this.session(sessionId, signal);
    if (typeof enabled !== 'boolean') throw new RemoteError('gateway/bad-request', 'enabled must be a boolean', {});
    return this.workbench.setPublicApiLabel(sessionId, enabled);
  }
  view(sessionId: string, signal?: AbortSignal) {
    this.session(sessionId, signal);
    return this.workbench.view(sessionId);
  }
  exportSVG(sessionId: string, signal?: AbortSignal) {
    this.session(sessionId, signal);
    return this.workbench.exportSVG(sessionId);
  }
  close(sessionId: string, signal?: AbortSignal): null {
    this.session(sessionId, signal);
    this.closeState(sessionId);
    return null;
  }
  graphKind(sessionId: string, kind: 'structure' | 'calls', signal?: AbortSignal) {
    this.session(sessionId, signal); return this.workbench.setGraphKind(sessionId, kind);
  }
  navigate(sessionId: string, nodeId: string, direction: ReadingDirection, depth: 1 | 2, graphKind: 'structure' | 'calls', signal?: AbortSignal) {
    this.session(sessionId, signal); return this.workbench.navigate(sessionId, nodeId, direction, depth, graphKind, signal);
  }
  guideStatus() {
    return { available: !!this.guideProvider, model: this.modelSelection?.currentSelection().model ?? '',
      message: this.guideProvider ? '使用 DSH 当前默认模型，按需发送与任务相关的代码摘录。' : '当前宿主没有可用模型服务；可在会话中让模型调用导览工具。' };
  }
  async reviewContext(sessionId: string, task: string, intent?: ReviewIntent, signal?: AbortSignal) {
    this.session(sessionId, signal);
    const context = await this.workbench.reviewContext(sessionId, task, signal, intent);
    this.session(sessionId, signal); this.reviewContexts.set(sessionId, context); return context;
  }
  async generateGuide(sessionId: string, task: string, intent?: ReviewIntent, signal?: AbortSignal) {
    this.session(sessionId, signal);
    if (!this.guideProvider) throw new Error('当前宿主尚未配置模型服务。请在 DSH 配置模型，或使用会话中的导览工具。');
    this.generating.get(sessionId)?.abort();
    const request = new AbortController(); this.generating.set(sessionId, request);
    const cancelled = AbortSignal.any([request.signal, this.lifetime.signal, AbortSignal.timeout(90000), ...(signal ? [signal] : [])]);
    try {
      const context = await this.workbench.reviewContext(sessionId, task, cancelled, intent);
      const result = await this.guideProvider.generate(context, cancelled);
      cancelled.throwIfAborted(); this.session(sessionId, cancelled);
      await this.workbench.verifyContext(sessionId, context, cancelled);
      return this.workbench.publishGuide(sessionId, context.snapshotId, result, new Set(context.symbols.map(item => item.node.id)), cancelled, context.intent, context.changes);
    } finally { if (this.generating.get(sessionId) === request) this.generating.delete(sessionId); }
  }
  cancelGuide(sessionId: string): null { this.session(sessionId); this.generating.get(sessionId)?.abort(); return null; }
  async publishGuide(sessionId: string, snapshotId: string, draft: unknown, signal?: AbortSignal) {
    this.session(sessionId, signal);
    const context = this.reviewContexts.get(sessionId);
    if (!context || context.snapshotId !== snapshotId) throw new Error('请先用 code_atlas_review_context 获取当前任务的代码，再发布导览。');
    await this.workbench.verifyContext(sessionId, context, signal);
    return this.workbench.publishGuide(sessionId, snapshotId, draft, new Set(context.symbols.map(item => item.node.id)), signal, context.intent, context.changes);
  }

  /** Native Typert stream; slow consumers retain only the latest published view. */
  async *watch(sessionId: string, signal?: AbortSignal): AsyncIterable<AtlasView> {
    this.session(sessionId, signal);
    const controller = new AbortController();
    let set = this.watches.get(sessionId);
    if (!set) { set = new Set(); this.watches.set(sessionId, set); }
    set.add(controller);
    const cancelled = AbortSignal.any([controller.signal, this.lifetime.signal, ...(signal ? [signal] : [])]);
    let latest: AtlasView | undefined;
    let wake: (() => void) | undefined;
    const notify = () => { const resume = wake; wake = undefined; resume?.(); };
    const unsubscribe = this.workbench.subscribe(sessionId, view => { latest = view; notify(); });
    cancelled.addEventListener('abort', notify);
    try {
      try { latest = this.workbench.view(sessionId); }
      catch (error) { if ((error as { code?: string }).code !== 'SCAN_REQUIRED') throw error; }
      while (true) {
        cancelled.throwIfAborted();
        if (!latest) await new Promise<void>(resolve => { wake = resolve; });
        cancelled.throwIfAborted();
        if (!latest) continue;
        const value = latest; latest = undefined;
        yield value;
      }
    } finally {
      unsubscribe(); cancelled.removeEventListener('abort', notify);
      set.delete(controller);
      if (!set.size && this.watches.get(sessionId) === set) this.watches.delete(sessionId);
    }
  }

  private closeState(id: string): void {
    this.reviewContexts.delete(id);
    this.generating.get(id)?.abort(); this.generating.delete(id);
    for (const watch of this.watches.get(id) ?? []) watch.abort(new Error('The Code Atlas reading session was closed.'));
    this.watches.delete(id); this.workbench.close(id);
  }

  private session(id: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (!id) throw new RemoteError('gateway/bad-request', 'A live DSH session is required', {});
    const session = this.ctx.sessions.get(SessionId(id));
    if (!session) throw new RemoteError('session/not-found', 'The DSH session no longer exists', { sessionId: SessionId(id) });
    if (!session.header.cwd) throw new RemoteError('gateway/bad-request', 'Select a session with a local workspace directory', {});
    return session;
  }
}
