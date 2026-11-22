# H3 提示词 · ComfyUI 生产层

**结构真理源不在这里**：正文怎么写、字段顺序、语言分工、台词与说话人语法，全在
`../../novel-storyboard/references/h3-prompt.md` 和 `shot-writing.md`，`novel-storyboard` 的 validate 逐字对账。

本文只补它没有的三件事：**用哪个模式、多少帧、量化版会怎么崩**。

## 一、模式选型

| 模式 | 什么时候用 | 图怎么接 | 提示词字段族 |
| --- | --- | --- | --- |
| `T2VA` | 空镜、转场、纯文本试拍 | 不接图 | Base 三字段，无对齐首行 |
| `I2VA` | **最常用**：首帧关键帧往后推 | 每切一张（多切时 Picture k 钉第 k 个切点） | Base 三字段 |
| `FL2VA` | 起点与落点都要锁死（门开到位、人坐下去） | 首帧 + 尾帧 | Base 三字段 |
| `L2VA` | 只锁最终画面，前面让模型自己推 | 尾帧一张 | Base 三字段 |
| `Ref2VA` | **全景/背影切正侧颜大特写**、两人以上锁脸、空景+人物合成 | 首帧 + 角色定妆图（2 张起） | **六字段** |

选错模式的代价：该升 Ref2VA 的段硬用 I2VA，切到特写就换脸；反过来不分青红皂白全用 Ref2VA，量化版会把定妆图的光和影棚灰底带进实景。

**升 Ref2VA 的硬判据**：首镜景别是 `wide` / `extreme-wide`，而同段后续切到 `close` / `extreme-close`，且人脸在首帧里小于画面 1/8。这种情况单图必崩。

## 二、帧数（量化版硬约束）

`length = 17k + 5`，24fps。合法值与换算见 `schema.md`。

三条不能违反的：

1. **所有 `At MM:SS.mmm` 切点必须严格小于本段实际时长**，最后一镜延续到片尾。
2. 段时长 5~15 秒。低于 5 秒模型没有足够上下文把动作做完；超过 15 秒必出接缝。
3. 分辨率宽高必须是 32 的倍数（横屏 `1344×768`，竖屏 `768×1344`）。

帧数门（`frame-grid`）只查总帧数落不落在格点上，不改你的秒数。

## 三、Base 模式的对齐首行

`T2VA` 无首行。其余三种各有一句固定句（逐字，不改写）：见 `novel-storyboard/references/h3-prompt.md`。多切段的「每张图钉在自己的切点秒数」由那边的 validate 推导并逐字对账——**不要手写这句**，改了秒数忘了改它必被拦。

## 四、Ref2VA 六字段

字段名与顺序不能改（`mode-shape` 门查）：

```text
subject_definitions: <Subject 1> is … from <Picture 2>. <Picture 1> is the opening keyframe at 0.00 seconds.
summary: [keyframe completion + reference generation] …
retention_analysis: <Picture 1> (appears in [Shot 1]): fully_preserved - …
<Subject 1> (appears in [Shot 1], [Shot 2]): fully_preserved - strictly lock the face …
detailed_description: [Overall visual style.] [Shot 1] … [Shot 2] At 00:04.000, the camera cuts to …
overall_soundscape: …
non_diegetic_music: …
```

- `<Picture N>` 是原始参考文件，`<Subject N>` 是抽出来的可复用主体，全文标签不许换。
- `summary` 前缀：纯参考用 `[reference generation]`，首帧+锁脸混用 `[keyframe completion + reference generation]`。
- `retention_analysis` 保留度：视觉 `fully_preserved` / `partially_preserved` / `attribute_transfer` / `weak_reference`；音频 `fully_copy` / `partially_copy` / `reference` / `weak_reference`。

## 五、量化版八条防雷（`validate` 查得到的那部分标了门名）

1. **开局不甩镜**（`whip-pan`）：I2VA 首帧写 `rapid whip-pan` 会让模型放弃首帧重画，甚至把已经打开的门重新画关。剧烈转场移交后期：前段末 3 帧横向动态模糊 + 本段撞击声提前 2 帧 J-Cut。
2. **双镜单向零倒带**：同段两镜不许重复同一个动词或位移。`[Shot 1]` 演「滚下台阶」，`[Shot 2]` 必须从「已落地平地续滑」接，绝不重演过程。写重了 H3 会让人物瞬移回起点再摔一遍。
3. **景别与口型预算**（`speech-fit`）：中文按 **4 字/秒**，同期肢体动作再留 ≥ 2 秒。掏兜、蹲下、拔工具这类动作，镜头下缘必须含腰胯与手——紧怼脸的特写再演画外手部动作，必崩。
4. **解剖左右手与道具闭环**：面对面只用单手接触（「左侧人物左手扶右侧人物右肩，右手按在箱上」）；过肩镜头前景虚化哪侧肩，入镜前臂就必须是同一侧。核心道具写清「在哪只手 → 何时放下 → 下镜还在哪里」。
5. **画外音锁唇**（`offscreen-lips`）：画外人说话而画内是另一个沉默的人时，优先把非说话人的嘴裁出画外；嘴在画内就写 `the on-screen person's mouth remains completely still and closed throughout the off-screen speech`。
6. **尾帧链末段稳焦**（`tail-anchor`）：要抽尾帧的段，末镜最后 0.5~1.0 秒必须写明动作骤停 + 镜头稳焦静止。抽帧前那一帧在抖，下一段必糊。
7. **全景切特写升 Ref2VA**（`ref2va-lock`）：见上文判据。
8. **扑镜三拍**：5 秒的扑脸镜头拆成约 40% 死寂蓄力 → 40% 暴起 → 20% 撞镜动态模糊硬切。不拆就在前 1.5 秒撞满镜头，剩下 3.5 秒全是贴屏畸变。

## 六、声音字段

- `overall_soundscape`（`soundscape-vocals`）：只写环境底噪、物理碰撞、非语言生理声。**出现 voice / speech / talking / chatter / whisper 立刻拦**——量化版会照着生成听不懂的人声。
- 手机铃声、广播、警报、对讲机是**场内声**，写在对应镜头的正文里，不进配乐。
- `non_diegetic_music`（`music-spec`）：写乐器编制 + 速度 + 动态；没有就写 `N/A`。只写「tense emotional music」等于什么都没写。

## 七、不要写的东西

- 负面提示词与权重语法（ComfyUI 的 H3 用 `BasicGuider`，cfg=1，没有 negative 分支）。要抑制什么，就写正向可见事实。
- 画风句（`cinematic, 8K, masterpiece`）：画风由调用方统一附加，写进每段只会稀释具体动作。
- 角色名：H3 正文用通用身份（`a weathered ferryman in a dark rain cape`），名字只许出现在 `<d>` 台词原文里。这一条由 `novel-storyboard` 的 names 门查。
