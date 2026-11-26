# Code Atlas 0.3 · 代码审阅工作台

当前 DSH 会话工作区的只读阅读与设计辅助插件。主入口改为“代码审阅”，先选择一项任务，再按需查看源码。文件树与 SVG 关系图保留在辅助视图。

## 能做什么

| 任务 | 报告内容 |
|---|---|
| 变更核验 | 最近两次成功扫描之间的新增、修改、删除文件；影响范围与待验证项 |
| 运行流程 | 具体入口的输入、处理、状态变化、失败路径与结果 |
| 设计取舍 | 具体复杂性问题、源码依据、保持简单与引入模式的代价比较 |
| 重构计划 | 行为不变量、小步修改顺序、每一步验证与回退办法 |

设计评审参考课程的 Adapter、Strategy、Decorator、Observer 及信息隐藏、深模块、认知负荷原则。它不会为了使用模式而推荐增加层次。重构模式输出计划，源码保持只读。

外观参考 Claude Code 的文字优先与渐进展开思路，采用本项目自定的纸白/暖灰、陶土橙与等宽小标签，提供浅色和深色切换。没有引入 Claude 服务或更换 DSH 的模型。

## 怎么用

1. 打开有项目目录的 DSH 会话，进入侧栏“代码审阅”。选择会话，点击“建立索引”。
2. 选择一个任务入口，它只填写问题，不发起模型请求。也可在底部自行描述任务，直接点名如 CommandExecutor.executeCommand。
3. “选择范围”按需打开文件搜索，缩小到一个文件或方法。“查看代码”打开带行号、折行和定位的只读源码。
4. 点击“梳理流程 / 讨论设计 / 制定计划 / 核验变更”后才调用 DSH 已配置的默认模型，相关代码摘录会发送到该模型服务，可能产生费用。可以停止生成。
5. 在“阅读报告”逐节核对引用、建议和检查清单，导出 Markdown。报告中的核验标记只在当前视图保存。
6. 要核验新改动，先建立一次扫描基线，修改代码后再次点击“重新扫描”。变更列表按文件显示，不必展开整个工程。
7. 需要查结构时再进入“关系参考”；可切换结构与静态调用、上游与下游、1/2 层、清晰列表及 SVG 导出。层数是沿关系走几步，不表示执行顺序。

## 变更比较的范围

比较同一会话、同一工作区最近两次成功扫描的文件内容哈希，包含已收录 TS/JS 与本地配置。第一次明确没有前一份快照。扫描失败不替换旧结果，换工作区重新建立基线；关闭会话或重启后不持久保存。

这不是 Git diff，不提供上一版正文或逐行补丁，也不能识别代码由人还是 AI 编写。删除文件只显示路径，不能跳转旧行号。模型会明确标注材料缺口；变更核验报告绑定其比较基线，基线变化后不能继续发布旧结果。

## 安装与启动

目标版本固定为本机 Desktop 2.0.16 / DSH 0.2.0-rc.1 / Cordis 4.0.4，TypeScript 7.0.2。与面向其他 DSH 版本的 SVG Workbench 分开安装。

在仓库根目录构建：

    npm ci
    npm --prefix extensions/dsh-code-atlas ci
    npm --prefix extensions/dsh-code-atlas run check
    npm --prefix extensions/dsh-code-atlas test
    npm --prefix extensions/dsh-code-atlas run package

安装包：extensions/dsh-code-atlas/artifacts/dsh-code-atlas-0.3.0.tgz。

    node extensions/dsh-code-atlas/scripts/local-desktop.mjs install extensions/dsh-code-atlas/artifacts/dsh-code-atlas-0.3.0.tgz
    node extensions/dsh-code-atlas/scripts/local-desktop.mjs verify
    node extensions/dsh-code-atlas/scripts/local-desktop.mjs launch

脚本沿用官方 bundle 安装契约，默认使用 /Applications/DSH Desktop.app 和独立 /private/tmp/atlas-dsh-home profile；可用 ATLAS_DSH_APP 指定应用。缓存完备时安装末尾可加 --offline --fetch-retries=0。独立环境不更改原 profile。

在原生插件管理中停用会卸载该实例的入口、工具、订阅与模型任务。移除测试包：

    node extensions/dsh-code-atlas/scripts/local-desktop.mjs uninstall

恢复演示时重新安装并重启测试窗口。正式长期使用应选择持久 profile；临时目录不承诺跨系统清理保留。

## 服务和工具

界面和原生会话工具共用同一服务，维持 17 个原生接口、7 个工具：

- code_atlas_scan / inspect / route / mark_read / export
- code_atlas_review_context：task 与可选 intent（flow、design、refactor、change-review）
- code_atlas_publish_guide：只能发布该会话最新读取的范围，意图由服务端上下文赋值

单次模型上下文最多 24 个代码片段、42,000 字符正文、240 个调用位置；单片段最多 5,000 字符。节点引用、源码内容及快照在发布前校验。摘要与建议不等同于运行记录，建议测试不等于测试通过。

## 保留的边界

- 只读 TS/JS 阅读，未实现自动修改、自动重构、自动运行测试或完整动态调用追踪。
- 工作区外源码、依赖和未收录文件不参与分析；导入、类型关系与静态调用不证明完整执行顺序。
- 扫描上限：2,000 文件、单文件 1 MiB、总计 32 MiB、10,000 目录；跳过符号链接、依赖和构建目录，遵循 .gitignore。
- 已读、报告、历史与比较基线为实例内存状态。需要留档时导出报告。
- SVG 仍复用原 box、line、SvgDocument、SvgCodec。课程模式扩展证据及历史 0.2 验收保留。

详细设计、截图、验证范围及参考来源见 [0.3 设计说明](../../doc/code-atlas-v3.md)。第三方许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
