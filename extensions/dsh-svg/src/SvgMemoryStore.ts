import type { DocumentStore, SvgDocument } from '../../../src/api/index.js';
import type { SvgCodec } from '../../../src/api/integration.js';

/** Import uses the existing document-store boundary; no tool reads arbitrary files. */
export class SvgMemoryStore implements DocumentStore {
  private source = '';
  constructor(private readonly codec: SvgCodec) {}
  import(source: string): void { this.source = source; }
  async read(_path: string) { return this.codec.decode(this.source); }
  async write(_path: string, _document: SvgDocument): Promise<void> {
    throw new Error('Use svg_export to obtain SVG text; file persistence belongs to the host.');
  }
}
