# 从 Git 历史生成的 CLI 指标

在仓库根运行：

```sh
npm ci
node scripts/metrics.mjs
```

默认比较 `final` 与 `p2`。两个标签必须存在；脚本只读 Git 已提交对象，未提交修改不会进入报告。显式指定两个 Git 引用、输出目录和目标显示名称的格式是：

```sh
node scripts/metrics.mjs final HEAD docs/metrics p2
node scripts/metrics.mjs final <框架节点提交> docs/metrics/framework framework
```

每次生成 `report.md` 和 `report.json`，包含文件清单、源码职责、三类行数、函数基数、决策点和圈复杂度增量。分类和复杂度公式随报告列出，不手填数字。AST 使用锁文件中 TypeScript 的编译器 API，在虚拟项目中解析从 Git 取得的源码；它不会误把注释或字符串中的 `if` 等文字计作分支。类型声明无函数体，因此不产生函数基数。

源码按如下互斥路径分类：内核为 `src/domain`、`src/application`、`src/cli`、`src/infrastructure`、`src/api`；装配处为 `src/host` 和 `src/main.ts`；插件为 `plugins`。只统计 `.ts` 文件，排除测试、fixtures、构建产物、依赖、脚本和文档。VSCode 与 DSH 的实现不计入 CLI 增量。

报告用排序后的「文件路径 + 源码字节」计算 SHA-256，以识别实际统计对象。报告自身不属于源码分类，也不记录生成时间或目标提交哈希；因此可以先对最终源码提交生成显示名为 `p2` 的报告，再提交报告并打 `p2` 标签，重新生成后仍保持一致。这避免将报告自己的提交哈希写入报告导致循环变化。

圈复杂度采用明确的项目统计口径，不声称等同所有第三方工具的 McCabe 变体。文件总值为带函数体的函数基数加决策点，模块顶层没有额外基数，`&&`、`||`、`??` 计决策点。它用于解释复杂性如何从内核转移到插件；总行数增加不自动表示设计退步，也不能单凭这些数字证明低耦合。

`framework/` 保存框架可扩展阶段的首次产出；根目录报告保存最终对比。`verification.json` 由独立回放脚本产生，记录实际字节比较结果。失败诊断目录 `failed-replay/` 不属于正式报告，应在排除问题后清理，不提交其临时日志。
