# 变更记录

## 0.1.1

修复：「立即重启」在 DSH Desktop 上点了没反应。

- 原因：宿主用 `spawn(..., { detached: true })` 拉起的 PowerShell 会在宿主所属的 job 对象被回收时一起被杀掉 —— 实测能拿到 pid，但子进程来不及执行任何动作（写标记文件的测试没留下任何文件）。
- 改法：客户端改为优先调用 DSH Desktop 自带的有序重启接口 `POST /api/desktop/restart`（与设置页右上角「重启」同一机制）。插件自己的 `/dsh-mcp-panel/restart` 降级为回退路径，改用 `schtasks` 调度 —— 计划任务由任务计划服务托管，不受宿主 job 对象影响。
- 兼容性：`/dsh-mcp-panel/state`、`/dsh-mcp-panel/toggle` 的契约不变。

## 0.1.0

首个版本。

- 设置 → 插件 →「MCP 开关」：列出 patch 里所有 `@deepseek-ai/dsh-mcp-client` 条目，逐个启停。
- 启动快照 `<profile>/.mcp-panel-applied.json`，用于区分「配置已改」与「已生效」，并给出待重启横幅。
- 行级改写 `cordis.patch.yml`：只动 `disabled` 行，其余字节不动（往返改写逐字节一致）。
- 使用流程截图与 Edge 远程调试说明。
