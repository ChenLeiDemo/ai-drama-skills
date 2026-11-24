# 视频提示词补充 · 其他模型的三种模板

> 来源：学习自 Toonflow-app（MIT License）`packages/skills/v118workflow/references/knowledge/videoPromptCraft.md`，已剥离其画布与工具绑定、按本仓库口径内化改写，不是原文复制。

本仓库已经内化了 MiniMax H3 与 Seedance 两套协议（`h3-prompt.md`、`seedance-prompt.md`），这两套是默认路线，不要改动。这份文件补的是下游换成其他视频模型时的三种写法：Wan 单图首帧、英文首尾帧五段式、通用多参考模式。使用之前先核对目标模型实际支持的媒体类型与数量、模式、时长、分辨率与声音能力，不因为项目是短剧就默认某个模型，也不把旧模板描述的语法当成对当前模型的实测承诺。

## 所有模板共用的约束

- 一份提示词只服务一个已经确认的制作单元，不重新分组，不合并已经确认的镜头，不调整原镜号顺序。
- 资产参考负责身份与外观，分镜图负责该镜构图，不把角色设定图说成首帧画面。参考必须是真实的媒体输入，不写虚构编号、文件名或链接冒充参考。
- 说话者与声音归属明确：普通对白有对应口型，内心独白与画外音不让画面人物跟着张嘴，听者反应镜不转移说话人。台词保持原语言与原字句，英文模板只翻译描述语句，不翻译台词。
- 动作写可见过程、速度与结束状态，情绪用姿态、视线与呼吸体现，不添加台词、动机、地点、人物或装饰事件。
- 继承已经采用的场景光照与视觉风格，不根据模板示例另造时段、色调、服装或风向。
- 时长在制作配置里明确写清，即使模板正文不写秒数，也不交给模型自行推断。单元上限取流程上限与模型能力中的较小值，不兼容就回到分镜环节确认。
- 声音默认只使用真实环境声与动作声，不自行添加配乐。画内文字与画外字幕分开处理，不为了「无文字」的默认要求删掉剧本中的信件、招牌与屏幕信息。

## Wan 单图首帧 · 英文叙事段落

输入是一张已经采用的首帧与一个确认镜头，没有尾帧，不使用参考编号。写法顺序是：风格基调 → 主体动作与环境 → 摄像机收尾。人物只写由首帧核实的少量识别特征，重点放在接下来怎样运动。不堆砌画质词，不靠英文翻译改变台词语言。

```text
[A concise sentence expressing the approved visual style.]
[Character name and a few verified identity features] begins in [the exact adopted first-frame state],
then [the confirmed action, pace and emotional progression], ending in [the confirmed end state].
[The verified setting, relevant object and spatial relationship; no invented scenery.]
"[原语言完整台词]" — [Speaker] (dialogue / inner monologue, OS / voiceover, VO).
[Specific environmental and action sounds, or No dialogue where applicable.]
Captured in [starting shot size and angle], [the confirmed camera movement and endpoint],
as one continuous shot.
```

没有台词时删除台词行并写明 No dialogue。有内心独白或画外音时明确写出画面人物嘴唇不动（silent lips）。

## 首帧与首尾帧 · 五段式

用于已经确认的连续镜头：首帧给起始状态，尾帧只在当前模式支持且实际需要时使用。正文纯文本描述主体，不在正文内编号引用帧，起止帧的位置由真实的输入绑定决定。

```text
[Visual]
[Character A]: [verified identity anchors], [starting position and posture], [speaking/silent].
[Character B, if present]: [verified identity anchors], [position], [speaking/silent].
[Confirmed setting, relevant prop and approved style.]

[Motion]
0s-[t1]s: [The first confirmed action and state change].
[t1]s-[total]s: [The subsequent confirmed action ending in the adopted end-frame state if supplied].

[Camera]
[Starting size and angle], [one continuous camera path and final framing],
single continuous take, no cuts.

[Audio]
[Actual planned interval]: "[原语言完整台词]" — [speaker] (dialogue, lip-sync active).
[OS/VO, if present, with silent lips; other characters remain silent].
[Specific environmental and action sounds].

[Narrative]
[The existing dramatic beat and its relation to this confirmed unit; no added event].
```

时间轴每一段至少 1 秒，连续覆盖已经确认的总时长，按对白容量与动作分配，不平均切块。不同人物各有台词时明确谁在哪个区间说话、其他时间谁保持沉默。首尾帧不得表现无法在给定时间内完成的位移或形变，也不使用「无切镜」的说法把原来两个场景硬拼成一个空间。确认单元里有真实切镜的时候，回到模式选择环节，不删镜迁就模板。

## 通用多参考 · References 与 Instruction

适用于其他真实可用的多参考模式：参考用途清单与英文执行说明分开写，画面身份由实际参考承担。

```text
[References]
{{ref 1}}: [Character A identity reference].
{{ref 2}}: [Confirmed scene reference].
[Only list other real inputs; describe their actual type and purpose.]

[Instruction]
[Approved visual style in a short phrase].
Shot [original number]: [Shot size and camera move].
The character from {{ref 1}} [confirmed action and expression],
[explicit screen position, facing direction and interaction],
in the environment of {{ref 2}}.
"[原语言完整台词]" — [speaker] (dialogue / inner monologue, OS / voiceover, VO).
[Specific physical sounds; other characters' lip-sync state when needed].
Shot [next original number]: [Next confirmed shot with matching continuity].
[Retain the confirmed ending state and exclude only unrequested overlays or duplicates].
```

引用占位符的编号必须来自真实输入的顺序，核对之后再填写，不沿用示例编号。实际接入了本镜已经采用的分镜图时，可以加一句把该图作为这一镜的构图参考；没有分镜图就不写这句，不分配虚假编号。整个单元确实没有媒体输入且模型允许纯文本时，使用已经确认的纯文本路线与可读的主体名称，不假装多参考输入存在。多镜写法只在当前模型、模式与已确认分组都允许时使用，不能从这个模板推出所有多参考模型都支持镜头切换。
