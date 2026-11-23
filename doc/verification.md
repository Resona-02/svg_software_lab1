# Phase 2 三部分验收记录

最后本地核验：2026-11-23。环境：Node.js 24.16.0，VSCode 1.146.0，Cordis 4.1.0 / DSH SDK 0.2.2-rc.5。依赖精确版本或解析版本由三个 package-lock.json 保存。

| 检查 | 本地实际结果 | 证据 |
|---|---|---|
| CLI 类型检查与回归 | 198 项 node:test 通过，0 失败；含原 Phase 1 全部 100 项 | `test/`、`npm test` |
| CLI 兼容与双装配回放 | 4 组原始字节比较通过，包含 stdout/stderr 与保存 SVG；预期输出也通过 | `docs/metrics/verification.json` |
| CLI 插件接入差异 | box A、box B、tree-star 三组保护路径检查通过 | `docs/metrics/extension-diffs.json` |
| VSCode 纯解析器 | 10 项 node:test 通过 | `extensions/vscode-svg/test/outline.test.ts` |
| VSCode 开发宿主 | 12 项实际 API 检查通过 | `doc/vscode-host-evidence.json` |
| 最终 VSIX 安装包 | 解包后 14 项真实宿主检查通过，无 node_modules/开发源码依赖 | `doc/vscode-vsix-evidence.json` |
| VSCode 界面效果 | 原生基线、文件标记、大纲定位、未保存编辑更新、不完整 XML 五张实拍截图 | `docs/images/vscode-*.png` |
| DSH 官方执行流水线 | 14 项 node:test 通过，真实 ToolsService + Native executor + 官方 testkit | `extensions/dsh-svg/test/workbench.test.mjs` |
| DSH 演示 | 13 次 JSON 工具调用通过并生成审批流程图 | `extensions/dsh-svg/examples/tool-transcript.json`、`approval.svg` |
| DSH tgz 安装包 | 仓库外解包后注册、创建 box、导出、卸载通过 | `doc/dsh-package-evidence.json` |
| 指标 | 从 Git blob 生成，CLI 与两扩展分别统计 | `docs/metrics/`、两个 metrics 脚本 |

CLI + VSCode parser + DSH 的 **222 项 node:test 测试**由 `npm run test:all` 执行；VSCode 的真实宿主检查另计，不能把它当作 Node 单测或模型对话次数。类型检查使用 `npm run check:all`。

## 验证方法

回放对照真实 Git 标签 final 的独立构建，禁用可选插件时逐字节相同；默认代码与配置装配的三组会话也相同。不裁剪空白或替换换行。dir 使用同一路径和成员固定的临时目录，输出日志在目录外。

VSCode 的 parser 单测、真实 Extension Host 和界面观察互补。实际宿主通过 `vscode.executeDocumentSymbolProvider` 查询未保存缓冲区，并检查 selectionRange；安装包测试还断言真实激活位置为临时解包目录。直接 FileDecoration provider 断言使用真实 workspace.fs；Explorer 实际显示由截图证明。输入不完整时为空大纲，撤销临时改动后恢复，磁盘示例不变。

DSH 测试没有用假的 ctx 代替平台：将插件挂到官方 Cordis/Tools/Native 组件，由官方模型工具 testkit 完成参数 schema 验证、执行和 canonical 输出。测试不需要 API key。本次未进行完整 Desktop/Web 自然语言模型会话；机器原有 Desktop 的旧 DSH 版本不在包的兼容范围，没有改写其 profile 或凭据。

失败分支包括加载回滚、属性中途失败与历史保持、迟到写拒绝、损坏 box、失败读写的保存基准、异常 XML、取消、同会话排队和多会话隔离。它们有明确状态断言，不能只依赖 A/B 两份输出恰好相同。

## CI 与版本

`.github/workflows/ci.yml` 分 CLI、VSCode、DSH 三个任务。VSCode 用 Linux/Xvfb 执行最终 VSIX 检查；DSH 安装匹配 SDK 后验证流水线和 tgz。安装包与执行证据作为 Actions artifacts 提供。远程结果以对应提交的 Actions 页面为准。

`final` 保留 Phase 1，`p2` 保留已经发布的 CLI 快照；后续源码、截图与包说明位于 `phase2-complete`，最终快照使用 `p2-complete`。完整交付 ZIP 的 `artifacts/delivery.json` 记录源码提交和两个安装包的 SHA-256，便于回溯。
