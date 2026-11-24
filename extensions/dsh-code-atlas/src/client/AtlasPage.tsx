import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { CSSProperties, KeyboardEvent, MouseEvent } from 'react';
import type { AtlasView, CodeNode } from '../core/types.js';
import { AtlasController } from './AtlasController.js';
import { downloadSVG, sanitizeGeneratedSVG } from './svg.js';

const rootStyle: CSSProperties = { height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', color: 'var(--dsw-alias-label-primary, #e6e8ec)', background: 'var(--dsw-alias-bg-base, #17191e)', fontSize: 13 };
const buttonStyle: CSSProperties = { color: 'inherit', background: 'var(--dsw-alias-interactive-bg-hover, #30343d)', border: '1px solid #65708060', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', fontSize: 12 };
const smallStyle: CSSProperties = { color: 'var(--dsw-alias-label-secondary, #a8b0bf)', fontSize: 11 };
const kinds: Readonly<Record<string, string>> = { file: '文件', class: '类', interface: '接口', function: '函数', method: '方法', namespace: '命名空间' };

/** A native main panel; the map and source are independent subscribers to the same instance. */
export function AtlasPage({ controller }: { controller: AtlasController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const view = state.view;
  useEffect(() => { if (!state.sessions.length) void controller.loadSessions(); }, [controller]);
  const selected = view?.snapshot.nodes.find(node => node.id === view.selectedId);
  return <main style={rootStyle} data-code-atlas="page">
    <style>{`[data-code-atlas="page"] button:disabled{opacity:.5;cursor:default!important}[data-code-atlas="page"] svg [data-node-id]{cursor:pointer}[data-code-atlas="page"] svg [data-node-id]:hover rect{stroke:#1967a8;stroke-width:3}[data-code-atlas="page"] svg [data-node-id]:focus{outline:2px solid #1967a8}`}</style>
    <header style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, padding: '12px 16px', borderBottom: '1px solid #65708040' }}>
      <strong style={{ fontSize: 17 }}>代码地图 <span style={{ color: '#79b7ff', fontSize: 12 }}>Code Atlas</span></strong>
      <span style={{ flex: 1 }} />
      <select aria-label="DSH 会话工作区" value={state.sessionId} onChange={event => controller.selectSession(event.target.value)} style={{ ...buttonStyle, maxWidth: 350 }}>
        {!state.sessions.length && <option value="">没有有工作目录的会话</option>}
        {state.sessions.map(session => <option key={session.id} value={session.id}>{session.title || session.id} — {session.cwd}</option>)}
      </select>
      <button style={buttonStyle} onClick={() => void controller.loadSessions()} disabled={state.busy}>刷新会话</button>
      <button style={{ ...buttonStyle, background: '#235690' }} onClick={() => void controller.scan()} disabled={state.busy || !state.sessionId}>{state.busy ? '处理中…' : '扫描 / 刷新'}</button>
      <button style={buttonStyle} onClick={() => void controller.exportSVG(downloadSVG)} disabled={state.busy || !view}>导出 SVG</button>
    </header>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px', flexWrap: 'wrap', borderBottom: '1px solid #65708040' }}>
      <label>阅读视角 <select aria-label="阅读视角" value={view?.direction ?? 'dependencies'} disabled={!view || state.busy} onChange={event => void controller.changeRoute(event.target.value as 'dependencies' | 'users', view?.depth ?? 1)} style={buttonStyle}><option value="dependencies">查看依赖 →</option><option value="users">← 查看使用者</option></select></label>
      <label>范围 <select aria-label="关系深度" value={view?.depth ?? 1} disabled={!view || state.busy} onChange={event => void controller.changeRoute(view?.direction ?? 'dependencies', Number(event.target.value) as 1 | 2)} style={buttonStyle}><option value={1}>一跳</option><option value={2}>两跳</option></select></label>
      <label style={{ display: 'flex', gap: 5, alignItems: 'center' }}><input type="checkbox" checked={state.publicApiLabel} disabled={!view || state.busy} onChange={event => void controller.togglePublicApi(event.target.checked)} />公开 API 标签</label>
      <button style={buttonStyle} onClick={() => void controller.markSelected(!view?.readIds.includes(view.selectedId))} disabled={state.busy || !selected}>{view?.readIds.includes(view.selectedId) ? '取消已读' : '标记已读'}</button>
      {view && <span style={smallStyle}>{view.snapshot.nodes.length} 个节点 · {view.snapshot.relations.length} 条关系 · {view.snapshot.diagnostics.length} 条诊断</span>}
      {state.notice && <span role="status" style={smallStyle}>{state.notice}</span>}
    </div>
    {state.error && <div role="alert" style={{ padding: '10px 16px', background: '#8c452d30', color: '#ffc19e', borderBottom: '1px solid #a65a3a' }}>{state.error}</div>}
    {!view ? <section style={{ padding: 36, maxWidth: 760 }}>
      <h2 style={{ marginTop: 4 }}>从真实源码开始阅读</h2>
      <p>选择一个 DSH 会话的工作区，然后点击“扫描 / 刷新”。地图中的每个节点都能定位回源码；关系带有文件和行号证据。</p>
      <p style={smallStyle}>支持 TypeScript / JavaScript、模块依赖及可解析的继承和实现关系。文件仅被读取，不执行项目脚本。若列表为空，请先在 DSH 工作区中创建一个会话，再刷新会话列表。</p>
    </section> : <div style={{ display: 'grid', gridTemplateColumns: 'minmax(190px, 23%) minmax(260px, 1fr) minmax(280px, 38%)', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      <aside style={{ minWidth: 0, overflow: 'auto', borderRight: '1px solid #65708040' }}>
        <div style={{ position: 'sticky', top: 0, padding: 10, background: 'var(--dsw-alias-bg-base, #17191e)', zIndex: 1 }}><input aria-label="搜索文件、类、接口、函数" placeholder="搜索文件、类、接口、函数…" value={state.query} onChange={event => controller.setQuery(event.target.value)} style={{ ...buttonStyle, width: '100%', boxSizing: 'border-box', background: 'transparent' }} /></div>
        <SymbolTree view={view} query={state.query} busy={state.busy} onSelect={id => void controller.selectNode(id)} />
      </aside>
      <MapPanel controller={controller} />
      <SourcePanel controller={controller} />
    </div>}
  </main>;
}

function SymbolTree({ view, query, busy, onSelect }: { view: AtlasView; query: string; busy: boolean; onSelect: (id: string) => void }) {
  const needle = query.trim().toLocaleLowerCase();
  const nodes = view.snapshot.nodes;
  const visible = nodes.filter(node => !needle || node.name.toLocaleLowerCase().includes(needle) || node.file.toLocaleLowerCase().includes(needle));
  const files = [...new Set(visible.map(node => node.file))].sort();
  const depth = (node: CodeNode) => { let value = 0; let parent = node.parentId; const seen = new Set<string>(); while (parent && !seen.has(parent)) { seen.add(parent); const found = nodes.find(item => item.id === parent); if (!found || found.kind === 'file') break; value++; parent = found.parentId; } return value; };
  if (!visible.length) return <p style={{ ...smallStyle, padding: 12 }}>没有匹配的文件或符号。</p>;
  return <div role="tree" aria-label="源码符号树">{files.map(file => <section key={file}>
    <div style={{ padding: '7px 10px', background: '#65708018', overflowWrap: 'anywhere', fontWeight: 600, fontSize: 11 }}>{file}</div>
    {visible.filter(node => node.file === file).map(node => <button role="treeitem" aria-selected={view.selectedId === node.id} key={node.id} disabled={busy} onClick={() => onSelect(node.id)} title={`${node.file}:${node.location.startLine}`} style={{ width: '100%', textAlign: 'left', border: 0, color: 'inherit', background: node.id === view.selectedId ? '#3879bd55' : 'transparent', padding: `7px 8px 7px ${12 + depth(node) * 12}px`, cursor: 'pointer', display: 'block', overflowWrap: 'anywhere' }}><span style={{ ...smallStyle, marginRight: 5 }}>{kinds[node.kind]}</span>{view.labels[node.id] ?? node.name}</button>)}
  </section>)}</div>;
}

function MapPanel({ controller }: { controller: AtlasController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const view = state.view;
  const safeSVG = useMemo(() => view ? sanitizeGeneratedSVG(view.svg) : '', [view?.svg]);
  const [minimum, maximum] = [0.4, 4];
  const scaleRef = useRef(1);
  const mapRef = useRef<HTMLDivElement>(null);
  // A session switch can notify this independent subscriber before its parent removes it.
  if (!view) return null;
  const changeScale = (delta: number) => { scaleRef.current = Math.max(minimum, Math.min(maximum, scaleRef.current + delta)); if (mapRef.current) mapRef.current.style.transform = `scale(${scaleRef.current})`; };
  const select = (event: MouseEvent<HTMLDivElement> | KeyboardEvent<HTMLDivElement>) => {
    if ('key' in event && event.key !== 'Enter' && event.key !== ' ') return;
    const target = event.target instanceof Element ? event.target.closest('[data-node-id]') : null;
    const id = target?.getAttribute('data-node-id');
    if (id && !state.busy && view.snapshot.nodes.some(node => node.id === id)) { event.preventDefault(); void controller.selectNode(id); }
  };
  const relations = view.snapshot.relations.filter(relation => relation.from === view.selectedId || relation.to === view.selectedId);
  const truncated = Boolean((view.graph as typeof view.graph & { truncated?: boolean }).truncated);
  return <section style={{ display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, borderRight: '1px solid #65708040' }}>
    <div style={{ padding: 10, display: 'flex', gap: 6, alignItems: 'center' }}><strong style={{ flex: 1 }}>SVG 关系地图</strong><button style={buttonStyle} aria-label="缩小地图" onClick={() => changeScale(-0.15)}>−</button><button style={buttonStyle} aria-label="放大地图" onClick={() => changeScale(0.15)}>＋</button><button style={buttonStyle} onClick={() => { scaleRef.current = 1; if (mapRef.current) { mapRef.current.style.transform = 'scale(1)'; mapRef.current.parentElement?.scrollTo(0, 0); } }}>适应</button></div>
    {truncated && <p style={{ ...smallStyle, margin: '0 10px 6px' }}>关系较多，当前仅显示前 120 个节点；可选择更具体的符号缩小范围。</p>}
    <div style={{ overflow: 'auto', flex: 1, minHeight: 180, padding: 8, background: '#e7edf5' }}>
      {safeSVG ? <div ref={mapRef} onClick={select} onKeyDown={select} style={{ minWidth: 450, minHeight: 300, transformOrigin: 'top left', cursor: state.busy ? 'wait' : 'default' }} dangerouslySetInnerHTML={{ __html: safeSVG }} /> : <p style={{ color: '#334155' }}>没有可显示的地图。</p>}
    </div>
    <div style={{ maxHeight: '34%', overflow: 'auto', padding: 10, borderTop: '1px solid #65708040' }}><strong>关系与源码证据</strong>{!relations.length && <p style={smallStyle}>当前节点没有此类关系；可切换到文件节点或另一阅读视角。</p>}{relations.map(relation => <div key={relation.id} style={{ marginTop: 7, padding: 7, border: '1px solid #65708040', borderRadius: 5 }}><span style={{ color: relation.resolved ? '#98caff' : '#e8b778' }}>{relation.kind}</span> <span>{relation.targetName}</span>{!relation.resolved && <small> · 未解析</small>}<button style={{ ...buttonStyle, display: 'block', marginTop: 5, maxWidth: '100%', overflowWrap: 'anywhere' }} disabled={state.busy} onClick={() => void controller.selectEvidence(relation)}>证据 {relation.location.file}:{relation.location.startLine}</button></div>)}</div>
  </section>;
}

function SourcePanel({ controller }: { controller: AtlasController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const source = state.source;
  const location = state.highlight ?? (source?.node.kind === 'file' ? { ...source.node.location, endLine: source.node.location.startLine } : source?.node.location);
  const selectedLine = useRef<HTMLDivElement>(null);
  useEffect(() => { selectedLine.current?.scrollIntoView({ block: 'center' }); }, [source, location?.startLine]);
  return <section style={{ display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}><div style={{ padding: 10, borderBottom: '1px solid #65708040' }}><strong>源码</strong>{source && <div style={{ ...smallStyle, marginTop: 4, overflowWrap: 'anywhere' }}>{source.node.file}:{location?.startLine} · {source.node.name}</div>}</div>
    {!source ? <p style={{ ...smallStyle, padding: 12 }}>{state.busy ? '正在核验源码版本…' : '点击地图或结构树中的节点查看源码。'}</p> : <div style={{ overflow: 'auto', flex: 1, minHeight: 0, padding: '8px 0', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 12, lineHeight: '21px' }}>{source.content.split(/\r?\n/).map((line, index) => {
      const number = index + 1;
      const highlight = Boolean(location && number >= location.startLine && number <= location.endLine);
      return <div key={index} ref={number === location?.startLine ? selectedLine : undefined} data-source-line={number} style={{ display: 'flex', background: highlight ? '#af8d2238' : 'transparent', minWidth: 'max-content' }}><span aria-hidden="true" style={{ color: '#8e98aa', textAlign: 'right', padding: '0 10px', minWidth: 34, userSelect: 'none', borderRight: '1px solid #65708030' }}>{number}</span><code style={{ whiteSpace: 'pre', padding: '0 10px', fontFamily: 'inherit' }}>{line || ' '}</code></div>;
    })}</div>}
  </section>;
}
