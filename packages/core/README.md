# @daer/core（Godot 本地规则核心）

这里是 Godot 项目使用的规则、Bridge 服务和 AI 源码。

本目录从旧工作区迁入后成为 K 工作区内的唯一源码位置。Godot 正式牌局通过
`scripts/godot-ai-server.ts` 提供的本地 Bridge 推进；Godot UI 不自行复制规则。

常用命令（均从 `K:\godot\daer` 执行）：

```powershell
pnpm --dir packages/core install
pnpm --dir packages/core run type-check
pnpm --dir packages/core run test
```

Windows 发布包使用同一目录构建随包 Bridge，不再需要 E 工作区。
