# CLI 回放会话

输入文件只有命令与注释，不含交互提示符或预期输出：

| 输入 | 覆盖内容 |
|---|---|
| `cli-1.txt` | Phase 1 §6 的基础会话，包括预期的分组失败和保存后 undo 限制 |
| `cli-box.txt` | Phase 1 §6.1 版本 B：复合图形、属性语义、撤销、树标签和保存 |
| `cli-commands.txt` | 初始化前 dir、空文档 stats、复合容器计数、查询不破坏 undo/redo，以及 read/save 不改变 cwd |

`fixtures/other.svg` 是作业的外部 SVG 输入。`expected/` 保存实际程序捕获的 stdout，不是从作业示意排版手填的结果。`final-cli-1.txt` 来自 Git 标签 `final` 的独立构建；其图形移动说明和树缩进以该版本真实字节为准。

在仓库根运行：

```sh
npm ci
node scripts/verify-phase2.mjs
```

脚本自行构建当前代码和 `final`。它将 `final` 通过 `git archive` 展开到临时目录，复用当前锁文件安装的依赖，构建后执行，结束时删除临时目录。不会切换或改写当前分支。

比较分两组：禁用可选插件的基础会话对照 `final`；三个输入分别以代码装配 A、配置装配 B 执行。A 使用默认入口，B 使用 `plugins.config.json` 的绝对路径。stdout、stderr 及会话保存的 SVG 都逐字节比较，不裁剪空白、不排序输出、不替换换行。随后对照已记录的输出，避免两个装配同时退化却仍相等。

每次运行同一会话前，在**同一个临时路径**重新准备相同目录内容：`docs/`、`plugins/`、`.hidden`、`other.svg`、`snapshot.svg` 和 `package.json`。新命令会话只覆盖已存在的 `snapshot.svg`，目录成员保持固定。日志位于独立目录，永远不进入 dir 的被测目录。失败日志复制到 `docs/metrics/failed-replay/` 便于诊断；该目录不是验收输入。

初次录入或有意改变可选插件输出时，先审核改动，再执行：

```sh
node scripts/verify-phase2.mjs --update
node scripts/verify-phase2.mjs
```

`--update` 仍会执行 `final` 兼容性及 A/B 一致性检查，只有所有检查成功才更新预期文件。只捕获历史基线可运行 `node scripts/verify-phase2.mjs --baseline-only --update`；它不验证 Phase 2。验收成功的摘要和字节摘要位于 `docs/metrics/verification.json`。

这些会话验证端到端行为。处理器部分失败、损坏 box、插件加载失败及目录读取失败等分支由独立自动测试验证；会话相等本身不替代契约测试。
