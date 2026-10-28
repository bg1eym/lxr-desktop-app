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
/* The same in two steps, to put a saved card back in between. */
int lxr_sd_create(uint32_t sd_megabytes);
int lxr_boot(uint32_t seed);

/* SD card image in chunks of lxr_sd_chunk_size() bytes. lxr_sd_chunk()
 * returns NULL for a chunk never written (reads as zeros);
 * lxr_sd_take_dirty() returns the next chunk written since it was last
 * reported, or -1. */
uint32_t lxr_sd_chunk_size(void);
uint32_t lxr_sd_num_chunks(void);
const uint8_t *lxr_sd_chunk(uint32_t c);
uint8_t *lxr_sd_chunk_for_load(uint32_t c);
int32_t lxr_sd_take_dirty(void);

/* Interleaved output, channels = 2 (out 1) or 4 (out 1 L/R, out 2 L/R). */
int lxr_render(float *out, int frames, int channels);
int lxr_render_i16(int16_t *out, int frames, int channels);
void lxr_idle_blocks(int blocks);

/* Front panel. Button numbers are enum ButtonNumbers (buttonHandler.h). */
void lxr_button(uint8_t button, uint8_t down);
void lxr_button_click(uint8_t button);
int lxr_input_pending(void);
const char *lxr_get_lcd(void);               /* 32 chars: row 1, row 2 */
const uint8_t *lxr_get_lcd_cgram(void);       /* 8 custom chars x 8 rows */
uint32_t lxr_get_lcd_state(void);             /* display/cursor flags, cursor cell */
uint32_t lxr_get_leds_lo(void);
uint32_t lxr_get_leds_hi(void);
void lxr_set_jacks(uint8_t mask);
void lxr_encoder_turn(int detents);
void lxr_encoder_button(uint8_t down);
void lxr_pot_turn(uint8_t idx, int degrees);
void lxr_set_fader(uint8_t idx, float pos);
float *lxr_audio_buffer(void);

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
void lxr_midi_in_byte(uint8_t b);
void lxr_set_midi_out(lxr_midi_out_fn fn, void *user);

#ifdef __cplusplus
}
#endif
#endif
