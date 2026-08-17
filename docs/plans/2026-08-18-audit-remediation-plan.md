# 大贰训练 Godot 项目审计整改方案

> 制定日期：2026-08-18  
> 方案版本：V1.0  
> 审计依据：[`../audits/2026-08-18-daer-code-security-rules-audit.md`](../audits/2026-08-18-daer-code-security-rules-audit.md)  
> 原始审计：<https://chatgpt.com/s/t_6a833de5c2948191b95c2f6cbdc80992>

## 1. 整改目标

本方案将审计发现转化为可实施、可测试、可回放、可发布的整改批次。最终目标：

1. `@daer/core` 是唯一规则事实，Godot 与 Bridge 不补写规则。
2. 正式规则文档、Rule ID、实现、固定 fixture 和追踪矩阵一一对应。
3. 过牌、响应窗口、爆牌、天胡、水上漂等持续状态规则具有显式领域状态。
4. Bridge 仅接受所属 Godot 会话的授权请求，并具备输入大小和错误边界。
5. core、Godot、Bridge bundle、回放和审计报告可定位到同一版本基线。
6. 发布门禁可以重复执行，失败时能明确定位到规则、协议、表现或打包层。

## 2. 实施原则

- **规则先于代码**：有歧义的规则先形成决策记录，不在实现中猜测。
- **小批次提交**：每个整改包单独包含文档、实现、测试和迁移说明。
- **动作双重防御**：既不生成非法 `availableActions`，也拒绝直接提交的非法动作。
- **确定性优先**：时钟、超时、随机数和系统动作必须可注入、可回放。
- **不复用旧快照推断新语义**：规则或状态结构变化时显式升级版本并拒绝不兼容恢复。
- **发布默认最小权限**：开发调试入口不得自动进入 Release。
- **整改期间冻结 AI 规则扩展**：P0 关闭前只允许修复已有策略适配，不扩大训练数据口径。

## 3. 前置规则决策

编码前必须建立以下决策记录，并同步到正式规则文档。

### RG-GUO-01：过牌定义与生命周期

采用以下冻结口径：

- 主动打出某牌形成过牌。
- 实际可吃时主动过形成过牌。
- 后续不可吃、不可胡同 `rank + size` 的牌。
- 无资格吃、无合法吃法或系统跳过不形成过牌。
- 本局生命周期为 `NEVER`，不在轮次切换时清除。

如果以后要支持地方规则变体，应新增规则版本和 profile 值，不能静默修改默认值。

### RG-BAO-01：庄家第 21 张与爆牌

推荐统一为以下状态模型：

```text
三名玩家各持 20 张基础手牌
庄家另有 dealerPendingCard 1 张

闲家爆牌判断：直接检查各自 20 张基础手牌

庄家开局：
  A. 基础 20 张已听 → 可声明爆；pending card 作为开局 ActiveCard 继续流程
  B. 基础 20 张未听 → 合并 pending card 形成 21 张候选
     → 庄家选择弃 1 张
     → 对剩余 20 张判断是否可爆
```

必须进一步确认“庄家基础 20 张已听时 pending card 的公开/响应语义”。确认后写成状态转换表，禁止把 `dealerPendingCard` 同时计入手牌和 pending 字段。

### RG-RESP-01：胡与强制动作

- 跨玩家优先级：胡 > 招 > 碰 > 吃，同级按来源玩家后的相对座次。
- 同一玩家 `[hu, mandatory zhao/peng]` 必须完整保留。
- 不提供 `pass`。
- 主动选择胡则胡。
- 未选择胡且窗口到期，执行强制招/碰。

### RG-TIME-01：响应时间

- `responseTimeout` 最终只能来自冻结的 `RuleProfile`。
- `ResponseWindow` 保存 `openedAt`、`deadlineAt`、`timeoutAction`。
- 回放记录逻辑系统动作，不依赖回放时重新读取当前墙钟。
- 测试使用可注入时钟；禁止用真实等待时间制造脆弱测试。

### RG-PLAYER-01：固定三人

- 产品运行、状态类型、发牌配置、测试和文档均只支持三人。
- 四人歇底逻辑不作为隐藏兼容功能保留。

## 4. P0 整改批次

### WP-0：冻结可复现基线（V-01）

目的：保证整改不是继续叠加在无法追踪的混合工作树上。

工作项：

1. 盘点 `E:\project\daer` 当前未提交改动，区分用户已有工作、规则整改和生成物。
2. 保存当前 core HEAD、分支、工作树状态及必要 patch 清单。
3. 为 `K:\godot\daer` 建立 Git 仓库或纳入同一受控仓库；不得继续只靠目录备份。
4. 建立 core commit、Godot commit、Bridge runtimeVersion、ruleVersion、protocolVersion 的版本清单。
5. 将 `.pnpm-store`、构建输出、临时状态和编辑器缓存从源码提交中隔离。

交付物：

- 可复现的整改起点。
- `docs/version-baseline.md` 或等效发布清单。
- 独立整改分支，建议 `codex/audit-remediation-p0`。

验收：

- 任一开发者能从记录的 commit 构建出版本匹配的 Bridge。
- Godot 包内 `runtime-version.txt` 与源码常量一致。
- 工作树中没有误纳入生成物。

### WP-1：规则文档与追踪矩阵（D-01）

修改范围：

- `E:\project\daer\docs\luzhou-daer-rules-v2.md`
- `E:\project\daer\docs\daerguizeqingxi.md`
- `E:\project\daer\docs\rule-traceability-matrix.md`
- `K:\godot\daer\docs\plans\2026-08-15-game-flow-rules-completion.md`

工作项：

1. 将过牌拆为 GUO-01～GUO-07，不再只写“过张不可吃”。
2. 明确主动出牌和主动放弃吃两类来源。
3. 明确禁吃和禁胡是同一领域约束。
4. 将“仅放弃吃时记录过张”的旧描述删除或标为历史废止。
5. 将未覆盖的 GUO-04、GUO-05、GUO-07 从完成改为未完成。
6. 修正文档中 `NEVER` 与“每回合清除”的自相矛盾。
7. 将 R-08 标为已修并关联现有测试。

验收：

- 四份文档对过牌定义、生命周期和同牌判断完全一致。
- 每个 Rule ID 均有实现位置、测试 ID、状态和最后验证版本。
- 追踪矩阵不再用单个低层测试宣称整条领域规则完成。

### WP-2：过牌统一领域约束（R-02）

推荐设计：

```ts
hasPassedCard(player, card): boolean
canClaimActiveCard(state, playerIndex, card, claimType): ClaimResult
```

工作项：

1. 抽取 `rank + size` 统一比较和 `hasPassedCard()`。
2. `canPlayerChi()` 改用统一函数，保持现有正确行为。
3. `TurnManager.getAvailableActions()` 生成胡动作前检查过牌。
4. `GameManager.processAction(hu)` 或胡处理入口再次防御，拒绝伪造/过期胡动作。
5. 保留 `handleDiscard()` 写入 `discard` 过牌记录。
6. 仅在玩家确有合法吃方案且主动提交 `pass` 时写入 `chi` 过牌记录。
7. 系统无动作推进不写入过牌。
8. 清理重复过牌记录或定义幂等规则，避免同牌无限追加。

必须新增的测试：

| 测试 ID | 场景 | 期望 |
| --- | --- | --- |
| GUO-001 | 主动打出小六，后续再次出现小六且可吃 | 无 `chi` |
| GUO-002 | 主动打出小六，后续再次出现小六且可胡 | 无 `hu` |
| GUO-003 | 实际可吃小六时主动过，之后再次出现 | 无 `chi` |
| GUO-004 | 实际可吃小六时主动过，之后本可胡 | 无 `hu` |
| GUO-005 | 没有合法吃方案时系统推进 | 不新增 `passedPlays` |
| GUO-006 | 过小六后出现大六 | 不受小六过牌影响 |
| GUO-007 | 直接伪造 hu 请求认领已过牌 | core/Bridge 拒绝且状态签名不变 |

验收：

- `availableActions` 不暴露非法胡。
- 绕过 UI 直接调用 core/Bridge 也不能胡。
- 回放重建后的过牌限制一致。

### WP-3：响应窗口两层仲裁（R-01、R-06）

推荐拆分：

```text
selectResponder(candidates, responses)
  → 只选择当前响应玩家

buildResponderActions(selectedPlayer)
  → 返回该玩家完整合法集合

resolveTimeout(responseWindow)
  → 生成可回放的系统动作
```

工作项：

1. 删除“选中玩家后再次按最高优先级过滤”的逻辑。
2. 明确 `selectedPlayerIndex` 与 `availableActions` 是两层结果。
3. `[hu, mandatory peng]`、`[hu, mandatory zhao]` 保留两项并删除 pass。
4. 纯强制动作是否立即执行必须按产品规则统一；若需要展示，应建立短窗口而非同步执行。
5. `ResponseWindow` 新增 `deadlineAt` 和规范化 `timeoutAction`。
6. Bridge 调度到期事件，向 core 提交带 `responseWindowId` 的系统超时动作。
7. core 校验窗口 ID、截止时间和 timeoutAction，避免旧定时器推进新窗口。
8. replay 记录 `timeout_peng`、`timeout_zhao` 或 `timeout_pass` 的规范动作及 transition。
9. 移除或重写未接入正式状态机的旧 `TimeoutHandler`，避免第二套超时逻辑。

必须新增的测试：

| 测试 ID | 场景 | 期望 |
| --- | --- | --- |
| RESP-001 | 同一玩家胡 + 强制碰 | `[hu, peng]`，无 pass |
| RESP-002 | 同一玩家胡 + 强制招 | `[hu, zhao]`，无 pass |
| RESP-003 | 只有强制碰 | 只提供/执行 peng，不能 pass |
| RESP-004 | 只有吃 | `chi + pass`，超时为 pass |
| RESP-005 | 三家分别可吃、碰、胡 | 胡玩家先获得响应权 |
| RESP-006 | 旧窗口定时器在新窗口触发 | 409/拒绝，状态不变 |
| RESP-007 | 胡 + 强制碰到期 | 记录 `timeout_peng` 并落桌碰牌 |
| RESP-008 | 固定时钟重放 | 相同种子和动作得到相同状态签名 |

验收：

- 跨玩家优先级不会删除同一玩家合法 fallback。
- UI 有足够时间展示动作，但动画不驱动规则状态。
- 超时动作可以完整回放。

### WP-4：开局第 21 张与爆牌（R-03）

工作项：

1. 依据 RG-BAO-01 把基础 20 张与 `dealerPendingCard` 分开存储。
2. `prepareBaoSelection()` 不得直接用 21 张庄家集合计算 20 张爆牌资格。
3. 建立显式 opening phase/subphase，例如 `bao_selection`、`dealer_pending_resolution`。
4. 规范庄家 21→20 的弃牌、爆牌声明与 ActiveCard 来源。
5. 所有开局转换产生稳定 `lastTransition` 和 replay step。
6. 状态验证器按 phase 校验精确牌数与 pending card 所有权。
7. 旧持久化状态缺少新字段时拒绝恢复或执行显式迁移。

固定测试：

- BAO-001：三人各 20 张基础手牌，庄家另有唯一 pending card。
- BAO-002：闲家以 20 张判断爆牌。
- BAO-003：庄家 21→弃 1→剩 20 后判断爆牌。
- BAO-004：pending card 不同时出现在庄家手牌、牌山和 ActiveCard。
- BAO-005：开局每一步总牌数守恒。
- BAO-006：固定种子回放可重建相同 opening state。

验收：

- 任意 phase 下每张实体牌只存在于一个所有权位置。
- 爆牌判定输入始终是正式规则定义的 20 张集合。

### WP-5：Bridge 会话鉴权与 CORS（S-01）

工作项：

1. Godot 每次运行使用系统安全随机源生成至少 256 bit 临时令牌。
2. 令牌仅通过子进程环境变量传给 Bridge，不写日志、不写回放、不持久化。
3. Godot 对所有 `/api/*` 请求发送 `Authorization: Bearer <token>`。
4. Bridge 使用固定时间比较校验令牌；缺失或错误返回 401，且不返回牌局状态。
5. 删除 `Access-Control-Allow-Origin: *` 和普通浏览器 OPTIONS 支持。
6. `/health` 至少校验 sessionId；推荐同样要求令牌，避免端口探测信息泄漏。
7. 令牌变化后，旧 Godot/旧网页请求不能操作新会话。
8. 更新 Bridge protocol/runtime 版本并重新打包。

安全测试：

- SEC-001：无 Authorization 调 `/api/game/state` → 401。
- SEC-002：错误令牌 → 401。
- SEC-003：正确令牌 → 200。
- SEC-004：响应中不存在通配 CORS。
- SEC-005：旧会话令牌不能访问新 Bridge。
- SEC-006：错误请求不会在日志中输出令牌。

验收：

- 本机浏览器不能跨域调用游戏接口。
- 只有启动该 Bridge 的 Godot 会话能读写牌局。

## 5. P1 整改批次

### WP-6：开局名堂显式事实（R-04、R-05）

工作项：

1. 天胡同时要求庄家身份、opening phase、未发生普通出牌/翻牌。
2. 将天胡资格作为显式 opening fact 传入结算，不再只用 `turnCount` 推导。
3. 新增 `drawOrdinal` 或 `mountainFlipCount`。
4. 水上漂只在 `source = draw && drawOrdinal = 1` 时成立。
5. 爆牌、强制动作和开局 pending card 不得错误增加首次翻山计数。

测试：

- MING-001：非庄家 `turnCount=0` 即使牌型满足也不是天胡。
- MING-002：庄家开局满足指定牌型时为天胡。
- MING-003：第一次真实翻山牌胡为水上漂。
- MING-004：回合数为 1 但不是第一次翻山牌时不得计水上漂。

### WP-7：规则配置单一事实（R-07）

工作项：

1. 逐字段建立“是否支持配置”的决策表。
2. 永远固定的值从 `GameConfig` 删除，只保留一个规则常量来源。
3. 真正可配置的值全部进入冻结 `RuleProfile`，由 validator 和 scoring 读取。
4. 新局、state、replay、AI trace 保存 `ruleVersion` 和 profile 快照。
5. 配置变化必须创建新局，不得中途改变现有牌局语义。

验收：

- 不再存在 `GameConfig` 和 `WIN_CONDITIONS` 对同一规则各存一份值。
- 改 profile 的固定测试能证明规则行为确实变化。

### WP-8：Bridge 输入边界（S-02）

工作项：

1. `readJson()` 按实际接收字节累计，默认上限 64 KiB。
2. 超限立即停止继续缓存并返回 413。
3. 无效 JSON 返回 400，不把解析异常堆栈暴露给客户端。
4. 校验 `Content-Type: application/json`。
5. 为 route 增加统一错误码和审计日志，但不得记录认证令牌或完整手牌。

测试：

- 64 KiB 内合法请求通过。
- 超限请求返回 413。
- 伪造较小 Content-Length 仍按实际字节拒绝。
- 数组、空值、无效 JSON 返回 400。

### WP-9：公开废牌事件模型（R-08 回归）

本地实现已修复，只执行收口：

1. 将历史事件结构统一为 `card/source/sourcePlayerIndex/responseWindowId/sequence`。
2. 保留现有 `source: draw` 测试。
3. 增加 Bridge/replay 序列化测试和 Godot 渲染测试。
4. 确认旧 replay 缺少 source 时只用于历史展示，不进入训练数据。

## 6. P2/P3 整改批次

### WP-10：meld 基础契约（R-09）

- `peng`、`triple` 必须恰好 3 张同牌。
- `quadruple`、`draw_quadruple` 必须恰好 4 张同牌。
- 分别增加 2、3、4、5 张边界测试。
- 所有调用方继续依赖 validator，不重复写张数规则。

### WP-11：删除四人运行分支（R-10）

- `playerCount` 收敛为固定三人或从运行配置移除。
- 删除 `FOUR_PLAYERS`、歇底逻辑、四人状态校验和四人测试。
- `/api/game/new` 对传入 `playerCount` 明确忽略或拒绝，契约只返回三人。
- 更新规则文档、fixture、模拟器和 AI 输入维度。

### WP-12：Release 隔离 MCP（S-03）

- 开发工程保留 MCP。
- Release 导出明确排除 `addons/godot_mcp/**`、运行时 probe、调试资源和本地工具元数据。
- 打包后扫描 PCK/导出目录，出现禁止路径则失败。
- MCP 缺失不得影响正式游戏启动。

### WP-13：限制自定义 Bridge 命令（S-04）

- 编辑器/debug 构建允许显式 `DAER_GODOT_BRIDGE_COMMAND`。
- Release 只允许版本清单匹配的 bundled Bridge。
- Release 中发现自定义命令环境变量时忽略并记录不含命令正文的安全提示。
- 避免将任意命令字符串交给 `cmd.exe /c`；开发模式优先使用结构化 executable + args。

### WP-14：持久化文件名净化（S-05）

- replay ID 只允许 `[A-Za-z0-9_-]+`，设置合理长度上限。
- `load_replay()` 只接受列表接口返回的 basename。
- 拼接后验证规范化路径仍位于 `user://replays`。
- 拒绝 `..`、斜杠、反斜杠、盘符和控制字符。
- 增加目录穿越和超长名称测试。

## 7. 跨层测试矩阵

| 层级 | 必测内容 | 失败含义 |
| --- | --- | --- |
| 规则单元 | GUO、RESP、BAO、名堂、meld、三人约束 | core 规则错误 |
| core 流程 | 固定种子、响应窗口、系统超时、回放重建 | 状态机/确定性错误 |
| Bridge 集成 | auth、body limit、action guard、stale window、replay | 协议或安全边界错误 |
| Godot headless | 版本握手、认证头、new game、动作按钮映射、公开牌源 | 客户端适配错误 |
| Godot 可视化 | 动作停顿、胡+强制动作同屏、超时反馈、公开牌来源 | 表现层错误 |
| 发布包 | bundle 版本、无 MCP、无开发路径、冷启动新局 | 打包/发布错误 |

每个固定场景应保存：

- seed 和 `ruleVersion`
- 初始 state fixture
- 提交动作序列
- 每一步 state signature
- 期望 `availableActions`
- replay 期望
- Bridge HTTP 期望
- 必要时 Godot 截图基线

## 8. 版本与迁移策略

### 8.1 建议版本升级

- `ruleVersion`：过牌、开局和名堂语义修复后升级。
- `protocolVersion`：加入 Authorization、deadline 和新状态字段后升级，例如从 `daer-godot-v1` 进入下一协议版本。
- `runtimeVersion`：Bridge 行为变化后从 `daer-bridge-session-v5` 升级。
- replay schema：加入 system timeout、draw ordinal、opening state 和 profile snapshot 后升级。

版本字符串的最终编号在实施分支中统一决定，禁止 core、Godot 和 bundle 分别手工改成不同值。

### 8.2 旧状态处理

- 新版本不得自动恢复缺少 ruleVersion/profile/opening state 的活动牌局。
- 旧 replay 可以只读展示，但必须标记历史规则版本。
- 旧 replay 不进入新 AI 训练集，除非完成显式迁移并验证状态签名。
- 认证令牌永不迁移、永不持久化，每次 Godot 运行重新生成。

### 8.3 建议提交序列

1. `docs(rules): freeze guo and opening rules`
2. `test(core): add failing guo and response fixtures`
3. `fix(core): enforce passed-card hu restriction`
4. `fix(core): preserve mandatory response fallback`
5. `refactor(core): model dealer pending opening card`
6. `feat(bridge): add session bearer authentication`
7. `feat(core): add deterministic response deadlines`
8. `fix(core): make opening mingtang facts explicit`
9. `refactor(core): freeze RuleProfile and remove four-player branches`
10. `build(godot): exclude debug tooling from release`

每个提交应可独立审查，禁止把 P0 规则、安全、UI 大改和生成 bundle 混成一个提交。

## 9. 执行门禁

### 9.1 每个工作包的最快检查

```powershell
pnpm --dir E:\project\daer\packages\core exec tsc --noEmit
pnpm --dir E:\project\daer\packages\core exec vitest run <本工作包测试文件>
```

### 9.2 P0 合并前

```powershell
pnpm --dir E:\project\daer\packages\core exec vitest run
K:\godot\Godot_v4.7.1-stable_win64_console.exe --headless --path K:\godot\daer -- --test
```

并执行 Bridge 安全 smoke test：

- 无令牌 401
- 正确令牌 200
- 无 wildcard CORS
- 超限请求 413
- `/api/game/new` 创建固定三人局
- 过牌禁胡和胡+强制 fallback 通过 HTTP 路径验证

### 9.3 发布候选

1. 从干净提交构建 bundle。
2. 校验 protocol/runtime/rule/replay schema 四类版本。
3. 在未设置开发环境变量、没有 pnpm/tsx 的环境冷启动。
4. 确认 Release 不包含 MCP 和开发机路径。
5. 完成固定种子全局、回放重建、退出后 Bridge 自动结束、重新运行可开新局。
6. 保存测试日志、bundle 哈希和发布清单。

## 10. 完成标准

P0 完成必须同时满足：

- [ ] 正式规则文档和追踪矩阵已修正。
- [ ] GUO-001～007 全部通过。
- [ ] RESP-001～008 全部通过。
- [ ] BAO-001～006 全部通过。
- [ ] Bridge 鉴权/CORS 测试全部通过。
- [ ] 非法动作通过 core 和 Bridge 两层拒绝。
- [ ] 新状态和超时动作可确定性回放。
- [ ] core 与 Godot 有可复现 Git 基线和 bundle 版本清单。

全部整改完成必须进一步满足：

- [ ] 天胡、水上漂使用显式事实，不依赖模糊回合数。
- [ ] RuleProfile 是唯一可变规则来源。
- [ ] HTTP body、持久化路径和 Release 调试入口已硬化。
- [ ] 四人歇底运行分支全部删除。
- [ ] Release 包不包含 MCP/RuntimeProbe。
- [ ] 完整测试、冷启动、退出清理和新局流程通过。
- [ ] 审计文档所有发现均标为已验证关闭，并记录对应提交和测试证据。

## 11. 推荐执行顺序

```text
WP-0 版本基线
  ↓
WP-1 规则文档
  ↓
WP-2 过牌禁胡 ─────────┐
WP-3 响应/超时 ────────┼→ P0 固定场景与 Bridge 集成门禁
WP-4 开局爆牌 ─────────┤
WP-5 Bridge 鉴权 ──────┘
  ↓
WP-6～WP-9 P1 收口
  ↓
WP-10～WP-14 P2/P3 硬化
  ↓
干净构建、发布包审计、版本归档
```

建议先完成 WP-0 和 WP-1，再开始任何规则代码修改。当前 core 工作树已有大量未提交改动，直接实施 P0 会显著增加覆盖用户现有工作的风险。
