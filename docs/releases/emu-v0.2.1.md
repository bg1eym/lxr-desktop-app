**Try it: <https://bg1eym.github.io/lxr-desktop-app/>** (desktop Chrome recommended). Reload with ⌘⇧R if you still see the old page; the version is shown at the bottom.

> LXR-02 Emu is an unofficial emulator. Not affiliated with, endorsed by or approved by Erica Synths. "Erica Synths", "LXR" and "LXR-02" are trademarks of Erica Synths and are used here only to say what the emulator is compatible with. This is not a firmware release for the device.

## What's new in 0.2.1

Fixes for the freezes reported after 0.2.0, and a reset button for sounds.

### Fixes

- **The emulator froze after playing for a while and then pressing stop.** The sound stopped, the
  display stopped, and reloading the page could hang or crash the browser. The same bug caused the
  other freezes reported:
  - switching voices after editing for a while;
  - the first click after the page had been left alone, or after the computer slept.
- **The cause:**
  - After 2 minutes without a key or knob on the device, the firmware shows its screensaver.
  - The next key press then waits in the firmware for the screensaver's next step, up to half a
    second. On the device, time goes on during this wait.
  - In the emulator, time only moved between the firmware's main loop passes, so the wait never
    ended, and the browser's audio thread was stuck in it.
  - Playing and editing on the page don't count as keys for the firmware. So this happened after 2
    minutes of playing, or of editing on the page only.
- **The fix:**
  - Time now goes on during such waits, as on the device. Sound and sequencer keep running.
  - The key takes effect when the wait is over. Right after the screensaver this takes up to half a
    second, as on the device.
  - The 0.2.0 notes put the freeze after idle down to a timing problem in the browser. It was this
    bug. The safeguards added in 0.2.0 (the watchdog and the error messages) stay.
- **A reboot while playing lost the latest pattern edits, so it was silent after the reboot.** The
  firmware saves the pattern only once the sequencer stops. The current pattern and kit are now
  saved first when you:
  - reboot;
  - put the page in the background;
  - leave it until the automatic pause;
  - export the card.
- **After a reboot, removing a solo muted every track.** The page still showed the solo from before
  the reboot. A reboot now clears the solo, as it clears the device's mutes. A solo is also dropped
  when the mutes are changed elsewhere, for example on the panel.
- **Step velocity seemed to do nothing.** In the init kit, "Velocity → volume" is off and velocity
  modulates nothing, so velocity is not heard. The device does the same. The velocity lane now says
  so for the selected track, with a button that turns "Velocity → volume" on.

### New

- **Reset sound** (↺ at the top of the sound panel) puts the selected voice back to the init sound
  of a new project, on all 8 pages. Other voices and the pattern stay as they are. It asks first.
  - **Reboot** restarts the emulator from the card.
  - **Erase SD card** starts again from an empty card.

### Upgrading

Reload the page (⌘⇧R if the old one still shows). The bottom of the page should say "Version
0.2.1". The virtual SD card is kept.

### For developers

- The firmware sources still have a single `#ifdef LXR_EMU`; the fix is in the emulator's hardware
  layer (`emu/platform.c`, `emu/hw/hal_emu.c`).
- New: `lxr_reset_voice()` and `lxr_save_now()` in the emulator API.
- Details (in Chinese) in `docs/EMULATOR_PLAN.md`. All release notes:
  [docs/RELEASE_NOTES.md](https://github.com/bg1eym/lxr-desktop-app/blob/emu/docs/RELEASE_NOTES.md).
