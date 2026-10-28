/*
 * LXR-02 Emu (unofficial) - virtual front panel.
 *
 * Copyright (C) 2026 LXR-02 Emu contributors
 * SPDX-License-Identifier: GPL-3.0-only
 */
import './style.css';
import { LxrEmu, type PanelState } from './emu';
import { LcdView } from './lcd';
import { Encoder, Fader, PanelButton, Pot, type ButtonOpts } from './controls';

/* Button and LED numbers: enum ButtonNumbers (Core/Inc/buttonHandler.h) and
 * the LED enum (Core/Inc/ledHandler.h) share the shift register layout. */
const BTN = {
  PAGE_UP: 0,
  voice: (n: number) => n,                                  // 1..7
  select: (n: number) => (n <= 4 ? 15 + n : 3 + n),         // 1..8
  mode: (n: number) => 23 + n,                              // 1..4
  step: (n: number) => (n <= 4 ? 40 - n : n <= 8 ? 36 - n : n <= 12 ? 32 - n : 28 - n), // 1..16
  SHIFT: 32,
  START: 33,
  REC: 34,
  COPY: 35,
  PAGE_DOWN: 40,
};

const emu = new LxrEmu();
const buttons = new Map<number, PanelButton>();

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  e.append(...kids);
  return e;
}

function button(n: number, opts: ButtonOpts): HTMLElement {
  const b = new PanelButton(opts, (down) => emu.button(n, down));
  buttons.set(n, b);
  return b.root;
}

/* ---- layout ------------------------------------------------------------- */
const lcd = new LcdView();

const pots = [1, 2, 3, 4].map((i) => new Pot(`${i}`, (deg) => emu.pot(i - 1, deg)));
const encoder = new Encoder((n) => emu.encoder(n), (d) => emu.encoderButton(d));
const faderNames = ['DRUM 1', 'DRUM 2', 'DRUM 3', 'SNARE', 'CYMBAL', 'HIHAT'];
const faders = faderNames.map((name, i) => new Fader(name, (v) => emu.fader(i, v)));

const voiceNames = ['DRUM 1', 'DRUM 2', 'DRUM 3', 'SNARE', 'CYMBAL', 'HH CLS', 'HH OPN'];
const selectNames = ['OSC', 'AEG', 'MOD', 'FM', 'TRANS', 'FILTER', 'LFO', 'MIX'];
const modeNames: [string, string][] = [['VOICE', 'STEP'], ['PERF', 'EUKLID'], ['LOAD', ''], ['SAVE', 'MENU']];
const stepKeys = ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'A', 'S', 'D', 'F', 'G', 'H', 'J', 'K'];

const screen = h('div', 'screen', h('div', 'lcd-bezel', lcd.canvas), h('div', 'pots', ...pots.map((p) => p.root)));
const encArea = h('div', 'enc-area',
  encoder.root,
  h('div', 'pages',
    button(BTN.PAGE_UP, { label: 'PAGE ▲', key: 'PageUp' }),
    button(BTN.PAGE_DOWN, { label: 'PAGE ▼', key: 'PageDown' })));
const faderBank = h('div', 'faders', ...faders.map((f) => f.root));

const voices = h('div', 'group voices',
  ...voiceNames.map((name, i) => button(BTN.voice(i + 1), { label: name, key: `${i + 1}` })));
const modes = h('div', 'group modes',
  ...modeNames.map(([a, b], i) => button(BTN.mode(i + 1), { label: a, sub: b || undefined, key: ['Z', 'X', 'C', 'V'][i] })));
const selects = h('div', 'group selects',
  ...selectNames.map((name, i) => button(BTN.select(i + 1), { label: `${i + 1}`, sub: name })));

const shiftBtn = new PanelButton({ label: 'SHIFT', latch: true, key: 'Shift (按住) / 点击锁定' }, (d) => emu.button(BTN.SHIFT, d));
buttons.set(BTN.SHIFT, shiftBtn);
const transport = h('div', 'group transport',
  shiftBtn.root,
  button(BTN.START, { label: 'START', sub: 'STOP', key: 'Space' }),
  button(BTN.REC, { label: 'REC' }),
  button(BTN.COPY, { label: 'COPY', sub: 'CLEAR' }));
const steps = h('div', 'steps');
for (let q = 0; q < 4; q++) {
  const quad = h('div', 'quad');
  for (let j = 1; j <= 4; j++) {
    const n = q * 4 + j;
    quad.append(button(BTN.step(n), { label: `${n}`, key: stepKeys[n - 1], cls: 'step' }));
  }
  steps.append(quad);
}

const startBtn = h('button', 'power', '开机');
startBtn.type = 'button';
const rebootBtn = h('button', 'tool', '重启');
rebootBtn.type = 'button';
rebootBtn.disabled = true;
const status = h('span', 'status', '未启动');
const load = h('span', 'status load', '');

const device = h('main', 'device',
  h('section', 'row top', screen, encArea, faderBank),
  h('section', 'row', voices, selects),
  h('section', 'row', modes, transport),
  h('section', 'row bottom', steps));

const overlay = h('div', 'overlay',
  h('div', 'overlay-card',
    h('h2', '', 'LXR-02 Emu'),
    h('p', '', '浏览器里运行的 LXR-02 1.7 固件。点“开机”启动音频。'),
    startBtn));

document.querySelector('#app')!.append(
  h('header', 'bar',
    h('div', 'brand', h('strong', '', 'LXR-02 Emu'), h('span', 'tag', 'unofficial')),
    h('div', 'tools', rebootBtn, status, load)),
  h('div', 'stage', device, overlay),
  h('section', 'help',
    h('h3', '', '操作'),
    h('ul', '',
      h('li', '', '旋钮 1–4、DATA 编码器：上下拖动或滚轮；DATA 中间的圆钮是按压。'),
      h('li', '', '按键：按住即按下，松开即抬起。SHIFT 可以点击锁定，再点一次松开。'),
      h('li', '', '键盘：Space = START/STOP，Shift = SHIFT，←/→ = DATA，Enter = 按 DATA，PageUp/PageDown = 翻页，1–7 = 声部，Q–I / A–K = 步 1–16，Z/X/C/V = 模式键。'))),
  h('footer', 'foot',
    '非官方项目，与 Erica Synths 无关。运行的是 LXR-02 1.7 官方开源固件（GPL-3.0），声音由固件代码实时生成。'));

/* ---- device state -------------------------------------------------------- */
emu.onState = (s: PanelState) => {
  lcd.update(s.lcd, s.cg, s.st);
  for (const [n, b] of buttons) {
    const on = n < 32 ? (s.lo >>> n) & 1 : (s.hi >>> (n - 32)) & 1;
    b.setLed(on === 1);
  }
};
emu.onLoad = (l) => { load.textContent = `DSP ≈ ${(l * 100).toFixed(1)}%`; };

async function power(first: boolean) {
  startBtn.disabled = true;
  rebootBtn.disabled = true;
  status.textContent = '启动中…';
  try {
    const { bootMs } = first ? await emu.start() : await emu.reboot();
    status.textContent = `运行中 · ${emu.sampleRate} Hz · 开机 ${bootMs} ms`;
    overlay.hidden = true;
    device.classList.add('live');
    rebootBtn.disabled = false;
  } catch (err) {
    status.textContent = `出错：${(err as Error).message}`;
    startBtn.disabled = false;
    console.error(err);
  }
}
startBtn.addEventListener('click', () => power(true));
rebootBtn.addEventListener('click', () => power(false));

/* ---- keyboard ------------------------------------------------------------- */
const keyButtons: Record<string, number> = {
  Space: BTN.START,
  PageUp: BTN.PAGE_UP,
  PageDown: BTN.PAGE_DOWN,
  KeyZ: BTN.mode(1), KeyX: BTN.mode(2), KeyC: BTN.mode(3), KeyV: BTN.mode(4),
};
for (let i = 1; i <= 7; i++) keyButtons[`Digit${i}`] = BTN.voice(i);
stepKeys.forEach((k, i) => { keyButtons[`Key${k}`] = BTN.step(i + 1); });

function typing(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
}

window.addEventListener('keydown', (e) => {
  if (!emu.running || typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'Shift') { if (!e.repeat) shiftBtn.set(true); return; }
  if (e.repeat && e.code !== 'ArrowLeft' && e.code !== 'ArrowRight') { if (keyButtons[e.code] !== undefined) e.preventDefault(); return; }
  if (e.code === 'ArrowRight' || e.code === 'ArrowUp') { e.preventDefault(); encoder.turn(1); return; }
  if (e.code === 'ArrowLeft' || e.code === 'ArrowDown') { e.preventDefault(); encoder.turn(-1); return; }
  if (e.code === 'Enter') { e.preventDefault(); emu.encoderButton(true); return; }
  const n = keyButtons[e.code];
  if (n !== undefined) { e.preventDefault(); buttons.get(n)?.set(true); }
});
window.addEventListener('keyup', (e) => {
  if (!emu.running || typing(e)) return;
  if (e.key === 'Shift') { shiftBtn.set(false); return; }
  if (e.code === 'Enter') { emu.encoderButton(false); return; }
  const n = keyButtons[e.code];
  if (n !== undefined) buttons.get(n)?.set(false);
});
window.addEventListener('blur', () => shiftBtn.set(false));

// for automated checks
(window as unknown as { lxr: unknown }).lxr = { emu, lcd, buttons, BTN };
