import type { ToolRunContext } from '@deepseek-ai/dsh-tools';
import { SvgEditor } from './SvgEditor.js';
import { SvgToolError } from './SvgToolError.js';

interface SessionEntry {
  readonly editor: Promise<SvgEditor>;
  tail: Promise<unknown>;
}

/** Agent identity owns an isolated, serial editor; plugin unload drops every session. */
export class SvgSessions {
  private readonly entries = new Map<string, SessionEntry>();
  private disposed = false;

  async run<T>(exec: ToolRunContext, operation: (editor: SvgEditor) => T | Promise<T>): Promise<T> {
    exec.signal.throwIfAborted();
    if (this.disposed) throw new SvgToolError('SVG plugin has been disposed', 'SVG_SESSION_CLOSED');
    const id = exec.agent?.id;
    if (!id) throw new SvgToolError('SVG tools require an active DSH Agent session', 'SVG_SESSION_REQUIRED');
    let entry = this.entries.get(id);
    if (!entry) {
      if (this.entries.size >= 100) throw new SvgToolError('Close an inactive SVG session before opening more than 100 editors', 'SVG_SESSION_LIMIT');
      entry = { editor: SvgEditor.create(), tail: Promise.resolve() };
      this.entries.set(id, entry);
    }
    const current = entry;
    const result = current.tail.then(async () => {
      const editor = await current.editor;
      exec.signal.throwIfAborted();
      if (this.disposed || this.entries.get(id) !== current) throw new SvgToolError('SVG session has been closed', 'SVG_SESSION_CLOSED');
      try { return await operation(editor); }
      catch (error) {
        if (error instanceof SvgToolError || exec.signal.aborted) throw error;
        throw new SvgToolError(error instanceof Error ? error.message : String(error));
      }
    });
    current.tail = result.catch(() => undefined);
    return result;
  }

  close(id: string): void { this.entries.delete(id); }
  dispose(): void { this.disposed = true; this.entries.clear(); }
}
