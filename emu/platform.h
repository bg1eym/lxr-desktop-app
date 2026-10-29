/*
 * LXR-02 Emu (unofficial) - boot and timing of the emulated device.
 *
 * Copyright (C) 2026 LXR-02 Emu contributors
 * SPDX-License-Identifier: GPL-3.0-only
 */
#ifndef EMU_PLATFORM_H
#define EMU_PLATFORM_H

#include <stdint.h>

typedef struct {
	uint32_t seed;              /* hardware RNG replacement */
	uint8_t jacks;              /* plugged outputs, see emu_set_jacks(); 0 = out 1 only */
	uint8_t format_blank_card;  /* run the firmware's format routine on a blank card */
} emu_boot_opts;

/* 0: booted with the SD card, 1: booted without a card, <0: error. */
int emu_boot(const emu_boot_opts *opts);
void emu_main_loop_iteration(void);
void emu_render_block(int16_t *out1, int16_t *out2);

void emu_set_jacks(uint8_t mask);
void emu_set_fader(uint8_t idx, float pos);
void emu_encoder_turn(int detents);
void emu_encoder_button(uint8_t down);
void emu_pot_turn(uint8_t idx, int degrees);
uint64_t emu_leds(void);
void emu_midi_in_byte(uint8_t b);
typedef void (*emu_midi_out_fn)(uint8_t byte, void *user);
void emu_set_midi_out(emu_midi_out_fn fn, void *user);

uint64_t emu_samples_rendered(void);
uint32_t emu_millis(void);

void USART3_IRQHandler(void);

/* seq_api.c: runs at the start of every block. */
void seq_api_block(void);

#endif
