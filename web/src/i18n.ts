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
  cardButton: 'SD card…',
  cardTitle: 'SD card',
  cardIntro: 'Move kits, patterns and projects between the emulator and your LXR-02. Always use the top level of the card: the folder that holds GLO.CFG and the PROJ00, PROJ01… folders.',
  exportTitle: 'Copy to a real card',
  exportFolder: 'Export to folder…',
  exportFolderHint: 'Pick the SD card (or any folder) in the dialog. Files with the same name are replaced; other files on the card stay.',
  exportZip: 'Download .zip',
  exportZipHint: 'Unzip it onto the top level of the card.',
  importTitle: 'Load a real card',
  importFolder: 'Import from folder…',
  importZip: 'Import .zip…',
  importHint: 'Replaces everything on the virtual card; the emulator then restarts from the imported card.',
  close: 'Close',
  cardReading: 'Reading the virtual card…',
  cardWriting: 'Writing {done} of {total}…',
  cardExported: 'Done: {n} files and folders written.',
  cardZipped: 'Done: {name} ({kb} KB).',
  cardImported: 'Imported {n} files.',
  cardImportedSkipped: 'Imported {n} files. Not written ({k}): {list}',
  cardFailed: 'Failed: {msg}',
  cardConfirmImport: 'Replace the whole virtual SD card with these {n} files? The emulator restarts.',
  cardNotLxr: 'There is no GLO.CFG and no PROJ folder at the top of this card, so it may not be an LXR card, or you picked a folder inside it. Import anyway?',
  cardEmpty: 'No files found.',
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
  cardButton: 'SD 卡…',
  cardTitle: 'SD 卡',
  cardIntro: '在模拟器和你的 LXR-02 之间搬运 kit、pattern 和工程。始终用 SD 卡的最顶层，也就是放着 GLO.CFG 和 PROJ00、PROJ01… 文件夹的那一层。',
  exportTitle: '存到真机的卡',
  exportFolder: '导出到文件夹…',
  exportFolderHint: '在弹出的窗口里选中 SD 卡（或任意文件夹）。同名文件会被覆盖，卡上其他文件保留。',
  exportZip: '下载 .zip',
  exportZipHint: '解压到 SD 卡的最顶层。',
  importTitle: '读入真机的卡',
  importFolder: '从文件夹导入…',
  importZip: '导入 .zip…',
  importHint: '会替换虚拟卡上的全部内容，模拟器随后从导入的卡重新开机。',
  close: '关闭',
  cardReading: '正在读取虚拟卡…',
  cardWriting: '正在写入 {done} / {total}…',
  cardExported: '完成：写入了 {n} 个文件和文件夹。',
  cardZipped: '完成：{name}（{kb} KB）。',
  cardImported: '导入了 {n} 个文件。',
  cardImportedSkipped: '导入了 {n} 个文件。没能写入（{k} 个）：{list}',
  cardFailed: '失败：{msg}',
  cardConfirmImport: '用这 {n} 个文件替换整张虚拟 SD 卡？模拟器会重新开机。',
  cardNotLxr: '这张卡的最顶层既没有 GLO.CFG，也没有 PROJ 文件夹，可能不是 LXR 的卡，或者选到了卡里面的某个文件夹。仍然导入吗？',
  cardEmpty: '没有找到文件。',
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
