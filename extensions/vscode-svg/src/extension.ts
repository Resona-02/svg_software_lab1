import * as vscode from 'vscode';
import { SvgFileDecorations } from './SvgFileDecorations';
import { SvgDocumentSymbols } from './SvgDocumentSymbols';

/** Composition root: register capabilities, let VSCode own rendering and queries. */
export function activate(context: vscode.ExtensionContext): void {
  const decorations = new SvgFileDecorations();
  context.subscriptions.push(
    decorations,
    vscode.window.registerFileDecorationProvider(decorations),
    vscode.languages.registerDocumentSymbolProvider(
      [{ pattern: '**/*.[sS][vV][gG]' }], new SvgDocumentSymbols(),
      { label: 'SVG Software Lab' },
    ),
  );
}
