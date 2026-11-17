# ADR 001：属性处理器采用唯一匹配和局部补偿事务

状态：采用。

## 背景

`set n1 label ...` 对复合图形有领域语义，普通图形仍应保留 Phase 1 的属性限制。若内核列出 box 的属性名，后续插件就必须修改内核；若处理器直接修改多个对象而无统一事务，部分失败会留下半次编辑。

## 决策

`AttributeHandler` 由内核声明，插件实现稳定的 `name`、纯查询 `handles(shape, attribute)` 和 `apply(shape, attribute, value, edit)`。目标图形通过公开的 Shape 抽象传入，插件自行识别其领域类型和必要子部件；内核不识别 `box`、`fill` 或 `label` 的组合。

`EditReceiver.set` 先收集全部命中者。零个命中使用原属性白名单；一个命中交给处理器；多个命中直接报 `ambiguous attribute handlers: ...`，不按注册先后静默覆盖，也不依次叠加。匹配阶段不得改变图形或历史。

一次 `set` 由既有 SetCommand 与 UndoState 承载一个历史单元。处理器**必须同步执行，并通过 AttributeEdit.set 进行所有属性修改**；AttributeTransaction 限制对象为目标或其后代，每次先记录旧属性恢复操作，再执行设置。处理器可以调用该接口多次；全部成功才登记历史，undo 逆序恢复全部操作，redo 重新执行整体语义。

处理器返回成功文字及 `undone` 反馈函数。该函数捕获修改前的值，**在 apply 所在的 UndoState 事务内立即求值并检查返回值为字符串**，不得依赖未来 undo 的时机或修改任何状态。历史只保留求值后的字符串，真正 undo 时不会再调用插件反馈函数，避免在恢复完成之后才暴露插件反馈错误。

apply 正常返回或抛错后，AttributeTransaction 都立即 close。后续通过保存的 edit 引用写入会报 `attribute transaction is closed`；`undone` 求值时 edit 同样已关闭。返回 Promise 的异步 handler 明确拒绝，其已经登记的同步修改整体回滚，异步后续写入无法绕过关闭的事务。插件应在同步 apply 内完成一次原子的属性语义。

若 apply 中途抛错、返回契约不合法或一次设置失败，UndoState 逆序补偿已登记的局部修改；undo/redo 栈保留原状。失败不得转入默认属性处理。越界修改报 `attribute edit outside target: <id>`。

## 取舍与边界

相较优先级或组合链，唯一匹配减少顺序依赖，冲突能在运行时明确暴露。局部补偿复用 Phase 1 历史机制，不为每次 set 复制整棵文档。

插件拿到的是有公开领域方法的对象，TypeScript 接口不是安全隔离环境。绕过 AttributeEdit 直接修改、在 handles 中修改、在反馈函数中修改，均违反契约；框架不承诺替恶意插件恢复未经登记的变化。此限制必须让插件作者知道，不能把“接口类型通过”误当成全部副作用已受控。

## 验证

覆盖 box 的 fill/label 及 undo/redo、原属性回退、未知属性、多命中拒绝、修改两个子部件后失败整体恢复、越界修改、反馈异常/非法反馈、异步处理器及迟到写入拒绝，以及失败后历史计数保持。相关实现：`src/application/AttributeHandler.ts`、`AttributeTransaction.ts`、`EditReceiver.ts`、`UndoState.ts`。
