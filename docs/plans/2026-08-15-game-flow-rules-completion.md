# Godot 大贰游戏流程与规则闭环完善方案

**日期：** 2026-08-15  
**范围：** `E:\project\daer` 的 `@daer/core` 与 Godot Bridge，以及 `K:\godot\daer` 的 Godot 客户端。  
**目标：** 以原项目正式规则文档为准，补齐出牌、翻牌、响应收集、优先级仲裁、吃、碰、招、过、比、胡和下一回合的完整闭环；Godot 只消费权威状态并以可看清的节奏呈现每一步。

## 1. 结论与架构决定

当前问题不是单纯的前端按钮漏渲染，而是原 Web 前端曾承担的“遍历全部玩家视角并收集响应”没有迁入重构后的权威流程。

- `ActionHandlers.handleDiscard()` 出牌后保留出牌者为 `currentPlayerIndex`。
- `TurnManager.getAvailableActions()` 会禁止出牌者响应自己的弃牌，但仍无条件添加 `pass`。
- Bridge 只把当前单一视角交给 `/api/game/action` 或 `/api/game/ai-step`，没有像原 Web 前端那样检查其他玩家。
- 出牌者点击或由 AI 执行 `pass` 后，`GameManager` 直接 `endTurn()`，其他玩家的胡、招、碰、吃机会被整体跳过。
- `ResponseArbitrator`、`pendingResponses`、`addResponse()` 和 `resolveResponses()` 虽然已经存在，但没有接入 `GameManager.processAction()` 主流程。
- Bridge 的 `advanceIfStalled()` 会把“动作未生效”直接解释成“进入下一回合”，有掩盖非法请求、状态机缺口和动作守卫错误的风险。

因此本轮采用以下边界：

1. **core 是规则和响应窗口的唯一事实来源。** 多玩家响应收集、强制动作、优先级和座次仲裁必须在 core 闭环，不能再次放到 Godot。
2. **Bridge 负责会话、协议、AI 决策和逐步推进。** Bridge 不自行发明合法动作，也不能以“防卡死”为由跳过未处理的响应。
3. **Godot 负责玩家输入、动作事件队列、动画和牌面展示。** 按钮只来自“当前人类可执行动作”，动画结束不能反向决定规则状态。

## 2. 当前运行牌局的复现证据

通过 gdmcp 读取运行中的 `AIService.latest_state`，当前牌局可直接复现用户报告的问题：

| 字段 | 当前值 |
| --- | --- |
| 当前阶段 | `drawing` |
| 当前玩家 | 玩家0 |
| 最后弃牌 | 玩家2打出的“大玖” `card_玖_big_73` |
| 玩家0手牌 | 含两张“大玖” `card_玖_big_74`、`card_玖_big_76` |
| `availableActions` | 仅 `draw` |

按正式规则 R7.4.2，玩家0对“大玖”应有强制 `peng`；实际状态已经越过响应窗口进入 `drawing`。这证明“碰按钮缺失”发生在 core/Bridge 状态抵达 Godot 之前。

第一步“小六”问题也能由现有代码路径解释：

1. 玩家0出“小六”；
2. 状态进入 `response_collecting`，但 `currentPlayerIndex` 仍是玩家0；
3. 玩家0不能响应自己的弃牌，却仍获得 `pass`；
4. 玩家0点“过”后直接进入玩家1翻牌；
5. 玩家1、玩家2从未获得对“小六”的响应视角。

历史文档中“完整主流程已完成”的记录只证明旧测试和特定自走链路能够结束对局，不能继续作为多玩家响应正确性的验收证据。本方案完成前，规则流程状态按 **P0 未闭环** 管理。

## 3. 规则基准

规则依据：

- `E:\project\daer\docs\luzhou-daer-rules-v2.md`
- `E:\project\daer\docs\daerguizeqingxi.md`
- `E:\project\daer\docs\rule-traceability-matrix.md`

必须保持的规则语义：

| 动作 | 目标语义 |
| --- | --- |
| 出牌 | 从手牌移出一张合法牌，作为唯一 `ActiveCard` 打开全体响应窗口；出牌者不能响应自己的牌。 |
| 翻牌（当前代码名 `draw`） | 从牌堆公开翻出一张牌到待响应区，不进入任何玩家手牌；翻牌者本人也可以响应。UI 文案统一使用“翻牌”，协议可暂时兼容 `draw`。 |
| 胡 | 响应优先级最高；胡牌结构、胡息、点炮/自摸与名堂全部由 core 校验和结算。 |
| 招 | 有三张同牌遇第4张时强制招，除非有可执行的胡；优先级高于碰和吃。 |
| 碰 | 有对子遇第3张时强制碰，除非被胡或招覆盖；不能向玩家提供“过”来绕开强制碰。 |
| 吃 | 仅允许吃上家打出的牌或自己翻出的牌；必须提交明确 `chiOptionId`。 |
| 比 | 不是独立的可取消动作，而是吃牌方案中的强制附加牌组；`additionalMelds` 必须与主吃牌组一次性校验、一次性落桌。无法合法比牌时不得暴露该吃牌方案。 |
| 过 | 只放弃当前玩家实际拥有的可选响应；仅在确有吃牌机会时记录过张。不能把“出牌者无法响应自己的牌”显示为需要手动过。 |
| 无响应 | 所有响应者均无动作或选择过后，轮到来源玩家的下家翻牌。 |
| 响应优先级 | `胡 > 招 > 碰 > 吃 > 过`；同优先级以 ActiveCard 来源玩家为基准，按下家优先的相对座次仲裁；只允许一名玩家胡。 |

强制动作与胡同时存在时采用以下 UI/超时口径：

- 有胡且同时有招/碰：显示“胡”和应执行的强制动作，不显示“过”；玩家可选择更高优先级的胡，超时执行招/碰。
- 只有招：只显示招，超时自动招。
- 只有碰：只显示碰，超时自动碰。
- 只有吃：显示吃和过，超时自动过。
- 没有任何非过响应：自动记录系统过，不显示按钮，不要求玩家确认。

## 4. 目标状态机

```text
开局
  -> 爆牌选择（如有）
  -> 庄家出牌
  -> 打开 ResponseWindow
       -> 计算所有玩家的合法响应（出牌来源排除自己；翻牌来源包含自己）
       -> 收集人类/AI响应或自动系统过
       -> 全部响应完成后统一仲裁
            -> 胡：结算并结束
            -> 招/碰/吃(+比)：组合牌落桌，响应者进入出牌阶段
            -> 全过：来源玩家的下家进入翻牌阶段
  -> 翻牌
  -> 打开 ResponseWindow
       -> 同上
```

### 4.1 GameState 契约扩展

建议新增显式 `responseWindow`，不再用 `currentPlayerIndex + lastDiscardPlayerIndex + pendingResponses` 隐式猜测：

```ts
interface ResponseWindow {
  id: string;
  source: 'discard' | 'draw';
  sourcePlayerIndex: number;
  activeCard: Card;
  responderOrder: number[];
  currentResponderIndex?: number;
  responses: PlayerResponse[];
  openedAt: number;
  deadlineAt?: number;
}
```

- 正常回合中，`currentPlayerIndex` 表示当前翻牌/出牌者。
- 响应阶段中，`responseWindow.currentResponderIndex` 表示当前等待输入者；不能复用并覆盖回合所有者。
- 新增 `getAvailableActionsForPlayer(state, playerIndex)`；计算某玩家响应时不再复制状态并篡改 `currentPlayerIndex`。
- `availableActions` 在对外状态中只表示当前控制端需要处理的动作，并新增 `availableActionsByPlayer` 或按端点投影，避免客户端猜测其他玩家动作。
- `pendingResponses` 可迁移为 `responseWindow.responses`；迁移期保留兼容字段，但只维护一个权威集合。

### 4.2 响应窗口算法

1. 出牌或翻牌后调用 `openResponseWindow()`。
2. 依据来源构造响应顺序：
   - 出牌：从来源玩家的下家开始，排除来源玩家；
   - 翻牌：包含翻牌者本人，再按相对座次检查其他玩家。
3. 对每名玩家独立生成胡/招/碰/吃候选及强制标记。
4. 没有非过动作的玩家由 core 自动记为系统过，不进入 UI。
5. 强制招/碰玩家不允许提交 `pass`；可选吃/胡按第3节口径生成动作。
6. 收到响应后只记录，不立即执行低优先级动作；全部响应完成或满足可安全提前结束的条件后调用 `ResponseArbitrator`。
7. 仲裁胜者的动作由 core 使用标准化卡牌和 option ID 执行；其他响应记入回放但不改变牌组。
8. 全部过后关闭窗口，清除 ActiveCard 上下文，进入来源玩家下家的 `drawing`（界面文案“翻牌”）。

### 4.3 各动作落地后的状态

| 胜出动作 | ActiveCard | 牌组/弃牌历史 | 下一阶段 |
| --- | --- | --- | --- |
| 胡 | 用于胡牌结构和点炮/自摸判定 | 保存结算事实 | `ended` |
| 招 | 与手中三张原子组成4张公开组 | 若来自弃牌，从弃牌堆撤回；翻牌来源不进入弃牌历史 | 响应者 `discarding`；八块/爆牌规则决定是否免出 |
| 碰 | 与手中两张原子组成3张公开组 | 若来自弃牌，从弃牌堆撤回 | 响应者 `discarding` |
| 吃+比 | `mainMeldCards` 和全部 `additionalMelds` 一次落桌 | 若来自弃牌，从弃牌堆撤回 | 响应者 `discarding` |
| 全过（出牌） | 保留为普通弃牌 | 弃牌历史保留来源玩家 | 来源下家 `drawing` |
| 全过（翻牌） | 物化为公开废牌，但不进入任何手牌 | 追加公开历史并标记来源为翻牌 | 来源下家 `drawing` |

## 5. core 修改计划

### Task C1：用失败用例固定两个现场问题

**修改文件：**

- `packages/core/__tests__/game-flow.test.ts`
- `packages/core/__tests__/rules.test.ts`

新增固定状态/固定 seed 测试：

1. 玩家0出小六后，玩家0不获得 `pass`；玩家1、玩家2均被检查响应。
2. 玩家2出大玖，玩家0持两张大玖时，玩家0获得唯一强制 `peng`，不得进入 `drawing`。
3. 出牌来源玩家永不出现在 responder 列表；翻牌来源玩家必须出现。
4. 玩家1可吃、玩家2可碰、玩家0可胡时最终胡胜出。
5. 两家同级碰或胡时按 ActiveCard 来源的相对座次选择。
6. 强制招/碰时拒绝 `pass`；超时自动执行强制动作。
7. 只有吃时允许过，并且只记录真正放弃的吃牌过张。
8. 吃牌带两个比牌组时主组与 `additionalMelds` 同时落桌；伪造、缺失、过期 option ID 拒绝且状态不变。
9. 翻牌全过后 ActiveCard 不进入任何玩家手牌。

### Task C2：接通 ResponseArbitrator

**修改文件：**

- `packages/core/src/shared/types/game.ts`
- `packages/core/src/game-engine/turn-manager.ts`
- `packages/core/src/game-engine/game-manager.ts`
- `packages/core/src/game-engine/response-arbitrator.ts`
- `packages/core/src/game-engine/action-handlers.ts`

实施要点：

- 将“为玩家生成动作”与 `currentPlayerIndex` 解耦。
- `handleDiscard()`/`handleDraw()` 只打开响应窗口，不直接决定谁点过。
- `processAction()` 在响应阶段记录响应并仲裁，禁止低优先级先提交就直接落地。
- 删除 `pass` 分支中依靠 `passedActionType` 和当前玩家猜测转移路径的逻辑。
- `ResponseArbitrator` 的同级座次基准改为 `responseWindow.sourcePlayerIndex`，不使用临时响应者索引。
- 所有动作处理器增加前置牌数和 option 校验；碰必须恰有2张可用同牌、招必须恰有3张，不能生成空/残缺公开组。
- 明确 `draw` 是协议兼容名，领域事件与 UI 使用 `flip`/“翻牌”。

### Task C3：取消掩盖错误的强制推进

- 删除 Bridge 和模拟器中“状态签名不变就直接 `nextTurn`”的常规路径。
- 非法、过期或无效果动作返回明确错误，原状态不变，不推进回合。
- 只允许 core 产生显式 `system_pass`、`timeout_pass`、`timeout_peng` 等系统动作。
- 状态签名纳入 `responseWindow.id/currentResponderIndex/responses`，防止响应变化被误判为无进展。

## 6. Bridge 协议与 AI 调度计划

**修改文件：**

- `packages/core/scripts/godot-ai-runtime-server.ts`
- `packages/core/src/bridge/godot-action-guard.ts`
- 对应 `godot-ai-runtime-server`、`godot-action-guard` 测试

### 6.1 端点行为

- `/api/game/action` 只接受当前明确等待的人类动作，必须携带 `playerId`、`responseWindowId`（响应动作）以及需要的 option ID。
- `/api/game/ai-step` 每次只推进一个可观察动作或一个系统响应，不在一次调用中吞掉整轮响应和多次出牌。
- 响应中如果轮到人类，Bridge 返回 `awaitingHumanInput=true` 和玩家0的权威 `availableActions`；Godot立即停止自动推进。
- AI 响应由 Bridge 请求策略选择，但候选只来自 `getAvailableActionsForPlayer()`；强制动作无需策略评分。
- `presentState()` 增加 `responseWindow`、`awaitingHumanInput`、`activePlayerIndex` 和 `lastTransition`。

建议响应附带：

```ts
interface GameTransition {
  id: string;
  actorPlayerIndex?: number;
  type: 'discard' | 'flip' | 'response' | 'meld' | 'pass' | 'turn' | 'hu';
  action?: PlayerAction;
  activeCard?: Card;
  meldsAdded?: Meld[];
  responseWindowId?: string;
}
```

这样 Godot 可以按事件播放动画，而不是比较两个巨大快照猜测“发生了什么”。

### 6.2 协议和恢复

- 升级 `runtimeVersion`，旧 Bridge 不得被新 Godot 静默接入。
- 持久化 `responseWindow`、响应集合、规范化动作和 transition；Bridge 重启恢复到同一等待响应者，不能重复执行强制碰或跳过窗口。
- 回放保存所有系统过、AI响应、仲裁结果和公开牌组增量；每个 transition 具有稳定 ID，重放不依赖当前 AI。

## 7. Godot 流程与动作节奏

**修改文件：**

- `scripts/ai_service.gd`
- `scripts/main.gd`
- 建议新增 `scripts/game_transition_player.gd`
- `scripts/test_runner.gd`

### 7.1 自动推进条件

当前逻辑仅以 `currentPlayerIndex != 0` 决定 AI 自动推进，需替换为服务事实：

- `awaitingHumanInput=true`：停止所有 AI 调用并展示玩家动作。
- `awaitingHumanInput=false` 且未终局：每次只请求一次 `/api/game/ai-step`。
- 收到 transition 后先入展示队列，播放完再请求下一步。
- 页面关闭、游戏 generation 改变或 Bridge 会话改变时取消未播放队列，防止旧动作覆盖新局。
- 输入锁定只发生在动画播放和 HTTP 请求期间；玩家的强制动作不能被自动推进抢走。

### 7.2 默认可读节奏

规则服务不加入 sleep；以下延时全部在 Godot 表现层：

| 步骤 | 建议默认时间 |
| --- | --- |
| AI思考提示 | 450–700 ms |
| 翻牌移动到待响应区 | 350 ms，随后停留 500 ms |
| 出牌移动到待响应区 | 300 ms，随后停留 600 ms |
| 显示“胡/招/碰/吃/过”动作字 | 250 ms 淡入，停留 500 ms |
| 组合牌从手牌/ActiveCard移动到公开区 | 450 ms，完成后停留 500 ms |
| 无响应废牌落入历史区 | 300 ms |
| 切换行动玩家高亮 | 250 ms，停留 250 ms |

设置页增加“动作节奏”：

- 清晰（默认，1.0×）
- 快速（0.6×）
- 调试跳过（0×，仅开发使用）

不使用一个全局长 sleep。每个 transition 播放完成后发出 `finished`，自动推进器才处理下一步；这样玩家能看到真实顺序，也不会因为动画未结束而丢失输入阶段。

### 7.3 响应 UI

- 待响应区明确显示：牌面、来源玩家、来源类型（“玩家2打出”/“玩家0翻出”）和剩余响应时间。
- 强制招/碰不显示“过”；按钮文案显示“必须招”“必须碰”。
- 多吃/多胡弹层必须用完整牌组预览，包含所有比牌组；提交明确 option ID。
- 系统自动过只做短暂动作提示，不弹出需要玩家点击的按钮。

## 8. 公开牌区 UI 完善

当前 `_opponent_public_melds()` 把牌组拼成一个大号数字字符串，不符合牌组识别需求。改为和手牌一致的组合牌渲染：

1. 新增可复用 `meld_group_view.tscn`，根节点为可在 Godot 编辑器中调整的 `Control`/容器组合。
2. 每个 `Meld` 显示真实牌面卡片，不再显示拼接数字；使用与手牌相同的大小写字形、红黑色和牌框。
3. 一个牌组为一列或一个紧凑块，组与组之间留固定间距；碰/吃/比为3张，招/垅为4张。
4. 吃牌的主组和比牌 `additionalMelds` 各自显示为独立牌组，按一次动作共同高亮；不能把两组数字连在一起。
5. 牌组下方或角标显示“吃、比、碰、招、垅”等类型；牌面本身保持可辨识。
6. 玩家0和玩家1/2共用同一个 renderer，避免对手区和本人公开区再次分叉。
7. 新落桌牌组播放 450 ms 汇拢动画并高亮约 600 ms；历史牌组保持静态。
8. `opponent_seat.tscn` 的公开牌槽位保留场景化锚点，内部牌组尺寸、间距和位置可以在 Godot 编辑器调整。

建议基准尺寸：公开牌单张约 `38×44 px`，仅在空间不足时整体等比缩小，不把整组退化成文字。

## 9. 测试与验收矩阵

### 9.1 core 单元与流程测试

- 出牌来源排除、自翻来源包含。
- 每个玩家独立合法动作生成。
- 胡/招/碰/吃优先级与同级座次。
- 强制招/碰不可过和超时自动执行。
- 吃+比原子落地及非法方案拒绝。
- 过张仅在放弃吃时记录。
- 翻牌不进手牌、全过轮到下家翻牌。
- 胡牌结构、胡息、点炮/自摸保持既有测试通过。

### 9.2 Bridge 测试

- `/api/game/action` 拒绝错误玩家、旧窗口 ID、旧卡牌和非法 pass，且状态不推进。
- `/api/game/ai-step` 一次只返回一个 transition。
- AI 候选全部来自目标玩家权威动作。
- 重启恢复响应窗口，不重复动作。
- 回放顺序与 `/api/game/state` 一致。

### 9.3 Godot 测试

- `awaitingHumanInput` 能阻止自动推进抢走响应。
- 强制碰场景只显示碰，不显示过。
- 多吃/比牌弹层显示全部牌组并提交正确 ID。
- transition 队列按顺序播放，generation 切换后旧队列失效。
- 公开牌区使用牌面节点而非拼接文字。

### 9.4 固定场景端到端验收

必须至少保存以下可重复 fixture，而不是依赖随机试玩：

1. 玩家0首出小六，无人响应，自动进入玩家1翻牌；玩家0不出现“过”。
2. 玩家2出大玖，玩家0持大玖对子，停在玩家0“必须碰”；确认后公开区出现三张大玖并轮到玩家0出牌。
3. 一张牌同时触发不同玩家胡/招/碰/吃，结果符合优先级。
4. 同级响应按座次头跳。
5. 吃牌需要一组或多组比牌，公开区同时出现全部组合。
6. 自翻牌可由自己吃/碰/招/胡；自己打出的牌不可响应。
7. 全局连续动作以默认清晰节奏播放，玩家能分辨“谁翻/出哪张、谁响应、落下什么牌组、下一家是谁”。

## 10. 实施顺序与完成定义

### 阶段一：规则回归用例

先加入第9节失败测试，固定现场问题和正式规则预期。未出现预期失败前不修改实现。

### 阶段二：core 响应窗口闭环

完成 `ResponseWindow`、按玩家生成动作、响应收集与仲裁，删除旧的单视角 pass 猜测路径。

### 阶段三：Bridge 协议和持久化

提供逐步 transition、明确人类等待状态，移除无条件 `advanceIfStalled()`，完成协议版本升级与恢复测试。

### 阶段四：Godot 调度与动画队列

按 transition 单步播放；默认放慢动作；保证人类响应期间不触发 AI 推进。

### 阶段五：公开牌组 UI

使用可复用牌面场景渲染本人和对手公开牌组，补齐吃+比的组合预览与落桌动画。

### 阶段六：固定 fixture 实机验收

使用 gdmcp 捕获每个 fixture 的状态、截图和日志。随机完整自走局只作为稳定性补充，不能替代规则场景验收。

完成标准：

- 两个当前现场问题均由自动测试复现并修复。
- core 不依赖 Web/Godot 遍历玩家来完成响应仲裁。
- Bridge 不会因非法或无效果动作推进回合。
- 吃、碰、招、过、比、翻、出、胡均具有独立 fixture 和端到端证据。
- Godot 中每一步动作可看清，且动画不会改变或抢跑权威状态。
- 公开牌区显示真实组合牌面，不再显示拼接数字。

## 11. gdmcp 优化建议

本次诊断发现两项可改进能力：

1. `evaluate_runtime_expression` 失败时仅返回 `Expression execution failed`，编辑器日志也没有解析位置或底层错误。建议返回表达式解析错误、行列、运行异常类型和安全截断后的堆栈。
2. `runtime nodes get --fields latest_state` 对嵌套字典会把卡牌和动作折叠为 `{}`，而完整节点又直接 `OUTPUT_TOO_LARGE`。建议支持 `--max-depth`、嵌套字段路径（如 `latest_state.availableActions`）以及 `--out`，便于只读提取大型状态。
3. 项目本地 CLI 位于 `.gdmcp/bin/gdmcp.exe`，不能用全局 PATH 查询判断是否安装。当前 CLI 在编辑器/MCP HTTP 服务未启动时返回 `SERVICE_UNREACHABLE`；建议 `doctor` 明确区分“已找到 CLI，但编辑器服务未监听”与“CLI 缺失”，并给出启动插件或检查端口的下一步。

这些优化不阻塞规则修复，但会显著提高后续固定场景调试效率。

## 12. 2026-08-15 实施记录

本轮已完成：

- core 新增显式 `ResponseWindow`，保持 `currentPlayerIndex` 为轮次归属，并用 `currentResponderIndex` 表示当前响应者。
- 出牌排除来源玩家，自翻包含来源玩家；无动作玩家系统过，所有响应收集完成后统一按“胡＞招＞碰＞吃、同级按座次”仲裁。
- 强制招/碰不再提供“过”；胡与强制动作并存时保留胡和强制后备动作。
- 修复现场“小六出牌要求自己过”和“大玖对子没有必须碰”，新增固定回归；补充招压碰、自翻来源响应、非法强制过不推进。
- 吃与比继续使用 `ChiOption.additionalMelds` 原子落桌，既有规则回归保持通过。
- 修复爆牌动作未携带弃牌导致 AI/UI 合法动作无效果的问题；每个可爆候选现在携带权威弃牌。
- Bridge 删除 `advanceIfStalled()`，模拟器删除重复响应遍历和强制换家；无效果动作明确返回冲突，不越过规则。
- Bridge 输出 `activePlayerIndex`、`awaitingHumanInput`、`lastTransition`，响应动作校验 `responseWindowId`；运行时升级为 `daer-bridge-session-v5`，持久化重放保持 transition 确定性。
- Godot 自动推进改用 `awaitingHumanInput`，首次与连续 AI 动作之间均保留 0.55 秒展示时间；响应窗口期间不会因轮次归属仍是 AI 而抢走玩家输入。
- 新增 `meld_group_view.tscn`；对手公开牌由拼接数字改为真实牌面组合，玩家公开牌继续使用牌面节点。

验证结果：

- TypeScript `tsc --noEmit` 通过。
- core 重点回归 116 条通过（规则 87、流程 9、Bridge 9、动作守卫 7、响应窗口 4）；爆牌规则子集 8/8 再验证通过。
- Godot 4.7.1 headless 编辑器导入通过；项目测试输出 `GAME_SERVICE_TESTS_PASSED`。

后续表现层增强项：

- 当前已按 transition 单步请求并留出可读停顿，尚未拆出独立 `game_transition_player.gd` 做不同动作的路径动画与速度设置。
- 当前响应窗口没有产品化倒计时；强制动作已不可过，但“超时自动招/碰”需在确定倒计时时长和暂停规则后接入。
- gdmcp 项目本地 CLI 可正常解析；本轮调用返回 `SERVICE_UNREACHABLE`，原因是编辑器/MCP HTTP 服务未运行，因此固定场景先由 Godot headless 验证，运行态截图需在编辑器服务启动后补录。

本轮“运行项目后无法开启新局”修复：

- 根因是 Godot 客户端要求 `daer-bridge-session-v5`，项目内 `bridge-server.mjs` 仍为 v4，健康握手拒绝旧运行时。
- 已重新构建 v5 Bridge，新增 `bridge/runtime-version.txt`，并让发布脚本同步写入版本清单。
- `AIService` 优先使用显式 `DAER_CORE_WORKSPACE`，否则只接受版本清单与客户端完全一致的随包 Bridge。
- 真实随包 sidecar 的 `/health` 与 `POST /api/game/new` 已通过：创建三人局后进入 `discarding`，并等待真人操作；Godot headless 项目测试再次通过。
