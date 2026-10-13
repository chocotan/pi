# pi-ext 原生任务与子代理接入计划

状态：已按随包、可关闭和替换的内置插件方式实现。用法见 `packages/coding-agent/docs/pi-ext.md`；完整验收说明见 `docs/design/pi-ext-verification.md`。

## 产品目录

产品名为 `pi-ext`，默认全局配置和运行数据根目录为 `~/.pi-ext`。项目配置使用 `<cwd>/.pi-ext`，实际项目工作目录仍由当前会话的 cwd 决定。

配置接入点为 `packages/coding-agent/package.json` 的 `piConfig` 与 `packages/coding-agent/src/config.ts`。派生目录环境变量应使用合法 shell 名称 `PI_EXT_CODING_AGENT_DIR`、`PI_EXT_CODING_AGENT_SESSION_DIR`。全局目录改动需要覆盖配置帮助、SDK 默认值、测试与源码运行/测试脚本中的硬编码路径。

不自动读取或迁移原 `~/.pi` 中的凭据、扩展和会话，避免与现有 pi 安装混用。

## 原生接入

沿用 CLI 随包加载的 `builtin:<name>` 模块机制，入口为 `packages/coding-agent/src/extensions/index.ts`。无需用户安装额外 npm 扩展。是否启用、工具筛选和冲突检测继续走现有设置与资源加载器。

SDK 应提供相同的工厂及结构化类型导出，明确默认加载行为。工具必须在 print、JSON、RPC 和交互模式中可用；展示层复用已有 transcript 渲染和状态栏。

## Todo

- 创建、列出、读取、更新任务。
- 状态为 pending、in_progress、completed，支持明确删除。
- 状态保存在会话 custom entries 或工具 details 中，按活动分支重建。
- 暂停、重新打开、分支切换和上下文压缩后保持正确状态。
- `/todos` 或 `/tasks` 查看完整任务；输入区显示完成数和当前任务摘要。
- 更新必须明确报告不存在的 ID 和非法字段，不能只在成功结果文本中写错误。
- 优先保持会话内任务，不在第一版引入跨进程共享任务数据库。

## Subagent

- 从 `~/.pi-ext/agents/*.md` 和可信项目 `.pi-ext/agents/*.md` 发现代理定义。
- Markdown 正文是代理指令，frontmatter 描述 name、description、tools、model、thinking 等支持字段。
- 提供代理列表、前台执行、后台启动、状态/结果查询和取消。
- 子代理有独立上下文、标识、执行状态和可查看记录；模型默认继承父会话。
- 工具白名单不能扩大父会话已经限制的能力，不能绕过 sandbox 或 tool_call 权限钩子。
- 项目代理定义必须纳入项目 trust 检查；未获信任时不执行项目代理。
- 不允许默认无限递归派生代理，限制同时运行数量并明确报告超限。
- 前台取消跟随当前调用，后台生命周期归属当前会话，关闭/重载/切换会话时正确收尾。
- 已结算结果通知父会话，结果截断时保留全文位置；用量计入会话且不重复累计。

现有 `examples/extensions/subagent/` 可参考定义发现、模型继承和结果渲染，但它基于外部 `pi` 子进程，不能直接照搬为可靠的原生生命周期管理。

## 参考项目与接口

调查基线为 [pi-tasks 29180d7](https://github.com/tintinweb/pi-tasks/tree/29180d72498bdd77d5601dc77a9093d25da42102) 和 [pi-subagents e819a82](https://github.com/tintinweb/pi-subagents/tree/e819a82ae364a2b0432881b89b0c784b413a88c1)。参考机制包括任务更新、独立 AgentSession、并发槽位、完成通知和全文结果记录。

任务工具采用 `TaskCreate`、`TaskList`、`TaskGet`、`TaskUpdate`；代理工具采用 `Agent`、`get_subagent_result`、`steer_subagent` 和停止操作。任务委派提供 `TaskExecute`、`TaskOutput`、`TaskStop`，统一维护 taskId 与 agentId 的对应关系，避免任务列表和代理状态各说各话。

停止代理不能自动把任务标为 completed；保留未完成任务，并在代理记录中明确 stopped。依赖功能若纳入实现，拒绝自依赖和依赖环，而非只给警告。第一版不包含确定性 workflow、定时调度或自动提交 worktree。

两库均使用 MIT 许可证；若复制实质源码，分发中必须保留作者版权和完整许可证。产品重命名不替代上游作者归属。

## 验证

使用本地 faux provider，测试任务分支恢复、无效更新、子代理模型继承、工具限制与信任、前台/后台状态、取消、关闭和失败传播。不调用真实提供方。

代码变更完成后运行定向测试和 `npm run check`。UI 设计确认后，按终端交互测试技能检查中文输入法、自动补全、宽度切换和原有快捷键。
