import { readFileSync, writeFileSync } from 'node:fs';

const must = (c, m) => {
  if (!c) throw new Error(m);
};
const rep = (file, pairs) => {
  let s = readFileSync(file, 'utf8');
  for (const [from, to, what] of pairs) {
    must(s.split(from).length - 1 === 1, `${file} ${what}: ${s.split(from).length - 1}`);
    s = s.replace(from, to);
  }
  writeFileSync(file, s, 'utf8');
};

// ---------- SKILL.md ----------
const K = 'skills/comfy-production/SKILL.md';
let k = readFileSync(K, 'utf8');

// Step 0.5 整块替换
const a = k.indexOf('### Step 0.5 — 先出资产母稿（不用等分镜）');
const b = k.indexOf('### Step 1 — seed 工作底稿');
must(a > 0 && b > a, 'Step 0.5 定位');
k =
  k.slice(0, a) +
  `### Step 0.5 — 先出资产提示词（不用等分镜）

上游 \`novel-art\` / \`novel-characters\` 给的是**英文短提示词**（\`image.prompt\`）和三区**设定板版式**（左 34% 半身像 / 右上三视图 / 右下细节条）。中文长提示词不在这里手写——交给 [\`fisher-moss-prompt-expander\`](https://github.com/Work-Fisher/fisher-moss-prompt-expander)。

本技能只做**清单与交接**：把每份资产的编号、类型、设定板路径、篇幅档位、版式句、素材摘要排成一张单子。

\`\`\`bash
# 1) 出资产单：每份资产一节（篇幅 + 版式 + 素材 + 待贴位）
node {baseDir}/scripts/comfy-production.mjs assets art.json --cast cast.json --md > 资产生图单.md

# 2) 逐节交给 expander 扩写（它会读 references 里的构图/材质/手部模块）
#    使用 $fisher-moss-prompt-expander：按下面的版式扩写这份素材……只输出一个 text 代码块。

# 3) 把输出贴回 assets.<编号>.prompt（production.json 里），导出时才不会被冲掉
\`\`\`

分级自动：\`primary\` 场景与 \`importance: protagonist\` 的角色起 \`fine\` 档（1500~2500 字），其余 \`standard\`（350~600 字）。\`--md\` 之外不带参数时出 JSON 骨架，给 \`seed --assets\` 吃。写法与验图清单见 \`references/assets-prompt.md\`。

` +
  k.slice(b);

k = k.replace(
  '给了 `--assets` 就直接吃 Step 0.5 那份，母稿与中文名一起带过来；没给就从 `--art` / `--cast` 现建（母稿为空）。**不要用 `--art` 覆盖已经写过母稿的资产**——重建会把 `moss` 抹掉。',
  '给了 `--assets` 就直接吃 Step 0.5 那份，提示词与中文名一起带过来；没给就从 `--art` / `--cast` 现建。**不要用 `--art` 覆盖已经贴过提示词的资产**——重建会把 `prompt` 抹掉。',
);

k = k.replace(
  '5. **资产的 `moss`**：只给要出设定板的 CH/SC/PR 写。`tier: fine`（1500~2500 字，主角与主场景）或 `standard`（350~600 字，配角与道具）。写法见 `{baseDir}/references/moss-t2i.md`。写了 moss 的资产顺带补一个 `name`——`handoff-cast` 靠它核对「新入画的人有没有写明从哪来」。',
  '5. **资产的 `prompt`**：expander 输出的中文长提示词贴回 `assets.<编号>.prompt`。资产顺带要有 `name`——`handoff-cast` 靠它核对「新入画的人有没有写明从哪来」。版式与篇幅见 `{baseDir}/references/assets-prompt.md`。',
);

k = k.replace(/\| `moss-sheet` \|[^\n]*\n/, '');
k = k.replace(/\| `moss-tier` \|[^\n]*\n/, '');
k = k.replace('22 道质量门全部由脚本', '20 道质量门全部由脚本');
k = k.replace('22 道门，全是代码：', '20 道门，全是代码：');
k = k.replace('139 项断言', '138 项断言');
k = k.replace('22 道门每道都有击穿用例', '20 道门每道都有击穿用例');
k = k.replace(
  '├── E01-assets.md          ← 写了 moss 的资产母稿（MOSS 文生图）',
  '├── E01-assets.md          ← 资产生图单（版式 + 素材 + 贴回来的提示词）',
);
writeFileSync(K, k, 'utf8');
console.log('✓ SKILL.md');

// ---------- 技能 README ----------
rep('skills/comfy-production/README.md', [
  [
    `# 0) 资产母稿（分镜之前就能做，MOSS 用）
node scripts/comfy-production.mjs assets art.json --cast cast.json > production-assets.json
node scripts/comfy-production.mjs moss production-assets.json --require S01,C01,P01`,
    `# 0) 资产单（分镜之前就能做）：版式 + 素材 + 篇幅，交给 fisher-moss-prompt-expander 扩写
node scripts/comfy-production.mjs assets art.json --cast cast.json --md > 资产生图单.md`,
    'usage 0',
  ],
  ['# 2) 逐段填 h3Mode / qwen / tailFrom / assets.moss', '# 2) 逐段填 h3Mode / qwen / tailFrom / enter / exit / sound，并贴回 assets.prompt', 'usage 2'],
  ['# 1) 起骨架（吃上面那份，母稿与中文名一起带过来）', '# 1) 起骨架（吃上面那份，提示词与中文名一起带过来）', 'usage 1'],
  ['| 资产怎么出设定板 | MOSS 文生图母稿（`fine` 1500~2500 字 / `standard` 350~600 字） |',
   '| 资产怎么出设定板 | 沿用上游三区版式的资产单，中文长提示词交给 [`fisher-moss-prompt-expander`](https://github.com/Work-Fisher/fisher-moss-prompt-expander) 扩写 |', 'table'],
  ['- [`references/moss-t2i.md`](references/moss-t2i.md)：母稿两档、十段内容层、三类设定板的版面层',
   '- [`references/assets-prompt.md`](references/assets-prompt.md)：三方分工、三类设定板版式、篇幅档位、验图清单', 'refs'],
  ['22 道门', '20 道门', 'gates'],
  ['139 项断言', '138 项断言', 'tests'],
]);

// ---------- 根 README ----------
rep('README.md', [
  ['22 gates reconcile', '20 gates reconcile', 'en gates'],
  [
    '| [**comfy-production**](skills/comfy-production) | Wires the storyboard into local ComfyUI: per-frame Qwen-Image-2.1 multi-image edit prompts with `TextEncodeQwenImage21` slot order, MOSS text-to-image masters for characters / scenes / props, per-segment H3 mode and `17k+5` frame length, and a post-assembly pack (tail-frame dedupe table, J/L-cuts, ffmpeg, -14 LUFS). 22 gates reconcile against storyboard.json — four of them guard segment-to-segment continuity — so changing a cut length breaks the build |',
    '| [**comfy-production**](skills/comfy-production) | Wires the storyboard into local ComfyUI: per-frame Qwen-Image-2.1 multi-image edit prompts with `TextEncodeQwenImage21` slot order, asset briefs in the upstream three-view sheet layout (Chinese long-form prompts come from [`fisher-moss-prompt-expander`](https://github.com/Work-Fisher/fisher-moss-prompt-expander)), per-segment H3 mode and `17k+5` frame length, and a post-assembly pack (tail-frame dedupe table, J/L-cuts, ffmpeg, -14 LUFS). 20 gates reconcile against storyboard.json — four of them guard segment-to-segment continuity |',
    'en row',
  ],
]);

rep('README.zh.md', [
  ['22 道门对着 storyboard.json', '20 道门对着 storyboard.json', 'zh gates'],
  [
    '| [**comfy-production**](skills/comfy-production) | 把分镜接到本地 ComfyUI：每格的 Qwen-Image-2.1 多图编辑提示词与 `TextEncodeQwenImage21` 插槽顺位、资产的 MOSS 文生图母稿、每段 H3 模式与 `17k+5` 帧、成片总装（尾帧去重裁剪表 + J/L-Cut + ffmpeg + -14 LUFS）。22 道门对着 storyboard.json 逐条对账（其中四道专查段间接续），秒数一改就报错 |',
    '| [**comfy-production**](skills/comfy-production) | 把分镜接到本地 ComfyUI：每格的 Qwen-Image-2.1 多图编辑提示词与 `TextEncodeQwenImage21` 插槽顺位、按上游三视区版式排的资产单（中文长提示词交给 [`fisher-moss-prompt-expander`](https://github.com/Work-Fisher/fisher-moss-prompt-expander) 扩写）、每段 H3 模式与 `17k+5` 帧、成片总装（尾帧去重裁剪表 + J/L-Cut + ffmpeg + -14 LUFS）。20 道门对着 storyboard.json 逐条对账，其中四道专查段间接续 |',
    'zh row',
  ],
]);
console.log('✓ README ×3');
