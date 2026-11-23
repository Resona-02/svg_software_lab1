import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import * as vscode from 'vscode';
import { SvgFileDecorations } from '../../src/SvgFileDecorations';
import { SvgDocumentSymbols } from '../../src/SvgDocumentSymbols';

interface Check { name: string; passed: true }

/** Runs inside the real VSCode Extension Host, without a mocked vscode module. */
export async function run(): Promise<void> {
  const checks: Check[] = [];
  const check = async (name: string, action: () => void | Promise<void>) => {
    await action();
    checks.push({ name, passed: true });
    console.log(`PASS ${name}`);
  };
  const extension = vscode.extensions.getExtension('resona-lab.svg-software-lab');
  assert(extension, 'the development extension must be discovered by VSCode');
  await check('VSCode discovers and activates the development extension', async () => {
    await extension.activate();
    assert.equal(extension.isActive, true);
  });
  if (process.env.SVG_LAB_EXPECTED_EXTENSION_PATH) {
    await check('VSCode executes the requested extension directory rather than a globally installed copy', () => {
      assert.equal(resolve(extension.extensionPath), resolve(process.env.SVG_LAB_EXPECTED_EXTENSION_PATH!));
    });
  }
  if (process.env.SVG_LAB_EXPECT_PACKAGED === '1') {
    await check('the loaded VSIX contains a standalone bundle without node_modules or compiled test sources', () => {
      assert.equal(extension.packageJSON.main, './dist/extension.cjs');
      assert.equal(existsSync(resolve(extension.extensionPath, 'dist/extension.cjs')), true);
      assert.equal(existsSync(resolve(extension.extensionPath, 'node_modules')), false);
      assert.equal(existsSync(resolve(extension.extensionPath, 'dist/src')), false);
      assert.equal(existsSync(resolve(extension.extensionPath, 'dist/test')), false);
    });
  }
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  assert(root, 'isolated fixture workspace is required');
  const uri = vscode.Uri.joinPath(root, 'example.svg');
  const originalBytes = await readFile(uri.fsPath);
  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document);
  const source = document.getText();
  const cancellation = new vscode.CancellationTokenSource();
  const decorations = new SvgFileDecorations();
  const symbols = async () => {
    const result = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
      'vscode.executeDocumentSymbolProvider', uri,
    );
    return result ?? [];
  };
  const replace = async (text: string) => {
    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), text);
    assert.equal(await vscode.workspace.applyEdit(edit), true);
  };
  try {
    await check('real document symbol command returns SVG root, nested groups, leaves and elements without IDs', async () => {
      const result = await symbols();
      assert.equal(result.length, 1);
      assert.equal(result[0]!.name, 'svg');
      const flowchart = result[0]!.children[0]!;
      assert.equal(flowchart.name, 'g#flowchart');
      assert.deepEqual(flowchart.children.map(child => child.name), ['rect#start', 'g#content', 'line#arrow']);
      assert.equal(flowchart.children[1]!.children[0]!.name, 'text');
    });
    await check('native symbol selection ranges point at the opening tag in the correct source line', async () => {
      const result = await symbols();
      const rectangle = result[0]!.children[0]!.children[0]!;
      assert.equal(rectangle.selectionRange.start.line, 2);
      assert.equal(rectangle.selectionRange.start.character, 5);
      assert.equal(document.getText(rectangle.selectionRange), 'rect');
      assert.equal(document.getText(rectangle.range).startsWith('<rect id="start"'), true);
      assert.equal(result[0]!.range.contains(rectangle.range), true);
      const editor = vscode.window.activeTextEditor!;
      editor.selection = new vscode.Selection(rectangle.selectionRange.start, rectangle.selectionRange.end);
      editor.revealRange(rectangle.selectionRange);
      assert.equal(editor.selection.start.line, 2);
    });
    await check('unsaved text edits are visible on the next native Outline query', async () => {
      const version = document.version;
      await replace(source.replace('id="start"', 'id="edited"'));
      assert(document.version > version);
      assert.equal(document.isDirty, true);
      const result = await symbols();
      assert.equal(result[0]!.children[0]!.children[0]!.name, 'rect#edited');
    });
    await check('incomplete XML returns an empty outline without crashing the Extension Host', async () => {
      await replace('<svg><g id="unfinished"><rect');
      assert.deepEqual(await symbols(), []);
      assert.equal(extension.isActive, true);
    });
    await check('restoring valid content restores the native outline after malformed input', async () => {
      await replace(source);
      assert.equal((await symbols())[0]!.children[0]!.children[0]!.name, 'rect#start');
      assert.equal(extension.isActive, true);
    });
    await check('SVG files receive [] while names and bytes stay unchanged', async () => {
      const decoration = await decorations.provideFileDecoration(uri, cancellation.token);
      assert.deepEqual(decoration, { badge: '[]', tooltip: 'SVG file', propagate: false });
      assert.equal(uri.path.endsWith('/example.svg'), true);
      assert.deepEqual(await readFile(uri.fsPath), originalBytes);
      assert.equal(document.getText(), source);
    });
    await check('ordinary files, ordinary directories, .svg directories and missing paths have no badge', async () => {
      for (const path of ['notes.txt', 'icons', 'folder.svg', 'missing.svg']) {
        assert.equal(await decorations.provideFileDecoration(vscode.Uri.joinPath(root, path), cancellation.token), undefined, path);
      }
    });
    await check('case-insensitive SVG filename matching uses the real workspace filesystem', async () => {
      const capital = vscode.Uri.joinPath(root, 'UPPER.SVG');
      await vscode.workspace.fs.writeFile(capital, new TextEncoder().encode(source));
      assert.equal((await decorations.provideFileDecoration(capital, cancellation.token))?.badge, '[]');
    });
    await check('cancelled decoration and symbol queries return without results', async () => {
      cancellation.cancel();
      assert.equal(await decorations.provideFileDecoration(uri, cancellation.token), undefined);
      assert.deepEqual(new SvgDocumentSymbols().provideDocumentSymbols(document, cancellation.token), []);
    });
    await check('temporary provider registration and disposal use actual host lifecycles', async () => {
      const badgeRegistration = vscode.window.registerFileDecorationProvider(decorations);
      const symbolRegistration = vscode.languages.registerDocumentSymbolProvider(
        { pattern: '**/*.not-svg' }, new SvgDocumentSymbols(),
      );
      badgeRegistration.dispose();
      symbolRegistration.dispose();
      assert.equal((await symbols())[0]!.name, 'svg');
    });
    await check('tests leave the SVG source file unchanged on disk', async () => {
      assert.deepEqual(await readFile(uri.fsPath), originalBytes);
    });
    const evidence = process.env.SVG_LAB_EVIDENCE;
    if (evidence) {
      await mkdir(dirname(evidence), { recursive: true });
      await writeFile(evidence, JSON.stringify({
        kind: process.env.SVG_LAB_EXPECT_PACKAGED === '1'
          ? 'packaged-vsix-real-vscode-extension-host' : 'real-vscode-extension-host',
        ...(process.env.SVG_LAB_PACKAGE_SHA256 ? { packageSha256: process.env.SVG_LAB_PACKAGE_SHA256 } : {}),
        entryPoint: extension.packageJSON.main,
        packagedWithoutNodeModules: process.env.SVG_LAB_EXPECT_PACKAGED === '1',
        directProviderChecks: 'source-compiled providers tested against real workspace.fs; document-symbol command executes the registered entry under test',
        vscodeVersion: vscode.version,
        extension: extension.id,
        isolation: 'temporary workspace copy, profile and extensions directory; no model or network calls from the extension',
        registration: 'actual activation, document symbol command and decoration API with real workspace.fs',
        checks,
        passed: true,
      }, null, 2) + '\n');
    }
    console.log(`SVG Extension Host verification: ${checks.length} checks passed.`);
  } finally {
    decorations.dispose();
    cancellation.dispose();
    await replace(source);
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
  }
}
