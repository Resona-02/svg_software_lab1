import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AtlasController } from './AtlasController.js';

/** Paged full source, rather than a tiny excerpt or thousands of DOM rows. */
export function SourcePanel({ controller, fontSize, onFontSize }: { controller: AtlasController; fontSize: number; onFontSize: (value: number) => void }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const source = state.source;
  const location = state.highlight ?? source?.node.location;
  const lines = useMemo(() => source?.content.split(/\r\n|[\r\n\u2028\u2029]/) ?? [], [source?.content]);
  const [start, setStart] = useState(0);
  const [wrap, setWrap] = useState(true);
  const selected = useRef<HTMLDivElement>(null);
  useEffect(() => { setStart(Math.max(0, (location?.startLine ?? 1) - 12)); }, [source?.node.id, source?.snapshotId, location?.startLine]);
  useEffect(() => { selected.current?.scrollIntoView({ block: 'center' }); }, [start, location?.startLine]);
  return <section className="ca-source-panel"><header><div><strong>源码与上下文</strong><small>{source?.node.file ?? '未选择代码'}</small></div><button aria-label="关闭源码面板" onClick={() => controller.setSourceOpen(false)}>✕</button></header>
    <div className="ca-source-controls"><button aria-label="缩小源码字号" onClick={() => onFontSize(Math.max(12, fontSize - 1))}>A−</button><span>{fontSize}px</span><button aria-label="放大源码字号" onClick={() => onFontSize(Math.min(22, fontSize + 1))}>A＋</button><button aria-pressed={wrap} onClick={() => setWrap(!wrap)}>折行</button><span className="ca-spacer" /><button onClick={() => setStart(Math.max(0, (location?.startLine ?? 1) - 12))}>回到定位</button></div>
    {!source ? <p className="ca-muted ca-padding">点击节点或调用位置，核验版本后查看完整上下文。</p> : <>
      <div className={`ca-code-lines ${wrap ? 'ca-wrap-code' : ''}`}>{lines.slice(start, start + 180).map((line, index) => {
        const number = start + index + 1;
        const highlighted = location && number >= location.startLine && number <= (source.node.kind === 'file' && !state.highlight ? location.startLine : location.endLine);
        return <div key={number} data-source-line={number} ref={number === location?.startLine ? selected : undefined} className={highlighted ? 'ca-code-highlight' : ''}><span>{number}</span><code>{line || ' '}</code></div>;
      })}</div><footer><button disabled={!start} onClick={() => setStart(Math.max(0, start - 160))}>↑ 上一段</button><small>{start + 1}–{Math.min(lines.length, start + 180)} / {lines.length} 行</small><button disabled={start + 180 >= lines.length} onClick={() => setStart(start + 160)}>下一段 ↓</button></footer>
    </>}
  </section>;
}
