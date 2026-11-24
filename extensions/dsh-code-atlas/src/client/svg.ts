/** Export only the host-generated SVG; browsers never execute project source. */
export function downloadSVG(svg: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename.replace(/[\\/]/g, '-');
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** The map DOM contains only the fixed SVG primitives emitted by the trusted renderer. */
export function sanitizeGeneratedSVG(svg: string): string {
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(svg)) return '';
  const document = new DOMParser().parseFromString(svg, 'image/svg+xml');
  if (document.querySelector('parsererror') || document.documentElement.localName !== 'svg') return '';
  const tags = new Set(['svg', 'g', 'rect', 'circle', 'ellipse', 'line', 'text']);
  const attributes = new Set(['id', 'xmlns', 'viewBox', 'width', 'height', 'x', 'y', 'cx', 'cy', 'r', 'rx', 'ry', 'x1', 'y1', 'x2', 'y2', 'fill', 'stroke', 'stroke-width', 'font-size', 'font-family', 'text-anchor', 'pointer-events', 'data-kind', 'data-node-id', 'role', 'tabindex', 'aria-label']);
  const pending: Element[] = [document.documentElement];
  while (pending.length) {
    const element = pending.pop()!;
    if (!tags.has(element.localName) || (element.namespaceURI && element.namespaceURI !== 'http://www.w3.org/2000/svg')) return '';
    for (const attribute of Array.from(element.attributes)) if (!attributes.has(attribute.name) || /url\s*\(|javascript:/i.test(attribute.value)) element.removeAttribute(attribute.name);
    if (element.hasAttribute('data-node-id')) {
      element.setAttribute('role', 'button'); element.setAttribute('tabindex', '0');
    }
    pending.push(...Array.from(element.children));
  }
  document.documentElement.setAttribute('width', '100%');
  document.documentElement.setAttribute('height', '100%');
  return new XMLSerializer().serializeToString(document.documentElement);
}
