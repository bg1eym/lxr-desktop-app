/*
 * LXR-02 Emu (unofficial) - virtual hardware shared between the stand-ins.
 *
 * Copyright (C) 2026 LXR-02 Emu contributors
 * SPDX-License-Identifier: GPL-3.0-only
 */
#ifndef EMU_HW_H
#define EMU_HW_H

#include <stdint.h>

/* Front panel as the shift registers see it (IO/DIO.c): 40 button bits in,
 * 40 LED bits out. */
typedef struct {
	uint8_t buttons[5];
	uint8_t leds[5];
} emu_panel_t;
extern emu_panel_t emu_panel;

/* 2x16 character display (HD44780 model, emu/hw/lcd_emu.c). */
#define EMU_LCD_COLS 16
#define EMU_LCD_ROWS 2
const char *emu_lcd_text(void);              /* 32 chars, row-major, no NUL inside */
const uint8_t *emu_lcd_cgram(void);          /* 8 custom chars x 8 rows */

void emu_rng_seed(uint32_t seed);
void emu_time_set_ms(uint32_t ms);

/* Virtual SD card (emu/hw/sd_emu.c): a RAM disk with a FAT32 volume made
 * by the firmware's own FatFs. */
int emu_sd_init(uint32_t size_bytes);
uint8_t *emu_sd_image(uint32_t *size_bytes);
void emu_sd_set_present(int present);

void emu_fatal(const char *msg);

#endif
