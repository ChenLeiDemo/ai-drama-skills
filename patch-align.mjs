import { readFileSync, writeFileSync } from 'node:fs';

const must = (c, m) => {
  if (!c) throw new Error(m);
};
const patch = (file, pairs) => {
  let s = readFileSync(file, 'utf8');
  for (const [from, to, what] of pairs) {
    must(s.split(from).length - 1 === 1, `${file} ${what}: ${s.split(from).length - 1}`);
    s = s.replace(from, to);
  }
  writeFileSync(file, s, 'utf8');
};

patch('skills/comfy-production/references/assets-prompt.md', [
  [
    '| `novel-characters` / `novel-art` | **英文短提示词**（`image.prompt` / `image.sheet`）与**设定板版式**（16:9 三区：左 34% 半身像 / 右上三视图 / 右下细节条） |',
    '| `novel-characters` / `novel-art` | **资产数据**：编号与中文名、人物档案（oneLiner / appearance）、场景**锚点**（补丁船篷、磨白的坐板）与**光照状态**（晨雾 / 雾散近岸）、道具功能与尺度 |',
    '分工表',
  ],
  [
    '| 本技能 | **清单与交接**：`assets` 生成每份资产的编号 / 类型 / 设定板路径 / 篇幅档位 / 版式句 / 素材摘要，交给人或 agent 递给 expander |',
    '| 本技能 | **清单与交接**：`assets` 把上面的资产数据原样摘进 brief（锚点、光照、档案一条不落），再配三区设定板版式与篇幅档位，排成一张单子 |',
    '分工本技能',
  ],
  [
    '上游 `image.prompt` **不能直接翻译**——它是标签式的短提示词，翻成中文仍然只有一两百字，缺的正是母稿要的生活痕迹与左右非对称。',
    `锚点和光照是跨集一致的唯一抓手。它们来自 \`art.json\`，\`assets\` 原样摘进 brief——**不要在这一步重写、精简或省略**，否则第二集生成的是另一个船舱。

上游那两条英文短提示词（\`image.prompt\` / \`image.sheet\`）和角色的 \`promptLocal\` **不参与本流程**：翻成中文也只有一两百字，缺的正是母稿要的生活痕迹与左右非对称。措辞交给 expander，事实交给 art/cast。`,
    '分工说明',
  ],
]);

patch('skills/comfy-production/SKILL.md', [
  [
    '上游 `novel-art` / `novel-characters` 给的 `image.prompt` / `image.sheet` 是**英文短提示词**，给通用文生图用的。MOSS 要的是 1500~2500 字中文连贯段落——两者不是翻译关系，是重写关系（结构与信息密度都不同，见 `references/moss-t2i.md`）。',
    '上游 `novel-art` / `novel-characters` 提供的是**资产数据**：场景锚点（补丁船篷、磨白的坐板）、光照状态、人物档案、道具功能。这些是跨集一致性的唯一抓手，原样进 brief。它们附带的 `image.prompt` / `image.sheet` 英文短提示词不参与本流程——母稿要的是 1500~2500 字中文连贯段落，那是重写不是翻译，交给 expander。',
    'Step 0.5 说明',
  ],
  [
    '所以资产母稿在**分镜之前**就能做，也必须先做：设定板出来了，后面的 Qwen 挂图才有东西可挂。',
    '所以资产提示词在**分镜之前**就能做，也必须先做：设定板出来了，后面的 Qwen 挂图才有东西可挂。',
    'Step 0.5 时机',
  ],
]);

console.log('✓ 文档已对齐：锚点与光照留在 art.json');
