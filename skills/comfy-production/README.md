# comfy-production

把 [novel-storyboard](../novel-storyboard) 的 `storyboard.json` 接到本地 ComfyUI 生产层：**每格的图怎么合成、每段视频用哪个模式多少帧、跑完的片段怎么拼成片**。

分镜技能管「拍什么」，这里管「怎么在图和视频模型上把它抠出来」。它不出图、不改戏、不改分镜结构。

## 它补的三件事

| 上游给不了 | 这里补 |
| --- | --- |
| 每格分镜图的提示词与参考图清单 | Qwen-Image-2.1 多图编辑提示词 + `TextEncodeQwenImage21` 的 `image_1..N` 插槽顺位 |
| 资产怎么出设定板 | MOSS 文生图母稿（`fine` 1500~2500 字 / `standard` 350~600 字） |
| 一次生成多少帧、用哪个模式 | H3 五模式（`T2VA`/`I2VA`/`FL2VA`/`L2VA`/`Ref2VA`）+ ComfyUI 量化版 `17k+5` 帧 |
| 段跑完怎么拼成片 | 尾帧去重裁剪表 + J/L-Cut + 能直接跑的 ffmpeg + `-14 LUFS` 归一 |

## 四步

```bash
# 0) 资产母稿（分镜之前就能做，MOSS 用）
node scripts/comfy-production.mjs assets art.json --cast cast.json > production-assets.json
node scripts/comfy-production.mjs moss production-assets.json --require S01,C01,P01

# 1) 起骨架（吃上面那份，母稿与中文名一起带过来）
node scripts/comfy-production.mjs seed storyboard.json --ep 1 --assets production-assets.json > production.json

# 2) 逐段填 h3Mode / qwen / tailFrom / assets.moss

# 3) 校验（22 道门，必须给 --storyboard）
node scripts/comfy-production.mjs validate production.json --storyboard storyboard.json

# 4) 导出投产包：每段一张卡 + 资产母稿 + 后期总装
node scripts/comfy-production.mjs export production.json --storyboard storyboard.json --out ./production-E01
```

秒数**只存在于 `storyboard.json`**。`production.json` 里没有秒数，所以改分镜不用改两份——`validate` 会当场告诉你哪一段对不上了。

## 文档

- [`SKILL.md`](SKILL.md)：完整工作流与 22 道门的清单（agent 读）
- [`references/schema.md`](references/schema.md)：`production.json` 字段表、帧数换算
- [`references/comfyui-h3.md`](references/comfyui-h3.md)：H3 模式选型、Ref2VA 六字段、量化版八条防雷
- [`references/qwen-i2i.md`](references/qwen-i2i.md)：插槽顺位、五条硬规矩、不许写的东西
- [`references/moss-t2i.md`](references/moss-t2i.md)：母稿两档、十段内容层、三类设定板的版面层
- [`references/continuity.md`](references/continuity.md)：`enter`/`exit`/`sound` 三字段、四种合法转场、过桥镜
- [`references/post-assembly.md`](references/post-assembly.md)：裁剪表、ffmpeg、人工四步、验收口径

## 自测

```bash
node scripts/selftest.mjs
```

139 项断言，不调模型、不花额度。每道门都有击穿用例，含一次 CLI 端到端。

## 依赖

Node ≥ 18，只用标准库，没有 npm 依赖。硬前提是同仓库的 `novel-storyboard` 产出的 `storyboard.json`。
