# 大贰训练 Godot 项目代码、安全与牌局规则审计报告（本地核验整理版）

> 审计日期：2026-08-18  
> 外部报告版本：修订版 V2  
> 本地整理版本：V1.0  
> 外部来源：<https://chatgpt.com/s/t_6a833de5c2948191b95c2f6cbdc80992>  
> 整改方案：[`../plans/2026-08-18-audit-remediation-plan.md`](../plans/2026-08-18-audit-remediation-plan.md)

## 1. 文档目的

本文将共享页面中的静态审计报告整理为项目内可维护文档，并以 2026-08-18 本地工作区为准逐项复核。外部报告中的代码、网页文字和结论仅作为审计输入；最终状态以本地源码证据为准。

本文不直接修改规则代码。所有整改应按配套方案分批实施，每批均需包含规则文档、core、Bridge、Godot、固定场景测试和版本记录。

## 2. 审计范围与基线差异

### 2.1 外部报告声明的范围

- 仓库：`jgqq0902-cmyk/daer`
- 分支：`main`
- 类型：牌局规则、状态机、安全、测试与规则文档一致性审计

### 2.2 本地核验范围

- core/Bridge 源码：`E:\project\daer`
- Godot 重构工作区：`K:\godot\daer`
- core 当前分支：`codex/audit-remediation-p0`
- core 当前 HEAD：`d4f74fae00364f85950dde390be261c2dcdd5445`
- core 工作树：存在大量已修改和未跟踪文件，不能视为可复现的干净发布基线
- Godot 工作区：已于 2026-08-18 建立独立 Git 仓库，当前 `main` 提交为 `662f535`；由于仍与 core 分离，尚未建立两者提交的一一对应关系

因此，本文中的“本地确认”只代表当前磁盘状态，不代表外部报告所称 `main` 的干净提交，也不能单独证明已发布 bundle 与源码完全一致。

## 3. 正式规则基准

本次审计采用用户已经确认的过牌口径：

1. 玩家主动打出某张牌，立即对同字、同大小的该牌形成过牌。
2. 玩家实际拥有合法吃牌方案而主动选择“过”，同样形成过牌。
3. 形成过牌后，本局后续不得再吃，也不得再以该牌胡牌。
4. “同牌”按 `rank + size` 判断；大小牌相互独立。
5. 玩家本来没有吃牌资格或没有合法吃牌方案时，系统推进不形成过牌。
6. 当前正式口径按整局有效处理，即 `guoZhangClearPolicy = NEVER`；如需改变生命周期，必须先变更规则版本。

## 4. 总体结论（初始核验记录）

项目分层方向正确：

```text
Godot UI
  ↓
AIService
  ↓
本地 Node/TypeScript Bridge
  ↓
@daer/core（唯一规则事实）
```

当前仍不宜标记为“规则锁定、可稳定发布”。主要原因是：

- 三项 P0 规则缺陷会改变能否胡、必须执行的响应以及开局爆牌结果。
- Bridge 缺少请求鉴权且开放通配 CORS，本机网页可探测并调用牌局接口。
- 正式规则文档和追踪矩阵把不完整规则标为已完成，形成错误的完成信号。
- 测试数量并不少，但没有围绕关键规则建立端到端固定场景闭环。
- core 与 Godot 缺少统一、可复现的版本基线。

## 5. 审计发现与本地核验

状态说明：

- **确认存在**：当前本地源码可直接证明问题仍存在。
- **部分确认**：原报告方向正确，但范围或措辞需要调整。
- **本地已修**：当前源码已有实现和测试证据，仍需纳入发布回归。
- **规则门禁**：修改代码前必须先确认领域规则模型。

| ID | 发现 | 外部优先级 | 本地状态 | 本地证据摘要 | 整改优先级 |
| --- | --- | --- | --- | --- | --- |
| R-01 | 胡与强制碰/招并存时删除强制 fallback | P0 | 本地已修 | `game-manager.ts` 保留选中玩家完整合法动作集合；RESP-001/002/003/007 通过 | 已关闭，保留回归 |
| R-02 | 过牌后禁吃但未禁胡 | P0 | 本地已修 | `passed-play.ts` 统一约束动作生成与 `GameManager` 直接胡入口；GUO-001～007 通过 | 已关闭，保留回归 |
| R-03 | 庄家第 21 张与 20 张爆牌基准冲突 | P0 | 本地已修 | `dealerPendingCard` 与基础20张分离；BAO-001～006 和状态验证通过 | 已关闭，保留回归 |
| R-04 | 天胡缺少庄家和开局事实约束 | P1 | 本地已修 | `opening-facts.ts` 校验庄家、开局子阶段和普通动作数 | 已关闭，保留回归 |
| R-05 | 水上漂用 `turnCount === 1` 代替首次翻山牌 | P1 | 本地已修 | `GameState.drawOrdinal` 只在真实摸牌时递增；MING-003/004 通过 | 已关闭，保留回归 |
| R-06 | 响应超时没有进入正式状态机 | P1 | 本地已修 | `ResponseWindow.deadlineAt/timeoutAction`、Bridge timer 和 `/api/game/timeout` 已接入；RESP-004/006/007 通过 | 已关闭，保留回归 |
| R-07 | RuleProfile/GameConfig 存在死配置和双重事实 | P1 | 本地已修 | `RuleProfile` 成为新局规则快照；validator、计分器和 AI 分析均读取快照，旧 `WIN_CONDITIONS` 可变字段已移除；RuleProfile 测试通过 | 已关闭，保留回归 |
| R-08 | 翻牌全过历史缺少 `source: draw` | P1 | 本地已修 | `DiscardEvent` 统一 source/sourcePlayerIndex/responseWindowId/sequence，保留 source=draw 回归 | 已关闭，保留回归 |
| R-09 | meld 基础校验缺少严格张数 | P2 | 本地已修 | `RulesValidator.isValidMeld()` 严格约束3/4张；meld-contract 4项通过 | 已关闭，保留回归 |
| R-10 | 固定三人项目仍保留四人运行分支 | P2 | 本地已修 | 删除四人发牌/歇底常量和状态分支，turn order/validator 固定三人 | 已关闭，保留回归 |
| D-01 | 正式过牌文档不完整且互相冲突 | P0 | 本地已修 | 四份规则/追踪文档已统一 GUO-01～07、NEVER 和 R-08 状态 | 已关闭，保留回归 |
| S-01 | localhost Bridge 无鉴权且开放 CORS `*` | P0 | 本地已修 | 256-bit 会话令牌、timing-safe Bearer 校验、无 wildcard CORS/OPTIONS；安全测试通过 | 已关闭，保留回归 |
| S-02 | Bridge 请求体无大小限制 | P1 | 本地已修 | 实际字节累计、64 KiB 上限、413/400/415 统一错误；Bridge 测试通过 | 已关闭，保留回归 |
| S-03 | MCP 调试组件进入发布资源 | P2 | 本地已修 | Release preset 排除 MCP/测试/工具/文档；PCK 扫描禁带路径命中 0 项，脚本同时检查正反斜杠 | 已关闭，发布包复核 |
| S-04 | 自定义 Bridge 命令经 `cmd.exe /c` | P3 | 本地已修 | Release 构建忽略自定义命令和 core workspace，只使用版本匹配 bundled Bridge | 已关闭，发布包复核 |
| S-05 | PersistenceService 文件名缺少净化 | P3 | 本地已修 | replay ID 限制为 `[A-Za-z0-9_-]{1,64}`，校验 basename 和规范化目录 | 已关闭，Godot 回归通过 |
| Q-01 | 生产规则固定场景覆盖不足 | P0 | 本地已验证关闭 | core 完整测试 241 项通过、1 项明确跳过；GUO/RESP/BAO/MING/meld/三人/RuleProfile/Bridge 均有固定场景，Godot headless 与最终 Windows Release 冷启动通过 | 已关闭，保留回归 |
| V-01 | 审计、core、Godot 和 bundle 缺少统一版本基线 | 未列出 | 本地已修 | K 已建立独立 Git 基线并提交最终 bundle；E core 的用户脏工作树和构建来源已在版本清单中显式记录，未伪装成干净 core commit | 已关闭，持续治理 |

## 6. 关键问题详述

### 6.1 R-01：响应者选择与动作集合被混为一层

跨玩家仲裁应该只决定“谁先获得响应权”；一旦选中玩家，同一玩家的合法动作集合必须完整保留。

正确语义：

```text
跨玩家：胡 > 招 > 碰 > 吃，按座次确定响应者

同一玩家：
  [胡, 强制碰] → 显示胡和碰，不显示过
  [胡, 强制招] → 显示胡和招，不显示过
  玩家选择胡 → 胡
  超时/放弃胡 → 执行强制动作
```

当前 `advanceResponseWindow()` 通过最高优先级再次过滤选中玩家动作，导致强制 fallback 丢失；同时只要过滤后的动作有 mandatory，就会立即自动执行，没有真实等待窗口。

### 6.2 R-02：过牌领域规则没有统一入口

当前已经正确保留两类记录：

- 主动出牌：`actionType = discard`
- 实际可吃但主动过：`actionType = chi`

`canPlayerChi()` 会检查这两类记录，但胡动作生成和动作执行校验没有检查。因此，仅在 Godot 隐藏胡按钮不能解决问题；必须在 core 的动作生成和动作执行两层同时拒绝。

### 6.3 R-03：开局状态同时把第 21 张当手牌和 pending card

当前代码已经出现两个相互竞争的模型：

1. 庄家 20 张基础手牌 + 独立 `dealerPendingCard`。
2. 把 pending card 加入庄家手牌，按 21 张直接计算爆牌。

`handleDiscardToBao()` 又支持庄家从 21 张中弃一张后按剩余 20 张判断爆，说明状态模型尚未收敛。整改必须先冻结开局规则，再改状态和回放，不能只在一个函数中修补牌数。

### 6.4 S-01：会话身份不是请求鉴权

`sessionId`、父 PID 和会话端口能防止 Godot 误连旧 Bridge，但它们不是秘密。当前任意本机网页仍可探测端口并向 `/api/game/new`、`/api/game/action` 等接口发请求。必须使用每次运行随机生成的独立认证令牌，并关闭普通浏览器跨域访问。

### 6.5 Q-01：测试问题是“缺少规则闭环”，不是单纯数量少

本地已有多组 TypeScript 测试，外部报告所称“没有真正覆盖 production core”过于绝对。准确问题是：

- 追踪矩阵将未完整实现的规则标为通过。
- 缺少能先失败、再证明修复的固定牌局状态。
- 缺少从 core `availableActions`、Bridge 动作门控到 Godot 展示的一致性断言。
- 超时、重放和旧状态迁移没有统一的确定性时钟与版本门禁。

## 7. 审计评级

| 维度 | 评级 | 说明 |
| --- | --- | --- |
| 架构分层 | B+ | core 唯一权威方向正确，Godot/Bridge 边界已基本形成 |
| 牌局规则实现 | C | 过牌禁胡、响应 fallback、开局爆牌和特殊名堂仍能改变牌局结果 |
| 规则文档一致性 | C- | 文档之间冲突，追踪矩阵存在错误完成标记 |
| 本地 Bridge 安全 | C | 会话隔离已存在，但鉴权、CORS 和请求体限制仍缺失 |
| 自动化测试 | C- | 测试基础比外部报告描述更好，但关键规则固定场景和跨层门禁不足 |
| 版本可追溯性 | D+ | core 脏工作树、core 与 Godot 仍为分离仓库且缺少交叉版本清单，无法可靠对应源码、bundle 与审计结论 |

## 8. 审计结论

在 P0 项全部完成前：

- 可继续用于开发、UI 联调和固定规则验证。
- 不应宣称正式规则已锁定。
- 不应继续扩大 AI 策略训练范围，因为训练数据会继承当前规则错误。
- 不应发布给不受控环境使用，因为本机 Bridge 接口缺少鉴权。

P0 完成定义不是“代码已改”，而是：正式规则、Rule ID、core 实现、动作执行防御、Bridge 集成测试、Godot 展示和版本记录全部一致。

## 9. 当前整改复核（2026-08-18 最终验收）

上述审计结论记录的是初始核验状态；当前整改已完成表中 R-01～R-10、D-01、S-01～S-05 的代码、文档、定向测试和发布收口。RuleProfile 的计分阈值已从旧静态 `WIN_CONDITIONS` 移除，validator、GameManager、AI 分析和随包 Bridge 使用同一局 profile。最终证据包括：core 类型检查、完整 Vitest（241 通过/1 跳过）、GUO/RESP/BAO/MING/meld/三人/RuleProfile 定向测试、Bridge 鉴权与输入边界测试、bundled Bridge v2/v6 smoke、禁带路径扫描和 Godot headless `GAME_SERVICE_TESTS_PASSED`。

Windows 4.7.1 完整导出已成功，最终 EXE/PCK/Bridge/Node 哈希和冷启动记录见 [`../verification/2026-08-18-audit-remediation-release.md`](../verification/2026-08-18-audit-remediation-release.md)。实机 Release 启动未设置开发覆盖、不依赖 pnpm/tsx，创建三人新局；关闭后随包 Bridge 进程清零，重启可恢复并再次开新局。E core 仍保留用户脏工作树，这是有意的版本边界，不影响 K 仓库和随包产物的 Git 追踪。
