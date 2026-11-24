# production.json 结构

**单集一份**，旁挂在 `storyboard.json` 旁边。它只存 storyboard 没有的三样东西：每格的 Qwen 插槽与提示词、资产的 MOSS 母稿、每段的 H3 模式与后期参数。

秒数、段号、切数、画内人物、H3 提示词正文**都不在这里**——那些在 `storyboard.json`，本技能只读。所以 `validate` 必须给 `--storyboard`，对不上就报错。

```json
{
  "source": "风雨欲来",
  "ep": 1,
  "fps": 24,
  "aspectRatio": "16:9",
  "params": { "charsPerSecond": 4, "frameTolerance": 2, "maxQwenRefs": 5 },
  "assets": { "S01": { "...": "见资产" } },
  "segments": [ { "...": "见段" } ]
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `source` | string | 剧名，跟 storyboard 一致即可 |
| `ep` | int | 集号。**必须能在这份 storyboard 里找到同号的集**，否则 `ref-segments` 直接失败 |
| `fps` | int | 默认 24。ComfyUI H3 量化版固定 24，改它没有意义 |
| `aspectRatio` | string | 与 storyboard 顶层一致，只用于卡片抬头 |
| `params.charsPerSecond` | number | 口型预算，默认 **4**（官方口径是 4.5，量化版实测 4 更稳） |
| `params.frameTolerance` | int | 帧数误差容忍，默认 2 帧。超过就报错，不静默吸附 |
| `params.maxQwenRefs` | int | 每格最多挂几张参考图，默认 5。再多会互相污染 |

## 资产（assets）

按 storyboard / art.json 的编号索引：场景 `S01`、道具 `P01`、角色 `C01`。**编号必须与 storyboard 里 `characters` / `props` 用的完全一致**，否则覆盖门会判缺图。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `name` | string? | 人物/场景的中文名。`handoff-cast` 用它核对 `enter` 里有没有点名；没写就跳过那道门 |
| `kind` | enum | `scene` / `character` / `prop`。`image_1` 必须指向 `scene`，Ref2VA 的 `lockSheet` 必须指向 `character` |
| `sheet` | string | 设定板文件路径，导出卡片时写进插槽清单 |
| `tier` | enum | `fine`（1500~2500 字）/ `standard`（350~600 字）。只在写了 `moss` 时才查 |
| `layout` | enum | `sheet`（设定板，默认）或 `single`（单图，海报帧那类）。`sheet` 会查母稿有没有交代版面分区 |
| `moss` | string | MOSS 文生图母稿，中文连贯段落。写法见 `moss-t2i.md` |

## 段（segments）

段号必须与 storyboard 的段号**逐个对应、顺序一致**。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | `E01-01`，与 storyboard 同号 |
| `h3Mode` | enum | `T2VA` / `I2VA` / `FL2VA` / `L2VA` / `Ref2VA`。选型见 `comfyui-h3.md` |
| `lockSheet` | string? | 仅 Ref2VA：锁脸用的角色编号。决定了 `<Picture 2>` 挂哪张定妆图 |
| `tailFrom` | string? | 抽哪一段的末帧当本段首帧。填了就进尾帧链，`tail-anchor` 门会去查生产者末镜 |
| `dedupeFrames` | int | 本段头部要裁掉的重复帧数，默认 0。必须 < 本段帧数 |
| `enter` | string | **必填**。从上一段接过来什么状态、新出现的人从哪来。写法见 `continuity.md` |
| `exit` | string | **必填**。这一段把世界留在什么状态（人物位置、道具在哪、门开还是关） |
| `sound.carry` | string[] | 从上一段继承的声源。非首段时必填，且要与上段 `keep` 有交集 |
| `sound.keep` | string[] | 本段结束时仍在响的声源，留给下一段继承。**必填** |
| `sound.add` / `sound.drop` | string[] | 本段新增/消失的声源，只记录不设门 |
| `jCut` | number | 声音提前量（秒），只影响后期表的备注与 ffmpeg 提示 |
| `postNote` | string | 这一段的衔接备注（假甩镜、L-Cut 延留等），原样写进后期表 |
| `cuts` | cut[] | 与 storyboard 的切**等长、同序**。这里只有 `qwen`，没有秒数 |

## 切（cuts）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `qwen.canvas` | string | `image_1` 的场景编号。它决定画布比例、基础光位与空间拓扑 |
| `qwen.refs` | string[] | `image_2..N`，按主次排：画内角色在前、道具在后。必须覆盖该切全部画内人物与道具 |
| `qwen.prompt` | string | 指令式中文编辑提示词，必须能用 `<image1>`..`<imageN>` 指到每一张，并以 no-text 收尾句结束 |

**切的数量和顺序由 storyboard 决定**，多一条少一条都会被 `ref-cuts` 拦下。要给某段补一格，先回 `novel-storyboard` 加分镜。

## 帧数

段总秒数 = Σ 该段各切秒数（来自 storyboard）。生成帧数按 24fps 换算后必须落在 `17k + 5`：

```
5, 22, 39, 56, 73, 90, 107, 124, 141, 158, 175, 192, 209, 226, 243, 260, 277, 294, 311, 328, 345, 362 …
```

常用档位：`107f ≈ 4.46s`、`124f ≈ 5.17s`、`192f ≈ 8.00s`、`243f ≈ 10.13s`、`294f ≈ 12.25s`、`362f ≈ 15.08s`。

误差超过 `frameTolerance` 就报错，提示你回去改分镜的切秒数。**本技能不替你改秒数**——静默吸附会让提示词里的切点时间码和实际画面对不上。

## 后期字段怎么来的

`dedupeFrames` 是「上一段尾帧 = 本段首帧」造成的重复：抽帧时多留下的那几帧在拼接时要剪掉。填多少取决于你抽帧的时机，一般 8~16 帧（0.33~0.67s）。填大了会把本段开头咬掉，填小了留一个可察觉的卡顿。

`jCut` 只写秒数，不换算帧——它记录的是「下段的撞击声提前到本段末尾」这个意图，实际剪刀在剪辑软件里落。
