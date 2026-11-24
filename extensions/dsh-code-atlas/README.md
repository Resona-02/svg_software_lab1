# DSH Code Atlas

将当前 DSH 会话工作区的 TypeScript / JavaScript 源码转换为可点击的 SVG 代码地图，并提供源码阅读面板。地图复用本仓库 Phase 2 SVG 内核；源码分析、阅读状态和 SVG 图形分别建模。

## 第一版功能

- 扫描 TS / TSX / JS / JSX 及对应的 ESM、CommonJS 后缀；显示文件、类、接口、函数、方法和命名空间，包括嵌套符号。
- 展示模块导入、再导出以及可解析的 `extends` / `implements`；支持本工作区内的别名、barrel 导出、`.js` 指向 `.ts` 和 `tsconfig` 路径映射。未解析关系保留名称和源码证据。
- 通过结构树、搜索或地图选择节点，查看带行号的源码；点击关系证据定位到声明位置。
- 在“查看依赖 / 查看使用者”和一跳 / 两跳之间切换；叠加公开 API、已读、测试文件标签；下载当前视图的 SVG。
- DSH 原生模型工具和界面使用同一个服务、同一份会话状态。源码只被读取，扫描不运行项目脚本。

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

产物为 `artifacts/dsh-code-atlas-0.1.0.tgz`。它是一个包含 Host 与原生 Web Client 的 DSH bundle，使用包内 `cordis.patch.yml` 注册。安装通过 Desktop 随附的 CLI 的 `plugin add` 流程完成。

本机试用脚本创建独立测试 profile，并使用 Desktop 自带的包管理运行环境：

```sh
node scripts/local-desktop.mjs install artifacts/dsh-code-atlas-0.1.0.tgz
node scripts/local-desktop.mjs verify
node scripts/local-desktop.mjs launch
node scripts/local-desktop.mjs status
```

默认应用路径为 `/Applications/DSH Desktop.app`，可以用 `ATLAS_DSH_APP` 指定另一安装位置。脚本检查内置 DSH 必须为 `0.2.0-rc.1`。测试数据固定放在 `/private/tmp/atlas-dsh-home`，profile 名为 `code-atlas`，Electron 用户目录为该目录下的 `desktop-user-data`。`init` 可单独准备此 profile。`verify [工作区]` 从安装后的 profile 解析插件，用真实宿主服务执行扫描和协议核验，结果写入隔离目录的 `installed-verification.json`。`launch /绝对路径/工作区` 可指定其他工作区；省略时打开本仓库。

这些命令使用隔离的 profile、选择状态、包缓存和用户目录。关闭测试窗口后重新打开原来的 DSH Desktop，即可返回原环境。界面验收、截图和实际执行结果应以对应验收记录为准；构建成功本身不代表 Desktop 界面验收完成。

验收卸载时，执行以下命令，再通过 Desktop 的正常重启操作重新加载测试 profile，确认“代码地图”入口消失。该操作只移除隔离 profile 内的插件；需要继续演示时重新执行上面的 `install`，再重启测试窗口。

```bash
node scripts/local-desktop.mjs uninstall
```

## 在 DSH 中使用

1. 在打开的工作区内创建一个有工作目录的 DSH 会话。
2. 点击侧栏“代码地图”，选择该会话，点击“扫描 / 刷新”。若会话尚未出现，点击“刷新会话”。
3. 先选文件节点看模块关系，再选类或接口看继承、实现关系；函数和方法节点可用于阅读源码，但第一版不生成函数调用关系。
4. 点击节点或“证据 文件:行号”查看源码，按需切换阅读方向、范围、标签和已读状态，最后“导出 SVG”。

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

例如：`请用 code_atlas 扫描当前工作区，先从入口文件查看依赖，再给我相关类的源码证据。` 工具导出返回文本；界面导出触发下载。需要模型保存文件时，可另外明确指定保存位置并使用宿主文件工具。

## 边界

- 扫描上限为 2,000 个文件、单文件 1 MiB、总计 32 MiB、10,000 个目录；超限报错。跳过符号链接、常见构建和依赖目录，并遵循工作区内 `.gitignore`。
- 分析只看扫描快照中的文件。工作区外源码、`node_modules`、未收录的配置或依赖可能导致关系未解析。结果用于结构阅读，不等同于完整 TypeScript 类型检查。
- 运行时动态导入、动态调用、反射和完整调用图不在第一版范围。语法损坏文件保留诊断，不推测其符号关系。
- 单次地图最多显示 120 个节点，超出时提示截断；结构树仍基于完整分析结果。循环依赖会被保留。
- 已读、当前选择和阅读设置只存于本进程的会话内存；关闭会话、卸载插件或重启后不会持久保存。刷新只保留内容未变文件的已读标记。
- 当前使用手动扫描，不自动监听文件变化；源码面板提供插件内阅读，未承诺跳转到外部编辑器。

实现说明见仓库中的 [设计文档](../../doc/code-atlas-design.md)。第三方代码和依赖许可见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。
