# 插件加载边界

`src/host/PluginLoader.ts` 只负责解析、加载和报告错误，不包含任何具体插件名称或注册名称映射。代码装配和配置装配最终都调用 `ExtensionRegistry.activate`，共用暂存、清单校验及原子提交；当前插件失败不会删除先前成功插件的注册，也不会阻止后续插件加载。

配置文件的相对模块路径以配置文件所在目录为基准。相对路径指向插件目录时，按目录内 `package.json` 的 `main` 定位入口；也可指向具体文件。裸包名通过 `import-meta-resolve@4.2.0` 的标准 ESM `moduleResolve` 算法定位，以配置文件目录为解析起点，支持 `exports` 的 `import` 条件和包子路径，随后由 Node 的动态 `import()` 执行同一个入口。解析使用标准 `node` / `import` 条件，**不支持自定义 loader 或 `--conditions` 条件**。增加这项运行依赖是为了正确支持仅声明 `exports.import` 的 ESM 插件，而非手写或硬编码包入口规则。

每个包的真实 `package.json` 提供 `name` 和 `contributes`。代码装配直接导入同一个 JSON 清单；配置装配读取包清单。`options` 原样作为第二个参数传入 `activate(context, options)`。缺省的贡献类别为空，比较四类注册名称的集合，已提交注册保留实际注册顺序。

只有入口解析阶段的模块缺失报告 `plugin not found`。入口已找到，但求值失败、内部依赖缺失或激活抛错，均报告 `plugin failed to activate`；缺少默认导出、清单不匹配与重复注册分别使用作业规定的错误信息。错误统一为一行并继续启动。配置结构会在任何可选插件激活前整体校验；非法配置报告 `error: invalid plugin config`，保留默认内置能力。

注册上下文只在本次 `activate` 完成前有效；完成或失败后继续调用注册方法会报错。同类名称重复会使整个插件失败，即使插件自己捕获了注册异常，也不能提交其他暂存注册。插件是同进程受信任代码，暂存事务约束的是注册行为，不是操作系统沙箱。

验证见 `test/plugin-loader.test.ts`：包括四类加载失败、重复与回滚、A/B 一致性、顺序和 options、禁用插件、非法配置、配置目录相对路径、普通包、仅 import 导出的 ESM 包及内部依赖失败分类。
