import type { AtlasRemote } from '../typert.js';

interface RemoteFailure { readonly code: string; readonly message: string; readonly details?: unknown }
type RemoteResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: RemoteFailure };
export class AtlasRemoteError extends Error {
  constructor(readonly code: string, message: string, readonly details?: unknown) { super(`[${code}] ${message}`); this.name = 'AtlasRemoteError'; }
}
/** rc.1 unary methods return RemoteResult envelopes; streams return handles directly. */
export type NativeAtlasRemote = {
  [K in keyof AtlasRemote]: K extends 'watch' ? AtlasRemote[K]
    : AtlasRemote[K] extends (...args: infer A) => Promise<infer R> ? (...args: A) => Promise<RemoteResult<R>> : never;
};

async function value<T>(request: Promise<RemoteResult<T>>): Promise<T> {
  const result = await request;
  if (!result || typeof result !== 'object' || typeof result.ok !== 'boolean') throw new AtlasRemoteError('REMOTE_FORMAT', 'DSH 返回格式不兼容，请重新安装与当前宿主匹配的插件。');
  if (result.ok) return result.value;
  throw new AtlasRemoteError(result.error.code, result.error.message, result.error.details);
}

/** Keep transport result handling outside the source-reading controller. */
export function adaptNativeRemote(native: NativeAtlasRemote): AtlasRemote {
  return {
    sessions: () => value(native.sessions()),
    scan: session => value(native.scan(session)),
    inspect: (session, node) => value(native.inspect(session, node)),
    route: (session, direction, depth) => value(native.route(session, direction, depth)),
    markRead: (session, node, read) => value(native.markRead(session, node, read)),
    setPublicApiLabel: (session, enabled) => value(native.setPublicApiLabel(session, enabled)),
    view: session => value(native.view(session)),
    exportSVG: session => value(native.exportSVG(session)),
    close: session => value(native.close(session)),
    watch: session => native.watch(session),
    graphKind: (session, kind) => value(native.graphKind(session, kind)),
    guideStatus: () => value(native.guideStatus()),
    reviewContext: (session, task) => value(native.reviewContext(session, task)),
    generateGuide: (session, task) => value(native.generateGuide(session, task)),
    cancelGuide: session => value(native.cancelGuide(session)),
    publishGuide: (session, snapshot, draft) => value(native.publishGuide(session, snapshot, draft)),
    navigate: (session, node, direction, depth, kind) => value(native.navigate(session, node, direction, depth, kind)),
  };
}
