# LXR-02 Emu (unofficial)

The LXR-02 drum machine firmware 1.7 (this repository) built for a desktop
computer and for the browser. Not an official Erica Synths product; "Erica
Synths", "LXR" and "LXR-02" are trademarks of their owners.

The sound engine, sequencer, menus and preset code are the firmware's own C
sources, compiled unchanged except for one `#ifdef LXR_EMU` (see
`docs/EMULATOR_PLAN.md`). Only the hardware layer is replaced:

- `shim/` - stand-in headers for the STM32 HAL, CMSIS intrinsics and the USB stack
- `hw/` - GPIO/timers/SPI/RNG, the 2x16 display, the SD card (a RAM disk under
  the firmware's FatFs) and USB-MIDI queues
- `platform.c` - boot sequence and main loop of `main.c`, interrupts on the sample clock
- `api.c` - C API (`lxr_api.h`), exported to JavaScript in the WebAssembly build
- `cli/` - command line tool: render to WAV, self test

```sh
# native (needs clang for __fp16)
cmake -S emu -B build/emu -DCMAKE_C_COMPILER=clang
cmake --build build/emu
build/emu/lxr_cli render --demo --out demo.wav
ctest --test-dir build/emu

# WebAssembly (clang, lld, wasi-libc) and the web app
cd web && npm ci && npm run wasm && npm run dev
```

License: GPL-3.0-only, like the firmware (see `LICENSE` and `NOTICE.md`).
