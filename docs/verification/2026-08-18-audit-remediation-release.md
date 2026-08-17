# 2026-08-18 审计整改发布验收记录

## 范围与边界

- Godot/K 仓库：`codex/audit-remediation-p0`，最终 Bridge 同步提交 `382b980005acf3904df983425317a9fe12678d46`。
- core/E 工作区：仍是用户脏工作树；本次没有清理、重置、覆盖或提交用户改动。Windows 包按该工作树构建，不能把它描述为干净 core commit 构建。
- Windows export templates：Godot `4.7.1.stable`，已安装到本机导出模板目录；模板归档不进入 Git。

## 自动门禁

| 检查 | 结果 |
| --- | --- |
| `pnpm --dir E:\project\daer\packages\core run type-check` | 通过 |
| 完整 Vitest | 31 文件通过、1 文件明确跳过；241 通过、1 跳过 |
| Godot `--headless --path K:\godot\daer -- --test` | `GAME_SERVICE_TESTS_PASSED`；仅既有 RID/ObjectDB 泄漏告警 |
| `tools/package-windows-release.ps1 -CoreWorkspace E:\project\daer` | 退出码 0，生成 `DaerTraining.exe`、PCK 和自足 Bridge |
| `tools/verify-bundled-bridge.ps1` | v2/v6、3 玩家、ruleVersion、401、OPTIONS 404、413、无 wildcard CORS 全通过 |
| Release 目录禁止标记扫描 | 0 命中：MCP、RuntimeProbe、test runner、E/K 开发路径 |

## Release 冷启动

使用最终 `build/windows/DaerTraining.exe` 启动，父进程环境未设置 `DAER_CORE_WORKSPACE`、`DAER_GODOT_BRIDGE_COMMAND` 或 `DAER_BRIDGE_TOKEN`，程序通过自身 `bridge/daer-ai-server.cmd` 启动同目录 `runtime/node.exe`。

1. 首页点击“开始一局”，牌桌进入正式游戏；画面显示牌山 17 张、玩家 1/2 各 20 张，状态文件记录 `version=3`、`players=3`、`ruleVersion=luzhou-daer-rules-v2.4`，未持久化认证令牌。
2. 关闭程序后检查进程树，`DaerTraining.exe`、其 `cmd.exe` 和随包 `node.exe` 均已退出。
3. 再次启动后 Bridge 恢复活动快照；再次点击“开始一局”可创建新局，随后关闭仍无随包进程残留。

## 最终产物哈希

| 产物 | SHA-256 |
| --- | --- |
| `bridge/bridge-server.mjs` | `11355D3A65642060A744861ED4DD892A9915EEC293DF019F3D7BE24310B03F0C` |
| `bridge/runtime-version.txt` | `87A234076E483BA4AFD05F0F2B14FA69ACB4814897F3EEECFC088319EF2D41C3` |
| `build/windows/DaerTraining.exe` | `04BAF75CC1D69DD93EB709533ECAB4FD7770BB8A530645717017A06A9D9809FC` |
| `build/windows/DaerTraining.pck` | `B1BC3D306FEDECBBF986ED6B15188FE93EBB24EE18BFA5578928F9CD68B6949A` |
| `build/windows/bridge/runtime/node.exe` | `56DBD529D1EAA0F59C8F015EA604FE3D505A77EF9592FC4AED8030DC79F1BC14` |
