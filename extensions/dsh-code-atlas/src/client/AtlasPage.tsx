import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { AtlasController } from './AtlasController.js';
import { ProjectNavigator, ProjectOverview } from './ProjectNavigator.js';
import { MapPanel } from './MapPanel.js';
import { SourcePanel } from './SourcePanel.js';
import { GuidePanel } from './GuidePanel.js';
import { downloadSVG } from './svg.js';
import { styles } from './styles.js';

/** Compose independent views around one observable reading session. */
export function AtlasPage({ controller }: { controller: AtlasController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [task, setTask] = useState('梳理当前入口的输入、关键步骤、失败处理和结果，指出需要人工核验的地方');
  const [navigatorOpen, setNavigatorOpen] = useState(true);
  const [focus, setFocus] = useState(false);
  const [navWidth, setNavWidth] = useState(260);
  const [sourceWidth, setSourceWidth] = useState(480);
  const [fontSize, setFontSize] = useState(15);
  const split = useRef<(() => void) | undefined>(undefined);
  const view = state.view;
  useEffect(() => { void controller.loadSessions(); return () => split.current?.(); }, [controller]);
  const resize = (event: ReactPointerEvent, side: 'nav' | 'source') => {
    event.preventDefault(); split.current?.();
    const start = event.clientX, width = side === 'nav' ? navWidth : sourceWidth;
    const move = (next: PointerEvent) => side === 'nav' ? setNavWidth(Math.max(210, Math.min(480, width + next.clientX - start)))
      : setSourceWidth(Math.max(340, Math.min(900, width - next.clientX + start)));
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); split.current = undefined; };
    split.current = stop; window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop);
  };
  const selected = view?.snapshot.nodes.find(node => node.id === view.selectedId);
  const parents = [];
  let parent = selected;
  const seen = new Set<string>();
  while (parent && !seen.has(parent.id)) {
    seen.add(parent.id); parents.unshift(parent);
    const parentId = parent.parentId;
    parent = view?.snapshot.nodes.find(node => node.id === parentId);
  }
  return <main className={`ca-root ${focus ? 'ca-focus' : ''}`} style={{ '--ca-code-size': `${fontSize}px` } as CSSProperties} data-code-atlas="page"
    onKeyDown={event => {
      if (event.key === 'Escape' && focus) setFocus(false);
      if (event.altKey && !['INPUT', 'TEXTAREA', 'SELECT'].includes((event.target as HTMLElement).tagName)) {
        if (event.key === 'ArrowLeft') { event.preventDefault(); void controller.navigate(-1); }
        if (event.key === 'ArrowRight') { event.preventDefault(); void controller.navigate(1); }
      }
    }}>
    <style>{styles}</style>
    <header className="ca-header">
      <div className="ca-brand"><span className="ca-brand-icon">⌘</span><div><strong>Code Atlas</strong><small>任务导览 · 代码阅读与核验</small></div></div>
      <div className="ca-actions">
        <select aria-label="DSH 会话工作区" value={state.sessionId} onChange={event => controller.selectSession(event.target.value)}>
          {!state.sessions.length && <option value="">请选择有项目目录的会话</option>}
          {state.sessions.map(session => <option key={session.id} value={session.id}>{session.title} — {session.cwd}</option>)}
        </select>
        <button onClick={() => void controller.loadSessions()} disabled={state.busy}>刷新会话</button>
        <button className="ca-primary" onClick={() => void controller.scan()} disabled={state.busy || !state.sessionId}>{state.busy ? '处理中…' : '扫描 / 刷新'}</button>
      </div>
    </header>
    <section className="ca-taskbar">
      <label htmlFor="ca-task">这次想弄懂什么？</label>
      <div className="ca-task-input"><input id="ca-task" value={task} maxLength={2000} onChange={event => setTask(event.target.value)} placeholder="例如：创建 box 后，属性如何修改、失败时如何回滚？" />
        {state.guideBusy ? <button onClick={() => void controller.cancelGuide()}>取消梳理</button>
          : <button className="ca-primary" disabled={!view || !task.trim() || !state.modelStatus?.available} onClick={() => void controller.generateGuide(task)}>生成 AI 导览</button>}
      </div>
      <small>{state.guideBusy ? '正在梳理相关代码，可继续浏览；完成后会显示导览。' : state.modelStatus?.available
        ? `模型：${state.modelStatus.model} · 点击才发送当前任务相关代码摘录，可能产生模型费用。` : '可先浏览项目和调用参考；AI 导览使用 DSH 配置的模型，也支持由会话工具发布。'}</small>
    </section>
    <nav className="ca-toolbar" aria-label="代码阅读导航">
      <button aria-label="后退" title="后退 Alt+←" disabled={!state.canBack || state.busy} onClick={() => void controller.navigate(-1)}>← 后退</button>
      <button aria-label="前进" title="前进 Alt+→" disabled={!state.canForward || state.busy} onClick={() => void controller.navigate(1)}>前进 →</button>
      <span className="ca-divider" />
      {(['overview', 'guide', 'map'] as const).map((pane, index) => <button key={pane} aria-pressed={state.pane === pane} onClick={() => controller.setPane(pane)}>{['项目总览', '任务导览', '关系浏览'][index]}</button>)}
      <span className="ca-spacer" />
      <button aria-pressed={navigatorOpen} onClick={() => setNavigatorOpen(!navigatorOpen)}>文件导航</button>
      <button aria-pressed={state.sourceOpen} disabled={!state.source} onClick={() => controller.setSourceOpen(!state.sourceOpen)}>源码</button>
      <button aria-pressed={focus} onClick={() => setFocus(!focus)}>{focus ? '退出专注' : '专注画布'}</button>
    </nav>
    {state.error && <div className="ca-alert" role="alert">{state.error}</div>}
    {state.notice && <div className="ca-status" role="status">{state.notice}</div>}
    {!view ? <section className="ca-welcome"><span className="ca-eyebrow">READ WITH A PURPOSE</span><h1>从一条任务路径，读懂一段代码</h1>
      <p>先选择项目会话并扫描。按模块找入口，再用调用参考或 AI 导览追踪关键处理；遇到疑问时再展开完整源码。</p>
      <div className="ca-empty-cards"><article><b>01 · 找入口</b><p>项目总览按目录归类，文件与符号按需展开。</p></article><article><b>02 · 看路径</b><p>区分静态调用、结构引用和模型解释。</p></article><article><b>03 · 逐步核验</b><p>后退保留阅读路径，代码证据按需查看。</p></article></div>
      {!state.sessions.length && <p className="ca-muted">当前没有已建立且有工作目录的会话。请先在 DSH 打开项目会话，再刷新列表；仅新建草稿可能尚未建立会话。</p>}
    </section> : <>
      <div className="ca-breadcrumb" aria-label="当前位置"><button onClick={() => controller.setPane('overview')}>项目</button>{parents.map(node => <span key={node.id}> / <button disabled={state.busy} onClick={() => void controller.selectNode(node.id)}>{node.name}</button></span>)}
        <span className="ca-spacer" /><small>{view.snapshot.nodes.filter(node => node.kind === 'file').length} 文件 · {view.snapshot.diagnostics.length} 条诊断</small>
      </div>
      <div className="ca-workspace">
        {navigatorOpen && !focus && <><aside className="ca-navigator" style={{ width: navWidth }}><ProjectNavigator controller={controller} /></aside>
          <div className="ca-split" role="separator" aria-label="调整文件导航宽度" tabIndex={0} aria-orientation="vertical" onPointerDown={event => resize(event, 'nav')} onKeyDown={event => { if (event.key === 'ArrowRight') setNavWidth(Math.min(480, navWidth + 20)); if (event.key === 'ArrowLeft') setNavWidth(Math.max(210, navWidth - 20)); }} /></>}
        <section className="ca-center">{state.pane === 'overview' ? <ProjectOverview controller={controller} /> : state.pane === 'guide' ? <GuidePanel controller={controller} /> : <MapPanel controller={controller} />}</section>
        {state.sourceOpen && !focus && <><div className="ca-split ca-source-split" role="separator" aria-label="调整源码宽度" tabIndex={0} aria-orientation="vertical" onPointerDown={event => resize(event, 'source')} onKeyDown={event => { if (event.key === 'ArrowLeft') setSourceWidth(Math.min(900, sourceWidth + 20)); if (event.key === 'ArrowRight') setSourceWidth(Math.max(340, sourceWidth - 20)); }} />
          <aside className="ca-source" style={{ width: sourceWidth }}><SourcePanel controller={controller} fontSize={fontSize} onFontSize={setFontSize} /></aside></>}
      </div>
      <footer className="ca-footer"><span>最近阅读：{state.trail.slice(-4).map(item => item.name.split('/').at(-1)).join(' → ') || '尚未选择'}</span><span className="ca-spacer" />
        <button disabled={state.busy} onClick={() => void controller.exportSVG(downloadSVG)}>导出当前关系图</button>
      </footer>
    </>}
  </main>;
}
