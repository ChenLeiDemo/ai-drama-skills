---
name: comfy-production
version: 1.0.0
description: |
  把 novel-storyboard 的 storyboard.json 接到本地 ComfyUI 生产层：为每一格分镜写 Qwen-Image-2.1 多图编辑提示词
  并排好 TextEncodeQwenImage21 的 image_1..N 插槽，为 CH/SC/PR 资产写 MOSS 文生图母稿，为每段补 MiniMax H3
  的模式（T2VA/I2VA/FL2VA/L2VA/Ref2VA）与 ComfyUI 量化版帧数（17k+5），最后导出成片总装包（尾帧去重裁剪表
  + J/L-Cut + ffmpeg 命令 + -14 LUFS 归一）。
  20 道质量门全部由脚本对着 storyboard 逐条对账，秒数、节拍、画内人物一改就报错；其中四道专查段与段之间的接续。
  不出图、不改戏、不改分镜结构——那些是上游的事。
  Use when asked to 出 ComfyUI 提示词、垫图、多图参考、Qwen 编辑提示词、MOSS 母稿、H3 提示词、帧数换算、后期总装。
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
triggers:
  - comfy-production
  - ComfyUI 提示词
  - 垫图
  - 多图参考
  - 关键帧提示词
  - H3 提示词
  - 帧数
  - 后期总装
metadata:
  license: Apache-2.0
  requires:
    bins:
      - node          # >= 18，只用标准库，无 npm 依赖
  runtimes:
    - claude-code
    - codex
---

## comfy-production

上游 `novel-storyboard` 交付的是「每格画面提示词 + 该挂哪些参考图」，它明确不出图。到了本地 ComfyUI 这一侧还有三件事没人管：**每格的图怎么合成、每段视频用哪个模式多少帧、跑完的片段怎么拼成片**。这个技能只补这三件事。

**一句话分工**：分镜技能管「拍什么」，这里管「怎么在图和视频模型上把它抠出来」。

**四条边界，越界就是灾难**：

- **不写戏**：场次、节拍、台词归 `novel-script`。这里只消费。
- **不改分镜结构**：段号、切数、秒数、画内人物、H3 提示词正文都存在 `storyboard.json` 里，这里是**只读**。改分镜请回去跑 `novel-storyboard`。
- **不出图**：只交付提示词、插槽映射和图清单。出图在 ComfyUI 里由人按卡片点。
- **不替你改秒数**：帧数不合法就报错，让你回去调分镜——这里不静默吸附。

`{baseDir}` = 本文件所在目录。脚本 `{baseDir}/scripts/comfy-production.mjs`，零依赖。

---

### Step 0 — 定输入

硬前提是 `storyboard.json`（来自 `novel-storyboard`），且**每一段都必须给 `--storyboard`**——没有它这个技能无法对账，直接报错退出。

有则更好：

- `--art`（`novel-art` 的 art.json）：`seed` 时自动填场景 `S01`、道具 `P01` 的资产条目与设定板路径
- `--cast`（`novel-characters` 的 cast.json）：`seed` 时按出场顺序填 `C01`、`C02`

**一次做一集**。`production.json` 是单集的，`ep` 与 storyboard 的集号必须对得上。

### Step 0.5 — 先出资产提示词（不用等分镜）

上游 `novel-art` / `novel-characters` 给的是**英文短提示词**（`image.prompt`）和三区**设定板版式**（左 34% 半身像 / 右上三视图 / 右下细节条）。中文长提示词不在这里手写——交给 [`fisher-moss-prompt-expander`](https://github.com/Work-Fisher/fisher-moss-prompt-expander)。

本技能只做**清单与交接**：把每份资产的编号、类型、设定板路径、篇幅档位、版式句、素材摘要排成一张单子。

```bash
# 1) 出资产单：每份资产一节（篇幅 + 版式 + 素材 + 待贴位）
node {baseDir}/scripts/comfy-production.mjs assets art.json --cast cast.json --md > 资产生图单.md

# 2) 逐节交给 expander 扩写（它会读 references 里的构图/材质/手部模块）
#    使用 $fisher-moss-prompt-expander：按下面的版式扩写这份素材……只输出一个 text 代码块。

# 3) 把输出贴回 assets.<编号>.prompt（production.json 里），导出时才不会被冲掉
```

分级自动：`primary` 场景与 `importance: protagonist` 的角色起 `fine` 档（1500~2500 字），其余 `standard`（350~600 字）。`--md` 之外不带参数时出 JSON 骨架，给 `seed --assets` 吃。写法与验图清单见 `references/assets-prompt.md`。

### Step 1 — seed 工作底稿

```bash
node {baseDir}/scripts/comfy-production.mjs seed storyboard.json --ep 1 \
  --assets production-assets.json > production.json
```

出来的是骨架：每段的 `id`、`h3Mode: I2VA`、以及每切一条空的 `qwen`（`canvas` 已按 `sceneIndex` 填成场景 id，`refs` 按画内人物道具预填）。**骨架里没有秒数**——秒数只在 storyboard 里，存两份必然漂。

给了 `--assets` 就直接吃 Step 0.5 那份，提示词与中文名一起带过来；没给就从 `--art` / `--cast` 现建。**不要用 `--art` 覆盖已经贴过提示词的资产**——重建会把 `prompt` 抹掉。

### Step 2 — 逐段填（分镜出来之后）

每段要填的东西：

1. **`h3Mode`**：`T2VA` 纯文本 / `I2VA` 首帧推动（最常用）/ `FL2VA` 首尾帧插值 / `L2VA` 锁尾帧 / `Ref2VA` 多图锁脸。选型见 `{baseDir}/references/comfyui-h3.md`。
2. **`qwen`**：每切一条。`canvas` 是 `image_1`（必须是场景，它决定画布与光位），`refs` 是 `image_2..N`（画内每个角色、每个道具都要挂，漏一件模型就当场发明一件），`prompt` 是指令式中文编辑提示词。写法见 `{baseDir}/references/qwen-i2i.md`。
3. **`tailFrom` / `dedupeFrames`**：这一段要抽上一段末帧当首帧时填。生产者末镜必须已经写了稳焦静止（`tail-anchor` 门盯着），`dedupeFrames` 是头部要裁掉的重复帧数。
4. **`enter` / `exit` / `sound`**：段与段之间的三句交代。`enter` 写「从上一段接过来什么状态、新出现的人从哪来」，`exit` 写「把世界留在什么状态」，`sound.carry` / `keep` 把底噪连成一条线。写法与四种合法转场见 `{baseDir}/references/continuity.md`。
5. **资产的 `prompt`**：expander 输出的中文长提示词贴回 `assets.<编号>.prompt`。资产顺带要有 `name`——`handoff-cast` 靠它核对「新入画的人有没有写明从哪来」。版式与篇幅见 `{baseDir}/references/assets-prompt.md`。

H3 提示词正文**不在这里写**——它在 `storyboard.json` 的 `seg.h3Prompt` 里，这里只校验它的模式字段族对不对。

### Step 3 — 校验 ⛔ 不能跳

```bash
node {baseDir}/scripts/comfy-production.mjs validate production.json --storyboard storyboard.json
```

20 道门，全是代码：

| 门 | 查什么 |
| --- | --- |
| `ref-segments` | 段号序列与 storyboard 完全一致 |
| `ref-cuts` | 每段切数一致（多切少切都拦） |
| `frame-grid` | Σ切秒数 × 24 吸附到 `17k+5`，误差 ≤ `frameTolerance` 帧 |
| `mode-shape` | 段声明的模式与 `h3Prompt` 的字段族一致：Base 三字段 / Ref2VA 六字段 |
| `ref2va-lock` | Ref2VA 必须挂一张 character 定妆图 |
| `qwen-canvas` | 每切 `image_1` 必填且是场景 |
| `qwen-coverage` | 该切画内每个角色、每个道具都挂了图 |
| `qwen-slots` | `<imageN>` 编号连续覆盖 1..N，单图编辑不许写标签 |
| `qwen-clean` | 不写画幅、像素、文件名、权重、否定句、「图1」 |
| `qwen-tail` | 每格提示词以 no-text 收尾句结束 |
| `whip-pan` | I2VA 等基座模式首镜不写甩镜 |
| `tail-anchor` | 尾帧链：生产者末镜有稳焦词、末镜 ≥ 1s、去重帧数合理 |
| `offscreen-lips` | 有画外音就必须锁住画内唇形 |
| `soundscape-vocals` | `overall_soundscape` 不出现人声词 |
| `music-spec` | `non_diegetic_music` 是 N/A 或写了乐器编制 |
| `speech-fit` | 每镜 `<d>` 台词字数 ÷ 4 ≤ 该切秒数 |
| `handoff-state` | 每段都有 `enter` / `exit`——接过来什么、留下去什么 |
| `handoff-cast` | 本段首镜新出现的人，`enter` 里必须写明从哪来（按资产 `name` 核对） |
| `handoff-eyeline` | 上段末镜的视线目标，本段 `enter` 要交代怎么转过去 |
| `handoff-sound` | `sound.carry` 与上段 `sound.keep` 至少共用一个声源，底噪不许断档 |

**有违规逐条修，改完重跑，直到 0 违规。** 警告可以带着交付，但要说清。

### Step 4 — 导出投产包

```bash
node {baseDir}/scripts/comfy-production.mjs export production.json \
  --storyboard storyboard.json --out ./production-E01
```

```
production-E01/
├── E01-01/index.md        ← 一段一张卡：插槽映射 + 每格 Qwen 提示词 + H3 槽位与提示词
├── E01-02/index.md
├── E01-assets.md          ← 资产生图单（版式 + 素材 + 贴回来的提示词）
└── E01-post.md            ← 尾帧去重裁剪表 + ffmpeg 总装命令
```

投产卡的用法：`image_1` 拖进 `TextEncodeQwenImage21` 的对应槽位、提示词整段复制、出图存成 `f1.png`；再把 `f1..fN` 按 `Picture` 序接进 H3 节点，`prompt.md` 内容就是卡里那段 H3 提示词。

### Step 5 — 后期总装

只用裁剪表不开文件时：

```bash
node {baseDir}/scripts/comfy-production.mjs post production.json --storyboard storyboard.json
```

裁剪表给每段的有效起止帧、头部去重帧数、首帧来源与衔接备注，后面直接跟着能跑的 ffmpeg：逐段裁头 → concat 拼接 → `loudnorm=I=-14` 归一。**Room Tone 通轨与 J/L-Cut 落点仍需人精剪**，脚本只做机械部分。细则见 `{baseDir}/references/post-assembly.md`。

---

### 汇报口径

一句话说清：几段、总帧数、几个 Ref2VA、几个尾帧接力、几道门没过。**不要说「已出图」**——这一步不存在。

### 自测

```bash
node {baseDir}/scripts/selftest.mjs
```

138 项断言，不调模型、不花额度。20 道门每道都有击穿用例，含一次 CLI 端到端。改完脚本先跑这个。

### 上下游

```
novel-staging    → staging.json   （开场站位）
novel-storyboard → storyboard.json （段/切/秒数/H3 提示词）  ← 硬前提
comfy-production → production.json （插槽/母稿/帧数/总装）   ← 本技能
```

分镜的 `frame`（中文分镜图提示词）在这里**不用**：那是给「不出图也能说清构图」的场景。本地走 Qwen 垫图，构图由 `qwen.prompt` + 挂图决定，`frame` 留作人读的备注。
