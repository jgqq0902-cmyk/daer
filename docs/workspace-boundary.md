# Godot 工作区整理记录

生效目录：`K:\godot\daer`

## 权威边界

| 内容 | 唯一编辑位置 |
| --- | --- |
| Godot 场景、界面、动画和 GDScript | `K:\godot\daer` |
| 规则核心、AI 和 Godot Bridge 源码 | `K:\godot\daer\packages\core` |
| Godot 随包 Bridge 运行产物 | `K:\godot\daer\bridge` |
| Godot 测试与发布脚本 | `K:\godot\daer\tests`、`K:\godot\daer\tools`、`K:\godot\daer\scripts` |
| 旧源码参考 | `E:\project\daer`，只读 |

## 运行原则

编辑器模式优先使用 K 内 `packages/core` 的本地依赖；依赖不可用时回退到 K 内已经构建好的 `bridge`。不再自动读取或编辑 E 工作区。

历史计划和验收记录中保留的 E 路径仅表示当时的证据来源，不改变当前工作区边界。
