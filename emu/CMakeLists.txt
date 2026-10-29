# LXR-02 Emu (unofficial) - host and WebAssembly build of the firmware.
#
# Copyright (C) 2026 LXR-02 Emu contributors
# SPDX-License-Identifier: GPL-3.0-only
#
# Native:      cmake -S emu -B build/emu && cmake --build build/emu
# WebAssembly: cmake -S emu -B build/emu-wasm -DCMAKE_TOOLCHAIN_FILE=emu/cmake/wasi-clang.cmake
#              cmake --build build/emu-wasm      -> build/emu-wasm/lxr_emu.wasm
#
# The firmware sources under Core/, FATFS/ and Middlewares/ are compiled as
# they are. Only the hardware layer is replaced, by the files in emu/shim
# (headers found before Core/Inc) and emu/hw.

cmake_minimum_required(VERSION 3.21)
project(lxr_emu VERSION 1.7 LANGUAGES C)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_C_EXTENSIONS ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)
if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE Release CACHE STRING "" FORCE)
endif()

set(FW ${CMAKE_CURRENT_SOURCE_DIR}/..)
set(EMU ${CMAKE_CURRENT_SOURCE_DIR})

# Firmware translation units, grouped like Core/CMakeLists.txt. Left out:
# main.c, stm32f7xx_it.c, the CubeMX init/startup files, flash_if.c (flashing),
# lcd.c and cs4344_cs5343.c (hardware drivers, replaced in emu/hw), delay.c
# (cycle counter setup with inline ARM asm, replaced in emu/hw/hal_emu.c) and
# AudioCodecManager.c (codec start-up and DMA buffers, now in emu/platform.c).
set(FW_SOURCES
    # io
    Core/Src/IO/adcPots.c
    Core/Src/IO/DIO.c
    Core/Src/IO/uart.c
    # ui
    Core/Src/encoder.c
    Core/Src/buttonHandler.c
    Core/Src/ledHandler.c
    Core/Src/graphic.c
    Core/Src/frontPanelParser.c
    Core/Src/Parameters.c
    Core/Src/menu/Cc2Text.c
    Core/Src/menu/copyClearTools.c
    Core/Src/menu/menu.c
    Core/Src/menu/screensaver.c
    # preset
    Core/Src/Preset/initKit.c
    Core/Src/Preset/presetManager.c
    # dsp
    Core/Src/Soundengine/DSPAudio/1PoleLp.c
    Core/Src/Soundengine/DSPAudio/automationNode.c
    Core/Src/Soundengine/DSPAudio/BufferTools.c
    Core/Src/Soundengine/DSPAudio/CymbalVoice.c
    Core/Src/Soundengine/DSPAudio/Decay.c
    Core/Src/Soundengine/DSPAudio/distortion.c
    Core/Src/Soundengine/DSPAudio/dither.c
    Core/Src/Soundengine/DSPAudio/DrumVoice.c
    Core/Src/Soundengine/DSPAudio/HiHat.c
    Core/Src/Soundengine/DSPAudio/lfo.c
    Core/Src/Soundengine/DSPAudio/mixer.c
    Core/Src/Soundengine/DSPAudio/modulationNode.c
    Core/Src/Soundengine/DSPAudio/Oscillator.c
    Core/Src/Soundengine/DSPAudio/random.c
    Core/Src/Soundengine/DSPAudio/ResonantFilter.c
    Core/Src/Soundengine/DSPAudio/Samples.c
    Core/Src/Soundengine/DSPAudio/SlopeEg2.c
    Core/Src/Soundengine/DSPAudio/snapEg.c
    Core/Src/Soundengine/DSPAudio/Snare.c
    Core/Src/Soundengine/DSPAudio/squareRootLut.c
    Core/Src/Soundengine/DSPAudio/TiltEq.c
    Core/Src/Soundengine/DSPAudio/transientGenerator.c
    Core/Src/Soundengine/DSPAudio/transientTables.c
    Core/Src/Soundengine/DSPAudio/wavetable.c
    Core/Src/Soundengine/DSPAudio/FX/Compressor.c
    Core/Src/Soundengine/DSPAudio/FX/Delay.c
    Core/Src/Soundengine/DSPAudio/FX/Distortion.c
    Core/Src/Soundengine/DSPAudio/FX/FxRamBuffer.c
    Core/Src/Soundengine/DSPAudio/FX/Reverb.c
    Core/Src/Soundengine/DSPAudio/FX/Ringmod.c
    Core/Src/Soundengine/DSPAudio/FX/VerbTools/AllpassDelay.c
    Core/Src/Soundengine/DSPAudio/FX/VerbTools/sinCos.c
    Core/Src/Soundengine/DSPAudio/FX/VerbTools/VerbDelay.c
    Core/Src/Soundengine/DSPAudio/FX/VerbTools/VerbModDelay.c
    # engine
    Core/Src/Soundengine/FIFO.c
    Core/Src/Soundengine/FxBus.c
    Core/Src/Soundengine/Soundengine.c
    Core/Src/Soundengine/TriggerOut.c
    # midi
    Core/Src/Soundengine/MIDI/CortexParser.c
    Core/Src/Soundengine/MIDI/MidiMessages.c
    Core/Src/Soundengine/MIDI/MidiParser.c
    Core/Src/Soundengine/MIDI/MidiVoiceControl.c
    Core/Src/Soundengine/MIDI/ParameterArray.c
    Core/Src/Soundengine/MIDI/Uart.c
    # sequencer
    Core/Src/Soundengine/Sequencer/clockSync.c
    Core/Src/Soundengine/Sequencer/EuklidGenerator.c
    Core/Src/Soundengine/Sequencer/sequencer.c
    # usb
    Core/Src/Soundengine/USB/usb_manager.c
    # FatFs (the SD driver is replaced by emu/hw/sd_emu.c)
    Middlewares/Third_Party/FatFs/src/diskio.c
    Middlewares/Third_Party/FatFs/src/ff.c
    Middlewares/Third_Party/FatFs/src/ff_gen_drv.c
    Middlewares/Third_Party/FatFs/src/option/syscall.c
    FATFS/App/fatfs.c
)
list(TRANSFORM FW_SOURCES PREPEND ${FW}/)

set(EMU_SOURCES
    ${EMU}/hw/hal_emu.c
    ${EMU}/hw/lcd_emu.c
    ${EMU}/hw/sd_emu.c
    ${EMU}/hw/usb_emu.c
    ${EMU}/platform.c
    ${EMU}/card_io.c
)
# The exported API. In the WebAssembly build these go straight into the
# module: from a static library the linker would drop what nothing calls.
set(EMU_API_SOURCES ${EMU}/api.c ${EMU}/seq_api.c)
if(NOT CMAKE_SYSTEM_PROCESSOR STREQUAL "wasm32")
    list(APPEND EMU_SOURCES ${EMU_API_SOURCES})
endif()

add_library(lxr_core STATIC ${FW_SOURCES} ${EMU_SOURCES})
target_include_directories(lxr_core PUBLIC
    ${EMU}/shim            # must come first: main.h, stm32f7xx_hal.h, ...
    ${EMU}/hw
    ${EMU}
    ${FW}/Core/Inc
    ${FW}/Middlewares/Third_Party/FatFs/src
    ${FW}/FATFS/App
    ${FW}/FATFS/Target
)
target_compile_definitions(lxr_core PUBLIC LXR_EMU=1 FIRMWARE_VERSION="\ 1.7")
# Float behaviour: the firmware is built with -ffast-math on the Cortex-M7.
# Here the default IEEE semantics are kept so that results do not depend on
# how aggressively the host compiler reassociates.
target_compile_options(lxr_core PRIVATE $<IF:$<CONFIG:Debug>,-O0,-O2> -w)
# Float to integer casts saturate, like VCVT on the Cortex-M7 (negative ->
# 0 for unsigned, NaN -> 0). The firmware relies on it: the FM and PWM
# oscillators cast negative and > 2^32 phase offsets to uint32_t. Without
# this, x86 wraps and WebAssembly returns 0 for those, and both sound
# different from the device and from each other.
target_compile_options(lxr_core PUBLIC -fno-strict-float-cast-overflow)

if(CMAKE_SYSTEM_PROCESSOR STREQUAL "wasm32")
    # A reactor module (no main): the AudioWorklet instantiates it, calls
    # _initialize and then the lxr_* functions. Only the API is exported.
    target_compile_options(lxr_core PRIVATE -fvisibility=hidden)
    add_executable(lxr_emu ${EMU_API_SOURCES})
    set_source_files_properties(${EMU_API_SOURCES} TARGET_DIRECTORY lxr_emu PROPERTIES COMPILE_OPTIONS "-fvisibility=hidden;-Wno-macro-redefined")
    target_link_libraries(lxr_emu PRIVATE lxr_core)
    set_target_properties(lxr_emu PROPERTIES SUFFIX ".wasm")
    target_link_options(lxr_emu PRIVATE
        -mexec-model=reactor
        -Wl,--export-dynamic
        -Wl,-z,stack-size=1048576
        -Wl,--initial-memory=16777216
        -Wl,--strip-debug)
else()
    add_executable(lxr_cli ${EMU}/cli/lxr_cli.c)
    target_link_libraries(lxr_cli PRIVATE lxr_core m)
    enable_testing()
    add_test(NAME selftest COMMAND lxr_cli selftest)
endif()
