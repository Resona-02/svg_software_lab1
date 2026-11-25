# DSH Code Atlas

将当前 DSH 会话工作区的 TypeScript / JavaScript 源码转换为可点击的 SVG 代码地图，并提供源码阅读面板。地图复用本仓库 Phase 2 SVG 内核；源码分析、阅读状态和 SVG 图形分别建模。

## 0.2 阅读工作台

- 扫描 TS / TSX / JS / JSX 及对应的 ESM、CommonJS 后缀；显示文件、类、接口、函数、方法和命名空间，包括嵌套符号。
- 展示模块导入、再导出以及可解析的 `extends` / `implements`；支持本工作区内的别名、barrel 导出、`.js` 指向 `.ts` 和 `tsconfig` 路径映射。未解析关系保留名称和源码证据。
- 通过结构树、搜索或地图选择节点，查看带行号的源码；点击关系证据定位到相应引用位置。
- 在“查看依赖 / 查看使用者”和一跳 / 两跳之间切换；叠加公开 API、已读、测试文件标签；下载当前视图的 SVG。
- DSH 原生模型工具和界面使用同一个服务、同一份会话状态。源码只被读取，扫描不运行项目脚本。
- 项目总览按模块归类，文件符号按需展开、搜索与分页；方法标签包含所属类/命名空间，减少同名节点歧义。
- 函数调用、匿名回调及对象构造提供静态参考，与 import / 类型结构分开显示；不宣称完整运行调用图。
- 后退 / 前进保留节点、方向、层数、关系类型和搜索；失败时不移动历史位置，不使用旧源码缓存。
- 可拖动分栏、专注画布、平移缩放、清晰列表、按需展开证据、可调整字号的源码上下文。
- AI 任务导览提供步骤说明、后续分支、真实代码引用及人工核验问题。引用位置核验不等于解释已被证明。

改进依据、课程原则与验证范围见 [0.2 设计说明](../../doc/code-atlas-v2.md)。

## 运行版本

本版针对本机 **DSH Desktop 2.0.16** 内置的 **DSH 0.2.0-rc.1 / Cordis 4.0.4**，Node.js 要求为 **22.12 或更新版本**。DSH SDK 使用 rc.1，不与仓库中另一个面向较新 SDK 的 SVG 扩展混装。

分析器固定使用 **TypeScript 7.0.2** 的 `typescript/unstable/sync`、`unstable/fs` 和 `unstable/ast`。这些入口尚不稳定，升级 TypeScript 必须同时检查适配器和分析测试；不能直接换成旧版 `createProgram` 示例。运行依赖和宿主依赖以 `package.json`、`package-lock.json` 为准。

## 构建与安装

先在仓库根目录安装 SVG 内核依赖，再构建插件：

```sh
npm ci
npm --prefix extensions/dsh-code-atlas ci
cd extensions/dsh-code-atlas
npm run check
npm test
npm run package
```

产物为 `artifacts/dsh-code-atlas-0.2.0.tgz`。它是一个包含 Host 与原生 Web Client 的 DSH bundle，使用包内 `cordis.patch.yml` 注册。安装通过 Desktop 随附的 CLI 的 `plugin add` 流程完成。

本机试用脚本创建独立测试 profile，并使用 Desktop 自带的包管理运行环境：

```sh
node scripts/local-desktop.mjs install artifacts/dsh-code-atlas-0.2.0.tgz
node scripts/local-desktop.mjs verify
node scripts/local-desktop.mjs launch
node scripts/local-desktop.mjs status
```

默认应用路径为 `/Applications/DSH Desktop.app`，可以用 `ATLAS_DSH_APP` 指定另一安装位置。脚本检查内置 DSH 必须为 `0.2.0-rc.1`。测试数据固定放在 `/private/tmp/atlas-dsh-home`，profile 名为 `code-atlas`，Electron 用户目录为该目录下的 `desktop-user-data`。`init` 可单独准备此 profile。`install` 会按 SHA-256 为归档命名并保存在隔离目录，确保同版本更新也能获得正确的新包；缓存完整时可在命令末尾加 `--offline --fetch-retries=0`。`verify [工作区]` 从安装后的 profile 解析插件，用真实宿主服务执行扫描和协议核验，结果写入隔离目录的 `installed-verification.json`。`launch /绝对路径/工作区` 可指定其他工作区；省略时打开本仓库。

这些命令使用隔离的 profile、选择状态、包缓存和用户目录。关闭测试窗口后重新打开原来的 DSH Desktop，即可返回原环境。界面验收、截图和实际执行结果应以对应验收记录为准；构建成功本身不代表 Desktop 界面验收完成。

验收卸载时，执行以下命令，再通过 Desktop 的正常重启操作重新加载测试 profile，确认“代码地图”入口消失。该操作只移除隔离 profile 内的插件；需要继续演示时重新执行上面的 `install`，再重启测试窗口。

```bash
node scripts/local-desktop.mjs uninstall
```

## 在 DSH 中使用

1. 在打开的工作区内创建一个有工作目录的 DSH 会话。
2. 点击侧栏“代码地图”，选择该会话，点击“扫描 / 刷新”。若会话尚未出现，点击“刷新会话”。
3. 从项目总览按模块找入口。选择文件看导入关系，选择函数或方法后切到“调用参考”。匿名回调有独立节点，避免把回调正文当作外层函数直接执行。
4. 用“后退 / 前进”回到上一步；面包屑可回到父级。图支持拖动、滚动平移和 Ctrl+滚轮缩放；关系较多时默认使用清晰列表。
5. 源码默认收起。点击“源码”或展开“调用位置与上下文”按需阅读；源码提供每页 180 行的上下文、前后翻页和字号调整。
6. 顶部输入具体任务，点击“生成 AI 导览”。使用 DSH 当前默认模型，点击才发送最多 24 个相关符号、42,000 字符正文和 240 个调用位置，可能产生模型费用；每符号最多 5,000 字符，保留截断标志与省略数量。可取消，也可在会话中用下述工具梳理。
7. 导览显示模型解释、人工核验问题和代码范围。点击引用查看完整上下文；分支按钮可跳到后续步骤。可导出导览 Markdown 或当前关系图 SVG。

源码修改后请重新扫描。打开源码或标记已读时会重新核验文件内容；若与地图版本不同，插件要求刷新，避免跳到过期行号。

随包启用的 `test-file` 标签插件会给 `*.test.*`、`*.spec.*`，以及 `__tests__` / `test` / `tests` 目录中的 TS / JS 文件及其符号增加 `[测试文件]`。匹配不区分大小写，目录名称按完整路径分量匹配，不把 `test-utils` 等名称当作测试目录。它通过已有标签扩展契约注册，可叠加在公开 API、已读标签之后；识别结果属于阅读提示，不代表测试已经运行。

模型侧提供以下原生工具，工具的工作区来自当前 Agent 会话：

| 工具 | 用途 |
| --- | --- |
| `code_atlas_scan` | 扫描当前会话工作区并返回地图摘要 |
| `code_atlas_inspect` | 通过节点 ID 核验并读取源码证据 |
| `code_atlas_route` | 切换依赖 / 使用者方向及一跳 / 两跳范围 |
| `code_atlas_mark_read` | 设置或取消节点的会话内已读标记 |
| `code_atlas_export` | 返回当前 SVG 文本及建议文件名 |
| `code_atlas_review_context` | 为具体任务读取有界函数正文和调用位置，不调用模型 |
| `code_atlas_publish_guide` | 校验并发布模型给出的步骤、引用和核验问题 |

例如：`请用 code_atlas 扫描当前工作区，定位 CommandExecutor.executeCommand，读取“创建 box、错误恢复和撤销历史”的任务上下文。根据实际代码梳理步骤、分支与核验问题，再发布到任务导览；未读到的实现请说明缺口。` 工具导出返回文本；界面导出触发下载。需要模型保存文件时，可另外明确指定保存位置并使用宿主文件工具。

## 边界

- 扫描上限为 2,000 个文件、单文件 1 MiB、总计 32 MiB、10,000 个目录；超限报错。跳过符号链接、常见构建和依赖目录，并遵循工作区内 `.gitignore`。
- 分析只看扫描快照中的文件。工作区外源码、`node_modules`、未收录的配置或依赖可能导致关系未解析。结果用于结构阅读，不等同于完整 TypeScript 类型检查。
- 支持可解析的静态调用和构造位置；运行时动态调用、反射、跨进程行为和完整控制流仍需进一步解释与验证。属性方法仅定位声明目标，不证明动态实现；未解析调用显式保留。
- 单次地图最多显示 120 个节点，超出时提示截断；结构树仍基于完整分析结果。循环依赖会被保留。
- 已读、导览和阅读设置在会话内存中，历史在客户端实例中；关闭会话、卸载或重启后不持久保存。导览中的勾选是当前视图标记，离开可重置，需留档时请导出 Markdown。刷新保留未变文件的已读标记，并移除旧快照导览。
- 当前使用手动扫描，不自动监听文件变化；源码面板提供插件内阅读，未承诺跳转到外部编辑器。
- AI 导览是解释与建议阅读顺序，不是运行记录，也不保证代码正确。界面显示提供给模型的符号数量，不声称一轮已核验整个项目。
- [box 创建导览样例](examples/box-creation-guide.md)由本次助理根据源码编写，经真实引用校验；不是在线调用用户模型的记录。

实现说明见仓库中的 [设计文档](../../doc/code-atlas-design.md)。第三方代码和依赖许可见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。
