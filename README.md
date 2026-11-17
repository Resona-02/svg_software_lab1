# SVG 插件式 CLI · Phase 2

在 [Resona-02/svg_software_lab1](https://github.com/Resona-02/svg_software_lab1) 的 Phase 1 基础上重构。保留原有图形、编辑和局部撤销机制，通过四个扩展点加入 `stats`、`dir`、`box` 和未保存星号标签。

本轮实现范围是 **Phase 2 第二部分的 CLI**。最新版在 `phase2-cli` 分支，发布标签为 `p2`；`final` 保留 Phase 1 验收版本，`main` 保留原有版本。VSCode 扩展与 DSH 插件不包含在本次实现中。

## 启动

需要 Node.js 22.12+（CI 使用 Node 24）：

```sh
git clone git@github.com:Resona-02/svg_software_lab1.git
cd svg_software_lab1
git checkout phase2-cli
npm ci
npm run cli
```

交互输入，`help` 查看命令，`Ctrl+D` 退出：

```text
dir
init 800 600
create box n1 120 100 160 60 "开始"
create box n2 520 100 160 60 "处理数据"
create line arrow1 280 130 520 130 black
group flowchart n1 n2 arrow1
set n2 fill #f5a623
set n2 label "处理数据 v2"
undo
stats
tree
save flowchart.svg
```

保存的 SVG 可在浏览器中打开。原 Phase 1 [流程图示例](examples/flowchart.commands) 仍可执行。

## 两种装配

```sh
npm run build
node dist/src/main.js                              # A：顶层代码装配
node dist/src/main.js --config plugins.config.json # B：读取配置装配
node dist/src/main.js --builtin-only               # 禁用所有可选插件，保留 Phase 1
```

默认 A/B 的插件集合和顺序相同。配置中的 `enabled: false` 跳过对应插件；相对路径以配置文件所在目录为基准。禁用 box 后读入已有 box 会降级成普通分组。

## 验证与设计记录

```sh
npm run check
npm test
npm run verify
npm run verify:extensions
npm run metrics
```

- [设计与使用说明](doc/README.md)：扩展点、前后依赖图、模式角色、接口契约。
- [四条 ADR](doc/adr/001-attribute-transactions.md)：属性事务、复合图形读回、dirty 语义、加载原子性。
- [可回放会话与预期输出](doc/transcript/README.md)：原 Phase 1 兼容性、box、stats/dir，两种装配逐字节比较。
- [Git 扩展证据](doc/extension-proof.md)：box 的 A/B 独立接入提交，及标签新增时核心零改动。
- [验收记录](doc/verification.md)：198 项测试及类型检查通过。
- [自动生成的指标](docs/metrics/report.md)：从 `final` 与 `p2` 的 Git 源码读取，按内核／装配处／插件拆分。

所有插件经同一路径暂存注册、校验清单，再原子发布。插件错误不会终止 CLI；失败属性编辑会整体恢复，并保留 undo/redo。插件在同一进程运行，必须遵守公开接口的副作用约束。
