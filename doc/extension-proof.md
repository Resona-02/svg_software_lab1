# Git 扩展差异验收

运行以下命令重新生成证据；脚本只读取 Git 中已提交的源码，不依赖当前工作区内容。

```sh
node scripts/verify-extension-diffs.mjs
```

产物是 `docs/metrics/extension-diffs.json`。也可传入一个输出路径，例如 `node scripts/verify-extension-diffs.mjs /private/tmp/extension-diffs.json`，然后逐字节比较两份报告。报告不含时间戳，重复运行结果稳定。脚本遇到缺失提交、缺失路径、空源码目录或越界修改会失败，不会生成“空 diff 即通过”的假证据。

| 扩展证明 | 接入提交 | 允许的既有运行源码改动 |
|---|---|---|
| box 方式 A：代码装配 | `dfcbe29589ebc28ae8c1fa4f1f400bc2aad78705` | 仅 `src/host/CodePlugins.ts` |
| box 方式 B：配置装配 | `04b315b69c43077b6013df7baa499bb6fe74fb8a`，分支 `phase2-box-config` | 无；只新增插件并修改配置 |
| modified-star 标签 | `fdffd8de3468bc048be0bbddfa3b221101b52a3d` | 仅 `src/host/CodePlugins.ts`；同时更新配置供方式 B 使用 |

对每个提交 C，脚本从 C 的父提交枚举当时已有的插件目录；随后在 C 与 C^ 中分别确认这些目录及 `src/domain`、`src/application`、`src/cli`、`src/infrastructure`、`src/api` 都实际存在且含有 TypeScript 源文件。每个目录记录 Git tree ID、源码文件清单、源码内容摘要；加载器、渲染器和装配文件另外记录 blob ID 与内容摘要。源码通过 `git show <revision>:<path>` 读取，引用错误或目录不存在会直接失败。

证据中的 `protectedCoreAndExistingPlugins` 对上述内核目录和 `plugins` 执行 `git diff --name-status C^ C`，并明确使用 `:(exclude)plugins/shape-box` 或 `:(exclude)plugins/tree-star` 排除本次新增插件。脚本还验证新增插件在 C^ 不存在、在 C 存在，且其中所有文件的状态都是新增；检查 `src` 的完整变化集合，以防把运行逻辑藏在其他宿主文件中。加载器与树渲染器有单独的零差异断言。

方式 A 的 box 接入只修改一个既有装配文件，不修改配置；方式 B 不修改任何 `src` 文件，仅改配置。标签接入时保留 box 和其他既有插件不变，核心与渲染器均无修改。

三次提交允许的配套变化均明确列在 JSON 的 `supportingChanges` 中：box 的两种接入各增加独立的 `test/box-plugin.test.ts`；标签接入增加 `test/tree-star.test.ts`。插件目录内的 README 与清单属于新增插件文件。三个接入提交均未借依赖或锁文件变化引入运行逻辑。

这份差异证明用于验证扩展时没有修改受保护代码；运行行为、错误回滚和两种装配的输出一致性，另由测试及 `scripts/verify-phase2.mjs` 的逐字节会话回放验证。
