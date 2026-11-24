#!/usr/bin/env node
// comfy-production：把 novel-storyboard 的 storyboard.json 接到 ComfyUI 生产层。
// 结构真理源仍是 storyboard.json（段号、切数、秒数、H3 提示词正文都在那边）；
// 这份脚本只补它没有的三件事：每格的 Qwen 多图编辑提示词与插槽、资产的 MOSS 母稿、后期总装参数。
// 零依赖，只用标准库。自测：node scripts/selftest.mjs

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const STEP = 17;
const BASE = 5;
const DEFAULT_FPS = 24;

export const MODES = ['T2VA', 'I2VA', 'FL2VA', 'L2VA', 'Ref2VA'];
const BASE_FIELDS = [
  'integrated_multimodal_description:',
  'overall_soundscape:',
  'non_diegetic_music:',
];
const REF_FIELDS = [
  'subject_definitions:',
  'summary:',
  'retention_analysis:',
  'detailed_description:',
  'overall_soundscape:',
  'non_diegetic_music:',
];
const ALL_FIELDS = [...new Set([...BASE_FIELDS, ...REF_FIELDS])];

const TAIL_SETTLE =
  /(settles into a sharp|steady hold|comes to a (full )?stop|holds? completely still|remains? (perfectly )?still|motionless|freez|stops? and holds)/i;
const WHIP = /(whip[- ]pan|rapid whip|fast whip|急速甩镜|快速甩镜)/i;
const VOCAL = /\b(voice|vocal|speech|words|talking|talk|chatter|murmur|whisper|conversation)s?\b/i;
const INSTRUMENT =
  /\b(cello|violin|viola|piano|drum|taiko|synth|brass|string|bass|guitar|flute|horn|percussion|pad|timpani|reed|organ|choir|pluck)/i;
const WEIGHT = /\([^)]*:\s*\d+(?:\.\d+)?\)/;
const NEGATIVE = /(^|[\s(])(no|not|without)\s+[a-z]/i;
const ASPECT = /\b(16\s*:\s*9|9\s*:\s*16|21\s*:\s*9|4\s*:\s*3|1\s*:\s*1)\b/;
const PIXELS = /\b\d{3,4}\s*[x×]\s*\d{3,4}\b/;
const FILE = /\.(png|jpe?g|webp|mp4)\b/i;
const CN_REF = /(图\s*1|第一张图|参考图\s*[A-Za-z])/;
const TEXTLESS = 'No text, no watermark, no borders';

const r2 = (n) => Math.round(n * 100) / 100;
const str = (v) => String(v ?? '');

/* ------------------------------------------------------------------ */
/* 帧数与时间轴                                                          */
/* ------------------------------------------------------------------ */

// ComfyUI 量化版 H3：length = 17k + 5
export function legalFrames(max = 400) {
  const out = [];
  for (let f = BASE; f <= max; f += STEP) out.push(f);
  return out;
}

export function nearestLegal(n) {
  const legal = legalFrames();
  let best = legal[0];
  for (const f of legal) if (Math.abs(f - n) < Math.abs(best - n)) best = f;
  return best;
}

export function segSeconds(seg) {
  return (seg?.cuts ?? []).reduce((s, c) => s + (Number(c?.seconds) || 0), 0);
}

export function segFrames(seg, fps = DEFAULT_FPS) {
  return Math.round(segSeconds(seg) * fps);
}

// 吸附后的真实生成帧数与时长
export function snapped(seg, fps = DEFAULT_FPS) {
  const raw = segFrames(seg, fps);
  const frames = nearestLegal(raw);
  return { raw, frames, seconds: r2(frames / fps) };
}

export function cutStarts(cuts) {
  const out = [];
  let t = 0;
  for (const c of cuts ?? []) {
    out.push(r2(t));
    t += Number(c?.seconds) || 0;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* H3 提示词读取（只读，不负责它的结构——那是 novel-storyboard 的事）        */
/* ------------------------------------------------------------------ */

export function fieldText(h3, name) {
  const i = str(h3).indexOf(name);
  if (i < 0) return '';
  const rest = str(h3).slice(i + name.length);
  const m = rest.match(new RegExp(`\\n\\s*(?:${ALL_FIELDS.map((f) => f.replace(':', '\\:')).join('|')})`));
  return (m ? rest.slice(0, m.index) : rest).trim();
}

export function descText(h3, mode) {
  const name = mode === 'Ref2VA' ? 'detailed_description:' : 'integrated_multimodal_description:';
  return fieldText(h3, name);
}

// 按 [Shot k] 切段——每个镜头自己的那一行
export function shotSlices(desc) {
  const marks = [];
  const re = /\[Shot\s+(\d+)\]/g;
  let m;
  while ((m = re.exec(str(desc)))) marks.push({ k: Number(m[1]), i: m.index });
  return marks.map((x, j) => ({
    k: x.k,
    text: str(desc).slice(x.i, j + 1 < marks.length ? marks[j + 1].i : str(desc).length),
  }));
}

export function dialogueChars(slice) {
  const re = /<\s*d\s*>\s*\[[^\]]*\]\s*([\s\S]*?)<\s*\/\s*d\s*>/g;
  let n = 0;
  let m;
  while ((m = re.exec(str(slice)))) n += m[1].replace(/\s+/g, '').length;
  return n;
}

const paramsOf = (prod) => ({
  fps: Number(prod?.fps) || DEFAULT_FPS,
  charsPerSecond: Number(prod?.params?.charsPerSecond) || 4,
  frameTolerance: Number(prod?.params?.frameTolerance) || 2,
  maxQwenRefs: Number(prod?.params?.maxQwenRefs) || 5,
});

// production 的切只有提示词，秒数在 storyboard 里——所有算时长的地方都走这个视图，
// 避免同一个秒数存两份、改一处忘另一处（这正是要防的漂移）
export function timedSegments(prod, sb) {
  const sbSegs = (sb?.episodes ?? []).find((e) => Number(e?.ep) === Number(prod?.ep))?.segments ?? [];
  const byId = new Map(sbSegs.map((s) => [s.id, s]));
  return (prod?.segments ?? []).filter(Boolean).map((seg) => {
    const ref = byId.get(seg.id);
    return {
      ...seg,
      cuts: (seg.cuts ?? []).map((cut, i) => ({ ...cut, seconds: ref?.cuts?.[i]?.seconds })),
    };
  });
}

/* ------------------------------------------------------------------ */
/* 质量门                                                               */
/* ------------------------------------------------------------------ */

export function gateReport(prod, sb) {
  const gates = [];
  const add = (id, label, ok, detail = '', level = 'error') =>
    gates.push({ id, label, ok, detail, level });
  const p = paramsOf(prod);
  const assets = prod?.assets ?? {};
  const assetIds = Object.keys(assets);
  const sbSegs = (sb?.episodes ?? []).find((e) => Number(e?.ep) === Number(prod?.ep))?.segments ?? [];
  const byId = new Map(sbSegs.map((s) => [s.id, s]));
  const segs = timedSegments(prod, sb);

  // 1 段号对账
  const wantIds = sbSegs.map((s) => s.id);
  const gotIds = segs.map((s) => s.id);
  add(
    'ref-segments',
    '段号与 storyboard 一致',
    wantIds.length > 0 && wantIds.join() === gotIds.join(),
    wantIds.length === 0
      ? `storyboard 里没有第 ${prod?.ep} 集`
      : wantIds.join(' ') === gotIds.join(' ')
        ? ''
        : `storyboard: ${wantIds.join(' ')} / production: ${gotIds.join(' ')}`,
  );

  // 2 切数对账
  const cutBad = [];
  const noSb = [];
  for (const seg of segs) {
    const ref = byId.get(seg.id);
    if (!ref) {
      noSb.push(seg.id);
      continue;
    }
    if ((seg.cuts ?? []).length !== (ref.cuts ?? []).length) {
      cutBad.push(`${seg.id} production ${(seg.cuts ?? []).length} 切 / storyboard ${(ref.cuts ?? []).length} 切`);
    }
  }
  add(
    'ref-cuts',
    '每段切数与 storyboard 一致',
    noSb.length === 0 && cutBad.length === 0,
    [...(noSb.length ? [`storyboard 里没有：${noSb.join(', ')}`] : []), ...cutBad].join('；'),
  );

  // 3 帧数落在 17k+5
  const frameBad = [];
  const frameNote = [];
  for (const seg of segs) {
    const s = snapped(seg, p.fps);
    frameNote.push(`${seg.id}:${s.frames}f/${s.seconds}s`);
    if (Math.abs(s.raw - s.frames) > p.frameTolerance) {
      frameBad.push(`${seg.id} Σ切 ${r2(segSeconds(seg))}s = ${s.raw}f，最近合法 ${s.frames}f，差 ${Math.abs(s.raw - s.frames)} 帧`);
    }
  }
  add(
    'frame-grid',
    '段帧数为 17k+5',
    frameBad.length === 0,
    frameBad.length ? frameBad.join('；') : frameNote.join(' '),
  );

  // 4 模式字段族（与 storyboard 的 h3Prompt 对账，不另写一份提示词）
  const shapeBad = [];
  for (const seg of segs) {
    const ref = byId.get(seg.id);
    const h3 = str(ref?.h3Prompt);
    const mode = seg?.h3Mode;
    if (!MODES.includes(mode)) {
      shapeBad.push(`${seg.id} h3Mode「${mode}」不在 ${MODES.join('/')}`);
      continue;
    }
    const want = mode === 'Ref2VA' ? REF_FIELDS : BASE_FIELDS;
    const miss = want.filter((f) => h3.indexOf(f) < 0);
    if (miss.length) {
      shapeBad.push(`${seg.id} 的 h3Prompt 缺 ${miss.join(' ')}（${mode}）`);
      continue;
    }
    if (mode !== 'Ref2VA' && h3.indexOf('subject_definitions:') >= 0) {
      shapeBad.push(`${seg.id} 是 ${mode} 却带了 Ref2VA 的 subject_definitions:`);
    }
    const idx = want.map((f) => h3.indexOf(f));
    if (idx.some((v, i) => i > 0 && v < idx[i - 1])) {
      shapeBad.push(`${seg.id} 的 h3Prompt 字段顺序不对（${mode}）`);
    }
  }
  add('mode-shape', 'H3 模式与提示词字段族一致', shapeBad.length === 0, shapeBad.join('；'));

  // 5 Ref2VA 锁脸图
  const lockBad = [];
  for (const seg of segs) {
    if (seg?.h3Mode !== 'Ref2VA') continue;
    const id = seg?.lockSheet;
    if (!id) lockBad.push(`${seg.id} 是 Ref2VA 但没给 lockSheet`);
    else if (!assets[id]) lockBad.push(`${seg.id} 的 lockSheet「${id}」不在 assets 里`);
    else if (assets[id]?.kind !== 'character') lockBad.push(`${seg.id} 的 lockSheet「${id}」不是 character`);
  }
  add('ref2va-lock', 'Ref2VA 挂锁脸图', lockBad.length === 0, lockBad.join('；'));

  // 6/7/8/9/10 Qwen 插槽
  const canvasBad = [];
  const coverBad = [];
  const slotBad = [];
  const cleanBad = [];
  const tailBad = [];
  for (const seg of segs) {
    const ref = byId.get(seg.id);
    (seg.cuts ?? []).forEach((cut, ci) => {
      const q = cut?.qwen ?? {};
      const cid = `${seg.id}#${ci + 1}`;
      const canvasId = q.canvas;
      if (!canvasId) canvasBad.push(`${cid} 缺 qwen.canvas`);
      else if (!assets[canvasId]) canvasBad.push(`${cid} 的 canvas「${canvasId}」不在 assets 里`);
      else if (assets[canvasId].kind !== 'scene') canvasBad.push(`${cid} 的 canvas「${canvasId}」不是 scene`);

      const sbCut = ref?.cuts?.[ci] ?? {};
      const need = [...(sbCut.characters ?? []), ...(sbCut.props ?? [])];
      const refs = Array.isArray(q.refs) ? q.refs : [];
      const missing = need.filter((id) => !refs.includes(id));
      if (missing.length) coverBad.push(`${cid} 画内 ${missing.join(',')} 没挂参考图`);
      for (const id of refs) if (!assets[id]) coverBad.push(`${cid} 的 refs「${id}」不在 assets 里`);
      if (refs.length > p.maxQwenRefs) {
        coverBad.push(`${cid} 挂了 ${refs.length} 张参考图，超过 ${p.maxQwenRefs} 张——再多就开始互相污染`);
      }

      const prompt = str(q.prompt);
      const n = 1 + refs.length;
      if (refs.length === 0) {
        if (/<image\d+>/i.test(prompt)) slotBad.push(`${cid} 单图编辑却写了 <imageN> 标签`);
      } else {
        for (let k = 1; k <= n; k++) {
          if (!prompt.includes(`<image${k}>`)) slotBad.push(`${cid} 缺 <image${k}>（共 ${n} 张图）`);
        }
        if (/<image(\d+)>/i.test(prompt)) {
          const over = [...prompt.matchAll(/<image(\d+)>/gi)].map((m) => Number(m[1])).filter((k) => k > n);
          if (over.length) slotBad.push(`${cid} 出现 <image${over[0]}> 但只挂了 ${n} 张图`);
        }
      }

      // 末尾那句 no-text 是标准收尾，不算否定句——先摘掉再查负面词
      const body = prompt.split(TEXTLESS).join('');
      if (ASPECT.test(body)) cleanBad.push(`${cid} 提示词里写了画幅比例——交给 image_1 决定`);
      if (PIXELS.test(body)) cleanBad.push(`${cid} 提示词里写了像素尺寸`);
      if (FILE.test(body)) cleanBad.push(`${cid} 提示词里写了文件名`);
      if (WEIGHT.test(body)) cleanBad.push(`${cid} 提示词里有权重语法`);
      if (NEGATIVE.test(body)) cleanBad.push(`${cid} 提示词里有否定句——改写成正向可见事实`);
      if (CN_REF.test(body)) cleanBad.push(`${cid} 提示词里用「图1/第一张图」指代——必须用 <imageN>`);
      if (!prompt.includes(TEXTLESS)) tailBad.push(`${cid} 提示词末尾缺「${TEXTLESS}」`);
    });
  }
  add('qwen-canvas', 'Qwen 画布取自场景', canvasBad.length === 0, canvasBad.join('；'));
  add('qwen-coverage', '画内人物道具都挂了图', coverBad.length === 0, coverBad.join('；'));
  add('qwen-slots', 'imageN 标签与插槽对得上', slotBad.length === 0, slotBad.join('；'));
  add('qwen-clean', 'Qwen 提示词不越权', cleanBad.length === 0, cleanBad.join('；'));
  add('qwen-tail', '分镜图收尾成干净单帧', tailBad.length === 0, tailBad.join('；'));

  // 11 开局甩镜
  const whipBad = [];
  for (const seg of segs) {
    if (seg?.h3Mode === 'T2VA' || seg?.h3Mode === 'Ref2VA') continue;
    const ref = byId.get(seg.id);
    const first = shotSlices(descText(ref?.h3Prompt, seg?.h3Mode))[0];
    if (first && WHIP.test(first.text)) whipBad.push(`${seg.id} 首镜写了甩镜——移交后期`);
  }
  add('whip-pan', 'I2VA 开局不甩镜', whipBad.length === 0, whipBad.join('；'));

  // 12 尾帧接力
  const tailBad2 = [];
  segs.forEach((seg) => {
    if (!seg?.tailFrom) return;
    const producer = segs.find((s) => s.id === seg.tailFrom);
    if (!producer) {
      tailBad2.push(`${seg.id} 的 tailFrom「${seg.tailFrom}」不存在`);
      return;
    }
    const prodRef = byId.get(producer.id);
    const last = shotSlices(descText(prodRef?.h3Prompt, producer.h3Mode)).pop();
    const lastSec = Number((producer.cuts ?? []).at(-1)?.seconds) || 0;
    if (!last || !TAIL_SETTLE.test(last.text)) {
      tailBad2.push(`${producer.id} 末镜没写稳焦静止——抽出来的尾帧必糊`);
    }
    if (lastSec < 1) tailBad2.push(`${producer.id} 末镜只有 ${lastSec}s，留不出 0.5~1s 静止`);
    const pf = snapped(producer, p.fps).frames;
    const df = Number(seg.dedupeFrames) || 0;
    if (df < 0 || df >= pf) tailBad2.push(`${seg.id} 的 dedupeFrames=${df} 不在 0~${pf} 之间`);
  });
  add('tail-anchor', '尾帧接力链可抽帧', tailBad2.length === 0, tailBad2.join('；'));

  // 13/14/15 声音
  const lipBad = [];
  const sndBad = [];
  const musBad = [];
  for (const seg of segs) {
    const ref = byId.get(seg.id);
    const h3 = str(ref?.h3Prompt);
    if (/(off-screen voiceover|off-screen voice|画外音)/i.test(h3) && !/lips?[^\n]{0,60}(closed|still|motionless)|唇[^\n]{0,20}(闭合|僵)/i.test(h3)) {
      lipBad.push(`${seg.id} 有画外音却没锁画内唇形`);
    }
    const snd = fieldText(h3, 'overall_soundscape:');
    if (VOCAL.test(snd)) sndBad.push(`${seg.id} 的 overall_soundscape 出现人声词：${(snd.match(VOCAL) ?? [])[0]}`);
    const mus = fieldText(h3, 'non_diegetic_music:');
    if (mus && !/^(N\/A|无)$/.test(mus.trim()) && !INSTRUMENT.test(mus)) {
      musBad.push(`${seg.id} 的 non_diegetic_music 没写乐器编制`);
    }
  }
  add('offscreen-lips', '画外音锁住画内唇形', lipBad.length === 0, lipBad.join('；'));
  add('soundscape-vocals', '声景不写人声', sndBad.length === 0, sndBad.join('；'));
  add('music-spec', '配乐写编制与速度', musBad.length === 0, musBad.join('；'));

  // 16 台词装得下
  const fitBad = [];
  segs.forEach((seg) => {
    const ref = byId.get(seg.id);
    const slices = shotSlices(descText(ref?.h3Prompt, seg.h3Mode));
    slices.forEach((sl) => {
      const cut = (seg.cuts ?? [])[sl.k - 1];
      if (!cut) return;
      const need = dialogueChars(sl.text);
      if (need === 0) return;
      const sec = Number(cut.seconds) || 0;
      const speak = r2(need / p.charsPerSecond);
      if (speak > sec + 0.1) {
        fitBad.push(`${seg.id}#${sl.k} ${need} 字要 ${speak}s，只有 ${sec}s`);
      }
    });
  });
  add('speech-fit', `台词装得下（${p.charsPerSecond} 字/秒）`, fitBad.length === 0, fitBad.join('；'));

  // 18~21 段间接续：状态 / 人物 / 视线 / 声音
  // 每段只写自己那 5~15 秒，段与段之间就没人交代交接——人物瞬移、视线错位、底噪断档都出在这。
  const stateBad = [];
  const castBad = [];
  const eyeBad = [];
  const sndLinkBad = [];
  let nameCount = 0;
  for (const id of assetIds) if (str(assets[id]?.name).trim()) nameCount += 1;

  segs.forEach((seg, i) => {
    const prev = i > 0 ? segs[i - 1] : null;
    const ref = byId.get(seg.id);
    const prevRef = prev ? byId.get(prev.id) : null;
    const enter = str(seg.enter).trim();

    if (!enter) stateBad.push(`${seg.id} 缺 enter——这段从上一段继承了什么状态，没人写`);
    if (!str(seg.exit).trim()) stateBad.push(`${seg.id} 缺 exit——这段把世界留在什么状态，没人写`);

    const keep = seg?.sound?.keep;
    if (!Array.isArray(keep) || keep.length === 0) {
      sndLinkBad.push(`${seg.id} 缺 sound.keep（这段留给下一段的声源）`);
    }
    if (!prev) return;

    // 本段首镜有、上段末镜没有的人，必须在 enter 里写明从哪来
    if (nameCount > 0) {
      const cur = ref?.cuts?.[0]?.characters ?? [];
      const before = prevRef?.cuts?.at(-1)?.characters ?? [];
      const missing = cur
        .filter((c) => !before.includes(c))
        .filter((c) => {
          const name = str(assets[c]?.name).trim();
          return !name || !enter.includes(name);
        });
      if (missing.length) castBad.push(`${seg.id} 新入画的 ${missing.join(',')} 没在 enter 里写明从哪来`);
    }

    // 上段末镜看什么，本段 enter 要交代视线怎么转过去
    const curEye = str(ref?.cuts?.[0]?.eyeline).trim();
    const prevEye = str(prevRef?.cuts?.at(-1)?.eyeline).trim();
    if (curEye && prevEye && curEye !== prevEye && !enter.includes(prevEye)) {
      eyeBad.push(`${seg.id} 上段末镜视线在「${prevEye}」，enter 里没交代视线怎么转的`);
    }

    // 本段继承的底噪必须与上段留声有交集，否则就是换了个录音棚
    const carry = seg?.sound?.carry;
    const prevKeep = prev?.sound?.keep;
    if (!Array.isArray(carry) || carry.length === 0) {
      sndLinkBad.push(`${seg.id} 缺 sound.carry（从上一段继承的底噪）`);
    } else if (!Array.isArray(prevKeep) || !carry.some((x) => prevKeep.includes(x))) {
      sndLinkBad.push(`${seg.id} 的 sound.carry 与上段 sound.keep 没有共用声源——底噪会断档`);
    }
  });

  add('handoff-state', '段落接续：enter / exit 必填', stateBad.length === 0, stateBad.join('；'));
  if (nameCount === 0) {
    gates.push({ id: 'handoff-cast', label: '段落接续：新入画人物交代来源', ok: true, detail: 'assets 没写 name，跳过', skipped: true });
  } else {
    add('handoff-cast', '段落接续：新入画人物交代来源', castBad.length === 0, castBad.join('；'));
  }
  add('handoff-eyeline', '段落接续：视线跨段承接', eyeBad.length === 0, eyeBad.join('；'));
  add('handoff-sound', '段落接续：底噪不断档', sndLinkBad.length === 0, sndLinkBad.join('；'));

  return gates;
}

export function gateStats(gates) {
  const errors = gates.filter((g) => !g.ok && g.level !== 'warn');
  const warns = gates.filter((g) => !g.ok && g.level === 'warn');
  return { errors, warns, passed: gates.filter((g) => g.ok).length };
}

/* ------------------------------------------------------------------ */
/* seed                                                                 */
/* ------------------------------------------------------------------ */

// 阶段二：从 art.json / cast.json 起资产骨架。上游的 image.prompt 是英文短提示词，
// 不能直接喂 MOSS——母稿是重新组织的中文长段落，这里只留齿位，内容由人写。
export function assetSkeleton(outline) {
  const assets = {};
  for (const sc of outline?.scenes ?? []) {
    assets[sc.id] = {
      kind: 'scene',
      name: sc.name ?? '',
      sheet: `images/${sc.name}-sheet.png`,
      tier: sc.primary ? 'fine' : 'standard',
      layout: 'sheet',
      brief: sceneBrief(sc),
    };
  }
  for (const pr of outline?.props ?? []) {
    assets[pr.id] = {
      kind: 'prop',
      name: pr.name ?? '',
      sheet: `images/${pr.name}-sheet.png`,
      tier: 'standard',
      layout: 'sheet',
      brief: propBrief(pr),
    };
  }
  for (const c of outline?.characters ?? []) {
    assets[c.id] = {
      kind: 'character',
      name: c.name ?? '',
      sheet: `images/${c.name}-sheet.png`,
      tier: c.tier === 'lead' || c.importance === 'protagonist' ? 'fine' : 'standard',
      layout: 'sheet',
      brief: charBrief(c),
    };
  }
  return { source: outline?.source ?? '', assets };
}

// 资产提示词不在这里写；中文长提示词交给 fisher-moss-prompt-expander。
// 这里只把「素材 + 版式 + 篇幅」整理成一张可以直接递给 expander 的单子。
const SHEET_LAYOUT = {
  character: '16:9 三区：左侧约 34% 为一格半身像（正面平视，中性浅灰渐变底，作为全片面部基准）；右上为全身三视图（正面／左侧 90°／背面，同一身高基准线、等间距）；右下为细节条 3~4 格（面部特写、惯用手与手上道具、服装磨损、鞋）。三区之间细直线分隔，不加边框装饰，不写任何文字标注。',
  scene: '16:9：左侧约三分之二为一格主视角全景，机位与后续分镜的 image_1 同角度、同焦段；右侧三分之一上下两格——上格关键局部特写（门扇五金／地表积水／主光源位置），下格同一机位的另一光照状态变体。全图绝对无人物、无手，不写任何文字标注。',
  prop: '16:9 纯白底：左为正面正交主视图，约占宽 40%；中为侧面 90° 与 45° 俯视各一格，等比例；右为细节放大 1~2 格（磨损处、刻字或铭牌、锁扣结构）。极淡接触阴影、无方向投影，不写任何文字标注。',
};

export const TIER_HINT = { fine: '1500~2500 字', standard: '350~600 字' };

const joinBits = (...xs) => xs.map((x) => str(x).trim()).filter(Boolean).join('；');

// outline.json 里每件资产都带 id/name/role 或 function。锚点、光照这类细节不再由上游给，
// 留给 expander 按「合理创作决定」补——所以 brief 只传已知事实，不编。
const sceneBrief = (sc) => joinBits(sc?.name, sc?.primary ? '主场景' : '', sc?.reusePlan, sc?.summary);
const propBrief = (pr) => joinBits(pr?.name, pr?.function, pr?.summary);
const charBrief = (c) => joinBits(c?.name, c?.role, c?.arc, c?.oneLiner);

export function renderAssetSheet(doc) {
  const assets = doc?.assets ?? {};
  const ids = Object.keys(assets);
  const L = ['# 资产生图单（交给 fisher-moss-prompt-expander）', ''];
  L.push('上游 art.json / cast.json 的 image.prompt 是英文短提示词，不要翻译。把下面每节的「素材 + 版式 + 篇幅」交给 expander，把它输出的中文长提示词贴回该节，再整段复制进 MOSS。');
  L.push('');
  if (!ids.length) {
    L.push('没有资产。先生成 assets 骨架。');
    return L.join('\n');
  }
  for (const id of ids) {
    const a = assets[id] ?? {};
    const tier = a.tier ?? 'standard';
    L.push(`## ${id} · ${a.kind ?? '?'}${a.name ? ` · ${a.name}` : ''}`);
    L.push('');
    if (a.sheet) L.push(`- 设定板文件：${a.sheet}`);
    L.push(`- 篇幅：${tier}（${TIER_HINT[tier] ?? TIER_HINT.standard}）`);
    if ((a.layout ?? 'sheet') === 'sheet') {
      L.push(`- 版式：${SHEET_LAYOUT[a.kind] ?? '16:9 单格'}`);
      L.push('- 指令：使用 $fisher-moss-prompt-expander 按上述版式扩写；只输出一个 text 代码块。');
    } else {
      L.push('- 版式：单图，不要分格不要分隔线。');
      L.push('- 指令：使用 $fisher-moss-prompt-expander 扩写单张画面；只输出一个 text 代码块。');
    }
    if (a.brief) L.push(`- 素材：${a.brief}`);
    L.push('');
    L.push('提示词：');
    L.push('');
    L.push('```text');
    L.push(str(a.prompt).trim() || '（在这里贴 expander 的输出，贴完写回 assets.\`prompt\` 就不会被重新导出冲掉）');
    L.push('```');
    L.push('');
  }
  return L.join('\n');
}
export function seed(storyboard, ep, { outline = null, assets = null } = {}) {
  const epData = (storyboard?.episodes ?? []).find((e) => Number(e?.ep) === Number(ep));
  if (!epData) throw new Error(`storyboard 里没有第 ${ep} 集`);
  // 阶段二做过资产单就直接吃那份，别再从 outline 重建——重建会抹掉贴回来的提示词
  const assetMap = assets?.assets ?? (assets && typeof assets === 'object' ? assets : assetSkeleton(outline).assets);
  // 画布取资产里登记的顺序：第 n 场的 image_1 就是第 n 个 scene
  const sceneIds = Object.entries(assetMap)
    .filter(([, a]) => a?.kind === 'scene')
    .map(([id]) => id);
  return {
    source: storyboard?.source ?? '',
    ep: Number(ep),
    fps: DEFAULT_FPS,
    aspectRatio: storyboard?.aspectRatio ?? '16:9',
    params: { charsPerSecond: 4, frameTolerance: 2, maxQwenRefs: 5 },
    assets: assetMap,
    segments: (epData.segments ?? []).map((seg) => ({
      id: seg.id,
      h3Mode: 'I2VA',
      lockSheet: null,
      tailFrom: null,
      dedupeFrames: 0,
      jCut: 0,
      postNote: '',
      enter: '',
      exit: '',
      sound: { carry: [], keep: [] },
      cuts: (seg.cuts ?? []).map((cut) => ({
        qwen: {
          canvas: sceneIds[seg.sceneIndex - 1] ?? '',
          refs: [...(cut.characters ?? []), ...(cut.props ?? [])],
          prompt: '',
        },
      })),
    })),
  };
}

/* ------------------------------------------------------------------ */
/* 导出：投产卡 / 资产母稿 / 后期总装                                     */
/* ------------------------------------------------------------------ */

const mdRow = (cells) => `| ${cells.map((c) => str(c).replace(/\|/g, '\\|')).join(' | ')} |`;

function modePictures(seg) {
  switch (seg?.h3Mode) {
    case 'T2VA':
      return [];
    case 'Ref2VA':
      return ['f1.png', seg?.lockSheet ? `${seg.lockSheet}.png` : '（缺锁脸图）'];
    case 'FL2VA':
      return ['f1.png', 'f-last.png'];
    default:
      return (seg?.cuts ?? []).length > 1
        ? (seg.cuts ?? []).map((_, i) => `f${i + 1}.png`)
        : ['f1.png'];
  }
}

export function renderSegmentCard(prod, sb, seg) {
  const p = paramsOf(prod);
  const ref = (sb?.episodes ?? [])
    .find((e) => Number(e?.ep) === Number(prod?.ep))
    ?.segments?.find((s) => s.id === seg.id);
  const timed = timedSegments(prod, sb).find((s) => s.id === seg.id) ?? seg;
  const s = snapped(timed, p.fps);
  const pics = modePictures(seg);
  const L = [];
  L.push(`# ${seg.id}｜${seg.h3Mode}｜${s.seconds}s / ${s.frames} frames @ ${p.fps}fps｜${prod?.aspectRatio ?? sb?.aspectRatio ?? '16:9'}`);
  L.push('');
  if (seg.tailFrom) {
    L.push(`- 首帧来源：抽 \`${seg.tailFrom}\` 末帧，裁掉头部重复 ${Number(seg.dedupeFrames) || 0} 帧`);
  }
  if (seg.postNote) L.push(`- 后期衔接：${seg.postNote}`);
  if (Number(seg.jCut) > 0) L.push(`- 声音提前：下段撞击声 J-Cut 提前 ${seg.jCut}s`);
  L.push('');
  L.push('## 1. 关键帧（Qwen-Image-2.1 · TextEncodeQwenImage21）');
  L.push('');
  (seg.cuts ?? []).forEach((cut, ci) => {
    const q = cut?.qwen ?? {};
    const refs = Array.isArray(q.refs) ? q.refs : [];
    const canvas = prod?.assets?.[q.canvas];
    L.push(`### f${ci + 1}.png — cut ${ci + 1}${ref?.cuts?.[ci]?.size ? ` · ${ref.cuts[ci].size}` : ''}`);
    L.push('');
    L.push(`- \`image_1\`：\`${q.canvas}\`（${canvas?.sheet ?? '场景画布'}）`);
    refs.forEach((id, k) => L.push(`- \`image_${k + 2}\`：\`${id}\`（${prod?.assets?.[id]?.sheet ?? '参考图'}）`));
    L.push('');
    L.push('```text');
    L.push(str(q.prompt).trim() || '（未写提示词）');
    L.push('```');
    L.push('');
  });
  L.push(`## 2. MiniMax H3（${seg.h3Mode}）`);
  L.push('');
  if (pics.length) {
    L.push(mdRow(['槽位', '文件', '来源']));
    L.push(mdRow(['---', '---', '---']));
    pics.forEach((f, i) => L.push(mdRow([`Picture ${i + 1}`, f, i === 0 ? '首帧 f1' : seg.h3Mode === 'Ref2VA' ? '锁脸定妆图' : '后续分镜图'])));
    L.push('');
  } else {
    L.push('- 纯文本模式，不接图。');
    L.push('');
  }
  L.push('```text');
  L.push(str(ref?.h3Prompt).trim());
  L.push('```');
  L.push('');
  return L.join('\n');
}

export function renderAssets(prod) {
  const head = '# 资产生图单（交给 fisher-moss-prompt-expander）';
  const want = `# 第 ${prod?.ep} 集 · 资产生图单（交给 fisher-moss-prompt-expander）`;
  return renderAssetSheet(prod).replace(head, want);
}
export function renderPost(prod, sb) {
  const p = paramsOf(prod);
  const L = [`# 第 ${prod?.ep} 集 · 后期总装`, ''];
  L.push(mdRow(['段', '帧数', '时长', '头部去重', '有效起点', '有效终点', '首帧来源', '衔接备注']));
  L.push(mdRow(['---', '---', '---', '---', '---', '---', '---', '---']));
  const rows = [];
  for (const seg of timedSegments(prod, sb)) {
    const s = snapped(seg, p.fps);
    const df = Math.max(0, Math.min(Number(seg.dedupeFrames) || 0, s.frames - 1));
    const start = r2(df / p.fps);
    const end = r2(s.frames / p.fps);
    rows.push({ id: seg.id, frames: s.frames, start, end });
    L.push(
      mdRow([
        seg.id,
        `${s.frames}f`,
        `${end}s`,
        `${df}f`,
        `${start}s`,
        `${end}s`,
        seg.tailFrom ? `${seg.tailFrom} 末帧` : '直出',
        seg.postNote || (Number(seg.jCut) > 0 ? `J-Cut -${seg.jCut}s` : '—'),
      ]),
    );
  }
  L.push('');
  L.push('## ffmpeg 总装');
  L.push('');
  L.push('```bash');
  L.push('# 1) 逐段裁掉头部重复帧（-ss 在 -i 前面是快速定位，近似到关键帧；要帧精确就放后面）');
  for (const r of rows) {
    const dur = r2(r.end - r.start);
    const seek = r.start > 0 ? `-ss ${r.start} ` : '';
    L.push(`ffmpeg -y ${seek}-t ${dur} -i ${r.id}.mp4 -c copy -avoid_negative_ts make_zero clip-${r.id}.mp4`);
  }
  L.push('');
  L.push('# 2) 拼接（清单一行一个 file）');
  L.push("cat > concat.txt <<'EOF'");
  for (const r of rows) L.push(`file 'clip-${r.id}.mp4'`);
  L.push('EOF');
  L.push(`ffmpeg -y -f concat -safe 0 -i concat.txt -c copy joined-E${String(prod?.ep).padStart(2, '0')}.mp4`);
  L.push('');
  L.push('# 3) 响度归一 -14 LUFS（画面直接复制，不动）');
  L.push(
    `ffmpeg -y -i joined-E${String(prod?.ep).padStart(2, '0')}.mp4 -af loudnorm=I=-14:TP=-1.5:LRA=11 -c:v copy master-E${String(prod?.ep).padStart(2, '0')}.mp4`,
  );
  L.push('```');
  L.push('');
  L.push('> Room Tone 通轨：剪辑时把全片环境底噪统一成一条，各段断点处不静音；这一步在剪辑软件里做，脚本不动。');
  return L.join('\n');
}

/* ------------------------------------------------------------------ */
/* CLI                                                                  */
/* ------------------------------------------------------------------ */

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function flag(args, name, fallback = null) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

function usage() {
  console.log(`用法：
  node comfy-production.mjs assets <outline.json> [--md] > production-assets.json
  node comfy-production.mjs seed <storyboard.json> --ep 1 [--assets production-assets.json] [--outline outline.json] > production.json
  node comfy-production.mjs validate <production.json> --storyboard <storyboard.json>
  node comfy-production.mjs export <production.json> --storyboard <storyboard.json> --out <dir>
  node comfy-production.mjs post <production.json> --storyboard <storyboard.json> [--out <dir>]`);
}

function main(argv) {
  const [cmd, ...rest] = argv;
  const file = rest[0];
  if (!cmd || !file || cmd === '-h' || cmd === '--help') return usage();

  // 阶段二：资产骨架与资产生图单，不需要 storyboard
  if (cmd === 'assets') {
    const outline = readJson(file);
    const doc = assetSkeleton(outline);
    console.log(rest.includes('--md') ? renderAssetSheet(doc) : JSON.stringify(doc, null, 2));
    return;
  }
  if (cmd === 'seed') {
    const sb = readJson(file);
    const outlinePath = flag(rest, '--outline');
    const assetsPath = flag(rest, '--assets');
    const outline = outlinePath ? readJson(outlinePath) : null;
    const assets = assetsPath ? readJson(assetsPath) : null;
    const ep = flag(rest, '--ep', 1);
    console.log(JSON.stringify(seed(sb, ep, { outline, assets }), null, 2));
    return;
  }
  const sbPath = flag(rest, '--storyboard');
  if (!sbPath) throw new Error(`${cmd} 必须给 --storyboard——结构真理源在那边，不给就没法对账`);
  const prod = readJson(file);
  const sb = readJson(sbPath);

  if (cmd === 'validate') {
    const gates = gateReport(prod, sb);
    for (const g of gates) {
      const mark = g.ok ? '✓' : g.level === 'warn' ? '!' : '✗';
      console.log(`${mark} ${g.id.padEnd(18)} ${g.label}${g.detail ? ` — ${g.detail}` : ''}`);
    }
    const st = gateStats(gates);
    console.log(`\n${st.passed}/${gates.length} 通过，${st.errors.length} 违规，${st.warns.length} 警告`);
    if (st.errors.length) process.exitCode = 1;
    return;
  }

  if (cmd === 'export') {
    const out = flag(rest, '--out', '.');
    mkdirSync(out, { recursive: true });
    for (const seg of prod.segments ?? []) {
      const dir = join(out, seg.id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'index.md'), renderSegmentCard(prod, sb, seg), 'utf8');
    }
    writeFileSync(join(out, `E${String(prod.ep).padStart(2, '0')}-assets.md`), renderAssets(prod), 'utf8');
    writeFileSync(join(out, `E${String(prod.ep).padStart(2, '0')}-post.md`), renderPost(prod, sb), 'utf8');
    console.log(`已导出到 ${out}：${(prod.segments ?? []).length} 段 + assets + post`);
    return;
  }

  if (cmd === 'post') {
    const md = renderPost(prod, sb);
    const out = flag(rest, '--out');
    if (out) {
      mkdirSync(out, { recursive: true });
      const path = join(out, `E${String(prod.ep).padStart(2, '0')}-post.md`);
      writeFileSync(path, md, 'utf8');
      console.log(`已写入 ${path}`);
    } else {
      console.log(md);
    }
    return;
  }

  usage();
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('comfy-production.mjs');
if (isMain) main(process.argv.slice(2));
