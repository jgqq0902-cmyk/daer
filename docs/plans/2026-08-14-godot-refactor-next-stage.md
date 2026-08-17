# Godot 重构收尾 Implementation Plan

> **2026-08-15 更正：** 运行中的固定牌局已证明多玩家响应调度未从原 Web 前端完整迁入 Bridge/core；“Godot 三人局、响应主链路已完成”的历史结论被新的运行证据推翻。规则流程当前按 P0 未闭环处理，修订方案见 `docs/plans/2026-08-15-game-flow-rules-completion.md`。在该方案的固定响应 fixture 全部通过前，不进入本文件的发布候选验收。

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 Godot 重构从“主要功能已迁移”推进到“可重复验收、可独立导出、可交付”的 Windows 发布候选。

**Architecture:** 正式牌局继续由 `@daer/core` 作为唯一状态与规则来源，Node/TS Bridge 提供版本化 HTTP/JSON 契约，Godot 只负责表现、输入和本地 UI 状态。收尾阶段不新增规则或 AI 功能，优先关闭最新源码联调、独立打包和跨层门禁。

**Tech Stack:** Godot 4.7.1、GDScript、Node.js/TypeScript、`@daer/core`、Vitest、PowerShell、gdmcp。

---

## 2026-08-14 进度审计

| 模块 | 状态 | 本轮证据 |
| --- | --- | --- |
| core/Bridge 单一规则源与动作守卫 | 已完成 | core type-check 通过；Bridge/action-guard 13 项测试通过 |
| Godot 三人局、牌桌、响应、AI、回放与恢复 | 已完成主链路 | `--test` 输出 `GAME_SERVICE_TESTS_PASSED`；架构文档已有 64 项实施/验收记录 |
| 新手牌布局、暗搭子、自由拖动与中心出牌 | 已实现，待最新运行时视觉复验 | headless validator 通过；本轮未连接编辑器/MCP，未产生新的截图证据 |
| Bridge 独立 sidecar | 已完成 | `build/bridge-*-check/bridge` 包含 Node、bundle 与启动脚本；既有独立健康检查记录 |
| Windows 完整导出 | 未完成，P0 | 本机 export templates 数量为 0；只有 `-SkipGodotExport` 产物 |
| 实时编辑器观测 | 本轮未执行 | 无 Godot 进程、无 9080 监听，gdmcp 返回 `SERVICE_UNREACHABLE` |
| 源码可审计性 | 有风险 | `K:\godot\daer` 当前不是 Git 仓库，无法按提交/diff 复核进度与回滚 |

结论：功能重构处于收尾阶段，核心玩法链路基本完成；发布就绪度仍受完整 Windows 导出、最新 UI+Bridge 可视化复验和缺少版本控制基线影响。审计估算为“功能迁移约 85%，交付就绪约 65%”，该估算不替代下面的发布门禁。

### Task 1: 建立可审计基线

**Files:**
- Modify: `docs/godot-daer-architecture.md`
- Create: `docs/plans/2026-08-14-godot-refactor-next-stage.md`
- Review: `PROJECT_RULES.md`

**Step 1: 确认版本控制边界**

确认 Git 根目录应为 `K:\godot\daer` 还是上级统一仓库。未经确认，不执行 `git init`，也不把 `build/`、`.godot/` 或参考工程误纳入源码。

**Step 2: 建立基线后检查范围**

Run: `git status --short --branch`

Expected: 能列出 Godot 源码、资源和文档差异；生成目录已被忽略。

**Step 3: 重跑快速门禁**

Run:

```powershell
& 'K:\godot\Godot_v4.7.1-stable_win64_console.exe' --headless --path 'K:\godot\daer' --editor --quit
& 'K:\godot\Godot_v4.7.1-stable_win64_console.exe' --headless --path 'K:\godot\daer' -- --test
pnpm --dir 'E:\project\daer\packages\core' run type-check
pnpm --dir 'E:\project\daer\packages\core' exec vitest run __tests__/godot-ai-runtime-server.test.ts __tests__/godot-action-guard.test.ts
```

Expected: Godot 扫描退出码 0，离线测试打印 `GAME_SERVICE_TESTS_PASSED`，core type-check 通过，13 项 Bridge 测试通过。

### Task 2: 使用最新源码完成 Godot + Bridge 联调

**Files:**
- Verify: `scripts/ai_service.gd`
- Verify: `scripts/main.gd`
- Verify: `bridge/daer-ai-server.cmd`
- Verify: `E:\project\daer\packages\core\scripts\godot-ai-runtime-server.ts`

**Step 1: 重建独立 sidecar**

Run:

```powershell
& '.\tools\package-windows-release.ps1' -CoreWorkspace 'E:\project\daer' -SkipGodotExport -OutputDirectory 'K:\godot\daer\build\bridge-release-candidate'
```

Expected: `bridge/runtime/node.exe`、`bridge/bridge-server.mjs` 和 `bridge/daer-ai-server.cmd` 同时存在。

**Step 2: 清理验证边界**

确认每个 Godot 游戏实例只连接自身会话 Bridge；不要复用历史 `48152/48162/48163` 服务。记录 `/health` 的 `protocolVersion`、`runtimeVersion`、`sessionId` 和 `activeGame`。

**Step 3: 启动编辑器观测**

Run:

```powershell
.\.gdmcp\bin\gdmcp.exe --json doctor
.\.gdmcp\bin\gdmcp.exe --json editor state
.\.gdmcp\bin\gdmcp.exe --json debug logs --level Error --limit 50
```

Expected: gdmcp 连接到唯一编辑器服务；日志无新的 GDScript 解析或运行错误。

**Step 4: 固定种子验收主流程**

验证新局固定为 3 名玩家、每人 20 张牌；完成玩家出牌、响应、AI 连续推进、终局、回放、Bridge 重启恢复。每个动作必须来自当前 `availableActions`，回放 state 与 `/api/game/state` 一致。

**Step 5: 验收最新手牌交互**

验证 `handPresentation.lockedHandMelds` 生效；暗搭子不可选择/拖动且处于同一组合轨道；手牌始终保持组合状态；仅把当前合法弃牌拖入中心区才提交动作；旧 Bridge 缺字段时的兼容降级不能作为本步骤通过证据。

### Task 3: 完成 Windows 独立导出

**Files:**
- Verify: `export_presets.cfg`
- Verify: `tools/package-windows-release.ps1`
- Output: `build/windows/DaerTraining.exe`
- Output: `build/windows/bridge/`

**Step 1: 安装匹配模板**

安装 Godot 4.7.1 Windows export templates，并确认 `%APPDATA%\Godot\export_templates` 下出现匹配版本目录。

**Step 2: 执行完整打包**

Run:

```powershell
& '.\tools\package-windows-release.ps1' -CoreWorkspace 'E:\project\daer' -OutputDirectory 'K:\godot\daer\build\windows'
```

Expected: 生成 `DaerTraining.exe` 和自足的 `bridge/`，命令退出码为 0。

**Step 3: 验证无开发环境依赖**

在未设置 `DAER_CORE_WORKSPACE`、不调用 pnpm/tsx 的新进程中启动 `DaerTraining.exe`。Expected: 同目录 sidecar 自动启动，健康版本匹配，状态文件写入 `%LOCALAPPDATA%\DaerTraining\bridge`，能够完成并恢复一局。

### Task 4: 完成桌面视觉与交互验收

**Files:**
- Verify: `scripts/main.gd`
- Verify: `docs/hand-interaction-ui-plan.md`
- Record: `docs/godot-daer-architecture.md`

**Step 1: 多分辨率检查**

在 1280x720、1024x640 和可调整窗口分别检查：两名 AI 位于左上/右上，玩家区与行动台不重叠，中心目标牌和响应按钮无需滚动即可使用。

**Step 2: 交互边界检查**

验证鼠标拖动、Enter 出牌、Space 过牌、Esc 取消、吃/碰/招/胡多选项、AI 建议选牌和弹层关闭。Expected: UI 不生成服务未声明的动作，过期/伪造卡牌 ID 被拒绝。

**Step 3: 保存证据**

记录 Godot 版本、Bridge 健康版本、固定 seed、操作步骤、结果与截图路径；失败项保留错误日志和复现步骤。

### Task 5: 处理非阻塞技术债务

**Files:**
- Investigate: `addons/godot_mcp/`
- Refactor later: `scripts/main.gd`
- Test: `scripts/test_runner.gd`

**Step 1: 定位 headless 退出泄漏**

Run: `& 'K:\godot\Godot_v4.7.1-stable_win64_console.exe' --verbose --headless --path 'K:\godot\daer' --editor --quit`

Expected: 区分 Godot/MCP 插件退出清理告警与项目资源泄漏；在根因明确前不做修复。

**Step 2: 延后拆分主脚本**

仅在 Tasks 1–4 全部通过后，为 `scripts/main.gd` 制定独立 TDD 重构计划。先将现有 debug validators 固化为行为测试，再逐块抽离牌桌、手牌交互、弹层和回放职责；每次只移动一个职责并重跑 headless 测试。

## 2026-08-14 状态同步修复进度更新

| 工作项 | 状态 | 证据 |
| --- | --- | --- |
| 新局响应丢失后 UI/Bridge 脱节 | 已修复 | `AIService.new_game()` 同 generation 单次 `/api/game/state` 回读；不重发 `/api/game/new`。 |
| 旧 sidecar 被误接入 | 已完成会话化修复 | core 与 Godot 升级 `runtimeVersion=daer-bridge-session-v4`；健康检查同时校验 `sessionId`，不再复用旧端口实例。 |
| Task 2 / 最新源码联调 | 本轮完成生命周期闭环 | `build/bridge-session-lifecycle-v4/bridge` 健康检查为 v4；停止 Godot 后 Bridge 与端口自动退出，重启后生成新会话并恢复权威状态。 |
| 手牌组合交互 | 已完成 | 暗搭子进入手牌组合轨道，拖动非中心落点恢复组合，理牌不改变牌面尺寸；Godot 离线回归通过。 |
| Task 3 / Windows 独立导出 | 未完成 | 本轮仅执行 `-SkipGodotExport` sidecar 构建；仍需安装 export templates 并验证独立 exe。 |
| P1 可观测性 | 待办 | 为 `_request()` 增加 HTTP result/status/body length 诊断，并用可控的截断响应做端到端回归。 |

### 本轮验收命令与结果

```powershell
pnpm --dir packages/core test -- __tests__/godot-ai-runtime-server.test.ts
& 'K:\godot\Godot_v4.7.1-stable_win64_console.exe' --headless --path 'K:\godot\daer' -- --test
pnpm --dir packages/core run type-check
& '.\tools\package-windows-release.ps1' -CoreWorkspace 'E:\project\daer' -OutputDirectory 'K:\godot\daer\build\bridge-session-lifecycle-v4' -SkipGodotExport
```

结果：core Bridge 测试 9/9 通过；core type-check 通过；Godot 离线测试输出 `GAME_SERVICE_TESTS_PASSED`；v4 sidecar `/health` 返回 `protocolVersion=daer-godot-v1`、`runtimeVersion=daer-bridge-session-v4` 与本次 `sessionId`。临时 Godot 实例关闭后对应 Bridge 进程和监听端口消失；下一次启动创建新会话并从新的 Bridge 获取权威状态。

## 完成定义

- Godot headless 扫描、离线测试、core type-check 和 13 项 Bridge 测试全部通过。
- 最新 Bridge 与 Godot UI 完成固定种子端到端验收，状态、动作和回放一致。
- Windows 导出包无需 E 盘工作区、pnpm 或 tsx 即可冷启动并恢复对局。
- 1280x720、1024x640 和可调整窗口的主流程无阻塞性布局问题。
- 验收结果、已知告警和失败复现均写入日期化文档。
