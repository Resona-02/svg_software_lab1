import { useEffect, useState, useSyncExternalStore } from 'react';
import { AtlasController } from './AtlasController.js';
import { modeInfo } from './ReviewModes.js';
import { downloadText } from './svg.js';

/** A readable review document. Source evidence is available without dominating the page. */
export function GuidePanel({ controller, onRevealSource }: { controller: AtlasController; onRevealSource?: () => void }) {
  const { view } = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const guide = view?.guide;
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [summaryOpen, setSummaryOpen] = useState(false);
  const signature = JSON.stringify(guide);
  useEffect(() => { setChecked(new Set()); setSummaryOpen(false); }, [signature]);
  if (!guide || !view) return <div className="ca-guide-empty"><span className="ca-document-mark">✳</span><h1>从一个具体问题开始。</h1><p>可以梳理一条运行流程、讨论职责边界，或制定可验证的重构步骤。选择任务类型并在下方描述问题，报告会出现在这里。</p><button onClick={() => controller.setPane('overview')}>回到工作台 →</button></div>;
  const nodes = new Map(view.snapshot.nodes.map(node => [node.id, node]));
  const intent = guide.intent ?? 'flow', mode = modeInfo(intent);
  const stepKey = (id: string) => guide.snapshotId + ':' + guide.title + ':' + id;
  const jump = (id: string) => document.getElementById('ca-guide-step-' + id)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  const exportGuide = () => {
    const text = '# ' + guide.title + '\n\n' + mode.label + ' · 模型建议，非执行记录。快照 ' + guide.snapshotId + '\n\n' + guide.summary + '\n\n'
      + guide.steps.map((step, index) => '## ' + (index + 1) + '. ' + step.title + '\n\n' + step.explanation + '\n\n代码：'
        + step.nodeIds.map(id => { const node = nodes.get(id); return node ? node.file + ':' + node.location.startLine + ' (' + (node.qualifiedName ?? node.name) + ')' : id; }).join('；')
        + '\n\n步骤核验标记：' + (checked.has(stepKey(step.id)) ? '已标记核对' : '尚未标记') + '\n\n' + step.checks.map(check => '- [ ] ' + check).join('\n')
        + '\n\n后续：' + (step.next.map(id => guide.steps.find(item => item.id === id)?.title ?? id).join('；') || '结束') + '\n').join('\n')
      + '\n## 待确认\n\n' + guide.risks.map(risk => '- ' + risk).join('\n') + '\n';
    downloadText(text, 'code-atlas-' + intent + '.md', 'text/markdown;charset=utf-8');
  };
  return <article className="ca-guide">
    <div className="ca-guide-heading"><span className="ca-report-kind"><span aria-hidden="true">✳</span> {mode.label}</span><button onClick={exportGuide}>导出报告 ↗</button></div>
    <h1>{guide.title}</h1>
    <p className={'ca-guide-summary ' + (summaryOpen ? '' : 'ca-summary-collapsed')}>{guide.summary}</p>
    {guide.summary.length > 200 && <button className="ca-summary-toggle" aria-expanded={summaryOpen} onClick={() => setSummaryOpen(!summaryOpen)}>{summaryOpen ? '收起摘要' : '展开完整摘要'}</button>}
    <div className="ca-model-note" title={'源索引范围：' + guide.scope.totalSymbols + ' 个代码片段'}>模型建议 · 阅读了 {guide.scope.providedSymbols} 个代码片段 · 引用位置已核验，解释与结论仍需核对</div>
    <details className="ca-report-contents"><summary>{guide.steps.length} 个部分 · 快速定位</summary><nav aria-label="导览步骤索引">{guide.steps.map((step, index) => <button key={step.id} onClick={() => jump(step.id)}>{String(index + 1).padStart(2, '0')}　{step.title}</button>)}</nav></details>
    <div className="ca-guide-flow">{guide.steps.map((step, index) => <section id={'ca-guide-step-' + step.id} key={step.id} className={'ca-guide-step ' + (checked.has(stepKey(step.id)) ? 'ca-reviewed' : '')}>
      <div className="ca-step-heading"><span className="ca-step-number">{String(index + 1).padStart(2, '0')}</span><h2>{step.title}</h2></div>
      <p className="ca-step-explanation">{step.explanation}</p>
      <div className="ca-source-links">{step.nodeIds.map(id => { const node = nodes.get(id); return node && <button key={id} title={node.file + ':' + node.location.startLine} onClick={() => { onRevealSource?.(); void controller.selectNode(id, { pane: 'guide', revealSource: true }); }}><span aria-hidden="true">↗</span> <b>{node.qualifiedName ?? node.name}</b><small>{node.file.split('/').at(-1)}:{node.location.startLine}</small></button>; })}</div>
      <details className="ca-checks"><summary>核验清单 · {step.checks.length} 项</summary>{!!step.checks.length && <ul>{step.checks.map((check, i) => <li key={i}>{check}</li>)}</ul>}
        <label className="ca-reviewed-label"><input type="checkbox" checked={checked.has(stepKey(step.id))} onChange={event => setChecked(previous => { const next = new Set(previous); if (event.target.checked) next.add(stepKey(step.id)); else next.delete(stepKey(step.id)); return next; })} />标记本节已核对（当前报告）</label>
      </details>
      {!!step.next.length && <div className="ca-next-step"><span>接着看</span>{step.next.map(id => <button key={id} onClick={() => jump(id)}>{guide.steps.find(item => item.id === id)?.title ?? id} →</button>)}</div>}
    </section>)}</div>
    {!!guide.risks.length && <section className="ca-guide-risks"><h2>待确认的边界</h2><ul>{guide.risks.map((risk, i) => <li key={i}>{risk}</li>)}</ul></section>}
    <p className="ca-report-end">建议确认行为与验证结果后，再把计划交给编码助手实施。</p>
  </article>;
}
