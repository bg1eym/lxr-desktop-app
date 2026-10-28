/*
 * LXR-02 Emu (unofficial) - replaces Core/Src/lcd.c.
 *
 * The firmware drives a 2x16 HD44780-style display over a 4-bit GPIO bus.
 * Here the same lcd.h API feeds a model of the controller (DDRAM address
 * counter, CGRAM, entry mode), so the screen the menu code draws can be read
 * back as text. The non-blocking variants finish in one call, since there is
 * no bus timing to wait for.
 *
 * Copyright (C) 2026 LXR-02 Emu contributors
 * SPDX-License-Identifier: GPL-3.0-only
 */
#include <string.h>
#include "lcd.h"
#include "emu_hw.h"

uint8_t lcd_process_display_interrupt = 0;

static uint8_t ddram[0x80];
static uint8_t cgram[64];
static uint8_t addr;           /* address counter */
static uint8_t addr_is_cg;     /* last address command was SET_CGADR */
static uint8_t entry_increase = 1;
static uint8_t display_on, cursor_on, blink_on;
static char text[EMU_LCD_COLS * EMU_LCD_ROWS + 1];

static void hd44780_command(uint8_t c)
{
	if (c & 0x80) {                 /* set DDRAM address */
		addr = c & 0x7F;
		addr_is_cg = 0;
	} else if (c & 0x40) {          /* set CGRAM address */
		addr = c & 0x3F;
		addr_is_cg = 1;
	} else if (c & 0x20) {          /* function set */
	} else if (c & 0x10) {          /* cursor/display shift: not used by the firmware */
	} else if (c & 0x08) {          /* display on/off, cursor, blink */
		display_on = (c & 0x04) != 0;
		cursor_on = (c & 0x02) != 0;
		blink_on = (c & 0x01) != 0;
	} else if (c & 0x04) {          /* entry mode */
		entry_increase = (c & 0x02) != 0;
	} else if (c & 0x02) {          /* home */
		addr = 0;
		addr_is_cg = 0;
	} else if (c & 0x01) {          /* clear */
		memset(ddram, ' ', sizeof(ddram));
		addr = 0;
		addr_is_cg = 0;
		entry_increase = 1;
	}
}

static void hd44780_data(uint8_t d)
{
	if (addr_is_cg) {
		cgram[addr & 0x3F] = d & 0x1F;
		addr = (uint8_t)((addr + (entry_increase ? 1 : -1)) & 0x3F);
	} else {
		ddram[addr & 0x7F] = d;
		addr = (uint8_t)((addr + (entry_increase ? 1 : -1)) & 0x7F);
	}
}

const char *emu_lcd_text(void)
{
	for (int x = 0; x < EMU_LCD_COLS; x++) {
		text[x] = (char)ddram[0x00 + x];
		text[EMU_LCD_COLS + x] = (char)ddram[0x40 + x];
	}
	text[sizeof(text) - 1] = '\0';
	return text;
}

const uint8_t *emu_lcd_cgram(void)
{
	return cgram;
}

/* bit 0: display on, bit 1: cursor shown, bit 2: blinking; bits 8..: cursor
 * cell 0..31 (row-major), 0xFF when the address is off screen. */
uint32_t emu_lcd_state(void)
{
	uint32_t cell = 0xFF;
	if (!addr_is_cg) {
		if (addr < EMU_LCD_COLS) cell = addr;
		else if (addr >= 0x40 && addr < 0x40 + EMU_LCD_COLS) cell = EMU_LCD_COLS + addr - 0x40;
	}
	return (uint32_t)display_on | (uint32_t)cursor_on << 1 | (uint32_t)blink_on << 2 | cell << 8;
}

/* ---- lcd.h API ----------------------------------------------------------- */
void _delay_us(uint16_t us) { (void)us; }
void _delay_ms(uint32_t ms) { (void)ms; }

void lcd_init(void)
{
	memset(ddram, ' ', sizeof(ddram));
	memset(cgram, 0, sizeof(cgram));
	addr = 0;
	addr_is_cg = 0;
	entry_increase = 1;
	/* lcd.c's init sequence ends with display on, cursor and blink off */
	display_on = 1;
	cursor_on = 0;
	blink_on = 0;
}

void lcd_showSplash(void) { }

void lcd_data(uint8_t data) { hd44780_data(data); }
uint8_t lcd_data_nonBlock(uint8_t data) { hd44780_data(data); return 1; }
void lcd_command(uint8_t data) { hd44780_command(data); }
uint8_t lcd_command_nonblock(uint8_t data) { hd44780_command(data); return 1; }

void lcd_turnOn(uint8_t isOn, uint8_t cursorOn)
{
	lcd_command((uint8_t)(LCD_SET_DISPLAY | (LCD_DISPLAY_ON * isOn) | LCD_CURSOR_ON * cursorOn | LCD_BLINKING_OFF));
}
uint8_t lcd_turnOn_nonblock(uint8_t isOn, uint8_t cursorOn)
{
	lcd_turnOn(isOn, cursorOn);
	return 1;
}

void lcd_clear(void) { lcd_command(LCD_CLEAR_DISPLAY); }
uint8_t lcd_clear_nonblock(void) { lcd_clear(); return 1; }
void lcd_home(void) { lcd_command(LCD_CURSOR_HOME); }

static uint8_t cursor_cmd(uint8_t x, uint8_t y)
{
	switch (y) {
	default:
	case 1: return (uint8_t)(LCD_SET_DDADR + LCD_DDADR_LINE1 + x);
	case 2: return (uint8_t)(LCD_SET_DDADR + LCD_DDADR_LINE2 + x);
	case 3: return (uint8_t)(LCD_SET_DDADR + LCD_DDADR_LINE3 + x);
	case 4: return (uint8_t)(LCD_SET_DDADR + LCD_DDADR_LINE4 + x);
	}
}

void lcd_setcursor(uint8_t x, uint8_t y)
{
	if (y < 1 || y > 4) return;     /* the blocking version ignores bad rows */
	lcd_command(cursor_cmd(x, y));
}
uint8_t lcd_setcursor_nonBlock(uint8_t x, uint8_t y)
{
	lcd_command(cursor_cmd(x, y));  /* the non-blocking one falls back to row 1 */
	return 1;
}

void lcd_string(const char *data)
{
	while (*data != '\0') lcd_data((uint8_t)*data++);
}

void lcd_generatechar(uint8_t code, const uint8_t *data)
{
	lcd_command((uint8_t)(LCD_SET_CGADR | (uint8_t)(code << 3)));
	for (uint8_t i = 0; i < 8; i++) lcd_data(data[i]);
}
uint8_t lcd_generatechar_nonBlock(uint8_t code, const uint8_t *data)
{
	lcd_generatechar(code, data);
	return 1;
}
