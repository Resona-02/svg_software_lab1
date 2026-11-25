import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Context } from '@deepseek-ai/cordis';
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local';
import { DshCodeSource } from '../lib/index.js';
import { AtlasWorkbench } from '../lib/core.js';
import { TypeScriptLanguageProvider } from '../lib/analysis.js';

// Assistant-authored reading example from the inspected source. No live model call.
const extension = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(extension, '../..');
const ctx = new Context(); const fs = await ctx.plugin(LocalFileSystem, {});
const workbench = new AtlasWorkbench(new DshCodeSource(ctx.fs), new TypeScriptLanguageProvider());
try {
  const view = await workbench.scan('example-guide', root);
  const node = (file, name) => {
    const found = view.snapshot.nodes.filter(item => item.file === file && item.name === name)
      .sort((a, b) => (b.location.end - b.location.start) - (a.location.end - a.location.start))[0];
    assert(found, `${file}:${name} must exist`); return found;
  };
  const executor = node('src/application/CommandExecutor.ts', 'executeCommand');
  const command = node('src/application/CreateCommand.ts', 'execute');
  const receiver = node('src/application/EditReceiver.ts', 'create');
  const factory = node('src/domain/ShapeFactory.ts', 'create');
  const provider = node('plugins/shape-box/BoxProvider.ts', 'create');
  const document = node('src/domain/SvgDocument.ts', 'add');
  const transaction = node('src/application/UndoState.ts', 'run');
  const draft = { title: '创建 box：从命令到文档的一条核验路径',
    summary: '沿一次 create box 的处理路径阅读：执行器接收命令，接收者组织创建，图形工厂选择 provider，最后校验并插入文档。失败恢复与历史登记是核验重点。这是基于源码组织的阅读建议，并未运行这些步骤。',
    steps: [
      { id: 'entry', title: '先看命令如何进入执行器', explanation: 'executeCommand 先检查是否还有异步命令执行。重复执行同一个编辑命令时，会取得独立的新执行实例，然后调用 execute。只有编辑执行返回成功后，才登记历史。', nodeIds: [executor.id], next: ['command'], checks: ['命令抛错时是否跳过历史登记？', '异步命令等待期间是否拒绝并发修改？'] },
      { id: 'command', title: 'CreateCommand 传递创建意图', explanation: 'execute 将类型、ID、参数、父节点和当前撤销状态交给 EditReceiver.create；命令本身不解释 box 的内部结构。', nodeIds: [command.id], next: ['transaction'], checks: ['参数副本是否与后续调用隔离？', '一次创建是否只占用一个撤销单元？'] },
      { id: 'transaction', title: '接收者把创建放进局部事务', explanation: 'EditReceiver.create 在 UndoState.run 中先创建 shape，再加入文档，随后记录移除这个 shape 的补偿操作。UndoState.run 在失败时逆序恢复已记录操作并重新抛错。阅读时要同时检查修改与补偿的先后。', nodeIds: [receiver.id, transaction.id], next: ['factory'], checks: ['插入前失败是否留下内容？', '插入后是否已记录对应补偿？'] },
      { id: 'factory', title: '工厂通过注册表选择图形实现', explanation: 'ShapeFactory.create 取得 type 对应的 provider，委托创建，再验证返回图形的 ID。这里是接口分派；仅从调用关系图不能证明运行时一定选中了 BoxProvider，仍要确认 box 插件已装配。', nodeIds: [factory.id], next: ['box'], checks: ['box 未加载时是否给出清楚错误？', 'provider 返回错误 ID 是否会被拒绝？'] },
      { id: 'box', title: 'box provider 负责复合图形细节', explanation: 'BoxProvider.create 检查五个参数并解析数值，构造带派生 ID 的矩形和文本，再组合为 Box。矩形的填充色与文字偏移属于这个插件的知识。', nodeIds: [provider.id], next: ['insert'], checks: ['参数数量或数值非法时是否在插入前失败？', '派生子 ID 会不会与已有节点冲突？'] },
      { id: 'insert', title: '整棵新子树通过校验后插入', explanation: 'SvgDocument.add 先选择父容器，遍历新 shape 的整棵子树，检查与已有图形及本子树的 ID 冲突；全部检查完成后才调用 parent.insert。成功随后返回执行器登记历史。', nodeIds: [document.id, executor.id], next: [], checks: ['冲突检查是否覆盖 box 内部两个叶子？', '失败后文档、undo 和 redo 是否保持原状态？'] },
    ], risks: ['示例只讨论创建路径，没有覆盖 set、save、撤销重做及全部 provider。', '接口分派和插件启用情况需要结合实际装配确认。', '源码分析与模型解释不能代替运行回归测试。'],
  };
  const referenced = new Set(draft.steps.flatMap(step => step.nodeIds));
  const published = await workbench.publishGuide('example-guide', view.snapshot.id, draft, referenced);
  const guide = published.guide;
  assert(guide);
  const output = resolve(extension, 'examples'); await mkdir(output, { recursive: true });
  await writeFile(resolve(output, 'box-creation-guide.json'), JSON.stringify({ method: 'Assistant-authored example validated against actual source; no paid model call', guide }, null, 2) + '\n');
  const body = `# ${guide.title}\n\n${guide.summary}\n\n> 本次助理根据已读取源码编写的示例，经真实源码位置与同一导览校验器验证；不是用户模型的在线调用记录。\n\n` + guide.steps.map((step, i) => `## ${i + 1}. ${step.title}\n\n${step.explanation}\n\n` + step.nodeIds.map(id => { const item = view.snapshot.nodes.find(node => node.id === id); return `- 代码：${item.file}:${item.location.startLine}（${item.name}）`; }).join('\n') + '\n\n' + step.checks.map(check => `- [ ] ${check}`).join('\n')).join('\n\n') + `\n\n## 仍需确认\n\n${guide.risks.map(risk => `- ${risk}`).join('\n')}\n`;
  await writeFile(resolve(output, 'box-creation-guide.md'), body);
  await workbench.inspect('example-guide', receiver.id); workbench.setGraphKind('example-guide', 'calls');
  const calls = workbench.route('example-guide', 'dependencies', 1);
  await writeFile(resolve(output, 'create-call-reference.svg'), calls.svg);
  const requestedNames = ['CreateCommand.execute', 'EditReceiver.create', 'ShapeFactory.create', 'BoxProvider.create', 'SvgDocument.add', 'UndoState.run', 'CommandExecutor.executeCommand'];
  const context = await workbench.reviewContext('example-guide', `梳理创建 box：${requestedNames.join('，')}，核验创建、失败恢复和历史登记。`);
  for (const name of requestedNames) assert(context.symbols.some(item => item.node.qualifiedName === name), `Explicitly requested ${name} must be read`);
  await writeFile(resolve(output, 'named-task-context.json'), JSON.stringify({ method: 'Offline source-context selection; no model request', snapshotId: context.snapshotId,
    requestedNames, supplied: context.symbols.map(item => ({ name: item.node.qualifiedName ?? item.node.name, file: item.node.file, line: item.node.location.startLine,
      fileHash: item.node.location.fileHash, sourceCharacters: item.source.length, truncated: item.sourceTruncated })),
    relations: context.relations.length, sourceCharacters: context.symbols.reduce((sum, item) => sum + item.source.length, 0), omittedSymbols: context.omittedSymbols,
  }, null, 2) + '\n');
  console.log(`Validated ${guide.steps.length} reading steps against ${referenced.size} source symbols; generated guide and actual static call SVG.`);
} finally { workbench.dispose(); await fs.dispose(); }
