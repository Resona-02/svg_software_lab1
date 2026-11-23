# AI 协作检查与修正记录

本记录按最终可核验的问题组织，不将 AI 生成或“测试相等”本身作为设计正确的证明。

| 检查对象 | AI 初稿或风险 | 实际检查与修正 | 证据 |
|---|---|---|---|
| CLI 插件接口 | 增加名字分支会让每种图形都改核心 | 四个变化轴由核心声明协议，默认类型也注册；box A/B 接入提交均保护核心与旧插件 | extension-proof.md、verify-extension-diffs.mjs |
| 属性部分失败 | 处理器改多个部件后抛错，可能留半个操作 | 每次写前记录局部补偿，唯一命中，失败不走默认处理，不改变 redo | extensions.test.ts、ADR 001 |
| 撤销反馈 | 将插件回调延后到 undo 时求值，可能在文档已恢复后才抛错 | apply 事务内预先求值并校验反馈，只在历史中留字符串 | extensions.test.ts |
| 事务生命周期 | async 或保留的 edit 能在失败回滚后继续写 | 同步处理器契约，返回/失败即关闭，迟到写拒绝 | extensions.test.ts |
| 包解析 | require 条件会漏掉 import-only ESM 包 | 核对官方解析器后支持 node/import 条件，区分顶层缺失与内部依赖失败 | plugin-loader.test.ts、plugin-loading.md |
| CI Git 证据 | 假设演示分支一定有本地引用 | 在干净 clone 复现后支持 origin 远程引用，仍严格校验真实提交 | CI 修复提交与 extension-proof.md |
| VSCode 文件标记 | 只按后缀判断可能误标 folder.svg 目录 | 检查宿主 stat 的普通文件位，真实文件系统测试 | vscode-host-evidence.json |
| 大纲复用 | 编辑器 Shape 树不保留源位置并补 ID | 独立源结构树，复用 XML 依赖，保留无 id 和任意标签 | vscode.md、REUSE.md、outline.test.ts |
| XML 解析容错 | DOM 宽容修复输入可能误导导航 | 显式拒绝不完整结构、裸实体和 DTD，编辑恢复后重新查询 | outline.test.ts、异常截图 |
| VSIX 打包 | node_modules/源码路径可能掩盖漏打依赖 | 单 bundle，解包目录不含开发源码和依赖后再用真实宿主激活 | vscode-vsix-evidence.json |
| DSH API | 最初方案中的接口版本尚未实测 | 固定官方 0.2.2-rc.5，使用真实 Cordis、Tools、Native executor 而非假 ctx | dsh.md、workbench.test.mjs |
| DSH 身份 | 由工具输入 sessionId 可能混淆会话 | 取真实 Agent 身份，每实例 Map，单会话排队，卸载释放 | workbench.test.mjs |
| DSH 导出 | 复用 save 可能清空撤销历史 | export 直接编码而非 save；持久化交给宿主现有文件工具 | workbench.test.mjs、tool-transcript.json |
| DSH 独立安装 | 只在仓库里测试可能漏掉运行依赖 | tgz 在仓库外解压后挂载官方宿主并调用工具 | verify-package.mjs |

课件依据为此前提供的模块设计原则及 Adapter、Decorator、Strategy、Observer。模式用于解释实际协作和变化点；未为凑模式加入额外的 GUI、事件系统、自动布局或第二套历史。完整测试和安装过程由脚本复现，远程结果以仓库 Actions 为准。
