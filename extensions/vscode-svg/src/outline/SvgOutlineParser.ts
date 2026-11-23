import { DOMParser, type Element } from '@xmldom/xmldom';
import type { OutlineNode } from './OutlineNode.js';

interface TagSpan {
  readonly name: string;
  readonly start: number;
  readonly end: number;
  readonly closing: boolean;
  readonly selfClosing: boolean;
}
interface BuildingNode {
  name: string;
  tagName: string;
  start: number;
  end: number;
  selectionStart: number;
  selectionEnd: number;
  children: BuildingNode[];
}

/** Strict XML validation plus source spans; malformed edits produce an empty outline. */
export class SvgOutlineParser {
  parse(source: string): readonly OutlineNode[] {
    try {
      // Scan before DOM construction: declarations are rejected without resolving entities.
      const spans = this.scan(source);
      const markup = source.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>/g, '');
      if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(markup)) return [];
      for (const match of markup.matchAll(/&#(x[0-9a-fA-F]+|\d+);/g)) {
        const code = match[1]!.startsWith('x') ? parseInt(match[1]!.slice(1), 16) : Number(match[1]);
        if (!(code === 9 || code === 10 || code === 13 || (code >= 0x20 && code <= 0xd7ff)
          || (code >= 0xe000 && code <= 0xfffd) || (code >= 0x10000 && code <= 0x10ffff))) return [];
      }
      const document = new DOMParser({
        onError: () => { throw new Error('incomplete or invalid XML'); },
      }).parseFromString(source, 'application/xml');
      const root = document.documentElement;
      if (!root || root.localName !== 'svg'
        || (root.namespaceURI && root.namespaceURI !== 'http://www.w3.org/2000/svg')) return [];
      const elements = this.elements(root);
      const roots: BuildingNode[] = [];
      const stack: BuildingNode[] = [];
      let index = 0;
      for (const span of spans) {
        if (span.closing) {
          const node = stack.pop();
          if (!node || node.tagName !== span.name) return [];
          node.end = span.end;
          continue;
        }
        const element = elements[index++];
        if (!element || element.tagName !== span.name) return [];
        const id = element.getAttribute('id');
        const node: BuildingNode = {
          name: id ? `${element.tagName}#${id}` : element.tagName,
          tagName: element.tagName,
          start: span.start,
          end: span.end,
          selectionStart: span.start + 1,
          selectionEnd: span.start + 1 + span.name.length,
          children: [],
        };
        (stack.at(-1)?.children ?? roots).push(node);
        if (!span.selfClosing) stack.push(node);
      }
      return stack.length === 0 && roots.length === 1 && index === elements.length ? roots : [];
    } catch {
      // The document may be between keystrokes. Do not expose parser exceptions to VSCode.
      return [];
    }
  }

  private elements(root: Element): readonly Element[] {
    const result: Element[] = [];
    const pending = [root];
    while (pending.length) {
      const element = pending.pop()!;
      result.push(element);
      const children: Element[] = [];
      for (let child = element.firstChild; child; child = child.nextSibling) {
        if (child.nodeType === 1) children.push(child as Element);
      }
      pending.push(...children.reverse());
    }
    return result;
  }

  private scan(source: string): readonly TagSpan[] {
    const result: TagSpan[] = [];
    let offset = 0;
    while ((offset = source.indexOf('<', offset)) !== -1) {
      if (source.startsWith('<!--', offset)) {
        offset = this.after(source, '-->', offset + 4);
      } else if (source.startsWith('<![CDATA[', offset)) {
        offset = this.after(source, ']]>', offset + 9);
      } else if (source.startsWith('<?', offset)) {
        offset = this.after(source, '?>', offset + 2);
      } else {
        if (source.startsWith('<!', offset)) throw new Error('XML declarations are not supported');
        const end = this.tagEnd(source, offset + 1);
        const token = source.slice(offset, end);
        const closing = token.startsWith('</');
        const match = closing ? /^<\/([^\s/>]+)\s*>$/.exec(token) : /^<([^\s/>]+)/.exec(token);
        if (!match) throw new Error('incomplete tag');
        result.push({ name: match[1]!, start: offset, end, closing,
          selfClosing: !closing && /\/>$/.test(token) });
        offset = end;
      }
    }
    return result;
  }

  private after(source: string, terminator: string, start: number): number {
    const end = source.indexOf(terminator, start);
    if (end === -1) throw new Error('incomplete XML token');
    return end + terminator.length;
  }

  private tagEnd(source: string, start: number): number {
    let quote: string | undefined;
    for (let index = start; index < source.length; index++) {
      const character = source[index];
      if (quote) {
        if (character === quote) quote = undefined;
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === '>') {
        return index + 1;
      }
    }
    throw new Error('incomplete tag');
  }
}
