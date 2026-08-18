# K:\godot\daer 工作区边界

本目录是泸州大贰 Godot 项目的唯一权威编辑工作区。

- Godot 场景、GDScript、Bridge、`packages/core`、测试、规则说明和发布脚本只在 `K:\godot\daer` 内修改。
- `E:\project\daer` 是迁移前的历史参考目录，只允许只读核对；不得在其中编辑、同步回写、重置或清理文件。
- Godot 开发运行优先使用本目录的 `packages/core`；依赖未安装时使用本目录 `bridge` 下的自足 Bridge。
- 不要通过 `DAER_CORE_WORKSPACE` 把运行时重新指向 E；如需临时调试 Bridge，必须显式使用 `DAER_GODOT_BRIDGE_COMMAND` 并在任务记录中说明。
- `packages/core/node_modules`、构建物、训练产物和 Godot 导入缓存均为本地生成内容，不应提交。
