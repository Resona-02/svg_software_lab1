# 创建 box：从命令到文档的一条核验路径

沿一次 create box 的处理路径阅读：执行器接收命令，接收者组织创建，图形工厂选择 provider，最后校验并插入文档。失败恢复与历史登记是核验重点。这是基于源码组织的阅读建议，并未运行这些步骤。

> 本次助理根据已读取源码编写的示例，经真实源码位置与同一导览校验器验证；不是用户模型的在线调用记录。

## 1. 先看命令如何进入执行器

executeCommand 先检查是否还有异步命令执行。重复执行同一个编辑命令时，会取得独立的新执行实例，然后调用 execute。只有编辑执行返回成功后，才登记历史。

- 代码：src/application/CommandExecutor.ts:14（executeCommand）

- [ ] 命令抛错时是否跳过历史登记？
- [ ] 异步命令等待期间是否拒绝并发修改？

## 2. CreateCommand 传递创建意图

execute 将类型、ID、参数、父节点和当前撤销状态交给 EditReceiver.create；命令本身不解释 box 的内部结构。

- 代码：src/application/CreateCommand.ts:15（execute）

- [ ] 参数副本是否与后续调用隔离？
- [ ] 一次创建是否只占用一个撤销单元？

## 3. 接收者把创建放进局部事务

EditReceiver.create 在 UndoState.run 中先创建 shape，再加入文档，随后记录移除这个 shape 的补偿操作。UndoState.run 在失败时逆序恢复已记录操作并重新抛错。阅读时要同时检查修改与补偿的先后。

- 代码：src/application/EditReceiver.ts:18（create）
- 代码：src/application/UndoState.ts:10（run）

- [ ] 插入前失败是否留下内容？
- [ ] 插入后是否已记录对应补偿？

## 4. 工厂通过注册表选择图形实现

ShapeFactory.create 取得 type 对应的 provider，委托创建，再验证返回图形的 ID。这里是接口分派；仅从调用关系图不能证明运行时一定选中了 BoxProvider，仍要确认 box 插件已装配。

- 代码：src/domain/ShapeFactory.ts:8（create）

- [ ] box 未加载时是否给出清楚错误？
- [ ] provider 返回错误 ID 是否会被拒绝？

## 5. box provider 负责复合图形细节

BoxProvider.create 检查五个参数并解析数值，构造带派生 ID 的矩形和文本，再组合为 Box。矩形的填充色与文字偏移属于这个插件的知识。

- 代码：plugins/shape-box/BoxProvider.ts:9（create）

- [ ] 参数数量或数值非法时是否在插入前失败？
- [ ] 派生子 ID 会不会与已有节点冲突？

## 6. 整棵新子树通过校验后插入

SvgDocument.add 先选择父容器，遍历新 shape 的整棵子树，检查与已有图形及本子树的 ID 冲突；全部检查完成后才调用 parent.insert。成功随后返回执行器登记历史。

- 代码：src/domain/SvgDocument.ts:58（add）
- 代码：src/application/CommandExecutor.ts:14（executeCommand）

- [ ] 冲突检查是否覆盖 box 内部两个叶子？
- [ ] 失败后文档、undo 和 redo 是否保持原状态？

## 仍需确认

- 示例只讨论创建路径，没有覆盖 set、save、撤销重做及全部 provider。
- 接口分派和插件启用情况需要结合实际装配确认。
- 源码分析与模型解释不能代替运行回归测试。
