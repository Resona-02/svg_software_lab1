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
        }}>{open ? '▾' : '▸'}</button><button title={path} disabled={!file || state.busy} className={file?.id === view.selectedId ? 'ca-selected' : ''} onClick={() => file && void controller.selectNode(file.id, { pane: state.pane ?? 'overview', revealSource: true })}>{path}</button></div>
        {open && symbols.slice(0, needle ? 100 : 80).map(node => <button className={`ca-symbol ${node.id === view.selectedId ? 'ca-selected' : ''}`} key={node.id} disabled={state.busy} title={`${node.file}:${node.location.startLine}`} onClick={() => void controller.selectNode(node.id, { pane: state.pane ?? 'overview', revealSource: true })}><small>{kindNames[node.kind]}</small><span>{view.labels[node.id] ?? node.name}</span></button>)}
        {open && symbols.length > (needle ? 100 : 80) && <small className="ca-muted">符号较多，请输入名称进一步筛选。</small>}
      </section>;
    })}
    {!visible.length && <p className="ca-muted">没有匹配项，试试文件名或更短的关键词。</p>}
    {visible.length > limit && <button className="ca-load-more" onClick={() => setLimit(limit + 50)}>再显示 50 个文件</button>}</div>
  </div>;
}
