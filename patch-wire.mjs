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

// ---------- novel-characters SKILL.md ----------
patch('skills/novel-characters/SKILL.md', [
  [
    '**语言分工**（人类字段跟随 `lang`、出图/TTS 提示词永远英文）',
    '**语言分工**（人类字段跟随 `lang`；`image.prompt` 写中文长版，反向词与设定图仍是英文）',
    '门描述',
  ],
  [
    '- 人类可读字段跟随 `--lang`（默认中文）；出图和 TTS 提示词**永远英文**，那些引擎吃英文最稳',
    `- 人类可读字段跟随 \`--lang\`（默认中文）
- \`image.prompt\` 写**中文长版**（≥300 字，行文规则与三区版式见 \`references/prompting.md\`）——那条就是投产用的提示词
- \`image.promptLocal\` 写英文对照给只吃英文的引擎；\`image.negativePrompt\` / \`image.sheet\` / \`tags\` 仍是英文机器字段
- TTS 音色提示词**永远英文**，那个引擎吃英文最稳`,
    '语言分工段落',
  ],
]);

// ---------- novel-art SKILL.md ----------
patch('skills/novel-art/SKILL.md', [
  [
    '  10 道质量门全部由脚本确定性检查（锚点 3–5、无人无手、白底可抠、尺度短语、提示词英文……）。',
    '  11 道质量门全部由脚本确定性检查（锚点 3–5、无人无手、白底可抠、尺度短语、中文长提示词 ≥300 字……）。',
    'frontmatter 描述',
  ],
  [
    '10 道质量门全是代码。场景 + 共用 6 道：锚点 3–5、光照状态 ≥1、**无人**、提示词全英文、不含角色名（给了 --cast 才查）、变体引用完整。道具专属 4 道：**状态 ≥1**、**尺度短语写进提示词**、**反向词禁手**、**设定图纯白背景**。',
    '11 道质量门全是代码。场景 + 共用 6 道：锚点 3–5、光照状态 ≥1、**无人**、反向词与标签全英文、不含角色名（给了 --cast 才查）、变体引用完整；外加**中文提示词够长（≥300 字）**。道具专属 4 道：**状态 ≥1**、**尺度短语写进提示词**、**反向词禁手**、**设定图纯白背景**。\n\n主视角 `image.prompt` 写**中文长版**（内容层 + 三区版式），规则见 `references/prompting.md`；写英文短版按旧数据兼容，不拦。',
    '门描述',
  ],
  [
    '- 报告界面内置中英（`--lang`，默认中文、或跟 art.json 的 `lang` 字段）；出图提示词永远英文',
    '- 报告界面内置中英（`--lang`，默认中文、或跟 art.json 的 `lang` 字段）；主视角提示词写中文长版，反向词与标签仍英文',
    '边界',
  ],
]);

// ---------- comfy-production：资产单直接吃上游写好的中文长提示词 ----------
patch('skills/comfy-production/scripts/comfy-production.mjs', [
  [
    `const sceneBrief = (sc) => joinBits(sc?.name, sc?.primary ? '主场景' : '', sc?.reusePlan, sc?.summary);`,
    `// 上游 novel-art / novel-characters 按 expander 规则写好的中文长提示词，直接拿来用，不再要求人去贴
const CJK_TEXT = /[\\u3400-\\u9fff]/;
const zhPrompt = (v) => (typeof v === 'string' && CJK_TEXT.test(v) ? v.trim() : '');

const sceneBrief = (sc) => joinBits(sc?.name, sc?.primary ? '主场景' : '', sc?.reusePlan, sc?.summary);`,
    'zhPrompt 工具',
  ],
  [
    `      tier: sc.primary ? 'fine' : 'standard',
      layout: 'sheet',
      brief: sceneBrief(sc),`,
    `      tier: sc.primary ? 'fine' : 'standard',
      layout: 'sheet',
      brief: sceneBrief(sc),
      prompt: zhPrompt(sc?.image?.prompt),`,
    'scene prompt',
  ],
  [
    `      tier: 'standard',
      layout: 'sheet',
      brief: propBrief(pr),`,
    `      tier: 'standard',
      layout: 'sheet',
      brief: propBrief(pr),
      prompt: zhPrompt(pr?.image?.prompt),`,
    'prop prompt',
  ],
  [
    `      tier: c.tier === 'lead' || c.importance === 'protagonist' ? 'fine' : 'standard',
      layout: 'sheet',
      brief: charBrief(c),`,
    `      tier: c.tier === 'lead' || c.importance === 'protagonist' ? 'fine' : 'standard',
      layout: 'sheet',
      brief: charBrief(c),
      prompt: zhPrompt(c?.image?.prompt),`,
    'character prompt',
  ],
]);

console.log('✓ 三处文档 + comfy-production 吃上游提示词');
