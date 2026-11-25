# 创建 box 的调用链与撤销/历史登记路径

模型解释，非执行记录。快照 4e2395054a577bb521f349d0242b7b0a14a53409d9c16e1261bc6d7eae3d5a44

基于已读源码可确认：EditReceiver.create 把实际工作包在 UndoState.run 中；工作回调调用 shape 工厂创建形状、把形状插入文档、登记一个删除恢复动作，最后返回创建消息。BoxProvider.create 负责参数数量校验、数字校验并构造 Box（含 Rect 与 Text）。UndoState.run 在动作抛错时调用 restore 反向执行已登记恢复动作并重新抛出。至于“CommandExecutor.executeCommand 何时登记历史”，输入中没有 CommandExecutor 节点或相关调用关系，无法核实，只能标注为待人工确认。

## 1. 入口：EditReceiver.create 包装 UndoState.run

已读源码显示 EditReceiver.create 直接调用 state.run，把创建逻辑放在第一个回调中，把撤销消息放在第二个回调中。调用关系 relation 标记为已解析的潜在调用。此步只是进入事务包装，不证明后面一定成功。

代码：src/application/EditReceiver.ts:18 (create)；src/application/UndoState.ts:10 (run)；src/application/EditReceiver.ts:19 (callback@19)；src/application/EditReceiver.ts:24 (callback@24)

步骤核验标记：尚未标记

- [ ] UndoState.run 的第二个参数 message 是“成功后才保存”还是“提前保存”？
- [ ] CreateCommand 是否就是调用 EditReceiver.create 的上游？输入中无 CreateCommand 节点，需确认。

后续：s2, s6

## 2. UndoState.run 的守卫与动作执行

已读源码：run 首先检查 this.message，若已存在则抛出 'command already executed'；随后在 try 中执行 action()，成功后把 message 回调赋给 this.message 并返回结果。这是一次性执行的守卫，失败分支见 s6。

代码：src/application/UndoState.ts:10 (run)

步骤核验标记：尚未标记

- [ ] this.message 的初始值类型是否为假值（如 undefined/null），否则首次执行也会被拒绝？
- [ ] message 是保存函数还是字符串？源码赋值 this.message = message，需确认字段类型与后续读取方式。

后续：s3, s6

## 3. 经 ShapeFactory.create 分派到 provider

已读源码：工作回调调用 this.session.shapes.create(type, id, [...params])，对应 ShapeFactory.create。它通过 this.provider(type) 取得 provider 后调用 create，并校验返回 shape.id 是否等于请求 id，不等则抛 'invalid shape provider result'。provider 查找方式与注册来源属推断，输入未给出完整 provider 表。

代码：src/application/EditReceiver.ts:19 (callback@19)；src/domain/ShapeFactory.ts:8 (create)

步骤核验标记：尚未标记

- [ ] type='box' 的 provider 是否由 BoxPlugin.activate 注册？输入只有注册调用，未证明注册时序。
- [ ] provider(type) 找不到类型时的行为是否在别处处理？输入未包含该分支源码。

后续：s4

## 4. BoxProvider.create：参数校验与 Box 构造

已读源码：BoxProvider.create 先要求 parameters.length === 5，否则抛错；对前 4 个值用 Validator.number 解析为数字（回调中调用），然后用这些数字和 parameters[4] 构造 Rect 与 Text，并传给 Box 构造器。Box 构造器再校验存在 rect#id-rect 与 text#id-label，否则抛 'invalid box structure'。Validator.number 用正则校验后调用 finite，非法输入会抛错。

代码：plugins/shape-box/BoxProvider.ts:9 (create)；plugins/shape-box/BoxProvider.ts:13 (callback@13)；src/domain/Validator.ts:3 (number)；src/domain/Rect.ts:10 (constructor)；src/domain/Text.ts:9 (constructor)；plugins/shape-box/Box.ts:8 (constructor)

步骤核验标记：尚未标记

- [ ] BoxProvider.create 只校验前 4 个数字，第 5 个（label）未做类型/空值校验是否预期？
- [ ] Rect 构造器对 width/height 做 nonNegative 校验，x/y 做 finite 校验；Box 不额外校验，是否满足需求？
- [ ] BoxProvider 的 fill 默认值来自 BoxPlugin.activate 的 options.fill，需确认默认 '#4a90d9' 生效路径。

后续：s5, s6

## 5. 插入文档、登记恢复动作、返回消息

已读源码：形状创建后调用 document.add(shape, parentId)。SvgDocument.add 先确定父容器（parentId 未给出时用根），收集现有全部 id（含根属性 id），并对 shape 子树做去重检查，发现重复即抛 'id already exists'；通过后 parent.insert(shape)。随后 state.record(() => shape.parent!.remove(shape)) 把一个恢复动作压入 UndoState 的 restorations。最后返回 shape.creationMessage(parentId)（Box 覆写为 box 专用的消息）。注意 record 在 add 之后，说明插入成功才登记恢复。

代码：src/application/EditReceiver.ts:19 (callback@19)；src/domain/SvgDocument.ts:58 (add)；src/application/UndoState.ts:6 (record)；src/application/EditReceiver.ts:22 (callback@22)；src/domain/Shape.ts:21 (creationMessage)；plugins/shape-box/Box.ts:4 (Box)

步骤核验标记：尚未标记

- [ ] shape.parent! 在恢复执行时是否可能为 null（如已被移走），导致 remove 抛错？
- [ ] 恢复动作调用 Group.remove 会经过 assertCanDetach 与 detach；Box 覆写 assertCanDetach 禁止移除 body/title，对本恢复是否影响？
- [ ] creationMessage 实际调用的是 Box 覆写版本还是 Shape 基类版本？需确认动态分派。

后续：s6

## 6. 失败恢复：UndoState.restore 反向执行并重抛

已读源码：run 的 catch 会调用 restore 然后抛出原错误。restore 从 restorations 末尾向前逐个调用已登记动作，最后清空数组。因此若在 add 之前失败，restorations 为空，恢复无操作；若在 add 之后、record 之前失败，已插入的形状不会被恢复（存在残留风险）；若 record 之后 creationMessage 抛错，则会执行 remove 回滚。restore 自身若抛错，会掩盖原错误，源码未捕获。

代码：src/application/UndoState.ts:10 (run)；src/application/UndoState.ts:30 (restore)；src/domain/Group.ts:36 (remove)；src/domain/Group.ts:41 (detach)

步骤核验标记：尚未标记

- [ ] add 成功后到 record 前是否能抛错（如 creationMessage 之外）？需确认工作回调顺序，目前源码顺序为 add → record → creationMessage。
- [ ] restore 中某个恢复动作抛错时，后续动作是否还会执行？源码没捕获，会中断循环。
- [ ] 多次命令共享同一 UndoState 时 restorations 如何清理？输入只有 restore 清空逻辑。

后续：s7

## 7. 历史登记位置（输入不足以证实）

任务询问 CommandExecutor.executeCommand 何时登记历史，但输入 symbols 中没有 CommandExecutor 节点，relations 中也没有它调用 EditReceiver.create 或 UndoState.run 的边。已读源码只能证明 UndoState.run 成功后才设置 this.message，这与“成功后才可撤销/历史”行为一致，但不能据此断言历史登记发生在 executeCommand。此处属推断，需人工核验。

代码：src/application/UndoState.ts:10 (run)；src/application/UndoState.ts:6 (record)

步骤核验标记：尚未标记

- [ ] CommandExecutor.executeCommand 是否在 run 成功返回后才把命令推入历史？需查其源码。
- [ ] 历史条目保存的是 UndoState 实例还是消息字符串？需确认 message 字段用途。
- [ ] 失败时 executeCommand 是否会丢弃该 UndoState 或清空 restorations？输入未覆盖。

后续：结束

## 不确定与风险
- 输入不含 CreateCommand 与 CommandExecutor 的节点；无法证实 CreateCommand.execute 的入口形态及 executeCommand 的历史登记时机，相关说明仅为推断。
- ShapeFactory.provider(type) 的具体实现与 provider 注册时序未给出，无法证明 type='box' 一定解析到 BoxProvider。
- 静态 calls 关系只是潜在调用；UndoState.run 中 action 与 restorations[index] 的分派为 unknown，实际执行函数由运行时回调决定。
- 回滚完整性取决于工作回调顺序：add 成功但 record 之前抛错会留下未登记恢复的已插入形状；源码当前顺序为 add → record → creationMessage。
- restore 若某个恢复动作抛错，源码未捕获，可能中断回滚并掩盖原始错误。
- shape.parent! 使用非空断言；恢复执行时父容器可能已变化，存在运行时错误风险。
- 未执行任何测试；以上均为静态阅读推断，不代表已验证的运行顺序或行为。
