import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { API } from 'typescript/unstable/sync';
import { createVirtualFileSystem } from 'typescript/unstable/fs';
import * as ts from 'typescript/unstable/ast';
import { version as compilerVersion } from 'typescript';

// Reads committed sources at both revisions. Working-tree changes cannot affect a report.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [baselineRef = 'final', targetRef = 'p2', outputDirectory = 'docs/metrics', targetLabel = targetRef] = process.argv.slice(2);
const categoryNames = { core: '内核', composition: '装配处', plugins: '插件' };
const categories = Object.keys(categoryNames);

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

function categoryOf(path) {
  if (!path.endsWith('.ts') || /(?:^|\/)(?:test|tests|fixtures|node_modules|dist)(?:\/|$)/.test(path) || /\.(?:test|spec)\.ts$/.test(path)) return undefined;
  if (path.startsWith('plugins/')) return 'plugins';
  if (path === 'src/main.ts' || path.startsWith('src/host/')) return 'composition';
  if (/^src\/(?:domain|application|cli|infrastructure|api)\//.test(path)) return 'core';
  return undefined;
}

function isDecision(node) {
  if (ts.isIfStatement(node) || ts.isConditionalExpression(node) || ts.isCaseClause(node) || ts.isCatchClause(node)) return true;
  if (ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node)) return true;
  return ts.isBinaryExpression(node) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind);
}

function analyze(path, text, source) {
  let functions = 0;
  let decisions = 0;
  const visit = node => {
    if (ts.isFunctionLikeDeclaration(node) && node.body) functions++;
    if (isDecision(node)) decisions++;
    node.forEachChild(visit);
  };
  visit(source);
  const declarations = source.statements.filter(node => ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isFunctionDeclaration(node));
  const names = declarations.map(node => node.name?.text).filter(Boolean);
  const firstDeclaration = declarations[0];
  const comments = firstDeclaration ? ts.getLeadingCommentRanges(text, firstDeclaration.pos) ?? [] : [];
  const comment = comments.map(range => text.slice(range.pos, range.end))
    .filter(value => value.startsWith('/**'))[0];
  const responsibility = comment
    ? comment.replace(/^\/\*\*|\*\/$/g, '').replace(/^\s*\*\s?/gm, '').replace(/\s+/g, ' ').trim()
    : names.length ? names.join('、') : '模块导出与装配声明';
  const lines = text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
  return { path, category: categoryOf(path), responsibility, lines: text.length ? lines.length : 0,
    nonBlankLines: lines.filter(line => line.trim()).length, functions, decisions, complexity: functions + decisions };
}

function readRevision(ref, label) {
  git('rev-parse', '--verify', `${ref}^{commit}`);
  const files = git('ls-tree', '-r', '--name-only', ref).trim().split('\n').filter(path => categoryOf(path)).sort();
  if (!files.length) throw new Error(`no CLI TypeScript source files at ${ref}`);
  const hash = createHash('sha256');
  const sources = Object.fromEntries(files.map(path => {
    const text = git('show', `${ref}:${path}`);
    hash.update(path).update('\0').update(text).update('\0');
    return [path, text];
  }));
  // TypeScript 7 parses through its compiler API service. The virtual project
  // prevents working-tree files and unresolved imports from changing the input.
  const prefix = '/svg-cli-metrics';
  const configPath = `${prefix}/tsconfig.json`;
  const virtualFiles = Object.fromEntries(files.map(path => [`${prefix}/${path}`, sources[path]]));
  virtualFiles[configPath] = JSON.stringify({ compilerOptions: { noLib: true, noResolve: true }, files });
  const api = new API({ fs: createVirtualFileSystem(virtualFiles) });
  let records;
  try {
    const snapshot = api.updateSnapshot({ openProjects: [configPath] });
    const program = snapshot.getProject(configPath).program;
    records = files.map(path => {
      const source = program.getSourceFile(`${prefix}/${path}`);
      if (!source) throw new Error(`TypeScript could not parse ${ref}:${path}`);
      return analyze(path, sources[path], source);
    });
    snapshot.dispose();
  } finally {
    api.close();
  }
  const totals = Object.fromEntries(categories.map(category => {
    const selected = records.filter(record => record.category === category);
    return [category, { files: selected.length, ...Object.fromEntries(['lines', 'nonBlankLines', 'functions', 'decisions', 'complexity'].map(key => [key, selected.reduce((sum, file) => sum + file[key], 0)])) }];
  }));
  return { label, sourceDigest: hash.digest('hex'), totals, files: records };
}

const before = readRevision(baselineRef, baselineRef);
const after = readRevision(targetRef, targetLabel);
const changes = Object.fromEntries(categories.map(category => [category, Object.fromEntries(Object.keys(before.totals[category]).map(key => [key, after.totals[category][key] - before.totals[category][key]]))]));
const allPaths = [...new Set([...before.files, ...after.files].map(file => file.path))].sort();
const beforeByPath = new Map(before.files.map(file => [file.path, file]));
const afterByPath = new Map(after.files.map(file => [file.path, file]));
const escape = value => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
const markdown = [
  '# CLI 重构指标', '',
  `比较 ${before.label} → ${after.label}。本报告由 scripts/metrics.mjs 从 Git 历史生成。`, '',
  `基线源码 SHA-256：\`${before.sourceDigest}\``, '',
  `目标源码 SHA-256：\`${after.sourceDigest}\``, '',
  '## 统计口径', '',
  '- 只读取两个 Git 引用中的 CLI TypeScript 源码，按内核、装配处、插件分类。',
  '- 内核为 src/domain、src/application、src/cli、src/infrastructure、src/api。装配处为 src/host 和 src/main.ts。插件为 plugins。',
  '- 排除测试、fixtures、依赖、构建产物、文档和脚本。VSCode 扩展与 DSH 插件属于独立范围，不计入本表。',
  '- 行数为物理行，含空行和注释，尾部换行不另算一行。同时列出非空行数。',
  `- 使用锁文件中的 TypeScript ${compilerVersion} AST。每个带函数体的函数、方法、构造器、访问器、箭头函数提供 1 个基数；if、条件表达式、循环、非 default case、catch、&&、||、?? 各加 1。嵌套函数独立计基数，决策节点只统计一次。`,
  '- 文件圈复杂度为函数基数与决策点之和，包含模块顶层决策点，接口签名不计基数。模块自身无额外基数。',
  '- 新增文件的基线为 0，删除文件的目标为 0，重命名以 Git 路径增删表示。职责来自源码类注释或顶层声明名。',
  '- 报告保存源码摘要而非生成时间或目标提交哈希，使最终报告提交和 p2 标签可通过相同源码摘要核验。', '',
  '## 分类汇总', '',
  '| 类别 | 文件数（前→后） | 行数（前→后） | 非空行（前→后） | 圈复杂度（前→后） | 行数增量 | 圈复杂度增量 |',
  '|---|---:|---:|---:|---:|---:|---:|',
  ...categories.map(category => `| ${categoryNames[category]} | ${before.totals[category].files} → ${after.totals[category].files} | ${before.totals[category].lines} → ${after.totals[category].lines} | ${before.totals[category].nonBlankLines} → ${after.totals[category].nonBlankLines} | ${before.totals[category].complexity} → ${after.totals[category].complexity} | ${changes[category].lines} | ${changes[category].complexity} |`), '',
  '## 文件清单与职责', '',
  '| 文件 | 类别 | 职责 | 行数（前→后） | 圈复杂度（前→后） | 圈复杂度增量 |',
  '|---|---|---|---:|---:|---:|',
  ...allPaths.map(path => {
    const old = beforeByPath.get(path);
    const current = afterByPath.get(path);
    const file = current ?? old;
    return `| ${escape(path)} | ${categoryNames[file.category]} | ${escape(file.responsibility)} | ${old?.lines ?? 0} → ${current?.lines ?? 0} | ${old?.complexity ?? 0} → ${current?.complexity ?? 0} | ${(current?.complexity ?? 0) - (old?.complexity ?? 0)} |`;
  }), '',
].join('\n');
const output = resolve(root, outputDirectory);
mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, 'report.json'), JSON.stringify({ methodology: 'TypeScript AST; CC = body-bearing function count + specified decision nodes', compilerVersion, baseline: before, target: after, changes }, null, 2) + '\n');
writeFileSync(resolve(output, 'report.md'), markdown);
console.log(`Metrics ${before.label} -> ${after.label}: ${allPaths.length} paths, target ${after.sourceDigest}`);
