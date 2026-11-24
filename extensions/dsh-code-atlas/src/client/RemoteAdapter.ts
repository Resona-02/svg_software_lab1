import type { AtlasRemote } from '../typert.js';

interface RemoteFailure { readonly code: string; readonly message: string; readonly details?: unknown }
type RemoteResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: RemoteFailure };
/** rc.1 unary methods return RemoteResult envelopes; streams return handles directly. */
export type NativeAtlasRemote = {
  [K in keyof AtlasRemote]: K extends 'watch' ? AtlasRemote[K]
    : AtlasRemote[K] extends (...args: infer A) => Promise<infer R> ? (...args: A) => Promise<RemoteResult<R>> : never;
};

async function value<T>(request: Promise<RemoteResult<T>>): Promise<T> {
  const result = await request;
  if (result.ok) return result.value;
  throw new Error(`[${result.error.code}] ${result.error.message}`);
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
  };
}
