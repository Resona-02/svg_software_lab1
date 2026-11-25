import { useMemo, useState, useSyncExternalStore } from 'react';
import type { AtlasView, CodeNode } from '../core/types.js';
import { AtlasController } from './AtlasController.js';

const kindNames: Record<string, string> = { file: '文件', class: '类', interface: '接口', function: '函数', method: '方法', namespace: '命名空间' };
function grouped(view: AtlasView) {
  const files = new Map<string, CodeNode[]>();
  for (const node of view.snapshot.nodes) { const list = files.get(node.file) ?? []; list.push(node); files.set(node.file, list); }
  return files;
}
export function ProjectNavigator({ controller }: { controller: AtlasController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot), view = state.view!;
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [limit, setLimit] = useState(50);
  const [kind, setKind] = useState('all');
  const files = useMemo(() => grouped(view), [view.snapshot]);
  const needle = state.query.trim().toLocaleLowerCase();
  const matches = (node: CodeNode) => (node.qualifiedName ?? node.name).toLocaleLowerCase().includes(needle);
  const visible = [...files].filter(([path, nodes]) => (!needle || path.toLocaleLowerCase().includes(needle) || nodes.some(matches))
    && (kind === 'all' || nodes.some(node => node.kind === kind)));
  const currentFile = view.snapshot.nodes.find(node => node.id === view.selectedId)?.file;
  return <div className="ca-file-navigation"><div className="ca-search"><input aria-label="搜索文件、类、接口、函数" placeholder="搜索符号或文件路径…" value={state.query} onChange={event => { controller.setQuery(event.target.value); setLimit(50); setCollapsed(new Set()); }} />
    <select aria-label="符号种类" value={kind} onChange={event => setKind(event.target.value)}><option value="all">全部种类</option>{['function', 'class', 'interface', 'method'].map(kind => <option key={kind} value={kind}>{kindNames[kind]}</option>)}</select>
    <small>{visible.length} 个匹配文件 · 点击箭头展开符号</small></div>
    <div className="ca-file-list">{visible.slice(0, limit).map(([path, nodes]) => {
      const open = !collapsed.has(path) && (expanded.has(path) || !!needle || path === currentFile);
      const symbols = nodes.filter(node => node.kind !== 'file' && (kind === 'all' || node.kind === kind) && (!needle || path.toLocaleLowerCase().includes(needle) || matches(node)));
      const file = nodes.find(node => node.kind === 'file');
      return <section className="ca-file-group" key={path}>
        <div className="ca-file-heading"><button aria-label={`${open ? '折叠' : '展开'} ${path}`} aria-expanded={open} onClick={() => {
          setExpanded(previous => { const next = new Set(previous); if (open) next.delete(path); else next.add(path); return next; });
          setCollapsed(previous => { const next = new Set(previous); if (open) next.add(path); else next.delete(path); return next; });
        }}>{open ? '▾' : '▸'}</button><button title={path} disabled={!file || state.busy} className={file?.id === view.selectedId ? 'ca-selected' : ''} onClick={() => file && void controller.selectNode(file.id)}>{path}</button></div>
        {open && symbols.slice(0, needle ? 100 : 80).map(node => <button className={`ca-symbol ${node.id === view.selectedId ? 'ca-selected' : ''}`} key={node.id} disabled={state.busy} title={`${node.file}:${node.location.startLine}`} onClick={() => void controller.selectNode(node.id)}><small>{kindNames[node.kind]}</small><span>{view.labels[node.id] ?? node.name}</span></button>)}
        {open && symbols.length > (needle ? 100 : 80) && <small className="ca-muted">符号较多，请输入名称进一步筛选。</small>}
      </section>;
    })}
    {!visible.length && <p className="ca-muted">没有匹配项，试试文件名或更短的关键词。</p>}
    {visible.length > limit && <button className="ca-load-more" onClick={() => setLimit(limit + 50)}>再显示 50 个文件</button>}</div>
  </div>;
}
export function ProjectOverview({ controller }: { controller: AtlasController }) {
  const { view, busy } = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [openModules, setOpenModules] = useState<ReadonlySet<string>>(new Set());
  const [moduleLimits, setModuleLimits] = useState<Readonly<Record<string, number>>>({});
  if (!view) return null;
  const files = view.snapshot.nodes.filter(node => node.kind === 'file');
  const modules = new Map<string, CodeNode[]>();
  for (const file of files) { const key = file.file.includes('/') ? file.file.split('/').slice(0, file.file.startsWith('src/') || file.file.startsWith('extensions/') ? 2 : 1).join('/') : '项目根目录'; const list = modules.get(key) ?? []; list.push(file); modules.set(key, list); }
  const score = (node: CodeNode) => (node.file.startsWith('src/') ? 20 : node.file.startsWith('plugins/') ? 10 : 0)
    + (/\/(?:host|cli|server|app)\//i.test(node.file) ? 10 : 0) + (/^(main|start|bootstrap|run)$/i.test(node.name) ? 5 : 0)
    - (/(?:^|\/)(?:tests?|__tests__)(?:\/)|\.(?:test|spec)\./.test(node.file) ? 50 : 0);
  const entries = view.snapshot.nodes.filter(node => (node.kind === 'function' || node.kind === 'method') && /^(main|run|execute|activate|start|createServer|bootstrap)$/i.test(node.name))
    .sort((a, b) => score(b) - score(a) || a.file.localeCompare(b.file)).slice(0, 8);
  const start = async (node: CodeNode) => { await controller.selectNode(node.id, { pane: 'map' }); if (node.kind !== 'file') await controller.changeGraphKind('calls'); };
  return <div className="ca-overview"><span className="ca-eyebrow">PROJECT OVERVIEW</span><h1>先找入口，再读一条路径</h1><p className="ca-muted">按模块逐步展开；用具体的函数或类缩小范围，再让 AI 解释处理流程和核验重点。</p>
    <div className="ca-stats"><article><strong>{files.length}</strong><span>源码文件</span></article><article><strong>{view.snapshot.nodes.length - files.length}</strong><span>代码符号</span></article><article><strong>{view.snapshot.relations.filter(edge => edge.kind === 'calls' || edge.kind === 'constructs').length}</strong><span>静态调用位置</span></article></div>
    <h2>可能的阅读入口</h2><div className="ca-entry-grid">{entries.map(node => <button key={node.id} disabled={busy} onClick={() => void start(node)}><b>{node.qualifiedName ?? node.name}()</b><small>{node.file}:{node.location.startLine}</small><span>从这里阅读 →</span></button>)}</div>
    <h2>模块与文件</h2><div className="ca-module-grid">{[...modules].sort(([a], [b]) => a.localeCompare(b)).map(([name, nodes]) => <details key={name} className="ca-module" open={openModules.has(name)} onToggle={event => { const open = event.currentTarget.open; setOpenModules(previous => { const next = new Set(previous); if (open) next.add(name); else next.delete(name); return next; }); }}><summary><b>{name}</b><span>{nodes.length} 文件</span></summary>{openModules.has(name) && <div>{nodes.slice(0, moduleLimits[name] ?? 50).map(node => <button key={node.id} disabled={busy} title={node.file} onClick={() => void start(node)}>{node.file}</button>)}{nodes.length > (moduleLimits[name] ?? 50) && <button onClick={() => setModuleLimits(previous => ({ ...previous, [name]: (previous[name] ?? 50) + 50 }))}>再显示 50 个文件</button>}</div>}</details>)}</div>
    {!!view.snapshot.diagnostics.length && <details className="ca-diagnostics"><summary>查看 {view.snapshot.diagnostics.length} 条分析诊断</summary>{view.snapshot.diagnostics.slice(0, 30).map((item, i) => <p key={i}>{item.file}:{item.line ?? 1} — {item.message}</p>)}</details>}
  </div>;
}
