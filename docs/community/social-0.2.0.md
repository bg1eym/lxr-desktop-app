# LXR-02 Emu 0.2.0 – posts for social networks

Posts in English for the 0.2.0 release. Publish the GitHub release (tag `emu-v0.2.0`) first: the
main post links to it.

Attach the screenshot [`docs/images/emu-sequencer.png`](../images/emu-sequencer.png). Alt text:

> Screenshot of LXR-02 Emu: a step sequencer with seven drum tracks, a velocity lane under the grid,
> and on the right a sound panel with an LCD-style display and filter sliders.

Rules, as for the first announcement: say "unofficial", don't use Erica Synths logos or product
photos, no brand hashtags (#EricaSynths, #LXR02), say that an AI assistant helped, and don't claim
what hasn't been tried on hardware.

## Short post

For X (267 of 280 characters, links count as 23), Bluesky (285 of 300), Threads and Mastodon (500).

```text
LXR-02 Emu v0.2.0: the open-source LXR-02 drum machine firmware running in your browser, now with a step sequencer for all 7 tracks and a sound editor for every voice. Free and unofficial, not affiliated with Erica Synths.
https://bg1eym.github.io/lxr-desktop-app/
#drummachine #techno
```

## Main post

For Instagram, Facebook and LinkedIn (1177 characters).

```text
LXR-02 Emu v0.2.0 is out 🥁

It's an unofficial emulator that runs the open-source LXR-02 drum machine firmware (1.7) in your browser: the firmware's own C code, compiled to WebAssembly. Same sound engine, same sequencer, nothing to install.

New in 0.2.0:
• A step sequencer for all 7 tracks: paint steps; draw velocity, probability, retrig, nudge and note; a length per track for polymeter; fills, mute/solo, swing, tap tempo, undo
• A sound panel for every voice: all 8 pages (OSC, AEG, MOD, FM, TRANS, FILTER, LFO, MIX) on sliders, with a display that shows the page like the hardware's screen
• It all stays in sync with the virtual front panel and the virtual SD card. The card can be exported to move projects to a real LXR-02 (not yet tested on hardware, reports welcome)

Try it (desktop Chrome): https://bg1eym.github.io/lxr-desktop-app/
What's new: https://github.com/bg1eym/lxr-desktop-app/releases/tag/emu-v0.2.0

LXR-02 owners: does it sound like your unit? Feedback welcome.

Unofficial fan project, not affiliated with or approved by Erica Synths. GPL-3.0. Built with the help of Claude, an AI coding assistant.

#drummachine #techno #synth #webaudio #opensource
```

## Forum update

For a reply in the thread of the first announcement (ModWiggler, Elektronauts), or a new post on
Reddit (r/drummachines, r/synthesizers) with the screenshot. Check each forum's rules on self-promotion first.

**Title:** LXR-02 Emu 0.2: a step sequencer and a sound editor for the open-source LXR-02 firmware in the browser (unofficial)

```markdown
Update on the unofficial LXR-02 emulator: version 0.2.0 adds the two things the small screen makes
slow on the device, a step sequencer and a sound editor. It still runs the firmware's own code (1.7)
in the browser, and both editors change the firmware's own pattern and kit data, so the virtual
panel, its display and the SD card always agree.

Try it: https://bg1eym.github.io/lxr-desktop-app/ (desktop Chrome, click Power on)
Release notes: https://github.com/bg1eym/lxr-desktop-app/releases/tag/emu-v0.2.0
Source (GPL-3.0): https://github.com/bg1eym/lxr-desktop-app/tree/emu

Sequencer
- A grid of the 7 tracks: click or drag to paint steps; a lane to draw velocity, probability,
  retrig, nudge and note
- Track lengths 1–64 for polymeter, fills (four on the floor, 8ths, offbeats, 16ths), shift,
  humanize, mute/solo, swing, tap tempo, undo/redo, pattern switching A1–D16
- "Keep edits": on the device, switching patterns discards unsaved changes to the playing pattern;
  the emulator keeps them unless you turn this off

Sound panel
- The 8 pages of each voice (OSC, AEG, MOD, FM, TRANS, FILTER, LFO, MIX), as the select buttons open
  them, with every parameter on a slider or a button
- A display that shows the page like the hardware's screen
- Follows the panel's knobs and kit loads; can be hidden once the sounds are set

Still missing: editing parameter locks, saving kits from the page, MIDI and output 2. I haven't
compared it with recordings of a real unit, and an exported card hasn't been tried on a real
LXR-02 yet. If you have one, I'd love to hear how it compares.

Not affiliated with or approved by Erica Synths. Built with the help of Claude, an AI coding assistant.
```
