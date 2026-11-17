# box 插件

通过同一个 PluginContext 注册 `box` ShapeProvider、`box-attributes` AttributeHandler 和 `box-type-label` TreeDecorator。仅引用 `src/api/index.ts` 的公开接口。

```text
create box n1 120 100 160 60 "开始"
set n1 fill #f5a623
set n1 label "处理数据"
move n1 0 100
undo
```

必需的直接子部件为 `<id>-rect`（rect）和 `<id>-label`（text）。默认矩形填充 `#4a90d9`，文字位置为 `(x+20,y+35)`，`options.fill` 可覆盖默认填充。整体节点支持 `in`、嵌套、移动、分组、层叠顺序、删除与撤销；`ungroup` 拒绝。允许额外子节点，禁止普通 CLI 命令删除、移走、分组或重排两个必要子部件；它们的几何与文字仍可单独编辑。

`fill` 和 `label` 通过受限属性事务写入内部子部件，每条 set 一个 undo 单元。默认属性处理仍用于其他属性；普通 rect 不接受 label。

保存为带 `data-kind="box"` 的 `<g>`。有插件时，必要部件缺失或类型错误拒绝整个读入；无插件时保留数据并降级为普通 g。全局重复 id 一律拒绝，创建时包括衍生 id 的冲突也不会留下半个 box。

树标签仅追加 `(box)`，不认识 `modified-star`。dirty 标签另由 tree-star 插件提供。

构建后可独立运行测试：`node --test dist/test/box-plugin.test.js`。测试含空上下文的独立激活，以及公开接口的 CLI/SVG 集成。
