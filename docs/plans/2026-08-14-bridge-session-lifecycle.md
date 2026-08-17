# Godot Bridge 会话生命周期修复

状态：已完成（2026-08-14）

## 目标

保证一次 Godot 运行只连接并拥有一套 Bridge：关闭 Godot 后 Bridge 自动退出；再次运行时启动新的 Bridge 会话，前端只接受该会话的权威状态。

## 方案

1. Godot 用自身 PID 与启动时钟生成会话 ID，并从私有端口段选择本会话端口。
2. `AIService` 不再探测或复用历史 `48162/48163` 服务；健康检查同时校验协议、运行时版本和会话 ID。
3. Godot 启动 Bridge 时传入 `DAER_GODOT_SESSION_ID` 与 `DAER_GODOT_PARENT_PID`。
4. Bridge 的 `/health` 回传会话 ID，并每秒检查父 PID；父进程消失后优雅关闭服务。
5. 保留现有本地续局日志：重启后由新的、同会话绑定的 Bridge 重放日志，避免“新前端连旧内存状态”。

## 验收

1. 单元测试覆盖健康检查会话 ID 与父 PID 失活判定。
2. Godot 无界面测试覆盖会话端口、环境变量与手牌交互回归。
3. 用新打包的 Bridge 启动 Godot，记录健康检查中的 PID/会话 ID。
4. 停止 Godot 后确认该端口停止监听；再次启动后确认 PID、端口或会话 ID 为新值，且前后端状态一致。

## 实施结果

- Bridge 运行时升级为 `daer-bridge-session-v4`；`/health` 返回 `sessionId`，core 单元测试覆盖会话字段和父 PID 失活判定。
- Godot 不再探测或复用 `48162/48163`。每次运行使用私有端口段的会话端口，并在收到非 JSON HTTP 响应时切换候选端口；本机健康请求超时固定为 3 秒。
- 实机验证：Godot 工作进程 `70308` 启动 Bridge `192076`，健康检查返回 `sessionId=godot-70308-933761`、端口 `50340`；停止该 Godot 后 Bridge 进程和端口均消失。随后冷启动探针成功连接新会话 `godot-82136-920855`、端口 `49880`，正常退出后同样无残留 Bridge。
- 保留续局日志；重启时由新的 Bridge 重放权威状态，而不是让新 UI 接入旧进程的内存状态。
