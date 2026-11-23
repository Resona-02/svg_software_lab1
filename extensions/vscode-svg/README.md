# SVG Software Lab · VSCode 扩展

提供课程要求的两项功能：Explorer 中 `.svg` 文件旁追加 `[]` 标记，以及 SVG 文本的原生 Outline。标记不修改文件名或内容，目录和其他文件没有标记；大纲按 XML 嵌套显示 `标签名#id`，无 id 时只显示标签名，点击定位源码。输入暂时不完整时清空大纲，恢复有效内容后自动显示。

## 安装包

在 VSCode 扩展视图右上角选择 **Install from VSIX / 从 VSIX 安装**，选择 `svg-software-lab-0.1.0.vsix`。安装后打开示例目录 `extensions/vscode-svg/examples`，将 `example.svg` 以文本编辑器打开，在 Explorer 下展开“大纲”。

如果 SVG 被其他扩展以预览方式打开，使用编辑器右上角 **Reopen as Source Text / 以文本重新打开**，或文件右键 **Open With / 打开方式 → Text Editor / 文本编辑器**。示例目录自己的 `.vscode/settings.json` 只将该目录的 SVG 默认编辑器设为文本，不改变用户全局设置。

文件标记使用 VSCode 的 FileDecoration API。请保持 Explorer 的文件徽章可见；其他文件装饰可以共存，截图中的 `U` 是 Git 的“未跟踪”标志，只有 `[]` 来自本扩展。

## 从源码运行

需要 Node.js 22.12+、VSCode 1.95+；实测 VSCode 1.146.0。

```sh
npm --prefix extensions/vscode-svg ci
npm --prefix extensions/vscode-svg run compile
```

从仓库根用 VSCode 打开项目，运行调试配置 **Run SVG Extension**（F5）。它会启动扩展开发宿主并打开示例目录。编译后的运行包只有 `dist/extension.cjs`，已包括 XML 依赖，无需用户另装 Node 依赖。

## 测试与打包

```sh
npm --prefix extensions/vscode-svg run check
npm --prefix extensions/vscode-svg test
npm --prefix extensions/vscode-svg run test:host
npm --prefix extensions/vscode-svg run package
npm --prefix extensions/vscode-svg run test:vsix
```

普通测试只运行独立解析器。`test:host` 通过官方 `@vscode/test-electron` 启动真实 VSCode，使用临时工作区、配置和扩展目录。macOS 优先使用已安装的官方 VSCode；其他平台从官方站点下载固定版本。可设置 `VSCODE_EXECUTABLE_PATH` 或 `VSCODE_VERSION`。Linux 无图形会话时用 `xvfb-run -a` 运行宿主测试。

`test:vsix` 在临时目录解包 VSIX，确认包中没有 `node_modules` 或开发源码，再让真实 Extension Host 从解包位置激活扩展，验证打包后的大纲和标记功能。运行结果写入仓库 `doc/vscode-host-evidence.json` 与 `doc/vscode-vsix-evidence.json`。

本扩展不连接模型或网络服务；官方测试工具下载编辑器不属于扩展运行行为。测试中的编辑只在示例副本的内存文本中进行。

## 设计与证据

- [职责、模式与验收说明](https://github.com/Resona-02/svg_software_lab1/blob/phase2-complete/doc/vscode.md)
- [Phase 1 复用评估](https://github.com/Resona-02/svg_software_lab1/blob/phase2-complete/extensions/vscode-svg/REUSE.md)
- [文件标记截图](../../docs/images/vscode-svg-badge.png)
- [大纲定位截图](../../docs/images/vscode-svg-outline.png)
- [未保存编辑更新](../../docs/images/vscode-svg-edited.png)
- [不完整 XML](../../docs/images/vscode-svg-incomplete.png)

当前提供 XML 结构导航，不进行完整 SVG 规范校验、CLI 图形编辑或预览；`path`、`defs` 等可作为普通 XML 元素出现在大纲中。DTD 与实体声明不解析，不完整或错误 XML 返回空列表，不向宿主传播解析异常。
