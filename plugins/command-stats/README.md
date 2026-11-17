# `stats` 命令插件

本插件注册无参数命令 `stats`。`StatsProvider` 负责命令名、帮助语法与参数校验，`StatsCommand` 将执行转发给 `StatsReceiver`。提供者通过 `PluginContext.registerCommand` 接入，无需修改内置命令表。

`StatsReceiver` 使用公开文档遍历接口，从画布子节点按当前顺序深度优先统计。`isContainer()` 为真的节点只计入 containers，容器内部叶子继续参与统计；根 SVG 不计入。叶子类型按首次出现顺序输出，类型计数和末尾总计之间固定两个空格。空文档输出 `(total 0, containers 0)`。

接收者只读取文档，命令不继承 `EditCommand`，不会进入撤销历史。每次执行访问当前活动文档，因此更换文档后不会沿用旧统计结果。插件依赖公开抽象，不导入内置命令表、宿主装配模块或具体 `box` 插件；新增容器沿用相同统计规则。

独立测试位于 `test/command-plugins.test.ts`，覆盖空文档、深度优先顺序、嵌套容器、读取当前文档、参数检查与注册清单一致性。
