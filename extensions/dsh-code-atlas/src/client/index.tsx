import type { Context } from '@deepseek-ai/cordis';
import { AtlasController } from './AtlasController.js';
import type { AtlasRemote } from './AtlasController.js';
import { AtlasPage } from './AtlasPage.js';
import { TYPERT_REMOTE } from '../typert.js';

export const name = 'dsh-code-atlas-client';
export const inject = ['slots', 'layout', 'remote'];

/** Minimal boundary for the verified rc.1 slot and Remote services. */
interface AtlasBrowserContext {
  remote: {
    $mount(manifest: typeof TYPERT_REMOTE): Promise<() => void>;
    codeAtlas: AtlasRemote;
  };
  slots: {
    inject(name: string, action: () => unknown): unknown;
    register(options: Record<string, unknown>, component: unknown): () => void;
  };
  layout: { selectPanel(id: string | null): void; panelInfo: { getSnapshot(): { activePanelId: string | null } } };
}

/** Register a keyed native page and native sidebar entry; no separate window or HTTP port. */
export async function apply(context: Context): Promise<void> {
  const ctx = context as Context & AtlasBrowserContext;
  const unmount = await ctx.remote.$mount(TYPERT_REMOTE);
  context.effect(() => unmount);
  // Mount first, then request its newly provided namespace. Cordis traces nested
  // Remote properties as distinct services, so injecting only `remote` is insufficient.
  await context.inject(['remote.codeAtlas'], child => {
    const scoped = child as Context & AtlasBrowserContext;
    const controller = new AtlasController(scoped.remote.codeAtlas);
    child.effect(() => () => controller.dispose());
    scoped.slots.inject('main', () => scoped.slots.register({
      name: 'main', key: 'code-atlas', inject: () => ({ controller }),
    }, AtlasPage));
    scoped.slots.inject('sidebar.panellist', () => scoped.slots.register({
      name: 'sidebar.panellist', id: 'code-atlas', order: 15, label: () => '代码地图',
    }, CodeAtlasIcon));
  });
}

function CodeAtlasIcon({ size = 20 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="2" y="3" width="7" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.6" /><rect x="15" y="3" width="7" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.6" /><rect x="8.5" y="15" width="7" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.6" /><path d="M5.5 9v3h13V9M12 12v3" stroke="currentColor" strokeWidth="1.6" /></svg>;
}
