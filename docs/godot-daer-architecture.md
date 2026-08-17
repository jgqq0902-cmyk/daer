# Godot 版大贰架构与 AI 迁移方案

## 变更目标

将 Godot 版大贰推进为“Godot 桌面客户端 + daer 领域核心 + 本地 Node/TS Bridge”的单机产品。总体技术路线继承原版 daer 已验证的领域边界、规则资产、数据模型、动作契约、回放与测试方法；但具体实现必须适配 Godot 桌面端的场景树、进程生命周期、发布目录和本地持久化，不能将原版应用层直接嵌入 Godot。唯一不要求直接复用的是 AI 策略：它在同一服务契约下独立演进，默认使用规则条件化启发式，原版 AI 仅保留为受兼容性约束的可选适配器。

## 架构结论

### 总体技术路线

AI 不完全复用原版，不代表其余部分只做局部参考。Godot 版应遵循原版 daer 的总体技术路线：以领域核心为中心、以稳定动作契约隔离表现层、以固定种子和回放保护规则演进。复用的边界是“可验证的领域能力和契约”，不是把原版应用层直接搬入 Godot：

- **规则与状态**：`@daer/core` 是唯一权威。发牌、摸牌、出牌、吃/碰/招/胡、爆牌、结算和 `availableActions` 仅由 `GameManager` 推进；Godot 不保存或推演第二份规则状态。
- **服务契约**：本地 Node/TS 服务是 Godot 与 core 的唯一桥接。新局、动作、状态恢复、AI 单步、建议和回放快照统一走该契约，便于桌面运行、调试和未来替换 AI 实现。
- **客户端**：Godot 负责场景、牌面、手牌整理、操作、动画、弹层、回放和可视化，不承载规则判断。所有可执行控件都由 core 返回的 `availableActions` 驱动。
- **持久化与可观测性**：保存 `state/action/trace/RuleProfile`，以 core 快照重放；日志、决策 trace 与本地服务健康状态必须可查看，不能依赖 Godot 的临时 UI 状态。
- **AI**：不要求完整复用原版 AI。AI 是独立的策略层，通过 `availableActions` 和 `RuleProfile` 消费 core 状态；默认使用 Bridge 内的规则条件化快速策略，原版分析/强化策略作为可插拔适配器。两者都只能在 core 生成的合法动作集合中选择。

### 总体路线约束

“AI 不完全复用原版”是策略层的例外，而非允许其他层各自重写的理由。原版 daer 决定领域真相与演进方式；Godot 版决定桌面端实现和交付方式；guandan 只提供成熟桌面产品的进程边界、调试与回放组织参考，不能替换 daer 的领域事实来源。

| 技术面 | 统一路线 | 禁止的偏移 |
| --- | --- | --- |
| 规则和数据 | `@daer/core` 管理牌、状态机、合法动作、结算与 `RuleProfile` | Godot、Bridge 或 AI 各自维护可推进牌局的规则副本 |
| 对外协议 | Godot 仅通过版本化 HTTP/JSON Bridge 获取快照和提交动作 | UI 直接调用 core，或以界面推测补齐缺失规则字段 |
| 运行生命周期 | Godot 负责拉起、探测和重连本机 Bridge；重连后以 core 快照恢复 | 客户端在断线期间继续推演，形成两份牌局状态 |
| 配置与版本 | `RuleProfile`、`ruleVersion`、`protocolVersion` 随对局、动作和回放冻结 | 只把玩法开关或协议兼容逻辑留在 Godot 设置页 |
| 质量保障 | 固定种子、规则测试、动作守卫、状态一致性和回放重建共同验收 | 只根据牌桌“看起来能玩”判断规则正确 |
| 表现与交互 | Godot 重建桌面 UI、动画、手牌理牌、辅助说明与可访问性 | 移植原版 Web/NW.js 前端运行时，或让 UI 持有规则真相 |
| 本地交付 | Godot 发布包与随包 Bridge 共同版本化；Bridge 可由客户端探测、拉起、停止和恢复 | 硬编码开发机源码路径，或要求已打开开发环境才可运行 |

因此，每项需求按固定路径落地：先判断它是否改变规则；改变规则则先改 core 和测试，再更新 Bridge 契约与 Godot 展示；仅改变体验则只改 Godot。AI 无论采用原版适配器、启发式、rollout 还是未来模型，均从 core 当前候选中选择，并不能改变这条主链路。

### 迁移决策原则

| 问题类别 | 首要落点 | Godot 版处理原则 |
| --- | --- | --- |
| 玩法、牌型、回合、结算变化 | `@daer/core` 与规则测试 | 先修改权威规则和 `availableActions`，再由 Bridge 暴露并由 UI 呈现 |
| 协议、进程恢复、回放、错误处理 | Node/TS Bridge 与契约测试 | 保持版本化 JSON、动作守卫和可重放日志；Godot 不补算缺失状态 |
| 牌桌布局、理牌、动画、交互可用性 | Godot 场景与脚本 | 只管理视觉状态和用户输入，按服务快照重绘 |
| AI 强度、规则适配、模型替换 | AI 策略模块 | 只对 core 已生成的合法候选排序或选择，保留策略版本与降级 trace |
| 打包、安装与离线运行 | Godot 导出目录及 Bridge 分发 | 将运行时路径、端口、版本、持久化位置设计为产品配置，不能继承开发机假设 |

### 原版 daer 的复用范围

原版 daer 是 Godot 版的领域来源，而不是待整体移植的 UI 工程。迁移时按下列边界处理：

| 原版资产 | Godot 版处理方式 | 原因 |
| --- | --- | --- |
| `@daer/core` 的牌、牌型、发牌、轮转、响应窗口、结算 | 直接复用，并持续在 core 内维护 | 规则必须只有一个事实来源 |
| `GameState`、`PlayerAction`、`availableActions`、回放快照 | 作为 Bridge 的稳定 JSON 契约 | Godot 与 AI 都依赖同一动作语义 |
| 原版规则测试、固定种子用例、状态一致性用例 | 持续复用并补 Godot 集成测试 | 防止界面迁移时引入规则回归 |
| 原版前端页面、状态管理、DOM/Canvas 表现 | 不迁移；按 Godot 的场景和控件重建 | 避免双运行时、双状态机和桌面体验妥协 |
| 原版 AI 的模型、特征、训练脚本 | 不作为默认运行依赖；仅通过适配器受控接入 | 不同玩法的动作空间和训练目标未必兼容 |
| 原版服务启动、日志和回放组织经验 | 按本地 Bridge 形态借鉴 | 保留可调试性，而不把旧应用层耦合进来 |

因此，技术路线不是“把原版 daer 改写成 Godot”，而是“让 Godot 成为原版领域核心的桌面宿主”。规则变更先进入 core；界面变更只进入 Godot；策略变更只进入 AI 层。任何跨层修改都必须通过既定 JSON 契约发生。

### 复用边界与依赖方向

依赖方向固定为：

```text
Godot 表现/交互
        ↓ HTTP/JSON 服务契约
Node/TS Bridge
   ├── daer core（规则、状态、动作校验、结算）
   └── AI 策略层（默认启发式，可选原版适配器/未来模型）
```

- `@daer/core` 是规则单一事实来源，原版的发牌、摸牌、牌型识别、动作合法性、响应窗口和结算能力应直接复用或在 core 内抽取复用；Godot 不复制这些逻辑。
- Bridge 只做协议转换、生命周期管理、错误处理、日志和调试入口，不在 Bridge 中偷偷增加第二套规则或 AI 判断。
- Godot 只持有服务返回的快照和临时 UI 状态。牌面分组、理牌、动画、按钮可见性可以在 Godot 计算，但不得据此生成或放行服务未声明的动作。
- AI 与规则解耦：策略只能排序/选择 core 已给出的候选动作。改变玩法时先改 `RuleProfile` 和 core 的动作语义，再由启发式适配；只有特征、目标或动作空间兼容时才启用原版 learned policy。
- 原版前端、Lua/Python worker、ONNX 资源不作为 Godot 运行时依赖；需要比较时通过 Bridge 的统一 AI 接口调用，便于替换、回退和离线测试。

这条路线保留原版 daer 的规则资产和工程经验，同时避免把原版 AI 的训练假设、前端运行时和 Godot 客户端耦合在一起。以后即使替换 AI，也不需要改动 Godot 牌桌和 core 规则接口。

参考 guandan 的成熟工程组织，但不复用掼蛋规则、资源或策略：

- 前端层：Godot 场景、牌桌、手牌、操作栏、状态摘要、回放入口。
- Bridge 层：将规则状态整理成 Godot 可消费的牌桌状态和 AI 决策上下文。
- 运行时层：本机 Node/TS 进程加载原版 `@daer/core`，统一处理 `GameManager`、`AIPlayerAgent` 和 `AIAnalyzer`。
- 持久化层：Godot 继续通过 `PersistenceService` 写入 `user://`。

guandan 本身不是“前端 + Node/TS AI 服务”。它是 NW.js 前端壳，内嵌 Lua 规则运行时、Pyodide/Python worker 和 ONNX Runtime 资源。当前项目借用它的运行时边界、worker 调用、replay/debug 组织和桌面牌桌的信息层次；领域规则、动作语义和数据模型以 daer 为准。

### 工程与运行路线

运行时以本机离线为前提，不引入云端依赖：每次 Godot 运行使用自身 PID 与启动时钟生成 `sessionId`，从私有端口段选择本次 Bridge 端口，并按需拉起与自身匹配的 `@daer/core` 运行时。健康检查必须同时匹配 `protocolVersion`、`runtimeVersion` 和 `sessionId`；历史 Bridge 即使版本相同也不能被新前端复用。Godot 启动时将会话 ID 与父 PID 传给 Bridge，Bridge 在父进程消失时自行关闭。Godot 只通过 HTTP/JSON 请求新局、读取状态、提交动作和获取 AI 决策。Bridge 进程丢失时，Godot 重新连接后只接受 `/api/game/state` 返回的权威快照，不在客户端推算续局。

版本边界必须显式保存并参与回放、测试与 AI 兼容判定：

- `ruleVersion`：core 的规则语义版本；规则、动作或结算变化时递增。
- `protocolVersion`：Godot 与 Bridge 的 JSON 契约版本；字段不兼容时拒绝连接，而不是猜测解析。
- `runtimeVersion`：Bridge 行为与随包策略实现版本；即使 JSON 契约未变，只要 AI 执行或状态恢复语义改变也必须递增。Godot 仅连接与自身匹配的 runtime，避免连接到已运行的旧 sidecar。
- `RuleProfile`：一局冻结的玩法配置；新局、回放、AI trace 均带同一份配置快照。
- `policyVersion` 与 `featureVersion`：仅属于 AI 适配层，不能反向影响规则合法性。

推荐保持以下开发顺序和验收门槛：先在 core 定义并测试规则，再扩展 Bridge 契约，再实现 Godot 交互和可视化，最后接入或调参 AI。每次规则改动至少验证 core 类型检查、固定种子状态一致性和回放可重建；每次 Godot 交互改动至少验证服务测试、关键真人操作路径和 1280x720 桌面布局。这样 UI、规则和 AI 都可独立迭代，避免成熟项目常见的“前端修一个按钮、规则和策略同时漂移”。

## 当前实现

新增本地服务入口：

- `E:/project/daer/packages/core/scripts/godot-ai-server.ts`

服务不再使用固定共享端口；每个 Godot 会话在私有端口段启动自己的 Bridge。该端口只提供同一套版本化接口：

- `GET /health`
- `POST /api/game/new`
- `GET /api/game/state`
- `POST /api/game/action`
- `POST /api/game/ai-step`
- `POST /api/game/advice`

Godot 侧新增：

- `K:/godot/daer/scripts/ai_service.gd`

`AIService` 会自动探测并启动本机 core 服务，然后接收状态、提交动作、执行 AI 步骤和请求建议。Godot 主界面已经切换到服务驱动的牌桌布局：顶部状态条、中部桌面区、三方座位、底部手牌/操作区和 AI 建议提示。

当前阶段的默认运行边界是“Godot + 本地 Bridge 内规则条件化启发式 + core”：Godot 只呈现 core 返回的 `availableActions`、收集玩家输入并提交请求；弃牌评分、强制动作、胡牌、过牌和 trace 均由 Bridge 中的 `AIPlayerAgent(mode=fast)` 完成，再由 core 校验并推进状态。原版 `AIPlayerAgent`、`AIAnalyzer` 和 `/api/game/ai-step` 保留为可插拔接口，但 UI 不依赖任何特定策略实现。

规则条件化启发式由 Bridge 内的 `fast` 策略实现：对子/坎保留、顺子连接、二七十潜力、红牌价值和剩余牌压力进入弃牌评分；强制动作、胡牌、招/碰/吃、摸牌和过牌按 `availableActions` 的规则条件优先级处理。每步动作保存 `policySource=heuristic`、`policyVersion=rule-conditioned-fast-v1` 及决策 trace，供回放解释。

每条 trace 记录最终动作牌、排序后的合法候选、指标与简短理由。牌桌的“AI 决策”面板和回放只消费该已保存数据，不在 Godot 层重算策略。

设置页默认仍展示规则条件化本地启发式；原版 AI 不作为默认模式切换，而是在牌桌中以单步入口显式调用，便于比较和调试，不改变主流程的确定性。

当前交互约束：

- 出牌候选在 UI 中合并为单一“出牌”主按钮；实际选择的手牌对象会原样提交给 core。
- 吃、胡有多个合法选项时，Godot 弹出选项面板供玩家明确选择，不再静默采用第一个候选。
- 当前“推进 AI”默认使用规则条件化本地启发式；牌桌另提供“原版 AI 单步”受控入口，直接调用原版 `/api/game/ai-step` 的 `learned` 模式。两条路径都只提交 core 返回并校验的当前合法动作。
- 当 core 将多个吃牌或胡牌方式聚合在同一个动作内时，本地启发式必须先将每个 `chiOption`/`huOption` 展开为独立候选，再完成评分、trace 和提交；最终请求须携带所选 option ID 与牌组，不能依赖 core 静默采用第一个组合。
- AI 回合连续推进至玩家回合，并有重复调用保护；每步动作与 AI trace 保存到回放记录。
- `GET /api/game/state` 可恢复或调试当前 core 权威状态；新局、玩家动作和 AI 动作均通过服务返回下一状态。
- Godot 的 `AIService.refresh_state()` 会在运行时重新连接后从 `GET /api/game/state` 恢复权威快照，避免服务调试或恢复后 UI 停留在旧局面。
- 本地服务请求失败会立即标记离线；Godot 通过单一恢复调度重新探测并启动服务。Bridge 正式入口默认将“固定 seed + 规范化动作日志”写入 `packages/core/.daer/godot-game-state.json`，进程重启时由同一个 `GameManager` 重放动作恢复状态；Godot 仍只读取 `/api/game/state`，绝不在客户端续算。快照版本、规则实现或动作语义不兼容时，Bridge 丢弃无效快照并要求开始新局，不能静默猜测恢复。
- Godot 启动后会后台预热本地规则服务；用户在预热完成前点击开始一局时，会等待同一个启动任务，不再重复启动或误报“服务未就绪”。
- 每局以固定回放 ID 持续更新同一个 `user://replays/replay_*.json` 文件；复盘页可加载最近记录、逐步前后切换，并以保存的 core state 只读渲染牌桌与 AI trace。
- 进入复盘页时会主动关闭结算、建议和选项弹层；步进控件与运行时调用共用同一组前进/后退方法，保证从终局退回到任一历史步骤后，座位、弃牌、公开 meld 与回合提示同时按保存的 core state 重绘。
- 牌局结束只以 core 的 `isGameOver`、`winnerIndex`、`winType` 和各玩家 `totalScore` 驱动结算面板；AI 动作的 trace 可在牌桌中打开查看策略来源、最终选择和候选摘要。
- 服务会保存最近三步的权威动作记录，牌桌中心展示“谁做了什么”；玩家动作交给 AI 的回合会自动推进至下一次玩家决策，完整 AI 演示期间则锁定实时操作栏，避免并发动作。
- `AI 建议` 由 `/api/game/advice` 的原版分析结果驱动，使用独立面板展示牌力、估计胜率、风险、策略建议及前三个候选动作；它只提供参考，不会替玩家直接提交动作。
- 建议面板同时显示策略来源：`medium` 显示“规则分析”，`learned` 显示“原版强化策略”，并展示返回的 policy 版本；缺少来源字段时安全回退为“规则分析”。
- 设置页将“对手默认策略”和“AI 建议分析模式”分开：对手始终由规则条件化本地启发式推进；`fast` / `medium` / `learned` 只影响玩家主动点击“AI 建议”时的分析请求，避免设置项与实际对局行为不一致。
- 牌桌状态栏直接显示本局底牌配置与当前“AI 建议”分析模式，避免玩家必须返回设置页才能确认这两项会影响判断的对局信息。
- core state 中的公开 `melds` 会在三方座位及玩家区直接渲染为小牌列和牌型标签，吃、碰、招、坎、顺与二七十等组合不再只存在于规则状态中。
- 玩家手牌按本地可识别的“提/坎、顺、二七十、对子、散牌”分组展示为纵向牌列；每张牌仍是独立可点击控件，分组只改变视觉组织，不改变提交给 core 的牌对象。
- 牌面只显示小写或大写数值，不再显示“大/小”前缀；使用开源书写字体 `MaShanZheng-Regular.ttf`，维持红黑牌色和角标。玩家区的固定高度为标题、四张叠放牌列和组合标签留出空间，操作栏固定在其下方。
- 选中手牌会在固定槽位中向上提起 12 像素并显示金色描边；选择反馈不改变组合列高度，避免重排后压住相邻牌或操作栏。
- 当玩家处于 core 的 `response_collecting` 阶段时，操作栏会显示“响应某座位打出的某牌”；提示只读取 `discardPile.lastDiscard` 与 `lastDiscardPlayerIndex`，摸牌、出牌等其他阶段不显示，避免把旧弃牌误当作待响应目标。
- 高风险键盘操作受当前 core 状态约束：`Enter` 仅在已选中的牌实际存在于 `availableActions.discard` 中时出牌；`Space` 仅在存在合法 `pass` 动作时过牌；`Esc` 只取消当前选牌或关闭弹层。AI 回合、终局、演示与弹层之外的页面不会提交牌局动作。
- 牌桌中心基于 core 的 `discardPile.discardHistory` 渲染最近 8 张弃牌，并标注出牌方；弃牌时间线与行动记录、公开 meld 一起构成可读的桌面局势信息。
- 对手座位渲染为“名称、剩余张数、当前行动状态、隐藏背牌扇形和公开组合”；只有牌数、行动状态与公开组合来自 core，隐藏牌面不会泄露对手手牌。

## 多玩法 AI 策略

### 结论

不必为每个设置组合都预训练一套模型。应把 AI 分为“规则无关的决策骨架”和“玩法相关的规则参数”两部分：所有玩法共用原版 daer 的合法动作、手牌结构分析、候选排序、风险控制和兜底逻辑；玩法差异只通过规则配置、权重和阈值进入决策。

当前原版 AI 内核已有三个实际运行模式，Godot 服务直接使用这三个模式：

- `fast`：纯结构启发式。优先执行强制动作和胡牌；出牌时保留对子、同值牌、顺子连接和红牌价值，适合作为所有规则下必定可用的快速兜底。
- `medium`：规则引擎生成合法动作后，调用 `AIAnalyzer` 对候选进行牌效、胡息、风险和响应收益排序；当分析结果不能映射到合法动作时，回退到规则优先级动作。
- `learned`：在 `medium` 的分析框架上使用原版 policy artifact 给候选加权。它不是规则引擎，也不能绕过合法动作校验；模型不可用或不兼容时必须退回 `medium`，而不是输出旧模型偏好的非法动作。

因此，产品层不应再额外定义与代码脱节的 `generic` 或 `original` 模式。设置页可将其呈现为：

| 面向用户的选项 | 实际执行模式 | 适用场景 |
| --- | --- | --- |
| 稳定通用 | `fast` | 新玩法、规则组合多、低性能设备、需要确定性行为 |
| 平衡分析 | `medium` | 默认模式；不依赖预训练，适配已参数化的玩法差异 |
| 原版强化 | `learned` | 与原版训练规则、特征和目标兼容时启用 |

### 无需预训练的通用决策链

```text
玩法配置
  -> RuleProfile 归一化
  -> GameManager 生成唯一合法动作集
  -> 强制动作 / 可胡动作优先
  -> 手牌结构分析（坎、对、顺、散牌、进张）
  -> 候选评分（牌效、胡息、风险、局势、响应收益）
  -> 可选的受预算限制 rollout
  -> 合法性归一化与规则优先级兜底
  -> 最终动作 + 可解释 trace
```

这条链路中，动作空间始终由 `GameManager` 给出，AI 只对其中候选评分。这样即使“可吃限制、胡息门槛、红黑牌计分、爆牌条件、底牌数、响应优先级”等设置变化，AI 也不会因为不理解新限制而主动出非法牌。

这里的“不需预训练”指的是无需为每个配置组合重新训练，不能理解为所有规则变化下 AI 强度完全不变。`medium` 与 `fast` 可立即保证合法、可解释和基本牌效；当某玩法改变了核心动作语义、胡牌目标或牌组分布时，应先使用参数校准、rollout 和对局基准测试评估强度，再决定是否值得训练专属 policy。

### RuleProfile：把多玩法差异收敛为配置

每局开始时，前端将玩法和设置冻结成一个可序列化的 `RuleProfile`，随新局、回放和 AI 请求一同保存。至少包含：

- `ruleVersion`：规则语义版本，而不是 UI 中的玩法名称。
- `variantId`：基础玩法，例如经典、跑胡或自定义玩法。
- `scoring`：胡息门槛、红黑牌、名堂、封顶和结算权重。
- `actions`：吃、碰、招、偎、提、胡、过牌等动作是否启用及其优先级。
- `response`：响应窗口、多人争抢和强制响应规则。
- `deck`：牌组构成、底牌数、庄家起手数和补牌规则。
- `aiTuning`：进攻、防守、胡息、牌效、响应门槛和 rollout 预算的权重。

禁止将设置项仅保留在 Godot UI 中。真正影响规则的设置必须先进入 core 的规则配置，再由 core 生成状态与 `availableActions`；Godot 只展示该权威状态。

### 可复用评分模型

`medium` 的候选分数应按 RuleProfile 参数化，而不是为每一种玩法写独立 AI：

```text
score(action) =
  w_structure * 手牌完成度与进张
+ w_score     * 可兑现胡息与名堂潜力
+ w_tempo     * 摸打节奏和剩余牌压力
- w_risk      * 放炮、暴露与对手威胁
+ w_response  * 吃/碰/招相对过牌的净收益
```

其中 `w_*`、胡息计算、风险阈值和响应最低收益来自 RuleProfile。先使用人工可解释的默认权重，后续可根据对局日志只调整权重或阈值；这类校准不等同于重新训练模型。

实时桌面服务对 `medium` 的弃牌分析候选设置 8 张上限，避免首轮把整手牌全部送入昂贵分析；最终动作仍由 `GameManager.availableActions` 校验，候选截断不会改变规则合法性。离线评估和训练脚本可以使用更大的候选集。

在牌局后段或候选很接近时，可只对前 `K` 个合法候选做短预算 rollout。rollout 必须通过同一个 GameManager 推进模拟局面，并采用 `fast` 作为默认策略。它提高复杂规则下的局面适应性，但必须限制时间/次数，避免拖慢 Godot 牌桌交互。

### learned policy 的兼容与降级

规则变化需要随 policy artifact 携带：

- `ruleVersion`
- `featureVersion`
- `policyVersion`
- `objectiveVersion`：训练目标，例如胜率、期望胡息或风险偏好。

可继续使用原版 `learned` 的情况：牌组、合法动作语义、主要胡牌条件和特征定义未变，只是底牌数、起手随机性、计分倍率或少量阈值调整。此时模型只作为排序加权，仍由 RuleProfile 的规则和 `medium` 评分校正。

必须禁用 learned、自动降级到 `medium` 的情况：新增/删除动作；吃、碰、招、胡的语义或优先级变化；牌组构成改变；胡牌判定或主要计分目标改变；特征含义改变。这些变更会使旧 policy 的输入分布或优化目标失真。不是因为服务无法运行，而是为了避免“合法但明显不适合该玩法”的出牌。

降级顺序固定为：

```text
兼容的 learned policy
  -> medium（规则条件化分析）
  -> fast（纯启发式与规则兜底）
```

每次 AI 决策的 `trace` 必须记录实际 `policySource`、版本、降级原因、候选和最终动作。这样玩家和开发者能区分“模型判断”与“规则强制/安全兜底”。

### 推荐落地顺序

1. 先把现有四五种玩法整理成 RuleProfile，并让 GameManager 按配置生成状态和合法动作。
2. 将 `medium` 中的评分常量迁入 `aiTuning`，为各玩法提供人工校准的默认预设。
3. 以 `medium` 作为 Godot 默认 AI，`fast` 作为即时兜底；先采集回放、胜率和动作 trace，不训练新模型。
4. 对每个 RuleProfile 做合法性、单局回放和对局胜率基准测试，确认通用策略足够稳定。
5. 只有某一玩法长期表现不足，才用该玩法的日志做离线微调或训练专属 policy；产物必须带完整兼容性元数据。

## 后续目录目标

```text
K:/godot/daer
  scenes/{home,table,replay,debug}
  scripts/{app,ui,bridge,services,runtime}
  data/{ai,replay,saves}
```

推荐逐步补齐：

- `BoardViewModel`
- `AIDecisionContext`
- `ReplayViewModel`
- `replay.tscn`
- `ai_lab.tscn`
- `rule_debug.tscn`

## 验收标准

### 已验证

1. Godot headless editor scan 通过。
2. Godot `-- --test` 通过，现有 `GAME_SERVICE_TESTS_PASSED` 保持通过。
3. `pnpm --dir packages/core run type-check` 通过。
4. 本地 AI 服务能创建三人局，`GET /api/game/state` 能返回权威状态，并能返回 `medium` / `learned` policy 决策摘要与动作。
5. 已用实际 Godot 运行时截图检查 1280x720 首页和牌桌布局，并据此修复了重复出牌按钮挤压桌面的缺陷；修正后的脚本已通过 Godot 无界面加载与测试。
6. 已实测真人回合链路：玩家从 core 返回的合法弃牌中提交一张牌，进入响应窗口并提交“过”；两席 AI 依次按 `medium` 策略执行摸牌、吃牌、出牌和过牌，牌局回到玩家的摸牌回合。全过程只使用 `/api/game/action` 与 `/api/game/ai-step` 返回的权威状态。
7. 已实测本地启发式链路：玩家提交 core 返回的合法弃牌后，牌数从 21 变为 20；响应过牌后轮到 AI，两席 AI 从 `availableActions` 中选择并通过 `/api/game/action` 推进，牌局回到玩家回合。实机 1280x720 截图确认中心区、纵向手牌列和操作栏互不遮挡。
8. 已通过 Godot 运行时截图验证选择首张手牌：卡牌在组牌列中上提，出牌主按钮由禁用转为可用，且相邻牌列与底部操作栏不发生重排或遮挡。
9. 响应上下文的自动测试覆盖：`response_collecting` 时正确显示弃牌来源和目标牌，普通摸牌阶段不显示该提示；实测 core 在无玩家可选响应时自动推进到下一席摸牌，不向 UI 伪造响应状态。
10. 键盘操作的自动测试覆盖：选中 ID 必须匹配 core 返回的合法弃牌动作；空选牌或失效 ID 不会触发出牌。
11. 已实测原版 `/api/game/ai-step` 的 `learned` 调用：AI 1 在摸牌阶段返回 `draw`，trace 为 `policySource=learned`、`policyVersion=learned-runtime`，core 随后进入响应阶段。
12. 已验证底牌设置链路：Godot 设置页显示当前值并注明“新局生效”，`POST /api/game/new` 将 0/1/2 张传入 core；固定种子三人局返回可摸牌山分别为 19/18/17 张。修复了 core 在底牌数为 0 时因 `slice(0, -0)` 错误返回空牌山的问题。
13. 本地启发式回归测试覆盖多吃牌组合：每个 `chiOption` 独立参与候选评分，最终动作携带匹配的 `chiOptionId` 与 `selectedCards`，决策 trace 同步显示该组合。
14. 1280x720 运行时截图复核：三方座位、中心弃牌、阶段/行动摘要、纵向组合手牌和操作栏可同时完整显示；中心区改为紧凑信息带，弃牌历史以悬停说明保留出牌方，避免行动记录被玩家区截断。
15. 实机回合验证：玩家选择并出牌后，响应窗口正确显示目标弃牌；玩家过牌后，两席本地启发式 AI 可连续执行吃、出、过并返回玩家摸牌回合，公开 meld、牌数、中心行动记录和 AI 决策入口与 core 状态同步。
16. 桌面尺寸适配：项目窗口允许调整大小并保持 1280x720 逻辑桌面等比缩放；牌桌内部采用对手、中心、手牌、操作栏的比例锚点，紧凑高度下缩小中心弃牌并降低手牌最小高度，避免固定底部偏移造成区域重叠。默认 1280x720 运行时截图复核无布局回归。
17. 自动回合接续：服务返回 AI 当前回合时，Godot 在非演示、非分析、非终局且未在推进的条件下自动请求 Bridge 的规则条件化 AI，直到玩家再次可操作；保留“推进 AI”和“原版 AI 单步”作为调试入口。实机验证玩家出牌、玩家过牌后，AI 无需额外点击即可连续吃、出、过并回到玩家摸牌回合。
18. 回放起点：`/api/game/new` 返回权威状态后立即写入同一回放文件的 `start` 步骤，包含初始手牌、牌山和回合 0 快照；之后动作持续追加。复盘页将该步显示为“开局”，并只展示最近四局切换入口，避免历史文件积累后挤压步进控件。实际保存文件验证：零动作新局已包含 1 个 `start` 步骤和 3 名玩家。
19. 完整 AI 演示：在线服务已不再在每个 AI 单步前重复健康探测，请求失败才进入完整恢复流程；演示启动即锁定演示状态，避免新局状态回调与演示循环并发使用同一 `HTTPRequest`。牌桌提供“停止演示”以安全结束后续循环。实机验证本地启发式完整演示无 `Busy` 请求冲突，推进至第 18 回合流局并显示结算面板；保存回放共 57 步，首步 `start`、末步 `pass`、终局状态来自 core。
20. Bridge 合法性门控：`/api/game/action` 先将请求与当前 core `availableActions` 比对，弃牌逐张校验、吃牌校验 option ID 或牌组、依赖吃牌落地的胡牌必须指定合法 option ID；非法或过期动作返回 400 并原样保留权威状态。仅合法动作在 core 状态签名未变化时才允许 Bridge 的防卡死回合推进，避免无效 UI 请求跳过规则流程。
21. Bridge 动作门控已抽为独立的 TypeScript 模块，并由 Vitest 覆盖非法弃牌拒绝与 core 当前合法弃牌放行；Godot 运行时以自身 `AIService.new_game()` 开局后，实测渲染三方座位、牌山、纵向组合手牌、操作栏与本地服务在线状态。
22. 真人回合链路已实测：Godot `AIService` 提交玩家合法弃牌后，core 进入 `response_collecting` 并返回合法“过”；玩家过牌后，AI 1 自动执行摸/过/出，服务进入 AI 2 的出牌阶段；AI 2 的合法弃牌可继续由同一 Bridge 接受并进入下一响应窗口。所有阶段、弃牌历史和可用动作均来自 core 快照。
23. Godot 的多吃、多胡选项均由当前 `availableActions` 的 `chiOptions`/`huOptions` 构造请求；UI 仅接受当前动作中存在的 option ID，过期或伪造选项会在客户端拒绝，并由测试覆盖选中第二个吃牌、胡牌选项及过期选项拒绝。
24. 1280x720 牌桌底部采用独立的手牌显示区和操作通道：纵向组合牌列被裁切在手牌面板内，`AI 建议`、出牌及返回按钮始终位于下方独立区域。重启运行时后的实际截图确认牌列不会覆盖操作按钮。
25. 完整终局回放已用 57 步权威记录验证：首步为 `start`、末步为 `pass` 且状态为 `ended`，含 AI trace；Godot 可渲染终局牌桌和逐步复盘。中心弃牌改用清晰数值字形，避免毛笔字体的大尺寸数字产生歧义，手牌仍保留毛笔牌面。
26. 牌桌状态变更增加仅表现层的轻量反馈：服务返回新弃牌时，中心牌短暂缩放淡入；轮到新席位时，该席位面板短暂强调。动画不保存、不参与回放状态、不生成动作，也不影响 core 的规则推进。实机状态更新后中心弃牌、响应提示和操作栏均与 core 快照一致。
27. Bridge 合法性门控同时校验动作发起者必须等于 core 当前行动玩家；客户端显式传入的越权 `playerId`、以及未来策略适配器返回的越权动作都会在 `processAction` 前拒绝，不能触发防卡死回合推进。Vitest 覆盖合法弃牌伪装为非当前玩家的拒绝路径。
28. 对外 Bridge 的吃牌请求必须携带当前 `chiOptions` 中的明确 `chiOptionId`；不再按所带牌组猜测方案。core 内部仍保留旧调用的兼容处理，但 Godot UI、Bridge 内的规则条件化策略和其他策略适配器统一提交显式 ID，保证多选项可追踪、可回放且不会静默落到首个方案。
29. Bridge 在放行动作前会以 core 当前快照规范化卡牌：弃牌替换为当前合法弃牌对象，吃牌和带选项胡牌替换为对应 option 的标准牌组。HTTP 回显、Godot 回放步骤和 core 实际执行使用同一动作事实，不能被请求体内同 ID 的伪造牌面污染。
30. `GET /health` 现在返回 `protocolVersion=daer-godot-v1`；Godot 仅在该值匹配时建立服务连接。缺失或不兼容版本会阻止后续请求和重复拉起进程，并提示同时更新 Godot 与 core，落实本地协议协商边界。
31. Godot Bridge 已具备服务级集成测试：临时本机服务验证协议协商、固定三人开局、客户端伪造牌面规范化、当前席位 AI 单步和 `decision.trace` 同步返回。正式 Godot 重启后实测 `learned` 策略通过该 Bridge 返回合法动作、策略来源和版本；若 learned 运行时返回失败，Bridge 自动改用 `medium`，并在 trace 写明 `learned_runtime_failed`，不会让牌桌因可选策略失效而中断。
32. Bridge 守卫会按具体弃牌 ID 匹配 core 的多个 `discard` 候选，不能再把同一类型的首个动作误当成唯一动作。固定种子整局自走实测已从开局推进至第 18 回合流局、牌山归零；服务级回归会持续推进 AI 至 `ended`，并验证每步 trace 都声明来自当前 `availableActions`。
33. 牌桌状态栏、AI 决策弹层与回放步骤摘要共用同一份已保存 trace，显示实际的“原版强化策略 / 规则条件化 / 安全降级”来源、策略版本与降级说明；不再将所有对局笼统标为本地启发式。Godot 自动测试覆盖三种策略来源的映射，展示层不参与规则或策略选择。
34. AI 决策候选根据 trace 的实际字段显示指标：learned/medium 优先显示预测胜率与期望分，带有优先级时显示优先级，本地策略才显示启发式分数，避免不同策略被错误地统一显示为 `0.0 分`。
35. 复盘页会按最后一份权威 state 标记“进行中/已结束”，并显示总步骤数和已保存的 AI 决策 trace 数量。实际 1280x720 截图验证只有开局快照的记录会明确显示“进行中 · 1 个步骤 · 0 条 AI 决策”，避免与完整终局复盘混淆。
36. Bridge 对 `learned` 有两条安全降级路径：运行时失败时降为 `medium`，以及 learned 虽返回成功但动作不能映射到当前 core `availableActions` 时降为 `medium`。后者会记录 `learned_illegal_action`，Godot 显示可读说明；服务级测试以伪造 learned 动作验证 Bridge 仍只执行 medium 返回的合法核心动作。
37. 复盘控制区新增“本步 AI 决策”：只在当前保存步骤带有 `decision.trace` 时启用，直接打开该历史 trace 的策略、候选、指标和降级说明，不读取或重算实时 AI 状态。无 AI trace 的开局/玩家步骤保持禁用；1280x720 实际截图确认控制栏与步骤导航不重叠。
38. Godot 决策面板兼容两种 trace 牌面表示：本地规则条件化启发式保存完整牌对象，core learned/medium 保存紧凑编码（如 `S6`、`B10`）。展示层统一转换为“小6 / 大10”等可读牌面，未知文本原样保留；测试覆盖两种来源，避免原版策略候选或所选牌显示为空白。
39. core learned/medium 已有的 tutor trace 现由 Godot 决策弹层消费：在判断后显示“牌效与进张、做牌与算账、防守与风险”三项诊断及最多两条要点；本地启发式没有 tutor 时不虚构该区域。真实 learned trace 的 1280x720 截图确认紧凑牌面、三项教学内容、候选胜率/期望分均完整可读。
40. Bridge 在 core `isGameOver` 后拒绝 `/api/game/action` 与 `/api/game/ai-step`，返回 `409` 及原始终局快照；`/api/game/state` 继续允许读取供结算和复盘使用。整局 AI 自走服务测试覆盖终局后的两类请求，保证终局不会再被追加伪动作或伪决策。
41. Bridge 在 core `isGameOver` 后同样拒绝 `/api/game/advice`，返回 `409` 及原始终局快照；结算和复盘仍通过 `/api/game/state` 读取。服务级回归覆盖终局后的 advice 请求，保证建议、动作和 AI 推进对终局状态采用一致的生命周期约束。
42. 当前 Godot 运行时已用真实桌面输入完成真人链路：点击“开始一局”创建新局，选择纵向手牌并提交“出牌”，进入 `response_collecting` 后点击“过”；Bridge 返回的权威状态显示回合继续推进，AI 自动完成后续摸牌/出牌并回到玩家可操作阶段。截图同时确认选牌上提、响应目标提示、AI 弃牌和底部操作栏均可见且不重叠。
43. Bridge 已实现跨进程恢复：正式 `godot-ai-server.ts` 默认持久化固定 seed、游戏配置和每个已规范化动作；重启 `createGodotAiRuntimeServer` 后由 core `GameManager` 重放日志，恢复后的阶段、玩家手牌、弃牌历史、牌山数量和 `availableActions` 与关闭前一致（非语义性的 `passedPlays.timestamp` 除外）。Vitest 覆盖服务关闭后重新启动并读取 `/api/game/state` 的恢复路径。
44. Godot 冷启动已接入恢复：预热本机 Bridge 后检查 `/health.activeGame`，存在活动局时读取 `/api/game/state` 并直接进入牌桌，而不是停留在首页或新开一局。实机重启 Godot 后自动恢复到第 3 回合的进行中牌局，显示恢复提示、对手公开组合、玩家纵向手牌和当前“摸牌”操作；Godot 离线测试覆盖有/无活动局的恢复判定。
45. AI 建议来源审计已完成：Bridge 对 `mode=learned` 的真实请求返回推荐项顶层 `policySource=learned` 与 `policyVersion=learned-v1-*`；Godot 默认设置仍为 `medium`，因此默认弹层显示“规则分析”是预期行为。表现层现在同时支持从 `recommendations` 或 `rankedActions.recommendation` 读取来源和版本，并由离线测试覆盖，避免在切换 learned 后错误回退为规则分析。
46. Bridge 持久化文件现同时保存 `replaySteps`，提供只读 `GET /api/game/replay`；新局、玩家动作和 AI 动作都会写入权威 state/action（AI 步骤保留 decision trace）。Godot 冷启动或服务重连时同步读取该接口，恢复牌局的同时恢复逐步复盘数据；兼容旧版 `version=1` 文件时由动作日志补建步骤。服务测试覆盖重启前后开局步骤、动作步骤和 state 一致性。
47. 实机跨进程回放验收已完成：正式 Bridge 创建固定种子新局后，提交一张由 `availableActions` 提供的合法弃牌，`GET /api/game/replay` 从 1 步增加到 2 步，末步动作类型为 `discard`，末步 `state.phase` 与 `GET /api/game/state` 同为 `response_collecting`；停止并重新启动正式 Bridge 后，`/health.activeGame=true`，回放仍为 2 步且状态一致，证明持久化回放不是仅存在于进程内存。
48. Godot 牌桌已将“对手默认策略”与“AI 建议分析模式”分离：设置页可选择规则条件化或原版强化，对手策略状态显示在牌桌状态栏；自动推进统一通过 `/api/game/ai-step`：规则条件化映射为 Bridge 内 `fast`，原版强化映射为 `learned`。两条路径均不改变 core 规则和动作契约，离线回归覆盖运行时开关。
49. 牌面显示已统一为纯数字：手牌、中心弃牌、响应提示、动作记录和普通 AI 展示均使用 `1` 到 `10`，不再显示“大/小 + 数字”；大小仍保留在 core 卡牌数据和分组逻辑中，红黑颜色、纵向组合和牌背承担视觉区分。1280×720 实机截图确认数字毛笔牌面、组合标签和操作区均未重叠。
50. Godot 自主启动整局演示已实测：从 Godot 首页发起新局后，Bridge 创建权威状态，规则条件化对手自动连续推进至第 18 回合流局，`GET /api/game/replay` 保存 57 步，终局面板、回放入口和纵向手牌均正常显示。期间新增局同步保护：创建新局时先清空旧客户端快照，待 Bridge 返回新 state 后恢复交互，避免旧牌面与新牌局请求交叉。
51. learned 调用链已完成运行时自检：Godot 的“原版强化”开关会同步设置 `AIService.use_local_heuristic=false`，自动推进走 `/api/game/ai-step`；Bridge 单步真实返回 `decision.trace.policySource=learned` 和 `policyVersion=learned-v1-*`。同时修复了测试夹具未构建 UI 时切换策略产生的脚本错误，策略设置现在可在界面初始化前安全修改。
52. Godot learned 端到端实测完成：运行中的 Godot 将对手切换为“原版强化”后，直接通过 `AIService.run_ai_step("learned")` 推进；Bridge 回放从 1 步变为 2 步，新增步骤保存 `decision.trace.policySource=learned` 与真实策略摘要，1280×720 截图显示状态栏“对手：原版强化”、中心弃牌和响应操作。Bridge 同时新增 `learned_policy_fallback` 审计：learned 请求在强制爆/胡等局面内部落到规则分析时，trace 明确标记为安全降级并写入原因和可读摘要；服务测试覆盖该路径。
53. 手牌理牌已成为真实可用设置：默认“组合理牌”按坎、顺、二七十、对子等结构纵向排列；“按牌序”改为按小写/大写及数字排序的独立横向牌列，并保留水平滚动。两种模式只影响 Godot 表现，不改变 core 手牌、动作候选或 AI 输入；1280×720 实机截图验证两种布局均不会遮挡底部操作栏，Godot 离线测试覆盖切换结果。
54. 牌局内已提供高频理牌切换：玩家手牌区右上角显示 `理牌：组/序`，单击即可在组合理牌和按牌序间切换，并立即重绘当前权威手牌。1280×720 实机截图验证切换按钮、行动提示、手牌与底部 AI 建议/出牌栏同时可见；该操作只修改 Godot 本地展示偏好。
55. Windows 桌面交付不再允许 `AIService` 硬编码开发机的 core 工作区。启动优先级固定为 `DAER_GODOT_BRIDGE_COMMAND`（调试覆盖）、显式 `DAER_CORE_WORKSPACE`（开发环境）、导出程序旁 `bridge/daer-ai-server.cmd`（发布 sidecar）；三者皆不存在时明确失败。这样开发者显式指定源码工作区时不会误用项目内过期 bundle，未设置开发覆盖时仍使用自足的发布 sidecar。随包脚本携带 Node 运行时与由 core/Bridge 构建出的单文件 `bridge-server.mjs`，不依赖 pnpm、tsx 或工作区 `node_modules`；续局文件写入 `%LOCALAPPDATA%\\DaerTraining\\bridge`，不污染安装目录。`tools/package-windows-release.ps1` 负责 Godot Windows 导出和 Bridge bundle 构建。
56. 发布 sidecar 已完成实机独立验收：`tools/package-windows-release.ps1 -SkipGodotExport` 在 `K:/godot/daer/build/bridge-sidecar-check/bridge` 生成 `runtime/node.exe`、`bridge-server.mjs`（约 300 KB）和启动脚本。该目录以自身 `node.exe` 在临时端口启动后，`/health` 返回 `runtime=daer-core` 与 `protocolVersion=daer-godot-v1`；固定 seed 新局返回 3 名玩家，`/api/game/ai-step` 的 `learned` 请求返回合法 `discard` 和 `policySource=learned`。这证明 AI 策略运行不依赖 `E:/project/daer`、pnpm 或 tsx 工作区。完整 Godot Windows 导出尚待本机安装 4.7.1 Windows export templates 后执行。
57. 牌桌操作区按成熟桌游桌面端的信息层次补齐“行动台”：底栏基于 core 当前 `availableActions` 显示真人/AI 回合、响应上下文、合法动作数和选牌状态；真人出牌按钮在未选牌时明确提示“请选择一张手牌”，选中后显示“出牌 数字”。同一权威提示提升至手牌标题区，保证 1280×720 紧凑布局下仍能在手牌旁直接看到“请选择一张手牌出牌”“已选 X · Enter 出牌”或响应目标。Godot 离线测试覆盖真人出牌、选牌、响应和 AI 回合的提示文本；本轮运行时截图因环境中多个历史 Godot 实例而不作为视觉验收依据。
58. AI 建议从只读说明升级为受控手牌辅助：建议弹层对 `discard` 推荐提供“选中此牌”，但仅在建议携带的卡牌实例 ID 同时存在于当前 core `availableActions.discard.cards` 时才显示和应用；操作仅更新 Godot 的选中态，用户仍需点击主按钮或按 Enter，Bridge 仍会再次校验动作。伪造 ID、过期建议和非弃牌建议均拒绝应用。真实 Bridge learned 建议验收确认推荐牌 `card_拾_big_78` 带实例 ID 且存在于当前合法弃牌集合；Godot 离线回归覆盖三类拒绝情况。
59. 默认规则条件化策略已归并至 Bridge：Godot 不再对 `availableActions` 展开、打分、选择或补写本地 decision trace；设置中的“规则条件化”映射为 `/api/game/ai-step` 的 core `fast` 模式，“原版强化”映射为 `learned`。Bridge 为 fast 步骤统一保存 `policySource=heuristic`、`policyVersion=rule-conditioned-fast-v1`、合法性结果与回放步骤。core Bridge 回归覆盖 fast trace 和 replay，Godot 回归确认客户端不再保留本地策略实现。
60. 当前源码 Bridge 的独立运行验收：临时端口创建固定 seed 三人局后调用 `mode=fast`，返回合法 `discard`、`policySource=heuristic`、`policyVersion=rule-conditioned-fast-v1`，并在第二条 replay step 保存同一份 trace。已有 `48152` 旧服务进程返回的历史 `fallback/heuristic-baseline` trace 不能作为新代码证据；开发或发布更新后需要重启 Bridge 才会加载新策略版本，Godot 保持对旧 trace 的兼容显示。
61. Bridge 健康握手新增 `runtimeVersion=daer-bridge-fast-v2`，与既有 `protocolVersion` 分工：前者锁定随包 AI/Bridge 行为，后者锁定 JSON 字段。Godot 只有两个版本都匹配才会建立连接或恢复活动牌局；缺失 runtimeVersion 的旧 `48152` 服务被实测拒绝，当前源码临时 Bridge 返回匹配版本后被接受。core 12 项 Bridge/action-guard 回归及 Godot 离线回归通过。
62. 旧 Bridge 端口隔离：Godot 优先使用 `48152`；若其健康响应的 `protocolVersion` 或 `runtimeVersion` 不匹配，则不终止用户正在运行的旧服务，改在 `48162` 拉起当前包的 Bridge；该端口无法使用时回退 `48163`，并通过 `DAER_GODOT_STATE_FILE` 使用同端口命名的独立状态文件。随包启动脚本只在调用方未提供状态文件时才应用默认文件。这样版本不兼容时不会误恢复旧牌局，也不会因端口占用而使当前桌面包无法启动。
63. 完整流程验收：使用重新构建的独立 sidecar（`runtimeVersion=daer-bridge-fast-v2`）在 `48163` 创建固定 seed 三人局；玩家提交第一张 core 声明的合法弃牌后，状态进入 `response_collecting`。随后连续调用 Bridge `fast` 策略 51 步，每一步 trace 均声明 `withinAvailableActions=true`；第 18 回合进入 `ended`，回放共保存 53 步，最后动作是 `pass`。这验证了开局、真人动作、响应、AI 推进、终局和回放的完整运行链路。
64. 测试实例清理：历史验证曾留下多组 `--test`/`--check-only` Godot 进程和 `48152`、`48162`、`48163` Bridge，导致读取对局时可能与用户窗口错位。已清理旧实例，仅保留当前编辑器、当前运行游戏和 `48163` 当前版本 Bridge；后续验收必须先确认唯一 Godot 游戏进程与唯一匹配 runtime，再读取牌局状态，不得并行启动临时服务。
65. （历史，已由第 66 项会话生命周期替代）新局状态同步修复：一次实机复现显示 Bridge 已提交 `/api/game/new`，但 Godot 因 JSON 回包解析异常清空 `latest_state` 并停留首页。当时运行时版本升为 `daer-bridge-fast-v3`，使 2026-08-12 的 v2 sidecar 被隔离；`AIService.new_game()` 仅在同一 generation、响应未含 state 且客户端仍为空时，向同一 Bridge 额外执行一次只读 `GET /api/game/state`。该回读成功后发出权威快照、写入唯一 `start` 回放步骤；绝不再次提交 `/new` 或在 UI 推进规则。编辑器实机验收中 v3 `48162` sidecar、新局后的 AIService 与 `page=game` 同步为 3 名玩家、玩家 0 `discarding`、16 个合法动作。

### 架构约束

1. 不得在 Godot 新增会独立生成合法动作、推进回合或计算结算的规则实现；旧 `GameService` 仅可保留为离线测试夹具，不能参与运行时牌局。
2. 任何新增玩法设置必须先进入 core 的 `RuleProfile` 和服务请求，不能只改变 Godot 的显示或 AI 权重。
3. 所有玩家与 AI 动作必须由当前 core 的 `availableActions` 映射而来，并由 `/api/game/action` 或 `/api/game/ai-step` 返回下一权威状态。
4. AI 扩展不得改变服务契约或绕过合法动作校验；原版 AI 兼容、默认启发式和未来模型都必须写出 `policySource`、版本和降级原因。
5. Godot 侧修改先以桌面可玩性为标准验收，再以状态一致性、回放可重建和服务断线恢复验证；guandan 的实现仅作为交互和工程组织参考，不是代码依赖。

### 除 AI 外的总体技术路线注意事项

AI 策略可以替换或降级，但其余技术路线应保持稳定，避免因为“AI 不完全复用原版”而把项目拆成两套互不兼容的实现。实施时重点注意以下边界：

66. Bridge 生命周期会话化：运行时版本升为 `daer-bridge-session-v4`。Godot 不再复用 `48152/48162/48163` 上的进程，而是传入 `DAER_GODOT_SESSION_ID`、`DAER_GODOT_PARENT_PID` 和会话端口；Bridge `/health` 回传 `sessionId`，并在父 PID 消失时关闭。若候选端口返回非 JSON HTTP 数据，Godot 会在 3 秒超时后切换到下一个会话端口。实机验证停止 Godot 后对应 Bridge 与端口均消失，重启后创建新的会话 Bridge，同时由新的 core 进程按续局日志恢复权威状态。
67. 多玩家响应改由 core 的显式 `ResponseWindow` 统一收集和仲裁，运行时版本升为 `daer-bridge-session-v5`。`currentPlayerIndex` 保留轮次归属，`activePlayerIndex`/`awaitingHumanInput` 指示控制端；Bridge 删除无效果动作强制换家，响应请求校验窗口 ID，并输出可持久化的 `lastTransition`。Godot 依据人类等待事实停止 AI，公开牌区使用真实牌面组合。
68. 修复项目内随包 Bridge 滞后导致无法开新局：Godot 已要求 `daer-bridge-session-v5`，但 `bridge/bridge-server.mjs` 仍为 v4，健康检查正确拒绝后没有可用运行时。现已重新构建 v5 bundle，并新增 `bridge/runtime-version.txt`；`AIService` 只有在清单与客户端 `RUNTIME_VERSION` 完全一致时才把 bundle 判为完整，发布脚本每次构建同步写入该清单。真实 sidecar 验证 `/health` 返回 v5，`POST /api/game/new` 返回三人局、`phase=discarding` 与 `awaitingHumanInput=true`。

- **先领域、后适配、再表现**：新增玩法、牌型、响应窗口、计分或结算，先在 `@daer/core` 的 `RuleProfile`、状态机和测试中落地；Bridge 只补协议映射；Godot 最后增加控件和表现。不要从 UI 选项反向推导规则。
- **一份状态、一个推进者**：正式运行时只有 core 的 `GameManager` 能推进牌局。Godot 可以保存选中牌、排序和动画等临时状态，但不能缓存可继续执行的规则副本；Bridge 重启后必须以快照恢复或明确开始新局。
- **契约先行且可演进**：所有跨进程字段都通过带 `protocolVersion` 与 `runtimeVersion` 的 JSON 契约传输；规则、牌面、动作、回放、AI 执行与错误响应需要明确版本和兼容策略。字段缺失或版本不匹配应显式失败，不能靠猜测兼容。
- **配置必须可复现**：影响玩法的设置统一序列化为冻结的 `RuleProfile`，随新局、动作日志、AI trace 和回放保存。相同 `ruleVersion`、种子和动作序列应能重建相同状态，便于定位规则与 UI 问题。
- **表现层只消费事实**：按钮、响应提示、牌数、公开组合、结算和复盘均从 core 快照与 `availableActions` 渲染。动画、排序和字体可以独立迭代，但不能改变动作语义或制造服务未声明的选项。
- **生命周期与故障可见**：Godot 负责 Bridge 的启动、健康检查、重连和离线提示；请求失败时停止提交并重新读取权威状态。服务日志、回放步骤和 trace 应可导出，避免只能依赖截图判断问题。
- **测试分层守门**：core 覆盖规则与结算，Bridge 覆盖协议、动作门控、版本和终局，Godot 覆盖关键操作路径、布局和回放渲染；跨层至少保留固定种子端到端用例。验收以状态一致性和可回放为准，不以“界面能点击”代替。
- **桌面资源与进程边界固定**：Godot 只依赖本地 Bridge 和打包资源，不把 guandan 的 Lua/Python/ONNX 运行时嵌入产品。guandan 仅借鉴进程管理、调试、回放和信息层次；daer 的规则、牌面和数据模型继续由自身 core 定义。
- **发布包必须自足**：Windows 导出目录中的 `bridge/` 是正式运行依赖，包含 `daer-ai-server.cmd`、`runtime/node.exe`、`bridge-server.mjs` 与 `runtime-version.txt`。开发者显式设置 `DAER_CORE_WORKSPACE` 时优先使用 pnpm/tsx 工作区；否则启动同目录且版本清单匹配的 Bridge。对局状态写入用户本地目录而非安装目录，导出包不得包含开发机绝对路径。
- **为未来 AI 留稳定插槽**：Bridge 的 `ai-step`、`advice`、`trace` 契约与规则层解耦，允许启发式、原版适配器或新模型替换；策略实现不能反向修改 core API，也不能成为 Godot 的硬依赖。

### 下一阶段

截至 2026-08-14，本节原有四项均已完成：正式牌局已由 core/Bridge 单一推进，三人局动作与响应控件、权威回放/trace、Bridge 动作守卫和状态恢复测试均已落地。当前不再扩展功能面，按发布收口顺序推进：

1. **P0：完成最新源码的可视化联调。** 仅保留一个匹配 `protocolVersion=daer-godot-v1`、`runtimeVersion=daer-bridge-session-v5`、`runtime-version.txt` 与当前 `sessionId` 的运行时；在 1280x720 与 1024x640 验证新牌桌、组合内暗搭子、组合拖动、中心出牌、响应选项、断线恢复和回放。验收必须使用最新 `handPresentation` 字段，不能用旧 sidecar 的兼容降级结果代替。
2. **P0：闭环 Windows 独立发布。** 安装 Godot 4.7.1 Windows export templates，执行完整 `tools/package-windows-release.ps1`；在未设置 `DAER_CORE_WORKSPACE`、不依赖 pnpm/tsx 的环境中冷启动导出程序，完成固定三人局、AI 推进、续局和回放验收。
3. **P1：固化跨层自动门禁。** 将 Godot headless 扫描、`--test`、core 类型检查、Bridge/action-guard 测试和 sidecar 健康检查整理为单一可重复验收流程，并保存日期化结果；发布候选必须全部通过。
4. **P1：恢复实时编辑器可观测性。** 需要场景树、运行时节点或截图证据时，先启动唯一 Godot 编辑器和 MCP HTTP 服务，再使用 gdmcp；未连接时明确降级为 headless 验证，不得把“服务不可达”写成项目代码失败。
5. **P2：发布候选通过后再拆分 `scripts/main.gd`。** 先用现有 debug validator 建立行为保护，再按牌桌、手牌交互、弹层/回放等职责逐块抽离，避免在交付门禁未闭环时进行大范围结构调整。

详细执行步骤见 `docs/plans/2026-08-14-godot-refactor-next-stage.md`。
