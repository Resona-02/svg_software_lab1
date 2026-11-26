import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { ReviewIntent } from '../core/types.js';
import type { AtlasController } from './AtlasController.js';

interface WorkbenchProps {
  readonly controller: AtlasController;
  readonly intent: ReviewIntent;
  readonly onIntent: (intent: ReviewIntent) => void;
  readonly onTask: (task: string) => void;
  readonly onBrowse: () => void;
  readonly onRevealSource?: () => void;
}

/** Choose a small review task before expanding source details or relationships. */
export function NewWorkbench({ controller, intent, onIntent, onTask, onBrowse, onRevealSource }: WorkbenchProps) {
  const { view, busy } = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [limit, setLimit] = useState(30);
  useEffect(() => { setLimit(30); }, [view?.snapshot.id]);
  const selected = view?.snapshot.nodes.find(node => node.id === view.selectedId);
  const scope = selected?.qualifiedName ?? selected?.name ?? '这项任务相关的代码';
  const choices: readonly { intent: ReviewIntent; icon: string; title: string; description: string; task: string }[] = [
    { intent: 'change-review', icon: '±', title: '核验这次改动', description: '从变化的文件开始，确认行为影响与测试缺口。', task: '核验本次快照变化：说明各项修改的目的、影响范围和行为变化；对删除文件重点检查调用方与缺失实现，再列出需要补充的测试和未覆盖部分。' },
    { intent: 'flow', icon: '→', title: '读懂一条流程', description: '沿一个具体入口，解释输入、分支和结果。', task: `围绕 ${scope} 梳理输入、关键处理、分支、状态变化和结果；区分静态事实与推断，指出不确定的调用目标。` },
    { intent: 'design', icon: '◇', title: '讨论设计取舍', description: '先看职责与变化点，再判断是否需要设计模式。', task: `评估 ${scope} 的职责和变化点：是否需要 Adapter、Strategy、Decorator 或 Observer？比较不引入模式的较简方案，说明依赖、代价和建议边界。` },
    { intent: 'refactor', icon: '↗', title: '小步重构计划', description: '明确行为不变量，拆出可验证、可回退的步骤。', task: `为 ${scope} 拟定小步重构计划：指出问题和目标，明确需要保持的行为、每步修改范围、验证方法及回滚方式。` },
  ];
  const changes = view?.changes;
  const rows = useMemo(() => {
    if (!changes?.baselineAvailable) return [];
    return [
      ...[...changes.modified].sort().map(file => ({ file, kind: 'modified' as const, label: '修改' })),
      ...[...changes.added].sort().map(file => ({ file, kind: 'added' as const, label: '新增' })),
      ...[...changes.deleted].sort().map(file => ({ file, kind: 'deleted' as const, label: '删除' })),
    ];
  }, [changes]);
  const fileNodes = useMemo(() => new Map(view?.snapshot.nodes.filter(node => node.kind === 'file').map(node => [node.file, node]) ?? []), [view?.snapshot]);
  const reveal = (nodeId: string) => { onRevealSource?.(); void controller.selectNode(nodeId, { pane: 'overview', revealSource: true }); };

  return <div className="ca-workbench">
    <header className="ca-workbench-intro"><span className="ca-workbench-mark" aria-hidden="true">✳</span><h1>让下一次改动，更有把握。</h1><p>从一个具体问题开始，把理解、设计与核验变成可追踪的步骤。</p></header>

    <section className="ca-intent-list" aria-label="选择核验任务">{choices.map(choice => <button key={choice.intent} className={`ca-intent-row ${intent === choice.intent ? 'ca-intent-active' : ''}`} aria-pressed={intent === choice.intent} onClick={() => { onIntent(choice.intent); onTask(choice.task); }}><span className="ca-intent-icon" aria-hidden="true">{choice.icon}</span><span className="ca-intent-copy"><strong>{choice.title}</strong><small>{choice.description}</small></span><span className="ca-intent-arrow" aria-hidden="true">↗</span></button>)}</section>

    <section className="ca-scope-panel" aria-label="当前阅读范围"><div><span className="ca-section-label">当前范围</span>{selected ? <><strong>{selected.qualifiedName ?? selected.name}</strong><small>{selected.file}:{selected.location.startLine}</small></> : <><strong>先建立项目索引</strong><small>选择有工作目录的会话，点击“建立索引”，再定位一段代码。</small></>}</div><div className="ca-scope-actions">{selected && <button disabled={busy} onClick={() => reveal(selected.id)}>查看代码</button>}<button disabled={!view || busy} onClick={onBrowse}>选择范围</button></div></section>

    <section className="ca-change-section" aria-label="快照变更"><header className="ca-change-header"><div><span className="ca-section-label">快照变化</span><h2>{!view ? '建立索引后，留意每次变化' : !changes?.baselineAvailable ? '先留下一个比较起点' : rows.length ? `${rows.length} 个文件发生变化` : '这次没有发现源码变化'}</h2></div>{changes?.baselineAvailable && !!rows.length && <small>{changes.modified.length} 修改 · {changes.added.length} 新增 · {changes.deleted.length} 删除</small>}</header>
      {!view ? <p className="ca-empty-changes">首次扫描建立比较基线。完成代码改动后再次刷新，便可逐项核验变化。</p> : !changes?.baselineAvailable ? <p className="ca-empty-changes">目前没有可比较的前一份快照。本次扫描作为起点，修改代码后再次刷新以查看变化。</p> : !rows.length ? <p className="ca-empty-changes">与上次成功扫描相比，已收录的源码和配置没有变化。仍可围绕具体任务讨论流程、设计或重构。</p> : <><ul className="ca-change-list">{rows.slice(0, limit).map(row => {
        const current = row.kind === 'deleted' ? undefined : fileNodes.get(row.file);
        return <li className="ca-change-row" data-change-kind={row.kind} key={`${row.kind}:${row.file}`}><span className={`ca-change-status ca-change-${row.kind}`}>{row.label}</span>{current ? <button title={row.file} disabled={busy} onClick={() => reveal(current.id)}>{row.file}<span aria-hidden="true">↗</span></button> : <span className="ca-change-path" title={row.kind === 'deleted' ? '文件已删除，旧位置不可跳转' : '此文件没有可定位的代码节点'}>{row.file}</span>}{row.kind === 'deleted' && <small>旧位置不可跳转</small>}</li>;
      })}</ul>{rows.length > limit && <button className="ca-change-more" onClick={() => setLimit(value => value + 30)}>再显示 30 个文件 · 剩余 {rows.length - limit}</button>}</>}
      <p className="ca-workbench-note">比较同一会话、同一工作区内最近两次成功扫描；覆盖已收录的源码和配置，刷新前的编辑尚未计入。这里显示快照变化，未读取 Git 差异，也未执行测试。</p>
    </section>
  </div>;
}
