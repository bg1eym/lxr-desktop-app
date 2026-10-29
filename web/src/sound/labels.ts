/*
 * LXR-02 Emu (unofficial) - readable names for the firmware's parameters.
 *
 * The firmware names them for a 16 character display ("Oscilltr" /
 * "PulsWdth"); the sound editor shows these instead, keyed by the
 * firmware's category and long name (valueNames, MenuText.h). Anything not
 * listed is shown with the firmware's own name.
 *
 * Copyright (C) 2026 LXR-02 Emu contributors
 * SPDX-License-Identifier: GPL-3.0-only
 */
import { currentLang } from '../i18n';

type Pair = [string, string];   // English, Chinese

const LABELS: Record<string, Pair> = {
  'Oscilltr/Coarse': ['Coarse tune', '粗调音高'],
  'Oscilltr/Fine': ['Fine tune', '微调音高'],
  'Oscilltr/Waveform': ['Waveform', '波形'],
  'Oscilltr/PulsWdth': ['Pulse width', '脉宽'],
  'Oscilltr/Mode': ['FM or mix', 'FM 或混合'],
  'Noise/Frequncy': ['Noise frequency', '噪声频率'],
  'Nois/Osc/Mix': ['Noise / osc mix', '噪声 / 振荡器比例'],
  'Veloc EG/Attack': ['Attack', '起音'],
  'Veloc EG/Decay': ['Decay', '衰减'],
  'Veloc EG/Slope': ['Slope', '曲线'],
  'Veloc EG/RepeatCt': ['Repeats', '重复次数'],
  'Veloc EG/Dcy Clsd': ['Decay (closed)', '衰减（闭镲）'],
  'Veloc EG/Dcy Open': ['Decay (open)', '衰减（开镲）'],
  'Mod EG/Decay': ['Pitch decay', '音高包络衰减'],
  'PitchMod/Amount': ['Pitch amount', '音高调制量'],
  'Velocity/DstParam': ['Velocity → target', '力度调制目标'],
  'Velocity/Amount': ['Velocity amount', '力度调制量'],
  'Velocity/Vol mod': ['Velocity → volume', '力度控制音量'],
  'FM/Amount': ['FM amount', 'FM 量'],
  'FM/Frequncy': ['Mod frequency', '调制频率'],
  'Mod Osc/Freqcy 1': ['Mod osc 1 frequency', '调制振荡器 1 频率'],
  'Mod Osc/Freqcy 2': ['Mod osc 2 frequency', '调制振荡器 2 频率'],
  'Mod Osc/Gain 1': ['Mod osc 1 level', '调制振荡器 1 电平'],
  'Mod Osc/Gain 2': ['Mod osc 2 level', '调制振荡器 2 电平'],
  'Transnt/Waveform': ['Transient', '瞬态波形'],
  'Transnt/Volume': ['Transient level', '瞬态音量'],
  'Transnt/Frequncy': ['Transient pitch', '瞬态音高'],
  'Filter/Frequncy': ['Cutoff', '截止频率'],
  'Filter/Resnance': ['Resonance', '共振'],
  'Filter/Type': ['Type', '类型'],
  'Filter/Overdriv': ['Drive', '过载'],
  'LFO/Frequncy': ['Rate', '速度'],
  'LFO/ClockSnc': ['Sync', '同步'],
  'LFO/Amount': ['Amount', '深度'],
  'LFO/Waveform': ['Waveform', '波形'],
  'LFO/Retriggr': ['Retrigger', '重新触发'],
  'LFO/Offset': ['Phase offset', '相位偏移'],
  'LFO/DstVoice': ['Target voice', '目标声部'],
  'LFO/DstParam': ['Target', '调制目标'],
  'Voice/Volume': ['Volume', '音量'],
  'Voice/Panning': ['Pan', '声像'],
  'Voice/SampleRt': ['Sample rate', '采样率'],
  'Voice/Overdriv': ['Drive', '过载'],
  'Voice/AudioOut': ['Output', '输出'],
};

/* The modulation target lists use the firmware's categories. */
const CATEGORIES: Record<string, Pair> = {
  Oscilltr: ['Osc', '振荡器'],
  'Veloc EG': ['Amp EG', '音量包络'],
  'Mod EG': ['Pitch EG', '音高包络'],
  PitchMod: ['Pitch mod', '音高调制'],
  Velocity: ['Velocity', '力度'],
  FM: ['FM', 'FM'],
  'Mod Osc': ['Mod osc', '调制振荡器'],
  Transnt: ['Transient', '瞬态'],
  Filter: ['Filter', '滤波器'],
  LFO: ['LFO', 'LFO'],
  Voice: ['Voice', '声部'],
  Noise: ['Noise', '噪声'],
  'Nois/Osc': ['Noise/osc', '噪声/振荡器'],
};

const pick = (p: Pair) => (currentLang() === 'zh' ? p[1] : p[0]);

export function paramLabel(category: string, name: string): string {
  const p = LABELS[`${category}/${name}`];
  return p ? pick(p) : `${category} ${name}`.trim();
}

/** "Filter · Cutoff", for the modulation target lists. */
export function targetLabel(category: string, name: string): string {
  const c = CATEGORIES[category];
  const cat = c ? pick(c) : category;
  return `${cat} · ${paramLabel(category, name)}`;
}
