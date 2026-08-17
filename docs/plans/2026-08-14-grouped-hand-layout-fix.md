# Grouped Hand Layout Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让大贰玩家手牌始终保持组合化呈现；拖动只用于拖入中心出牌，不再产生横向散列状态；暗搭子作为锁定组合与普通手牌处于同一轨道。

**Architecture:** Godot 只改变本地视觉与输入，仍只从 Bridge `handPresentation.lockedHandMelds` 和 `availableActions` 消费事实。手牌展示统一使用组合组描述符：锁定组先入轨道，普通牌由现有 `_hand_groups()` 分组；拖动离开手牌后只显示预览，放回手牌时恢复同一组合布局。

**Tech Stack:** Godot 4.7.1、GDScript、现有 `scripts/test_runner.gd`、gdmcp。

---

### Task 1: 固定组合展示模式并迁移旧设置

**Files:**
- Modify: `scripts/test_runner.gd`
- Modify: `scripts/app_state.gd`
- Modify: `scripts/main.gd`

**Step 1: 写失败断言**

在 `test_runner.gd` 将历史 `hand_arrangement_mode=free` 写入内存设置，并断言 `_hand_arrangement_mode()` 返回 `group`。

**Step 2: 运行失败测试**

```powershell
& 'K:\godot\Godot_v4.7.1-stable_win64_console.exe' --headless --path 'K:\godot\daer' -- --test
```

Expected: 断言失败，当前代码返回 `free`。

**Step 3: 最小实现**

在 `AppState._ready()` 中把历史 `free/order` 设置迁移为 `group`；`_hand_arrangement_mode()` 只暴露 `group`，设置页和牌桌不再提供自由/横排切换。

**Step 4: 重跑测试**

Expected: `GAME_SERVICE_TESTS_PASSED`。

### Task 2: 将暗搭子接入同一组合轨道

**Files:**
- Modify: `scripts/test_runner.gd`
- Modify: `scripts/main.gd`

**Step 1: 写失败断言**

用三张锁定牌和一张普通牌调用新的组合描述符，断言首组为 `locked`、三张锁定牌仍在同一组、锁定 ID 不可提交。

**Step 2: 运行失败测试**

Expected: 新的组合描述符尚不存在或未包含锁定组。

**Step 3: 最小实现**

用 `_hand_display_groups()` 生成锁定组与普通 `_hand_groups()`；删除独立“暗搭子”面板，使用同一轨道、相同尺寸渲染，锁定牌仅保留暗色和锁定标识。

**Step 4: 重跑测试**

Expected: `GAME_SERVICE_TESTS_PASSED`。

### Task 3: 拖动保持组合、统一牌面尺寸

**Files:**
- Modify: `scripts/test_runner.gd`
- Modify: `scripts/main.gd`

**Step 1: 写失败断言**

断言手牌放回轨道时不会进入自由重排；组合模式与任何历史模式解析后的牌面尺寸一致。

**Step 2: 运行失败测试**

Expected: 当前拖动完成会写入 `free`，且组合与非组合牌宽不同。

**Step 3: 最小实现**

拖入中心仍提交合法弃牌；其余落点仅清除预览并恢复组合布局。拖动中的槽位动画不再调用横向 `_free_hand_positions()`；所有组合牌使用同一基准尺寸，尺寸只随窗口高度适配，绝不随理牌状态变化。

**Step 4: 重跑测试**

Expected: `GAME_SERVICE_TESTS_PASSED`。

### Task 4: 运行时验收与记录

**Files:**
- Modify: `docs/godot-daer-architecture.md`
- Modify: `docs/plans/2026-08-14-godot-refactor-next-stage.md`

**Step 1: 静态与离线门禁**

```powershell
& 'K:\godot\Godot_v4.7.1-stable_win64_console.exe' --headless --path 'K:\godot\daer' --editor --quit
& 'K:\godot\Godot_v4.7.1-stable_win64_console.exe' --headless --path 'K:\godot\daer' -- --test
```

**Step 2: 编辑器实机验收**

在当前牌局点击一张合法单牌（出牌按钮出现）、在手牌区域拖动并松开、拖到中心出牌区前后各截图；确认其余手牌始终为组合列，暗搭子不再是独立区域，牌面尺寸不因“理牌”状态变化。

**Step 3: 记录结果**

写入实际分辨率、截图路径、运行时状态和未完成项。`K:\godot\daer` 不是 Git 仓库，本轮不执行提交。

## 实施结果（2026-08-14）

- 历史 `free/order` 设置已统一迁移为 `group`；设置页与牌桌不再提供散牌横排状态。
- 暗坎/提以锁定组合列接入同一手牌轨道，不再渲染为旁侧独立区域，且不可选择或拖动。
- 拖动普通单牌至中心仍按 `availableActions` 出牌；其他落点恢复原组合，牌面尺寸不随理牌状态缩小。
- Godot 无界面回归输出 `GAME_SERVICE_TESTS_PASSED`；运行时画面记录为 `user://codex-show-game-stability-probe.png`。
