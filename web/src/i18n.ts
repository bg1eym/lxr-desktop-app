/*
 * LXR-02 Emu (unofficial) - page language: English, or Chinese when the
 * browser asks for it first. A choice made with the language button is kept.
 *
 * Copyright (C) 2026 LXR-02 Emu contributors
 * SPDX-License-Identifier: GPL-3.0-only
 */

export type Lang = 'en' | 'zh';

const en = {
  langButton: '中文',
  langButtonLabel: 'Switch to Chinese',
  power: 'Power on',
  reboot: 'Reboot',
  erase: 'Erase SD card',
  intro: 'The LXR-02 firmware 1.7, running in your browser. Click Power on to start the audio.',
  statusOff: 'Off',
  statusStarting: 'Starting…',
  statusRunning: 'Running · {rate} Hz · booted in {ms} ms',
  statusError: 'Error: {msg}',
  cardSaved: 'SD card {mb} MB · saved in this browser',
  cardNotKept: 'SD card is not kept (this browser blocks local storage)',
  eraseConfirm: 'Erase the virtual SD card? All projects, kits and patterns on it are deleted and the firmware formats a new, empty card.',
  helpTitle: 'How to play it',
  helpKnobs: 'Pots 1–4 and the DATA encoder: drag up or down, or use the mouse wheel. The cap in the middle of DATA is its push button.',
  helpButtons: 'Buttons are pressed while you hold them. Click SHIFT to latch it, click it again to release.',
  helpCard: 'The SD card is kept in your browser, so reloading the page or Reboot keeps it. Like the device, the firmware saves the current kit and pattern to the card about 2 seconds after your last change; to keep them for good, SAVE them to a project.',
  helpKeys: 'Keyboard: Space = START/STOP, Shift = SHIFT, ←/→ = DATA, Enter = push DATA, PageUp/PageDown = page buttons, 1–7 = voices, Q–I and A–K = steps 1–16, Z/X/C/V = mode buttons.',
  footer: 'Unofficial emulator for the Erica Synths LXR-02 firmware, not affiliated with or approved by Erica Synths. It runs a modified version of the open-source LXR-02 firmware 1.7 (GPL-3.0); the sound is generated live by the firmware code.',
  source: 'Source (GPL-3.0)',
  shiftHint: 'Shift (hold), or click to latch',
  encoderPush: 'Push the encoder — Enter',
};

const zh: typeof en = {
  langButton: 'English',
  langButtonLabel: '切换到英文',
  power: '开机',
  reboot: '重启',
  erase: '清空 SD 卡',
  intro: '浏览器里运行的 LXR-02 1.7 固件。点“开机”启动音频。',
  statusOff: '未启动',
  statusStarting: '启动中…',
  statusRunning: '运行中 · {rate} Hz · 开机 {ms} ms',
  statusError: '出错：{msg}',
  cardSaved: 'SD 卡 {mb} MB · 已存到浏览器',
  cardNotKept: 'SD 卡不会保存（浏览器禁止了本地存储）',
  eraseConfirm: '清空虚拟 SD 卡？卡上所有工程、kit 和 pattern 都会删除，固件会重新格式化一张空卡。',
  helpTitle: '操作',
  helpKnobs: '旋钮 1–4、DATA 编码器：上下拖动或滚轮；DATA 中间的圆钮是按压。',
  helpButtons: '按键：按住即按下，松开即抬起。SHIFT 可以点击锁定，再点一次松开。',
  helpCard: 'SD 卡保存在浏览器里，刷新页面或“重启”都不会丢。固件会在你停手约 2 秒后把当前 kit 和 pattern 自动存到卡上（和真机一样）；要长期保存，用 SAVE 存进工程。',
  helpKeys: '键盘：Space = START/STOP，Shift = SHIFT，←/→ = DATA，Enter = 按 DATA，PageUp/PageDown = 翻页，1–7 = 声部，Q–I / A–K = 步 1–16，Z/X/C/V = 模式键。',
  footer: '非官方项目，与 Erica Synths 无关，也未经其认可。运行的是 Erica Synths LXR-02 开源固件 1.7 的修改版（GPL-3.0），声音由固件代码实时生成。',
  source: '源代码（GPL-3.0）',
  shiftHint: 'Shift（按住），或点击锁定',
  encoderPush: '按下编码器 — Enter',
};

export type Key = keyof typeof en;
const STRINGS: Record<Lang, typeof en> = { en, zh };
const STORE_KEY = 'lxr02-emu-lang';

function detect(): Lang {
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved === 'en' || saved === 'zh') return saved;
  } catch { /* storage blocked: fall back to the browser language */ }
  const first = (navigator.languages?.[0] ?? navigator.language ?? 'en').toLowerCase();
  return first.startsWith('zh') ? 'zh' : 'en';
}

let lang: Lang = detect();
const renderers: (() => void)[] = [];

export function currentLang(): Lang {
  return lang;
}

/** The text for a key, with {name} placeholders filled in. */
export function t(key: Key, vars: Record<string, string | number> = {}): string {
  return STRINGS[lang][key].replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
}

/** Run now and again whenever the language changes. */
export function onLang(render: () => void): void {
  renderers.push(render);
  render();
}

/** Text of an element that follows the language. */
export function text<E extends HTMLElement>(el: E, key: Key): E {
  onLang(() => { el.textContent = t(key); });
  return el;
}

export function setLang(next: Lang): void {
  lang = next;
  try { localStorage.setItem(STORE_KEY, next); } catch { /* not kept, fine */ }
  document.documentElement.lang = next === 'zh' ? 'zh-CN' : 'en';
  for (const r of renderers) r();
}

document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
