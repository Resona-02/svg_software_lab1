import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { API } from 'typescript/unstable/sync';
import { createVirtualFileSystem } from 'typescript/unstable/fs';
import * as ts from 'typescript/unstable/ast';
import { version as compilerVersion } from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (process.argv.length > 5) throw new Error('usage: node scripts/metrics-extensions.mjs [ref] [output-directory] [label]');
const [ref = 'HEAD', outputDirectory = 'docs/metrics/extensions', label = 'p2-complete'] = process.argv.slice(2);
const categoryNames = { 'vscode-svg': 'VSCode 扩展', 'dsh-svg': 'DSH 插件' };
const sourcePaths = Object.keys(categoryNames).map(category => `extensions/${category}/src`);
const numericFields = ['lines', 'nonBlankLines', 'functions', 'decisions', 'complexity'];

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

function categoryOf(path) {
  const match = /^extensions\/(vscode-svg|dsh-svg)\/src\/.+\.ts$/.exec(path);
  return match && !/\.(?:test|spec)\.ts$/.test(path) ? match[1] : undefined;
}

function isDecision(node) {
  if (ts.isIfStatement(node) || ts.isConditionalExpression(node) || ts.isCaseClause(node) || ts.isCatchClause(node)) return true;
  if (ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node)) return true;
  return ts.isBinaryExpression(node) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind);
}

function responsibility(text, source) {
  const declarations = source.statements.filter(node => ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isFunctionDeclaration(node));
  // Prefer the runtime class over helper interfaces preceding it in the same file.
  const primary = declarations.find(ts.isClassDeclaration) ?? declarations[0];
  const comments = primary ? ts.getLeadingCommentRanges(text, primary.pos) ?? [] : [];
  const comment = comments.map(range => text.slice(range.pos, range.end)).find(value => value.startsWith('/**'));
  if (comment) return comment.replace(/^\/\*\*|\*\/$/g, '').replace(/^\s*\*\s?/gm, '').replace(/\s+/g, ' ').trim();
  const names = declarations.map(node => node.name?.text).filter(Boolean);
  return names.length ? `提供 ${names.join('、')} 的公开契约或实现` : '插件入口与宿主注册声明';
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
  const lines = text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
  return { path, category: categoryOf(path), responsibility: responsibility(text, source),
    lines: text.length ? lines.length : 0, nonBlankLines: lines.filter(line => line.trim()).length,
    functions, decisions, complexity: functions + decisions };
}

// The only source input is committed Git blobs; current working-tree edits are excluded.
const revision = git('rev-parse', '--verify', `${ref}^{commit}`).trim();
const files = git('ls-tree', '-r', '--name-only', '-z', revision, '--', ...sourcePaths)
  .split('\0').filter(path => categoryOf(path)).sort();
for (const category of Object.keys(categoryNames)) {
  if (!files.some(path => categoryOf(path) === category)) throw new Error(`no committed ${category} TypeScript sources at ${ref}`);
}
const hash = createHash('sha256');
const sources = Object.fromEntries(files.map(path => {
  const text = git('show', `${revision}:${path}`);
  hash.update(path).update('\0').update(text).update('\0');
  return [path, text];
}));
const prefix = '/svg-extension-metrics';
const configPath = `${prefix}/tsconfig.json`;
const virtualFiles = Object.fromEntries(files.map(path => [`${prefix}/${path}`, sources[path]]));
virtualFiles[configPath] = JSON.stringify({ compilerOptions: { noLib: true, noResolve: true }, files });
const api = new API({ fs: createVirtualFileSystem(virtualFiles) });
let records;
try {
  const snapshot = api.updateSnapshot({ openProjects: [configPath] });
  try {
    const program = snapshot.getProject(configPath).program;
    records = files.map(path => {
      const source = program.getSourceFile(`${prefix}/${path}`);
      if (!source) throw new Error(`TypeScript could not parse ${ref}:${path}`);
      return analyze(path, sources[path], source);
    });
  } finally { snapshot.dispose(); }
} finally { api.close(); }
const totals = Object.fromEntries(Object.keys(categoryNames).map(category => {
  const selected = records.filter(file => file.category === category);
  return [category, { files: selected.length,
    ...Object.fromEntries(numericFields.map(key => [key, selected.reduce((sum, file) => sum + file[key], 0)])) }];
}));
const sourceDigest = hash.digest('hex');
const escape = value => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
const markdown = [
  '# VSCode 与 DSH 扩展指标', '',
  `统计对象：${escape(label)}。由 scripts/metrics-extensions.mjs 直接读取 Git 历史源码生成。`, '',
  `源码 SHA-256：\`${sourceDigest}\``, '',
  '## 统计口径', '',
  '- 仅统计 extensions/vscode-svg/src/**/*.ts 与 extensions/dsh-svg/src/**/*.ts，分别列出，不混入 CLI 重构增量。',
  '- 不读取当前工作区；排除测试、依赖、构建产物、文档和脚本。行数为物理行，含空行和注释，尾部换行不另计一行。',
  `- 使用锁定的 TypeScript ${compilerVersion} AST，与 CLI 指标使用相同口径：每个带函数体的函数、方法、构造器、访问器、箭头函数计 1 个基数；if、条件表达式、循环、非 default case、catch、&&、||、?? 各加 1。`,
  '- 圈复杂度为函数基数加决策点；嵌套函数独立计基数，决策节点只计一次，接口签名不计基数，模块顶层无额外基数。',
  '- 文件职责优先使用运行类的文档注释，否则使用顶层声明名。报告没有生成时间或提交哈希，用源码摘要核验，避免最终报告提交的自引用。', '',
  '## 分类汇总', '',
  '| 类别 | 文件数 | 物理行 | 非空行 | 函数基数 | 决策点 | 圈复杂度 |',
  '|---|---:|---:|---:|---:|---:|---:|',
  ...Object.keys(categoryNames).map(category => {
    const total = totals[category];
    return `| ${categoryNames[category]} | ${total.files} | ${numericFields.map(key => total[key]).join(' | ')} |`;
  }), '',
  '## 文件清单与职责', '',
  '| 文件 | 类别 | 职责 | 物理行 | 非空行 | 函数基数 | 决策点 | 圈复杂度 |',
  '|---|---|---|---:|---:|---:|---:|---:|',
  ...records.map(file => `| ${escape(file.path)} | ${categoryNames[file.category]} | ${escape(file.responsibility)} | ${numericFields.map(key => file[key]).join(' | ')} |`), '',
].join('\n');
const output = resolve(root, outputDirectory);
mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, 'report.json'), JSON.stringify({
  methodology: 'TypeScript AST; CC = body-bearing function count + specified decision nodes; extensions only, separate from CLI',
  compilerVersion, label, sourcePaths, sourceDigest, totals, files: records,
}, null, 2) + '\n');
writeFileSync(resolve(output, 'report.md'), markdown);
console.log(`Extension metrics ${label}: ${files.length} paths, source ${sourceDigest}`);
