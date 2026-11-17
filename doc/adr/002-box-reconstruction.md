# ADR 002：box 通过可降级 SVG 保存，并保护必要子部件

状态：采用。

## 背景

box 是矩形与文字组成的容器。保存文件必须能被普通 SVG 工具和没有 box 插件的 CLI 阅读；安装插件时又需要保证 box 一定有可操作的内部矩形和文字。

## 决策

box 保存为标准 `g`，附带 `data-kind="box"`，子部件 id 固定派生为 `<id>-rect` 和 `<id>-label`。SVG 编解码器只处理通用 XML 与 Shape 抽象；ShapeFactory 根据已注册 provider 选择重建器，不列举 box 特例。

有匹配 `data-kind` 的 provider 时，由该 provider 校验并恢复领域类型。缺少插件时根据标准标签 `g` 读取，保留属性与全部子节点，降级成普通 Group。降级对象可以按普通 g 编辑；没有 box 的专用 label 语义或 `(box)` 类型标签。继续保存时保留标记，使日后装回插件仍有识别依据，但不保证经过普通分组编辑后仍满足 box 结构。

已安装 box 插件却遇到必要子部件缺失、id 或类型错误时，拒绝整个 read，不制造不完整 box，也不静默修复。重复 id 属于文档全局错误，任何情况下都拒绝读入。EditorSession 只在完整解析成功后替换当前文档，因此失败保留原文档、保存基准和历史。

创建先构造完整子树，再由文档检查整棵新增树的 id。任一派生 id 冲突时，整次 create 失败，不留下半个容器。

必要子部件不能通过 CLI 的 delete、addto、front、back、group 等结构编辑被删除、移走或重排；box 自身可以整体移动和嵌套，ungroup 拒绝 box。领域结构保护由 box 的容器行为与公开约束承担，通用文档编辑调用这些约束，不按类型名称分支。

## 取舍

缺少插件时降级保留普通 SVG 的可用性；有插件时严格校验使后续 fill/label 操作不必处处容忍坏结构。代价是用户需修复损坏文件后才能以 box 读入，而必要子部件的自由重组能力受到限制。

## 验证

覆盖保存后启用/禁用插件读回、完整结构恢复、缺失及错误子部件、重复 id、创建派生 id 冲突、失败 read 保留旧状态，以及所有必要子部件结构编辑的拒绝与历史不变。相关实现：`src/domain/ShapeFactory.ts`、`SvgDocument.ts`、`src/infrastructure/SvgCodec.ts` 和 `plugins/shape-box/`。
