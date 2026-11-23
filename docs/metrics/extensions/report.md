# VSCode 与 DSH 扩展指标

统计对象：p2-complete。由 scripts/metrics-extensions.mjs 直接读取 Git 历史源码生成。

源码 SHA-256：`74b703c979cc46200a93db733736d0207fcd2d6eb61fd367e481352acdd96c66`

## 统计口径

- 仅统计 extensions/vscode-svg/src/**/*.ts 与 extensions/dsh-svg/src/**/*.ts，分别列出，不混入 CLI 重构增量。
- 不读取当前工作区；排除测试、依赖、构建产物、文档和脚本。行数为物理行，含空行和注释，尾部换行不另计一行。
- 使用锁定的 TypeScript 7.0.2 AST，与 CLI 指标使用相同口径：每个带函数体的函数、方法、构造器、访问器、箭头函数计 1 个基数；if、条件表达式、循环、非 default case、catch、&&、||、?? 各加 1。
- 圈复杂度为函数基数加决策点；嵌套函数独立计基数，决策节点只计一次，接口签名不计基数，模块顶层无额外基数。
- 文件职责优先使用运行类的文档注释，否则使用顶层声明名。报告没有生成时间或提交哈希，用源码摘要核验，避免最终报告提交的自引用。

## 分类汇总

| 类别 | 文件数 | 物理行 | 非空行 | 函数基数 | 决策点 | 圈复杂度 |
|---|---:|---:|---:|---:|---:|---:|
| VSCode 扩展 | 5 | 217 | 203 | 18 | 56 | 74 |
| DSH 插件 | 5 | 231 | 212 | 47 | 21 | 68 |

## 文件清单与职责

| 文件 | 类别 | 职责 | 物理行 | 非空行 | 函数基数 | 决策点 | 圈复杂度 |
|---|---|---|---:|---:|---:|---:|---:|
| extensions/dsh-svg/src/SvgEditor.ts | DSH 插件 | DSH composition root reuses Phase 2 contracts, commands, codec and plugins. | 74 | 65 | 10 | 7 | 17 |
| extensions/dsh-svg/src/SvgMemoryStore.ts | DSH 插件 | Import uses the existing document-store boundary; no tool reads arbitrary files. | 13 | 12 | 4 | 0 | 4 |
| extensions/dsh-svg/src/SvgSessions.ts | DSH 插件 | Agent identity owns an isolated, serial editor; plugin unload drops every session. | 43 | 39 | 5 | 10 | 15 |
| extensions/dsh-svg/src/SvgToolError.ts | DSH 插件 | Stable error identity retained by DSH's official tool execution pipeline. | 9 | 8 | 1 | 0 | 1 |
| extensions/dsh-svg/src/index.ts | DSH 插件 | Host adapter: Cordis owns registration lifetime; SVG core owns all editing rules. | 92 | 88 | 27 | 4 | 31 |
| extensions/vscode-svg/src/SvgDocumentSymbols.ts | VSCode 扩展 | Adapts editor-independent source ranges to the native Outline protocol. | 23 | 20 | 5 | 3 | 8 |
| extensions/vscode-svg/src/SvgFileDecorations.ts | VSCode 扩展 | File identity stays with the host; this provider only supplies a visual badge. | 35 | 31 | 6 | 6 | 12 |
| extensions/vscode-svg/src/extension.ts | VSCode 扩展 | Composition root: register capabilities, let VSCode own rendering and queries. | 16 | 15 | 1 | 0 | 1 |
| extensions/vscode-svg/src/outline/OutlineNode.ts | VSCode 扩展 | An editor-neutral symbol; all offsets use JavaScript / VSCode UTF-16 units. | 10 | 10 | 0 | 0 | 0 |
| extensions/vscode-svg/src/outline/SvgOutlineParser.ts | VSCode 扩展 | Strict XML validation plus source spans; malformed edits produce an empty outline. | 133 | 127 | 6 | 47 | 53 |
