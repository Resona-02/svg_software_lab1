# Lab1 Phase 2 · SVG 插件实践与插件式重构

基于 [Resona-02/svg_software_lab1](https://github.com/Resona-02/svg_software_lab1) 的 Phase 1，实现三部分课程作业：VSCode 文件标记与原生大纲、插件式 CLI、DSH SVG 会话工具。

完整后续版本在 **`phase2-complete` 分支 / `p2-complete` 标签**；原 `p2` 保留已发布的 CLI 验收快照，`final` 保留 Phase 1。完整版本没有重写这些历史标签。

| 部分 | 代码 | 说明与验证 |
|---|---|---|
| VSCode 插件 | [extensions/vscode-svg](extensions/vscode-svg) | [安装、模式分析、复用评估与截图](doc/vscode.md)；SVG 文件旁的 `[]`、嵌套大纲、点击定位和编辑更新 |
| 插件式 CLI | [src](src)、[plugins](plugins) | [四个扩展点、架构图、ADR](doc/README.md)；stats/dir/box/标签、双装配和原子回滚 |
| DSH 插件 | [extensions/dsh-svg](extensions/dsh-svg) | [安装与实测说明](doc/dsh.md)；七个会话工具、局部撤销、会话隔离和 SVG 导出 |

## 获取与启动

```sh
git clone git@github.com:Resona-02/svg_software_lab1.git
cd svg_software_lab1
git checkout phase2-complete
npm ci
npm run setup:extensions
```

CLI 需要 Node.js 22.12+；完整测试和 DSH 插件需要 **Node.js 24.9+**，CI 使用 Node 24。VSCode 1.95+，本地真实宿主验证为 1.146.0。DSH 固定匹配 **0.2.2-rc.5 / Cordis 4.1.0**，旧版 Desktop 的差异及验证边界在文档中说明。

CLI：

```sh
npm run cli
# 或先 build 后运行两种装配
npm run build
node dist/src/main.js
node dist/src/main.js --config plugins.config.json
node dist/src/main.js --builtin-only
```

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

VSCode：运行仓库里的 **Run SVG Extension** 调试配置（F5），或生成并安装 VSIX。示例工作区为 `extensions/vscode-svg/examples`，以文本编辑模式打开 example.svg，在 Explorer 展开“大纲”。

DSH：先运行 `npm --prefix extensions/dsh-svg run demo`，无需 API key 即可回放官方工具流水线并生成 SVG；安装到匹配版本宿主的命令见 [DSH README](extensions/dsh-svg/README.md)。

## 验证和交付

```sh
npm run check:all
npm run test:all
npm run verify
npm run verify:extensions
npm run package:extensions
npm --prefix extensions/vscode-svg run test:vsix
npm --prefix extensions/dsh-svg run verify:package
```

VSCode 宿主测试会启动临时编辑器窗口；Linux CI 使用 `xvfb-run -a`。CLI 回归、基础大纲单测及 DSH 官方工具流水线无需图形界面。DSH 本次验证不调用模型服务，不声称已经在完整 Desktop 会话中完成自然语言模型对话。

- [验收总表](doc/verification.md)：测试、安装包检查和截图证据。
- [AI 协作检查与修正](doc/ai-review.md)：逐项记录对生成方案的检查。
- [Git 插件接入证据](doc/extension-proof.md)：box A/B 独立接入提交，核心与既有插件零改动。
- [可回放 CLI 会话](doc/transcript/README.md)：对照 final，代码与配置装配逐字节一致。
- [指标](docs/metrics/README.md)：CLI 与 VSCode/DSH 分开统计，脚本从 Git 历史生成。

依次完成安装包构建与两项安装包验证后，提交源码及证据，再运行 `npm run package:assignment` 可生成含 Git 已提交源码、文档、截图、VSIX 和 DSH tgz 的课程交付 ZIP；脚本会核对包的 SHA-256 与验收证据。依赖和构建目录不进入 Git。
