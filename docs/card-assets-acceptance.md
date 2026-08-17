# 大贰牌面资产接入记录

## 变更目标

- 为 Godot 牌桌新增 20 种大贰牌面资产：小写与大写各 1-10，红牌为二、七、十。
- 牌面统一为 1:4 长牌比例，顶部与底部各显示一个字，贴近边缘并填充牌宽，无角标。
- 字体使用项目内 `assets/fonts/ChaoZiSheFoTiaoQiangShouShuJianFan-Shan-HuiSa` 指定字体。

## 验收标准

- `assets/cards/` 含小写、大写各 10 张 `180x720` PNG 牌面、对应 SVG 封装及 1 张牌背。
- 手牌与弃牌按照卡牌的 `size`、`value` 显示对应牌面；二、七、十为红色，其他为黑色。
- 三人局规则、出牌选择和 AI 服务接口无变更。

## 验收流程

Godot 4.7.1：

```powershell
& 'K:\godot\Godot_v4.7.1-stable_win64_console.exe' --headless --path 'K:\godot\daer' --editor --quit
& 'K:\godot\Godot_v4.7.1-stable_win64_console.exe' --headless --path 'K:\godot\daer' -- --test
```

运行主场景开始一局，检查底部手牌、选中高亮和中部弃牌。

## 验收结果

通过（2026-08-13）：最终牌面改用 `docs/svg/chars_svg` 中的提取字形，累计旋转角度定稿为壹 `-22`、贰 `-7`、叁 `15`、肆 `20`、伍 `28`、陆 `-22`、柒 `-27`、捌 `10`、玖 `5`、拾 `25`；一 `0`、二 `0`、三 `10`、四 `-22`、五 `-37`、六 `7`、七 `42`、八 `7`、九 `0`、十 `-42`。已移除柒的左下孤立点。生成 20 张最终 SVG 和 20 张 `180x720` PNG，Godot headless 资源扫描与 `--test` 均通过，测试输出 `GAME_SERVICE_TESTS_PASSED`。
