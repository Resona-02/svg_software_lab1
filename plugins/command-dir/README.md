# `dir` 命令插件

本插件注册无参数命令 `dir`。命令每次执行时读取进程当前工作目录，与是否初始化 SVG、当前 SVG 文件路径无关。它不访问编辑会话，不修改文档、dirty 状态、工作目录或 undo/redo 历史。

调用顺序为 `DirProvider.create → DirCommand.execute → DirectoryReceiver.list → DirectoryReader.list`。`DirCommand` 只绑定接收者；输出、排序及错误处理属于 `DirectoryReceiver`。插件的 `activate` 方法组装生产依赖并注册提供者，代码装配和配置装配使用相同实现。

## Adapter 角色

| 角色 | 实现 | 职责 |
| --- | --- | --- |
| Client | `DirectoryReceiver` | 通过统一接口读取目录，生成命令输出 |
| Target | `DirectoryReader` | 返回只含名称与种类的直接子项，不泄露 Node 的类型 |
| Adapter | `NodeDirectoryAdapter` | 持有 Node 目录访问能力，将 `Dirent` 转为 `DirectoryEntry` |
| Adaptee | Node `fs/promises.readdir` 与 `Dirent` | 访问真实文件系统、识别子项种类 |

测试可以直接向 `DirectoryReceiver` 或 `DirProvider` 注入 `DirectoryReader` 替身，无需改动命令，也无需加载其他插件。

## 输出约定

- 只列直接子项；保留隐藏项，过滤 `.` 和 `..`。
- 依次输出目录 `[DIR]`、普通文件 `[FILE]`、符号链接 `[LINK]`、其他类型 `[OTHER]`。每个标记后固定两个空格。
- 每组按名称的 JavaScript 字符串顺序升序排列，不使用依赖地区设置的排序规则；同一目录内容的输出顺序一致。
- 不遍历符号链接的目标；指向目录的链接和失效链接均显示为 `[LINK]`。设备、管道及套接字等显示为 `[OTHER]`。
- 空目录输出 `(empty directory)`。读取失败抛出 `cannot read directory: <path>`，由 CLI 统一加上 `error: ` 前缀；后续命令仍可执行。

独立测试位于 `test/command-plugins.test.ts`，同时覆盖替身与真实临时目录。插件自身只依赖内核公开 API 和本包内文件。
