/*
 * LXR-02 Emu (unofficial) - public C API.
 *
 * Copyright (C) 2026 LXR-02 Emu contributors
 * SPDX-License-Identifier: GPL-3.0-only
 */
#ifndef LXR_API_H
#define LXR_API_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Boot with a blank virtual SD card of the given size (formatted by the
 * firmware's format routine). 0 = ok, -2 = already booted: firmware state
 * lives in globals, so boot once per process / WebAssembly instance. */
int lxr_init(uint32_t seed, uint32_t sd_megabytes);

/* Interleaved output, channels = 2 (out 1) or 4 (out 1 L/R, out 2 L/R). */
int lxr_render(float *out, int frames, int channels);
int lxr_render_i16(int16_t *out, int frames, int channels);
void lxr_idle_blocks(int blocks);

/* Front panel. Button numbers are enum ButtonNumbers (buttonHandler.h). */
void lxr_button(uint8_t button, uint8_t down);
void lxr_button_click(uint8_t button);
int lxr_input_pending(void);
const char *lxr_get_lcd(void);
const uint8_t *lxr_get_leds(void);
void lxr_set_jacks(uint8_t mask);

int lxr_is_running(void);
void lxr_set_running(uint8_t run);

int lxr_num_params(void);
int lxr_num_sound_params(void);
int lxr_get_param(int idx);
void lxr_set_param(int idx, int value);

void lxr_set_main_step(uint8_t pattern, uint8_t voice, uint8_t step, uint8_t on);
int lxr_get_main_step(uint8_t pattern, uint8_t voice, uint8_t step);

typedef void (*lxr_midi_out_fn)(uint8_t byte, void *user);
void lxr_midi_in(const uint8_t *bytes, int len);
void lxr_set_midi_out(lxr_midi_out_fn fn, void *user);

#ifdef __cplusplus
}
#endif
#endif
