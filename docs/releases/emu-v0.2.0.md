**Try it: <https://bg1eym.github.io/lxr-desktop-app/>** (desktop Chrome recommended). Reload with ⌘⇧R if you still see the old page; the version is shown at the bottom.

> LXR-02 Emu is an unofficial emulator. Not affiliated with, endorsed by or approved by Erica Synths. "Erica Synths", "LXR" and "LXR-02" are trademarks of Erica Synths and are used here only to say what the emulator is compatible with. This is not a firmware release for the device.

## What's new in 0.2.0

A sequencer and a sound editor above the virtual panel, made for a desktop browser.
Both edit the firmware's own data, so the panel, the display and the SD card always see the same
pattern and kit.

![Sequencer and sound panel](https://raw.githubusercontent.com/bg1eym/lxr-desktop-app/emu/docs/images/emu-sequencer.png)

### Sequencer

- **Grid** of the 7 tracks for the playing pattern. Click a step to switch it, drag to paint along a
  track, Shift-click or right-click to select. Brightness shows velocity; small marks show
  probability, retrig, nudge and parameter locks.
- **Overview** of all 4 bars (64 steps) with each track's playhead. Click a bar to show it; **Follow**
  keeps up with the playhead.
- **Track header:**
  - click the name to hear the voice;
  - mute and solo (⌘-click solos several tracks);
  - length 1–64 per track, for polymeter;
  - the **⋯** menu: every beat (four on the floor), every 8th, offbeats, every 16th, shift left or
    right, humanize velocity, copy, paste and clear.
- **Lane** under the grid: draw velocity, probability, retrig, nudge or note for the selected track.
  Double-click resets a step.
- **Toolbar:**
  - play/stop;
  - BPM: type it, scroll it or tap it;
  - swing;
  - pattern A1–D16: while playing, the new pattern starts when the current one ends, as on the device;
  - save, undo and redo (⌘Z, ⇧⌘Z).
- **Keep edits** (on by default). On the device, switching to another pattern throws away unsaved
  changes to the playing one. With Keep edits on, they are kept and saved to the card. Switch it off
  to get the device's behaviour. **Save** (⌘S) does what SAVE does on the device.
- **Keys with the grid focused:** arrows move, Shift+arrows extend, Enter switches, Delete clears,
  ⌘C/⌘V copy and paste steps, ⌘A selects the bar.

### Sound panel

- To the right of the grid, for the voice of the selected track.
- **Pages 1–8**: OSC, AEG, MOD, FM, TRANS, FILTER, LFO, MIX, the pages the device's select buttons
  open.
- **Every sound parameter** of the page, with the firmware's own ranges and value names. Values are
  sliders; waveforms, filter types and other short lists are buttons; longer lists and modulation
  targets are drop-down lists.
- **Display**: drawn like the device's screen, with the 3-letter parameter names over their values,
  and the full name while you change one.
- Selecting a track also selects the voice on the panel, so the device's screen and knobs work on the
  same voice. This does not happen in copy, mute or performance mode, where the voice buttons do
  something else.
- The panel follows changes made with the device's knobs or by loading a kit.
- **Show or hide** it with **Sound panel** at the right of the toolbar, or × on the panel. Without it,
  the grid takes the whole width. The browser remembers the choice.
- Changes go into the current kit, which the firmware saves to the card 2 seconds later, as on the
  device. To keep a kit in a slot, SAVE it on the panel.

### Other changes

- **Language:** the page is in English, or in Chinese when that is the browser's first language. The
  button at the top right switches, and the choice is remembered. Buttons, menus and screen-reader
  labels are translated; device terms (BPM, swing, retrig, page names) and the firmware's own
  display texts stay as on the device.
- When an LFO's target voice changes, its target moves to the same parameter of the new voice, as the
  device's menu does.
- The version number is shown at the bottom of the page.

### Upgrading

Nothing to do. Reload the page (⌘⇧R if the old one still shows). The virtual SD card in your browser
is kept, with the patterns and kits you made before.

### Not there yet

- Editing parameter locks (they are shown, and the old editor could clear them; that comes back
  later).
- Saving kits from the page (use SAVE on the panel).
- MIDI, and the second output.
- BPM is not autosaved, as on the device: it comes back from the project after a reboot.
- Not yet compared with recordings of a real LXR-02. An exported card has not been tried in a real
  device yet; please report what you find.

### For developers

- The firmware sources still have a single `#ifdef LXR_EMU`.
- New on the emulator side:
  - `emu/seq_api.c`: pattern data, keep edits, save;
  - `emu/param_api.c`: the firmware's sound menus as JSON. `lxr_cli describe` prints them.
- On the web side: `web/src/seq/` (sequencer) and `web/src/sound/` (sound panel).
- Design notes are in [`docs/EMULATOR_PLAN.md`](https://github.com/bg1eym/lxr-desktop-app/blob/emu/docs/EMULATOR_PLAN.md) (in Chinese).

---

## 0.2.0 更新内容（中文）

虚拟面板上方新增了音序器和音色编辑器，按桌面浏览器设计。两者都直接修改固件自己的数据，所以面板、屏幕和 SD 卡上看到的始终是同一份 pattern 和 kit。

![音序器和音色面板](https://raw.githubusercontent.com/bg1eym/lxr-desktop-app/emu/docs/images/emu-sequencer.png)

### 音序器

- **网格**：显示正在播放的 pattern 的 7 条轨道。
  - 点击步进开关，在一条轨道上拖动可以连续画；
  - Shift 点击或右键只选中；
  - 亮度表示力度，角上的小标记表示概率、retrig、微移和参数锁。
- **总览条**：4 个小节（64 步）一览，每条轨道各有自己的播放头。点击某个小节就显示它；打开"跟随"会自动翻到正在播放的那一小节。
- **轨道头**：
  - 点名字试听；
  - 静音和独奏（⌘ 点击可以独奏多轨）；
  - 每轨长度可设 1–64，可以做复合节奏；
  - **⋯** 菜单：每拍一下（四拍底鼓）、每个八分、反拍、每个十六分、左移或右移、随机微调力度、复制、粘贴、清空。
- **网格下方的 lane**：给选中的轨道画力度、概率、retrig、微移或音高，双击恢复默认。
- **工具栏**：
  - 播放/停止；
  - BPM：可以输入、滚轮调，或者用 Tap 按节奏点；
  - Swing；
  - Pattern A1–D16：播放中切换时，新 pattern 在当前这一段结束后才开始，和真机一样；
  - 保存、撤销、重做（⌘Z、⇧⌘Z）。
- **保留修改**（默认打开）：在真机上，切换到别的 pattern 时，正在播放的 pattern 里没保存的改动会被丢弃。打开这一项后改动会保留，并存到卡上；关掉就和真机一样。**保存**（⌘S）等于真机上的 SAVE。
- **网格获得焦点时的快捷键**：方向键移动，Shift+方向键扩选，Enter 开关，Delete 关闭，⌘C/⌘V 复制粘贴步进，⌘A 选中整个小节。

### 音色面板

- 在网格右边，编辑选中轨道的声部。
- **第 1–8 页**：OSC、AEG、MOD、FM、TRANS、FILTER、LFO、MIX，对应真机的 8 个选择键。
- **这一页的全部音色参数**，范围和数值名称都取自固件。数值用滑条；波形、滤波类型等选项少的用按钮；选项多的和调制目标用下拉列表。
- **屏幕**：按真机屏幕的样子画，上面是参数的 3 字母名称，下面是数值；调节某个参数时显示它的全名。
- 选中轨道时，真机面板也会切到这个声部，屏幕和旋钮跟着操作同一个声部。在复制模式、静音模式和 PERF 页不会切，因为那时声部键在真机上另有用途。
- 用真机旋钮修改参数或载入 kit 时，音色面板会跟着更新。
- **显示/隐藏**：点工具栏最右边的"音色面板"，或面板右上角的 ×。隐藏后网格占满整个宽度，浏览器会记住这个选择。
- 改动写进当前的 kit，和真机一样，固件 2 秒后自动存到卡上。要存进 kit 槽位，在面板上用 SAVE。

### 其他改动

- **语言**：浏览器的第一语言是中文时页面显示中文，其他情况显示英文。右上角的按钮可以切换，选择会被记住。按钮、菜单和读屏标签都已翻译；BPM、Swing、Retrig、页名等设备术语，以及固件屏幕上的文字，保持和真机一致。
- 改变 LFO 的目标声部时，调制目标会换成新声部上的同一个参数，和真机菜单的做法一样。
- 页面底部显示版本号。

### 如何升级

不需要做任何事。刷新页面即可（如果还是旧页面，按 ⌘⇧R）。浏览器里的虚拟 SD 卡会保留，以前做的 pattern 和 kit 都还在。

### 还没有的功能

- 编辑参数锁：目前只显示；旧的检查器能清除参数锁，这个功能以后会加回来。
- 在网页上保存 kit：请用面板上的 SAVE。
- MIDI 和第二组输出。
- BPM 不会自动存盘，和真机一样，重启后回到工程里存的值。
- 还没有和真机 LXR-02 的录音做过对比；导出的卡也还没在真机上试过。欢迎反馈试用结果。

### 开发者相关

- 固件源代码里仍然只有一处 `#ifdef LXR_EMU`。
- 模拟器这边的新文件：
  - `emu/seq_api.c`：pattern 数据、保留修改、保存；
  - `emu/param_api.c`：把固件的音色菜单输出成 JSON，`lxr_cli describe` 可以打印出来。
- 网页这边：`web/src/seq/`（音序器）和 `web/src/sound/`（音色面板）。
- 设计记录在 [`docs/EMULATOR_PLAN.md`](https://github.com/bg1eym/lxr-desktop-app/blob/emu/docs/EMULATOR_PLAN.md)。

---

All release notes: [docs/RELEASE_NOTES.md](https://github.com/bg1eym/lxr-desktop-app/blob/emu/docs/RELEASE_NOTES.md) · Source (GPL-3.0): [emu branch](https://github.com/bg1eym/lxr-desktop-app/tree/emu)
