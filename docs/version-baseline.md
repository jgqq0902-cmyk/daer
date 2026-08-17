# Daer 跨层版本基线

> 初始基线采集时间：2026-08-18T01:23:14+08:00
> 用途：记录初始 Git 起点和当前整改工作树版本；本文件不把两个工作区伪装成同一个 Git 仓库。

## 仓库基线

| 层级 | 工作区 | 分支 | 提交 | 远端 | 工作树 |
| --- | --- | --- | --- | --- | --- |
| Godot 客户端与随包 Bridge | `K:\godot\daer` | `codex/audit-remediation-p0` | `382b980005acf3904df983425317a9fe12678d46`（整改代码基线仍为 `ae584ad`） | `https://github.com/jgqq0902-cmyk/daer.git` | 归档前已提交 |
| core 与开发 Bridge 源码 | `E:\project\daer` | `codex/audit-remediation-p0` | `d4f74fae00364f85950dde390be261c2dcdd5445` | 未配置 | 脏工作树：当前 106 个状态项；保留用户改动，未清理/重置/提交 |

`E:\project\daer` 的现有改动属于用户工作内容，本次整改不执行清理、重置、强制覆盖或批量暂存。core 当前没有远端，因此 core 提交只能先通过本地分支和本基线记录追踪。

## Bridge 与协议版本

| 项目 | 当前值 | 来源 |
| --- | --- | --- |
| Godot 协议版本 | `daer-godot-v2` | `K:\godot\daer\scripts\ai_service.gd`、`E:\project\daer\packages\core\scripts\godot-ai-runtime-server.ts` |
| Bridge 运行版本 | `daer-bridge-session-v6` | `K:\godot\daer\bridge\runtime-version.txt`、Bridge 常量 |
| replay 快照版本 | `3` | `E:\project\daer\packages\core\scripts\godot-ai-runtime-server.ts` |
| ruleVersion | `luzhou-daer-rules-v2.4` | `E:\project\daer\packages\core\src\shared\types\game.ts`、新局 `GameState` |
| RuleProfile | 已写入新局状态并冻结为 profile 快照 | `E:\project\daer\packages\core\src\game-engine\game-manager.ts` |

已确认 `runtime-version.txt` 与 Godot/Bridge 常量一致，且 K 包内 bundle 已由当前 core 源码重建。规则版本、协议版本、运行版本和回放 schema 的升级必须在同一整改提交中同步，禁止只改其中一层。

当前 K 工作区的整改代码基线为 `ae584adab58836d8efa9e09111cb99beacd7466e`，最终经审计的 Bridge bundle 同步提交为 `382b980005acf3904df983425317a9fe12678d46`。E:\project\daer 的 core 仍保留用户未提交改动，故 `d4f74fae00364f85950dde390be261c2dcdd5445` 只作为源码起点定位，不能误称为本次整改的干净 core 提交。

## 发布候选哈希

| 产物 | SHA-256 |
| --- | --- |
| `bridge/bridge-server.mjs` | `11355D3A65642060A744861ED4DD892A9915EEC293DF019F3D7BE24310B03F0C` |
| `bridge/runtime-version.txt` | `87A234076E483BA4AFD05F0F2B14FA69ACB4814897F3EEECFC088319EF2D41C3` |
| `build/windows/DaerTraining.exe` | `04BAF75CC1D69DD93EB709533ECAB4FD7770BB8A530645717017A06A9D9809FC` |
| `build/windows/DaerTraining.pck` | `B1BC3D306FEDECBBF986ED6B15188FE93EBB24EE18BFA5578928F9CD68B6949A` |
| `build/windows/bridge/runtime/node.exe` | `56DBD529D1EAA0F59C8F015EA604FE3D505A77EF9592FC4AED8030DC79F1BC14` |

## 生成物隔离

Godot 仓库的 `.gitignore` 排除 `.godot/`、`build/`、`guandan/`、日志、用户状态、归档包和本地 `Godot-MCP-Native` 工具链，但保留运行所需的 `bridge/runtime/node.exe`。

core 仓库当前 `.gitignore` 已补充 `.pnpm-store/`；原有 `node_modules/`、`dist/`、`out/`、`packages/core/artifacts/`、`.daer/` 等规则继续生效。已有被 Git 跟踪的历史生成物未在 WP-0 中删除，避免覆盖用户历史。

## WP-0 验收状态

- [x] 两个工作区均建立 `codex/audit-remediation-p0` 本地分支。
- [x] Godot 工作区已有独立 Git 仓库并可推送到公开远端。
- [x] core 当前分支、提交、脏工作树规模和无远端状态已记录。
- [x] Bridge `runtimeVersion` 与协议版本已交叉核对。
- [x] 本地依赖缓存已加入 core 忽略规则。
- [x] core、Godot、Bridge bundle、ruleVersion 和 replay schema 已在当前整改工作树同步，并已记录 K 提交号和发布候选哈希；core 本身仍需后续从用户脏工作树拆分独立提交。

## 当前整改验证记录

- core：`tsc --noEmit` 通过；完整 Vitest 为 31 个文件通过、1 个明确跳过，242 项通过、1 项跳过；新增的 `TimeoutHandler` 委托回归与响应窗口测试通过，其中 GUO 7、RESP 8、BAO 6、MING 4、meld 4、三人契约 3、RuleProfile 4、Bridge runtime 13 项均通过。
- Godot：`--headless --path K:\godot\daer -- --test` 返回 `GAME_SERVICE_TESTS_PASSED`；移除发布耦合后无 MCP 端口启动错误，仅剩既有 headless RID/ObjectDB 泄漏警告。
- bundled Bridge：v2/v6 smoke 已验证正确/错误/缺失令牌、三人新局、ruleVersion、OPTIONS 404、413 body limit 和无 wildcard CORS；最终根目录 Bridge 与 Windows 包哈希一致。
- Windows Release：安装 Godot 4.7.1 Windows export templates 后，完整 `package-windows-release.ps1` 退出码为 0，生成 EXE/PCK/自足 Bridge；最终包 ASCII 禁止路径扫描命中 0 项。
- 冷启动：在未设置 `DAER_*` 开发覆盖且不调用 pnpm/tsx 的导出进程中，UI 创建三人新局；关闭后随包 `DaerTraining/cmd/node` 进程均清零；重启可恢复 version 3 快照并再次创建新局。详细命令和观察记录见 `docs/verification/2026-08-18-audit-remediation-release.md`。
