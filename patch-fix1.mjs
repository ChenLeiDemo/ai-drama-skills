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

// ---------- A. seed：--assets 单独也能算画布 ----------
patch('skills/comfy-production/scripts/comfy-production.mjs', [
  [
    `  const scenes = art?.scenes ?? [];
  // 阶段二做过资产单就直接吃那份，别再从 outline 重建——重建会抹掉贴回来的提示词
  const assetMap = assets?.assets ?? (assets && typeof assets === 'object' ? assets : assetSkeleton(art, cast).assets);`,
    `  const scenes = art?.scenes ?? [];
  // 阶段二做过资产单就直接吃那份，别再从 art/cast 重建——重建会把贴回来的提示词抹掉
  const assetMap = assets?.assets ?? (assets && typeof assets === 'object' ? assets : assetSkeleton(art, cast).assets);
  // 画布按资产里场景的登记顺序取：没给 --art 也能定位第 n 场用哪张空景
  const sceneIds = Object.entries(assetMap)
    .filter(([, a]) => a?.kind === 'scene')
    .map(([id]) => id);`,
    'seed 场景来源',
  ],
  [
    "          canvas: scenes[seg.sceneIndex - 1]?.id ?? '',",
    "          canvas: sceneIds[seg.sceneIndex - 1] ?? scenes[seg.sceneIndex - 1]?.id ?? '',",
    'canvas',
  ],
]);

// ---------- B. 资产单：上游已经写好中文长提示词时不再要求人去跑 expander ----------
patch('skills/comfy-production/scripts/comfy-production.mjs', [
  [
    `  L.push('上游 art.json / cast.json 的 image.prompt 是英文短提示词，不要翻译。把下面每节的「素材 + 版式 + 篇幅」交给 expander，把它输出的中文长提示词贴回该节，再整段复制进 MOSS。');`,
    `  L.push('两种来源，按小节里的「指令」走：上游 \`novel-art\` / \`novel-characters\` 已经写了中文长提示词的，直接用；还没写的，把「素材 + 版式 + 篇幅」交给 fisher-moss-prompt-expander 扩写，再贴回 \`assets.<编号>.prompt\`。');`,
    '资产单抬头',
  ],
  [
    `    if ((a.layout ?? 'sheet') === 'sheet') {
      L.push(\`- 版式：\${SHEET_LAYOUT[a.kind] ?? '16:9 单格'}\`);
      L.push('- 指令：使用 $fisher-moss-prompt-expander 按上述版式扩写；只输出一个 text 代码块。');
    } else {
      L.push('- 版式：单图，不要分格不要分隔线。');
      L.push('- 指令：使用 $fisher-moss-prompt-expander 扩写单张画面；只输出一个 text 代码块。');
    }`,
    `    if ((a.layout ?? 'sheet') === 'sheet') {
      L.push(\`- 版式：\${SHEET_LAYOUT[a.kind] ?? '16:9 单格'}\`);
      L.push(
        str(a.prompt).trim()
          ? '- 指令：上游已写好中文长提示词，直接复制下方内容。'
          : '- 指令：使用 $fisher-moss-prompt-expander 按上述版式扩写；只输出一个 text 代码块。',
      );
    } else {
      L.push('- 版式：单图，不要分格不要分隔线。');
      L.push(
        str(a.prompt).trim()
          ? '- 指令：上游已写好，直接复制下方内容。'
          : '- 指令：使用 $fisher-moss-prompt-expander 扩写单张画面；只输出一个 text 代码块。',
      );
    }`,
    '资产单指令',
  ],
  [
    `  const L = ['# 资产生图单（交给 fisher-moss-prompt-expander）', ''];`,
    `  const L = ['# 资产生图单（上游版式 + expander）', ''];`,
    '标题',
  ],
]);

// ---------- C. 文档纠正 ----------
patch('skills/comfy-production/SKILL.md', [
  [
    '中文长提示词不在这里手写——交给 [`fisher-moss-prompt-expander`](https://github.com/Work-Fisher/fisher-moss-prompt-expander)。上游附带的 `image.prompt` / `image.sheet` 英文短提示词不参与本流程：翻成中文也只有一两百字，缺的正是母稿要的生活痕迹与左右非对称。',
    '它们的 `image.prompt` 现在就是**按 [`fisher-moss-prompt-expander`](https://github.com/Work-Fisher/fisher-moss-prompt-expander) 规则写好的中文长提示词**（内容层 + 三区版面，见各技能的 `references/prompting.md`）。本技能直接拿来用；只有上游还没写的时候，才在这张单子上要求 agent 现跑 expander 补。',
    'Step 0.5 来源',
  ],
]);

patch('skills/comfy-production/references/assets-prompt.md', [
  [
    '| `novel-characters` / `novel-art` | **资产数据**：编号与中文名、人物档案（oneLiner / appearance）、场景**锚点**（补丁船篷、磨白的坐板）与**光照状态**（晨雾 / 雾散近岸）、道具功能与尺度 |',
    '| `novel-characters` / `novel-art` | **资产数据 + 中文长提示词**：编号、人物档案、场景锚点（补丁船篷、磨白的坐板）与光照状态（晨雾 / 雾散近岸）、道具功能与尺度，以及按 expander 规则写好的 `image.prompt` |',
    '分工表',
  ],
  [
    '上游那两条英文短提示词（`image.prompt` / `image.sheet`）和角色的 `promptLocal` **不参与本流程**：翻成中文也只有一两百字，缺的正是母稿要的生活痕迹与左右非对称。措辞交给 expander，事实交给 art/cast。',
    '上游的 `image.prompt` 就是投产用的那条（中文长版），`assets` 会直接把它带进资产单，不再要求人贴。`image.sheet` / `image.negativePrompt` / `tags` 仍是给英文模型的机器字段。上游没写中文长版时，资产单才会给出 `$fisher-moss-prompt-expander` 的扩写指令。',
    '分工说明',
  ],
]);

console.log('✓ 三处修好');
