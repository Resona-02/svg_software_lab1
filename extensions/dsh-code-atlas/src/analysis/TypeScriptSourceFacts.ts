import { resolve } from 'node:path';
import { SymbolFlags, type Project, type Symbol as CompilerSymbol } from 'typescript/unstable/sync';
import * as ts from 'typescript/unstable/ast';
import type { AtlasDiagnostic, CodeNode, CodeRelation, NodeKind, SourceFile, SourceLocation } from '../core/types.js';

/** Translates compiler objects into plain facts before their snapshot is released. */
export class TypeScriptSourceFacts {
  private readonly nodes: CodeNode[] = [];
  private readonly relations: CodeRelation[] = [];
  private readonly diagnostics: AtlasDiagnostic[] = [];
  private readonly byFile = new Map<string, SourceFile>();
  private readonly declarations = new Map<ts.Node, string>();
  private readonly declarationKeys = new Map<string, string>();
  private readonly valid = new Map<string, ts.SourceFile>();

  constructor(private readonly project: Project, private readonly root: string, private readonly files: readonly SourceFile[]) {
    for (const file of files) this.byFile.set(resolve(root, file.path), file);
  }

  collect(): { nodes: readonly CodeNode[]; relations: readonly CodeRelation[]; diagnostics: readonly AtlasDiagnostic[] } {
    for (const file of this.files) {
      const source = this.project.program.getSourceFile(resolve(this.root, file.path));
      const fileId = `file:${file.path}`;
      this.nodes.push({ id: fileId, name: file.path, file: file.path, kind: 'file', exported: false,
        location: this.location(file, 0, file.content.length, source) });
      if (!source) {
        this.diagnostics.push({ file: file.path, message: 'Source file was not available to the compiler.' });
        continue;
      }
      const syntax = this.project.program.getSyntacticDiagnostics(source.fileName);
      if (syntax.length) {
        for (const diagnostic of syntax) this.diagnostics.push({ file: file.path, message: diagnostic.text,
          line: source.getLineAndCharacterOfPosition(Math.max(0, diagnostic.pos)).line + 1 });
        continue;
      }
      this.valid.set(file.path, source);
      this.collectNodes(source, source, file, fileId);
    }
    const exported = this.exportedDeclarations();
    for (let index = 0; index < this.nodes.length; index++) {
      const node = this.nodes[index]!;
      if (exported.has(node.id) && !node.exported) this.nodes[index] = { ...node, exported: true };
    }
    for (const file of this.files) {
      const source = this.valid.get(file.path);
      if (source) this.collectRelations(source, source, file);
    }
    return { nodes: this.nodes, relations: this.relations, diagnostics: this.diagnostics };
  }

  private collectNodes(node: ts.Node, source: ts.SourceFile, file: SourceFile, parentId: string): void {
    const declaration = this.describe(node);
    let childParent = parentId;
    if (declaration) {
      const start = node.getStart(source);
      const id = `symbol:${file.path}:${declaration.kind}:${start}`;
      this.nodes.push({ id, name: declaration.name, kind: declaration.kind, file: file.path, parentId,
        exported: this.explicitlyExported(node), location: this.location(file, start, node.getEnd(), source) });
      this.declarations.set(node, id);
      this.declarationKeys.set(this.key(node), id);
      // A class value declared as `const Base = class ...` is referenced through
      // the variable symbol; keep that compiler declaration tied to the same node.
      if (ts.isClassExpression(node) && ts.isVariableDeclaration(node.parent) && node.parent.initializer === node) {
        this.declarations.set(node.parent, id);
        this.declarationKeys.set(this.key(node.parent), id);
      }
      childParent = id;
    }
    node.forEachChild(child => { this.collectNodes(child, source, file, childParent); });
  }

  private describe(node: ts.Node): { kind: NodeKind; name: string } | undefined {
    if (ts.isClassDeclaration(node)) return { kind: 'class', name: node.name?.text ?? 'default class' };
    if (ts.isClassExpression(node)) return { kind: 'class', name: ts.isVariableDeclaration(node.parent)
      ? node.parent.name.getText() : node.name?.text ?? 'anonymous class' };
    if (ts.isInterfaceDeclaration(node)) return { kind: 'interface', name: node.name.text };
    if (ts.isFunctionDeclaration(node)) return { kind: 'function', name: node.name?.text ?? 'default function' };
    if (ts.isModuleDeclaration(node)) return { kind: 'namespace', name: node.name.text };
    if (ts.isConstructorDeclaration(node)) return { kind: 'method', name: 'constructor' };
    if (ts.isMethodDeclaration(node) || ts.isMethodSignatureDeclaration(node)) return { kind: 'method', name: node.name.getText() };
    if (ts.isGetAccessorDeclaration(node)) return { kind: 'method', name: `get ${node.name.getText()}` };
    if (ts.isSetAccessorDeclaration(node)) return { kind: 'method', name: `set ${node.name.getText()}` };
    if (ts.isVariableDeclaration(node) && node.initializer
      && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
      return { kind: 'function', name: node.name.getText() };
    }
    if (ts.isPropertyDeclaration(node) && node.initializer
      && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
      return { kind: 'method', name: node.name.getText() };
    }
    return undefined;
  }

  private explicitlyExported(node: ts.Node): boolean {
    let declaration = node;
    if (ts.isVariableDeclaration(node) && node.parent) declaration = node.parent.parent;
    const modifiers = (declaration as ts.Node & { readonly modifiers?: readonly ts.Node[] }).modifiers;
    return modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
  }

  private exportedDeclarations(): ReadonlySet<string> {
    const ids = new Set<string>();
    for (const source of this.valid.values()) {
      const module = this.project.checker.getSymbolAtLocation(source);
      if (!module) continue;
      for (const exported of this.project.checker.getExportsOfModule(module)) {
        const symbol = this.unalias(exported);
        for (const handle of symbol?.declarations ?? []) {
          const declaration = handle.resolve();
          const id = declaration && this.declarationId(declaration);
          if (id) ids.add(id);
        }
      }
    }
    return ids;
  }

  private collectRelations(node: ts.Node, source: ts.SourceFile, file: SourceFile): void {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      const target = node.moduleSpecifier;
      if (ts.isStringLiteralLikeNode(target)) this.moduleRelation(ts.isImportDeclaration(node) ? 'imports' : 'reexports', target, source, file);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && node.moduleReference.expression) {
      this.moduleRelation('imports', node.moduleReference.expression, source, file);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLikeNode(node.argument.literal)) {
      // `type T = import('./types.js').T` is a static module dependency,
      // unlike a runtime import() expression whose execution is not inferred.
      this.moduleRelation('imports', node.argument.literal, source, file);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const target = node.arguments[0];
      if (target) this.addRelation('imports', `file:${file.path}`, undefined,
        ts.isStringLiteralLikeNode(target) ? target.text : target.getText(source), target, source, file);
    }
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node) || ts.isInterfaceDeclaration(node)) {
      const from = this.declarationId(node)!;
      for (const clause of node.heritageClauses ?? []) {
        const kind = clause.token === ts.SyntaxKind.ImplementsKeyword ? 'implements' : 'extends';
        for (const type of clause.types) {
          const symbol = this.unalias(this.project.checker.getSymbolAtLocation(type.expression));
          const targets = new Set<string>();
          for (const handle of symbol?.declarations ?? []) {
            const target = handle.resolve();
            const definition = target && ts.isVariableDeclaration(target) && target.initializer
              && ts.isClassExpression(target.initializer) ? target.initializer : target;
            const id = definition && this.declarationId(definition);
            if (id && definition && (ts.isClassDeclaration(definition) || ts.isClassExpression(definition) || ts.isInterfaceDeclaration(definition))) targets.add(id);
          }
          this.addRelation(kind, from, targets.size === 1 ? [...targets][0] : undefined,
            type.expression.getText(source), type, source, file);
        }
      }
    }
    node.forEachChild(child => { this.collectRelations(child, source, file); });
  }

  private moduleRelation(kind: 'imports' | 'reexports', target: ts.Node, source: ts.SourceFile, file: SourceFile): void {
    const symbol = this.unalias(this.project.checker.getSymbolAtLocation(target));
    const destinations = new Set<string>();
    for (const handle of symbol?.declarations ?? []) {
      const declaration = handle.resolve();
      const destination = declaration && this.byFile.get(resolve(declaration.getSourceFile().fileName));
      if (destination) destinations.add(`file:${destination.path}`);
    }
    this.addRelation(kind, `file:${file.path}`, destinations.size === 1 ? [...destinations][0] : undefined,
      ts.isStringLiteralLikeNode(target) ? target.text : target.getText(source), target, source, file);
  }

  private addRelation(kind: CodeRelation['kind'], from: string, to: string | undefined, targetName: string,
    node: ts.Node, source: ts.SourceFile, file: SourceFile): void {
    const start = node.getStart(source);
    this.relations.push({ id: `relation:${file.path}:${kind}:${start}`, kind, from,
      ...(to ? { to } : {}), targetName, resolved: to !== undefined,
      location: this.location(file, start, node.getEnd(), source) });
  }

  private unalias(symbol: CompilerSymbol | undefined): CompilerSymbol | undefined {
    if (!symbol || this.project.checker.isUnknownSymbol(symbol)) return undefined;
    const target = symbol.flags & SymbolFlags.Alias ? this.project.checker.getAliasedSymbol(symbol) : symbol;
    return this.project.checker.isUnknownSymbol(target) ? undefined : target;
  }

  private declarationId(node: ts.Node): string | undefined {
    return this.declarations.get(node) ?? this.declarationKeys.get(this.key(node));
  }

  private key(node: ts.Node): string { return `${resolve(node.getSourceFile().fileName)}:${node.kind}:${node.getStart()}`; }

  private location(file: SourceFile, start: number, end: number, source?: ts.SourceFile): SourceLocation {
    const begin = source?.getLineAndCharacterOfPosition(start) ?? this.position(file.content, start);
    const finish = source?.getLineAndCharacterOfPosition(end) ?? this.position(file.content, end);
    return { file: file.path, start, end, startLine: begin.line + 1, startColumn: begin.character + 1,
      endLine: finish.line + 1, endColumn: finish.character + 1, fileHash: file.hash };
  }

  private position(content: string, offset: number): { line: number; character: number } {
    const lines = content.slice(0, offset).split(/\r\n|[\r\n\u2028\u2029]/);
    return { line: lines.length - 1, character: lines.at(-1)!.length };
  }
}
