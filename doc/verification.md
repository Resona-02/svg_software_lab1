# CLI 验收记录

本地验证日期：2026-11-17。环境：Node.js v24.16.0，使用 package-lock.json 执行干净 npm ci。

| 检查 | 实际结果 |
|---|---|
| `npm run check` | 类型检查通过 |
| `npm test` | 198 项通过，0 失败，0 跳过；包含原 Phase 1 的全部 100 项回归 |
| `npm run verify` | 4 组原始字节比较通过，并通过已记录预期输出检查 |
| `npm run verify:extensions` | box A、box B、tree-star 三组 Git 变化范围检查通过 |
| 历史指标 | 从 final 与最终源码提交读取；框架和最终两份报告均可重新生成 |

回放比较包括 `final` 与禁用可选插件的基础会话，以及代码/配置装配下的基础、box、新命令三份会话；比较 stdout、stderr 和保存的 SVG。每次 dir 会话都使用同一路径下相同目录成员，日志不在被测目录内。

失败路径由独立测试覆盖，不以两份输出恰好相同代替业务断言：包括注册失败后的整包撤销、配置错误后仍可使用内置命令、处理器中途抛错保持文档与两方向历史、反馈回调失败、异步处理器和迟到写入、损坏 box 保持原文档、读写失败保持保存基准，以及 undo 回到保存点消星。

自动化在 `.github/workflows/ci.yml` 中使用 Node 24 / Ubuntu 运行同样的类型检查、测试、回放和扩展差异检查，并在 CI 中再次从 Git 生成指标。远程具体运行结果以仓库 Actions 记录为准。

- [回放摘要](../docs/metrics/verification.json)
- [扩展差异摘要](../docs/metrics/extension-diffs.json)
- [最终指标](../docs/metrics/report.md)
- [独立测试与会话说明](transcript/README.md)
