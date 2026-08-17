# 大贰训练 Godot 项目规范

## 产品与规则约束

- 项目只支持固定三人局。任何外部玩家数参数均不得改变这一约束，非法值必须回退为三人。
- 不实现、不保留四人歇底流程、第四玩家座位或四人模式设置入口。
- 正式牌局规则推进必须由 `@daer/core` 通过本地 Node/TS Bridge 统一处理；Godot UI 不得自行修改牌局状态或重复实现规则判断。`scripts/game_service.gd` 仅作为 `--test` 离线夹具，不得加入正式自动加载或运行时牌局路径。
- 设置、统计、策略产物和回放只能通过 `PersistenceService` 写入 `user://`，不得添加网络请求或遥测。

## 开发与修改要求

每个新功能、规则修改、界面修改或缺陷修复都必须在提交说明、任务记录或对应文档中写明：

1. **变更目标**：用户可观察行为和涉及模块。
2. **验收标准**：至少一个可重复的成功条件；规则改动必须包含边界条件。
3. **验收流程**：明确 Godot 版本、运行入口、测试命令/操作步骤和预期结果。
4. **验收结果**：记录通过、失败或未执行；失败必须保留错误信息和后续处理。

## 标准验收流程

在 `K:\godot\daer` 执行：

```powershell
& 'K:\godot\Godot_v4.7.1-stable_win64_console.exe' --headless --path 'K:\godot\daer' --editor --quit
& 'K:\godot\Godot_v4.7.1-stable_win64_console.exe' --headless --path 'K:\godot\daer' -- --test
```

功能改动还必须启动主场景，手动或自动验证对应页面和流程。导出改动需额外执行 Windows 导出；Android 导出需确认 Export Templates、JDK 和 Android SDK 已安装。

## 本次变更验收标准

- 任何 `new_game` 参数都产生且只产生 3 个玩家，每人 20 张起手牌。
- 设置页不再出现玩家数量选择，显示固定三人模式。
- 代码和文档中不再存在四人歇底运行分支。
- Godot headless 项目扫描和游戏服务测试通过。
