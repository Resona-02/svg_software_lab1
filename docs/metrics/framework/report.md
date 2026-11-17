# CLI 重构指标

比较 final → framework。本报告由 scripts/metrics.mjs 从 Git 历史生成。

基线源码 SHA-256：`7f73a9aa8cab323c39138c5ec1a2d71d82cdbd16bb156c68f656f1c5e78765db`

目标源码 SHA-256：`59e46fd36615b73cbff0c4b242563b38abf3253c2082fe2cf3466bd1cd146580`

## 统计口径

- 只读取两个 Git 引用中的 CLI TypeScript 源码，按内核、装配处、插件分类。
- 内核为 src/domain、src/application、src/cli、src/infrastructure、src/api。装配处为 src/host 和 src/main.ts。插件为 plugins。
- 排除测试、fixtures、依赖、构建产物、文档和脚本。VSCode 扩展与 DSH 插件属于独立范围，不计入本表。
- 行数为物理行，含空行和注释，尾部换行不另算一行。同时列出非空行数。
- 使用锁文件中的 TypeScript 7.0.2 AST。每个带函数体的函数、方法、构造器、访问器、箭头函数提供 1 个基数；if、条件表达式、循环、非 default case、catch、&&、||、?? 各加 1。嵌套函数独立计基数，决策节点只统计一次。
- 文件圈复杂度为函数基数与决策点之和，包含模块顶层决策点，接口签名不计基数。模块自身无额外基数。
- 新增文件的基线为 0，删除文件的目标为 0，重命名以 Git 路径增删表示。职责来自源码类注释或顶层声明名。
- 报告保存源码摘要而非生成时间或目标提交哈希，使最终报告提交和 p2 标签可通过相同源码摘要核验。

## 分类汇总

| 类别 | 文件数（前→后） | 行数（前→后） | 非空行（前→后） | 圈复杂度（前→后） | 行数增量 | 圈复杂度增量 |
|---|---:|---:|---:|---:|---:|---:|
| 内核 | 50 → 60 | 2013 → 2191 | 1758 → 1920 | 587 → 638 | 178 | 51 |
| 装配处 | 1 → 5 | 9 → 199 | 8 → 183 | 0 → 57 | 190 | 57 |
| 插件 | 0 → 6 | 0 → 169 | 0 → 161 | 0 → 53 | 169 | 53 |

## 文件清单与职责

| 文件 | 类别 | 职责 | 行数（前→后） | 圈复杂度（前→后） | 圈复杂度增量 |
|---|---|---|---:|---:|---:|
| plugins/builtin-commands/BuiltinCommandProvider.ts | 插件 | 把内置命令的参数契约与构造方式作为注册实例提供。 | 0 → 14 | 0 → 2 | 2 |
| plugins/builtin-commands/BuiltinCommandsPlugin.ts | 插件 | 默认命令以同一注册协议装配，参数语义沿用 Phase 1。 | 0 → 98 | 0 → 28 | 28 |
| plugins/builtin-commands/index.ts | 插件 | 集中导出该模块允许使用的公开契约或插件入口 | 0 → 3 | 0 → 0 | 0 |
| plugins/builtin-shapes/BuiltinShapeProvider.ts | 插件 | Each instance describes one built-in type through the same provider contract. | 0 → 32 | 0 → 15 | 15 |
| plugins/builtin-shapes/BuiltinShapesPlugin.ts | 插件 | BuiltinShapesPlugin：注册该插件提供的扩展实例 | 0 → 19 | 0 → 8 | 8 |
| plugins/builtin-shapes/index.ts | 插件 | 集中导出该模块允许使用的公开契约或插件入口 | 0 → 3 | 0 → 0 | 0 |
| src/api/index.ts | 内核 | 集中导出该模块允许使用的公开契约或插件入口 | 0 → 44 | 0 → 0 | 0 |
| src/application/AddToCommand.ts | 内核 | AddToCommand：封装请求参数并将执行交给接收者 | 16 → 16 | 3 → 3 | 0 |
| src/application/AttributeHandler.ts | 内核 | Mutations recorded through this port participate in one set transaction. | 0 → 18 | 0 → 0 | 0 |
| src/application/AttributeTransaction.ts | 内核 | 受限的属性事务：先登记补偿，再修改目标或后代；不复制整棵树。 | 0 → 16 | 0 → 5 | 5 |
| src/application/BackCommand.ts | 内核 | BackCommand：封装请求参数并将执行交给接收者 | 16 → 16 | 3 → 3 | 0 |
| src/application/CanvasCommand.ts | 内核 | CanvasCommand：封装请求参数并将执行交给接收者 | 10 → 10 | 2 → 2 | 0 |
| src/application/Command.ts | 内核 | 所有入口共用的请求接口；文件命令允许异步执行。 | 4 → 4 | 0 → 0 | 0 |
| src/application/CommandArguments.ts | 内核 | 参数校验集中在边界；领域模型仍会校验业务不变量。 | 0 → 41 | 0 → 17 | 17 |
| src/application/CommandExecutor.ts | 内核 | Invoker：统一执行与历史迁移；异步命令等待期间拒绝其他入口，结束后可重试。 | 50 → 50 | 11 → 11 | 0 |
| src/application/CommandProvider.ts | 内核 | 定义 CommandProvider 的公开协作契约 | 0 → 9 | 0 → 0 | 0 |
| src/application/CommandTrigger.ts | 内核 | 可供菜单、右键菜单、工具栏等入口复用的触发器；不认识接收者。 | 11 → 11 | 2 → 2 | 0 |
| src/application/CreateCommand.ts | 内核 | CreateCommand：封装请求参数并将执行交给接收者 | 18 → 18 | 3 → 3 | 0 |
| src/application/DeleteCommand.ts | 内核 | DeleteCommand：封装请求参数并将执行交给接收者 | 16 → 16 | 3 → 3 | 0 |
| src/application/DocumentStore.ts | 内核 | 文件访问端口：应用层不关心 SVG 解析和磁盘读写。 | 7 → 7 | 0 → 0 | 0 |
| src/application/EditCommand.ts | 内核 | 命令只绑定接收者和请求参数。旧状态由接收者填写，命令不解释它。 | 19 → 19 | 2 → 2 | 0 |
| src/application/EditReceiver.ts | 内核 | 编辑业务接收者：组织领域对象、局部撤销记录、原子回滚和操作反馈。 | 126 → 143 | 45 → 54 | 9 |
| src/application/EditorSession.ts | 内核 | 当前文档的生命周期，以及编辑与文件操作之间的历史边界。 | 90 → 104 | 20 → 21 | 1 |
| src/application/ExtensionRegistry.ts | 内核 | One activation is a transaction: consumers only see successfully validated plugins. | 0 → 127 | 0 → 60 | 60 |
| src/application/FrontCommand.ts | 内核 | FrontCommand：封装请求参数并将执行交给接收者 | 16 → 16 | 3 → 3 | 0 |
| src/application/GroupCommand.ts | 内核 | GroupCommand：封装请求参数并将执行交给接收者 | 17 → 17 | 3 → 3 | 0 |
| src/application/HelpCommand.ts | 内核 | HelpCommand：封装请求参数并将执行交给接收者 | 10 → 10 | 2 → 2 | 0 |
| src/application/HelpReceiver.ts | 内核 | 帮助展示的接收者：只保存命令说明，不引用创建命令的 Client。 | 12 → 12 | 2 → 2 | 0 |
| src/application/History.ts | 内核 | 只保存命令和迁移两个栈；不调用命令，执行时序由 CommandExecutor 负责。 | 53 → 53 | 14 → 14 | 0 |
| src/application/InitCommand.ts | 内核 | InitCommand：封装请求参数并将执行交给接收者 | 10 → 10 | 2 → 2 | 0 |
| src/application/MoveCommand.ts | 内核 | MoveCommand：封装请求参数并将执行交给接收者 | 16 → 16 | 3 → 3 | 0 |
| src/application/Plugin.ts | 内核 | 定义 ExtensionSet、PluginContext、Plugin、PluginManifest 的公开协作契约 | 0 → 29 | 0 → 0 | 0 |
| src/application/ReadCommand.ts | 内核 | ReadCommand：封装请求参数并将执行交给接收者 | 10 → 10 | 2 → 2 | 0 |
| src/application/RedoCommand.ts | 内核 | RedoCommand：封装请求参数并将执行交给接收者 | 10 → 10 | 2 → 2 | 0 |
| src/application/SaveCommand.ts | 内核 | SaveCommand：封装请求参数并将执行交给接收者 | 10 → 10 | 2 → 2 | 0 |
| src/application/ScaleCommand.ts | 内核 | ScaleCommand：封装请求参数并将执行交给接收者 | 16 → 16 | 3 → 3 | 0 |
| src/application/SetCommand.ts | 内核 | SetCommand：封装请求参数并将执行交给接收者 | 16 → 16 | 3 → 3 | 0 |
| src/application/ShowCommand.ts | 内核 | ShowCommand：封装请求参数并将执行交给接收者 | 10 → 10 | 2 → 2 | 0 |
| src/application/Token.ts | 内核 | quoted 用来区分文本中的 "in" 和 create 的归属子句。 | 0 → 5 | 0 → 0 | 0 |
| src/application/TreeCommand.ts | 内核 | TreeCommand：封装请求参数并将执行交给接收者 | 10 → 10 | 2 → 2 | 0 |
| src/application/TreeDecorator.ts | 内核 | 定义 TreeRow、TreeDecorator 的公开协作契约 | 0 → 14 | 0 → 0 | 0 |
| src/application/UndoCommand.ts | 内核 | UndoCommand：封装请求参数并将执行交给接收者 | 10 → 10 | 2 → 2 | 0 |
| src/application/UndoState.ts | 内核 | 单条编辑的局部撤销记录。没有文档副本，也不保存执行后状态。 | 36 → 36 | 8 → 8 | 0 |
| src/application/UngroupCommand.ts | 内核 | UngroupCommand：封装请求参数并将执行交给接收者 | 16 → 16 | 3 → 3 | 0 |
| src/application/ViewReceiver.ts | 内核 | 通过统一的 Shape 接口渲染，不按图形类型分派。 | 39 → 49 | 13 → 16 | 3 |
| src/cli/Cli.ts | 内核 | 支持交互终端，也支持通过标准输入回放命令文件。EOF 结束会话。 | 27 → 27 | 8 → 8 | 0 |
| src/cli/CommandArguments.ts | 内核 | 声明模块导出与装配数据 | 41 → 1 | 17 → 0 | -17 |
| src/cli/CommandDispatcher.ts | 内核 | CLI 入口：取得抽象命令、委托执行器、格式化错误，不接触业务接收者。 | 17 → 17 | 5 → 5 | 0 |
| src/cli/CommandFactory.ts | 内核 | Parses input against the registered providers without knowing concrete commands. | 131 → 19 | 31 → 4 | -27 |
| src/cli/CommandSource.ts | 内核 | 定义 CommandSource 的公开协作契约 | 5 → 5 | 0 → 0 | 0 |
| src/cli/Token.ts | 内核 | 声明模块导出与装配数据 | 5 → 1 | 0 → 0 | 0 |
| src/cli/Tokenizer.ts | 内核 | 只处理词法，不执行命令；# 仅在整行开头表示注释。 | 34 → 34 | 12 → 12 | 0 |
| src/domain/Circle.ts | 内核 | 封装圆形的几何、属性、序列化信息及局部恢复操作 | 60 → 60 | 15 → 15 | 0 |
| src/domain/Ellipse.ts | 内核 | 封装椭圆的几何、属性、序列化信息及局部恢复操作 | 66 → 66 | 16 → 16 | 0 |
| src/domain/Group.ts | 内核 | 组合节点把统一操作递归交给子节点，不按具体类型分派。 | 68 → 77 | 29 → 33 | 4 |
| src/domain/Line.ts | 内核 | 封装直线的几何、属性、序列化信息及局部恢复操作 | 76 → 76 | 16 → 16 | 0 |
| src/domain/Rect.ts | 内核 | 封装矩形的几何、属性、序列化信息及局部恢复操作 | 66 → 66 | 16 → 16 | 0 |
| src/domain/Shape.ts | 内核 | Composite 的共同接口：调用方无需根据图形类型决定如何编辑。 | 127 → 132 | 46 → 50 | 4 |
| src/domain/ShapeFactory.ts | 内核 | Dispatches through the injected catalog; providers own format-specific reconstruction. | 72 → 29 | 19 → 9 | -10 |
| src/domain/ShapePlacements.ts | 内核 | 只保留移动节点的引用、旧父节点和旧下标，不复制兄弟节点或子树。 | 22 → 22 | 6 → 6 | 0 |
| src/domain/ShapeProvider.ts | 内核 | 定义 SvgShapeData、ShapeProvider 的公开协作契约 | 0 → 16 | 0 → 0 | 0 |
| src/domain/SvgDocument.ts | 内核 | 聚合根负责文档级不变量：唯一 id、树结构、层叠顺序与画布。 | 163 → 165 | 61 → 62 | 1 |
| src/domain/Text.ts | 内核 | 封装文字的几何、属性、序列化信息及局部恢复操作 | 64 → 64 | 14 → 14 | 0 |
| src/domain/Validator.ts | 内核 | 集中表达数值约束；几何行为仍由各图形自己负责。 | 39 → 39 | 14 → 14 | 0 |
| src/host/CodePlugins.ts | 装配处 | Method A: the only assembly file changed when adding optional plugins. | 0 → 6 | 0 → 0 | 0 |
| src/host/Host.ts | 装配处 | Selects assembly mode before exposing the unchanged line-oriented CLI. | 0 → 15 | 0 → 7 | 7 |
| src/host/PluginLoader.ts | 装配处 | 提供 CodePluginEntry、ConfigPluginEntry、PluginLoader 的类型定义与实现 | 0 → 134 | 0 → 45 | 45 |
| src/host/Runtime.ts | 装配处 | Composition root shared by the CLI and integration tests. | 0 → 41 | 0 → 5 | 5 |
| src/infrastructure/SvgCodec.ts | 内核 | Converts between SVG XML and the object model; file access stays in SvgFileStore. | 197 → 198 | 91 → 92 | 1 |
| src/infrastructure/SvgFileStore.ts | 内核 | File-system adapter; writes are replaced atomically only after serialization succeeds. | 33 → 33 | 6 → 6 | 0 |
| src/main.ts | 装配处 | 启动宿主并将依赖装配到 CLI 入口 | 9 → 3 | 0 → 0 | 0 |
