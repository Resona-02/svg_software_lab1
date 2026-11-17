# 框架可扩展阶段

首次指标对应提交 `74a2f37`（四个扩展点、原子注册、默认能力和双装配宿主）。此节点尚未装入本阶段的可选功能插件，数字保留为阶段证据，不随后续实现覆盖。

重现命令：

```sh
node scripts/metrics.mjs final 74a2f37 docs/metrics/framework framework
```

`report.md` 与 `report.json` 由上述脚本生成；源码摘要可核验统计对象。若使用不同 TypeScript 版本或统计公式，需明确说明，不应将变化误认为运行源码变更。
