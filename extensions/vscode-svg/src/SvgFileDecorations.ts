import * as vscode from 'vscode';

/** File identity stays with the host; this provider only supplies a visual badge. */
export class SvgFileDecorations implements vscode.FileDecorationProvider, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChangeFileDecorations = this.changed.event;
  private readonly watcher = vscode.workspace.createFileSystemWatcher('**/*.[sS][vV][gG]');
  private readonly subscriptions: vscode.Disposable[];

  constructor() {
    this.subscriptions = [
      this.watcher.onDidCreate(uri => this.changed.fire(uri)),
      this.watcher.onDidDelete(uri => this.changed.fire(uri)),
      this.watcher.onDidChange(uri => this.changed.fire(uri)),
    ];
  }

  async provideFileDecoration(uri: vscode.Uri, token: vscode.CancellationToken): Promise<vscode.FileDecoration | undefined> {
    if (!/\.svg$/i.test(uri.path) || token.isCancellationRequested) return undefined;
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (token.isCancellationRequested || !(stat.type & vscode.FileType.File)) return undefined;
      return { badge: '[]', tooltip: 'SVG file', propagate: false };
    } catch {
      // A deleted or inaccessible entry is a normal Explorer race, not an extension error.
      return undefined;
    }
  }

  dispose(): void {
    for (const subscription of this.subscriptions) subscription.dispose();
    this.watcher.dispose();
    this.changed.dispose();
  }
}
