import { EditReceiver } from './EditReceiver.js';
import { CommandExecutor } from './CommandExecutor.js';
import { SvgDocument } from '../domain/SvgDocument.js';
import type { DocumentStore } from './DocumentStore.js';
import type { EditCommand } from './EditCommand.js';
import { ShapeFactory } from '../domain/ShapeFactory.js';
import type { ExtensionSet } from './Plugin.js';
import { History } from './History.js';

/** 当前文档的生命周期，以及编辑与文件操作之间的历史边界。 */
export class EditorSession {
  private current?: SvgDocument;
  private path?: string;
  private savedSnapshot?: SvgDocument;
  readonly shapes: ShapeFactory;
  private readonly commandHistory = new History();
  private readonly commandExecutor = new CommandExecutor(this.commandHistory);
  private readonly editReceiver = new EditReceiver(this);

  constructor(private readonly store: DocumentStore, readonly extensions: ExtensionSet) {
    this.shapes = new ShapeFactory(extensions.shapes);
  }

  /** 保存基准只在成功 read/save 后更新；编辑撤销仍使用局部记录。 */
  get saved(): SvgDocument | undefined { return this.savedSnapshot; }

  get document(): SvgDocument {
    if (!this.current) throw new Error("no document. use 'init' or 'read' first");
    return this.current;
  }

  get history(): Readonly<Pick<History, 'undoCount' | 'redoCount'>> {
    return this.commandHistory;
  }

  get executor(): CommandExecutor {
    return this.commandExecutor;
  }

  get edits(): EditReceiver {
    return this.editReceiver;
  }

  async init(width = 800, height = 600): Promise<string> {
    const document = new SvgDocument(width, height);
    this.commitDocument(document);
    return `canvas ${document.width}x${document.height} created`;
  }

  async read(path: string): Promise<string> {
    const result = await this.store.read(path);
    const saved = result.document.clone();
    this.commitDocument(result.document, path);
    this.savedSnapshot = saved;
    return [...result.warnings, `read ${path} (${result.document.count()} elements)`].join('\n');
  }

  async save(path?: string): Promise<string> {
    const document = this.document;
    const target = path ?? this.path;
    if (!target) throw new Error("no file path. use 'save <file.svg>' first");
    const saved = document.clone();
    await this.store.write(target, saved.clone());
    this.savedSnapshot = saved;
    this.path = target;
    this.commandHistory.barrier();
    return `saved to ${target} (${document.count()} elements)`;
  }

  canvas(width?: number, height?: number): string {
    const document = this.document;
    if (width === undefined && height === undefined) {
      return `canvas ${document.width}x${document.height}`;
    }
    if (width === undefined || height === undefined) {
      throw new Error('canvas requires width and height');
    }
    document.resize(width, height);
    this.commandHistory.barrier();
    return `canvas resized to ${document.width}x${document.height}`;
  }

  execute(command: EditCommand): string {
    this.document;
    return this.executor.executeCommand(command);
  }

  undo(): string {
    this.document;
    return this.executor.undo();
  }

  redo(): string {
    this.document;
    return this.executor.redo();
  }

  private commitDocument(document: SvgDocument, path?: string): void {
    this.current = document;
    this.savedSnapshot = undefined;
    this.path = path;
    this.commandHistory.barrier();
  }
}
