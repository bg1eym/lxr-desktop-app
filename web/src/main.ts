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
import { currentLang, onLang, setLang, t, text, type Key } from './i18n';
import { cardDialog } from './cardDialog';
import { makeZip, readFolder, readZip, writeFolder } from './cardFiles';
import { Sequencer } from './seq/sequencer';
import { SoundEditor } from './sound/editor';

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

/* GPL-3.0: where the source of this build is. */
const SOURCE_URL = 'https://github.com/bg1eym/lxr-desktop-app/tree/emu';
const NOTES_URL = 'https://github.com/bg1eym/lxr-desktop-app/blob/emu/docs/RELEASE_NOTES.md';

const emu = new LxrEmu();
const buttons = new Map<number, PanelButton>();
const seq = new Sequencer(emu);
const sound = new SoundEditor(emu);
seq.side.append(sound.root);
sound.onHide = () => seq.setSideShown(false);
seq.onTrack = (track) => {
  sound.setVoice(track);
  emu.selectVoice(track);   // the display and the knobs follow, where the voice button would
};

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
onLang(() => encoder.setPushHint(t('encoderPush')));
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

const shiftBtn = new PanelButton({ label: 'SHIFT', latch: true }, (d) => emu.button(BTN.SHIFT, d));
onLang(() => shiftBtn.setHint(t('shiftHint')));
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

const startBtn = text(h('button', 'power'), 'power');
startBtn.type = 'button';
const rebootBtn = text(h('button', 'tool'), 'reboot');
rebootBtn.type = 'button';
rebootBtn.disabled = true;
const eraseBtn = text(h('button', 'tool'), 'erase');
eraseBtn.type = 'button';
eraseBtn.disabled = true;
const cardBtn = text(h('button', 'tool'), 'cardButton');
cardBtn.type = 'button';
cardBtn.disabled = true;
const langBtn = h('button', 'tool lang');
langBtn.type = 'button';
onLang(() => {
  langBtn.textContent = t('langButton');
  langBtn.setAttribute('aria-label', t('langButtonLabel'));
});
langBtn.addEventListener('click', () => setLang(currentLang() === 'zh' ? 'en' : 'zh'));

/* Status lines are kept as key + values, so they can be redrawn in the
 * other language. */
const status = h('span', 'status');
const card = h('span', 'status');
const load = h('span', 'status load', '');
let statusText: [Key, Record<string, string | number>] = ['statusOff', {}];
let cardText: [Key, Record<string, string | number>] | null = null;
function setStatus(key: Key, vars: Record<string, string | number> = {}) {
  statusText = [key, vars];
  status.textContent = t(key, vars);
}
function setCard(key: Key, vars: Record<string, string | number> = {}) {
  cardText = [key, vars];
  card.textContent = t(key, vars);
}
onLang(() => {
  status.textContent = t(...statusText);
  if (cardText) card.textContent = t(...cardText);
});

const device = h('main', 'device',
  h('section', 'row top', screen, encArea, faderBank),
  h('section', 'row', voices, selects),
  h('section', 'row', modes, transport),
  h('section', 'row bottom', steps));

const overlay = h('div', 'overlay',
  h('div', 'overlay-card',
    h('h2', '', 'LXR-02 Emu'),
    text(h('p'), 'intro'),
    startBtn));

const version = Object.assign(h('a', 'version'), { href: NOTES_URL });
onLang(() => { version.textContent = t('version', { v: `${__APP_VERSION__} · ${__APP_BUILD__}` }); });

document.querySelector('#app')!.append(
  h('header', 'bar',
    h('div', 'brand', h('strong', '', 'LXR-02 Emu'), h('span', 'tag', 'unofficial')),
    h('div', 'tools', cardBtn, rebootBtn, eraseBtn, langBtn)),
  h('div', 'statusbar', status, card, load),
  h('div', 'stage', seq.root, device, overlay),
  h('section', 'help',
    text(h('h3'), 'helpTitle'),
    h('ul', '',
      text(h('li'), 'helpSeq'),
      text(h('li'), 'helpKnobs'),
      text(h('li'), 'helpButtons'),
      text(h('li'), 'helpCard'),
      text(h('li'), 'helpKeys'))),
  h('footer', 'foot',
    text(h('span'), 'footer'),
    ' ',
    Object.assign(text(h('a'), 'source'), { href: SOURCE_URL }),
    ' · ',
    version));

/* ---- device state -------------------------------------------------------- */
emu.onState = (s: PanelState) => {
  lcd.update(s.lcd, s.cg, s.st);
  for (const [n, b] of buttons) {
    const on = n < 32 ? (s.lo >>> n) & 1 : (s.hi >>> (n - 32)) & 1;
    b.setLed(on === 1);
  }
  seq.setTransport(s.playheads, s.run !== 0);
  playing = s.run !== 0;
};
emu.onSeq = (d, ack) => seq.setData(d, ack);
emu.onParams = (v, ack) => sound.setParams(v, ack);
emu.onCrash = (msg) => {
  crashed = true;
  setStatus('statusCrashed', { msg: msg.split('\n')[0] });
  rebootBtn.disabled = false;
};
emu.onLoad = (l) => { load.textContent = `DSP ≈ ${(l * 100).toFixed(1)}%`; };
emu.onCard = (bytes, persistent) => {
  const mb = (bytes / 1048576).toFixed(1);
  if (persistent) setCard('cardSaved', { mb });
  else setCard('cardNotKept');
};

async function power(how: 'start' | 'reboot' | 'erase') {
  seq.setLive(false);
  sound.setLive(false);
  startBtn.disabled = true;
  rebootBtn.disabled = true;
  eraseBtn.disabled = true;
  cardBtn.disabled = true;
  setStatus('statusStarting');
  try {
    // a stuck audio context needs a new one; a reboot on it would stay silent
    const stuck = stalled() || (emu.booted && emu.audioState !== 'running');
    const { bootMs } = how === 'start' ? await emu.start()
      : how === 'reboot' ? await (stuck ? emu.restartAudio() : emu.reboot())
      : await emu.eraseCardAndReboot();
    lastBoot = { rate: emu.sampleRate, ms: bootMs };
    crashed = false;
    setStatus('statusRunning', lastBoot);
    emu.onCard(emu.card.size, emu.card.persistent);
    overlay.hidden = true;
    device.classList.add('live');
    seq.setLive(true);
    sound.setLive(true);
    await sound.load();
    emu.selectVoice(seq.selectedTrack);
    rebootBtn.disabled = false;
    eraseBtn.disabled = false;
    cardBtn.disabled = false;
  } catch (err) {
    setStatus('statusError', { msg: (err as Error).message });
    startBtn.disabled = false;
    console.error(err);
  }
}
startBtn.addEventListener('click', () => power('start'));
rebootBtn.addEventListener('click', () => power('reboot'));
eraseBtn.addEventListener('click', () => {
  if (confirm(t('eraseConfirm'))) power('erase');
});
const sdDialog = cardDialog(emu, (bootMs) => {
  lastBoot = { rate: emu.sampleRate, ms: bootMs };
  setStatus('statusRunning', lastBoot);
  sound.load();   // the samples on the new card are in the waveform menus
});
document.body.append(sdDialog);
cardBtn.addEventListener('click', () => sdDialog.showModal());

/* Power saving. With nothing playing, the emulated device pauses after 10
 * minutes without input, or after 5 minutes in the background: the worklet
 * plays silence instead of running the firmware, and the browser's audio
 * keeps going (suspending and resuming it left the worklet dead once). A
 * click or a key goes on where it was; the device's time follows the
 * rendered samples. Leaving the page also hands over what the firmware wrote
 * to the card since the last sync. */
const IDLE_PAUSE_MS = 10 * 60 * 1000;
const HIDDEN_PAUSE_MS = 5 * 60 * 1000;
let lastInput = performance.now();
let hiddenSince = 0;
let playing = false;
let autoPaused = false;
let lastBoot: Record<string, number> = {};
function wake() {
  lastInput = performance.now();
  emu.resume().then(() => {
    if (autoPaused && !emu.paused) {
      autoPaused = false;
      setStatus('statusRunning', lastBoot);
    }
  });
}
for (const type of ['pointerdown', 'keydown', 'wheel']) window.addEventListener(type, wake, { capture: true, passive: true });
setInterval(() => {
  if (!emu.running || emu.paused || playing) return;
  const now = performance.now();
  const hiddenLong = document.visibilityState === 'hidden' && now - hiddenSince > HIDDEN_PAUSE_MS;
  if (!hiddenLong && now - lastInput < IDLE_PAUSE_MS) return;
  autoPaused = true;
  setStatus('statusPaused');
  emu.pause();
}, 30 * 1000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    hiddenSince = performance.now();
    emu.syncCard(true);
  } else {
    wake();
  }
});

/* Watchdog: while the page is shown, the worklet reports at least every 3
 * seconds (paused or not). When it goes quiet (stuck audio after the computer
 * slept, a resume that never took, a worklet that stopped), first try to start
 * the browser's audio again, then make a new audio context and reboot from
 * the card, instead of leaving a dead page. It counts ticks without news
 * rather than comparing clocks, which jump when the computer wakes up. */
const TICK_MS = 5000;
let crashed = false;
let restarting = false;
let quietTicks = 0;
let lastHeard = -1;
let resumeTried = false;
let restarts: number[] = [];
const stalled = () => quietTicks >= 2;
setInterval(async () => {
  if (restarting || crashed || !emu.booted || document.visibilityState !== 'visible') { quietTicks = 0; lastHeard = -1; return; }
  if (emu.heard !== lastHeard) { lastHeard = emu.heard; quietTicks = 0; resumeTried = false; return; }
  quietTicks++;
  if (quietTicks === 2 && emu.audioState !== 'running' && !resumeTried) { resumeTried = true; emu.resume(); return; }
  if (quietTicks < 4) return;
  const now = performance.now();
  restarts = restarts.filter((t) => now - t < 5 * 60 * 1000);
  if (restarts.length >= 2) { setStatus('statusStalled'); return; }
  restarts.push(now);
  restarting = true;
  console.warn('[lxr] audio stalled, restarting');
  try {
    const { bootMs } = await emu.restartAudio();
    lastBoot = { rate: emu.sampleRate, ms: bootMs };
    autoPaused = false;
    setStatus('statusRestarted');
  } catch (err) {
    setStatus('statusError', { msg: (err as Error).message });
  }
  quietTicks = 0;
  restarting = false;
}, TICK_MS);

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
(window as unknown as { lxr: unknown }).lxr = { emu, lcd, buttons, BTN, seq, sound, cardFiles: { readFolder, writeFolder, makeZip, readZip } };
