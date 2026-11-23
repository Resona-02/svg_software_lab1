# Phase 1 解析、模型和遍历的复用评估

大纲需要展示当前编辑缓冲区中的所有 XML 元素，并将每个节点定位到原始源码。Phase 1 的 `SvgCodec` 负责可编辑模型的完整读入：只接受已注册图形类型、全局唯一且可补齐的 id，构造几何对象，隐藏 XML 表示。它不保留源码范围，也会拒绝 `defs`、`path` 等尚未注册的 SVG 类型。直接复用会把编辑器展示需求强行限制为 CLI 能编辑的子集；自动补 id 也不能当作用户文本中原有的 id 展示。

因此复用已有的 `@xmldom/xmldom` XML 依赖及其严格 `onError` 失败处理方式，独立用 `SvgOutlineParser` 输出轻量、只读的 `OutlineNode`。DOM 用于验证 XML、解码 id 和提供可靠的元素顺序；源码扫描仅记录范围，不自行解释实体或几何。扫描区分注释、CDATA、处理指令与带引号的属性，位置直接采用 JavaScript 的 UTF-16 索引，与 VSCode 的 `TextDocument.positionAt` 一致。DTD/实体声明在 DOM 构造前拒绝。编辑未完成时返回空大纲，下一次查询从当前文本重新解析。

Phase 1 的 Composite 遍历思想可以复用：父节点包含有序子节点，深度优先映射成原生 DocumentSymbol 树。但不引入 `SvgDocument`/`Shape` 的可编辑字段、撤销和插件装配依赖。大纲没有修改文档的职责，轻量树避免暴露不需要的业务接口。

这种选择把 XML 语法与源位置知识留在解析模块，把 VSCode API 类型和 UI 映射留在 provider，两个模块通过普通数据协作。它不是为了“代码复用率”抽出可配置的万能 XML 引擎，也不让 CLI 与 VSCode 同时理解对方的表示细节。

XML API 核对依据：[xmldom 官方仓库](https://github.com/xmldom/xmldom)及项目锁定版本 0.9.12 的类型声明。独立测试覆盖嵌套、无 id、内容更新、不完整 XML、源码定位、CRLF、Unicode、命名空间、特殊标记与声明拒绝。
