import { useEffect, useState, useSyncExternalStore } from 'react';
import { AtlasController } from './AtlasController.js';
import { downloadText } from './svg.js';

/** A bounded, branching reading itinerary. Model claims remain visibly identified. */
export function GuidePanel({ controller, onRevealSource }: { controller: AtlasController; onRevealSource?: () => void }) {
  const { view } = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const guide = view?.guide;
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [summaryOpen, setSummaryOpen] = useState(false);
  const signature = JSON.stringify(guide);
  useEffect(() => { setChecked(new Set()); setSummaryOpen(false); }, [signature]);
  if (!guide || !view) return <div className="ca-guide-empty"><span className="ca-eyebrow">TASK WALKTHROUGH</span><h1>把“看完所有代码”变成几步核验</h1><p>先从项目总览选择入口，在顶部描述任务，再生成 AI 导览。</p><ol><li>说明入口接收什么输入。</li><li>解释关键处理与失败路径。</li><li>标出状态变化、外部调用和核验问题。</li></ol><p className="ca-muted">也可以在 DSH 会话里让模型调用 code_atlas_review_context，再用 code_atlas_publish_guide 发布导览。模型说明会关联真实代码节点。</p></div>;
  const nodes = new Map(view.snapshot.nodes.map(node => [node.id, node]));
  const exportGuide = () => {
    const text = `# ${guide.title}\n\n模型解释，非执行记录。快照 ${guide.snapshotId}\n\n${guide.summary}\n\n` + guide.steps.map((step, index) =>
      `## ${index + 1}. ${step.title}\n\n${step.explanation}\n\n代码：${step.nodeIds.map(id => { const node = nodes.get(id); return node ? `${node.file}:${node.location.startLine} (${node.name})` : id; }).join('；')}\n\n步骤核验标记：${checked.has(`${guide.snapshotId}:${guide.title}:${step.id}`) ? '已由使用者标记核对' : '尚未标记'}\n\n${step.checks.map(check => `- [ ] ${check}`).join('\n')}\n\n后续：${step.next.join(', ') || '结束'}\n`).join('\n') + `\n## 不确定与风险\n${guide.risks.map(risk => `- ${risk}`).join('\n')}\n`;
    downloadText(text, 'code-atlas-reading-guide.md', 'text/markdown;charset=utf-8');
  };
  return <div className="ca-guide"><div className="ca-guide-heading"><div><span className="ca-eyebrow">AI READING GUIDE</span><h1>{guide.title}</h1></div><button onClick={exportGuide}>导出导览</button></div>
    <p className={`ca-guide-summary ${summaryOpen ? '' : 'ca-summary-collapsed'}`}>{guide.summary}</p>{guide.summary.length > 160 && <button className="ca-summary-toggle" aria-expanded={summaryOpen} onClick={() => setSummaryOpen(!summaryOpen)}>{summaryOpen ? '收起摘要' : '展开完整摘要'}</button>}<div className="ca-model-note">模型解释 · 已提供 {guide.scope.providedSymbols} / {guide.scope.totalSymbols} 个符号 · 引用位置已核验；分支与顺序仍需人工确认，不代表实际执行记录</div>
    <nav className="ca-step-index" aria-label="导览步骤索引"><span>步骤索引 · {guide.steps.length} 步</span><div>{guide.steps.map((step, index) => <button key={step.id} title={step.title} aria-label={`跳到第 ${index + 1} 步：${step.title}`} onClick={() => document.getElementById(`ca-guide-step-${step.id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })}>{String(index + 1).padStart(2, '0')} · {step.title}</button>)}</div></nav>
    <div className="ca-guide-flow">{guide.steps.map((step, index) => {
      const key = `${guide.snapshotId}:${guide.title}:${step.id}`;
      return <article id={`ca-guide-step-${step.id}`} key={step.id} className={`ca-guide-step ${checked.has(key) ? 'ca-reviewed' : ''}`}><div className="ca-step-number">{String(index + 1).padStart(2, '0')}</div><div className="ca-step-body"><h2>{step.title}</h2><p>{step.explanation}</p>
        <div className="ca-source-links">{step.nodeIds.map(id => { const node = nodes.get(id); return node && <button key={id} onClick={() => { onRevealSource?.(); void controller.selectNode(id, { pane: 'guide', revealSource: true }); }}><b>{node.qualifiedName ?? node.name}</b><small>{node.file}:{node.location.startLine}</small><span>查看上下文 ↗</span></button>; })}</div>
        {!!step.checks.length && <details className="ca-checks"><summary>人工核验问题 · {step.checks.length}</summary><ul>{step.checks.map((check, i) => <li key={i}>{check}</li>)}</ul></details>}
        <label className="ca-reviewed-label"><input type="checkbox" checked={checked.has(key)} onChange={event => setChecked(previous => { const next = new Set(previous); if (event.target.checked) next.add(key); else next.delete(key); return next; })} />我已核对本步骤（当前视图标记）</label>
        <div className="ca-next-step">{step.next.length ? <span>↓ 后续：{step.next.map(id => <button key={id} onClick={() => document.getElementById(`ca-guide-step-${id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })}>{guide.steps.find(item => item.id === id)?.title ?? id} →</button>)}</span> : '✓ 本路径结束'}</div>
      </div></article>;
    })}</div>
    {!!guide.risks.length && <section className="ca-guide-risks"><h2>仍需确认的内容</h2><ul>{guide.risks.map((risk, i) => <li key={i}>{risk}</li>)}</ul></section>}
  </div>;
}
