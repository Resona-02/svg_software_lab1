import { createHash } from 'node:crypto';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { API } from 'typescript/unstable/sync';
import { createVirtualFileSystem } from 'typescript/unstable/fs';
import type { AnalysisSnapshot, AtlasDiagnostic, LanguageProvider, SourceFile, SourceSnapshot } from '../core/types.js';
import { TypeScriptSourceFacts } from './TypeScriptSourceFacts.js';

/** A closed source snapshot is the only filesystem visible to the compiler. */
export class TypeScriptLanguageProvider implements LanguageProvider {
  readonly name = 'typescript-javascript';

  async analyze(source: SourceSnapshot): Promise<AnalysisSnapshot> {
    const root = resolve(source.root);
    const diagnostics: AtlasDiagnostic[] = [];
    const files: SourceFile[] = [];
    const seen = new Set<string>();
    for (const input of source.files) {
      const path = input.path.replaceAll('\\', '/');
      const absolute = resolve(root, path);
      const local = relative(root, absolute);
      if (!path || isAbsolute(path) || /^[A-Za-z]:/.test(path) || !local || local === '..' || local.startsWith(`..${sep}`)) {
        diagnostics.push({ file: input.path, message: 'Source path is outside the project snapshot.' });
        continue;
      }
      const normalized = local.split(sep).join('/');
      if (seen.has(normalized)) throw new Error(`duplicate source path: ${normalized}`);
      seen.add(normalized);
      files.push({ path: normalized, content: input.content,
        hash: createHash('sha256').update(input.content).digest('hex') });
    }
    files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    const digest = createHash('sha256');
    for (const file of files) digest.update(file.path).update('\0').update(file.hash).update('\0');
    const id = digest.digest('hex');
    const codeFiles = files.filter(file => /\.(?:[cm]?[jt]s|[jt]sx)$/i.test(file.path));
    if (!codeFiles.length) return { id, root: source.root, nodes: [], relations: [], diagnostics };

    const contents: Record<string, string> = Object.create(null);
    for (const file of files) contents[resolve(root, file.path)] = file.content;
    let configName = '__atlas_snapshot__.json';
    while (Object.hasOwn(contents, resolve(root, configName))) configName = `_${configName}`;
    const config = resolve(root, configName);
    contents[config] = JSON.stringify({
      ...(seen.has('tsconfig.json') ? { extends: './tsconfig.json' } : {}),
      compilerOptions: {
        target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', jsx: 'preserve',
        noEmit: true, noLib: true, types: [], allowJs: true, checkJs: false, skipLibCheck: true,
      },
      files: codeFiles.map(file => `./${file.path}`), include: [], references: [],
    });
    const virtual = createVirtualFileSystem(contents);
    const normalize = (path: string) => resolve(path);
    const api = new API({ fs: {
      // undefined means "fall back to the real filesystem" in the TS7 API.
      // Every missing read is therefore explicitly denied with null.
      readFile: path => contents[normalize(path)] ?? null,
      fileExists: path => Object.hasOwn(contents, normalize(path)),
      directoryExists: path => virtual.directoryExists?.(normalize(path)) ?? false,
      getAccessibleEntries: path => virtual.getAccessibleEntries?.(normalize(path)) ?? { files: [], directories: [] },
      realpath: normalize,
    } });
    try {
      const snapshot = api.updateSnapshot({ openProjects: [config] });
      try {
        const project = snapshot.getProject(config);
        if (!project) throw new Error('TypeScript could not open the source snapshot.');
        for (const diagnostic of project.program.getConfigFileParsingDiagnostics()) {
          diagnostics.push({ file: diagnostic.fileName ? relative(root, diagnostic.fileName).split(sep).join('/') : 'tsconfig.json',
            message: diagnostic.text });
        }
        const facts = new TypeScriptSourceFacts(project, root, codeFiles).collect();
        return { id, root: source.root, nodes: facts.nodes, relations: facts.relations,
          diagnostics: [...diagnostics, ...facts.diagnostics] };
      } finally { snapshot.dispose(); }
    } finally { api.close(); }
  }
}
