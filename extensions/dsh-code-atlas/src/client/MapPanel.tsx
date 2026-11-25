import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AtlasController } from './AtlasController.js';
import { sanitizeGeneratedSVG } from './svg.js';
import { fitCamera, zoomCamera } from './MapViewport.js';
import type { Camera } from './MapViewport.js';

export function MapPanel({ controller, onRevealSource }: { controller: AtlasController; onRevealSource?: () => void }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot), view = state.view;
  const [listMode, setListMode] = useState(false);
  const [evidenceLimit, setEvidenceLimit] = useState(40);
  useEffect(() => { setListMode((view?.graph.nodeIds.length ?? 0) > 12); }, [view?.selectedId, view?.graphKind]);
  useEffect(() => { setEvidenceLimit(40); }, [view?.selectedId, view?.graphKind, view?.snapshot.id]);
  if (!view) return null;
  const calls = view.graphKind === 'calls';
  const relations = view.snapshot.relations.filter(edge => (edge.from === view.selectedId || edge.to === view.selectedId)
    && (calls ? edge.kind === 'calls' || edge.kind === 'constructs' : edge.kind !== 'calls' && edge.kind !== 'constructs'));
  const names: Record<string, string> = { calls: '调用', constructs: '构造', imports: '导入', reexports: '再导出', extends: '继承', implements: '实现' };
  return <div className="ca-map-panel"><div className="ca-map-toolbar">
    <select aria-label="关系类型" value={view.graphKind ?? 'structure'} disabled={state.busy} onChange={event => void controller.changeGraphKind(event.target.value as 'structure' | 'calls')}><option value="calls">调用参考</option><option value="structure">导入与类型结构</option></select>
    <select aria-label="阅读视角" value={view.direction} disabled={state.busy} onChange={event => void controller.changeRoute(event.target.value as 'dependencies' | 'users', view.depth)}><option value="dependencies">从这里向下看</option><option value="users">查看上游引用</option></select>
    <select aria-label="关系深度" value={view.depth} disabled={state.busy} onChange={event => void controller.changeRoute(view.direction, Number(event.target.value) as 1 | 2)}><option value={1}>1 层关系</option><option value={2}>2 层关系</option></select>
    <span className="ca-spacer" /><button aria-pressed={listMode} onClick={() => setListMode(!listMode)}>{listMode ? '切换关系图' : '切换清晰列表'}</button>
    <button disabled={state.busy} onClick={() => void controller.markSelected(!view.readIds.includes(view.selectedId))}>{view.readIds.includes(view.selectedId) ? '✓ 已读' : '标记已读'}</button>
    <label className="ca-inline-check"><input type="checkbox" checked={state.publicApiLabel} disabled={state.busy} onChange={event => void controller.togglePublicApi(event.target.checked)} />公开 API</label>
  </div><p className="ca-map-note">{calls ? '静态调用参考：箭头指向声明目标，不表示执行先后；接口、回调和动态分派的实际实现需继续确认。' : '结构引用：导入、再导出、继承与实现关系。它们用于定位模块，不等同于运行流程。'}</p>
    {view.graph.truncated && <p className="ca-alert">关系过多，当前子图已截断。请选择更具体的符号，或切换清晰列表逐项阅读。</p>}
    {listMode ? <div className="ca-relation-list"><h2>当前范围 · {view.graph.nodeIds.length} 个节点</h2>{view.graph.nodeIds.map(id => {
      const node = view.snapshot.nodes.find(node => node.id === id);
      return node && <button key={id} className={id === view.selectedId ? 'ca-selected' : ''} disabled={state.busy} onClick={() => void controller.selectNode(id)}><b>{view.labels[id] ?? node.name}</b><small>{node.kind} · {node.file}:{node.location.startLine}</small><span>作为新中心阅读 →</span></button>;
    })}</div> : <MapCanvas controller={controller} />}
    <details className="ca-evidence"><summary>展开{calls ? '调用位置与上下文' : '结构引用位置'} · {relations.length} 条</summary><div>{!relations.length && <p>该节点没有可展示的关系。文件节点适合查看导入，函数或方法适合查看调用；未找到关系不代表代码未被使用。</p>}{relations.slice(0, evidenceLimit).map(edge => <article key={edge.id}><b>{names[edge.kind]} {edge.targetName}</b><small>{edge.resolved ? edge.dispatch === 'declared' ? '声明目标已定位 · 实际动态目标未证明' : '静态目标已定位' : '目标未解析'}</small>{edge.excerpt && <pre>{edge.excerpt}</pre>}<button disabled={state.busy} onClick={() => { onRevealSource?.(); void controller.selectEvidence(edge); }}>打开 {edge.location.file}:{edge.location.startLine} 的完整上下文 ↗</button></article>)}{relations.length > evidenceLimit && <button onClick={() => setEvidenceLimit(evidenceLimit + 40)}>再显示 40 条位置（剩余 {relations.length - evidenceLimit} 条）</button>}</div></details>
  </div>;
}

function MapCanvas({ controller }: { controller: AtlasController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot), view = state.view!;
  const safe = useMemo(() => sanitizeGeneratedSVG(view.svg), [view.svg]);
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; camera: Camera } | undefined>(undefined);
  const [camera, setCamera] = useState<Camera>({ x: 24, y: 24, scale: 1 });
  const latest = useRef(camera); latest.current = camera;
  const size = /viewBox="[\d.]+ [\d.]+ ([\d.]+) ([\d.]+)"/.exec(view.svg);
  const width = Number(size?.[1] ?? 800), height = Number(size?.[2] ?? 500);
  const fit = () => { if (viewport.current) { const { clientWidth: w, clientHeight: h } = viewport.current; setCamera(fitCamera(width, height, w, h)); } };
  useEffect(() => { const observer = new ResizeObserver(fit); if (viewport.current) observer.observe(viewport.current); fit(); return () => observer.disconnect(); }, [width, height, view.selectedId]);
  useEffect(() => {
    const element = viewport.current;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) { const box = element!.getBoundingClientRect(); setCamera(zoomCamera(latest.current, event.deltaY < 0 ? 1.1 : 1 / 1.1, event.clientX - box.left, event.clientY - box.top)); }
      else setCamera(value => ({ ...value, x: value.x - event.deltaX, y: value.y - event.deltaY }));
    };
    element?.addEventListener('wheel', wheel, { passive: false }); return () => element?.removeEventListener('wheel', wheel);
  }, []);
  return <div className="ca-map-area"><div className="ca-camera-controls"><button aria-label="缩小地图" onClick={() => setCamera(zoomCamera(camera, 1 / 1.2, 200, 100))}>−</button><span>{Math.round(camera.scale * 100)}%</span><button aria-label="放大地图" onClick={() => setCamera(zoomCamera(camera, 1.2, 200, 100))}>＋</button><button onClick={fit}>适应</button><small>拖动画布 / 滚动平移 · Ctrl+滚轮缩放</small></div>
    <div ref={viewport} className="ca-map-viewport" onPointerDown={event => {
      if ((event.target as Element).closest('[data-node-id]')) return;
      drag.current = { x: event.clientX, y: event.clientY, camera }; event.currentTarget.setPointerCapture(event.pointerId);
    }} onPointerMove={event => { const start = drag.current; if (start) setCamera({ ...start.camera, x: start.camera.x + event.clientX - start.x, y: start.camera.y + event.clientY - start.y }); }} onPointerUp={() => { drag.current = undefined; }} onPointerCancel={() => { drag.current = undefined; }}
      onClick={event => { const id = (event.target as Element).closest('[data-node-id]')?.getAttribute('data-node-id'); if (id && !state.busy) void controller.selectNode(id); }}
      onKeyDown={event => { if (event.key !== 'Enter' && event.key !== ' ') return; const id = (event.target as Element).closest('[data-node-id]')?.getAttribute('data-node-id'); if (id && !state.busy) { event.preventDefault(); void controller.selectNode(id); } }}>
      <div className="ca-map-projection" style={{ width, height, transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})` }} dangerouslySetInnerHTML={{ __html: safe }} />
    </div>
  </div>;
}
