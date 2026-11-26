import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import type { ReviewIntent } from '../core/types.js';
import { AtlasController } from './AtlasController.js';
import { ProjectNavigator } from './ProjectNavigator.js';
import { NewWorkbench } from './NewWorkbench.js';
import { MapPanel } from './MapPanel.js';
import { SourcePanel } from './SourcePanel.js';
import { GuidePanel } from './GuidePanel.js';
import { modeInfo, reviewModes } from './ReviewModes.js';
import { downloadSVG } from './svg.js';
import { styles } from './styles.js';

/** The task is primary; project structure and source are optional reading surfaces. */
export function AtlasPage({ controller }: { controller: AtlasController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [intent, setIntent] = useState<ReviewIntent>('flow');
  const [task, setTask] = useState('');
  const [navigatorOpen, setNavigatorOpen] = useState(false);
  const [focus, setFocus] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [navWidth, setNavWidth] = useState(248);
  const [sourceWidth, setSourceWidth] = useState(500);
  const [fontSize, setFontSize] = useState(14);
  const split = useRef<(() => void) | undefined>(undefined);
  const view = state.view, mode = modeInfo(intent);
  const selected = view?.snapshot.nodes.find(node => node.id === view.selectedId);
  const session = state.sessions.find(item => item.id === state.sessionId);
  const changed = view?.changes;
  const noChangeContext = intent === 'change-review' && (!changed?.baselineAvailable || ![...changed.added, ...changed.modified, ...changed.deleted].length);
  useEffect(() => { void controller.loadSessions(); return () => split.current?.(); }, [controller]);
  const resize = (event: ReactPointerEvent, side: 'nav' | 'source') => {
    event.preventDefault(); split.current?.();
    const start = event.clientX, width = side === 'nav' ? navWidth : sourceWidth;
    const move = (next: PointerEvent) => side === 'nav'
      ? setNavWidth(Math.max(210, Math.min(420, width + next.clientX - start)))
      : setSourceWidth(Math.max(340, Math.min(900, width - next.clientX + start)));
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); split.current = undefined; };
    split.current = stop; window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop);
  };
  const chooseIntent = (next: ReviewIntent) => {
    if (!task.trim() || task === mode.prompt) setTask(modeInfo(next).prompt);
    setIntent(next);
  };
  const generate = () => { if (task.trim() && view && state.modelStatus?.available && !state.busy && !state.guideBusy && !noChangeContext) void controller.generateGuide(task, intent); };
  return <main className={'ca-root' + (focus ? ' ca-focus' : '')} data-theme={theme}
    style={{ '--ca-code-size': fontSize + 'px' } as CSSProperties} data-code-atlas="page"
    onKeyDown={event => {
      if (event.key === 'Escape' && focus) setFocus(false);
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); generate(); }
      if (event.altKey && !['INPUT', 'TEXTAREA', 'SELECT'].includes((event.target as HTMLElement).tagName)) {
        if (event.key === 'ArrowLeft') { event.preventDefault(); void controller.navigate(-1); }
        if (event.key === 'ArrowRight') { event.preventDefault(); void controller.navigate(1); }
      }
    }}>
    <style>{styles}</style>
    <header className="ca-header">
      <div className="ca-brand"><span className="ca-brand-icon" aria-hidden="true">✳</span><strong>Code Atlas</strong><span className="ca-brand-caption">代码审阅工作台</span></div>
      <div className="ca-actions">
        <select aria-label="DSH 会话工作区" title={session?.cwd} value={state.sessionId} onChange={event => controller.selectSession(event.target.value)}>
          {!state.sessions.length && <option value="">选择项目会话</option>}
          {state.sessions.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select>
        <button aria-label="刷新会话" title="刷新会话" onClick={() => void controller.loadSessions()} disabled={state.busy}>↻</button>
        <button className="ca-scan-button" onClick={() => void controller.scan()} disabled={state.busy || !state.sessionId}>{state.busy ? '扫描中…' : view ? '重新扫描' : '建立索引'}</button>
        <button aria-label={theme === 'light' ? '切换深色外观' : '切换浅色外观'} onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>{theme === 'light' ? '◐' : '◑'}</button>
      </div>
    </header>
    <nav className="ca-toolbar" aria-label="代码阅读导航">
      <div className="ca-history-controls">
        <button aria-label="后退" title="后退 Alt+←" disabled={!state.canBack || state.busy} onClick={() => void controller.navigate(-1)}>←</button>
        <button aria-label="前进" title="前进 Alt+→" disabled={!state.canForward || state.busy} onClick={() => void controller.navigate(1)}>→</button>
      </div>
      <div className="ca-page-tabs">{(['overview', 'guide', 'map'] as const).map((pane, index) =>
        <button key={pane} aria-pressed={state.pane === pane} onClick={() => controller.setPane(pane)}>{['工作台', '阅读报告', '关系参考'][index]}</button>)}</div>
      <span className="ca-spacer" />
      <button aria-pressed={navigatorOpen} onClick={() => setNavigatorOpen(!navigatorOpen)}>文件</button>
      <button aria-pressed={state.sourceOpen && !focus} disabled={!state.source} onClick={() => { controller.setSourceOpen(focus || !state.sourceOpen); setFocus(false); }}>源码</button>
      <button aria-pressed={focus} onClick={() => setFocus(!focus)}>{focus ? '退出专注' : '专注'}</button>
    </nav>
    {state.error && <div className="ca-alert" role="alert">{state.error}</div>}
    <div className="ca-workspace">
      {view && navigatorOpen && !focus && <><aside className="ca-navigator" style={{ width: navWidth }}><ProjectNavigator controller={controller} /></aside>
        <div className="ca-split" role="separator" aria-label="调整文件导航宽度" tabIndex={0} aria-orientation="vertical" onPointerDown={event => resize(event, 'nav')} onKeyDown={event => { if (event.key === 'ArrowRight') setNavWidth(Math.min(420, navWidth + 20)); if (event.key === 'ArrowLeft') setNavWidth(Math.max(210, navWidth - 20)); }} /></>}
      <section className="ca-center">
        {!view || state.pane === 'overview' ? <NewWorkbench controller={controller} intent={intent} onIntent={chooseIntent} onTask={setTask} onBrowse={() => setNavigatorOpen(true)} onRevealSource={() => setFocus(false)} />
          : state.pane === 'guide' ? <GuidePanel controller={controller} onRevealSource={() => setFocus(false)} /> : <MapPanel controller={controller} onRevealSource={() => setFocus(false)} />}
      </section>
      {state.sourceOpen && !focus && <><div className="ca-split ca-source-split" role="separator" aria-label="调整源码宽度" tabIndex={0} aria-orientation="vertical" onPointerDown={event => resize(event, 'source')} onKeyDown={event => { if (event.key === 'ArrowLeft') setSourceWidth(Math.min(900, sourceWidth + 20)); if (event.key === 'ArrowRight') setSourceWidth(Math.max(340, sourceWidth - 20)); }} />
        <aside className="ca-source" style={{ width: sourceWidth }}><SourcePanel controller={controller} fontSize={fontSize} onFontSize={setFontSize} /></aside></>}
    </div>
    {!focus && <section className="ca-composer-area">
      <div className="ca-composer">
        <div className="ca-intent-tabs" aria-label="审阅任务类型">{reviewModes.map(item => <button key={item.id} aria-pressed={intent === item.id} onClick={() => chooseIntent(item.id)}>{item.label}</button>)}</div>
        <textarea aria-label="描述这次审阅任务" value={task} maxLength={2000} rows={2} onChange={event => setTask(event.target.value)} placeholder={mode.prompt} />
        <div className="ca-composer-bottom"><span title={selected?.file}>{selected ? '范围 · ' + (selected.qualifiedName ?? selected.name) : '先选择会话并建立索引'}</span><span className="ca-spacer" />
          {state.guideBusy ? <button className="ca-primary" onClick={() => void controller.cancelGuide()}>停止生成</button>
            : <button className="ca-primary" disabled={!view || !task.trim() || state.busy || !state.modelStatus?.available || noChangeContext} onClick={generate}>{mode.action}<span aria-hidden="true"> ↑</span></button>}
        </div>
      </div>
      <div className="ca-composer-caption">{noChangeContext ? '先建立基线，修改代码后再次扫描，再核验两次扫描间的变化。'
        : state.guideBusy ? '正在阅读相关源码，结果会显示在阅读报告中。'
        : state.modelStatus?.available ? '使用 ' + state.modelStatus.model + ' · 点击后发送相关代码摘录，可能产生费用 · ⌘ / Ctrl + Enter'
        : '浏览源码无需模型；生成报告需要 DSH 配置的模型，或由会话工具发布。'}</div>
    </section>}
    <footer className="ca-footer"><span>只读审阅</span><span className="ca-footer-separator">/</span><span role="status">{state.notice ?? (view ? '索引已就绪' : '等待建立项目索引')}</span><span className="ca-spacer" />
      {view && state.pane === 'map' && <button disabled={state.busy} onClick={() => void controller.exportSVG(downloadSVG)}>导出 SVG</button>}
    </footer>
  </main>;
}
