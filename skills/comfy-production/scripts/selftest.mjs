#!/usr/bin/env node
// 自测：覆盖 comfy-production 的全部确定性逻辑，不调模型、不花额度。
//   node scripts/selftest.mjs

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import {
  assetSkeleton,
  cutStarts,
  renderAssetSheet,
  descText,
  dialogueChars,
  fieldText,
  gateReport,
  gateStats,
  legalFrames,
  nearestLegal,
  renderAssets,
  renderPost,
  renderSegmentCard,
  seed,
  segSeconds,
  snapped,
  shotSlices,
} from './comfy-production.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, '../references/test-fixtures/沙盘-storyboard.json');
const SB = JSON.parse(readFileSync(FIX, 'utf8'));
const SCRIPT = join(HERE, 'comfy-production.mjs');
const TAIL = 'No text, no watermark, no borders — a single clean full-bleed frame.';

let passed = 0;
const ok = (cond, msg) => {
  assert.ok(cond, msg);
  passed += 1;
};
const eq = (a, b, msg) => {
  assert.equal(a, b, msg);
  passed += 1;
};
const clone = (o) => JSON.parse(JSON.stringify(o));

function baseProd() {
  return {
    source: '沙盘',
    ep: 1,
    fps: 24,
    aspectRatio: '16:9',
    params: { charsPerSecond: 4, frameTolerance: 2, maxQwenRefs: 5 },
    assets: {
      S01: { kind: 'scene', name: '渡船船舱', sheet: 'images/S01-sheet.png' },
      C01: { kind: 'character', name: '船工', sheet: 'images/C01-sheet.png' },
      P01: { kind: 'prop', name: '麻绳', sheet: 'images/P01-sheet.png' },
    },
    segments: [
      {
        id: 'E01-01',
        h3Mode: 'I2VA',
        lockSheet: null,
        tailFrom: null,
        dedupeFrames: 0,
        jCut: 0,
        postNote: '',
        enter: '开场：走廊空无一人，推车从画外推入。',
        exit: '推车已过电梯口，两人压住尸袋向左。',
        sound: { carry: [], keep: ['河面水声', '橹声'] },
        cuts: [
          {
            qwen: {
              canvas: 'S01',
              refs: ['C01', 'P01'],
              prompt: `沿用 <image1> 的空景、光位与右侧素墙，把 <image2> 的船工按中景放进画面左三分之一低头盘绳，<image3> 的麻绳堆在他脚边。${TAIL}`,
            },
          },
          {
            qwen: {
              canvas: 'S01',
              refs: ['C01'],
              prompt: `在 <image1> 里把机位推向船舷，对着 <image2> 的船工推成侧面特写，提灯从右打光，雨丝可见。${TAIL}`,
            },
          },
        ],
      },
      {
        id: 'E01-02',
        h3Mode: 'I2VA',
        lockSheet: null,
        tailFrom: null,
        dedupeFrames: 0,
        jCut: 0,
        postNote: '',
        enter: '承接 E01-01：船工视线从船舷外收回，落到跳板上的老人。',
        exit: '两人同站跳板两端，雨还在下。',
        sound: { carry: ['河面水声'], keep: ['雨打船篷'] },
        cuts: [
          {
            qwen: {
              canvas: 'S01',
              refs: ['C01'],
              prompt: `把 <image1> 拉开成渡口全景，<image2> 的船工站在画面左侧伸手扶住上跳板的老人。${TAIL}`,
            },
          },
        ],
      },
    ],
  };
}

const gatesOf = (prod, sb = SB) => Object.fromEntries(gateReport(prod, sb).map((g) => [g.id, g]));
const expectFail = (prod, id, sb = SB) => {
  const g = gatesOf(prod, sb)[id];
  ok(g && !g.ok, `${id} 应该失败，实际通过`);
};
const expectPass = (prod, id, sb = SB) => {
  const g = gatesOf(prod, sb)[id];
  ok(g && g.ok, `${id} 应该通过，实际失败：${g?.detail}`);
};
const withH3 = (sb, segId, fn) => {
  const copy = clone(sb);
  const seg = copy.episodes[0].segments.find((s) => s.id === segId);
  seg.h3Prompt = fn(seg.h3Prompt);
  return copy;
};

/* ---------------- 帧数 ---------------- */
{
  eq(legalFrames().slice(0, 5).join(','), '5,22,39,56,73', '合法帧数从 17k+5 开始');
  ok(legalFrames().includes(362), '362 帧是合法值');
  eq(nearestLegal(192), 192, '192 已经是合法帧数');
  eq(nearestLegal(200), 192, '200 吸附到 192');
  eq(nearestLegal(107.04), 107, '107.04 吸附到 107');
  eq(segSeconds({ cuts: [{ seconds: 3 }, { seconds: 5 }] }), 8, '段秒数是切秒数之和');
  eq(snapped({ cuts: [{ seconds: 3 }, { seconds: 5 }] }).frames, 192, '8 秒 = 192 帧');
  eq(snapped({ cuts: [{ seconds: 4.46 }] }).frames, 107, '4.46 秒 = 107 帧');
  eq(cutStarts([{ seconds: 3 }, { seconds: 5 }]).join(','), '0,3', '切点从 0 开始累加');
}

/* ---------------- 提示词读取 ---------------- */
{
  const h3 = SB.episodes[0].segments[0].h3Prompt;
  ok(fieldText(h3, 'non_diegetic_music:') === 'N/A', '配乐字段读到 N/A');
  ok(fieldText(h3, 'overall_soundscape:').startsWith('Water laps'), '声景字段读到正文');
  ok(!fieldText(h3, 'overall_soundscape:').includes('non_diegetic_music'), '声景不越界到下一个字段');
  const slices = shotSlices(descText(h3, 'I2VA'));
  eq(slices.length, 2, '两个 [Shot k] 切成两段');
  eq(slices[1].k, 2, '第二段的序号是 2');
  eq(dialogueChars(slices[0].text), 4, '「水涨了。」算 4 字');
  eq(dialogueChars(slices[1].text), 0, '第二镜没台词');
  eq(shotSlices(descText(h3, 'Ref2VA')).length, 0, 'Ref2VA 模式下不读 integrated_multimodal_description');
}

/* ---------------- 干净的数据全过 ---------------- */
{
  const gates = gateReport(baseProd(), SB);
  const st = gateStats(gates);
  eq(st.errors.length, 0, `干净数据不该有违规：${st.errors.map((g) => `${g.id} ${g.detail}`).join(' / ')}`);
  eq(st.warns.length, 0, '干净数据不该有警告');
  expectPass(baseProd(), 'frame-grid');
  expectPass(baseProd(), 'qwen-slots');
  expectPass(baseProd(), 'speech-fit');
}

/* ---------------- 对账门 ---------------- */
{
  const p = baseProd();
  p.segments[0].id = 'E01-09';
  expectFail(p, 'ref-segments', SB);

  const p2 = baseProd();
  p2.segments[0].cuts.push({ qwen: { canvas: 'S01', refs: [], prompt: TAIL } });
  expectFail(p2, 'ref-cuts', SB);

  // 秒数以 storyboard 为准：production 里写什么都不影响帧数
  const p3 = baseProd();
  p3.segments[0].cuts[0].seconds = 3.5;
  expectPass(p3, 'frame-grid', SB);

  const sbLong = clone(SB);
  sbLong.episodes[0].segments[0].cuts[0].seconds = 3.5;
  expectFail(baseProd(), 'frame-grid', sbLong);

  const sbEdge = clone(SB);
  sbEdge.episodes[0].segments[1].cuts[0].seconds = 5;
  expectFail(baseProd(), 'frame-grid', sbEdge);
}

/* ---------------- 模式与锁脸 ---------------- */
{
  const sbNoSound = withH3(SB, 'E01-01', (h) => h.replace('overall_soundscape:', 'audio_overview:'));
  expectFail(baseProd(), 'mode-shape', sbNoSound);

  const p = baseProd();
  p.segments[0].h3Mode = 'Ref2VA';
  ok(!gatesOf(p)['ref2va-lock'].ok, 'Ref2VA 没给 lockSheet 要拦');

  const p2 = baseProd();
  p2.segments[0].h3Mode = 'NOPE';
  expectFail(p2, 'mode-shape');

  const p3 = baseProd();
  p3.segments[0].h3Mode = 'Ref2VA';
  p3.segments[0].lockSheet = 'S01';
  ok(!gatesOf(p3)['ref2va-lock'].ok, 'lockSheet 不是 character 要拦');

  // Ref2VA 的六字段完整时，模式门通过
  const ref2vaH3 = [
    'subject_definitions: <Subject 1> is a weathered ferryman from <Picture 2>. <Picture 1> is the opening keyframe at 0.00 seconds.',
    'summary: [keyframe completion + reference generation] A three-second two-shot on the ferry.',
    'retention_analysis: <Picture 1> (appears in [Shot 1]): fully_preserved - anchor the opening composition. <Subject 1> (appears in [Shot 1]): fully_preserved - lock the face from <Picture 2>.',
    'detailed_description: [Shot 1] A medium shot of <Subject 1> coiling wet rope. The camera holds steady.',
    'overall_soundscape: Water laps the hull.',
    'non_diegetic_music: N/A',
  ].join('\n\n');
  const sbRef = withH3(SB, 'E01-01', () => ref2vaH3);
  const pRef = baseProd();
  pRef.segments[0].h3Mode = 'Ref2VA';
  pRef.segments[0].lockSheet = 'C01';
  expectPass(pRef, 'mode-shape', sbRef);
  expectPass(pRef, 'ref2va-lock', sbRef);

  const sbBaseWithRef = withH3(SB, 'E01-01', (h) => `${ref2vaH3}\n\n${h}`);
  expectFail(baseProd(), 'mode-shape', sbBaseWithRef);
}

/* ---------------- Qwen 插槽 ---------------- */
{
  const p = baseProd();
  p.segments[0].cuts[0].qwen.canvas = 'C01';
  expectFail(p, 'qwen-canvas');

  const p2 = baseProd();
  p2.segments[0].cuts[0].qwen.canvas = '';
  expectFail(p2, 'qwen-canvas');

  const p3 = baseProd();
  p3.segments[0].cuts[0].qwen.refs = ['C01'];
  expectFail(p3, 'qwen-coverage');

  const p4 = baseProd();
  p4.segments[0].cuts[0].qwen.refs = ['C01', 'P01', 'X99'];
  expectFail(p4, 'qwen-coverage');

  const p5 = baseProd();
  p5.segments[0].cuts[0].qwen.refs = ['C01', 'P01', 'C02', 'C03', 'C04', 'C05'];
  expectFail(p5, 'qwen-coverage');

  const p6 = baseProd();
  p6.segments[0].cuts[0].qwen.prompt = `<image1> 和 <image2>，把船工放左边。${TAIL}`;
  expectFail(p6, 'qwen-slots');

  const p7 = baseProd();
  p7.segments[0].cuts[0].qwen.refs = [];
  p7.segments[0].cuts[1].qwen.refs = [];
  p7.segments[0].cuts[0].qwen.prompt = `把 <image1> 里的人物擦掉，改成空景。${TAIL}`;
  expectFail(p7, 'qwen-slots');
}

/* ---------------- Qwen 提示词不越权 ---------------- */
{
  const bad = [
    ['画幅', `沿用 <image1> 的空景，把 <image2> 的人放左边，16:9 构图。${TAIL}`],
    ['像素', `沿用 <image1> 的空景，把 <image2> 的人放左边，1344x768。${TAIL}`],
    ['文件名', `沿用 <image1> 的空景，把 <image2> 的 CH-01.png 放左边。${TAIL}`],
    ['权重', `沿用 <image1> 的空景，把 <image2> 的人放左边 (shipman:1.3)。${TAIL}`],
    ['否定句', `沿用 <image1> 的空景，no blur, no extra people.${TAIL}`],
    ['图1', `沿用 图1 的空景，把 <image2> 的人放左边。${TAIL}`],
  ];
  for (const [name, prompt] of bad) {
    const p = baseProd();
    p.segments[0].cuts[0].qwen.prompt = prompt;
    expectFail(p, 'qwen-clean');
    ok(gatesOf(p)['qwen-clean'].detail.includes(name) || name === '图1', `qwen-clean 应点名${name}`);
  }

  const p = baseProd();
  p.segments[0].cuts[0].qwen.prompt = '沿用 <image1> 的空景，把 <image2> 的船工放左边，<image3> 的麻绳放脚边。';
  expectFail(p, 'qwen-tail');
}

/* ---------------- 视频层防雷 ---------------- */
{
  const sbWhip = withH3(SB, 'E01-01', (h) => h.replace('The camera pushes in with small amplitude at slow speed.', 'The camera opens with a rapid whip-pan from left to right.'));
  expectFail(baseProd(), 'whip-pan', sbWhip);

  // 尾帧接力：生产者末镜必须有稳焦词
  const p = baseProd();
  p.segments[1].tailFrom = 'E01-01';
  p.segments[1].dedupeFrames = 12;
  expectPass(p, 'tail-anchor', SB);
  const sbNoSettle = withH3(SB, 'E01-01', (h) => h.replace('The camera holds completely still.', 'The camera keeps shaking wildly.'));
  expectFail(p, 'tail-anchor', sbNoSettle);

  const p2 = baseProd();
  p2.segments[1].tailFrom = 'E01-99';
  expectFail(p2, 'tail-anchor');

  const p3 = baseProd();
  p3.segments[1].tailFrom = 'E01-01';
  p3.segments[1].dedupeFrames = 999;
  expectFail(p3, 'tail-anchor');

  const sbOff = withH3(SB, 'E01-02', (h) => h.replace('He says quietly:', 'He says in an off-screen voiceover:'));
  expectFail(baseProd(), 'offscreen-lips', sbOff);

  const sbLip = withH3(SB, 'E01-02', (h) => h.replace('He says quietly:', 'He says in an off-screen voiceover while his lips remain completely closed:'));
  expectPass(baseProd(), 'offscreen-lips', sbLip);

  const sbSnd = withH3(SB, 'E01-02', (h) => h.replace('rain patters on the canvas awning', 'a faint voice murmurs under the awning'));
  expectFail(baseProd(), 'soundscape-vocals', sbSnd);

  const sbMus = withH3(SB, 'E01-02', (h) => h.replace('A single low cello note holds under the ambience.', 'Tense emotional music throughout.'));
  expectFail(baseProd(), 'music-spec', sbMus);
}

/* ---------------- 资产骨架与资产生图单 ---------------- */
{
  const art = {
    source: '渡口',
    scenes: [
      {
        id: 'S01',
        name: '渡船船舱',
        primary: true,
        summary: '六排坐板的老木船敞篷客舱',
        lighting: '晨雾散射光，篷布漏光',
        anchors: [{ name: '补丁船篷', desc: '右后角一块更深色的方形补丁' }],
      },
      { id: 'S02', name: '栈桥' },
    ],
    props: [{ id: 'P01', name: '旧皮箱', summary: '磨白的藤条皮箱' }],
  };
  const cast = {
    characters: [
      { name: '阿禾', importance: 'protagonist', oneLiner: '十九岁，抱皮箱北上', persona: { appearance: '梳两条长辫，藏青学生装' } },
      { name: '沈知微' },
    ],
  };
  const sk = assetSkeleton(art, cast);
  eq(Object.keys(sk.assets).join(), 'S01,S02,P01,C01,C02', '骨架编号：场景→道具→角色');
  eq(sk.assets.S01.tier, 'fine', '主场景起 fine 档');
  eq(sk.assets.S02.tier, 'standard', '次要场景起 standard 档');
  eq(sk.assets.C01.tier, 'fine', '主角起 fine 档');
  eq(sk.assets.C02.tier, 'standard', '配角起 standard 档');
  eq(sk.assets.C01.layout, 'sheet', '资产默认出设定板');
  eq(sk.assets.C01.name, '阿禾', '带中文名，handoff-cast 要用');
  eq(sk.assets.S01.sheet, 'images/渡船船舱-sheet.png', '设定板路径按名字推');
  ok(sk.assets.S01.moss === undefined, '不再自己存 moss 母稿');
  ok(sk.assets.S01.brief.includes('六排坐板'), '场景 brief 带 summary');
  ok(sk.assets.S01.brief.includes('光照'), '场景 brief 带光照');
  ok(sk.assets.S01.brief.includes('补丁船篷'), '场景 brief 带锚点');
  ok(sk.assets.C01.brief.includes('皮箱'), '角色 brief 带 oneLiner');
  ok(sk.assets.P01.brief.includes('藤条'), '道具 brief 带 summary');
  ok(!JSON.stringify(sk).includes('[object Object]'), '美术设定里的数组字段要被拍平，不能漏成 [object Object]');

  const md = renderAssetSheet(sk);
  ok(md.includes('fisher-moss-prompt-expander'), '生图单点名 expander');
  ok(md.includes('不要翻'), '生图单明说别翻译英文 prompt');
  ok(md.includes('左侧约 34%'), '角色版式沿用上游三区比例');
  ok(md.includes('三视图'), '角色版式要求三视图');
  ok(md.includes('16:9 纯白底'), '道具版式要求纯白底');
  ok(md.includes('不写任何文字标注'), '版式禁文字标注');
  ok(md.includes('1500~2500 字'), 'fine 档给出篇幅提示');
  ok(md.includes('350~600 字'), 'standard 档给出篇幅提示');
  ok(md.includes('素材：'), '每节带素材，不用重新找上游');
  eq(md.split('在这里贴 expander 的输出').length - 1, 5, '每个资产一个待贴位');

  const single = assetSkeleton(art, cast);
  single.assets.S01.layout = 'single';
  ok(renderAssetSheet(single).includes('不要分格'), '单图资产明确不要分格');

  const filled = assetSkeleton(art, cast);
  filled.assets.S01.prompt = '版面：16:9 三区……（expander 的输出）';
  ok(renderAssetSheet(filled).includes('expander 的输出'), '贴回来的提示词会出现在单子里');
  eq(renderAssetSheet(filled).split('在这里贴 expander 的输出').length - 1, 4, '已贴的那份不再显示占位');

  const withAssets = seed(SB, 1, { assets: sk.assets });
  eq(withAssets.assets.C01.name, '阿禾', 'seed 保留资产中文名');
  eq(withAssets.assets.S01.layout, 'sheet', 'seed 保留版面标记');
  eq(Object.keys(seed(SB, 1, { art, cast }).assets).join(), 'S01,S02,P01,C01,C02', '没给 --assets 时从 art/cast 现建');
}

/* ---------------- 段落接续 ---------------- */
{
  const noEnter = baseProd();
  delete noEnter.segments[1].enter;
  expectFail(noEnter, 'handoff-state');

  const noExit = baseProd();
  noExit.segments[0].exit = '';
  expectFail(noExit, 'handoff-state');

  // 视线：上段末镜看「船舷外」，enter 里必须交代视线转走
  const noEye = baseProd();
  noEye.segments[1].enter = '承接 E01-01：两人已经站定。';
  expectFail(noEye, 'handoff-eyeline');
  expectPass(baseProd(), 'handoff-eyeline');

  // 声音：底噪必须和上段留声有交集
  const noKeep = baseProd();
  noKeep.segments[0].sound.keep = [];
  expectFail(noKeep, 'handoff-sound');

  const noCarry = baseProd();
  noCarry.segments[1].sound.carry = [];
  expectFail(noCarry, 'handoff-sound');

  const wrongCarry = baseProd();
  wrongCarry.segments[1].sound.carry = ['雨打船篷'];
  expectFail(wrongCarry, 'handoff-sound');

  // 人物：新入画的人必须在 enter 里写明来源
  const sbCast = clone(SB);
  sbCast.episodes[0].segments[1].cuts[0].characters = ['C01', 'C02'];
  const castProd = baseProd();
  castProd.assets.C02 = { kind: 'character', name: '老妇', sheet: 'images/C02-sheet.png' };
  expectFail(castProd, 'handoff-cast', sbCast);
  castProd.segments[1].enter = '承接 E01-01：船工视线从船舷外收回；老妇从右后方提灯入画。';
  expectPass(castProd, 'handoff-cast', sbCast);

  // 没写 name 时这道门明确跳过，不假装通过
  const noNames = baseProd();
  for (const id of Object.keys(noNames.assets)) delete noNames.assets[id].name;
  ok(gatesOf(noNames)['handoff-cast'].skipped, '没写 name 时 handoff-cast 明确跳过');
}

/* ---------------- 台词预算 ---------------- */
{
  const sbLong = withH3(SB, 'E01-01', (h) => h.replace('水涨了。', '水涨得太快了，我们得赶紧把船撑到对岸去。'));
  expectFail(baseProd(), 'speech-fit', sbLong);

  // 同一句放在 5 秒的镜里就装得下
  const sbMove = withH3(SB, 'E01-01', (h) => {
    const long = '水涨得太快了，我们得赶紧把船撑到对岸去。';
    return h.replace('水涨了。', '走。').replace('他抬眼望向船舷外', long);
  });
  const p = baseProd();
  p.params.charsPerSecond = 2;
  expectPass(p, 'speech-fit', sbMove);
}

/* ---------------- 导出 ---------------- */
{
  const p = baseProd();
  p.segments[1].tailFrom = 'E01-01';
  p.segments[1].dedupeFrames = 12;
  const card = renderSegmentCard(p, SB, p.segments[0]);
  ok(card.includes('`image_1`：`S01`'), '投产卡列出 image_1');
  ok(card.includes('`image_3`：`P01`'), '投产卡列出 image_3');
  ok(card.includes('192 frames'), '投产卡写实际帧数');
  ok(card.includes('Picture 1'), '投产卡列出 H3 槽位');
  ok(card.includes('integrated_multimodal_description:'), '投产卡带完整 H3 提示词');

  const post = renderPost(p, SB);
  ok(post.includes('| E01-02 | 107f |'), '后期表按吸附帧数写');
  ok(post.includes('ffmpeg -y -ss 0.5 -t 3.96'), '去重 12 帧后从 0.5s 起裁');
  ok(post.includes('loudnorm=I=-14'), '总装带 -14 LUFS 归一');
  ok(post.includes("file 'clip-E01-01.mp4'"), '拼接清单按段序');
  ok(post.includes("cat > concat.txt <<'EOF'"), '拼接清单写成 heredoc，跑得起来');
}

/* ---------------- seed ---------------- */
{
  const art = { scenes: [{ id: 'S01', name: '渡船船舱' }], props: [{ id: 'P01', name: '竹篙' }] };
  const cast = { characters: [{ name: '阿禾' }, { name: '沈知微' }] };
  const prod = seed(SB, 1, { art, cast });
  eq(prod.segments.length, 2, 'seed 出两段');
  eq(prod.segments[0].cuts.length, 2, 'seed 保住切数');
  eq(prod.segments[0].cuts[0].qwen.canvas, 'S01', 'seed 按 sceneIndex 填画布');
  eq(prod.assets.C02.kind, 'character', 'case：cast 转成 C 编号');
  eq(prod.segments[0].h3Mode, 'I2VA', 'seed 默认 I2VA');
  assert.throws(() => seed(SB, 9), /没有第 9 集/);
  passed += 1;
}

/* ---------------- CLI 端到端 ---------------- */
{
  const dir = mkdtempSync(join(tmpdir(), 'comfy-production-'));
  try {
    const seeded = spawnSync(process.execPath, [SCRIPT, 'seed', FIX, '--ep', '1'], { encoding: 'utf8' });
    eq(seeded.status, 0, `seed 退出码 0：${seeded.stderr}`);
    const prod = JSON.parse(seeded.stdout);
    eq(prod.segments.length, 2, 'seed 输出可直接解析');

    const prodPath = join(dir, 'production.json');
    writeFileSync(prodPath, JSON.stringify(baseProd(), null, 2), 'utf8');

    const v = spawnSync(process.execPath, [SCRIPT, 'validate', prodPath, '--storyboard', FIX], { encoding: 'utf8' });
    eq(v.status, 0, `干净数据 validate 退出码 0：${v.stdout}${v.stderr}`);
    ok(v.stdout.includes('0 违规'), 'validate 输出违规计数');

    const noSb = spawnSync(process.execPath, [SCRIPT, 'validate', prodPath], { encoding: 'utf8' });
    assert.notEqual(noSb.status, 0, '不给 --storyboard 必须失败');
    ok(noSb.stderr.includes('--storyboard'), '缺 --storyboard 时说清原因');
    passed += 1;

    const artPath = join(dir, 'art.json');
    writeFileSync(
      artPath,
      JSON.stringify({ scenes: [{ id: 'S01', name: '渡船船舱', primary: true }], props: [{ id: 'P01', name: '竹篙' }] }),
      'utf8',
    );
    const a = spawnSync(process.execPath, [SCRIPT, 'assets', artPath], { encoding: 'utf8' });
    eq(a.status, 0, `assets 退出码 0：${a.stderr}`);
    const skel = JSON.parse(a.stdout);
    eq(skel.assets.S01.tier, 'fine', 'assets 子命令起出 fine 档');
    eq(skel.assets.P01.kind, 'prop', 'assets 子命令认道具');

    const am = spawnSync(process.execPath, [SCRIPT, 'assets', artPath, '--md'], { encoding: 'utf8' });
    eq(am.status, 0, 'assets --md 退出码 0');
    ok(am.stdout.includes('fisher-moss-prompt-expander'), 'assets --md 出的是生图单');
    ok(am.stdout.includes('设定板文件：images/渡船船舱-sheet.png'), '生图单带设定板路径');

    const out = join(dir, 'export');
    const e = spawnSync(process.execPath, [SCRIPT, 'export', prodPath, '--storyboard', FIX, '--out', out], { encoding: 'utf8' });
    eq(e.status, 0, `export 退出码 0：${e.stderr}`);
    ok(existsSync(join(out, 'E01-01', 'index.md')), '导出每段一张投产卡');
    ok(existsSync(join(out, 'E01-02', 'index.md')), '导出第二段');
    ok(existsSync(join(out, 'E01-post.md')), '导出后期总装');
    ok(existsSync(join(out, 'E01-assets.md')), '导出资产母稿');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(`✓ ${passed} 项自测全部通过`);
