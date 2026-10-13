# pi-background-tasks 移植评估

结论：适合后续作为独立、可关闭的后台 shell 插件接入。此次已完成评估，未移植该插件。

调查版本：[799182ff](https://github.com/ismailsaleekh/pi-background-tasks/tree/799182ff65d7040732aea23b2001ea860b688531)。许可证为 ISC；复制源码须保留版权行与完整许可。本文基于源码调查，不代表跨平台运行验证。

## 与当前功能的区别

当前 Subagent 插件执行独立模型会话，Todo 插件记录工作计划。后台 shell 插件适合开发服务器、watcher、长检查和命令日志，是另一类生命周期，不应混用任务状态或用量统计。

上游包含的不只是 shell：还有 delegate、Fusion、attestation、认证请求改写和底部 dock。直接整包接入会重复子代理职责，与 `/tasks` 命令冲突，并重新在底部加入用户要求放到右侧的任务入口。

## 值得复用的能力

- `bg_run` 立即返回 ID、PID 和日志位置。
- `bg_status` 查询状态，`bg_logs` 有界读取头尾，`bg_kill` 停止进程树。
- stdout / stderr 落盘；默认累计输出上限为 20MiB，超过上限停止任务。
- 超时、取消与重跑，结束后通知用户，可选择唤醒模型。
- POSIX 进程组 TERM 后升级到 KILL；Windows taskkill 进程树处理。
- 先关闭日志、保存终态再发通知。

源码参考：[工具入口](https://github.com/ismailsaleekh/pi-background-tasks/blob/799182ff65d7040732aea23b2001ea860b688531/src/extension.ts)、[Registry](https://github.com/ismailsaleekh/pi-background-tasks/blob/799182ff65d7040732aea23b2001ea860b688531/src/core/registry.ts)、[Shell policy](https://github.com/ismailsaleekh/pi-background-tasks/blob/799182ff65d7040732aea23b2001ea860b688531/src/core/shell-policy.ts)。

## 推荐范围与适配点

若后续实施，第一版只接入四个 shell 工具、日志、超时取消、完成通知与会话关闭清理。通过 `setWidget(..., { placement: "sidebar" })` 提供右侧 Jobs 区域；不用上游底部 dock 和 `/tasks`，可以使用 `/jobs`、`/logs`、`/kill`。

优先复用 pi-ext 既有 shell、进程树清理和输出管理：`src/core/tools/bash.ts`、`src/utils/shell.ts`、`src/utils/child-process.ts`、`src/core/tools/output-accumulator.ts`。运行数据使用 `~/.pi-ext`，不沿用项目 `.pi/tasks`。

## 边界

- Shell 命令继承用户权限及环境，后台执行不是沙箱；必须保留已有沙箱与工具权限接入。
- 上游 Windows 默认 cmd，与 pi 的 bash / PowerShell 策略不同，需要适配。
- 跨同进程 reload 保活只支持明确启用的普通 shell；不等于进程重启、崩溃后的恢复。
- 子进程继承 stdout / stderr 可能延迟 close，须沿用本仓库的管道空闲收尾机制。
- 普通日志未做 fsync，不能宣称日志具有断电级持久性。
- 不纳入 Fusion、delegate、attestation、认证改写或 reload 保活，避免扩大本次开发范围。
