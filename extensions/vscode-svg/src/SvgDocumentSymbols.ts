import * as vscode from 'vscode';
import { SvgOutlineParser } from './outline/SvgOutlineParser';
import type { OutlineNode } from './outline/OutlineNode';

/** Adapts editor-independent source ranges to the native Outline protocol. */
export class SvgDocumentSymbols implements vscode.DocumentSymbolProvider {
  constructor(private readonly parser = new SvgOutlineParser()) {}

  provideDocumentSymbols(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.DocumentSymbol[] {
    if (token.isCancellationRequested || !/\.svg$/i.test(document.uri.path)) return [];
    const roots = this.parser.parse(document.getText());
    if (token.isCancellationRequested) return [];
    return roots.map(node => this.symbol(node, document));
  }

  private symbol(node: OutlineNode, document: vscode.TextDocument): vscode.DocumentSymbol {
    const range = new vscode.Range(document.positionAt(node.start), document.positionAt(node.end));
    const selection = new vscode.Range(document.positionAt(node.selectionStart), document.positionAt(node.selectionEnd));
    const result = new vscode.DocumentSymbol(node.name, '', vscode.SymbolKind.Object, range, selection);
    result.children = node.children.map(child => this.symbol(child, document));
    return result;
  }
}
